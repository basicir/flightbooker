// ==UserScript==
// @name         Foglalástervező – feladatsor export
// @namespace    flightbooker
// @version      1.0.0
// @description  A FlightLogger növendéki programoldaláról (Programs) kiexportálja a program feladatait a tervezett időkkel, a Foglalástervező számára. Csak olvas, hálózatot nem használ.
// @match        https://*.flightlogger.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * Használat: nyisd meg egy olyan növendék Programs oldalát, akinek a kívánt revízió van
 * hozzárendelve, és kattints a jobb alsó sarokban a „Feladatsor exportálása” gombra.
 *
 * Mit exportál: a program nevét és revízióját, a fázisokat, a feladatokat sorrendben
 * (kód, név, típus) és a feladatonkénti tervezett (syllabus) időket oszloponként.
 * Mit NEM exportál: a növendék nevét és azonosítóját, a repült időket, dátumokat, oktatói
 * monogramokat és az elvégzés állapotát – ezek személyes adatok (CLAUDE.md 4. pont).
 * Az egyedi feladatokat („Custom … lesson”) kihagyja.
 *
 * A szkript nem küld semmit sehova: a fájlt a böngésző tölti le a gépedre.
 */
;(function () {
  'use strict'

  const FORMAT = 'flightbooker-feladatsor'
  const FORMAT_VERSION = 1
  const BUTTON_ID = 'fb-feladatsor-export-gomb'

  /** Az oszlopfejlécek (title) leképezése a Foglalástervező mezőire. */
  const COLUMN_KEYS = [
    [/^vfr dual$/, 'vfrDual'],
    [/^vfr solo$/, 'vfrSolo'],
    [/^vfr spic$/, 'vfrSpic'],
    [/^vfr sim/, 'vfrSim'],
    [/^ifr dual$/, 'ifrDual'],
    [/^ifr spic$/, 'ifrSpic'],
    [/^ifr sim/, 'ifrSim'],
    [/^multi engine/, 'multiEngine'],
    [/^night/, 'night'],
    [/^cross country/, 'crossCountry'],
  ]
  /** Ezek összege a gépidő (repülés vagy szimulátor); az ME, NT, XC ezekkel átfed. */
  const FLIGHT_KEYS = ['vfrDual', 'vfrSolo', 'vfrSpic', 'vfrSim', 'ifrDual', 'ifrSpic', 'ifrSim']
  const SIM_KEYS = ['vfrSim', 'ifrSim']

  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim()

  /** „1:30” → 90; üres → 0; „-0:25” → -25. */
  function parseDuration(text) {
    const t = clean(text)
    if (!t) return 0
    const m = /^(-)?(\d+):(\d{1,2})$/.exec(t)
    if (!m) return 0
    const minutes = Number(m[2]) * 60 + Number(m[3])
    return m[1] ? -minutes : minutes
  }

  function columnKey(title) {
    const t = clean(title).toLowerCase()
    for (const [re, key] of COLUMN_KEYS) if (re.test(t)) return key
    return null
  }

  /** „IV./5.S. VOR Holdings (FNPT II.)” → kód „IV./5.S.”, cím „VOR Holdings (FNPT II.)”. */
  function splitCode(name) {
    // A változatjel (S = szimulátor, A = repülőgép) csak ponttal együtt az: „IV./5.S.”.
    const m = /^\s*([IVXLC]+)\s*\.?\s*\/\s*(\d+)\s*\.?\s*(?:([A-Z])\.(?=\s|$))?\s*/.exec(name)
    if (!m) return { code: null, phaseNumber: null, number: null, variant: null, title: name }
    const roman = { I: 1, V: 5, X: 10, L: 50, C: 100 }
    let phase = 0
    for (let i = 0; i < m[1].length; i++) {
      const v = roman[m[1][i]]
      const next = roman[m[1][i + 1]]
      phase += next && next > v ? -v : v
    }
    const variant = m[3] || null
    return {
      code: `${m[1]}./${m[2]}.${variant ? `${variant}.` : ''}`,
      phaseNumber: phase,
      number: Number(m[2]),
      variant,
      title: name.slice(m[0].length).trim() || name,
    }
  }

  /** A táblázathoz tartozó program neve és revíziója: a táblázat előtti utolsó programfejléc. */
  function programHeaderFor(table) {
    let header = null
    for (const h of document.querySelectorAll('h2.flight-header')) {
      if (h.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING) header = h
    }
    if (!header) return { program: null, revision: null }
    const box = header.closest('.program-header') || header.parentElement
    const h6 = box ? box.querySelector('h6') : null
    return { program: clean(header.textContent), revision: h6 ? clean(h6.textContent) : null }
  }

  /** Az oszlopok sorrendje a fejléc időoszlopaiból (th.sum-field, title szerint). */
  function columnsOf(table) {
    const headers = [...table.querySelectorAll('thead th.sum-field')]
    return headers.map((th) => ({ title: clean(th.getAttribute('title') || th.textContent), key: columnKey(th.getAttribute('title') || th.textContent) }))
  }

  function parseTable(table) {
    const { program, revision } = programHeaderFor(table)
    const columns = columnsOf(table)
    const unknownColumns = columns.filter((c) => !c.key).map((c) => c.title)
    const tasks = []
    const byName = new Map()
    let phase = null
    let skippedCustom = 0
    let duplicates = 0
    for (const tr of table.querySelectorAll('tbody tr')) {
      if (tr.classList.contains('phase-row')) {
        const name = clean((tr.querySelector('.phase-name strong') || tr.querySelector('.phase-name') || tr).textContent)
        if (name) phase = name
        continue
      }
      if (!/^user_lecture_/.test(tr.id || '')) continue
      const link = tr.querySelector('td.lecture_status a') || tr.querySelector('td a')
      const name = clean(link ? link.textContent : '')
      if (!name) continue
      const category = clean((tr.querySelector('td.lecture_status em') || {}).textContent)
      if (/custom/i.test(category) || /^custom lesson\b/i.test(name)) {
        skippedCustom++
        continue
      }
      const cells = [...tr.querySelectorAll('td.sum-field')]
      const minutes = {}
      cells.forEach((td, i) => {
        const col = columns[i]
        if (!col || !col.key) return
        const planned = parseDuration((td.querySelector('strong.filler') || {}).textContent)
        if (planned) minutes[col.key] = planned
      })
      const existing = byName.get(name)
      if (existing) {
        // Ugyanaz a feladat többször (például ismételt repülés): az első marad, de ha annak
        // nincs tervezett ideje, a későbbiből pótoljuk.
        duplicates++
        if (Object.keys(existing.minutes).length === 0 && Object.keys(minutes).length > 0) existing.minutes = minutes
        continue
      }
      const split = splitCode(name)
      const task = { order: 0, phase, code: split.code, phaseNumber: split.phaseNumber, number: split.number, variant: split.variant, name, title: split.title, category, minutes }
      byName.set(name, task)
      tasks.push(task)
    }
    tasks.forEach((t, i) => {
      t.order = i + 1
      const flight = FLIGHT_KEYS.reduce((sum, k) => sum + (t.minutes[k] || 0), 0)
      const sim = SIM_KEYS.reduce((sum, k) => sum + (t.minutes[k] || 0), 0)
      t.flightMinutes = flight
      t.simulator = sim > 0 && sim === flight
      t.night = (t.minutes.night || 0) > 0
    })
    return {
      program,
      revision,
      columns: columns.map((c) => c.key || c.title),
      phases: [...new Set(tasks.map((t) => t.phase))].map((name) => ({ name, taskCount: tasks.filter((t) => t.phase === name).length })),
      tasks,
      stats: {
        tasks: tasks.length,
        skippedCustom,
        duplicates,
        withoutCode: tasks.filter((t) => !t.code).map((t) => t.name),
        withoutTime: tasks.filter((t) => t.flightMinutes === 0).map((t) => t.name),
        unknownColumns,
      },
    }
  }

  /** Az oldal összes programtáblázata (általában egy). */
  function parsePage() {
    const tables = [...new Set([...document.querySelectorAll('tr[id^="user_lecture_"]')].map((tr) => tr.closest('table')).filter(Boolean))]
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      programs: tables.map(parseTable),
    }
  }

  const slug = (s) => clean(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ismeretlen'

  function download(data) {
    const first = data.programs[0] || {}
    const name = `feladatsor_${slug(first.program)}_${slug(first.revision)}.json`
    const blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
    return name
  }

  function showDialog(data) {
    const old = document.getElementById('fb-feladatsor-dialog')
    if (old) old.remove()
    const box = document.createElement('div')
    box.id = 'fb-feladatsor-dialog'
    box.setAttribute('role', 'dialog')
    Object.assign(box.style, {
      position: 'fixed', right: '16px', bottom: '64px', zIndex: 2147483647, width: '420px', maxHeight: '70vh', overflow: 'auto',
      background: '#fff', color: '#1d2433', border: '1px solid #c9ced8', borderRadius: '10px', boxShadow: '0 8px 30px rgba(0,0,0,.25)',
      padding: '14px 16px', font: '13px/1.45 system-ui, sans-serif',
    })
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
    let html = '<div style="font-weight:600;font-size:15px;margin-bottom:6px">Feladatsor export</div>'
    if (data.programs.length === 0) {
      html += '<p>Ezen az oldalon nem találtam programtáblázatot. Nyisd meg a növendék <b>Programs</b> oldalát.</p>'
    }
    for (const p of data.programs) {
      html += `<p style="margin:6px 0"><b>${esc(p.program || 'ismeretlen program')}</b> – ${esc(p.revision || 'ismeretlen revízió')}<br>`
      html += `${p.stats.tasks} feladat, kihagyott egyedi feladat: ${p.stats.skippedCustom}, ismétlődő sor: ${p.stats.duplicates}</p>`
      html += '<ul style="margin:4px 0 8px 18px;padding:0">' + p.phases.map((ph) => `<li>${esc(ph.name || 'fázis nélkül')}: ${ph.taskCount}</li>`).join('') + '</ul>'
      if (p.stats.withoutTime.length) html += `<p style="color:#9a6700;margin:4px 0">Tervezett idő nélkül (${p.stats.withoutTime.length}): ${esc(p.stats.withoutTime.slice(0, 8).join('; '))}${p.stats.withoutTime.length > 8 ? '…' : ''}</p>`
      if (p.stats.withoutCode.length) html += `<p style="color:#9a6700;margin:4px 0">Kód nélküli név (${p.stats.withoutCode.length}): ${esc(p.stats.withoutCode.slice(0, 5).join('; '))}</p>`
      if (p.stats.unknownColumns.length) html += `<p style="color:#9a6700;margin:4px 0">Ismeretlen időoszlop: ${esc(p.stats.unknownColumns.join(', '))}</p>`
    }
    html += '<p style="color:#5b6475;margin:6px 0">Személyes adat (név, azonosító, dátum, repült idő) nem kerül a fájlba.</p>'
    html += '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">'
    html += '<button data-act="close" style="padding:6px 10px">Bezárás</button>'
    if (data.programs.length) {
      html += '<button data-act="copy" style="padding:6px 10px">Másolás</button>'
      html += '<button data-act="download" style="padding:6px 10px;font-weight:600">Letöltés (JSON)</button>'
    }
    html += '</div><div data-msg style="margin-top:6px;color:#1a7f37"></div>'
    box.innerHTML = html
    const msg = box.querySelector('[data-msg]')
    box.addEventListener('click', (e) => {
      const act = e.target && e.target.getAttribute && e.target.getAttribute('data-act')
      if (act === 'close') box.remove()
      if (act === 'download') msg.textContent = `Letöltve: ${download(data)}`
      if (act === 'copy') {
        const text = JSON.stringify(data, null, 2)
        const done = () => (msg.textContent = 'A JSON a vágólapon van.')
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => (msg.textContent = 'A másolás nem sikerült; használd a letöltést.'))
      }
    })
    document.body.appendChild(box)
  }

  function ensureButton() {
    const hasTable = document.querySelector('tr[id^="user_lecture_"]')
    const existing = document.getElementById(BUTTON_ID)
    if (!hasTable) {
      if (existing) existing.remove()
      return
    }
    if (existing) return
    const btn = document.createElement('button')
    btn.id = BUTTON_ID
    btn.type = 'button'
    btn.textContent = 'Feladatsor exportálása'
    Object.assign(btn.style, {
      position: 'fixed', right: '16px', bottom: '16px', zIndex: 2147483647, padding: '8px 14px', borderRadius: '8px',
      border: '1px solid #1f6feb', background: '#1f6feb', color: '#fff', font: '600 13px system-ui, sans-serif', cursor: 'pointer',
      boxShadow: '0 4px 14px rgba(0,0,0,.2)',
    })
    btn.addEventListener('click', () => showDialog(parsePage()))
    document.body.appendChild(btn)
  }

  // Tesztelhetőség: a feldolgozó a konzolból is hívható.
  window.flightbookerFeladatsor = { parsePage, parseDuration, splitCode }

  ensureButton()
  // A FlightLogger oldalai részben dinamikusan töltődnek (Turbo): figyeljük a változást.
  let pending = false
  new MutationObserver(() => {
    if (pending) return
    pending = true
    setTimeout(() => {
      pending = false
      ensureButton()
    }, 300)
  }).observe(document.documentElement, { childList: true, subtree: true })
})()
