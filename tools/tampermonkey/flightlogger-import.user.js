// ==UserScript==
// @name         Foglalástervező – FlightLogger-import
// @namespace    flightbooker
// @version      1.6.0
// @description  A Foglalástervező rögzítési listájából másolt foglalásokat a FlightLogger saját foglalási ablakában tölti ki, egyenként. A mentést (Create) mindig te nyomod meg; a szkript nem használ API-t és hálózatot.
// @match        https://*.flightlogger.net/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * FLIGHTLOGGER-IMPORT (koncepció 5.10, FLI-04 – FLI-08)
 *
 * 1. A Foglalástervező rögzítési listáján „FlightLoggerbe” (egy tétel) vagy „Mind a FlightLoggerbe”.
 * 2. A FlightLogger foglalási áttekintőjén (Bookings → Overview) az eszközsor „Import” gombja
 *    megnyitja a panelt: illeszd be a vágólapról. A foglalások halványan megjelennek a naptárban
 *    a megfelelő sorban (gép, terem, oktató), mindig a látható napon.
 * 3. „Foglalás megkezdése”: a szkript megnyitja a FlightLogger ablakát, kiválasztja a típust és
 *    kitölti a mezőket. Ellenőrizd, pótold, amit a panel felsorol, és nyomd meg a Create gombot.
 *    Mentés után magától nyílik a következő; ha mentés nélkül zárod be az ablakot, megáll.
 * 4. Minden mentés után a visszaigazolás a vágólapra kerül: a Foglalástervezőbe visszatérve a
 *    tételek magától rögzítettek lesznek (vagy: Rögzítési lista → „Visszaigazolás beolvasása”).
 *
 * A szkript csak a FlightLogger saját felületét kezeli: nem küld kérést, nem nyomja meg a mentést.
 * A lista a böngésző helyi tárában van ezen az oldalon; a panel „Lista törlése” gombja törli.
 */
;(function () {
  'use strict'
  if (window.top !== window) return
  const VERSION = '1.6.0'
  {
    const prev = window.flightbookerImport
    const newer = (a, b) => {
      const x = String(a).split('.').map(Number)
      const y = String(b).split('.').map(Number)
      for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
      return false
    }
    if (prev) {
      if (!newer(VERSION, prev.version)) return // ugyanez vagy újabb már fut
      if (typeof prev.dispose === 'function') prev.dispose()
      else {
        // Egy régebbi (1.3.0 előtti) példány fut, és azt nem lehet leállítani: jelezzük, hogy kettő van.
        warnDuplicate(prev.version)
        return
      }
    }
  }
  /** Figyelmeztetés: a Tampermonkeyban két FlightLogger-import szkript van, és a régi fut. */
  function warnDuplicate(oldVersion) {
    const box = document.createElement('div')
    box.setAttribute('data-fb-import', 'figyelmeztetes')
    box.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483001;max-width:560px;padding:10px 14px;border-radius:8px;background:#fef2f2;border:1px solid #fca5a5;color:#991b1b;font:13px/1.4 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.15)'
    box.textContent = `A Tampermonkeyban két FlightLogger-import szkript van, és a régebbi (${oldVersion}) fut helyette. Nyisd meg a Tampermonkey vezérlőpultját, és csak a ${VERSION} maradjon (a többit töröld), majd töltsd újra az oldalt. `
    const x = document.createElement('button')
    x.textContent = 'Rendben'
    x.style.cssText = 'margin-left:6px;font:inherit;padding:2px 8px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#991b1b;cursor:pointer'
    x.addEventListener('click', () => box.remove())
    box.appendChild(x)
    document.documentElement.appendChild(box)
  }

  // ------------------------------------------------------------------ alapok

  const IMPORT_FORMAT = 'flightbooker-fl-import'
  const RECEIPT_FORMAT = 'flightbooker-fl-receipt'
  /** A visszaigazolás változata; csomagból az 1-es (csak új foglalások) és a 2-es (átírások is) is jó. */
  const FORMAT_VERSION = 2
  const KEY = 'fb-import:allapot'
  const HOST_ID = 'fb-import-panel'
  const OWN = 'data-fb-import'

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  /** Összevetéshez: kisbetű, ékezet nélkül, egyszerűsített szóközökkel. */
  const norm = (s) =>
    clean(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const pad = (n) => String(n).padStart(2, '0')
  const hhmm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`

  class FillError extends Error {}

  /** Vár, amíg a függvény nem üres értéket ad; lejáratkor `FillError` a leírással. */
  async function waitFor(fn, timeout, what) {
    const start = Date.now()
    for (;;) {
      let v
      try {
        v = fn()
      } catch {
        v = null
      }
      if (v) return v
      if (Date.now() - start > timeout) throw new FillError(what ? `Nem jelent meg: ${what}` : 'Időtúllépés')
      await sleep(100)
    }
  }
  function visible(el) {
    if (!el || !el.isConnected) return false
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  /** Érték beállítása React-vezérelt mezőben is: a natív setter után input és change esemény. */
  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const desc = Object.getOwnPropertyDescriptor(proto, 'value')
    if (desc && desc.set) desc.set.call(el, value)
    else el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }
  function typeInto(el, value) {
    el.focus()
    setNativeValue(el, value)
  }
  function blur(el) {
    el.dispatchEvent(new FocusEvent('blur', { bubbles: false }))
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    if (document.activeElement === el) el.blur()
  }
  function pressKey(el, key) {
    for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { key, code: key, bubbles: true, cancelable: true }))
  }
  /**
   * Két képkocka: a React az eseményre ennyi idő alatt biztosan újrarajzol. Háttérbe tett lapon a
   * böngésző nem rajzol (nincs képkocka), ezért legfeljebb 60 ms-ot vár.
   */
  const frames = () =>
    new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        resolve()
      }
      requestAnimationFrame(() => requestAnimationFrame(finish))
      setTimeout(finish, 60)
    })
  /** Feltételre vár, de nem hibával, hanem `null`-lal tér vissza (rövid, opcionális várakozás). */
  const until = (fn, timeout) => waitFor(fn, timeout).catch(() => null)

  /** Az egér-eseménysor egy opción (a react-select a kattintásra választ). */
  function clickOption(el) {
    el.scrollIntoView({ block: 'nearest' })
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }))
    el.click()
  }

  // ------------------------------------------------------------------ állapot

  /**
   * A lista: a beillesztett foglalások állapottal. `pending` (vár), `active` (kitöltés alatt),
   * `created` (mentve), `skipped` (kihagyva). A `selected` dönti el, hogy a futás érinti-e.
   */
  function loadState() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null')
      if (s && Array.isArray(s.items)) return { items: s.items, panelOpen: !!s.panelOpen, instructor: s.instructor || null }
    } catch {
      /* sérült állapot: üres lista */
    }
    return { items: [], panelOpen: false, instructor: null }
  }
  let S = loadState()
  // Újratöltés után a félbehagyott kitöltés újra várakozik.
  for (const it of S.items) if (it.status === 'active') it.status = 'pending'
  const run = { active: false, item: null, waiting: false, createClicked: false, message: '', messageKind: 'info' }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ items: S.items, panelOpen: S.panelOpen, instructor: S.instructor }))
    } catch {
      setMessage('A lista mentése nem sikerült (megtelt a böngésző helyi tára?).', 'error')
    }
  }
  function setMessage(text, kind) {
    run.message = text
    run.messageKind = kind || 'info'
    render()
  }

  /** Beillesztett szöveg: egy vagy több importcsomag (JSON). */
  function parsePackages(text) {
    const found = []
    const errors = []
    const chunks = []
    // Több egymás után beillesztett csomag is lehet: a legfelső szintű JSON-objektumokat bontjuk.
    let depth = 0
    let start = -1
    let inString = false
    let escaped = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (inString) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') inString = false
        continue
      }
      if (c === '"') inString = true
      else if (c === '{') {
        if (depth === 0) start = i
        depth++
      } else if (c === '}' && depth > 0) {
        depth--
        if (depth === 0 && start >= 0) chunks.push(text.slice(start, i + 1))
      }
    }
    for (const chunk of chunks) {
      let pkg
      try {
        pkg = JSON.parse(chunk)
      } catch {
        errors.push('Nem értelmezhető JSON.')
        continue
      }
      if (!pkg || pkg.format !== IMPORT_FORMAT) {
        if (pkg && pkg.format === RECEIPT_FORMAT) errors.push('Ez visszaigazolás, nem importcsomag: a Foglalástervezőbe való.')
        else errors.push('Nem Foglalástervező-importcsomag.')
        continue
      }
      if (pkg.version !== 1 && pkg.version !== 2) {
        errors.push(`Ismeretlen csomagváltozat (${pkg.version}); frissítsd a szkriptet a Foglalástervező beállításaiból.`)
        continue
      }
      for (const b of Array.isArray(pkg.bookings) ? pkg.bookings : []) {
        if (b && typeof b.id === 'string' && typeof b.flType === 'string' && b.times && b.times.start && b.times.end) found.push(b)
        else errors.push('Hiányos foglalás a csomagban.')
      }
    }
    if (chunks.length === 0) errors.push('A beillesztett szövegben nincs importcsomag.')
    return { bookings: found, errors }
  }
  function addBookings(bookings) {
    let added = 0
    let updated = 0
    const withInstructor = bookings.find((b) => b.instructor)
    if (withInstructor) S.instructor = withInstructor.instructor
    for (const b of bookings) {
      const existing = S.items.find((x) => x.data.id === b.id)
      if (existing) {
        // A már mentett tétel csak akkor jön újra, ha most a meglévő foglalás átírása (áthelyezés).
        if (existing.status === 'created' && !(b.update && JSON.stringify(b) !== JSON.stringify(existing.data))) continue
        existing.data = b
        existing.status = 'pending'
        existing.notes = []
        updated++
      } else {
        S.items.push({ data: b, status: 'pending', selected: true, notes: [] })
        added++
      }
    }
    S.items.sort((a, b) => (a.data.date + pad(a.data.minutes.start)).localeCompare(b.data.date + pad(b.data.minutes.start)))
    save()
    return { added, updated }
  }

  function receiptText() {
    const items = S.items
      .filter((x) => x.status === 'created' || x.status === 'skipped')
      .map((x) => ({
        id: x.data.id,
        requestIds: x.data.requestIds,
        partOf: x.data.partOf || 1,
        status: x.status,
        ...(x.data.update ? { update: true, bookingId: x.data.update.bookingId } : {}),
        ...(x.data.cancel ? { cancel: true } : {}),
        ...(x.newBookingId && !x.data.update ? { bookingId: x.newBookingId } : {}),
        at: x.at || new Date().toISOString(),
      }))
    return JSON.stringify({ format: RECEIPT_FORMAT, version: FORMAT_VERSION, createdAt: new Date().toISOString(), items })
  }
  async function copyReceipt(silent) {
    try {
      await navigator.clipboard.writeText(receiptText())
      if (!silent) setMessage('A visszaigazolás a vágólapon: a Foglalástervezőbe visszatérve beolvassa.', 'ok')
      return true
    } catch {
      if (!silent) setMessage('A vágólapra írás nem sikerült; kattints ide a panelen, majd próbáld újra.', 'error')
      return false
    }
  }

  // ------------------------------------------------------------------ a FlightLogger oldala

  const createButton = () => document.querySelector('button[title="Create booking"]')
  const navbar = () => document.getElementById('bookingsNavbar')
  const formModal = () => {
    const m = document.getElementById('bookingFormModal')
    return m && visible(m) ? m : null
  }
  const isOwn = (el) => !!(el && el.closest && el.closest(`[${OWN}]`))

  /** A látható nap („Sunday, 22.11.2026” a foglalási eszközsor alatt) ÉÉÉÉ-HH-NN alakban. */
  function displayedDate() {
    const root = (navbar() && navbar().parentElement) || document.body
    const re = /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(\d{2})\.(\d{2})\.(\d{4})\b/
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (isOwn(n.parentElement)) continue
      const m = re.exec(n.nodeValue)
      if (m) return `${m[3]}-${m[2]}-${m[1]}`
    }
    return null
  }

  /** A típusválasztó csempéje (a „Create booking” után): a felirata pontosan egyezik. */
  function chooserTile(label) {
    const root = document.getElementById('portal-root') || document.body
    const want = norm(label)
    for (const el of root.querySelectorAll('div, button, a, li, span')) {
      if (isOwn(el) || !visible(el)) continue
      if (norm(el.textContent) !== want) continue
      // A legbelső elem, amelynek a szövege maga a felirat.
      if ([...el.children].some((c) => norm(c.textContent) === want)) continue
      if (el.closest('#bookingFormModal')) continue
      return el
    }
    return null
  }

  /** Az ablak egy sora a címkéje szerint (FlightLogger: li > label). */
  function fieldRow(modal, label) {
    const want = norm(label)
    const rows = [...modal.querySelectorAll('li')]
      .map((li) => ({ li, lab: li.querySelector(':scope > label') }))
      .filter((x) => x.lab)
      .map((x) => ({ li: x.li, t: norm(x.lab.textContent) }))
    // Előbb a pontos egyezés („Session” ne a „Session type” sort adja), aztán a kiegészített címke.
    const exact = rows.find((x) => x.t === want)
    if (exact) return exact.li
    const prefixed = rows.find((x) => x.t.startsWith(`${want} `))
    return prefixed ? prefixed.li : null
  }

  /** A választó (gomb + legördülő) tárolója azonosító vagy sorcímke szerint. */
  function pickerContainer(modal, id, label) {
    if (id) {
      const el = modal.querySelector(`#${CSS.escape(id)}`)
      if (el) return el
    }
    const row = label ? fieldRow(modal, label) : null
    if (!row) return null
    for (const div of row.querySelectorAll(':scope > div')) if (div.querySelector(':scope > button')) return div
    return null
  }

  function comboboxIn(root) {
    return [...root.querySelectorAll('input[role="combobox"], input[id^="react-select-"][id$="-input"]')].find((i) => visible(i) || i.isConnected) || null
  }
  /** A react-select opciói az input azonosítója szerint (a menü máshová is renderelődhet). */
  function optionsFor(input, root) {
    const m = /^(react-select-\d+)-input$/.exec(input.id || '')
    const list = m ? document.querySelectorAll(`[id^="${m[1]}-option-"]`) : root.querySelectorAll('[role="option"]')
    return [...list].filter((o) => !isOwn(o) && o.getAttribute('aria-disabled') !== 'true')
  }

  /** Személy: „KÓD - Név”; a kód a biztos, a név a tartalék. */
  function personScore(text, person) {
    const t = norm(text)
    if (person.callSign && (t.startsWith(`${norm(person.callSign)} -`) || t === norm(person.callSign))) return 3
    if (person.name && t.includes(norm(person.name))) return 2
    return 0
  }
  function textScore(text, wanted) {
    const t = norm(text)
    const w = norm(wanted)
    if (!w) return 0
    if (t === w) return 3
    if (t.startsWith(w)) return 2.5
    if (t.includes(w)) return 2
    // Szavak egyezése (például program: „IR Transition Plan for ATP(A) Rev 4” – „… Revision 4”).
    const words = w.split(/[^a-z0-9()]+/).filter((x) => x.length > 1)
    if (!words.length) return 0
    const hit = words.filter((x) => t.includes(x)).length / words.length
    return hit >= 0.6 ? hit : 0
  }
  /** „IV./44.A. ME Normal VFR Procedures” → „IV./44.A.” (a lista ezzel szűrhető). */
  const lessonCode = (name) => {
    const m = /^\s*([IVXLC]+\.\/\d+\.(?:[A-Z]\.)?)/.exec(name || '')
    return m ? m[1] : null
  }

  /**
   * A legjobb egyértelmű opció a pontozott listából: egy találat, a legjobb jobb a másodiknál, vagy a
   * legjobbak felirata azonos (ugyanaz a választás többször a listában). Különben `null`.
   */
  function unambiguous(scored) {
    if (scored.length === 0) return null
    const top = scored.filter((x) => x.s === scored[0].s)
    const texts = new Set(top.map((x) => norm(x.o.textContent)))
    return texts.size === 1 ? scored[0].o : null
  }

  function closeDropdown(input) {
    if (!input || !input.isConnected) return
    pressKey(input, 'Escape')
    blur(input)
  }

  /**
   * Egy választó kitöltése: megnyitja, ha kell, beírja a keresést, és a legjobb egyértelmű opciót
   * választja. `{ ok, note }`: ha nincs egyértelmű találat, a választó üres marad, és a megjegyzés
   * a panelre kerül.
   */
  async function pick(modal, spec) {
    const container = pickerContainer(modal, spec.id, spec.label)
    if (!container) return { ok: false, note: `${spec.label}: nincs ilyen mező` }
    const button = container.querySelector(':scope > button') || container.querySelector('button')
    if (spec.skipIf && button && spec.skipIf(clean(button.textContent))) return { ok: true }
    if (!button) return { ok: false, note: `${spec.label}: nincs választó gomb` }
    button.click()
    let input
    try {
      input = await waitFor(() => comboboxIn(container) || comboboxIn(document.querySelector('.gHjEBl') || container), 3000, `${spec.label} legördülő`)
    } catch {
      return { ok: false, note: `${spec.label}: nem nyílt meg a lista` }
    }
    const queries = (spec.queries || []).filter(Boolean)
    let best = null
    for (const q of queries.length ? queries : ['']) {
      if (q) typeInto(input, q)
      const deadline = Date.now() + (q ? 4000 : 2500)
      while (Date.now() < deadline) {
        const opts = optionsFor(input, container)
        const scored = opts.map((o) => ({ o, s: spec.score(clean(o.textContent)) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
        best = unambiguous(scored)
        if (best) break
        if (scored.length > 1 && q && Date.now() > deadline - 1500) {
          best = null
          break
        }
        await sleep(150)
      }
      if (best) break
    }
    if (!best) {
      closeDropdown(input)
      return { ok: false, note: `${spec.label}: nincs egyértelmű találat (${spec.show}) – válaszd ki kézzel` }
    }
    const chosen = clean(best.textContent)
    clickOption(best)
    await sleep(250)
    if (input.isConnected && visible(input)) closeDropdown(input)
    await sleep(150)
    return { ok: true, chosen }
  }

  /** Több értékű react-select (Students, Participants): résztvevőnként keresés és választás. */
  async function pickMany(modal, label, people) {
    const notes = []
    const row = fieldRow(modal, label)
    if (!row) return [`${label}: nincs ilyen mező`]
    const chips = () => [...row.querySelectorAll('[class*="multi-value__label"]')].map((c) => clean(c.textContent))
    for (const p of people) {
      // Már rajta van (például az osztály választása hozta): nem kell újra felvenni.
      if (chips().some((c) => personScore(c, p) > 0)) continue
      const input = comboboxIn(row)
      if (!input) {
        notes.push(`${label}: nincs keresőmező`)
        break
      }
      const before = row.querySelectorAll('[class*="multi-value__label"], [class*="multiValue"]').length
      typeInto(input, p.callSign || p.name)
      let best = null
      const deadline = Date.now() + 4000
      while (Date.now() < deadline && !best) {
        const scored = optionsFor(input, row)
          .map((o) => ({ o, s: personScore(clean(o.textContent), p) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
        best = unambiguous(scored)
        if (!best) await sleep(150)
      }
      if (!best) {
        setNativeValue(input, '')
        notes.push(`${label}: ${p.callSign || p.name} nem található – add hozzá kézzel`)
        continue
      }
      clickOption(best)
      await sleep(250)
      const after = row.querySelectorAll('[class*="multi-value__label"], [class*="multiValue"]').length
      if (after <= before) notes.push(`${label}: ${p.callSign || p.name} – ellenőrizd, hogy rákerült-e`)
    }
    const input = comboboxIn(row)
    if (input) closeDropdown(input)
    const extra = chips().filter((c) => !people.some((p) => personScore(c, p) > 0))
    if (extra.length) notes.push(`${label}: a tervben nem szereplők is rajta vannak (${extra.length} fő, például az osztály miatt) – töröld, akit nem kell`)
    return notes
  }

  /** Szabad szöveges mező egy sorban (Ground training „Session”). */
  function setTextRow(modal, label, value) {
    if (!value) return null
    const row = fieldRow(modal, label)
    const input = row && [...row.querySelectorAll('input[type="text"], input:not([type])')].find((i) => i.getAttribute('role') !== 'combobox')
    if (!input) return `${label}: nincs ilyen mező – írd be kézzel: ${value}`
    typeInto(input, value)
    blur(input)
    return null
  }

  /** Egy időpont-sor (Briefing, Start, End, Debriefing): dátum és idő. */
  function setTimeRow(modal, label, value) {
    if (!value) return null
    const row = fieldRow(modal, label)
    if (!row) return `${label}: nincs ilyen mező`
    const timeInput = row.querySelector('.time-input input') || row.querySelector('input[type="text"]:not([placeholder])')
    const dateInput = row.querySelector('.date-input input') || row.querySelector('input[placeholder="DD.MM.YYYY"]')
    const problems = []
    for (const [input, v, what] of [
      [dateInput, value.date, 'dátum'],
      [timeInput, value.time, 'idő'],
    ]) {
      if (!input) {
        problems.push(what)
        continue
      }
      if (input.value === v) continue
      typeInto(input, v)
      blur(input)
    }
    return problems.length ? `${label}: nincs ${problems.join(' és ')} mező` : null
  }
  function checkTimeRow(modal, label, value) {
    if (!value) return null
    const row = fieldRow(modal, label)
    if (!row) return null
    const t = row.querySelector('.time-input input')
    const d = row.querySelector('.date-input input')
    const bad = []
    if (t && clean(t.value) !== value.time) bad.push(`idő ${clean(t.value) || '–'} (kellene ${value.time})`)
    if (d && clean(d.value) !== value.date) bad.push(`dátum ${clean(d.value) || '–'} (kellene ${value.date})`)
    return bad.length ? `${label}: ${bad.join(', ')} – javítsd kézzel` : null
  }

  /**
   * A foglalás kitöltőszíne (FLI-12) a FlightLogger színválasztójának hex mezőjén át; bezárás a
   * választón kívüli kattintással, ahogy kézzel. Szín nélkül (a beállításban „nincs szín”) nem nyúl hozzá.
   */
  async function setFillColor(modal, hex) {
    if (!hex) return null
    const picker = modal.querySelector('[data-testid="booking-fill-color-picker"]')
    if (!picker) return `Szín (${hex}): nincs színválasztó – állítsd be kézzel`
    const inputOf = () => picker.querySelector('.w-color-editable-input input')
    if (!inputOf() && picker.firstElementChild) picker.firstElementChild.click()
    const input = await until(inputOf, 1500)
    if (!input) return `Szín (${hex}): nem nyílt meg a színválasztó – állítsd be kézzel`
    typeInto(input, hex)
    pressKey(input, 'Enter')
    await frames()
    const ok = norm(input.value) === norm(hex)
    // Bezárás: kattintás a választón kívül (az ablak fejlécén).
    const outside = modal.querySelector('.modal-header') || modal
    for (const type of ['mousedown', 'mouseup', 'click']) outside.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    await until(() => !inputOf(), 600)
    return ok ? null : `Szín: ${hex} nem állt be – ellenőrizd`
  }

  /** A típusválasztó (Single student, …, Meeting) és az ablak megnyitása. */
  async function openForm(data) {
    if (formModal()) throw new FillError('Már nyitva van egy foglalási ablak: zárd be, és indítsd újra.')
    const btn = await waitFor(createButton, 3000, '„Create booking” gomb')
    btn.click()
    const tile = await waitFor(() => chooserTile(data.tile), 5000, `„${data.tile}” csempe`)
    tile.click()
    const modal = await waitFor(formModal, 8000, 'foglalási ablak')
    const select = modal.querySelector('#bookingFormTypeSelector, select[name="bookingType"]')
    if (select && select.value !== data.flType) {
      if (![...select.options].some((o) => o.value === data.flType)) throw new FillError(`Ismeretlen foglalástípus a FlightLoggerben: ${data.flType}`)
      setNativeValue(select, data.flType)
      await sleep(500)
    }
    // A mezők betöltődése (a választók adatai a háttérben jönnek).
    await waitFor(() => modal.querySelector('form li'), 5000, 'az ablak mezői')
    await sleep(400)
    return formModal() || modal
  }

  // ------------------------------------------------------------------ meglévő foglalás átírása (áthelyezés)

  /** A naptár a kért napra (ÉÉÉÉ-HH-NN) a FlightLogger napléptető gombjaival. */
  async function gotoDate(iso) {
    for (let i = 0; i < 60; i++) {
      const shown = displayedDate()
      if (shown === iso) return
      if (!shown) throw new FillError('Nem látom, melyik nap látszik a naptárban')
      const title = shown < iso ? 'Navigate to next day' : 'Navigate to previous day'
      const btn = document.querySelector(`button[title="${title}"]`)
      if (!btn) throw new FillError(`Nincs „${title}” gomb – lapozz kézzel a ${iso.replace(/-/g, '. ')}. napra`)
      btn.click()
      await waitFor(() => displayedDate() !== shown, 8000, 'a következő nap a naptárban')
    }
    throw new FillError(`Nem sikerült a ${iso.replace(/-/g, '. ')}. napra lapozni`)
  }
  /** Kattintás egy foglalásblokkra, ahogy az egér teszi (a FlightLogger erre nyitja meg). */
  function clickBlock(el) {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    const at = { bubbles: true, cancelable: true, clientX: r.left + Math.min(20, r.width / 2), clientY: r.top + r.height / 2, button: 0 }
    el.dispatchEvent(new PointerEvent('pointerdown', at))
    el.dispatchEvent(new MouseEvent('mousedown', at))
    el.dispatchEvent(new PointerEvent('pointerup', at))
    el.dispatchEvent(new MouseEvent('mouseup', at))
    el.dispatchEvent(new MouseEvent('click', at))
  }
  /**
   * A meglévő foglalás szerkesztőablaka (Update booking): a régi napra lapoz, és a foglalás
   * blokkjára kattint. Ha a blokk nincs meg (már áthelyezték vagy lemondták), megáll.
   */
  async function openEditForm(data) {
    if (formModal()) throw new FillError('Már nyitva van egy foglalási ablak: zárd be, és indítsd újra.')
    const u = data.update
    await gotoDate(u.from.date)
    const block = await until(() => document.getElementById(`bookingBlock${u.bookingId}`), 8000)
    if (!block) {
      throw new FillError(`A meglévő foglalást (${u.from.date.replace(/-/g, '. ')}. ${u.from.start}–${u.from.end}) nem látom a naptárban – lehet, hogy már áthelyezték vagy lemondták. Hagyd ki, vagy írd át kézzel`)
    }
    clickBlock(block.querySelector('p') || block)
    const modal = await waitFor(formModal, 8000, 'a foglalás szerkesztőablaka')
    await waitFor(() => fieldRow(modal, 'Start'), 5000, 'az ablak mezői')
    await sleep(400)
    if (!createButtonsIn(modal).some((b) => /^update\b/i.test(clean(b.textContent)))) {
      throw new FillError('Nem a foglalás szerkesztőablaka nyílt meg (nincs Update gomb) – zárd be, és írd át kézzel')
    }
    return formModal() || modal
  }
  /**
   * Az átírás: csak a hely (idők, gép vagy terem) változik; a résztvevőkhöz, a feladathoz, a
   * kommenthez és a színhez nem nyúl.
   */
  async function fillEditForm(modal, data) {
    const notes = []
    const add = (r) => {
      if (r && r.note) notes.push(r.note)
      else if (typeof r === 'string' && r) notes.push(r)
    }
    const t = data.flType
    const flight = t === 'Single student' || t === 'Multi student'
    if (flight && data.update && data.update.full) {
      // Az összetétel is változik (vegyes vagy szétvált közös briefinges pár): típus, növendékek,
      // programjuk és feladatuk – a régi kitöltés módszerével, a már jó mezőket kihagyva.
      const select = modal.querySelector('#bookingFormTypeSelector, select[name="bookingType"]')
      if (select && select.value !== t) {
        if ([...select.options].some((o) => o.value === t)) {
          setNativeValue(select, t)
          await sleep(800)
        } else notes.push(`Típus: ${t} nem választható – állítsd át kézzel`)
      }
      const students = data.students || []
      const ids = [
        ['student1btn', 'flightprogrambtn', 'lesson1btn', t === 'Multi student' ? 'Student 1' : 'Student'],
        ['student2btn', 'flightprogram-secondbtn', 'lesson2btn', 'Student 2'],
      ]
      for (let i = 0; i < Math.min(students.length, t === 'Multi student' ? 2 : 1); i++) {
        const s = students[i]
        const [sid, pid, lid, label] = ids[i]
        const r = await pick(modal, { id: sid, label, queries: [s.callSign, s.name], score: (x) => personScore(x, s), show: s.callSign || s.name, skipIf: (current) => personScore(current, s) > 0 })
        add(r)
        if (r && r.chosen) await sleep(600) // a növendék programja és feladatlistája ekkor töltődik be
        if (s.program) add(await pick(modal, { id: pid, label: `${label} programja`, queries: [], score: (x) => textScore(x, s.program), show: s.program, skipIf: (current) => textScore(current, s.program) >= 0.6 }))
        if (s.lesson) {
          const code = lessonCode(s.lesson)
          add(await pick(modal, { id: lid, label: `${label} feladata (Session)`, queries: [code || s.lesson, s.lesson], score: (x) => textScore(x, s.lesson), show: s.lesson, skipIf: (current) => (code ? lessonCode(current) === code : textScore(current, s.lesson) >= 2) }))
        }
      }
    }
    if (flight && data.aircraft) {
      const cs = data.aircraft.callSign
      add(await pick(modal, { label: 'Aircraft', queries: [cs], score: (x) => (norm(x).startsWith(norm(cs)) ? 3 : 0), show: cs, skipIf: (current) => norm(current).startsWith(norm(cs)) }))
    }
    if (!flight && data.classroom) {
      const name = data.classroom.name
      add(await pick(modal, { id: 'classroombtn', label: 'Classroom', queries: [name, name.split(/\s+/).slice(0, 2).join(' ')], score: (x) => textScore(x, name), show: name, skipIf: (current) => norm(current) === norm(name) }))
    }
    const times = flight ? ['Briefing', 'Start', 'End', 'Debriefing'] : ['Start', 'End']
    const keyOf = { Briefing: 'briefing', Start: 'start', End: 'end', Debriefing: 'debriefing' }
    for (const label of times) add(setTimeRow(modal, label, data.times[keyOf[label]]))
    // Második kör: a FlightLogger a dátumot és a hosszt a többi sorra is átviheti.
    await sleep(500)
    for (const label of times) {
      if (checkTimeRow(modal, label, data.times[keyOf[label]])) setTimeRow(modal, label, data.times[keyOf[label]])
    }
    await sleep(300)
    for (const label of times) add(checkTimeRow(modal, label, data.times[keyOf[label]]))
    return notes
  }

  /** Az ablak kitöltése a foglalás típusa szerint; a visszatérő lista a kézzel pótolandók. */
  async function fillForm(modal, data) {
    const notes = []
    const add = (r) => {
      if (r && r.note) notes.push(r.note)
      else if (typeof r === 'string' && r) notes.push(r)
    }
    const person = (id, label, p) => ({ id, label, queries: [p.callSign, p.name], score: (t) => personScore(t, p), show: p.callSign || p.name })
    const program = (id, label, s) =>
      s.program ? { id, label, queries: [], score: (t) => textScore(t, s.program), show: s.program, skipIf: (current) => textScore(current, s.program) >= 0.6 } : null
    const lesson = (id, label, s) =>
      s.lesson ? { id, label, queries: [lessonCode(s.lesson) || s.lesson, s.lesson], score: (t) => textScore(t, s.lesson), show: s.lesson } : null
    const t = data.flType
    const students = data.students || []

    if (t === 'Single student' || t === 'Multi student') {
      if (data.instructor) add(await pick(modal, person('instructorbtn', 'Instructor', data.instructor)))
      const ids = [
        ['student1btn', 'flightprogrambtn', 'lesson1btn', t === 'Multi student' ? 'Student 1' : 'Student'],
        ['student2btn', 'flightprogram-secondbtn', 'lesson2btn', 'Student 2'],
      ]
      for (let i = 0; i < Math.min(students.length, t === 'Multi student' ? 2 : 1); i++) {
        const s = students[i]
        const [sid, pid, lid, label] = ids[i]
        add(await pick(modal, person(sid, label, s)))
        await sleep(600) // a növendék programja és feladatlistája ekkor töltődik be
        const pr = program(pid, `${label} programja`, s)
        if (pr) add(await pick(modal, pr))
        const le = lesson(lid, `${label} feladata (Session)`, s)
        if (le) add(await pick(modal, le))
        else notes.push(`${label}: nincs feladat a tervben – a Session mezőt ellenőrizd`)
      }
      if (data.aircraft) add(await pick(modal, { label: 'Aircraft', queries: [data.aircraft.callSign], score: (x) => (norm(x).startsWith(norm(data.aircraft.callSign)) ? 3 : 0), show: data.aircraft.callSign }))
      else notes.push('Aircraft: nincs gép a tervben – válaszd ki kézzel')
      for (const [label, key] of [
        ['Briefing', 'briefing'],
        ['Start', 'start'],
        ['End', 'end'],
        ['Debriefing', 'debriefing'],
      ]) add(setTimeRow(modal, label, data.times[key]))
    } else {
      if (t !== 'Meeting' && data.instructor) add(await pick(modal, person('instructorbtn', 'Instructor', data.instructor)))
      const th = data.theory || {}
      const byText = (id, label, value) => ({ id, label, queries: [value], score: (x) => textScore(x, value), show: value })
      const missing = []
      if (t === 'Ground lesson') {
        // Az osztály előbb: a FlightLogger a tagjait magától a Students mezőbe teszi.
        if (th.className) add(await pick(modal, byText('classbtn', 'Class', th.className)))
        else missing.push('Class')
        await sleep(400)
        for (const n of await pickMany(modal, 'Students', students)) notes.push(n)
        if (th.program) add(await pick(modal, { ...byText('programbtn', 'Program', th.program), queries: [] }))
        else missing.push('Program')
        await sleep(400) // a tárgylista a programtól függ
        if (th.subject) add(await pick(modal, { ...byText('theorycategorybtn', 'Subject', th.subject), queries: [] }))
        else missing.push('Subject')
        if (th.sessionType && th.sessionType !== 'Ground lesson') add(await pick(modal, { ...byText('sessiontypebtn', 'Session type', th.sessionType), queries: [], skipIf: (current) => norm(current) === norm(th.sessionType) }))
        if (th.session) add(setTextRow(modal, 'Session', th.session))
        else missing.push('Session')
      }
      if (t === 'Extra theory') {
        if (students[0]) add(await pick(modal, person('student1btn', 'Student', students[0])))
        if (th.program) add(await pick(modal, { ...byText('programbtn', 'Program', th.program), queries: [], skipIf: (current) => textScore(current, th.program) >= 2 }))
        else missing.push('Program')
      }
      if (missing.length) notes.push(`${missing.join(', ')}: az igényen nincs megadva – pótold kézzel (vagy add meg az Elméletek oldalon)`)
      if (data.classroom) add(await pick(modal, { id: 'classroombtn', label: 'Classroom', queries: [data.classroom.name, data.classroom.name.split(/\s+/).slice(0, 2).join(' ')], score: (x) => textScore(x, data.classroom.name), show: data.classroom.name }))
      else notes.push('Classroom: nincs terem a tervben – válaszd ki kézzel')
      add(setTimeRow(modal, 'Start', data.times.start))
      add(setTimeRow(modal, 'End', data.times.end))
      if (t === 'Meeting') for (const n of await pickMany(modal, 'Participants', data.participants || [])) notes.push(n)
    }

    if (data.comment) {
      const area = modal.querySelector('textarea[name="comment"]')
      if (area) {
        typeInto(area, data.comment)
        blur(area)
      } else notes.push('Comment: nincs ilyen mező')
    }

    // Kitöltőszín (FLI-12): a régi kitöltés után, külön lépésben.
    add(await setFillColor(modal, data.color))

    // Második kör: a választók (például a feladat) átírhatják az időket.
    await sleep(500)
    const times = t === 'Single student' || t === 'Multi student' ? ['Briefing', 'Start', 'End', 'Debriefing'] : ['Start', 'End']
    const keyOf = { Briefing: 'briefing', Start: 'start', End: 'end', Debriefing: 'debriefing' }
    for (const label of times) {
      if (checkTimeRow(modal, label, data.times[keyOf[label]])) setTimeRow(modal, label, data.times[keyOf[label]])
    }
    await sleep(300)
    for (const label of times) add(checkTimeRow(modal, label, data.times[keyOf[label]]))
    return notes
  }

  /** A foglalás lemondása a szerkesztőablakban (piros „Cancel”; nem az ablak bezárása). */
  function cancelButtonsIn(modal) {
    return [...modal.querySelectorAll('button')].filter((b) => /^cancel\b/i.test(clean(b.textContent)) && !b.classList.contains('btn-close'))
  }
  /** A FlightLogger látható ablakai (például a lemondás megerősítése). */
  function flDialogs() {
    return [...document.querySelectorAll('.modal.show, .modal.in, [role="dialog"], [role="alertdialog"]')].filter((el) => !isOwn(el) && visible(el))
  }

  function createButtonsIn(modal) {
    // Új foglalásnál Create / Create & reuse, átírásnál Update / Update & reuse.
    return [...modal.querySelectorAll('button')].filter((b) => /^(?:create|update)\b/i.test(clean(b.textContent)) && !/unpublished/i.test(b.getAttribute('aria-label') || ''))
  }
  const bookingIds = () => new Set([...document.querySelectorAll('[id^="bookingBlock"]')].map((e) => e.id))

  // ------------------------------------------------------------------ futtatás

  function nextItem() {
    return S.items.find((x) => x.selected && x.status === 'pending')
  }

  /** A következő kijelölt foglalás ablakának megnyitása és kitöltése, majd várakozás a mentésre. */
  async function runNext() {
    if (!run.active) return
    const item = nextItem()
    if (!item) {
      run.active = false
      const done = S.items.filter((x) => x.status === 'created').length
      setMessage(`Kész: ${done} foglalás mentve. A visszaigazolás a vágólapon (a Foglalástervezőbe visszatérve beolvassa).`, 'ok')
      void copyReceipt(true)
      return
    }
    run.item = item
    run.createClicked = false
    item.status = 'active'
    item.notes = []
    save()
    const isCancel = !!item.data.cancel
    const isUpdate = !!item.data.update
    setMessage(`${isCancel ? 'Lemondás' : isUpdate ? 'Átírás' : 'Kitöltés'}: ${item.data.label}…`, 'info')
    let modal
    try {
      if (isCancel) {
        // Ami már előtte nyitva volt (nem a foglalásé), az nem tartja vissza a lemondás végét.
        run.dialogsBefore = new Set(flDialogs())
        modal = await openEditForm({ ...item.data, update: item.data.cancel })
        item.notes = cancelButtonsIn(modal).length ? [] : ['Nincs Cancel gomb az ablakban – mondd le kézzel']
      } else {
        modal = isUpdate ? await openEditForm(item.data) : await openForm(item.data)
        item.notes = isUpdate ? await fillEditForm(modal, item.data) : await fillForm(modal, item.data)
      }
    } catch (err) {
      item.status = 'pending'
      item.notes = [(err && err.message) || String(err)]
      run.active = false
      run.item = null
      save()
      setMessage(`Megállt: ${(err && err.message) || err}. Javítsd, majd „Foglalás megkezdése”.`, 'error')
      return
    }
    save()
    const buttons = isCancel ? cancelButtonsIn(modal) : createButtonsIn(modal)
    for (const b of buttons) {
      b.dataset.fbImportOutline = b.style.outline
      b.style.outline = '3px solid #f59e0b'
      b.style.outlineOffset = '2px'
    }
    if (buttons[0]) buttons[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
    if (isCancel) {
      setMessage('Megnyitottam a foglalást. Nyomd meg a Cancel gombot, és add meg, amit a FlightLogger kér (például az okát) – a szkript nem mondja le helyetted.', item.notes.length ? 'warn' : 'info')
      await waitForCancel(item)
      return
    }
    const saveLabel = isUpdate ? 'Update' : 'Create'
    setMessage(
      item.notes.length
        ? `Ellenőrizd és pótold (${item.notes.length}), majd nyomd meg a(z) ${saveLabel} gombot.`
        : isUpdate
          ? 'Átírva az új helyre. Ellenőrizd, majd nyomd meg az Update gombot (a szkript nem menti helyetted).'
          : 'Kitöltve. Ellenőrizd, majd nyomd meg a Create gombot (a szkript nem menti helyetted).',
      item.notes.length ? 'warn' : 'info',
    )
    await waitForUser(item)
  }

  /**
   * Lemondásra vár: amíg a foglalás ablaka vagy a FlightLogger megerősítő ablaka nyitva van. Utána a
   * foglalás vagy eltűnt (a lemondottak rejtve), vagy lemondottként látszik = kész; ha még él, megáll.
   */
  async function waitForCancel(item) {
    run.waiting = true
    render()
    const id = `bookingBlock${item.data.cancel.bookingId}`
    const before = run.dialogsBefore || new Set()
    while (formModal() || flDialogs().some((el) => !before.has(el))) await sleep(300)
    run.waiting = false
    run.item = null
    const gone = await until(() => {
      const b = document.getElementById(id)
      return !b || isCancelled(b) ? true : null
    }, 6000)
    if (!gone) {
      item.status = 'pending'
      item.notes = ['A foglalás nem lett lemondva (az ablak lemondás nélkül zárult be).']
      run.active = false
      save()
      setMessage('Megállt: a foglalás nem lett lemondva. „Foglalás megkezdése”: újra ez jön; vagy hagyd ki.', 'warn')
      return
    }
    item.status = 'created'
    item.at = new Date().toISOString()
    item.notes = []
    save()
    void copyReceipt(true)
    render()
    if (run.active) {
      await sleep(700)
      void runNext()
    }
  }

  /** Mentésre vár: a Create után bezáródó ablak = létrehozva; mentés nélküli bezárás = megáll. */
  async function waitForUser(item) {
    run.waiting = true
    const before = bookingIds()
    render()
    while (formModal()) await sleep(300)
    run.waiting = false
    run.item = null
    if (!run.createClicked) {
      item.status = 'pending'
      item.notes = ['Az ablakot mentés nélkül zártad be.']
      run.active = false
      save()
      setMessage('Megállt: az ablak mentés nélkül zárult be. „Foglalás megkezdése”: újra ez jön; vagy hagyd ki.', 'warn')
      return
    }
    item.status = 'created'
    item.at = new Date().toISOString()
    item.notes = []
    save()
    void copyReceipt(true)
    // Ha a nap látszik, megnézzük, hogy megjelent-e az új foglalás (csak tájékoztatás; átírásnál nincs új).
    if (!item.data.update && item.data.date === displayedDate()) {
      const appeared = await waitFor(() => [...bookingIds()].some((id) => !before.has(id)), 6000).catch(() => false)
      if (!appeared) item.notes = ['A naptárban nem látom az új foglalást – ellenőrizd.']
      else {
        // Az új foglalás azonosítója a visszaigazolásba (ha egyértelmű).
        const fresh = [...bookingIds()].filter((id) => !before.has(id))
        if (fresh.length === 1) item.newBookingId = fresh[0].replace(/^bookingBlock/, '')
      }
      save()
    }
    render()
    if (run.active) {
      await sleep(700)
      void runNext()
    }
  }

  // A Create (és a Create & reuse) kattintás figyelése az ablakban.
  const onCreateClick = (e) => {
      if (!run.waiting) return
      const b = e.target instanceof Element ? e.target.closest('button') : null
      const modal = formModal()
      if (!b || !modal || !modal.contains(b)) return
      if (createButtonsIn(modal).includes(b)) run.createClicked = true
    }
  document.addEventListener('click', onCreateClick, true)

  function start() {
    if (run.active) return
    if (!nextItem()) return setMessage('Nincs kijelölt, várakozó foglalás.', 'warn')
    if (!createButton()) return setMessage('Nyisd meg a foglalási áttekintőt (Bookings → Overview).', 'warn')
    run.active = true
    void runNext()
  }
  function stop() {
    run.active = false
    setMessage(run.waiting ? 'A mostani ablak után megáll.' : 'Megállítva.', 'info')
  }

  // ------------------------------------------------------------------ naptár: halvány előnézet (FLI-05)

  /*
   * Az előnézet a naptár soraiba kerül (a sor saját rétegébe, ahogy a FlightLogger a blokkjait a
   * sorhoz igazítja), így görgetéskor – a trackpad „rugalmas” túlhúzásakor is – együtt mozog vele.
   * Minden hely a sorhoz képest adott: vízszintesen az óracellák szélességének százalékában,
   * függőlegesen a sáv sorszámából. Képernyő-koordináta csak egy pillanatban mért különbségként
   * szerepel, így a naptár eltolódása (a felső sor magasságváltása, a FlightLogger újrarajzolása)
   * nem csúsztatja el. A FlightLogger meglévő foglalásával átfedő előnézet a következő szabad sávba
   * kerül – ahogy a FlightLogger a saját átfedéseit rakja egymás alá –, és a sor ehhez megnyúlik.
   */
  const LANE_STEP = 28 // a FlightLogger sávjai a sor tetejétől: 1px, 29px, 57px …
  const LANE_ROW = 29 // sávonként ennyivel magasabb a sor (29px, 58px …)
  const GHOST_CSS = `
.fbl{position:absolute;top:0;bottom:0;pointer-events:none;z-index:5}
.fbg{position:absolute;box-sizing:border-box;height:26px;min-width:4px;border-radius:5px;font:600 11px/20px system-ui,sans-serif;padding:0 5px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.fbg.v{background:rgba(238,240,255,.9);border:1.5px dashed rgba(79,70,229,.85);color:#3730a3}
.fbg.a{background:rgba(255,247,230,.95);border:2px solid #f59e0b;color:#92400e}
.fbg.fl{background:#eef2ff;border:1px solid #a5b4fc;color:#312e81}
.fbg .fbg-f{position:absolute;top:0;bottom:0;background:rgba(79,70,229,.18);border-left:1px solid rgba(79,70,229,.5);border-right:1px solid rgba(79,70,229,.5)}
.fbg.a .fbg-f{background:rgba(245,158,11,.28);border-color:rgba(217,119,6,.6)}
.fbg .fbg-t{position:relative}
.fbg.x{background:rgba(254,226,226,.35);border:2.5px dashed #dc2626;color:#991b1b}
.fbg.selframe{background:transparent;border:3px solid #f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.35)}
.fbg.sel{box-shadow:0 0 0 3px #f59e0b}
.fbt .fbg{pointer-events:auto;cursor:pointer}
.fbt{position:relative;box-sizing:border-box;width:100%;border:1px solid #a5b4fc;border-bottom-width:2px;background:#f8f9ff;font:12px/1.3 system-ui,sans-serif;color:#1f2937}
.fbt-l{position:absolute;left:6px;top:3px;font-weight:600;font-size:12px;color:#3730a3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fbt-l small{display:block;font-weight:400;color:#6b7280;font-size:11px}
`
  function ensureStyle() {
    if (document.querySelector(`style[${OWN}="stilus"]`)) return
    const st = document.createElement('style')
    st.setAttribute(OWN, 'stilus')
    st.textContent = GHOST_CSS
    document.head.appendChild(st)
  }

  const RESOURCE_ROW = /^(?:User)?Resource-.+-(?:aircraft|classrooms|instructors_and_crew)$/
  /** A foglalásblokk naptársora (gép, terem, oktató); a blokk a sor első cellájában van. */
  function rowOfBlock(el) {
    for (let r = el.parentElement; r; r = r.parentElement) if (r.id && RESOURCE_ROW.test(r.id)) return r
    return null
  }
  /** A sor (gép, terem) a naptárban: azonosító, majd felirat szerint. */
  function calendarRow(kind, ref) {
    if (!ref) return null
    const suffix = kind === 'aircraft' ? 'aircraft' : 'classrooms'
    if (ref.id) {
      const byId = document.getElementById(`Resource-${ref.id}-${suffix}`)
      if (byId) return byId
    }
    const want = norm(ref.label)
    if (!want) return null
    for (const row of document.querySelectorAll(`[id^="Resource-"][id$="-${suffix}"]`)) {
      const head = row.firstElementChild
      if (norm(head ? head.textContent : row.textContent).includes(want)) return row
    }
    return null
  }
  /** Az oktató sora: a felirata a FlightLogger-kódjával („KÓD - Név”) vagy a nevével egyezik. */
  function instructorRow(person) {
    if (!person) return null
    let best = null
    let bestScore = 0
    for (const row of document.querySelectorAll('[id^="UserResource-"][id$="-instructors_and_crew"]')) {
      const head = row.firstElementChild
      const s = personScore(clean(head ? head.textContent : ''), person)
      if (s > bestScore) {
        best = row
        bestScore = s
      }
    }
    return best
  }

  /**
   * A bejelentkezett felhasználó FlightLogger-azonosítója a fejléc felhasználói menüjéből
   * (Profile: /users/<id>, Logbook: /users/<id>/logbook …). Az oktatói sora ugyanezt viseli:
   * UserResource-<id>-instructors_and_crew.
   */
  function currentUserId() {
    const ids = new Map()
    for (const a of document.querySelectorAll('a[href*="/users/"]')) {
      if (isOwn(a)) continue
      const m = /\/users\/(\d+)(\/[a-z_]+)?\/?$/.exec(a.getAttribute('href') || '')
      if (!m) continue
      if (/^\s*profil/i.test(a.textContent || '')) return m[1]
      if (a.closest('.fl-dropdown-li-a, .fl-navbar-li-a, #user_menu, nav, header')) ids.set(m[1], (ids.get(m[1]) || 0) + 1)
    }
    let best = null
    for (const [id, n] of ids) if (n >= 2 && (!best || n > ids.get(best))) best = id
    return best
  }
  /** A bejelentkezett felhasználó (oktató) sora a naptárban, ha van ilyen sor. */
  function currentUserRow() {
    const id = currentUserId()
    return id ? document.getElementById(`UserResource-${id}-instructors_and_crew`) : null
  }

  /**
   * Lemondott foglalás-e a FlightLogger blokkja (a felső sorban nem jelöljük). Elsősorban a
   * foglalás állapota a FlightLogger adatából ({@link bookingState}); ha az nem érhető el, a
   * halványpiros (rózsaszín) jelölés, amely a „Hide all cancellations” állásban látszik, és a
   * szokásos jelek: lemondásra utaló felirat vagy cím, tiltás-/x-ikon, áthúzott szöveg.
   */
  const CANCEL_RE = /cancel|lemond|törölt/i
  /** A FlightLogger a lemondott foglalást halványpiros (rgb 232,127,127) sávval mutatja (felvétel, 2026-11-24). */
  function cancelledColor(b) {
    const bg = getComputedStyle(b, '::before').backgroundColor || ''
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
    return !!m && Math.abs(+m[1] - 232) <= 8 && Math.abs(+m[2] - 127) <= 8 && Math.abs(+m[3] - 127) <= 8
  }
  /**
   * A foglalás állapota a FlightLogger saját adatából: a blokk React-elemének (és szülőinek)
   * tulajdonságai között a foglalás objektuma (`status`, például CANCELLED). true/false, ha
   * megvan; null, ha nem érhető el (ekkor a látható jelek döntenek).
   */
  const CANCEL_STATUS = /cancel/i
  function bookingState(b) {
    const key = Object.keys(b).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    const id = b.id.replace(/^bookingBlock/, '')
    const verdict = (o) => {
      if (!o || typeof o !== 'object' || Array.isArray(o)) return null
      const own = o.id != null && String(o.id) === id
      const hasState = 'status' in o || 'cancelled' in o || 'isCancelled' in o || 'cancelledAt' in o
      if (!own || !hasState) return null
      if (o.cancelled === true || o.isCancelled === true || o.cancelledAt || CANCEL_STATUS.test(String(o.status || ''))) return true
      return false
    }
    let f = key ? b[key] : null
    for (let depth = 0; f && depth < 15; depth++, f = f.return) {
      const props = f.memoizedProps
      if (!props || typeof props !== 'object') continue
      const direct = verdict(props)
      if (direct !== null) return direct
      for (const v of Object.values(props)) {
        const r = verdict(v)
        if (r !== null) return r
      }
    }
    return null
  }
  function isCancelled(b) {
    // Elsősorban a FlightLogger adata; ha az nem érhető el, a látható jelek.
    const state = bookingState(b)
    if (state !== null) return state
    if (cancelledColor(b)) return true
    if (CANCEL_RE.test(String(b.className || ''))) return true
    for (const el of [b, ...b.querySelectorAll('*')]) {
      for (const a of ['title', 'aria-label', 'data-tooltip', 'data-original-title', 'data-bs-original-title', 'data-status', 'data-state']) {
        if (CANCEL_RE.test(el.getAttribute(a) || '')) return true
      }
      const cls = el.getAttribute('class') || ''
      if (/\bfa-(?:ban|xmark|circle-xmark|calendar-xmark|rectangle-xmark|square-xmark)\b/.test(cls)) return true
      const icon = el.getAttribute('data-icon') || ''
      if (/^(?:ban|xmark|circle-xmark|calendar-xmark|rectangle-xmark|square-xmark)$/.test(icon)) return true
    }
    for (const el of [b, b.querySelector('p')]) {
      if (el && /line-through/.test(getComputedStyle(el).textDecorationLine || '')) return true
    }
    return CANCEL_RE.test(b.textContent || '')
  }

  /** Az óracella kezdőperce a „start” attribútumából („Sun Nov 22 2026 06:00:00 GMT+0100”). */
  function cellStart(cell) {
    const m = /\b(\d{1,2}):(\d{2}):\d{2}\b/.exec(cell.getAttribute('start') || '')
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  /** Tartalék, ha a cellákon nincs időpont: az időcsúszka bal végének órája. */
  function cursorHour() {
    const c = document.querySelector('.time-cursor--min')
    const h = c ? parseInt(clean(c.textContent), 10) : NaN
    return Number.isFinite(h) ? h : 0
  }

  /**
   * Egy sor mérése egyetlen pillanatban, minden saját változtatás előtt: az óracellák széle a sor
   * belső széléhez képest, a nézet kezdő- és záróperce, és a FlightLogger foglalásai (perc, sáv).
   * Ha a sor nem látszik vagy még nincs kirajzolva, null – ilyenkor a sor kimarad, és a következő
   * körben újra próbálkozunk.
   */
  function measureRow(row) {
    const rr = row.getBoundingClientRect()
    if (rr.width < 100 || rr.height < 10) return null
    const cells = [...row.querySelectorAll('[id*="Cell"]')].filter((c) => c.id.startsWith(`${row.id}-`) && /-(?:shallow)?Cell\d+$/.test(c.id))
    if (cells.length === 0) return null
    const starts = cells.map(cellStart)
    const timed = starts.every((s) => s != null)
    const order = cells.map((c, i) => ({ c, s: starts[i] }))
    if (timed) order.sort((p, q) => p.s - q.s)
    const first = order[0].c.getBoundingClientRect()
    const last = order[order.length - 1].c.getBoundingClientRect()
    const width = last.right - first.left
    if (width < 100 || first.height < 4) return null
    const from = timed ? order[0].s : cursorHour() * 60
    const to = timed ? order[order.length - 1].s + 60 : from + cells.length * 60
    const padLeft = rr.left + row.clientLeft
    const padTop = rr.top + row.clientTop
    const toMin = (x) => from + ((x - first.left) / width) * (to - from)
    const blocks = []
    for (const b of row.querySelectorAll('[id^="bookingBlock"]')) {
      if (isOwn(b)) continue
      const r = b.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) continue
      blocks.push({ kind: 'fl', from: toMin(r.left), to: toMin(r.right), lane: Math.max(0, Math.round((r.top - padTop - 1) / LANE_STEP)), text: clean(b.textContent), cancelled: isCancelled(b), id: b.id })
    }
    return {
      row,
      from,
      to,
      x0: first.left,
      x1: last.right,
      left: first.left - padLeft,
      right: padLeft + row.clientWidth - last.right,
      blocks,
      flLanes: blocks.reduce((n, b) => Math.max(n, b.lane + 1), 1),
    }
  }

  /**
   * Sávkiosztás: a rögzített (FlightLogger-) foglalások a saját sávjukban maradnak, a többi az első
   * olyan sávba kerül, ahol semmivel nem fedi át egymást (két perc tűréssel a mérés kerekítése miatt).
   */
  function assignLanes(fixed, items) {
    const occ = []
    const lane = (k) => occ[k] || (occ[k] = [])
    for (const f of fixed) lane(f.lane).push(f)
    for (const it of [...items].sort((p, q) => p.from - q.from || q.to - p.to)) {
      let k = 0
      while (lane(k).some((o) => it.from < o.to - 2 && o.from < it.to - 2)) k++
      lane(k).push(it)
      it.lane = k
    }
    return Math.max(1, occ.length)
  }

  /** Egy előnézeti blokk HTML-je a sor rétegében: vízszintesen százalékban, függőlegesen sávban. */
  function ghostHtml(g, view) {
    const span = view.to - view.from
    const a = Math.max(g.from, view.from)
    const b = Math.min(g.to, view.to)
    if (b - a <= 0 || span <= 0) return ''
    const pct = (m) => (((m - view.from) / span) * 100).toFixed(3)
    let inner = ''
    if (g.flight) {
      const fa = Math.max(a, g.flight[0])
      const fb = Math.min(b, g.flight[1])
      if (fb > fa) inner = `<div class="fbg-f" style="left:${(((fa - a) / (b - a)) * 100).toFixed(2)}%;width:${(((fb - fa) / (b - a)) * 100).toFixed(2)}%"></div>`
    }
    const title = `${hhmm(Math.round(g.from))}–${hhmm(Math.round(g.to))}${g.flight ? ` (repülés ${hhmm(g.flight[0])}–${hhmm(g.flight[1])})` : ''} ${g.title || g.text}`
    const data = `${g.ref ? ` data-ref="${esc(g.ref)}"` : ''}${g.itemId ? ` data-item="${esc(g.itemId)}"` : ''}`
    return `<div class="fbg ${g.kind}${g.sel ? ' sel' : ''}"${data} title="${esc(title)}" style="left:${pct(a)}%;width:${(((b - a) / span) * 100).toFixed(3)}%;top:${1 + g.lane * LANE_STEP}px">${inner}<span class="fbg-t">${esc(g.text)}</span></div>`
  }

  /** A sor saját rétege (egy elem soronként), helyben frissítve: csak a megváltozott rész íródik át. */
  function setLayer(host, left, right, html) {
    let layer = null
    for (const c of host.children) if (c.getAttribute(OWN) === 'reteg') layer = c
    if (!layer) {
      layer = document.createElement('div')
      layer.setAttribute(OWN, 'reteg')
      layer.className = 'fbl'
      host.appendChild(layer)
    }
    const style = `left:${left.toFixed(1)}px;right:${right.toFixed(1)}px`
    if (layer.getAttribute('style') !== style) layer.setAttribute('style', style)
    if (layer.dataset.tartalom !== html) {
      layer.innerHTML = html
      layer.dataset.tartalom = html
    }
    return layer
  }

  /** A megnyújtott FlightLogger-sorok (min-height), hogy a végén visszaállíthassuk őket. */
  const stretched = new Set()
  function stretch(row, lanes) {
    if (lanes > 0) {
      const v = `${lanes * LANE_ROW}px`
      if (row.style.minHeight !== v) row.style.minHeight = v
      stretched.add(row)
    } else if (stretched.has(row)) {
      row.style.minHeight = ''
      stretched.delete(row)
    }
  }

  const statusClass = (it) => (it.status === 'created' ? 'k' : it.status === 'active' ? 'a' : 'v')
  /** Az utoljára beillesztett csomag oktatója (a felső sorhoz). */
  const knownInstructor = () => S.instructor || (S.items.find((x) => x.data.instructor) || { data: {} }).data.instructor || null

  /**
   * A felső sorban kijelölt foglalás (`ref`: FlightLogger-blokk, `item`: a lista tétele): lent a
   * naptárban keretet kap, és oda görget. Újabb kattintás vagy Esc: a kijelölés megszűnik.
   */
  let selection = null
  function selectFromTop(el) {
    const ref = el.getAttribute('data-ref')
    const item = el.getAttribute('data-item')
    const same = selection && ((ref && selection.ref === ref) || (item && selection.item === item))
    selection = same ? null : ref ? { ref } : item ? { item } : null
    drawGhosts()
    if (!selection) return
    // Oda görget, ahol lent látszik: gép vagy terem sora, különben az oktatói sor.
    const targets = selection.ref
      ? [...document.querySelectorAll(`[id="${selection.ref}"]`)].filter((x) => !isOwn(x))
      : [...document.querySelectorAll(`[${OWN}="reteg"] .fbg[data-item="${CSS.escape(selection.item)}"]`)].filter((x) => !x.closest(`[${OWN}="oktato-sor"]`))
    const target = targets.find((x) => !x.closest('[id^="UserResource-"]')) || targets[0]
    if (target) target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }
  const onTopClick = (e) => {
    const el = e.target instanceof Element ? e.target.closest(`[${OWN}="oktato-sor"] .fbg`) : null
    if (!el) return
    e.preventDefault()
    e.stopPropagation()
    selectFromTop(el)
  }
  const onKey = (e) => {
    if (e.key === 'Escape' && selection) {
      selection = null
      drawGhosts()
    }
  }
  document.addEventListener('click', onTopClick, true)
  document.addEventListener('keydown', onKey)

  let ghostTimer = null
  function scheduleGhosts() {
    if (ghostTimer) return
    ghostTimer = setTimeout(() => {
      ghostTimer = null
      drawGhosts()
    }, 60)
  }
  function removeGhosts() {
    for (const el of document.querySelectorAll(`[${OWN}="reteg"], [${OWN}="oktato-sor"]`)) el.remove()
    for (const row of stretched) row.style.minHeight = ''
    stretched.clear()
  }
  /** A felső oktatói sor: egyetlen, megmaradó elem a naptár tetején; csak a tartalma frissül. */
  function topRowIn(wrapper) {
    let top = document.querySelector(`[${OWN}="oktato-sor"]`)
    if (!top) {
      top = document.createElement('div')
      top.setAttribute(OWN, 'oktato-sor')
      top.className = 'fbt'
      top.style.height = `${LANE_ROW + 3}px`
      const label = document.createElement('div')
      label.className = 'fbt-l'
      top.appendChild(label)
    }
    if (top.parentElement !== wrapper || wrapper.firstChild !== top) wrapper.insertBefore(top, wrapper.firstChild)
    return top
  }

  function drawGhosts() {
    const day = displayedDate()
    const wrapper = document.getElementById('calendarWrapper')
    if (!day || !wrapper || !createButton()) return removeGhosts()
    ensureStyle()
    const items = S.items.filter((x) => x.data.date === day && x.status !== 'skipped')
    const open = items.filter((x) => x.status !== 'created') // a felvitteket már a FlightLogger maga mutatja
    const inst = knownInstructor()
    // Az oktató sora: a bejelentkezett felhasználóé, ha nincs, a beillesztett csomag oktatójáé.
    const instRow = currentUserRow() || instructorRow(inst)
    const showTop = !!instRow || !!inst || open.length > 0
    // A felső sor előbb a helyére kerül, és csak utána mérünk: a mérés után már semmi nem tolja el.
    const top = showTop ? topRowIn(wrapper) : null
    if (!top) for (const el of document.querySelectorAll(`[${OWN}="oktato-sor"]`)) el.remove()

    // 1) Mérés.
    const wanted = new Map()
    const want = (row, g) => {
      if (!row) return
      if (!wanted.has(row)) wanted.set(row, [])
      wanted.get(row).push(g)
    }
    // Az átírandó foglalások régi blokkja: elköltözik, ezért nem foglal sávot és a felső sorban sem látszik.
    const moving = new Set(open.filter((x) => x.data.update).map((x) => `bookingBlock${x.data.update.bookingId}`))
    // A lemondandó foglalás a helyén marad, csak piros keretet kap; a felső sorban a lemondás tétele látszik.
    const cancelling = new Set(open.filter((x) => x.data.cancel).map((x) => `bookingBlock${x.data.cancel.bookingId}`))
    if (selection && selection.ref && !document.getElementById(selection.ref)) selection = null
    for (const it of open) {
      const d = it.data
      const flight = d.minutes.flightStart != null && d.minutes.flightEnd != null ? [d.minutes.flightStart, d.minutes.flightEnd] : null
      const sel = !!(selection && selection.item === d.id)
      if (d.cancel) {
        // Keret a meglévő blokkon, minden sorában (gép, terem, oktató); a sáv a blokké.
        const g = { kind: 'x', fixedRef: `bookingBlock${d.cancel.bookingId}`, from: d.minutes.start, to: d.minutes.end, text: '', title: `✕ lemondandó: ${d.label}`, itemId: d.id, sel }
        for (const el of document.querySelectorAll(`[id="${g.fixedRef}"]`)) {
          const row = rowOfBlock(el)
          if (row && !isOwn(el)) want(row, { ...g })
        }
        continue
      }
      const base = { kind: statusClass(it), from: d.minutes.start, to: d.minutes.end, text: `${d.update ? '↦ ' : ''}${d.label}`, itemId: d.id, sel }
      if (d.aircraft) want(calendarRow('aircraft', { id: d.aircraft.id, label: d.aircraft.callSign }), { ...base, flight })
      if (d.classroom) want(calendarRow('classroom', { id: d.classroom.id, label: d.classroom.name }), { ...base, flight: null })
      if (instRow && d.instructor && d.flType !== 'Meeting') want(instRow, { ...base, flight })
    }
    // A felső sorban kijelölt FlightLogger-foglalás kerete lent, minden sorában.
    if (selection && selection.ref) {
      for (const el of document.querySelectorAll(`[id="${selection.ref}"]`)) {
        const row = rowOfBlock(el)
        if (row && !isOwn(el)) want(row, { kind: 'selframe', fixedRef: selection.ref, from: 0, to: 0, text: '', title: 'kijelölve a felső sorban' })
      }
    }
    const measured = new Map()
    for (const row of wanted.keys()) {
      const m = measureRow(row)
      if (m) measured.set(row, m)
    }
    const instM = instRow ? measured.get(instRow) || measureRow(instRow) : null
    let refM = instM
    if (!refM) {
      let tries = 0
      for (const r of wrapper.querySelectorAll('[id^="Resource-"], [id^="UserResource-"]')) {
        if (!RESOURCE_ROW.test(r.id)) continue
        refM = measureRow(r)
        if (refM || ++tries >= 8) break
      }
    }
    let topBox = null
    if (top && refM) {
      const tr = top.getBoundingClientRect()
      const padLeft = tr.left + top.clientLeft
      topBox = { left: refM.x0 - padLeft, right: padLeft + top.clientWidth - refM.x1 }
    }

    // 2) Kiosztás és rajzolás – innentől csak írunk, mérés már nincs.
    const keep = new Set()
    for (const [row, list] of wanted) {
      const m = measured.get(row)
      if (!m) continue
      // A meglévő blokkra tett keretek a blokk helyén; a többi a szabad sávokba.
      const fixed = []
      for (const g of list.filter((x) => x.fixedRef)) {
        const blk = m.blocks.find((b) => b.id === g.fixedRef)
        if (blk) fixed.push({ ...g, from: blk.from, to: blk.to, lane: blk.lane })
      }
      const free = list.filter((x) => !x.fixedRef)
      const lanes = assignLanes(m.blocks.filter((b) => !moving.has(b.id)), free)
      keep.add(setLayer(row, m.left, m.right, [...free, ...fixed].map((g) => ghostHtml(g, m)).join('')))
      const staying = m.blocks.filter((b) => !moving.has(b.id))
      const flLanes = staying.reduce((n, b) => Math.max(n, b.lane + 1), 1)
      stretch(row, lanes > Math.max(flLanes, m.flLanes) ? lanes : 0)
    }
    for (const row of [...stretched]) if (!wanted.has(row) || !measured.has(row) || !row.isConnected) stretch(row, 0)
    if (top) {
      const blocks = instM
        ? instM.blocks.filter((b) => !b.cancelled && !moving.has(b.id) && !cancelling.has(b.id)).map((b) => ({ ...b, ref: b.id, sel: !!(selection && selection.ref === b.id) }))
        : []
      for (const it of open) {
        const d = it.data
        blocks.push({
          kind: d.cancel ? 'x' : statusClass(it),
          from: d.minutes.start,
          to: d.minutes.end,
          text: `${d.cancel ? '✕ ' : d.update ? '↦ ' : ''}${d.label}`,
          itemId: d.id,
          sel: !!(selection && selection.item === d.id),
          flight: !d.cancel && d.minutes.flightStart != null && d.minutes.flightEnd != null ? [d.minutes.flightStart, d.minutes.flightEnd] : null,
        })
      }
      const lanes = assignLanes([], blocks)
      const h = `${lanes * LANE_ROW + 3}px`
      if (top.style.height !== h) top.style.height = h
      const label = top.firstElementChild
      const rowName = instRow && instRow.firstElementChild ? clean(instRow.firstElementChild.textContent) : ''
      const who = rowName ? rowName.split(' - ')[0] : inst ? inst.callSign || inst.name : '?'
      const labelHtml = `Oktató: ${esc(who)}<small>${instRow ? 'a nap foglalásai' : 'a FlightLogger oktatói sora nem látszik'}</small>`
      if (label.innerHTML !== labelHtml) label.innerHTML = labelHtml
      if (topBox) {
        label.style.width = `${Math.max(60, topBox.left - 12)}px`
        keep.add(setLayer(top, topBox.left, topBox.right, refM ? blocks.map((b) => ghostHtml(b, refM)).join('') : ''))
      }
    }
    for (const layer of document.querySelectorAll(`[${OWN}="reteg"]`)) if (!keep.has(layer)) layer.remove()
  }

  // ------------------------------------------------------------------ panel és Import gomb (FLI-04)

  const PANEL_CSS = `
:host { all: initial; }
.p { position: fixed; right: 16px; top: 72px; width: 400px; max-height: calc(100vh - 96px); display: flex; flex-direction: column; z-index: 2147483000;
     font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #1f2937; background: #fff; border: 1px solid #d1d5db;
     border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.18); overflow: hidden; }
.p[hidden] { display: none; }
.hd { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; }
.hd b { flex: 1; font-size: 14px; }
.bd { padding: 10px 12px; overflow: auto; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
.bd > *, .it > * { min-width: 0; }
button { font: inherit; border: 1px solid #d1d5db; background: #fff; color: #1f2937; border-radius: 6px; padding: 4px 9px; cursor: pointer; }
button:hover { background: #f9fafb; }
button.pri { background: #4f46e5; border-color: #4f46e5; color: #fff; }
button.pri:hover { background: #4338ca; }
button.warn { color: #b91c1c; border-color: #fecaca; }
button.sm { padding: 1px 6px; font-size: 12px; }
button:disabled { opacity: .5; cursor: default; }
textarea { width: 100%; box-sizing: border-box; height: 64px; font: 12px/1.3 ui-monospace, Menlo, monospace; border: 1px solid #d1d5db; border-radius: 6px; padding: 6px; resize: vertical; }
.row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.msg { padding: 6px 8px; border-radius: 6px; background: #eef2ff; color: #3730a3; }
.msg.ok { background: #ecfdf5; color: #065f46; }
.msg.warn { background: #fffbeb; color: #92400e; }
.msg.error { background: #fef2f2; color: #991b1b; }
.muted { color: #6b7280; font-size: 12px; }
.day { font-weight: 600; margin-top: 4px; }
.it { border: 1px solid #e5e7eb; border-radius: 8px; padding: 6px 8px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; }
.it.created { background: #f0fdf4; border-color: #bbf7d0; }
.it.active { border-color: #f59e0b; box-shadow: 0 0 0 2px rgba(245,158,11,.25); }
.it.skipped { opacity: .55; }
.it .top { display: flex; gap: 6px; align-items: center; }
.it .lab { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: 11px; padding: 1px 6px; border-radius: 999px; background: #e5e7eb; color: #374151; white-space: nowrap; }
.badge.created { background: #d1fae5; color: #065f46; }
.badge.active { background: #fef3c7; color: #92400e; }
.notes { margin: 0; padding-left: 18px; color: #92400e; font-size: 12px; }
`

  let host = null
  let ui = null
  let confirmClear = false
  let lastPanelHtml = null
  function buildPanel() {
    if (host) return
    host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute(OWN, 'panel')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${PANEL_CSS}</style><div class="p" hidden><div class="hd"><b>Foglalástervező – import <span class="muted">${VERSION}</span></b><span class="muted" data-count></span><button class="sm" data-act="close" title="Bezárás">✕</button></div><div class="bd" data-body></div></div>`
    ui = { root, panel: root.querySelector('.p'), body: root.querySelector('[data-body]'), count: root.querySelector('[data-count]') }
    root.addEventListener('click', onPanelClick)
    root.addEventListener('change', onPanelChange)
    root.addEventListener('paste', (e) => {
      const t = e.target
      if (!(t instanceof HTMLTextAreaElement)) return
      const text = (e.clipboardData && e.clipboardData.getData('text')) || ''
      if (!text) return
      e.preventDefault()
      importText(text)
    })
    document.documentElement.appendChild(host)
  }
  function importText(text) {
    const { bookings, errors } = parsePackages(text)
    if (!bookings.length) return setMessage(errors[0] || 'Nincs beilleszthető foglalás.', 'error')
    const { added, updated } = addBookings(bookings)
    S.panelOpen = true
    save()
    buildPanel()
    setMessage(`${added} új foglalás a listán${updated ? `, ${updated} frissítve` : ''}${errors.length ? ` (${errors.length} hibás kimaradt)` : ''}.`, errors.length ? 'warn' : 'ok')
    scheduleGhosts()
  }

  const TYPE_LABEL = { 'Single student': 'egynövendékes', 'Multi student': 'többnövendékes', 'Ground lesson': 'ground training', 'Extra theory': 'extra theory', Meeting: 'meeting' }
  const STATUS_LABEL = { pending: 'vár', active: 'kitöltés', created: 'mentve', skipped: 'kihagyva' }
  const dayLabel = (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    const names = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat']
    return `${y}. ${pad(m)}. ${pad(d)}., ${names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}`
  }

  function render() {
    if (!ui) return
    ui.panel.hidden = !S.panelOpen
    const items = S.items
    const pending = items.filter((x) => x.selected && x.status === 'pending').length
    const created = items.filter((x) => x.status === 'created').length
    ui.count.textContent = items.length ? `${created}/${items.length} mentve` : ''
    if (!S.panelOpen) return scheduleGhosts()
    const shown = displayedDate()
    let html = ''
    html += `<textarea data-paste placeholder="Illeszd be ide a Foglalástervezőből másolt csomagot (Cmd+V / Ctrl+V)"></textarea>`
    html += `<div class="row"><button data-act="paste">Beillesztés a vágólapról</button>`
    html += run.active
      ? `<button data-act="stop">Megállítás</button>`
      : `<button class="pri" data-act="start" ${pending ? '' : 'disabled'}>Foglalás megkezdése${pending ? ` (${pending})` : ''}</button>`
    html += `</div>`
    if (run.message) html += `<div class="msg ${esc(run.messageKind)}">${esc(run.message)}</div>`
    if (!items.length) html += `<p class="muted">A lista üres. A Foglalástervező Rögzítési listáján „FlightLoggerbe” vagy „Mind a FlightLoggerbe”, majd illeszd be ide.</p>`
    let lastDay = null
    items.forEach((it, i) => {
      const d = it.data
      if (d.date !== lastDay) {
        lastDay = d.date
        html += `<div class="day">${esc(dayLabel(d.date))}${d.date === shown ? ' <span class="muted">(látható a naptárban)</span>' : ''}</div>`
      }
      const time = `${d.times.briefing ? d.times.briefing.time : d.times.start.time}–${d.times.debriefing ? d.times.debriefing.time : d.times.end.time}`
      html += `<div class="it ${esc(it.status)}"><div class="top">`
      html += `<input type="checkbox" data-sel="${i}" ${it.selected ? 'checked' : ''} ${it.status === 'created' ? 'disabled' : ''} title="A futás ezt is kitölti">`
      html += `<span class="lab" title="${esc(d.label)}"><b>${esc(time)}</b> ${esc(d.label)}</span>`
      const doneLabel = d.cancel ? 'lemondva' : d.update ? 'átírva' : null
      html += `<span class="badge ${esc(it.status)}">${esc(doneLabel && it.status === 'created' ? doneLabel : STATUS_LABEL[it.status] || it.status)}</span></div>`
      const old = d.update || d.cancel
      const where = old ? `${esc(dayLabel(old.from.date).split(',')[0])} ${esc(old.from.start)}–${esc(old.from.end)}` : ''
      const move = d.cancel ? `<b style="color:#b91c1c">lemondás</b> (${where}) · ` : d.update ? `${d.update.full ? 'átírás, növendékekkel' : 'áthelyezés'} (most: ${where}) · ` : ''
      const act = d.cancel ? ['Lemondás', 'Csak ezt nyitja meg lemondásra'] : d.update ? ['Átírás', 'Csak ezt írja át most'] : ['Kitöltés', 'Csak ezt tölti ki most']
      html += `<div class="row muted">${move}${esc(TYPE_LABEL[d.flType] || d.flType)}`
      if (it.status !== 'created' && !run.active) html += ` · <button class="sm" data-act="one" data-i="${i}" title="${act[1]}">${act[0]}</button>`
      if (it.status === 'pending' || it.status === 'skipped') html += `<button class="sm" data-act="done" data-i="${i}" title="Kézzel már elintéztem a FlightLoggerben">${d.cancel ? 'Lemondtam' : d.update ? 'Átírtam' : 'Felvittem'}</button>`
      if (it.status === 'pending') html += `<button class="sm" data-act="skip" data-i="${i}" title="Nem viszem fel">Kihagyás</button>`
      if (it.status === 'created' || it.status === 'skipped') html += `<button class="sm" data-act="undo" data-i="${i}" title="Vissza a várakozók közé">Vissza</button>`
      if (it.status !== 'active') html += `<button class="sm warn" data-act="remove" data-i="${i}" title="Levétel a listáról">✕</button>`
      html += `</div>`
      if (it.notes && it.notes.length) html += `<ul class="notes">${it.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`
      html += `</div>`
    })
    if (items.length) {
      html += `<div class="row"><button data-act="receipt" ${created || items.some((x) => x.status === 'skipped') ? '' : 'disabled'}>Visszaigazolás másolása</button><button class="warn" data-act="clear">Lista törlése</button></div>`
      if (confirmClear) html += `<div class="msg warn">Törlöd a teljes listát? A még be nem olvasott visszaigazolás is elvész – előbb másold ki, ha kell.<div class="row" style="margin-top:6px"><button class="warn" data-act="clear-yes">Igen, törlöm</button><button data-act="clear-no">Mégse</button></div></div>`
      html += `<p class="muted">A mentést mindig te nyomod meg; a szkript csak kitölti az ablakot. FlightLogger-import ${VERSION}</p>`
    }
    if (html !== lastPanelHtml || !ui.body.firstChild) {
      // A beillesztőmező tartalma (gépelés közben) ne vesszen el újrarajzoláskor.
      const area = ui.body.querySelector('[data-paste]')
      const draft = area ? area.value : ''
      ui.body.innerHTML = html
      lastPanelHtml = html
      if (draft) ui.body.querySelector('[data-paste]').value = draft
    }
    scheduleGhosts()
  }

  async function onPanelClick(e) {
    const btn = e.target instanceof Element ? e.target.closest('[data-act]') : null
    if (!btn) return
    const act = btn.getAttribute('data-act')
    const i = Number(btn.getAttribute('data-i'))
    const it = Number.isInteger(i) ? S.items[i] : null
    if (act === 'close') {
      S.panelOpen = false
      save()
      render()
    } else if (act === 'paste') {
      try {
        importText(await navigator.clipboard.readText())
      } catch {
        setMessage('A böngésző nem engedte a vágólap olvasását: kattints a szövegmezőbe, és Cmd+V / Ctrl+V.', 'warn')
      }
    } else if (act === 'start') start()
    else if (act === 'stop') stop()
    else if (act === 'one' && it) {
      for (const x of S.items) if (x.status === 'pending') x.selected = x === it
      if (it.status === 'skipped') it.status = 'pending'
      it.selected = true
      save()
      start()
    } else if (act === 'done' && it) {
      it.status = 'created'
      it.at = new Date().toISOString()
      it.notes = ['Kézzel felvittnek jelölve.']
      save()
      void copyReceipt(true)
      render()
    } else if (act === 'skip' && it) {
      it.status = 'skipped'
      it.notes = []
      it.at = new Date().toISOString()
      save()
      render()
    } else if (act === 'undo' && it) {
      it.status = 'pending'
      it.notes = []
      delete it.at
      save()
      render()
    } else if (act === 'remove' && it) {
      S.items.splice(i, 1)
      save()
      render()
    } else if (act === 'receipt') void copyReceipt(false)
    else if (act === 'clear') {
      confirmClear = true
      render()
    } else if (act === 'clear-no') {
      confirmClear = false
      render()
    } else if (act === 'clear-yes') {
      confirmClear = false
      if (run.active) stop()
      S.items = []
      run.message = ''
      save()
      render()
    }
  }
  function onPanelChange(e) {
    const t = e.target
    if (!(t instanceof HTMLInputElement) || !t.hasAttribute('data-sel')) return
    const it = S.items[Number(t.getAttribute('data-sel'))]
    if (it) {
      it.selected = t.checked
      save()
      render()
    }
  }

  /** Az „Import” gomb a foglalási eszközsorban, a „Create booking” mellett. */
  function ensureImportButton() {
    const create = createButton()
    const existing = document.querySelector(`button[${OWN}="import"]`)
    if (!create) {
      if (existing) existing.remove()
      return
    }
    if (existing && existing.isConnected) return
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = create.className
    btn.setAttribute(OWN, 'import')
    btn.title = 'Foglalástervező-import: beillesztés és kitöltés'
    btn.textContent = 'Import'
    btn.style.cssText = 'width:auto;padding:0 10px;font-weight:600;font-size:13px;'
    btn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      buildPanel()
      S.panelOpen = !S.panelOpen
      save()
      render()
    })
    create.insertAdjacentElement('afterend', btn)
  }

  // ------------------------------------------------------------------ indulás

  function tick() {
    if (!createButton()) {
      removeGhosts()
      if (ui) ui.panel.hidden = true
      return
    }
    ensureImportButton()
    if (S.panelOpen) {
      buildPanel()
      if (ui.panel.hidden) render()
    }
    scheduleGhosts()
  }
  let moTimer = null
  // A saját elemeink (előnézet, felső sor, panel) változása nem indít újrarajzolást.
  const ownNode = (n) => (n.nodeType === 1 ? n.hasAttribute(OWN) || isOwn(n) : !!(n.parentElement && isOwn(n.parentElement)))
  const ownRecord = (r) => {
    if (isOwn(r.target)) return true
    const nodes = [...r.addedNodes, ...r.removedNodes]
    return nodes.length > 0 && nodes.every(ownNode)
  }
  const observer = new MutationObserver((records) => {
    if (records.every(ownRecord)) return
    if (moTimer) return
    moTimer = setTimeout(() => {
      moTimer = null
      tick()
    }, 250)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  // Görgetésnél a sorokba tett előnézet magától együtt mozog; csak a méretváltás kér újrarajzolást.
  window.addEventListener('resize', scheduleGhosts)
  const onStorage = (e) => {
    if (e.key !== KEY || run.active) return
    S = loadState()
    render()
  }
  window.addEventListener('storage', onStorage)
  const interval = setInterval(scheduleGhosts, 2000)
  tick()

  /** Leállítás, ha egy újabb verzió veszi át a helyét: figyelők le, saját elemek ki az oldalról. */
  function dispose() {
    run.active = false
    observer.disconnect()
    clearInterval(interval)
    window.removeEventListener('resize', scheduleGhosts)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('click', onCreateClick, true)
    document.removeEventListener('click', onTopClick, true)
    document.removeEventListener('keydown', onKey)
    removeGhosts()
    for (const el of document.querySelectorAll(`#${HOST_ID}, button[${OWN}="import"], style[${OWN}="stilus"]`)) el.remove()
    host = null
    ui = null
    if (window.flightbookerImport === api) delete window.flightbookerImport
  }

  // Teszteléshez a konzolból.
  const api = { version: VERSION, get state() { return S }, run, parsePackages, importText, displayedDate, drawGhosts, start, stop, receiptText, textScore, dispose }
  window.flightbookerImport = api
})()
