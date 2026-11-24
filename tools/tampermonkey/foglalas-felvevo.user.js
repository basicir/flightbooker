// ==UserScript==
// @name         Foglalástervező – FlightLogger felvevő
// @namespace    flightbooker
// @version      0.2.1
// @description  Fejlesztői felvevő a FlightLogger foglalási felületének feltérképezéséhez: naplózza a kattintásokat és a hatásukat, pillanatképet ment az oldalakról és ablakokról (szerkezet, képernyőkép), és térképet készít. Csak figyel: nem kattint, nem tölt ki semmit, hálózatot nem használ.
// @match        https://trener.flightlogger.net/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

/*
 * MIRE VALÓ
 *   A FlightLogger-import (Tampermonkey-alapú foglalásfelvitel) fejlesztéséhez fel kell térképezni
 *   a FlightLogger foglalási felületét: mire kattintva milyen ablak nyílik, milyen mezők vannak
 *   benne, hogyan viselkednek a választómezők, mi történik napváltáskor. Ez a szkript ezt rögzíti.
 *
 * TELEPÍTÉS
 *   Tampermonkey → Új szkript → a tartalmat cseréld erre a fájlra → Mentés.
 *   Csak a https://trener.flightlogger.net/ oldalain fut. Bal alul megjelenik a „FL felvevő” panel.
 *
 * HASZNÁLAT
 *   1. Nyisd meg a foglalási áttekintőt (Bookings → Overview).
 *   2. „Képernyő-megosztás” → a böngésző kérdésére oszd meg EZT a lapot. (Nem kötelező, de így
 *      képernyőkép is készül. Teljes újratöltés után újra kell indítani.)
 *   3. „Felvétel indítása”, majd használd a felületet úgy, ahogy foglalást vinnél fel: válts napot,
 *      nyisd meg a foglalási ablakot minden foglalástípussal (repülés, meeting, ground theory,
 *      extra theory …), nyisd le a választómezőket, töltsd ki a mezőket. A „Megjegyzés” gombbal
 *      (Alt+Shift+M) írd le, mit csinálsz és mit vársz – ez sokat segít az értelmezésben.
 *      A mentést csak akkor nyomd meg, ha valódi (vagy utána törölt) foglalást akarsz felvinni.
 *   4. „Export (ZIP)” → a letöltött ZIP-et tedd a projekt tests/local/fl-felvetel/ mappájába.
 *   Gyorsbillentyűk: Alt+Shift+P pillanatkép, Alt+Shift+M megjegyzés, Alt+Shift+R indítás/szünet.
 *
 * MIT RÖGZÍT
 *   Kattintás, húzás, mezőérték-változás, űrlapküldés, speciális billentyűk (Enter, Esc, Tab,
 *   nyilak) – a cél elem leírásával (szelektor, szöveg, táblázatbeli sor/oszlop, eseménykezelők).
 *   A kattintás hatását: megnyílt/bezárult ablak, URL-váltás, az oldal saját hálózati kérései
 *   (csak cím, állapot, időtartam – a Performance API-ból), Turbo/Rails/jQuery események, DOM-változás.
 *   Pillanatképet (HTML + szerkezeti összefoglaló + CSS) betöltéskor, nagy változáskor, ablak
 *   megnyílásakor és változásakor; képernyőképet a megosztott lapról.
 *
 * ADATVÉDELEM (CLAUDE.md 4. pont)
 *   Minden a böngészőben marad (IndexedDB), a szkript nem küld semmit sehova; a ZIP a gépedre
 *   töltődik le, és a gitignore-olt tests/local/ mappába való.
 *   E-mail-cím és telefonszám mindig maszkolva. A neveket a felvevő a személyválasztó mezőkből
 *   (növendék, oktató …) gyűjti, és álnévre cseréli („Személy-07”) a szövegekben és a
 *   képernyőképeken is; a névlistát a panelen átnézheted és bővítheted. Megjegyzés jellegű
 *   szöveget, gépelt keresőszöveget nem ment, jelszót, CSRF-tokent, sütit, fejlécet soha.
 *   A maszkolás heurisztikus: exportálás előtt érdemes egy-két képernyőképet átnézni.
 */
;(function () {
  'use strict'
  if (window.top !== window || window.flightbookerFelvevo) return

  // ------------------------------------------------------------------ alapok

  const VERSION = '0.2.1'
  const KEY_STATE = 'fb-felvevo:allapot'
  const KEY_COUNTS = 'fb-felvevo:szamlalo'
  const KEY_TAB = 'fb-felvevo:ful'
  const KEY_LASTCLICK = 'fb-felvevo:utolso-kattintas'
  const KEY_QUEUE = 'fb-felvevo:varolista'
  const DB_NAME = 'fb-felvevo'
  const HOST_ID = 'fb-felvevo-panel'
  const OWN_ATTR = 'data-fb-felvevo'
  const MAX_SHOT_WIDTH = 1920
  const EFFECT_WINDOW_MS = 2500

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim()
  const clip = (s, n = 120) => {
    const t = String(s == null ? '' : s)
    return t.length > n ? t.slice(0, n - 1) + '…' : t
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const pad = (n, w = 4) => String(n).padStart(w, '0')
  const escText = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  const escAttr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  const slug = (s) =>
    clean(s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'x'
  const safe = (fn) => {
    try {
      return fn()
    } catch {
      return undefined
    }
  }
  const fmtBytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`)
  const rafs = (n) =>
    new Promise((resolve) => {
      let i = 0
      const step = () => (++i >= n ? resolve() : requestAnimationFrame(step))
      requestAnimationFrame(step)
    })
  function hashString(s) {
    let h = 0x811c9dc5
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 0x01000193)
    }
    return (h >>> 0).toString(16).padStart(8, '0') + s.length.toString(36)
  }

  // ------------------------------------------------------------------ állapot

  const DEFAULT_SETTINGS = { shotAfterClick: true, pseudonymize: true }
  function freshState() {
    return {
      recording: false,
      session: null,
      startedAt: null,
      settings: { ...DEFAULT_SETTINGS },
      names: { entries: [], excluded: [], next: 1 },
      panel: { collapsed: false, left: null, top: null },
    }
  }
  function readState() {
    const base = freshState()
    try {
      const raw = JSON.parse(localStorage.getItem(KEY_STATE) || 'null')
      if (raw && typeof raw === 'object') {
        return {
          ...base,
          ...raw,
          settings: { ...base.settings, ...(raw.settings || {}) },
          names: { ...base.names, ...(raw.names || {}) },
          panel: { ...base.panel, ...(raw.panel || {}) },
        }
      }
    } catch {
      /* sérült állapot: tiszta lappal indulunk */
    }
    return base
  }
  let state = readState()
  function saveState() {
    try {
      localStorage.setItem(KEY_STATE, JSON.stringify(state))
    } catch (err) {
      showMessage('Az állapot mentése nem sikerült: ' + err.message, true)
    }
  }

  const emptyCounts = () => ({ session: state.session, events: 0, snapshots: 0, shots: 0, bytes: 0 })
  function readCounts() {
    try {
      const c = JSON.parse(localStorage.getItem(KEY_COUNTS) || 'null')
      if (c && c.session === state.session) return c
    } catch {
      /* újraszámolás nélkül nullázunk */
    }
    return emptyCounts()
  }
  let counts = readCounts()
  function bump(field, by = 1) {
    if (counts.session !== state.session) counts = emptyCounts()
    counts[field] += by
    try {
      localStorage.setItem(KEY_COUNTS, JSON.stringify(counts))
    } catch {
      /* a számláló csak tájékoztató */
    }
    schedulePanelUpdate()
  }

  const tabId = (() => {
    try {
      let id = sessionStorage.getItem(KEY_TAB)
      if (!id) {
        id = Math.random().toString(36).slice(2, 7)
        sessionStorage.setItem(KEY_TAB, id)
      }
      return id
    } catch {
      return 'x'
    }
  })()

  // ------------------------------------------------------------------ maszkolás

  const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu
  const PHONE_RE = /(?:\+\d{1,3}[\s/-]?|\b06[\s/-]?)\(?\d{1,3}\)?[\s/-]?\d{3}[\s/-]?\d{3,4}\b/g
  const COMMENT_LINE_RE = /\b(?:comments?|megjegyz[ée]s|notes?|remarks?)\s*[:：]\s*([^\n<"\\]{3,})/giu
  const NAME_WORD_RE = /\p{L}+(?:['’-]\p{L}+)*/gu
  // A FlightLogger személyválasztói „KÓD - Keresztnév Vezetéknév” alakban írják ki az embereket
  // (pl. „ABCD - Minta Anna”, „12_XYZ - Teszt Elek”): ezt a mintát a névlistától függetlenül is takarjuk.
  const PERSON_CODE_RE = /(?<![\p{Lu}\p{N}_])([0-9A-Z][0-9A-Z_]{1,9}) - (\p{Lu}\p{Ll}+(?:[ -]\p{Lu}\p{Ll}+){1,3})/gu
  const PERSON_LINE_RE = /^([0-9A-Z][0-9A-Z_]{1,9}) - (.+)$/u
  const CAP_WORD = /^\p{Lu}\p{Ll}+(?:['’-]\p{Lu}?\p{Ll}+)*$/u
  const SECRET_NAME = /csrf|authenticity|token|passw|secret|api[_-]?key|session|otp|2fa/i
  const SEARCH_KEY = /^(q|query|search|term|keyword|text|name|email|phone)$|search|query/i
  const COMMENT_HINT = /comment|note|remark|megjegyz|descript|message|üzenet/i
  const PERSON_HINT =
    /student|instructor|pilot|teacher|trainee|person|people|member|customer|renter|crew|passenger|participant|attendee|examiner|user|tanul|oktat|pilóta|személy|résztvev|vizsgáz|növend/i
  const NOT_NAME_WORDS = new Set(
    (
      'lesson theory flight check booking meeting exam test simulator sim maintenance briefing debriefing ground extra school ' +
      'class room aircraft rental other all none select new type course program phase progress solo dual cross country night ' +
      'training general standard private public default unknown vfr ifr ppl cpl atpl fi cri ir me se hour hours day week month ' +
      'today tomorrow yes no and or of the for to in on at with office admin staff instructor student pilot group team block ' +
      'unavailable available off leave holiday vacation sick theory elmélet repülés óra foglalás vizsga gyakorlat terem osztály ' +
      'tanfolyam egyéb nincs mind válassz új oktató növendék'
    ).split(' '),
  )

  /** Névindex: első szó → az ehhez tartozó szósorozatok (a szórend-változatokkal), leghosszabb elöl. */
  let nameIndex = new Map()
  const nameKey = (s) => clean(s).toLowerCase()
  const wordsOf = (s) => (String(s).toLowerCase().match(NAME_WORD_RE) || [])
  function nameSequences(name) {
    const w = wordsOf(name)
    if (!w.length) return []
    const seqs = [w]
    if (w.length >= 2) {
      seqs.push([...w.slice(1), w[0]])
      seqs.push([w[w.length - 1], ...w.slice(0, -1)])
    }
    return seqs
  }
  let aliasByCode = new Map()
  let aliasByName = new Map()
  let codeRe = null
  function rebuildNames() {
    nameIndex = new Map()
    aliasByCode = new Map()
    aliasByName = new Map()
    for (const e of state.names.entries) {
      aliasByName.set(nameKey(e.name), e.alias)
      if (e.code) aliasByCode.set(e.code, e.alias)
    }
    // A kód önmagában is azonosít; csak a jellegzetes (legalább 3 karakteres) kódokat takarjuk, és csak
    // önálló szóként (egy „gqhVAL” osztálynévben lévő „VAL” nem kód).
    const codes = [...aliasByCode.keys()].filter((c) => c.length >= 3).sort((a, b) => b.length - a.length)
    codeRe = codes.length ? new RegExp(`(?<![A-Za-z0-9_])(?:${codes.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![A-Za-z0-9_])`, 'g') : null
    for (const e of state.names.entries) {
      for (const seq of nameSequences(e.name)) {
        const list = nameIndex.get(seq[0]) || []
        const key = seq.join(' ')
        if (!list.some((x) => x.key === key)) list.push({ key, words: seq, alias: e.alias })
        nameIndex.set(seq[0], list)
      }
    }
    for (const list of nameIndex.values()) list.sort((a, b) => b.words.length - a.words.length)
  }

  /** Érzékeny szakaszok egy szövegben: [kezdet, vég, helyettesítő]. */
  function sensitiveRanges(s) {
    const out = []
    if (s.indexOf('@') >= 0) for (const m of s.matchAll(EMAIL_RE)) out.push([m.index, m.index + m[0].length, '[e-mail]'])
    for (const m of s.matchAll(PHONE_RE)) out.push([m.index, m.index + m[0].length, '[telefon]'])
    for (const m of s.matchAll(COMMENT_LINE_RE)) {
      const end = m.index + m[0].length
      out.push([end - m[1].length, end, '[megjegyzés]'])
    }
    for (const m of s.matchAll(PERSON_CODE_RE)) {
      const alias = state.settings.pseudonymize ? aliasByCode.get(m[1]) || aliasByName.get(nameKey(m[2])) || '[név]' : null
      if (alias) out.push([m.index, m.index + m[0].length, alias])
    }
    if (state.settings.pseudonymize && codeRe) for (const m of s.matchAll(codeRe)) out.push([m.index, m.index + m[0].length, aliasByCode.get(m[0])])
    if (state.settings.pseudonymize && nameIndex.size) {
      const tokens = []
      for (const m of s.matchAll(NAME_WORD_RE)) tokens.push({ w: m[0].toLowerCase(), start: m.index, end: m.index + m[0].length })
      for (let i = 0; i < tokens.length; i++) {
        const cands = nameIndex.get(tokens[i].w)
        if (!cands) continue
        for (const c of cands) {
          const n = c.words.length
          if (i + n > tokens.length) continue
          let ok = true
          for (let j = 1; j < n && ok; j++) {
            if (tokens[i + j].w !== c.words[j]) ok = false
            else if (!/^[\s,]{1,3}$/.test(s.slice(tokens[i + j - 1].end, tokens[i + j].start))) ok = false
          }
          if (ok) {
            out.push([tokens[i].start, tokens[i + n - 1].end, c.alias])
            i += n - 1
            break
          }
        }
      }
    }
    if (out.length < 2) return out
    out.sort((a, b) => a[0] - b[0] || b[1] - a[1])
    const merged = []
    for (const r of out) if (!merged.length || r[0] >= merged[merged.length - 1][1]) merged.push(r)
    return merged
  }
  function mask(value) {
    if (value == null) return value
    const s = String(value)
    if (!s) return s
    const ranges = sensitiveRanges(s)
    if (!ranges.length) return s
    let out = ''
    let pos = 0
    for (const [a, b, label] of ranges) {
      out += s.slice(pos, a) + label
      pos = b
    }
    return out + s.slice(pos)
  }
  function deepMask(v) {
    if (typeof v === 'string') return mask(v)
    if (Array.isArray(v)) return v.map(deepMask)
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v)) o[k] = deepMask(v[k])
      return o
    }
    return v
  }
  function commentHintAround(el) {
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
      const cls = typeof n.className === 'string' ? n.className : ''
      if (COMMENT_HINT.test(cls) || COMMENT_HINT.test(n.id || '') || COMMENT_HINT.test(n.getAttribute('name') || '')) return true
    }
    return false
  }
  function maskText(t, parent) {
    const trimmed = t.trim()
    if (trimmed.length >= 25 && parent && commentHintAround(parent)) return `[szöveg, ${trimmed.length} kar.]`
    return mask(t)
  }
  /** Mezőérték a naplóba: dátum/idő/szám/azonosító marad, szabad szöveg csak hosszként. */
  function maskFieldValue(el, value) {
    if (value == null || value === '') return value
    const v = String(value)
    const type = String(el.getAttribute('type') || el.type || '').toLowerCase()
    const hint = `${el.getAttribute('name') || ''} ${el.id || ''}`
    if (type === 'password') return '[jelszó]'
    if (SECRET_NAME.test(hint)) return '[titok]'
    if (el.tagName === 'SELECT') return v
    if (/^(date|time|datetime-local|month|week|number|range|color|checkbox|radio|submit|button|reset)$/.test(type)) return mask(v)
    if (/^[\d\s.:/T+,Z-]{1,40}$/.test(v)) return v
    if (type === 'hidden') return clip(mask(v), 200)
    if (el.tagName === 'TEXTAREA' || COMMENT_HINT.test(hint)) return `[szöveg, ${v.length} kar.]`
    if (type === 'search' || el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) return `[keresett szöveg, ${v.length} kar.]`
    const masked = mask(v)
    return masked.length <= 40 ? masked : `[szöveg, ${v.length} kar.]`
  }
  function safeDecode(s) {
    try {
      return decodeURI(s)
    } catch {
      return s
    }
  }
  function maskUrl(u, absolute) {
    if (!u) return u
    try {
      const url = new URL(String(u), location.href)
      if (url.protocol === 'data:') return 'data:…'
      if (url.protocol === 'blob:') return 'blob:…'
      if (url.protocol === 'javascript:') return clip(mask(String(u)), 200)
      for (const k of [...new Set(url.searchParams.keys())]) {
        if (SECRET_NAME.test(k)) url.searchParams.set(k, '[titok]')
        else if (SEARCH_KEY.test(k)) url.searchParams.set(k, '[keresés]')
      }
      const s = absolute || url.origin !== location.origin ? url.href : url.pathname + url.search + url.hash
      return mask(safeDecode(s))
    } catch {
      return clip(mask(String(u)), 300)
    }
  }
  function viewKey(u) {
    try {
      const url = new URL(u || location.href, location.href)
      const path = url.pathname
        .split('/')
        .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f-]{20,}$/i.test(seg) ? ':id' : /^\d{4}-\d{2}-\d{2}$/.test(seg) ? ':datum' : seg))
        .join('/')
      const keys = [...new Set(url.searchParams.keys())].sort()
      return (url.origin !== location.origin ? url.host : '') + path + (keys.length ? `?${keys.join('&')}` : '')
    } catch {
      return String(u)
    }
  }

  // ------------------------------------------------------------------ névgyűjtés

  function looksLikeName(text) {
    let t = clean(text)
    const coded = PERSON_LINE_RE.exec(t)
    if (coded) t = coded[2]
    if (t.length < 5 || t.length > 60) return false
    if (/[\d@()[\]{}:;!?#&*+=|<>"/\\]/.test(t)) return false
    const words = t
      .replace(/,/g, ' ')
      .split(' ')
      .filter((w) => w && !/^(dr|ifj|id|özv|prof)\.?$/i.test(w))
    if (words.length < 2 || words.length > 4) return false
    if (!words.every((w) => CAP_WORD.test(w) || /^\p{Lu}\.$/u.test(w))) return false
    if (words.filter((w) => !w.endsWith('.')).length < 2) return false
    return !words.some((w) => NOT_NAME_WORDS.has(w.toLowerCase().replace(/\.$/, '')))
  }
  function labelText(el) {
    try {
      if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.textContent).join(' '))
      const by = el.getAttribute('aria-labelledby')
      if (by) return clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '))
      const l = el.closest('label')
      if (l) return clean(l.textContent)
      // Címke for nélkül: a mezőt tartalmazó lista- vagy űrlapsor saját címkéje (FlightLogger: li > label).
      const wrap = el.closest('li, .form-group, .field, .control-group, [class*="field"]')
      if (wrap) {
        const own = [...wrap.querySelectorAll('label, legend')].find((x) => !x.contains(el) && clean(x.textContent))
        if (own) return clean(own.textContent)
      }
    } catch {
      /* címke nélkül */
    }
    return ''
  }
  function fieldHint(el) {
    const parts = [
      el.getAttribute('name'),
      el.id,
      el.getAttribute('aria-label'),
      el.getAttribute('placeholder'),
      el.getAttribute('data-placeholder'),
      typeof el.className === 'string' ? el.className : '',
      labelText(el),
    ]
    const wrap = el.closest('.form-group, .field, .control-group, .form-row, fieldset, [class*="field"]')
    if (wrap) {
      const l = wrap.querySelector('label, legend, .label')
      if (l) parts.push(l.textContent)
    }
    return clean(parts.filter(Boolean).join(' ')).slice(0, 400)
  }
  /** Személynevek gyűjtése a személyválasztókból és a személyoszlopokból az álnevesítéshez. */
  function harvestNames(root) {
    const scope = root || document
    const found = []
    const consider = (texts, hinted) => {
      const named = texts.filter(looksLikeName)
      if (!named.length) return
      if (hinted || (texts.length >= 4 && named.length / texts.length >= 0.8)) found.push(...named)
    }
    try {
      // „KÓD - Név” alakú személyek bárhol a szövegben (legördülők, naptárblokkok, címek).
      const text = scope === document ? (document.body ? document.body.textContent : '') : scope.textContent
      for (const m of (text || '').matchAll(PERSON_CODE_RE)) found.push(`${m[1]} - ${m[2]}`)
      for (const sel of scope.querySelectorAll('select')) {
        const texts = [...sel.options].filter((o) => o.value !== '').map((o) => clean(o.text))
        if (texts.length) consider(texts, PERSON_HINT.test(fieldHint(sel)))
      }
      const lists = scope.querySelectorAll('[role="listbox"], .select2-results__options, .ts-dropdown-content, .choices__list--dropdown, datalist, .ui-autocomplete')
      for (const list of lists) {
        const items = list.querySelectorAll('[role="option"], li, .option, option, .choices__item')
        const texts = [...items].map((o) => clean(o.tagName === 'OPTION' ? o.label || o.value : o.textContent))
        if (texts.length) consider(texts, false)
      }
      for (const table of scope.querySelectorAll('table')) {
        const head = (table.tHead && table.tHead.rows[0]) || [...table.rows].find((r) => r.querySelector('th'))
        if (!head) continue
        const cols = []
        let col = 0
        for (const c of head.cells) {
          if (PERSON_HINT.test(c.textContent)) cols.push(col)
          col += c.colSpan || 1
        }
        if (!cols.length) continue
        for (const row of [...table.rows].slice(0, 500)) {
          if (row === head) continue
          let ci = 0
          for (const c of row.cells) {
            if (cols.includes(ci)) {
              const t = textOf(c)
              if (looksLikeName(t)) found.push(t)
            }
            ci += c.colSpan || 1
          }
        }
      }
    } catch (err) {
      noteError('névgyűjtés', err)
    }
    return addNames(found, 'auto')
  }
  function addNames(list, source) {
    const known = new Set()
    for (const e of state.names.entries) for (const seq of nameSequences(e.name)) known.add(seq.join(' '))
    const excluded = new Set(state.names.excluded)
    let added = 0
    for (const raw of list) {
      const line = clean(raw)
      const coded = PERSON_LINE_RE.exec(line)
      const name = coded ? clean(coded[2]) : line
      const code = coded ? coded[1] : undefined
      const key = wordsOf(name).join(' ')
      if (!key || excluded.has(nameKey(name)) || excluded.has(nameKey(line))) continue
      if (known.has(key)) {
        // Ismert név, most először kóddal: a kódot is megjegyezzük, hogy önmagában is takarjuk.
        const e = code && state.names.entries.find((x) => !x.code && nameKey(x.name) === nameKey(name))
        if (e) {
          e.code = code
          added++
        }
        continue
      }
      for (const seq of nameSequences(name)) known.add(seq.join(' '))
      state.names.entries.push({ name, code, alias: `Személy-${pad(state.names.next++, 3)}`, source })
      added++
    }
    if (added) {
      saveState()
      rebuildNames()
      schedulePanelUpdate()
    }
    return added
  }

  // ------------------------------------------------------------------ tároló (IndexedDB)

  let dbPromise = null
  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'seq', autoIncrement: true }).createIndex('session', 'session')
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs')
        }
        req.onsuccess = () => {
          const db = req.result
          // Ha egy másik lap törölni vagy frissíteni akarja az adatbázist, elengedjük, és a
          // következő íráskor újra megnyitjuk – különben mindkét lap várakozna.
          db.onversionchange = () => {
            db.close()
            dbPromise = null
          }
          resolve(db)
        }
        req.onerror = () => reject(req.error)
        req.onblocked = () => reject(new Error('A felvevő adatbázisa foglalt (másik lap?).'))
        setTimeout(() => reject(new Error('A felvevő adatbázisa nem nyílik meg – zárd be a FlightLogger többi lapját, és töltsd újra ezt.')), 8000)
      }).catch((err) => {
        dbPromise = null
        showMessage(err.message, true)
        throw err
      })
    }
    return dbPromise
  }
  async function tx(storeName, mode, work) {
    const db = await openDb()
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode)
      let result
      const req = work(t.objectStore(storeName))
      if (req) req.onsuccess = () => (result = req.result)
      t.oncomplete = () => resolve(result)
      t.onerror = () => reject(t.error || new Error('IndexedDB-hiba'))
      t.onabort = () => reject(t.error || new Error('IndexedDB: megszakítva'))
    })
  }
  const blobKey = (path) => `${state.session}|${path}`
  const putBlob = (path, blob) => tx('blobs', 'readwrite', (s) => s.put(blob, blobKey(path)))
  const hasBlob = (path) => tx('blobs', 'readonly', (s) => s.getKey(blobKey(path)))
  const sessionEvents = (session) => tx('events', 'readonly', (s) => s.index('session').getAll(session))
  async function sessionBlobs(session) {
    const prefix = `${session}|`
    const range = IDBKeyRange.bound(prefix, prefix + '\uffff')
    const keys = await tx('blobs', 'readonly', (s) => s.getAllKeys(range))
    const values = await tx('blobs', 'readonly', (s) => s.getAll(range))
    const map = new Map()
    keys.forEach((k, i) => map.set(k.slice(prefix.length), values[i]))
    return map
  }

  // ------------------------------------------------------------------ naplózás

  let errorBudget = 40
  function noteError(where, err) {
    const message = (err && err.message) || String(err)
    console.warn('[FL felvevő]', where, err)
    if (errorBudget-- > 0 && state.recording) record('error', { where, message: clip(mask(message), 300) })
  }
  // Előre írt napló a lap munkamenet-tárában: ha a kattintás teljes oldalbetöltést indít, az
  // IndexedDB-írás félbeszakadhat; a következő oldal ebből pótolja (az export uid szerint szűr).
  function queueRead() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY_QUEUE) || '[]')
    } catch {
      return []
    }
  }
  function queueWrite(list) {
    try {
      if (list.length) sessionStorage.setItem(KEY_QUEUE, JSON.stringify(list.slice(-200)))
      else sessionStorage.removeItem(KEY_QUEUE)
    } catch {
      /* megtelt: csak a biztonsági másolat marad ki */
    }
  }
  function persistEvent(ev) {
    queueWrite([...queueRead(), ev])
    tx('events', 'readwrite', (s) => s.add(ev))
      .then(() => queueWrite(queueRead().filter((x) => x.uid !== ev.uid)))
      .catch((err) => {
        console.warn('[FL felvevő] mentési hiba', err)
        showMessage('Mentési hiba: ' + err.message, true)
      })
  }
  function flushQueue() {
    const left = queueRead()
    queueWrite([])
    for (const ev of left) if (ev.session === state.session) persistEvent(ev)
  }
  function record(type, data) {
    if (!state.recording || !state.session) return null
    const ev = { uid: uid(), session: state.session, tab: tabId, t: Date.now(), type, url: maskUrl(location.href), view: viewKey(), ...data }
    bump('events')
    persistEvent(ev)
    return ev
  }

  // ------------------------------------------------------------------ elemleírás

  const INTERACTIVE_SEL =
    'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="option"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="gridcell"], [onclick], [data-action], [data-toggle], [data-bs-toggle], [tabindex]:not([tabindex="-1"])'
  const BUTTON_SEL = 'button, input[type="submit"], input[type="button"], input[type="reset"], [role="button"], a.btn, a.button, [data-toggle], [data-bs-toggle]'
  const FIELD_SEL =
    'input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"], [role="spinbutton"], [role="switch"], [role="checkbox"], [role="radio"]'
  const UNSTABLE_CLASS = /^(active|hover|focus|focused|show|showing|open|opened|in|selected|disabled|is-|has-|ng-|css-|sc-|jsx-|svelte-)|\d{4,}/

  const classes = (el) => (el && el.classList ? [...el.classList].slice(0, 8) : [])
  /** Az elem szövege szóközzel a szövegcsomópontok között (a textContent a címkét és az értéket összefűzné). */
  function textOf(el, max = 400) {
    if (!el) return ''
    if (el.nodeType !== 1) return clean(el.textContent)
    let s = ''
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n && s.length < max; n = walker.nextNode()) {
      const p = n.parentElement
      if (p && (p.localName === 'script' || p.localName === 'style')) continue
      s += ' ' + n.nodeValue
    }
    return clean(s)
  }
  function rectOf(el) {
    const r = el.getBoundingClientRect()
    return r.width || r.height ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : undefined
  }
  function visibleEl(el) {
    if (typeof el.checkVisibility === 'function') return el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }
  function shortSel(el) {
    if (!el || el.nodeType !== 1) return el && el.nodeType === 9 ? 'document' : ''
    let s = el.localName
    if (el.id) s += '#' + el.id
    const cls = classes(el).slice(0, 3)
    if (cls.length) s += '.' + cls.join('.')
    const role = el.getAttribute('role')
    if (role) s += `[role=${role}]`
    const ctrl = el.getAttribute('data-controller')
    if (ctrl) s += `[data-controller=${ctrl}]`
    return clip(s, 120)
  }
  function cssPath(el, maxDepth = 6) {
    if (!el || el.nodeType !== 1) return ''
    const parts = []
    let n = el
    for (let depth = 0; n && n.nodeType === 1 && depth < maxDepth; depth++) {
      if (n === document.documentElement || n === document.body) {
        parts.unshift(n.localName)
        break
      }
      if (n.id && !/\d{3,}/.test(n.id)) {
        const sel = '#' + CSS.escape(n.id)
        if (safe(() => document.querySelectorAll(sel).length) === 1) {
          parts.unshift(sel)
          break
        }
      }
      let part = n.localName
      const cls = classes(n).filter((c) => !UNSTABLE_CLASS.test(c)).slice(0, 2)
      if (cls.length) part += cls.map((c) => '.' + CSS.escape(c)).join('')
      const parent = n.parentElement
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === n.localName)
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`
      }
      parts.unshift(part)
      n = n.parentElement
    }
    return parts.join(' > ')
  }
  function shapeOf(v, depth = 0) {
    if (depth > 5) return '…'
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0], depth + 1), `×${v.length}`] : []
    if (v && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v).slice(0, 60)) o[k] = shapeOf(v[k], depth + 1)
      return o
    }
    if (typeof v === 'string') return /^\d{4}-\d{2}-\d{2}/.test(v) ? `dátum: ${v.slice(0, 25)}` : `szöveg(${v.length})`
    return typeof v
  }
  function dataAttrs(el, max = 10) {
    const out = {}
    let n = 0
    for (const a of el.attributes || []) {
      if (!a.name.startsWith('data-') || a.name.startsWith('data-rec') || a.name === OWN_ATTR) continue
      out[a.name] = clip(mask(a.value), 200)
      if (++n >= max) break
    }
    return n ? out : undefined
  }
  function reactPropsOf(n) {
    try {
      for (const k of Object.keys(n)) if (k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$')) return n[k]
    } catch {
      /* nem React */
    }
    return null
  }
  function jqueryEventsOf(n) {
    const $ = window.jQuery
    if (!$ || !$._data) return null
    try {
      const ev = $._data(n, 'events')
      if (!ev) return null
      return Object.keys(ev).map((type) => {
        const del = ev[type].filter((h) => h.selector).map((h) => h.selector)
        return del.length ? `${type} (delegált: ${clip(del.join(' | '), 120)})` : type
      })
    } catch {
      return null
    }
  }
  function jqueryDelegatedFor(el) {
    const $ = window.jQuery
    if (!$ || !$._data) return null
    const out = []
    for (const hostNode of [document, document.body]) {
      const ev = safe(() => $._data(hostNode, 'events'))
      if (!ev) continue
      for (const type of Object.keys(ev)) {
        for (const h of ev[type]) {
          if (!h.selector) continue
          const m = safe(() => el.closest(h.selector))
          if (m) out.push({ on: hostNode === document ? 'document' : 'body', type, selector: clip(h.selector, 120), matched: shortSel(m) })
        }
      }
    }
    return out.length ? out.slice(0, 15) : null
  }
  /** Ki kezeli a kattintást? Inline, Stimulus, React és jQuery kezelők a céltól felfelé. */
  function handlerHints(el) {
    const hints = []
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 7; n = n.parentElement, i++) {
      const h = {}
      const inline = [...n.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${a.name}=${clip(a.value, 80)}`)
      if (inline.length) h.inline = inline
      const act = n.getAttribute('data-action')
      if (act) h.stimulus = clip(act, 200)
      const ctrl = n.getAttribute('data-controller')
      if (ctrl) h.controller = ctrl
      const rp = reactPropsOf(n)
      if (rp) {
        const keys = Object.keys(rp).filter((k) => /^on[A-Z]/.test(k))
        if (keys.length) h.react = keys
      }
      const jq = jqueryEventsOf(n)
      if (jq) h.jquery = jq
      if (Object.keys(h).length) hints.push({ depth: i, el: shortSel(n), ...h })
    }
    const delegated = jqueryDelegatedFor(el)
    if (delegated) hints.push({ jqueryDelegated: delegated })
    return hints.length ? hints : undefined
  }
  function basicInfo(el) {
    if (!el || el.nodeType !== 1) return null
    const tag = el.localName
    const d = { tag, selector: cssPath(el) }
    if (el.id) d.id = el.id
    const cls = classes(el)
    if (cls.length) d.cls = cls
    for (const a of ['role', 'name', 'type', 'href', 'aria-label', 'title', 'aria-expanded', 'aria-selected', 'aria-controls']) {
      const v = el.getAttribute(a)
      if (v == null) continue
      d[a === 'aria-label' ? 'aria' : a] = a === 'href' ? maskUrl(el.href || v) : clip(mask(v), 120)
    }
    const text = clip(mask(textOf(el)), 100)
    if (text) d.text = text
    if (/^(input|select|textarea|button)$/.test(tag) || el.getAttribute('role') === 'button') {
      const label = labelText(el)
      if (label && label !== textOf(el)) d.label = clip(mask(label), 80)
    }
    if (/^(input|select|textarea)$/.test(tag)) d.value = tag === 'select' ? clip(mask(clean((el.selectedOptions[0] || {}).text || '')), 80) : maskFieldValue(el, el.value)
    const data = dataAttrs(el, 12)
    if (data) d.data = data
    const icon = el.querySelector && el.querySelector(':scope > i, :scope > svg, :scope > span[class*="icon"]')
    if (icon) d.icon = shortSel(icon)
    d.rect = rectOf(el)
    return d
  }
  function visualCol(cell) {
    let col = 0
    for (let c = cell.previousElementSibling; c; c = c.previousElementSibling) col += c.colSpan || 1
    return col
  }
  function headerTextAt(table, col) {
    const head = (table.tHead && table.tHead.rows[table.tHead.rows.length - 1]) || [...table.rows].find((r) => r.querySelector('th'))
    if (!head) return ''
    let c = 0
    for (const cell of head.cells) {
      const span = cell.colSpan || 1
      if (col >= c && col < c + span) return clean(cell.textContent)
      c += span
    }
    return ''
  }
  function overlayOf(el) {
    let best = null
    for (const [ovEl, info] of openOverlays) if (ovEl.contains(el) && (!best || best.el.contains(ovEl))) best = { el: ovEl, info }
    return best ? best.info : null
  }
  function contextOf(el, e) {
    const ctx = {}
    const ov = overlayOf(el)
    if (ov) ctx.overlay = { id: ov.id, kind: ov.kind, title: ov.title, short: ov.short }
    const form = el.closest('form')
    if (form) ctx.form = { selector: cssPath(form), id: form.id || undefined, action: form.getAttribute('action') ? maskUrl(form.getAttribute('action')) : undefined }
    const cell = el.closest('td, th')
    const table = cell && cell.closest('table')
    if (cell && table && cell.parentElement) {
      const tr = cell.parentElement
      const col = visualCol(cell)
      ctx.table = {
        selector: cssPath(table, 4),
        row: tr.rowIndex,
        col,
        rowId: tr.id || undefined,
        rowHeader: clip(mask(textOf(tr.cells[0])), 60),
        colHeader: clip(mask(headerTextAt(table, col)), 60),
        rowData: dataAttrs(tr, 6),
        cellData: dataAttrs(cell, 6),
      }
    }
    const row = !cell && el.closest('[role="row"]')
    if (row) {
      const gc = el.closest('[role="gridcell"], [role="cell"], [role="columnheader"], [role="rowheader"]')
      ctx.grid = {
        row: shortSel(row),
        rowIndex: row.getAttribute('aria-rowindex') || undefined,
        colIndex: gc ? gc.getAttribute('aria-colindex') || undefined : undefined,
        rowText: clip(mask(clean(row.textContent)), 80),
      }
    }
    if (e && typeof e.clientX === 'number') {
      // Idővonalon a vízszintes helyzet az időpont: a kattintás aránya a széles ősök szélességében.
      const tracks = []
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 10 && tracks.length < 3; n = n.parentElement, i++) {
        const r = n.getBoundingClientRect()
        if (r.width >= 200) {
          tracks.push({
            el: shortSel(n),
            x: +((e.clientX - r.left) / r.width).toFixed(4),
            y: +((e.clientY - r.top) / (r.height || 1)).toFixed(4),
            w: Math.round(r.width),
            h: Math.round(r.height),
          })
        }
      }
      if (tracks.length) ctx.relative = tracks
    }
    const region = el.closest('section, main, aside, nav, header, footer, [role="region"], [role="navigation"], .card, .panel, .box')
    if (region) {
      ctx.region = shortSel(region)
      const h = region.querySelector('h1, h2, h3, h4, .card-title, .panel-title')
      if (h) ctx.regionTitle = clip(mask(textOf(h)), 60)
    }
    return ctx
  }
  function ancestry(el, max = 8) {
    const out = []
    for (let n = el, i = 0; n && n.nodeType === 1 && i < max; n = n.parentElement, i++) out.push(shortSel(n))
    return out
  }
  function describe(el, e) {
    if (!el || el.nodeType !== 1) return null
    const interactive = el.closest(INTERACTIVE_SEL) || el
    const d = basicInfo(el)
    if (interactive !== el) d.interactive = basicInfo(interactive)
    d.path = ancestry(el)
    d.context = contextOf(el, e)
    d.handlers = handlerHints(el)
    return d
  }

  // ------------------------------------------------------------------ pillanatkép: HTML

  const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
  const URL_ATTRS = new Set(['src', 'href', 'action', 'poster', 'data-src', 'xlink:href', 'formaction'])
  const cssPaths = new WeakMap()
  let host = null
  let ui = null
  const isOwn = (el) => el === host || (el && el.nodeType === 1 && el.hasAttribute(OWN_ATTR))

  function sheetText(sheet, depth = 0) {
    const parts = []
    for (const r of sheet.cssRules) {
      if (r.styleSheet && depth < 4) {
        try {
          parts.push(`/* @import ${r.href} */\n` + sheetText(r.styleSheet, depth + 1))
          continue
        } catch {
          /* idegen eredetű import: marad a hivatkozás */
        }
      }
      parts.push(r.cssText)
    }
    return absolutizeCssUrls(parts.join('\n'), sheet.href || location.href)
  }
  function absolutizeCssUrls(text, base) {
    return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (m, _q, u) => {
      if (/^(data:|#|https?:|\/\/|blob:)/i.test(u)) return m
      const abs = safe(() => new URL(u, base).href)
      return abs ? `url("${abs}")` : m
    })
  }
  async function collectCss() {
    for (const sheet of [...document.styleSheets]) {
      const owner = sheet.ownerNode
      if (!owner || owner.localName !== 'link' || cssPaths.has(owner)) continue
      let text
      try {
        text = sheetText(sheet)
      } catch {
        text = null // idegen eredetű, CORS nélkül: a pillanatkép az eredeti címre hivatkozik
      }
      if (text == null) {
        cssPaths.set(owner, null)
        continue
      }
      const path = `css/${hashString((sheet.href || '') + '\n' + text)}.css`
      cssPaths.set(owner, path)
      if (!(await hasBlob(path))) {
        await putBlob(path, new Blob([`/* forrás: ${maskUrl(sheet.href, true)} */\n${text}`], { type: 'text/css' }))
        bump('bytes', text.length)
      }
    }
  }
  function styleText(el) {
    let css = el.textContent || ''
    if (!css.trim() && el.sheet) css = safe(() => [...el.sheet.cssRules].map((r) => r.cssText).join('\n')) || ''
    return css.replace(/<\/style/gi, '<\\/style')
  }
  function linkTag(el) {
    const rel = (el.getAttribute('rel') || '').toLowerCase()
    if (rel.includes('stylesheet')) {
      const path = cssPaths.get(el)
      const href = path ? `../${path}` : maskUrl(el.href, true)
      const media = el.getAttribute('media')
      return `<link rel="stylesheet" href="${escAttr(href)}" data-rec-href="${escAttr(maskUrl(el.href, true))}"${media ? ` media="${escAttr(media)}"` : ''}>`
    }
    if (/icon|preload|modulepreload|prefetch|manifest/.test(rel)) return `<link rel="${escAttr(rel)}" data-rec-href="${escAttr(maskUrl(el.href || '', true))}">`
    return ''
  }
  function scriptPlaceholder(el) {
    const type = el.getAttribute('type') || ''
    const src = el.getAttribute('src')
    let body = ''
    if (type === 'importmap') body = escText(el.textContent.slice(0, 30000))
    else if (/json/.test(type)) {
      const parsed = safe(() => JSON.parse(el.textContent))
      body = parsed === undefined ? '' : escText('alak: ' + JSON.stringify(shapeOf(parsed)))
    }
    return (
      `<rec-script${type ? ` data-rec-type="${escAttr(type)}"` : ''}${el.id ? ` data-rec-id="${escAttr(el.id)}"` : ''}` +
      `${src ? ` data-rec-src="${escAttr(maskUrl(el.src, true))}"` : ''} data-rec-hossz="${el.textContent.length}">${body}</rec-script>`
    )
  }
  function attrValue(el, tag, name, value) {
    let v = value
    if (name === 'nonce' || name === 'integrity') return null
    if (tag === 'meta' && name === 'content' && /csrf|token/i.test(el.getAttribute('name') || '')) return '[titok]'
    if (tag === 'input' && name === 'value') return maskFieldValue(el, v)
    if (name === 'd' || name === 'points') return v.length > 300 ? v.slice(0, 300) + '…' : v
    if (URL_ATTRS.has(name)) {
      if (/^\s*data:/i.test(v)) return `data:… (${v.length} kar.)`
      if (/^\s*(#|javascript:|mailto:|tel:)/i.test(v)) return mask(v)
      return maskUrl(v, true)
    }
    if (name === 'srcset') return clip(v, 300)
    if (name === 'data-react-props' || (v.length > 1500 && /^\s*[[{]/.test(v))) {
      const parsed = safe(() => JSON.parse(v))
      if (parsed !== undefined) return 'alak: ' + JSON.stringify(shapeOf(parsed))
    }
    if (v.length > 4000) v = v.slice(0, 4000) + '…[levágva]'
    // Az osztálynév technikai: maszkolva a pillanatkép stílusai elromlanának.
    if (name === 'class') return v
    return mask(v)
  }
  /** Egy elem attribútumai a pillanatképbe; az aláírás a téglalapok nélküli rész. */
  function attrsOf(el, tag, opts) {
    // A mezők aktuális állapota valódi attribútumként is bekerül, hogy a pillanatkép önállóan
    // megnyitva is a felvételkori értéket mutassa; az eredeti alapérték data-rec-default.
    const type = tag === 'input' ? (el.type || '').toLowerCase() : ''
    const checkable = type === 'checkbox' || type === 'radio'
    const changedValue = tag === 'input' && !checkable && el.value !== (el.getAttribute('value') || '')
    let s = ''
    for (const a of el.attributes) {
      if (changedValue && a.name === 'value') continue
      if (tag === 'option' && a.name === 'selected') continue
      if (checkable && a.name === 'checked') continue
      const v = attrValue(el, tag, a.name, a.value)
      if (v != null) s += ` ${a.name}="${escAttr(v)}"`
    }
    if (checkable && el.checked) s += ' checked data-rec-checked="1"'
    if (changedValue) {
      const orig = el.getAttribute('value')
      s += ` value="${escAttr(maskFieldValue(el, el.value))}" data-rec-value="1"${orig ? ` data-rec-default="${escAttr(maskFieldValue(el, orig))}"` : ''}`
    }
    if (tag === 'option' && el.selected) s += ' selected data-rec-selected="1"'
    if (tag === 'select') s += ` data-rec-value="${escAttr(clip(el.value, 80))}"`
    const sig = s
    if (opts.rects) {
      const r = el.getBoundingClientRect()
      if (r.width || r.height) s += ` data-rec-rect="${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}"`
    }
    if (el === document.activeElement && el !== document.body) s += ' data-rec-focus="1"'
    return { s, sig }
  }
  /**
   * DOM → HTML-szöveg, maszkolva. A szkriptek kimaradnak, a stíluslapok a mentett CSS-re mutatnak,
   * a mezők felvételkori értéke value/selected/checked, az elemek helye (viewport, CSS px) data-rec-rect.
   */
  function serializeTree(root, opts = {}) {
    const out = []
    const maxNodes = opts.maxNodes || 60000
    const canvases = []
    let count = 0
    let truncated = false
    let sig = 0x811c9dc5
    const feed = (s) => {
      for (let i = 0; i < s.length; i++) {
        sig ^= s.charCodeAt(i)
        sig = Math.imul(sig, 0x01000193)
      }
    }
    const visit = (node) => {
      if (truncated) return
      const type = node.nodeType
      if (type === 3) {
        const t = node.nodeValue
        if (!t) return
        if (!/\S/.test(t)) {
          out.push(t.length > 2 ? '\n' : t)
          return
        }
        const m = maskText(t, node.parentElement)
        out.push(escText(m))
        feed(m)
        return
      }
      if (type === 11) {
        for (let c = node.firstChild; c; c = c.nextSibling) visit(c)
        return
      }
      if (type !== 1) return
      const el = node
      if (isOwn(el)) return
      if (++count > maxNodes) {
        truncated = true
        out.push('<!-- FL felvevő: a pillanatkép itt csonkolva (túl sok elem) -->')
        return
      }
      const tag = el.localName
      if (tag === 'script') return void out.push(scriptPlaceholder(el))
      if (tag === 'noscript') return
      if (tag === 'link') return void out.push(linkTag(el))
      if (tag === 'style') {
        const css = styleText(el)
        feed('style' + css.length)
        return void out.push(`<style>${css}</style>`)
      }
      const { s, sig: attrSig } = attrsOf(el, tag, opts)
      let extra = ''
      if (opts.canvasPrefix && tag === 'canvas' && el.width * el.height >= 10000 && el.width * el.height <= 8e6 && canvases.length < 5) {
        const file = `${opts.canvasPrefix}${canvases.length + 1}.png`
        canvases.push({ el, file })
        extra = ` data-rec-canvas-file="${escAttr(file)}"`
      }
      out.push(`<${tag}${s}${extra}>`)
      feed(tag + attrSig)
      if (VOID.has(tag)) return
      if (tag === 'textarea') {
        out.push(escText(maskFieldValue(el, el.value) || ''))
        out.push('</textarea>')
        return
      }
      if (tag === 'template' && el.content) visit(el.content)
      if (el.shadowRoot) {
        out.push('<template shadowrootmode="open">')
        for (let c = el.shadowRoot.firstChild; c; c = c.nextSibling) visit(c)
        out.push('</template>')
      }
      if (tag === 'iframe') {
        out.push('</iframe>')
        const doc = safe(() => el.contentDocument)
        if (doc && doc.body) {
          out.push('<rec-iframe-tartalom>')
          visit(doc.body)
          out.push('</rec-iframe-tartalom>')
        }
        return
      }
      for (let c = el.firstChild; c; c = c.nextSibling) visit(c)
      out.push(`</${tag}>`)
    }
    visit(root)
    return { html: out.join(''), sig: (sig >>> 0).toString(16), count, truncated, canvases }
  }
  function headStylesHtml() {
    const parts = []
    for (const el of document.querySelectorAll('link[rel~="stylesheet"], style')) {
      if (isOwn(el)) continue
      parts.push(el.localName === 'link' ? linkTag(el) : `<style>${styleText(el)}</style>`)
    }
    return parts.join('\n')
  }
  function bodyAttrsHtml() {
    if (!document.body) return ''
    return attrsOf(document.body, 'body', {}).s
  }
  function snapshotComment(kind, reason) {
    return (
      `<!-- FL felvevő ${VERSION} pillanatkép · ${kind} · ${reason} · ${new Date().toISOString()}\n` +
      `     URL: ${maskUrl(location.href)} · viewport: ${innerWidth}×${innerHeight} · görgetés: ${Math.round(scrollX)},${Math.round(scrollY)} · dpr: ${devicePixelRatio}\n` +
      `     data-rec-rect = x,y,szél,mag (viewport, CSS px) · value, selected, checked = a felvételkori állapot (data-rec-value/selected/checked jelöli) · rec-script = eltávolított szkript -->\n`
    )
  }

  // ------------------------------------------------------------------ pillanatkép: szerkezet

  const WIDGET_SELECTORS = [
    ['select2', '.select2-container'],
    ['tom-select', '.ts-wrapper'],
    ['choices', '.choices'],
    ['selectize', '.selectize-control'],
    ['chosen', '.chosen-container'],
    ['flatpickr', '.flatpickr-input, .flatpickr-calendar'],
    ['bootstrap-datepicker', '.datepicker'],
    ['daterangepicker', '.daterangepicker'],
    ['fullcalendar', '.fc'],
    ['vis-timeline', '.vis-timeline'],
    ['react-big-calendar', '.rbc-calendar'],
    ['bryntum', '.b-widget'],
    ['dhtmlx', '.gantt_container, .dhx_cal_container'],
    ['daypilot', '[class*="scheduler_default"]'],
    ['mobiscroll', '[class*="mbsc-"]'],
    ['syncfusion', '.e-schedule'],
    ['kendo', '.k-scheduler'],
    ['react-select', '[class*="react-select"]'],
    ['mui', '[class*="Mui"]'],
    ['turbo-frame', 'turbo-frame'],
    ['stimulus', '[data-controller]'],
    ['bootstrap-modal', '.modal'],
    ['tippy', '[data-tippy-root]'],
    ['tooltip-attr', '[data-toggle="tooltip"], [data-bs-toggle="tooltip"]'],
  ]
  function widgetOf(el) {
    const w = []
    const cls = typeof el.className === 'string' ? el.className : ''
    const next = el.nextElementSibling
    if (/select2-hidden-accessible/.test(cls) || (next && next.classList.contains('select2'))) w.push('select2')
    if (el.tomselect || /tomselected/.test(cls)) w.push('tom-select')
    if (el.selectize || /selectized/.test(cls)) w.push('selectize')
    if (el.closest('.choices')) w.push('choices')
    if (next && next.classList.contains('chosen-container')) w.push('chosen')
    if (el._flatpickr || /flatpickr-input/.test(cls)) w.push('flatpickr')
    if (/datepicker|datetimepicker|timepicker|daterange/i.test(`${cls} ${el.getAttribute('data-provide') || ''}`)) w.push('dátumválasztó?')
    const $ = window.jQuery
    if ($ && typeof $ === 'function') {
      for (const k of ['datepicker', 'DateTimePicker', 'datetimepicker', 'daterangepicker', 'timepicker', 'select2', 'uiAutocomplete']) {
        if (safe(() => $(el).data(k))) w.push('jq:' + k)
      }
    }
    if (el.closest('[class*="react-select"]') || /^react-select-/.test(el.id)) w.push('react-select')
    if (el.closest('.MuiInputBase-root, .MuiAutocomplete-root')) w.push('mui')
    if (reactPropsOf(el)) w.push('react')
    for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
      const c = n.getAttribute('data-controller')
      if (c) {
        w.push('stimulus:' + c)
        break
      }
    }
    return w.join(', ') || undefined
  }
  function fieldInfo(el) {
    const tag = el.localName
    const info = {
      selector: cssPath(el),
      tag,
      type: el.getAttribute('type') || (tag === 'select' ? (el.multiple ? 'select-multiple' : 'select') : undefined),
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      label: clip(mask(labelText(el)), 80) || undefined,
      placeholder: mask(el.getAttribute('placeholder')) || undefined,
      required: el.required || el.getAttribute('aria-required') === 'true' || undefined,
      disabled: el.disabled || undefined,
      readonly: el.readOnly || undefined,
      visible: visibleEl(el),
      widget: widgetOf(el),
      cls: classes(el).join(' ') || undefined,
      role: el.getAttribute('role') || undefined,
      data: dataAttrs(el, 10),
      rect: rectOf(el),
    }
    if (tag === 'select') {
      const opts = [...el.options]
      info.optionCount = opts.length
      info.options = opts.slice(0, 150).map((o) => ({
        value: clip(o.value, 60),
        text: clip(mask(clean(o.text)), 80),
        selected: o.selected || undefined,
        disabled: o.disabled || undefined,
        group: o.parentElement && o.parentElement.localName === 'optgroup' ? clip(mask(o.parentElement.label), 60) : undefined,
      }))
      info.value = clip(el.value, 80)
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      info.checked = el.checked
      info.value = el.value
    } else if ('value' in el && typeof el.value === 'string') info.value = maskFieldValue(el, el.value)
    for (const a of ['min', 'max', 'step', 'pattern', 'maxlength', 'autocomplete', 'inputmode', 'list', 'aria-controls', 'aria-autocomplete', 'aria-expanded', 'aria-owns']) {
      const v = el.getAttribute(a)
      if (v != null) (info.attrs || (info.attrs = {}))[a] = clip(v, 80)
    }
    return info
  }
  function btnInfo(el) {
    const icon = el.querySelector(':scope > i, :scope > svg, :scope > span[class*="icon"]')
    return {
      text: clip(mask(clean(textOf(el) || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '')), 60) || undefined,
      label: clip(mask(labelText(el)), 60) || undefined,
      selector: cssPath(el),
      tag: el.localName,
      type: el.getAttribute('type') || undefined,
      id: el.id || undefined,
      cls: classes(el).join(' ') || undefined,
      href: el.getAttribute('href') ? maskUrl(el.href || el.getAttribute('href')) : undefined,
      icon: icon ? shortSel(icon) : undefined,
      data: dataAttrs(el, 8),
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true' || undefined,
      visible: visibleEl(el),
      rect: rectOf(el),
    }
  }
  function formInfo(form) {
    const action = form.getAttribute('action')
    const override = form.querySelector('input[name="_method"]')
    return {
      selector: cssPath(form),
      id: form.id || undefined,
      name: form.getAttribute('name') || undefined,
      action: action ? maskUrl(action) : undefined,
      method: (form.getAttribute('method') || 'get').toLowerCase(),
      methodOverride: override ? override.value : undefined,
      cls: classes(form).join(' ') || undefined,
      data: dataAttrs(form, 10),
      visible: visibleEl(form),
      rect: rectOf(form),
      fields: [...form.querySelectorAll(FIELD_SEL)].slice(0, 120).map(fieldInfo),
      hidden: [...form.querySelectorAll('input[type="hidden"]')].slice(0, 60).map((h) => ({ name: h.name || undefined, id: h.id || undefined, value: maskFieldValue(h, h.value) })),
      buttons: [...form.querySelectorAll(BUTTON_SEL)].slice(0, 40).map(btnInfo),
    }
  }
  function cellSample(c) {
    const o = { text: clip(mask(textOf(c)), 60) }
    const cls = classes(c).slice(0, 3)
    if (cls.length) o.cls = cls.join(' ')
    if (c.colSpan > 1) o.span = c.colSpan
    if (c.children.length) o.kids = c.children.length
    const data = dataAttrs(c, 4)
    if (data) o.data = data
    return o
  }
  function tableInfo(t) {
    const rows = [...t.rows]
    const headRows = t.tHead ? [...t.tHead.rows] : rows.filter((r) => r.cells.length && [...r.cells].every((c) => c.localName === 'th')).slice(0, 3)
    const body = t.tBodies.length ? [...t.tBodies].flatMap((b) => [...b.rows]) : rows.filter((r) => !headRows.includes(r))
    return {
      selector: cssPath(t),
      id: t.id || undefined,
      cls: classes(t).join(' ') || undefined,
      caption: t.caption ? clip(mask(clean(t.caption.textContent)), 80) : undefined,
      headers: headRows.map((r) => [...r.cells].map((c) => (c.colSpan > 1 ? `${clip(mask(textOf(c)), 50)} (×${c.colSpan})` : clip(mask(textOf(c)), 50)))),
      rowCount: body.length,
      colCount: rows.reduce((m, r) => Math.max(m, [...r.cells].reduce((s, c) => s + (c.colSpan || 1), 0)), 0),
      rowHeaders: body.slice(0, 80).map((r) => clip(mask(textOf(r.cells[0])), 50)),
      sampleRows: body.slice(0, 6).map((r) => [...r.cells].slice(0, 40).map(cellSample)),
      data: dataAttrs(t, 8),
      visible: visibleEl(t),
      rect: rectOf(t),
    }
  }
  function countTokens(scope, attr) {
    const counts = {}
    for (const el of scope.querySelectorAll(`[${attr}]`)) for (const tok of el.getAttribute(attr).split(/\s+/).filter(Boolean)) counts[tok] = (counts[tok] || 0) + 1
    return counts
  }
  /** Gépi olvasásra szánt összefoglaló: űrlapok, mezők, gombok, táblázatok, vezérlők. */
  function summarize(root, kind) {
    const scope = root.nodeType === 9 ? root.documentElement : root
    const out = {
      kind,
      url: maskUrl(location.href),
      view: viewKey(),
      title: mask(document.title),
      at: new Date().toISOString(),
      viewport: [innerWidth, innerHeight],
      scroll: [Math.round(scrollX), Math.round(scrollY)],
      dpr: devicePixelRatio,
    }
    if (scope !== document.documentElement) {
      out.root = { selector: cssPath(scope), cls: classes(scope), role: scope.getAttribute('role') || undefined, rect: rectOf(scope) }
      // Lenyílók, menük, naptárak: a választható elemek szövege és jelölése.
      const items = scope.querySelectorAll('[role="option"], [role="menuitem"], li, .dropdown-item, td[data-date], .flatpickr-day, .day')
      if (items.length) {
        out.items = [...items].slice(0, 80).map((it) => ({
          text: clip(mask(textOf(it)), 60),
          selector: cssPath(it, 3),
          selected: it.getAttribute('aria-selected') === 'true' || it.classList.contains('selected') || it.classList.contains('active') || undefined,
          data: dataAttrs(it, 4),
        }))
        out.itemCount = items.length
      }
    }
    out.headings = [...scope.querySelectorAll('h1, h2, h3, h4, .modal-title, legend')]
      .filter(visibleEl)
      .slice(0, 40)
      .map((h) => ({ tag: h.localName, text: clip(mask(textOf(h)), 100) }))
    out.overlays = [...openOverlays.values()].map((o) => ({ id: o.id, kind: o.kind, title: o.title, selector: o.selector }))
    out.forms = [...scope.querySelectorAll('form')].slice(0, 40).map(formInfo)
    out.looseFields = [...scope.querySelectorAll(FIELD_SEL)].filter((f) => !f.closest('form')).slice(0, 150).map(fieldInfo)
    out.buttons = [...scope.querySelectorAll(BUTTON_SEL)].filter((b) => !b.closest('form')).slice(0, 250).map(btnInfo)
    const seen = new Set()
    out.links = []
    for (const a of scope.querySelectorAll('a[href]')) {
      if (out.links.length >= 200) break
      if (a.matches(BUTTON_SEL)) continue
      const href = maskUrl(a.href)
      const text = clip(mask(clean(a.textContent)), 60)
      if (seen.has(href + '|' + text)) continue
      seen.add(href + '|' + text)
      out.links.push({ text: text || undefined, href, selector: cssPath(a), data: dataAttrs(a, 6), visible: visibleEl(a) })
    }
    out.tables = [...scope.querySelectorAll('table')].slice(0, 25).map(tableInfo)
    out.grids = [...scope.querySelectorAll('[role="grid"], [role="treegrid"], [role="table"]')].slice(0, 10).map((g) => ({
      selector: cssPath(g),
      role: g.getAttribute('role'),
      rows: g.querySelectorAll('[role="row"]').length,
      columnHeaders: [...g.querySelectorAll('[role="columnheader"]')].slice(0, 60).map((c) => clip(mask(textOf(c)), 40)),
      rowHeaders: [...g.querySelectorAll('[role="rowheader"]')].slice(0, 60).map((c) => clip(mask(textOf(c)), 40)),
    }))
    out.stimulusControllers = countTokens(scope, 'data-controller')
    out.stimulusActions = [...new Set([...scope.querySelectorAll('[data-action]')].map((e) => e.getAttribute('data-action')))].slice(0, 120)
    out.turboFrames = [...scope.querySelectorAll('turbo-frame')].slice(0, 50).map((f) => ({
      id: f.id,
      src: f.getAttribute('src') ? maskUrl(f.getAttribute('src')) : undefined,
      loading: f.getAttribute('loading') || undefined,
      target: f.getAttribute('target') || undefined,
    }))
    out.reactComponents = [...scope.querySelectorAll('[data-react-class]')].slice(0, 50).map((e) => ({
      component: e.getAttribute('data-react-class'),
      props: safe(() => shapeOf(JSON.parse(e.getAttribute('data-react-props') || 'null'))),
    }))
    out.iframes = [...scope.querySelectorAll('iframe')].slice(0, 20).map((f) => ({ src: maskUrl(f.src || ''), sameOrigin: !!safe(() => f.contentDocument), rect: rectOf(f) }))
    out.widgets = {}
    for (const [name, sel] of WIDGET_SELECTORS) {
      const c = safe(() => scope.querySelectorAll(sel).length)
      if (c) out.widgets[name] = c
    }
    return out
  }
  function detectTech() {
    const w = window
    const t = {}
    safe(() => {
      if (w.Turbo) t.turbo = { drive: safe(() => w.Turbo.session.drive), progressBar: !!document.querySelector('.turbo-progress-bar') }
    })
    if (w.Turbolinks) t.turbolinks = true
    safe(() => {
      if (w.Stimulus) t.stimulus = [...w.Stimulus.router.modulesByIdentifier.keys()]
    })
    safe(() => {
      const $ = w.jQuery
      if ($ && $.fn) {
        const known = ['select2', 'datepicker', 'datetimepicker', 'daterangepicker', 'timepicker', 'modal', 'tooltip', 'popover', 'dropdown', 'chosen', 'selectize', 'autocomplete', 'fullCalendar', 'dataTable', 'DataTable', 'tab', 'collapse']
        t.jquery = { version: $.fn.jquery, plugins: known.filter((k) => typeof $.fn[k] === 'function'), bootstrap: safe(() => $.fn.modal.Constructor.VERSION) }
      }
    })
    safe(() => {
      if (w.bootstrap) t.bootstrap = safe(() => w.bootstrap.Modal.VERSION) || true
    })
    safe(() => {
      if (w.React) t.react = w.React.version
      const hook = w.__REACT_DEVTOOLS_GLOBAL_HOOK__
      if (hook && hook.renderers && hook.renderers.size) t.reactRenderers = [...hook.renderers.values()].map((r) => r.version)
      const probe = [document.body, ...document.querySelectorAll('body > *, #root, #app, [data-reactroot]')].slice(0, 30)
      if (probe.some((n) => n && Object.keys(n).some((k) => k.startsWith('__react')))) t.reactDom = true
    })
    safe(() => {
      if (w.Vue || w.__VUE__) t.vue = (w.Vue && w.Vue.version) || true
    })
    const ng = document.querySelector('[ng-version]')
    if (ng) t.angular = ng.getAttribute('ng-version')
    for (const [name, get] of [
      ['fullcalendar', () => w.FullCalendar && (w.FullCalendar.version || true)],
      ['flatpickr', () => !!w.flatpickr],
      ['moment', () => w.moment && w.moment.version],
      ['dayjs', () => !!w.dayjs],
      ['railsUjs', () => !!w.Rails],
      ['actionCable', () => !!w.ActionCable],
      ['alpine', () => w.Alpine && (w.Alpine.version || true)],
      ['htmx', () => w.htmx && (w.htmx.version || true)],
    ]) {
      const v = safe(get)
      if (v) t[name] = v
    }
    const importmap = document.querySelector('script[type="importmap"]')
    if (importmap) t.importmap = safe(() => Object.keys(JSON.parse(importmap.textContent).imports || {})).slice(0, 80)
    t.scripts = [...document.scripts]
      .map((s) => s.src)
      .filter(Boolean)
      .map((src) => safe(() => {
        const u = new URL(src)
        return (u.host === location.host ? '' : u.host) + u.pathname.replace(/-[0-9a-f]{8,}(?=\.)/, '-…')
      }) || src)
      .slice(0, 40)
    t.stimulusControllers = countTokens(document, 'data-controller')
    t.turboFrames = [...document.querySelectorAll('turbo-frame')].map((f) => f.id).slice(0, 40)
    t.reactClasses = [...new Set([...document.querySelectorAll('[data-react-class]')].map((e) => e.getAttribute('data-react-class')))]
    t.widgets = {}
    for (const [name, sel] of WIDGET_SELECTORS) {
      const c = safe(() => document.querySelectorAll(sel).length)
      if (c) t.widgets[name] = c
    }
    t.domElements = document.getElementsByTagName('*').length
    return t
  }

  // ------------------------------------------------------------------ pillanatkép: mentés

  let lastPageSig = null
  async function storeSnapshot(kind, s) {
    const id = uid()
    const htmlPath = `snap/${id}.html`
    const jsonPath = `snap/${id}.json`
    const json = JSON.stringify(s.summary, null, 1)
    await putBlob(htmlPath, new Blob([s.html], { type: 'text/html' }))
    await putBlob(jsonPath, new Blob([json], { type: 'application/json' }))
    const canvasFiles = []
    for (const c of s.canvases || []) {
      const blob = await new Promise((resolve) => {
        try {
          c.el.toBlob(resolve, 'image/png')
        } catch {
          resolve(null) // szennyezett (idegen eredetű) vászon
        }
      })
      if (blob) {
        await putBlob(c.file, blob)
        canvasFiles.push(c.file)
      }
    }
    bump('snapshots')
    bump('bytes', s.html.length + json.length)
    return record('snapshot', {
      kind,
      reason: s.reason,
      ref: s.ref || null,
      overlay: s.overlay || null,
      title: s.title,
      files: { html: htmlPath, json: jsonPath, canvases: canvasFiles },
      sig: s.sig,
      nodes: s.count,
      truncated: s.truncated || undefined,
      bytes: s.html.length,
    })
  }
  async function snapshotPage(reason, ref, force) {
    if (!state.recording) return null
    harvestNames()
    await collectCss()
    const snapId = uid()
    const ser = serializeTree(document.documentElement, { rects: true, canvasPrefix: `canvas/${snapId}-` })
    if (!force && ser.sig === lastPageSig) return null
    lastPageSig = ser.sig
    const html = `<!doctype html>\n${snapshotComment('oldal', reason)}${ser.html}`
    return storeSnapshot('page', { reason, ref, title: mask(document.title), html, summary: summarize(document, 'page'), sig: ser.sig, count: ser.count, truncated: ser.truncated, canvases: ser.canvases })
  }
  async function snapshotOverlay(el, info, reason, force) {
    if (!state.recording || !el.isConnected) return null
    if (info.kind === 'popup' && info.snaps >= 3 && !force) return null
    harvestNames(el)
    if (!info.title) info.title = overlayTitle(el)
    await collectCss()
    const ser = serializeTree(el, { rects: true })
    if (!force && ser.sig === info.lastSig) return null
    info.lastSig = ser.sig
    info.snaps++
    const kind = info.kind === 'dialog' ? 'dialog' : 'popup'
    const html =
      `<!doctype html>\n${snapshotComment(kind === 'dialog' ? 'ablak' : 'lenyíló', reason)}` +
      `<html><head><meta charset="utf-8">\n${headStylesHtml()}\n</head><body${bodyAttrsHtml()}>${ser.html}</body></html>`
    const ev = await storeSnapshot(kind, { reason, ref: info.id, overlay: info.id, title: info.title, html, summary: summarize(el, kind), sig: ser.sig, count: ser.count, truncated: ser.truncated })
    if (ev && kind === 'dialog') requestShot(reason === 'megnyílt' ? 'ablak megnyílt' : 'ablak változott', ev.uid)
    return ev
  }

  let pageSnapPending = null
  function schedulePageSnapshot(reason, ref, alwaysShot) {
    if (pageSnapPending) {
      pageSnapPending.reasons.add(reason)
      if (alwaysShot) pageSnapPending.alwaysShot = true
      return
    }
    pageSnapPending = { reasons: new Set([reason]), ref, alwaysShot }
    ;(async () => {
      await waitQuiet(700, 5000, 300)
      const p = pageSnapPending
      pageSnapPending = null
      const ev = await snapshotPage([...p.reasons].join(', '), p.ref)
      if (ev || p.alwaysShot) requestShot('oldal: ' + [...p.reasons].join(', '), ev ? ev.uid : p.ref)
    })().catch((err) => {
      pageSnapPending = null
      noteError('oldal-pillanatkép', err)
    })
  }

  // ------------------------------------------------------------------ ablakok és lenyílók

  const DIALOG_SEL =
    'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], .modal, .ui-dialog, .MuiDialog-root, .ReactModal__Content, .swal2-popup, .bootbox, .offcanvas.show'
  const POPUP_SEL =
    '[role="listbox"], [role="menu"], [role="tooltip"], .dropdown-menu, .select2-dropdown, .flatpickr-calendar, .ui-datepicker, .datepicker-dropdown, .daterangepicker, .tippy-box, .popover, .ui-autocomplete, .ts-dropdown, .choices__list--dropdown, .react-datepicker-popper'
  const openOverlays = new Map() // elem → adatok
  const heuristic = new Map() // dinamikusan megjelent, lebegő elem → fajta
  const heuristicCandidates = []
  const dirtyOverlays = new Set()
  let heuristicArmed = false

  function isShown(el, minW, minH) {
    if (!el.isConnected || isOwn(el)) return false
    const r = el.getBoundingClientRect()
    if (r.width < minW || r.height < minH) return false
    if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none'
  }
  function considerHeuristic(n) {
    if (!(n instanceof HTMLElement) || isOwn(n)) return
    const check = (el) => {
      if (heuristic.has(el) || el.matches(DIALOG_SEL) || el.matches(POPUP_SEL)) return false
      const cs = getComputedStyle(el)
      if (cs.position !== 'fixed' && !(cs.position === 'absolute' && (parseInt(cs.zIndex, 10) || 0) >= 100)) return false
      const r = el.getBoundingClientRect()
      const vp = innerWidth * innerHeight
      if (r.width < 120 || r.height < 60 || r.width * r.height < vp * 0.02) return false
      if (r.top <= 0 && r.width >= innerWidth * 0.9 && r.height < 120) return false // fejlécsáv
      if (!el.querySelector('input, select, textarea, button, [role="button"], a[href], [role="option"], [role="menuitem"]')) return false
      heuristic.set(el, r.width * r.height >= vp * 0.08 && el.querySelector('input, select, textarea, button') ? 'dialog' : 'popup')
      return true
    }
    if (check(n)) return
    for (const c of [...n.children].slice(0, 5)) if (check(c)) return
  }
  function overlayTitle(el) {
    const label = el.getAttribute('aria-label')
    if (label) return clip(mask(clean(label)), 80)
    const by = el.getAttribute('aria-labelledby')
    if (by) {
      const t = clean(by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' '))
      if (t) return clip(mask(t), 80)
    }
    // Az erősebb jelölt előbb: a fejlécdoboz (header) csak végső eset, mert gombokat, füleket is tartalmaz.
    for (const sel of ['.modal-title', '.ui-dialog-title', '.MuiDialogTitle-root', '[class*="dialog-title"]', '[class*="modal-title"]', 'h1', 'h2', 'h3', 'h4', 'h5', 'legend', '[class*="title"]', '[class*="header"]']) {
      const h = el.querySelector(sel)
      const t = h && ownText(h)
      if (!t) continue
      // A címben lévő választó (FlightLogger: foglalástípus) kiválasztott értéke a cím része.
      const select = h.querySelector('select')
      const chosen = select && select.selectedOptions[0] ? clean(select.selectedOptions[0].text) : ''
      return clip(mask(chosen ? `${t} · ${chosen}` : t), 80)
    }
    return ''
  }
  /** Az elem szövege a benne lévő választómezők, gombok és listák szövege nélkül. */
  function ownText(el) {
    let s = ''
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const skip = n.parentElement && n.parentElement.closest('select, button, [role="listbox"], [role="option"], [role="button"]')
      if (skip && el.contains(skip)) continue
      s += ' ' + n.nodeValue
      if (s.length > 200) break
    }
    return clean(s)
  }
  function currentOverlays() {
    const found = new Map()
    for (const el of document.querySelectorAll(DIALOG_SEL)) if (isShown(el, 40, 20)) found.set(el, 'dialog')
    for (const el of document.querySelectorAll(POPUP_SEL)) if (!found.has(el) && isShown(el, 16, 10)) found.set(el, 'popup')
    for (const [el, kind] of heuristic) {
      if (!el.isConnected) heuristic.delete(el)
      else if (!found.has(el) && isShown(el, 40, 20)) found.set(el, kind)
    }
    const list = [...found]
    return new Map(list.filter(([el, kind]) => !list.some(([o, k]) => o !== el && k === kind && o.contains(el))))
  }
  function insideOpenOverlay(node) {
    for (const el of openOverlays.keys()) if (el.contains(node)) return true
    return false
  }
  function scanOverlays() {
    const cands = heuristicCandidates.splice(0, 80)
    if (heuristicArmed) for (const n of cands) considerHeuristic(n)
    const cur = currentOverlays()
    for (const [el, info] of [...openOverlays]) {
      if (cur.has(el)) continue
      openOverlays.delete(el)
      dirtyOverlays.delete(el)
      if (activeEffect) activeEffect.closed.push({ id: info.id, kind: info.kind, title: info.title, short: info.short })
      record('overlay', { action: 'close', overlay: info.id, kind: info.kind, title: info.title, selector: info.selector, cause: activeEffect ? activeEffect.ref : null, openMs: Date.now() - info.openedAt })
    }
    for (const [el, kind] of cur) {
      if (openOverlays.has(el)) continue
      const info = { id: uid(), kind, title: overlayTitle(el), selector: cssPath(el), short: shortSel(el), openedAt: Date.now(), snaps: 0, lastSig: null, pending: false }
      openOverlays.set(el, info)
      if (activeEffect) activeEffect.opened.push({ id: info.id, kind, title: info.title, short: info.short })
      record('overlay', {
        action: 'open',
        overlay: info.id,
        kind,
        title: info.title,
        selector: info.selector,
        short: info.short,
        cls: classes(el),
        rect: rectOf(el),
        cause: activeEffect ? activeEffect.ref : null,
        fields: el.querySelectorAll('input:not([type="hidden"]), select, textarea').length,
        buttons: [...el.querySelectorAll('button, input[type="submit"], [role="button"], a.btn')]
          .slice(0, 15)
          .map((b) => clip(mask(clean(textOf(b) || b.value || b.getAttribute('aria-label') || '')), 40))
          .filter(Boolean),
      })
      scheduleOverlaySnapshot(el, info, 'megnyílt')
    }
  }
  function scheduleOverlaySnapshot(el, info, reason) {
    if (info.pending) return
    info.pending = true
    ;(async () => {
      await waitQuiet(400, 2500, reason === 'megnyílt' ? 250 : 0)
      info.pending = false
      if (openOverlays.has(el)) await snapshotOverlay(el, info, reason)
    })().catch((err) => {
      info.pending = false
      noteError('ablak-pillanatkép', err)
    })
  }

  // ------------------------------------------------------------------ DOM-figyelés

  let lastMutationAt = 0
  let pageDirty = 0
  let scanTimer = null
  async function waitQuiet(quietMs, maxMs, minMs = 0) {
    const start = Date.now()
    if (minMs) await sleep(minMs)
    while (Date.now() - start < maxMs) {
      if (Date.now() - lastMutationAt >= quietMs) return
      await sleep(100)
    }
  }
  function onMutations(records) {
    lastMutationAt = Date.now()
    if (!state.recording) return
    let added = 0
    let removed = 0
    let pageAdded = 0
    for (const r of records) {
      const t = r.target
      if (isOwn(t)) continue
      if (r.type === 'childList') {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1 || isOwn(n)) continue
          const c = 1 + n.getElementsByTagName('*').length
          added += c
          if (!insideOpenOverlay(t)) pageAdded += c
          if (heuristicCandidates.length < 400) heuristicCandidates.push(n)
        }
        for (const n of r.removedNodes) if (n.nodeType === 1 && !isOwn(n)) removed += 1 + n.getElementsByTagName('*').length
      } else if (r.type === 'attributes' && t.parentElement === document.body && heuristicCandidates.length < 400) heuristicCandidates.push(t)
      for (const el of openOverlays.keys()) if (el.contains(t)) dirtyOverlays.add(el)
    }
    if (activeEffect) {
      activeEffect.added += added
      activeEffect.removed += removed
    }
    pageDirty += pageAdded
    scheduleScan()
  }
  function scheduleScan() {
    if (scanTimer) return
    scanTimer = setTimeout(() => {
      scanTimer = null
      try {
        scanOverlays()
        if (pageDirty >= 60) {
          pageDirty = 0
          schedulePageSnapshot('nagy DOM-változás', activeEffect ? activeEffect.ref : null)
        }
        if (dirtyOverlays.size) {
          const list = [...dirtyOverlays]
          dirtyOverlays.clear()
          for (const el of list) {
            const info = openOverlays.get(el)
            if (info) scheduleOverlaySnapshot(el, info, 'változott')
          }
        }
      } catch (err) {
        noteError('ablakfigyelés', err)
      }
    }, 150)
  }

  // ------------------------------------------------------------------ kattintás és hatása

  let activeEffect = null
  let lastDragAt = 0
  function startEffects(ev, point) {
    finishEffects()
    if (!ev) return
    activeEffect = { ref: ev.uid, urlBefore: location.href, perf0: performance.now(), opened: [], closed: [], net: [], framework: [], added: 0, removed: 0, timer: setTimeout(finishEffects, EFFECT_WINDOW_MS) }
    try {
      sessionStorage.setItem(KEY_LASTCLICK, JSON.stringify({ uid: ev.uid, t: Date.now(), view: ev.view }))
    } catch {
      /* nem kritikus */
    }
    if (state.settings.shotAfterClick) requestShot('kattintás', ev.uid, point)
  }
  function finishEffects(leaving) {
    const a = activeEffect
    if (!a) return
    activeEffect = null
    clearTimeout(a.timer)
    const urlChanged = location.href !== a.urlBefore
    if (!leaving && !urlChanged && !a.opened.length && !a.closed.length && !a.net.length && !a.framework.length && a.added + a.removed === 0) {
      record('effects', { ref: a.ref, none: true })
      return
    }
    record('effects', {
      ref: a.ref,
      leftPage: leaving === true || undefined,
      newUrl: urlChanged ? maskUrl(location.href) : undefined,
      toView: urlChanged ? viewKey() : undefined,
      opened: a.opened,
      closed: a.closed,
      net: a.net.slice(0, 15),
      framework: a.framework.slice(0, 15),
      domAdded: a.added,
      domRemoved: a.removed,
    })
  }
  function lastClickRef() {
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY_LASTCLICK) || 'null')
      sessionStorage.removeItem(KEY_LASTCLICK)
      if (raw && Date.now() - raw.t < 8000) return { uid: raw.uid, view: raw.view }
    } catch {
      /* nincs előzmény */
    }
    return null
  }
  function fromPanel(e) {
    const path = e.composedPath ? e.composedPath() : []
    return path.some((n) => n === host || (n instanceof Element && n.hasAttribute(OWN_ATTR)))
  }
  const modsOf = (e) => ['alt', 'ctrl', 'meta', 'shift'].filter((m) => e[m + 'Key']).join('+') || undefined
  function onPointerEvent(e) {
    if (!state.recording || fromPanel(e)) return
    const target = e.target instanceof Element ? e.target : e.target && e.target.parentElement
    if (!target) return
    const point = { x: Math.round(e.clientX), y: Math.round(e.clientY) }
    if (!e.isTrusted) {
      record(e.type, { trusted: false, target: basicInfo(target) })
      return
    }
    const ev = record(e.type, { button: e.button, x: point.x, y: point.y, mods: modsOf(e), afterDrag: Date.now() - lastDragAt < 400 || undefined, target: describe(target, e) })
    startEffects(ev, point)
  }
  let down = null
  function onPointerDown(e) {
    if (!state.recording || !e.isPrimary || fromPanel(e)) return
    down = { x: e.clientX, y: e.clientY, t: Date.now(), el: e.target instanceof Element ? e.target : null }
  }
  function onPointerUp(e) {
    const d = down
    down = null
    if (!d || !e.isPrimary || !state.recording) return
    const dx = Math.round(e.clientX - d.x)
    const dy = Math.round(e.clientY - d.y)
    if (Math.hypot(dx, dy) < 8) return
    lastDragAt = Date.now()
    const to = document.elementFromPoint(e.clientX, e.clientY) || (e.target instanceof Element ? e.target : null)
    const ev = record('drag', { from: describe(d.el, { clientX: d.x, clientY: d.y }), to: describe(to, e), dx, dy, ms: Date.now() - d.t })
    startEffects(ev, { x: Math.round(e.clientX), y: Math.round(e.clientY) })
  }

  // ------------------------------------------------------------------ mezők, billentyűk, űrlapok

  const inputTimers = new WeakMap()
  let lastInputSig = ''
  function valueOf(el) {
    if (el.localName === 'select') {
      const sel = [...el.selectedOptions]
      return { value: el.multiple ? sel.map((o) => o.value) : el.value, text: clip(mask(sel.map((o) => clean(o.text)).join(', ')), 120) }
    }
    if (el.type === 'checkbox' || el.type === 'radio') return { checked: el.checked, value: el.value }
    if (el.isContentEditable) return `[szöveg, ${clean(el.textContent).length} kar.]`
    return maskFieldValue(el, el.value)
  }
  function fieldBrief(el) {
    const ov = overlayOf(el)
    return {
      selector: cssPath(el),
      tag: el.localName,
      type: el.getAttribute('type') || undefined,
      name: el.getAttribute('name') || undefined,
      id: el.id || undefined,
      label: clip(mask(labelText(el)), 80) || undefined,
      widget: widgetOf(el),
      overlay: ov ? ov.title || ov.short : undefined,
    }
  }
  function recordInput(el, how) {
    if (!state.recording || !(el instanceof Element) || isOwn(el)) return
    const value = valueOf(el)
    const sig = cssPath(el) + '|' + JSON.stringify(value)
    if (sig === lastInputSig) return // a natív és a jQuery-s change ugyanarra az értékre
    lastInputSig = sig
    record('input', { how, field: fieldBrief(el), value })
  }
  function onInputEvent(e) {
    if (!state.recording || fromPanel(e)) return
    const el = e.target
    if (!(el instanceof Element)) return
    if (e.type === 'input' && (el.localName === 'input' || el.localName === 'textarea' || el.isContentEditable) && el.type !== 'checkbox' && el.type !== 'radio') {
      clearTimeout(inputTimers.get(el))
      inputTimers.set(
        el,
        setTimeout(() => recordInput(el, 'gépelés'), 900),
      )
      return
    }
    recordInput(el, e.type)
  }
  const RECORDED_KEYS = new Set(['Enter', 'Escape', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'])
  const isTextField = (el) => el instanceof Element && (el.localName === 'textarea' || (el.localName === 'input' && !/^(checkbox|radio|button|submit)$/.test(el.type)) || el.isContentEditable)
  function onKeyDown(e) {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && /^Key[PMR]$/.test(e.code)) {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'KeyP') manualSnapshot().catch((err) => showMessage(err.message, true))
      if (e.code === 'KeyM') addNote()
      if (e.code === 'KeyR') toggleRecording()
      return
    }
    if (!state.recording || fromPanel(e) || !RECORDED_KEYS.has(e.key)) return
    const t = e.target
    if (e.key.startsWith('Arrow') && isTextField(t) && !(t.getAttribute('role') === 'combobox' || t.getAttribute('aria-autocomplete') || t.getAttribute('aria-expanded'))) return
    record('key', { key: e.key, mods: modsOf(e), target: basicInfo(t instanceof Element ? t : null) })
  }
  function formDatum(k, v) {
    if (typeof v !== 'string') return `[fájl: ${v.type || '?'}, ${v.size} B]`
    if (SECRET_NAME.test(k)) return '[titok]'
    if (COMMENT_HINT.test(k)) return `[szöveg, ${v.length} kar.]`
    if (/^[\d\s.:/T+,Z-]{0,40}$/.test(v)) return v
    const m = mask(v)
    return m.length <= 60 ? m : `[szöveg, ${v.length} kar.]`
  }
  function onSubmit(e) {
    if (!state.recording || fromPanel(e)) return
    const form = e.target
    if (!(form instanceof HTMLFormElement)) return
    let entries
    try {
      entries = [...new FormData(form, e.submitter || undefined)]
    } catch {
      entries = safe(() => [...new FormData(form)]) || []
    }
    record('submit', {
      form: { selector: cssPath(form), id: form.id || undefined, action: form.getAttribute('action') ? maskUrl(form.getAttribute('action')) : undefined, method: (form.getAttribute('method') || 'get').toLowerCase(), data: dataAttrs(form, 8) },
      submitter: e.submitter ? basicInfo(e.submitter) : null,
      fields: entries.slice(0, 150).map(([k, v]) => [k, formDatum(k, v)]),
    })
  }

  // ------------------------------------------------------------------ hálózat és keretrendszer (csak figyelés)

  function onResource(en) {
    if (!state.recording) return
    if (en.initiatorType !== 'fetch' && en.initiatorType !== 'xmlhttprequest' && en.initiatorType !== 'beacon') return
    const info = { init: en.initiatorType, reqUrl: maskUrl(en.name), status: en.responseStatus || undefined, ms: Math.round(en.duration), bytes: en.encodedBodySize || undefined }
    record('net', info)
    if (activeEffect && en.startTime >= activeEffect.perf0 - 30) activeEffect.net.push(`${info.init === 'fetch' ? 'fetch' : 'xhr'} ${info.reqUrl}${info.status ? ' → ' + info.status : ''} (${info.ms} ms)`)
  }
  const FW_EVENTS = [
    'turbo:click',
    'turbo:before-visit',
    'turbo:visit',
    'turbo:load',
    'turbo:before-fetch-request',
    'turbo:before-fetch-response',
    'turbo:submit-start',
    'turbo:submit-end',
    'turbo:frame-load',
    'turbo:frame-render',
    'turbo:frame-missing',
    'turbo:before-stream-render',
    'turbo:fetch-request-error',
    'turbolinks:visit',
    'turbolinks:load',
    'ajax:beforeSend',
    'ajax:success',
    'ajax:error',
    'ajax:complete',
    'shown.bs.modal',
    'hidden.bs.modal',
  ]
  function onFrameworkEvent(e) {
    if (!state.recording) return
    try {
      const d = e.detail || {}
      const info = { name: e.type, target: shortSel(e.target) }
      const url = d.url || (d.fetchRequest && d.fetchRequest.url) || (d.formSubmission && d.formSubmission.location)
      if (url) info.reqUrl = maskUrl(String(url))
      const method = (d.fetchOptions && d.fetchOptions.method) || (d.formSubmission && d.formSubmission.method) || (d.fetchRequest && d.fetchRequest.method)
      if (method) info.method = String(method).toUpperCase()
      if (typeof d.action === 'string') info.action = d.action
      if (typeof d.success === 'boolean') info.success = d.success
      const resp = d.fetchResponse
      if (resp) {
        info.status = resp.statusCode != null ? resp.statusCode : safe(() => resp.response.status)
        info.contentType = safe(() => resp.contentType) || safe(() => resp.response.headers.get('content-type')) || undefined
        if (safe(() => resp.redirected)) info.redirected = true
      }
      const fd = d.formSubmission && d.formSubmission.formData
      if (fd) info.fields = safe(() => [...fd.keys()].slice(0, 80))
      if (e.type === 'turbo:before-stream-render' && e.target instanceof Element) {
        const tpl = e.target.querySelector('template')
        info.stream = {
          action: e.target.getAttribute('action'),
          target: e.target.getAttribute('target') || undefined,
          targets: e.target.getAttribute('targets') || undefined,
          template: tpl ? clip(mask(tpl.innerHTML), 1500) : undefined,
        }
      }
      if (e.type.startsWith('turbo:frame') && e.target instanceof Element) info.frame = { id: e.target.id, src: e.target.getAttribute('src') ? maskUrl(e.target.getAttribute('src')) : undefined }
      if (e.type.startsWith('ajax:')) {
        const xhr = (Array.isArray(d) ? d : []).find((x) => x && typeof x.getResponseHeader === 'function')
        if (xhr) {
          info.status = xhr.status
          if (xhr.responseURL) info.reqUrl = maskUrl(xhr.responseURL)
          info.contentType = safe(() => xhr.getResponseHeader('content-type')) || undefined
          if (e.type === 'ajax:complete' && /html|javascript/.test(info.contentType || '')) info.response = clip(mask(safe(() => xhr.responseText) || ''), 3000)
        }
      }
      record('framework', info)
      if (activeEffect) activeEffect.framework.push(`${info.name}${info.reqUrl ? ' ' + info.reqUrl : ''}${info.status ? ' → ' + info.status : ''}`)
    } catch (err) {
      noteError('keretrendszer-esemény', err)
    }
  }
  let jqHooked = false
  function dataKeysOf(data) {
    if (!data) return undefined
    if (typeof data === 'string') return safe(() => [...new URLSearchParams(data).keys()].slice(0, 80))
    if (data instanceof FormData) return [...data.keys()].slice(0, 80)
    if (typeof data === 'object') return Object.keys(data).slice(0, 80)
    return undefined
  }
  function hookJQuery() {
    const $ = window.jQuery
    if (jqHooked || typeof $ !== 'function' || !$.fn || !$.fn.on) return
    jqHooked = true
    try {
      $(document).on('ajaxSend.fbFelvevo', (_e, _xhr, s) => {
        if (state.recording) record('ajax', { phase: 'send', method: s && s.type, reqUrl: maskUrl((s && s.url) || ''), dataType: s && s.dataType, dataKeys: dataKeysOf(s && s.data) })
      })
      $(document).on('ajaxComplete.fbFelvevo', (_e, xhr, s) => {
        if (!state.recording) return
        const ct = safe(() => xhr.getResponseHeader('content-type'))
        const info = { phase: 'complete', method: s && s.type, reqUrl: maskUrl((s && s.url) || ''), status: xhr && xhr.status, contentType: ct || undefined }
        if (/html|javascript/.test(ct || '')) info.response = clip(mask(safe(() => xhr.responseText) || ''), 3000)
        record('ajax', info)
        if (activeEffect) activeEffect.framework.push(`ajax ${info.method || ''} ${info.reqUrl} → ${info.status}`)
      })
      // A jQueryvel kiváltott change (select2 és társai) natív eseményt nem küld.
      $(document).on('change.fbFelvevo', 'select, input, textarea', (e) => {
        if (!e.originalEvent) recordInput(e.target, 'jquery-change')
      })
      $(document).on('show.bs.modal shown.bs.modal hidden.bs.modal select2:open select2:select select2:unselect select2:close changeDate dp.change apply.daterangepicker shown.bs.dropdown', (e) => {
        if (!state.recording) return
        const info = { name: e.type + (e.namespace ? '.' + e.namespace : ''), via: 'jquery', target: shortSel(e.target) }
        const p = e.params && e.params.data
        if (p) info.data = { id: p.id, text: clip(mask(clean(p.text || '')), 80) }
        record('framework', info)
        if (activeEffect) activeEffect.framework.push(info.name)
      })
    } catch (err) {
      noteError('jQuery-figyelés', err)
    }
  }

  // ------------------------------------------------------------------ oldalak és navigáció

  let lastHref = location.href
  async function capturePage(reason, useLastClick) {
    if (!state.recording) return
    await waitQuiet(600, 4000, 300)
    harvestNames()
    hookJQuery()
    const nav = safe(() => performance.getEntriesByType('navigation')[0])
    const ev = record('page', {
      reason,
      title: mask(document.title),
      navType: reason === 'betöltés' && nav ? nav.type : undefined,
      referrer: reason === 'betöltés' && document.referrer ? maskUrl(document.referrer) : undefined,
      fromClick: useLastClick ? lastClickRef() : undefined,
      viewport: [innerWidth, innerHeight],
      tech: detectTech(),
    })
    scanOverlays()
    schedulePageSnapshot(reason, ev ? ev.uid : null, true)
    heuristicArmed = true
  }
  function checkUrl(via) {
    if (location.href === lastHref) return
    const from = lastHref
    lastHref = location.href
    if (!state.recording) return
    record('nav', { via, from: maskUrl(from), to: maskUrl(location.href), fromView: viewKey(from), toView: viewKey(), cause: activeEffect ? activeEffect.ref : null })
    if (via === 'hash' && viewKey(from) === viewKey()) return
    capturePage('navigáció', false)
  }

  // ------------------------------------------------------------------ képernyőkép (lapmegosztás)

  let capture = null
  let pendingShot = null
  let shotChain = Promise.resolve()
  async function startCapture() {
    const md = navigator.mediaDevices
    if (!md || !md.getDisplayMedia) throw new Error('Ez a böngésző nem támogatja a képernyőmegosztást.')
    const stream = await md.getDisplayMedia({
      video: { displaySurface: 'browser', frameRate: { ideal: 8, max: 15 } },
      audio: false,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
    })
    await useStream(stream)
  }
  async function useStream(stream) {
    stopCapture(false)
    const track = stream.getVideoTracks()[0]
    if (!track) throw new Error('A megosztásban nincs kép.')
    const surface = safe(() => track.getSettings().displaySurface)
    if (surface && surface !== 'browser') {
      stream.getTracks().forEach((t) => t.stop())
      throw new Error('Nem böngészőlapot osztottál meg – a képernyőkép így nem készül. Válaszd ezt a lapot.')
    }
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    video.setAttribute('style', 'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none')
    ui.root.appendChild(video)
    await video.play().catch(() => undefined)
    capture = { stream, track, video }
    track.addEventListener('ended', () => {
      if (capture && capture.track === track) {
        stopCapture(false)
        record('capture', { action: 'end' })
        showMessage('A képernyő-megosztás leállt.')
      }
    })
    record('capture', { action: 'start', surface })
    updatePanel()
    showMessage('Képernyő-megosztás aktív.')
    if (state.recording) requestShot('megosztás indult')
  }
  function stopCapture(userAction) {
    if (!capture) return
    const c = capture
    capture = null
    safe(() => c.stream.getTracks().forEach((t) => t.stop()))
    c.video.remove()
    if (userAction) record('capture', { action: 'stop' })
    updatePanel()
  }
  function requestShot(reason, ref, point) {
    if (!capture || !state.recording) return
    if (!pendingShot) pendingShot = { reasons: new Set(), refs: new Set(), point: null, first: Date.now(), timer: null }
    pendingShot.reasons.add(reason)
    if (ref) pendingShot.refs.add(ref)
    if (point) pendingShot.point = point
    clearTimeout(pendingShot.timer)
    const wait = Math.max(0, Math.min(700, 2500 - (Date.now() - pendingShot.first)))
    pendingShot.timer = setTimeout(() => {
      const p = pendingShot
      pendingShot = null
      if (!p) return
      waitQuiet(300, 1200).then(() => takeShot([...p.reasons], [...p.refs], p.point))
    }, wait)
  }
  function takeShot(reasons, refs, point) {
    shotChain = shotChain.then(() => doShot(reasons, refs, point)).catch((err) => noteError('képernyőkép', err))
    return shotChain
  }
  function nextVideoFrame(video, timeout) {
    return new Promise((resolve) => {
      let done = false
      const finish = (v) => {
        if (!done) {
          done = true
          resolve(v)
        }
      }
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => finish(true))
      setTimeout(() => finish(false), timeout)
    })
  }
  /** A képernyőképen eltakarandó helyek (CSS px): nevek, e-mail, telefon, megjegyzés. */
  function maskRects() {
    const out = []
    const vw = innerWidth
    const vh = innerHeight
    const within = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
    const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue
      if (!text || text.length < 3 || !/\S/.test(text)) continue
      let ranges = sensitiveRanges(text)
      if (!ranges.length) {
        if (text.trim().length >= 25 && commentHintAround(n.parentElement)) ranges = [[0, text.length, '[megjegyzés]']]
        else continue
      }
      for (const [a, b, label] of ranges) {
        const range = document.createRange()
        range.setStart(n, a)
        range.setEnd(n, b)
        for (const r of range.getClientRects()) if (within(r)) out.push({ x: r.left, y: r.top, w: r.width, h: r.height, label })
      }
    }
    for (const el of document.querySelectorAll('input:not([type="hidden"]), select, textarea')) {
      const shown = el.localName === 'select' ? [...el.selectedOptions].map((o) => o.text).join(', ') : el.value
      if (!shown || typeof shown !== 'string') continue
      const ranges = sensitiveRanges(shown)
      const freeText = el.localName === 'textarea' || COMMENT_HINT.test(`${el.name || ''} ${el.id || ''}`)
      if (!ranges.length && !freeText) continue
      const r = el.getBoundingClientRect()
      if (within(r)) out.push({ x: r.left, y: r.top, w: r.width, h: r.height, label: ranges.length ? ranges[0][2] : '[szöveg]' })
    }
    return out
  }
  async function doShot(reasons, refs, point) {
    const c = capture
    if (!c || !state.recording) return null
    const v = c.video
    if (!v.videoWidth) await sleep(400)
    if (!v.videoWidth) return null
    const ratioV = v.videoWidth / v.videoHeight
    const ratioP = innerWidth / innerHeight
    if (Math.abs(ratioV - ratioP) / ratioP > 0.03) {
      showMessage('A megosztott kép nem ennek a lapnak a mérete – a képernyőkép kimaradt (másik lapot osztottál meg?).', true)
      return null
    }
    harvestNames()
    let canvas
    let masks
    ui.panel.style.visibility = 'hidden'
    try {
      await rafs(2)
      await nextVideoFrame(v, 450)
      const scale = Math.min(1, MAX_SHOT_WIDTH / v.videoWidth)
      canvas = document.createElement('canvas')
      canvas.width = Math.round(v.videoWidth * scale)
      canvas.height = Math.round(v.videoHeight * scale)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const k = canvas.width / innerWidth
      masks = maskRects()
      for (const m of masks) {
        const x = m.x * k - 2
        const y = m.y * k - 1
        const w = m.w * k + 4
        const h = m.h * k + 2
        ctx.fillStyle = '#5b6475'
        ctx.fillRect(x, y, w, h)
        const fs = Math.max(8, Math.min(h * 0.72, 13 * k))
        ctx.font = `600 ${fs}px system-ui, sans-serif`
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#ffffff'
        if (ctx.measureText(m.label).width <= w - 2) ctx.fillText(m.label, x + 2, y + h / 2)
      }
      if (point) {
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth = Math.max(2, 3 * k)
        ctx.beginPath()
        ctx.arc(point.x * k, point.y * k, 16 * k, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = 'rgba(239,68,68,.4)'
        ctx.beginPath()
        ctx.arc(point.x * k, point.y * k, 4 * k, 0, Math.PI * 2)
        ctx.fill()
      }
    } finally {
      ui.panel.style.visibility = ''
    }
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82))
    if (!blob) return null
    const file = `shot/${uid()}.jpg`
    await putBlob(file, blob)
    bump('shots')
    bump('bytes', blob.size)
    return record('shot', {
      file,
      reasons,
      refs,
      size: [canvas.width, canvas.height],
      viewport: [innerWidth, innerHeight],
      scroll: [Math.round(scrollX), Math.round(scrollY)],
      masked: masks.length,
      point: point || undefined,
    })
  }

  // ------------------------------------------------------------------ export (ZIP)

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[n] = c >>> 0
    }
    return t
  })()
  function crc32(bytes) {
    let c = 0xffffffff
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  async function deflateRaw(bytes) {
    if (typeof CompressionStream === 'undefined') return null
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch {
      return null
    }
  }
  /** Minimális ZIP-író (store/deflate, UTF-8 nevek), külső függőség nélkül. */
  async function makeZip(files) {
    const enc = new TextEncoder()
    const parts = []
    const central = []
    let offset = 0
    const d = new Date()
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    for (const f of files) {
      const name = enc.encode(f.path)
      const raw = f.data instanceof Uint8Array ? f.data : typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(await f.data.arrayBuffer())
      const crc = crc32(raw)
      let method = 0
      let body = raw
      if (raw.length > 256 && !/\.(jpe?g|png|zip)$/i.test(f.path)) {
        const z = await deflateRaw(raw)
        if (z && z.length < raw.length) {
          method = 8
          body = z
        }
      }
      const lh = new DataView(new ArrayBuffer(30))
      lh.setUint32(0, 0x04034b50, true)
      lh.setUint16(4, 20, true)
      lh.setUint16(6, 0x0800, true)
      lh.setUint16(8, method, true)
      lh.setUint16(10, dosTime, true)
      lh.setUint16(12, dosDate, true)
      lh.setUint32(14, crc, true)
      lh.setUint32(18, body.length, true)
      lh.setUint32(22, raw.length, true)
      lh.setUint16(26, name.length, true)
      lh.setUint16(28, 0, true)
      parts.push(lh.buffer, name, body)
      const ch = new DataView(new ArrayBuffer(46))
      ch.setUint32(0, 0x02014b50, true)
      ch.setUint16(4, 20, true)
      ch.setUint16(6, 20, true)
      ch.setUint16(8, 0x0800, true)
      ch.setUint16(10, method, true)
      ch.setUint16(12, dosTime, true)
      ch.setUint16(14, dosDate, true)
      ch.setUint32(16, crc, true)
      ch.setUint32(20, body.length, true)
      ch.setUint32(24, raw.length, true)
      ch.setUint16(28, name.length, true)
      ch.setUint32(42, offset, true)
      central.push(ch.buffer, name)
      offset += 30 + name.length + body.length
    }
    const cdSize = central.reduce((s, p) => s + p.byteLength, 0)
    const end = new DataView(new ArrayBuffer(22))
    end.setUint32(0, 0x06054b50, true)
    end.setUint16(8, files.length, true)
    end.setUint16(10, files.length, true)
    end.setUint32(12, cdSize, true)
    end.setUint32(16, offset, true)
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' })
  }

  const KIND_FILE = { page: 'oldal', dialog: 'ablak', popup: 'lenyilo' }
  const TYPE_LABEL = {
    session: 'Munkamenet',
    page: 'Oldal',
    nav: 'Navigáció',
    click: 'Kattintás',
    dblclick: 'Dupla kattintás',
    contextmenu: 'Jobb kattintás',
    drag: 'Húzás',
    input: 'Mezőérték',
    key: 'Billentyű',
    submit: 'Űrlapküldés',
    overlay: 'Ablak',
    snapshot: 'Pillanatkép',
    shot: 'Képernyőkép',
    net: 'Hálózat',
    framework: 'Keretrendszer',
    ajax: 'AJAX',
    note: 'MEGJEGYZÉS',
    capture: 'Képernyő-megosztás',
    error: 'Hiba',
  }
  const mdEsc = (s) => String(s == null ? '' : s).replace(/[|`]/g, (c) => (c === '|' ? '\\|' : "'"))
  function targetText(t) {
    if (!t) return '?'
    const i = t.interactive || t
    const text = clean(i.text || i.aria || i.title || i.label || i.value || '')
    const what = i.tag === 'a' ? 'link' : i.tag === 'button' || i.role === 'button' ? 'gomb' : /^(input|select|textarea)$/.test(i.tag) ? 'mező' : i.tag
    return `${what} ${text ? `„${mdEsc(clip(text, 50))}” ` : ''}\`${mdEsc(clip(i.selector || '', 90))}\``
  }
  function whereText(t) {
    const c = (t && t.context) || {}
    const parts = []
    if (c.overlay) parts.push(`ablakban: „${mdEsc(c.overlay.title || c.overlay.short || c.overlay.id)}”`)
    if (c.table) parts.push(`táblázat: sor ${c.table.row} „${mdEsc(c.table.rowHeader)}”, oszlop ${c.table.col} „${mdEsc(c.table.colHeader)}”`)
    if (c.grid) parts.push(`rács: ${mdEsc(c.grid.row)}`)
    if (c.relative && c.relative[0]) parts.push(`vízszintes hely: ${(c.relative[0].x * 100).toFixed(1)}% (${mdEsc(c.relative[0].el)}, ${c.relative[0].w} px)`)
    return parts.length ? ` [${parts.join('; ')}]` : ''
  }
  function effectText(fx) {
    if (!fx) return ''
    if (fx.none) return ' → nincs látható hatás'
    if (fx.leftPage) return ' → elhagyta az oldalt (teljes betöltés)'
    const parts = []
    const ov = (o) => `${o.kind === 'dialog' ? 'ablak' : 'lenyíló'} „${mdEsc(o.title || o.short || '?')}”`
    if (fx.opened && fx.opened.length) parts.push('megnyílt: ' + fx.opened.map(ov).join(', '))
    if (fx.closed && fx.closed.length) parts.push('bezárult: ' + fx.closed.map(ov).join(', '))
    if (fx.newUrl) parts.push(`új URL: ${mdEsc(fx.newUrl)}`)
    if (fx.net && fx.net.length) parts.push('hálózat: ' + fx.net.slice(0, 4).map(mdEsc).join('; ') + (fx.net.length > 4 ? ` (+${fx.net.length - 4})` : ''))
    if (fx.framework && fx.framework.length) parts.push('események: ' + fx.framework.slice(0, 5).map(mdEsc).join('; '))
    if (fx.domAdded || fx.domRemoved) parts.push(`DOM +${fx.domAdded}/−${fx.domRemoved}`)
    return parts.length ? ' → ' + parts.join(' · ') : ''
  }
  function eventLine(ev, ctx) {
    const rel = (ev.t - ctx.t0) / 1000
    const time = `${pad(Math.floor(rel / 60), 2)}:${(rel % 60).toFixed(1).padStart(4, '0')}`
    const head = `- \`#${pad(ev.n)}\` ${time} · `
    const num = (u) => (ctx.nums.has(u) ? `#${pad(ctx.nums.get(u))}` : '?')
    switch (ev.type) {
      case 'session':
        return `${head}**Munkamenet: ${ev.action}**${ev.version ? ` (felvevő ${ev.version}, ${ev.screen ? ev.screen.join('×') : ''}, dpr ${ev.dpr})` : ''}`
      case 'page':
        return `${head}**Oldal** \`${mdEsc(ev.view)}\` – „${mdEsc(ev.title)}” (${ev.reason}${ev.navType ? ', ' + ev.navType : ''})${ev.fromClick ? ` ← ${num(ev.fromClick.uid)}` : ''}`
      case 'nav':
        return `${head}Navigáció (${ev.via}): ${mdEsc(ev.from)} → ${mdEsc(ev.to)}${ev.cause ? ` ← ${num(ev.cause)}` : ''}`
      case 'click':
      case 'dblclick':
      case 'contextmenu':
        if (ev.trusted === false) return `${head}${TYPE_LABEL[ev.type]} (szkriptből) ${targetText(ev.target)}`
        return `${head}**${TYPE_LABEL[ev.type]}**${ev.afterDrag ? ' (húzás végén)' : ''} ${targetText(ev.target)}${whereText(ev.target)}${effectText(ctx.effects.get(ev.uid))}`
      case 'drag':
        return `${head}**Húzás** ${targetText(ev.from)}${whereText(ev.from)} → ${targetText(ev.to)}${whereText(ev.to)} (${ev.dx}, ${ev.dy} px, ${ev.ms} ms)${effectText(ctx.effects.get(ev.uid))}`
      case 'input': {
        const f = ev.field || {}
        const v = ev.value && typeof ev.value === 'object' ? (ev.value.text != null ? `„${ev.value.text}” (${JSON.stringify(ev.value.value)})` : JSON.stringify(ev.value)) : `„${ev.value == null ? '' : ev.value}”`
        return `${head}Mezőérték (${ev.how}): ${mdEsc(f.label || f.name || f.selector)} = ${mdEsc(v)}${f.widget ? ` [${mdEsc(f.widget)}]` : ''}${f.overlay ? ` [ablak: ${mdEsc(f.overlay)}]` : ''}`
      }
      case 'key':
        return `${head}Billentyű ${ev.mods ? ev.mods + '+' : ''}${ev.key} @ ${targetText(ev.target)}`
      case 'submit':
        return `${head}**Űrlapküldés** ${(ev.form.method || '').toUpperCase()} ${mdEsc(ev.form.action || '')} – mezők: ${mdEsc((ev.fields || []).map((x) => x[0]).join(', '))}`
      case 'overlay':
        return `${head}${ev.action === 'open' ? '**Ablak megnyílt**' : 'Ablak bezárult'}: ${ev.kind === 'dialog' ? 'párbeszédablak' : 'lenyíló'} „${mdEsc(ev.title || ev.short || '?')}” \`${mdEsc(clip(ev.selector, 80))}\`${ev.cause ? ` ← ${num(ev.cause)}` : ''}${ev.action === 'open' && ev.buttons && ev.buttons.length ? ` · gombok: ${mdEsc(ev.buttons.join(', '))}` : ''}`
      case 'snapshot':
        return `${head}Pillanatkép (${KIND_FILE[ev.kind] || ev.kind}, ${ev.reason}) → [${ev.files.html}](${ev.files.html}) · [szerkezet](${ev.files.json})`
      case 'shot':
        return `${head}Képernyőkép (${mdEsc(ev.reasons.join(', '))}) → [${ev.file}](${ev.file})`
      case 'net':
        return `${head}hálózat: ${ev.init} ${mdEsc(ev.reqUrl)}${ev.status ? ' → ' + ev.status : ''} (${ev.ms} ms)`
      case 'framework':
        return `${head}${mdEsc(ev.name)}${ev.method ? ' ' + ev.method : ''}${ev.reqUrl ? ' ' + mdEsc(ev.reqUrl) : ''}${ev.status ? ' → ' + ev.status : ''}${ev.frame ? ` [frame #${mdEsc(ev.frame.id)}]` : ''}${ev.stream ? ` [stream: ${ev.stream.action} → ${mdEsc(ev.stream.target || ev.stream.targets)}]` : ''}${ev.data ? ` [${mdEsc(JSON.stringify(ev.data))}]` : ''}`
      case 'ajax':
        return `${head}AJAX ${ev.phase}: ${ev.method || ''} ${mdEsc(ev.reqUrl)}${ev.status ? ' → ' + ev.status : ''}`
      case 'note':
        return `${head}**MEGJEGYZÉS: ${mdEsc(ev.text)}**`
      case 'capture':
        return `${head}Képernyő-megosztás: ${ev.action}`
      case 'error':
        return `${head}Felvevő-hiba (${ev.where}): ${mdEsc(ev.message)}`
      default:
        return `${head}${ev.type}`
    }
  }
  function buildTimeline(events, ctx, meta) {
    const lines = [
      '# Idővonal',
      '',
      `Felvétel: \`${meta.session}\` · ${meta.start} – ${meta.end} · ${events.length} esemény`,
      '',
      'A `#szám` az esemény sorszáma (esemenyek.json `n` mezője); a ← a kiváltó kattintásra mutat.',
      'A kattintások után a hatásuk áll (megnyílt ablak, URL, hálózati kérés, DOM-változás).',
      '',
    ]
    for (const ev of events) if (ev.type !== 'effects') lines.push(eventLine(ev, ctx))
    return lines.join('\n') + '\n'
  }
  function buildMap(events, ctx, summaries) {
    const nodes = new Map()
    const edges = new Map()
    const byUid = new Map(events.map((e) => [e.uid, e]))
    const titleOf = new Map()
    for (const ev of events) if ((ev.type === 'overlay' || ev.type === 'snapshot') && ev.overlay && ev.title && !titleOf.has(ev.overlay)) titleOf.set(ev.overlay, ev.title)
    const node = (key, kind, label) => {
      let n = nodes.get(key)
      if (!n) {
        n = { id: 'n' + (nodes.size + 1), key, kind, label, visits: 0, first: null, titles: new Set(), urls: new Set(), parents: new Set(), snapshots: [], shots: [] }
        nodes.set(key, n)
      }
      return n
    }
    const pageKey = (view) => 'oldal:' + view
    const overlayKeyOf = new Map()
    const fromOf = (ev) => {
      const t = ev.target || ev.from
      const ov = t && t.context && t.context.overlay
      return (ov && overlayKeyOf.get(ov.id)) || pageKey(ev.view)
    }
    const label = (ev) => {
      const t = ev.target || ev.from || {}
      const i = t.interactive || t
      const text = clean(i.text || i.aria || i.title || i.label || i.value || '')
      const cell = t.context && t.context.table
      if (cell && (!text || i.tag === 'td' || i.tag === 'th')) return clip(`cella: ${cell.rowHeader || 'sor ' + cell.row} × ${cell.colHeader || 'oszlop ' + cell.col}`, 40)
      return clip(text || i.selector || ev.type, 40)
    }
    const edge = (from, to, via, n) => {
      if (!from || !to || from === to) return
      const k = `${from}→${to}|${via}`
      const e = edges.get(k) || { from, to, via, count: 0, examples: [] }
      e.count++
      if (e.examples.length < 5) e.examples.push(n)
      edges.set(k, e)
    }
    for (const ev of events) {
      if (ev.type === 'page') {
        const n = node(pageKey(ev.view), 'oldal', ev.view)
        n.visits++
        if (n.first == null) n.first = ev.n
        n.urls.add(ev.url)
        if (ev.title) n.titles.add(ev.title)
        const c = ev.fromClick && byUid.get(ev.fromClick.uid)
        if (c) edge(fromOf(c), n.key, label(c), c.n)
      } else if (ev.type === 'nav') {
        node(pageKey(ev.toView), 'oldal', ev.toView)
        const c = ev.cause && byUid.get(ev.cause)
        edge(c ? fromOf(c) : pageKey(ev.fromView), pageKey(ev.toView), c ? label(c) : `navigáció (${ev.via})`, ev.n)
      } else if (ev.type === 'overlay' && ev.action === 'open') {
        const title = titleOf.get(ev.overlay) || ''
        const kind = ev.kind === 'dialog' ? 'ablak' : 'lenyíló'
        const key = `${kind}:${clean(title).toLowerCase().replace(/\d+/g, '#') || ev.short || ev.selector}`
        overlayKeyOf.set(ev.overlay, key)
        const n = node(key, kind, title || ev.short || ev.selector)
        n.visits++
        if (n.first == null) n.first = ev.n
        n.parents.add(ev.view)
        const c = ev.cause && byUid.get(ev.cause)
        if (c) edge(fromOf(c), key, label(c), c.n)
        else edge(pageKey(ev.view), key, '(magától)', ev.n)
      } else if (ev.type === 'overlay' && ev.action === 'close' && ev.cause) {
        const key = overlayKeyOf.get(ev.overlay)
        const c = byUid.get(ev.cause)
        if (key && c) edge(key, pageKey(ev.view), 'bezárja: ' + label(c), c.n)
      } else if (ev.type === 'snapshot') {
        const key = ev.overlay ? overlayKeyOf.get(ev.overlay) : pageKey(ev.view)
        const n = key && (nodes.get(key) || (!ev.overlay ? node(key, 'oldal', ev.view) : null))
        if (n) n.snapshots.push({ n: ev.n, html: ev.files.html, json: ev.files.json, reason: ev.reason })
      } else if (ev.type === 'shot') {
        let attached = false
        for (const ref of ev.refs || []) {
          const r = byUid.get(ref)
          if (r && r.type === 'snapshot' && r.overlay && overlayKeyOf.get(r.overlay)) {
            nodes.get(overlayKeyOf.get(r.overlay)).shots.push({ n: ev.n, file: ev.file })
            attached = true
          }
        }
        if (!attached) node(pageKey(ev.view), 'oldal', ev.view).shots.push({ n: ev.n, file: ev.file })
      }
    }
    const nodeList = [...nodes.values()]
    const edgeList = [...edges.values()]
    const mm = (s) => String(s).replace(/"/g, '#quot;').replace(/[[\]{}|<>]/g, ' ')
    const lines = [
      '# A felvett felület térképe',
      '',
      `Felvétel: \`${ctx.meta.session}\` · ${ctx.meta.start} – ${ctx.meta.end} · ${events.length} esemény · ${ctx.meta.snapshots} pillanatkép · ${ctx.meta.shots} képernyőkép`,
      '',
      `Álnevesítés: ${state.settings.pseudonymize ? 'be (nevek → „Személy-NN”)' : 'KI'}; e-mail, telefonszám, megjegyzés mindig maszkolva.`,
      '',
      '## Nézetek',
      '',
      '| Azonosító | Nézet | Fajta | Megnyitva | Pillanatkép | Képernyőkép |',
      '|---|---|---|---|---|---|',
      ...nodeList.map((n) => `| ${n.id} | ${mdEsc(clip(n.label, 70))} | ${n.kind} | ${n.visits}× | ${n.snapshots.length} | ${n.shots.length} |`),
      '',
      '## Átmenetek',
      '',
      '```mermaid',
      'flowchart LR',
      ...nodeList.map((n) => (n.kind === 'oldal' ? `  ${n.id}["${mm(clip(n.label, 60))}"]` : n.kind === 'ablak' ? `  ${n.id}[["${mm(clip(n.label, 60))}"]]` : `  ${n.id}(["${mm(clip(n.label, 60))}"])`)),
      ...edgeList.map((e) => `  ${nodes.get(e.from).id} -->|"${mm(clip(e.via, 40))}${e.count > 1 ? ' ×' + e.count : ''}"| ${nodes.get(e.to).id}`),
      '```',
      '',
      '| Honnan | Hová | Mivel | Hányszor | Példa |',
      '|---|---|---|---|---|',
      ...edgeList.map((e) => `| ${mdEsc(clip(nodes.get(e.from).label, 50))} | ${mdEsc(clip(nodes.get(e.to).label, 50))} | ${mdEsc(e.via)} | ${e.count} | ${e.examples.map((x) => '#' + pad(x)).join(', ')} |`),
      '',
      '## Nézetek részletesen',
      '',
    ]
    for (const n of nodeList) {
      lines.push(`### ${n.id} · ${n.kind}: ${mdEsc(n.label)}`, '')
      if (n.titles.size) lines.push(`- Cím: ${[...n.titles].map(mdEsc).join(' / ')}`)
      if (n.urls.size) lines.push(`- URL-ek: ${[...n.urls].slice(0, 6).map((u) => '`' + mdEsc(u) + '`').join(', ')}`)
      if (n.parents.size) lines.push(`- Oldal: ${[...n.parents].map((u) => '`' + mdEsc(u) + '`').join(', ')}`)
      if (n.snapshots.length) lines.push(`- Pillanatképek: ${n.snapshots.map((s) => `[#${pad(s.n)}](${s.html}) ([szerkezet](${s.json}), ${s.reason})`).join(' · ')}`)
      if (n.shots.length) lines.push(`- Képernyőképek: ${n.shots.slice(0, 12).map((s) => `[#${pad(s.n)}](${s.file})`).join(' · ')}${n.shots.length > 12 ? ' …' : ''}`)
      const last = n.snapshots.length ? summaries.get(n.snapshots[n.snapshots.length - 1].json) : null
      if (last) lines.push('', ...summaryMarkdown(last))
      lines.push('')
    }
    return {
      markdown: lines.join('\n') + '\n',
      json: {
        nodes: nodeList.map((n) => ({ ...n, titles: [...n.titles], urls: [...n.urls], parents: [...n.parents] })),
        edges: edgeList.map((e) => ({ ...e, fromId: nodes.get(e.from).id, toId: nodes.get(e.to).id })),
      },
    }
  }
  function fieldRow(f) {
    let opts = ''
    if (f.options) opts = `${f.optionCount} opció: ${f.options.slice(0, 8).map((o) => `${o.text}${o.selected ? ' ✓' : ''}`).join(' · ')}${f.optionCount > 8 ? ' …' : ''}`
    else if (f.value != null && f.value !== '') opts = `érték: ${typeof f.value === 'string' ? f.value : JSON.stringify(f.value)}`
    const name = f.name || f.id || f.selector
    return `| \`${mdEsc(clip(name, 50))}\` | ${mdEsc(f.label || f.placeholder || '')} | ${mdEsc(f.type || f.tag)} | ${mdEsc(f.widget || '')} | ${f.required ? 'igen' : ''} | ${f.visible ? 'igen' : 'nem'} | ${mdEsc(clip(opts, 200))} |`
  }
  function summaryMarkdown(s) {
    const out = []
    const head = '| Mező | Címke | Típus | Widget | Kötelező | Látható | Érték / opciók |\n|---|---|---|---|---|---|---|'
    for (const f of s.forms || []) {
      out.push(`**Űrlap** \`${mdEsc(f.id || f.selector)}\` → ${(f.methodOverride || f.method || '').toUpperCase()} \`${mdEsc(f.action || '')}\`${f.data ? ` · ${mdEsc(JSON.stringify(f.data))}` : ''}`, '')
      if (f.fields.length) out.push(head, ...f.fields.slice(0, 60).map(fieldRow), '')
      if (f.hidden.length) out.push(`Rejtett mezők: ${f.hidden.map((h) => `\`${mdEsc(h.name || h.id)}\``).join(', ')}`, '')
      if (f.buttons.length) out.push(`Gombok: ${f.buttons.map((b) => `„${mdEsc(b.text || b.label || '?')}” (\`${mdEsc(clip(b.selector, 60))}\`)`).join(', ')}`, '')
    }
    if (s.items && s.items.length) out.push(`**Elemek** (${s.itemCount}): ${s.items.slice(0, 30).map((it) => `${mdEsc(it.text)}${it.selected ? ' ✓' : ''}`).join(' · ')}`, '')
    const loose = (s.looseFields || []).filter((f) => f.visible)
    if (loose.length) out.push('**Űrlapon kívüli mezők**', '', head, ...loose.slice(0, 40).map(fieldRow), '')
    const buttons = (s.buttons || []).filter((b) => b.visible)
    if (buttons.length) out.push(`**Gombok** (${buttons.length}): ${buttons.slice(0, 40).map((b) => `„${mdEsc(b.text || b.label || b.icon || '?')}” \`${mdEsc(clip(b.selector, 60))}\``).join(' · ')}`, '')
    for (const t of (s.tables || []).filter((x) => x.visible).slice(0, 6)) {
      out.push(`**Táblázat** \`${mdEsc(t.id || t.selector)}\` – ${t.rowCount} sor × ${t.colCount} oszlop`)
      if (t.headers.length) out.push(`- Fejléc: ${t.headers.map((r) => r.map(mdEsc).join(' · ')).join(' / ')}`)
      if (t.rowHeaders.length) out.push(`- Sorfejlécek: ${t.rowHeaders.slice(0, 30).map(mdEsc).join(' · ')}`)
      out.push('')
    }
    const ctrls = Object.entries(s.stimulusControllers || {})
    if (ctrls.length) out.push(`**Stimulus-vezérlők:** ${ctrls.map(([k, v]) => `${mdEsc(k)} ×${v}`).join(', ')}`, '')
    if ((s.turboFrames || []).length) out.push(`**Turbo frame-ek:** ${s.turboFrames.map((f) => `#${mdEsc(f.id)}${f.src ? ` (${mdEsc(f.src)})` : ''}`).join(', ')}`, '')
    const widgets = Object.entries(s.widgets || {})
    if (widgets.length) out.push(`**Komponensek:** ${widgets.map(([k, v]) => `${k} ×${v}`).join(', ')}`, '')
    return out
  }
  function readmeText(meta) {
    return [
      '# FlightLogger-felvétel',
      '',
      `Felvevő: ${VERSION} · felvétel: \`${meta.session}\` · ${meta.start} – ${meta.end}`,
      '',
      'Ez a mappa a FlightLogger foglalási felületének felvétele a Foglalástervező FlightLogger-importjának',
      'fejlesztéséhez. Valódi üzemi felületről készült: a projekt gitignore-olt `tests/local/` mappájába való,',
      'repóba, jelentésbe, csevegésbe nem kerülhet nyers formában (CLAUDE.md 4. pont).',
      '',
      '## Tartalom',
      '',
      '- `terkep.md` – a felület térképe: nézetek (oldalak, ablakok, lenyílók), átmenetek (mire kattintva mi nyílik),',
      '  nézetenként az űrlapok mezői, a gombok, táblázatok, vezérlők. Ezzel érdemes kezdeni.',
      '- `idovonal.md` – minden esemény időrendben, a kattintások hatásával.',
      '- `esemenyek.json` – ugyanez gépi formában (minden mező; `n` = sorszám, `uid` = hivatkozás).',
      '- `terkep.json`, `technika.json` – a térkép és az észlelt technika (Turbo, Stimulus, jQuery, React …) gépi formában.',
      '- `oldalak/` – pillanatképek: `.html` (maszkolt DOM, `data-rec-rect` = elem helye, a mezők felvételkori értékével;',
      '  böngészőben a `css/` stílusaival megnyitható) és `.json` (szerkezeti összefoglaló).',
      '- `kepek/` – képernyőképek a megosztott lapról (a kattintás helye piros kör, a nevek szürke takarással).',
      '- `css/` – az oldal stíluslapjai, a pillanatképek ezekre hivatkoznak.',
      '',
      '## Maszkolás',
      '',
      `Álnevesítés: ${state.settings.pseudonymize ? 'be' : 'KI'} – a felismert neveket „Személy-NN” helyettesíti (szövegben és képen is).`,
      'E-mail, telefonszám, megjegyzés jellegű szöveg, gépelt keresőszöveg, jelszó, token mindig maszkolva.',
      'A felismerés heurisztikus, ezért a fájlok továbbra is személyes adatnak tekintendők.',
      '',
    ].join('\n')
  }
  async function buildExport() {
    finishEffects()
    const session = state.session
    if (!session) throw new Error('Nincs felvétel.')
    const seenUids = new Set()
    const events = (await sessionEvents(session))
      .sort((a, b) => a.seq - b.seq)
      .filter((ev) => !seenUids.has(ev.uid) && seenUids.add(ev.uid))
    const blobs = await sessionBlobs(session)
    const nums = new Map(events.map((ev, i) => [ev.uid, i + 1]))
    const fileMap = new Map()
    for (const ev of events) {
      const n = pad(nums.get(ev.uid))
      if (ev.type === 'snapshot') {
        const base = `oldalak/${n}-${KIND_FILE[ev.kind] || ev.kind}-${slug(mask(ev.title || ev.view))}`
        fileMap.set(ev.files.html, base + '.html')
        fileMap.set(ev.files.json, base + '.json')
        ;(ev.files.canvases || []).forEach((c, i) => fileMap.set(c, `kepek/${n}-vaszon-${i + 1}.png`))
      } else if (ev.type === 'shot') fileMap.set(ev.file, `kepek/${n}-${slug(ev.reasons.join(' '))}.jpg`)
    }
    for (const key of blobs.keys()) if (key.startsWith('css/')) fileMap.set(key, key)
    const files = []
    const summaries = new Map()
    for (const [key, blob] of blobs) {
      const path = fileMap.get(key)
      if (!path) continue
      if (path.endsWith('.css')) files.push({ path, data: blob })
      else if (path.endsWith('.html')) {
        // Végső maszkolás a teljes névlistával (a felvétel közben később felismert nevekre is).
        const text = mask(await blob.text()).replace(/data-rec-canvas-file="(canvas\/[^"]+)"/g, (m, f) => (fileMap.has(f) ? `data-rec-canvas-file="../${fileMap.get(f)}"` : m))
        files.push({ path, data: text })
      } else if (path.endsWith('.json')) {
        const raw = await blob.text()
        const parsed = deepMask(safe(() => JSON.parse(raw)) ?? null)
        if (parsed) summaries.set(path, parsed)
        files.push({ path, data: JSON.stringify(parsed, null, 1) })
      } else files.push({ path, data: blob })
    }
    const remap = (p) => fileMap.get(p) || p
    const exported = events.map((ev) => {
      const out = { n: nums.get(ev.uid), ...ev, at: new Date(ev.t).toISOString() }
      delete out.seq
      delete out.session
      if (ev.type === 'snapshot') out.files = { html: remap(ev.files.html), json: remap(ev.files.json), canvases: (ev.files.canvases || []).map(remap) }
      if (ev.type === 'shot') out.file = remap(ev.file)
      return deepMask(out)
    })
    const t0 = exported.length ? exported[0].t : Date.now()
    const meta = {
      session,
      start: new Date(t0).toLocaleString('hu-HU'),
      end: new Date(exported.length ? exported[exported.length - 1].t : Date.now()).toLocaleString('hu-HU'),
      snapshots: exported.filter((e) => e.type === 'snapshot').length,
      shots: exported.filter((e) => e.type === 'shot').length,
    }
    const effects = new Map(exported.filter((e) => e.type === 'effects').map((e) => [e.ref, e]))
    const ctx = { t0, nums, effects, meta }
    const map = buildMap(exported, ctx, summaries)
    const tech = {}
    for (const ev of exported) if (ev.type === 'page' && ev.tech) tech[ev.view] = ev.tech
    files.push(
      { path: 'OLVASS-EL.md', data: readmeText(meta) },
      { path: 'terkep.md', data: map.markdown },
      { path: 'idovonal.md', data: buildTimeline(exported, ctx, meta) },
      { path: 'esemenyek.json', data: JSON.stringify(exported, null, 1) },
      { path: 'terkep.json', data: JSON.stringify(map.json, null, 1) },
      { path: 'technika.json', data: JSON.stringify(tech, null, 1) },
    )
    files.sort((a, b) => a.path.localeCompare(b.path))
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
    return { name: `fl-felvetel-${stamp}`, files }
  }
  async function exportZip() {
    if (!state.session) throw new Error('Nincs mit exportálni.')
    showMessage('Export készül…')
    const { name, files } = await buildExport()
    const blob = await makeZip(files.map((f) => ({ path: `${name}/${f.path}`, data: f.data })))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.setAttribute(OWN_ATTR, '1')
    a.href = url
    a.download = `${name}.zip`
    document.documentElement.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    showMessage(`Letöltve: ${name}.zip (${fmtBytes(blob.size)}). Tedd a projekt tests/local/fl-felvetel/ mappájába.`)
    return { name, size: blob.size, files: files.length }
  }

  // ------------------------------------------------------------------ vezérlés

  function toggleRecording() {
    if (state.recording) {
      finishEffects()
      record('session', { action: 'szünet' })
      state.recording = false
      saveState()
      updatePanel()
      showMessage('Felvétel szüneteltetve.')
      return
    }
    const fresh = !state.session
    if (fresh) {
      state.session = 'f' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '-' + Math.random().toString(36).slice(2, 6)
      state.startedAt = Date.now()
      counts = emptyCounts()
      lastPageSig = null
    }
    state.recording = true
    saveState()
    record('session', {
      action: fresh ? 'indítás' : 'folytatás',
      version: VERSION,
      userAgent: navigator.userAgent,
      screen: [screen.width, screen.height],
      viewport: [innerWidth, innerHeight],
      dpr: devicePixelRatio,
      lang: navigator.language,
      settings: state.settings,
    })
    updatePanel()
    showMessage(fresh ? 'Felvétel elindult.' : 'Felvétel folytatódik.')
    capturePage(fresh ? 'indítás' : 'folytatás', false)
  }
  async function manualSnapshot() {
    if (!state.recording) throw new Error('Előbb indítsd el a felvételt.')
    harvestNames()
    scanOverlays()
    const ev = await snapshotPage('kézi', null, true)
    for (const [el, info] of openOverlays) await snapshotOverlay(el, info, 'kézi', true)
    requestShot('kézi', ev ? ev.uid : null)
    showMessage('Pillanatkép elmentve.')
  }
  function addNote() {
    if (!state.recording) return showMessage('Előbb indítsd el a felvételt.', true)
    const text = window.prompt('Megjegyzés a felvételhez – mit csinálsz most, mit vársz? (a felvételbe kerül)')
    if (text && text.trim()) {
      record('note', { text: mask(text.trim()) })
      showMessage('Megjegyzés rögzítve.')
    }
  }
  async function clearAll() {
    if (!window.confirm('Törlöd a felvételt (események, pillanatképek, képernyőképek)? Ez nem vonható vissza – exportáltad már?')) return
    finishEffects()
    await tx('events', 'readwrite', (s) => s.clear())
    await tx('blobs', 'readwrite', (s) => s.clear())
    state.recording = false
    state.session = null
    state.startedAt = null
    saveState()
    counts = emptyCounts()
    safe(() => localStorage.removeItem(KEY_COUNTS))
    lastPageSig = null
    updatePanel()
    showMessage('A felvétel törölve. A névlista megmaradt.')
  }
  const nameLine = (e) => (e.code ? `${e.code} - ${e.name}` : e.name)
  function saveNames(text) {
    const lines = [...new Set(text.split('\n').map(clean).filter(Boolean))]
    // Egy sor lehet „KÓD - Név” vagy csak a név; a megtartást a név szerint döntjük el.
    const bare = (l) => {
      const coded = PERSON_LINE_RE.exec(l)
      return nameKey(coded ? coded[2] : l)
    }
    const keep = new Set(lines.map(bare))
    const excluded = new Set(state.names.excluded)
    for (const e of state.names.entries) if (!keep.has(nameKey(e.name))) excluded.add(nameKey(e.name))
    for (const l of lines) excluded.delete(bare(l))
    state.names.excluded = [...excluded]
    state.names.entries = state.names.entries.filter((e) => keep.has(nameKey(e.name)))
    saveState()
    addNames(lines, 'kézi')
    rebuildNames()
    updatePanel()
    showMessage(`Névlista mentve: ${state.names.entries.length} név.`)
  }

  // ------------------------------------------------------------------ panel

  const PANEL_HTML = `
<style>
  :host { all: initial; }
  .p { font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #e8ecf3; background: #1d2433;
       border: 1px solid #39435a; border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.35); width: 300px; overflow: hidden; }
  .hd { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 10px; background: #252e42; cursor: move; user-select: none; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
  .dot.on { background: #ef4444; box-shadow: 0 0 0 3px rgba(239,68,68,.25); }
  .dot.paused { background: #f59e0b; }
  .ttl { font-weight: 600; flex: 1; }
  .cnt { color: #aab3c5; font-variant-numeric: tabular-nums; }
  .bd { padding: 8px 10px 10px; display: grid; gap: 7px; }
  .p.collapsed .bd { display: none; }
  .p.collapsed { width: auto; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  button { font: inherit; color: #e8ecf3; background: #334058; border: 1px solid #46526c; border-radius: 6px; padding: 4px 8px; cursor: pointer; }
  button:hover { background: #3d4b66; }
  button.pri { background: #2563eb; border-color: #2563eb; }
  button.pri.stop { background: #b45309; border-color: #b45309; }
  button.warn { background: transparent; border-color: #7f1d1d; color: #fca5a5; }
  button:disabled { opacity: .45; cursor: default; }
  .hd button { padding: 0 7px; line-height: 18px; }
  .st { color: #aab3c5; }
  .cam.on { color: #86efac; }
  .msg { color: #9fe3b0; min-height: 1em; word-break: break-word; }
  .msg.err { color: #fca5a5; }
  label { display: flex; gap: 6px; align-items: center; color: #cfd6e4; cursor: pointer; }
  details summary { cursor: pointer; color: #cfd6e4; }
  .set { display: grid; gap: 6px; padding-top: 6px; }
  textarea { width: 100%; box-sizing: border-box; height: 130px; font: 11px/1.35 ui-monospace, Menlo, monospace; background: #111827;
             color: #e8ecf3; border: 1px solid #46526c; border-radius: 6px; padding: 6px; resize: vertical; }
  .hint { color: #8b95a8; font-size: 11px; }
</style>
<div class="p">
  <div class="hd" data-drag><span class="dot"></span><span class="ttl">FL felvevő</span><span class="cnt" data-cnt></span><button data-act="collapse" title="Összecsukás / kinyitás">–</button></div>
  <div class="bd">
    <div class="st" data-status></div>
    <div class="row"><button class="pri" data-act="toggle"></button><button data-act="snapshot" title="Alt+Shift+P">Pillanatkép</button><button data-act="note" title="Alt+Shift+M">Megjegyzés</button></div>
    <div class="row"><button data-act="capture"></button><span class="st cam" data-cam></span></div>
    <div class="row"><button data-act="export">Export (ZIP)</button><button class="warn" data-act="clear">Törlés</button></div>
    <details><summary>Beállítások</summary>
      <div class="set">
        <label><input type="checkbox" data-set="shotAfterClick"> Képernyőkép minden kattintás után</label>
        <label><input type="checkbox" data-set="pseudonymize"> Nevek álnevesítése</label>
        <div class="row"><button data-act="names">Névlista</button><span class="st" data-names></span></div>
        <div data-names-box hidden>
          <textarea data-names-text spellcheck="false"></textarea>
          <div class="hint">Soronként egy név. A kitörölt nevet a felvevő többé nem veszi fel magától.</div>
          <div class="row"><button data-act="names-save">Mentés</button><button data-act="names-close">Bezárás</button></div>
        </div>
      </div>
    </details>
    <div class="msg" data-msg></div>
  </div>
</div>`

  let panelTimer = null
  function schedulePanelUpdate() {
    if (panelTimer) return
    panelTimer = setTimeout(() => {
      panelTimer = null
      updatePanel()
    }, 200)
  }
  function updatePanel() {
    if (!ui) return
    const q = (s) => ui.root.querySelector(s)
    ui.panel.classList.toggle('collapsed', !!state.panel.collapsed)
    q('[data-act="collapse"]').textContent = state.panel.collapsed ? '+' : '–'
    const dot = q('.dot')
    dot.className = 'dot' + (state.recording ? ' on' : state.session ? ' paused' : '')
    const toggle = q('[data-act="toggle"]')
    toggle.textContent = state.recording ? 'Szünet' : state.session ? 'Folytatás' : 'Felvétel indítása'
    toggle.classList.toggle('stop', state.recording)
    if (counts.session !== state.session) counts = emptyCounts()
    q('[data-cnt]').textContent = state.session ? String(counts.events) : ''
    q('[data-status]').textContent =
      (state.recording ? 'Felvétel fut' : state.session ? 'Szünetel' : 'Nincs felvétel') +
      (state.session ? ` · ${counts.events} esemény · ${counts.snapshots} pillanatkép · ${counts.shots} kép · ${fmtBytes(counts.bytes)}` : '')
    q('[data-act="capture"]').textContent = capture ? 'Megosztás leállítása' : 'Képernyő-megosztás'
    const cam = q('[data-cam]')
    cam.textContent = capture ? 'képernyőkép: aktív' : 'képernyőkép: nincs'
    cam.classList.toggle('on', !!capture)
    q('[data-act="snapshot"]').disabled = !state.recording
    q('[data-act="note"]').disabled = !state.recording
    q('[data-act="export"]').disabled = !state.session
    q('[data-act="clear"]').disabled = !state.session
    for (const cb of ui.root.querySelectorAll('[data-set]')) cb.checked = !!state.settings[cb.getAttribute('data-set')]
    q('[data-names]').textContent = `${state.names.entries.length} név`
  }
  function showMessage(text, isError) {
    if (isError) console.warn('[FL felvevő]', text)
    if (!ui) return
    const el = ui.root.querySelector('[data-msg]')
    el.textContent = text
    el.classList.toggle('err', !!isError)
  }
  function applyPanelPosition() {
    const p = state.panel
    if (p.left == null || p.top == null) {
      host.style.left = '12px'
      host.style.bottom = '12px'
      host.style.top = 'auto'
      return
    }
    host.style.left = Math.max(0, Math.min(p.left, innerWidth - 80)) + 'px'
    host.style.top = Math.max(0, Math.min(p.top, innerHeight - 30)) + 'px'
    host.style.bottom = 'auto'
  }
  async function onPanelClick(e) {
    const btn = e.target instanceof Element && e.target.closest('[data-act]')
    if (!btn) return
    const act = btn.getAttribute('data-act')
    try {
      if (act === 'toggle') toggleRecording()
      else if (act === 'collapse') {
        state.panel.collapsed = !state.panel.collapsed
        saveState()
        updatePanel()
      } else if (act === 'snapshot') await manualSnapshot()
      else if (act === 'note') addNote()
      else if (act === 'capture') {
        if (capture) stopCapture(true)
        else await startCapture()
      } else if (act === 'export') await exportZip()
      else if (act === 'clear') await clearAll()
      else if (act === 'names') {
        ui.root.querySelector('[data-names-text]').value = state.names.entries.map(nameLine).join('\n')
        ui.root.querySelector('[data-names-box]').hidden = false
      } else if (act === 'names-save') saveNames(ui.root.querySelector('[data-names-text]').value)
      else if (act === 'names-close') ui.root.querySelector('[data-names-box]').hidden = true
    } catch (err) {
      showMessage((err && err.message) || String(err), true)
    }
  }
  function buildPanel() {
    if (host) {
      if (!host.isConnected) document.documentElement.appendChild(host)
      return
    }
    host = document.createElement('div')
    host.id = HOST_ID
    host.setAttribute(OWN_ATTR, 'panel')
    host.setAttribute('style', 'all:initial;position:fixed;z-index:2147483647;')
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = PANEL_HTML
    ui = { root, panel: root.querySelector('.p') }
    root.addEventListener('click', onPanelClick)
    root.addEventListener('change', (e) => {
      const key = e.target instanceof Element && e.target.getAttribute('data-set')
      if (!key) return
      state.settings[key] = e.target.checked
      saveState()
      record('session', { action: 'beállítás', settings: state.settings })
    })
    root.querySelector('[data-drag]').addEventListener('pointerdown', (e) => {
      if (e.target instanceof Element && e.target.closest('button')) return
      const r = ui.panel.getBoundingClientRect()
      const ox = e.clientX - r.left
      const oy = e.clientY - r.top
      const move = (ev) => {
        state.panel.left = Math.round(ev.clientX - ox)
        state.panel.top = Math.round(ev.clientY - oy)
        applyPanelPosition()
      }
      const up = () => {
        window.removeEventListener('pointermove', move, true)
        window.removeEventListener('pointerup', up, true)
        saveState()
      }
      window.addEventListener('pointermove', move, true)
      window.addEventListener('pointerup', up, true)
    })
    applyPanelPosition()
    document.documentElement.appendChild(host)
    updatePanel()
  }

  // ------------------------------------------------------------------ indulás

  rebuildNames()
  flushQueue()
  for (const type of ['click', 'dblclick', 'contextmenu']) window.addEventListener(type, onPointerEvent, true)
  window.addEventListener('pointerdown', onPointerDown, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('input', onInputEvent, true)
  document.addEventListener('change', onInputEvent, true)
  document.addEventListener('submit', onSubmit, true)
  for (const type of FW_EVENTS) document.addEventListener(type, onFrameworkEvent, true)
  window.addEventListener('popstate', () => checkUrl('popstate'))
  window.addEventListener('hashchange', () => checkUrl('hash'))
  if (window.navigation && window.navigation.addEventListener) window.navigation.addEventListener('navigatesuccess', () => checkUrl('navigation-api'))
  setInterval(() => checkUrl('url-figyelés'), 400)
  window.addEventListener('pagehide', () => finishEffects(true))
  window.addEventListener('pageshow', (e) => {
    if (e.persisted && state.recording) capturePage('visszalépés (gyorsítótárból)', true)
  })
  window.addEventListener('storage', (e) => {
    if (e.key === KEY_STATE) {
      const was = state.recording
      state = readState()
      rebuildNames()
      if (state.recording && !was) capturePage('másik lapon indítva', false)
      updatePanel()
    } else if (e.key === KEY_COUNTS) {
      counts = readCounts()
      updatePanel()
    }
  })
  window.addEventListener('resize', () => host && applyPanelPosition())
  try {
    new PerformanceObserver((list) => {
      for (const en of list.getEntries()) onResource(en)
    }).observe({ type: 'resource', buffered: true })
  } catch {
    /* régi böngésző: hálózati napló nélkül */
  }

  function onReady() {
    buildPanel()
    new MutationObserver(onMutations).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'open', 'hidden', 'aria-hidden', 'aria-expanded'],
    })
    for (const type of ['transitionend', 'animationend']) document.addEventListener(type, () => state.recording && scheduleScan(), true)
    hookJQuery()
    window.addEventListener('load', hookJQuery)
    if (state.recording) capturePage('betöltés', true)
    else setTimeout(() => (heuristicArmed = true), 3000)
    setInterval(() => {
      if (host && !host.isConnected) document.documentElement.appendChild(host)
    }, 2000)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady, { once: true })
  else onReady()

  // Teszteléshez és hibakereséshez a konzolból.
  window.flightbookerFelvevo = {
    version: VERSION,
    get state() {
      return state
    },
    mask,
    maskUrl,
    viewKey,
    looksLikeName,
    harvestNames,
    sensitiveRanges,
    serializeTree,
    summarize,
    buildExport,
    makeZip,
    exportZip,
    manualSnapshot,
    toggleRecording,
    useStream,
    takeShot: () => takeShot(['teszt'], [], null),
  }
})()
