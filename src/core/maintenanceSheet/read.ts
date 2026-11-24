import { MAINTENANCE_TYPES, type MaintenanceType } from '../model/resources'
import type { GrayImage, RgbaImage } from './image'
import { analyzeLayout, TEXT_HEIGHT } from './layout'
import { assignLines, buildMosaic, leadingWord, type OcrLine, type OcrReading } from './mosaic'
import { looksLikeRegistration, matchRegistration, nearestRegistrationDistance, normalizeRegistration, registrationAlphabet, type FleetAircraft, type RegistrationMatch } from './registration'
import type { Box, Token, TokenRow } from './tokens'

/**
 * A karbantartási táblázat fotójának értelmezése (ERF-04).
 *
 * 1. Elrendezés: cellaszövegek és sorok a képen (saját elemzés, `layout.ts`).
 * 2. Első olvasás minden cellára, általános karakterkészlettel.
 * 3. Sorok: azok, amelyekben flottabeli lajstromjel áll. Oszlopok: a lajstromtól jobbra álló
 *    cellák vízszintes helyzet szerint csoportosítva.
 * 4. Oszlopszerepek: az a három számoszlop (Aktuális, Következő, Hátralévő), amelyre a legtöbb
 *    sorban teljesül, hogy Hátralévő = Következő − Aktuális. Ha ez nem dönt, a fejléc szövege.
 * 5. Második olvasás szűkített karakterkészlettel (számjegyek, illetve a flotta jelei).
 * 6. Soronként az a két olvasatból összerakott érték, amely kiállja az ellenőrzést; ami
 *    nem, az „ellenőrizendő”. Mentés előtt a felhasználó mindig átnézi az eredményt.
 * 7. A karbantartás fajtája („200 órás”) a hátralévő idő oszlopától jobbra (SZB-06).
 */

/** OCR-motor: a mozaikképből felismert sorok. `whitelist` üres: nincs megszorítás. */
export type OcrEngine = (image: GrayImage, whitelist: string) => Promise<readonly OcrLine[]>

export type SheetRowStatus =
  /** A három érték egyezik (Hátralévő = Következő − Aktuális). */
  | 'ok'
  /** Van javasolt érték, de nem ellenőrizhető vagy ellentmondásos: nézd meg a képen. */
  | 'check'
  /** A táblázatban nincs óraszám ennél a gépnél. */
  | 'empty'
  /** Nem olvasható. */
  | 'unreadable'

export interface SheetRow {
  /** A lajstromjel, ahogy a képen olvasható. */
  readonly registration: string
  /** A flottabeli gép; ismeretlen lajstromnál `null`. */
  readonly aircraftId: string | null
  readonly callSign: string | null
  readonly current: number | null
  readonly next: number | null
  readonly remaining: number | null
  /** Javasolt kirepülhető idő (óra a karbantartásig). */
  readonly hours: number | null
  /** A következő karbantartás fajtája („50 órás” → 50), ha egyértelműen olvasható. */
  readonly maintenanceType: MaintenanceType | null
  readonly status: SheetRowStatus
  readonly notes: readonly string[]
}

export interface SheetReading {
  /** A táblázat dátuma (ÉÉÉÉ-HH-NN), ha olvasható. */
  readonly date: string | null
  readonly rows: readonly SheetRow[]
  /** Flottabeli gépek, amelyek nem szerepelnek a képen. */
  readonly missingAircraftIds: readonly string[]
  readonly warnings: readonly string[]
}

const DIGITS = '-0123456789'
const TYPE_DIGITS = '0125'
const WEEKDAY_NAMES = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat']
const T = TEXT_HEIGHT

const centerX = (t: Token): number => (t.x0 + t.x1) / 2
const tokenWidth = (t: Token): number => t.x1 - t.x0 + 1

/** Egész szám az OCR-szövegből; a tipikus betű–szám tévesztéseket javítjuk. */
export function parseInteger(text: string): number | null {
  const t = text
    .replace(/\s+/g, '')
    .replace(/[—–~_=]/g, '-')
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/S/g, '5')
    .replace(/[.,]$/, '')
  if (!/^-?\d{1,6}$/.test(t)) return null
  return Number(t)
}

const isMaintenanceType = (n: number | null): n is MaintenanceType => n !== null && (MAINTENANCE_TYPES as readonly number[]).includes(n)

/** A karbantartás fajtája egy cellaszövegből („200 órás”, „100órás”, „5O”). */
export function parseMaintenanceType(text: string): MaintenanceType | null {
  const lead = /^\s*([0-9OoIl|S]{2,3})(?![0-9])/.exec(text)
  const value = parseInteger(lead?.[1] ?? '')
  return isMaintenanceType(value) ? value : null
}

/** Dátum a táblázat fejlécéből (pl. „2026.10.29.”). */
export function parseSheetDate(text: string): string | null {
  const m = /(20\d{2})\s*[.\-/ ]\s*(\d{1,2})\s*[.\-/ ]\s*(\d{1,2})/.exec(text)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const WEEKDAYS = ['vasarnap', 'hetfo', 'kedd', 'szerda', 'csutortok', 'pentek', 'szombat']

function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = tmp
    }
  }
  return prev[b.length]!
}

/** A fejléc napneve (0 = vasárnap … 6 = szombat), ha a szövegben szerepel. */
export function parseWeekday(text: string): number | null {
  for (const word of text.split(/\s+/)) {
    const w = normalizeText(word)
    if (w.length < 4) continue
    const hit = WEEKDAYS.findIndex((name) => levenshtein(w, name) <= Math.max(1, Math.floor(name.length / 4)))
    if (hit >= 0) return hit
  }
  return null
}

const normalizeText = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

interface Located {
  readonly row: number
  readonly token: Token
  readonly index: number
}

interface DataRow {
  readonly row: TokenRow
  readonly reg: Located
  readonly match: RegistrationMatch | undefined
  /** Oszloponként a cella darabja (ha van). */
  cells: Array<Located | undefined>
}

/** Egy mozaikkép legfeljebb ennyi darabot tartalmaz (a Tesseract képméret-korlátja miatt). */
const MOSAIC_CHUNK = 80

async function readBoxes(engine: OcrEngine, image: GrayImage, tokens: readonly Box[], whitelist: string, thresholdShift = 0): Promise<OcrReading[]> {
  const out: OcrReading[] = []
  for (let i = 0; i < tokens.length; i += MOSAIC_CHUNK) {
    const mosaic = buildMosaic(image, tokens.slice(i, i + MOSAIC_CHUNK), thresholdShift)
    out.push(...assignLines(mosaic, await engine(mosaic.image, whitelist)))
  }
  return out
}

/** Ennél több szövegdarab nem táblázatfotó (vagy rossz tájolás); nem olvassuk végig. */
const MAX_TOKENS = 600

/**
 * A fotó beolvasása. Ha álló helyzetben, EXIF-tájolás nélkül készült (oldalra fordult a
 * táblázat), a 90°-kal elforgatott változatokat is kipróbáljuk.
 */
export async function readMaintenanceSheet(rgba: RgbaImage, fleet: readonly FleetAircraft[], engine: OcrEngine): Promise<SheetReading> {
  let best: SheetReading | undefined
  for (const turns of [0, 1, 3, 2]) {
    const reading = await readOriented(rgba, turns, fleet, engine)
    if (reading.rows.length >= 3) return reading
    if (!best || reading.rows.length > best.rows.length) best = reading
  }
  return best!
}

async function readOriented(rgba: RgbaImage, quarterTurns: number, fleet: readonly FleetAircraft[], engine: OcrEngine): Promise<SheetReading> {
  const layout = analyzeLayout(rgba, quarterTurns)
  const warnings: string[] = []

  // 1. Első olvasás: minden szövegméretű darab. A kivágás magassága legalább a sor
  //    betűmagassága: ha egy darab felismert része csonka (például vonal szelte ketté),
  //    az OCR így is a teljes számjegyeket kapja.
  const located: Located[] = []
  layout.rows.forEach((r, row) => {
    const heights = r.tokens.map((t) => t.charHeight).filter((h) => h >= T * 0.55).sort((p, q) => p - q)
    const rowHeight = heights[Math.floor(heights.length / 2)] ?? T
    r.tokens.forEach((t) => {
      if (t.charHeight < T * 0.55) return
      const mid = r.a + r.b * centerX(t)
      const token = { ...t, y0: Math.min(t.y0, Math.round(mid - rowHeight * 0.55)), y1: Math.max(t.y1, Math.round(mid + rowHeight * 0.55)) }
      located.push({ row, token, index: located.length })
    })
  })
  if (located.length > MAX_TOKENS) {
    return { date: null, rows: [], missingAircraftIds: fleet.map((a) => a.id), warnings: ['A képen túl sok apró szövegrész van; a táblázatot nem találtam.'] }
  }
  const pass1 = await readBoxes(
    engine,
    layout.image,
    located.map((l) => l.token),
    '',
  )
  const text1 = (l: Located): string => pass1[l.index]?.text ?? ''

  // A dátum több darabra is eshet („2026” „11.02.”), ezért soronként egyben keressük.
  const rowTexts = layout.rows.map((_, row) =>
    located
      .filter((l) => l.row === row)
      .map(text1)
      .join(' '),
  )
  let date = rowTexts.map(parseSheetDate).find((d) => d !== null) ?? null
  // A dátumot a fejléc napnevével vetjük össze; ha ellentmond, nem fogadjuk el.
  const weekday = rowTexts.map(parseWeekday).find((d) => d !== null) ?? null
  if (date && weekday !== null) {
    const actual = new Date(`${date}T12:00:00Z`).getUTCDay()
    if (actual !== weekday) {
      warnings.push(`A táblázat dátuma bizonytalan: ${date.replaceAll('-', '.')}. olvasható, de a fejlécben ${WEEKDAY_NAMES[weekday]} áll. A dátumot nem vettem át.`)
      date = null
    }
  }

  // 2. Adatsorok: amelyekben lajstromjel áll.
  const byRow = new Map<number, Located[]>()
  for (const l of located) byRow.set(l.row, [...(byRow.get(l.row) ?? []), l])
  const dataRows: DataRow[] = []
  for (const [row, list] of [...byRow.entries()].sort((p, q) => p[0] - q[0])) {
    let best: { l: Located; match: RegistrationMatch | undefined; score: number } | undefined
    for (const l of list) {
      const text = text1(l)
      const match = fleet.length > 0 ? matchRegistration(text, fleet) : undefined
      // Kétértelmű vagy csonka olvasat is jelölt lehet: a szűkített második olvasat dönt.
      const near = fleet.length > 0 && !match && nearestRegistrationDistance(text, fleet) <= 1.6
      const score = match ? 2 - match.distance : near ? 0.6 : looksLikeRegistration(text) ? 0.5 : -1
      if (score > (best?.score ?? 0)) best = { l, match, score }
    }
    if (best) dataRows.push({ row: layout.rows[row]!, reg: best.l, match: best.match, cells: [] })
  }
  // Flottán kívüli lajstrom csak a lajstromoszlopban fogadható el (a többi szó a fejlécből jön).
  const matchedX = dataRows.filter((d) => d.match).map((d) => centerX(d.reg.token)).sort((p, q) => p - q)
  if (matchedX.length > 0) {
    const regX = matchedX[Math.floor(matchedX.length / 2)]!
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const d = dataRows[i]!
      if (!d.match && Math.abs(centerX(d.reg.token) - regX) > T * 3) dataRows.splice(i, 1)
    }
  }
  if (dataRows.length === 0) {
    return { date, rows: [], missingAircraftIds: fleet.map((a) => a.id), warnings: ['Nem találtam lajstromjelet a képen. Olyan fotó kell, amelyen a teljes táblázat élesen látszik.'] }
  }

  // 3. Oszlopok: a lajstromtól jobbra eső cellák vízszintes helyzet szerint.
  const right = (d: DataRow): Located[] =>
    (byRow.get(layout.rows.indexOf(d.row)) ?? []).filter((l) => l.token.x0 > d.reg.token.x1 && l.token.charHeight >= T * 0.7)
  const centers = dataRows.flatMap((d) => right(d).map((l) => centerX(l.token))).sort((p, q) => p - q)
  const groups: number[][] = []
  for (const c of centers) {
    const last = groups[groups.length - 1]
    if (last && c - last[last.length - 1]! <= T * 3) last.push(c)
    else groups.push([c])
  }
  const minSupport = Math.max(2, Math.ceil(dataRows.length * 0.3))
  const columns = groups.filter((g) => g.length >= minSupport).map((g) => g.reduce((s, v) => s + v, 0) / g.length)
  for (const d of dataRows) {
    d.cells = columns.map((cx) => {
      const near = right(d).filter((l) => Math.abs(centerX(l.token) - cx) <= T * 3)
      return near.sort((p, q) => tokenWidth(q.token) - tokenWidth(p.token))[0]
    })
  }

  // 4. Oszlopszerepek az aritmetikai összefüggésből, végső esetben a fejlécből.
  const num1 = (l: Located | undefined): number | null => (l ? parseInteger(text1(l)) : null)
  let roles: { current: number; next: number; remaining: number } | undefined
  let bestScore = 0
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      for (let k = j + 1; k < columns.length; k++) {
        let score = 0
        for (const d of dataRows) {
          const c = num1(d.cells[i])
          const n = num1(d.cells[j])
          const r = num1(d.cells[k])
          if (c !== null && n !== null && r !== null && Math.abs(n - c - r) <= 1) score++
        }
        if (score > bestScore) {
          bestScore = score
          roles = { current: i, next: j, remaining: k }
        }
      }
    }
  }
  if (bestScore < Math.min(3, dataRows.length)) {
    const headerColumn = (...keys: string[]): number | undefined => {
      const hit = located.find((l) => keys.some((k) => normalizeText(text1(l)).includes(k)))
      if (!hit || columns.length === 0) return undefined
      const x = centerX(hit.token)
      return columns.map((cx, i) => ({ i, d: Math.abs(cx - x) })).sort((p, q) => p.d - q.d)[0]!.i
    }
    const remaining = headerColumn('hatral', 'hatra', 'tartasig')
    const current = headerColumn('aktual', 'oraszam')
    const next = headerColumn('kovetkez', 'kovetk')
    if (remaining !== undefined) {
      roles = { current: current ?? -1, next: next ?? -1, remaining }
      warnings.push('Az oszlopokat a fejléc alapján azonosítottam; az értékeket nem tudtam a „Következő − Aktuális” különbséggel ellenőrizni.')
    } else roles = undefined
  }
  if (!roles) {
    return {
      date,
      rows: [],
      missingAircraftIds: fleet.map((a) => a.id),
      warnings: ['Nem találtam a „Hátralévő idő karbantartásig” oszlopot. Olyan fotó kell, amelyen a teljes táblázat élesen látszik.'],
    }
  }
  const { current: ci, next: ni, remaining: ri } = roles

  // 5. Második olvasás szűkített karakterkészlettel.
  const numeric = dataRows.flatMap((d) => [d.cells[ci], d.cells[ni], d.cells[ri]]).filter((l): l is Located => l !== undefined)
  const pass2Numbers = await readBoxes(
    engine,
    layout.image,
    numeric.map((l) => l.token),
    DIGITS,
  )
  // Cellánként a jelölt értékek, előnyben a szűkített olvasattal.
  const candidates = new Map<number, number[]>()
  const addCandidate = (l: Located, value: number | null): void => {
    if (value === null) return
    const list = candidates.get(l.index) ?? []
    if (!list.includes(value)) list.push(value)
    candidates.set(l.index, list)
  }
  numeric.forEach((l, i) => addCandidate(l, parseInteger(pass2Numbers[i]?.text ?? '')))
  numeric.forEach((l) => addCandidate(l, num1(l)))
  const options = (l: Located | undefined): number[] => (l ? (candidates.get(l.index) ?? []) : [])
  const findConsistent = (d: DataRow): { c: number; n: number; r: number } | undefined => {
    for (const r of options(d.cells[ri])) for (const c of options(d.cells[ci])) for (const n of options(d.cells[ni])) if (n - c === r) return { c, n, r }
    return undefined
  }

  // 5b. Ahol a három szám nem áll össze, újraolvasás vékonyabb és vastagabb vonalú
  //     binarizálással: a további jelöltek között gyakran ott a helyes olvasat.
  const failing = dataRows.filter((d) => !findConsistent(d))
  const retry = failing.flatMap((d) => [d.cells[ci], d.cells[ni], d.cells[ri]]).filter((l): l is Located => l !== undefined)
  if (retry.length > 0) {
    for (const shift of [-25, 20]) {
      const reads = await readBoxes(
        engine,
        layout.image,
        retry.map((l) => l.token),
        DIGITS,
        shift,
      )
      retry.forEach((l, i) => addCandidate(l, parseInteger(reads[i]?.text ?? '')))
    }
  }
  const pass2Regs = await readBoxes(
    engine,
    layout.image,
    dataRows.map((d) => d.reg.token),
    registrationAlphabet(fleet),
  )

  // 7. A karbantartás fajtája: a hátralévő idő cellájától jobbra eső első darab.
  const typeCells = dataRows.map((d) => {
    const remainingCell = d.cells[ri]
    if (!remainingCell) return undefined
    return (byRow.get(layout.rows.indexOf(d.row)) ?? []).filter((l) => l.token.x0 > remainingCell.token.x1).sort((p, q) => p.token.x0 - q.token.x0)[0]
  })
  const typeLocated = typeCells.filter((l): l is Located => l !== undefined)
  // A szám a cella első szava; csak a lehetséges számjegyekkel (25, 50, 100, 200) olvassuk
  // újra, mert a félkövér 5-öst az általános olvasás gyakran 8-asnak látja.
  const typeBoxes = typeLocated.map((l) => leadingWord(layout.image, l.token) ?? l.token)
  const pass2Types = await readBoxes(engine, layout.image, typeBoxes, TYPE_DIGITS)
  const typeOf = (l: Located | undefined): { type: MaintenanceType | null; note?: string } => {
    if (!l) return { type: null }
    const first = parseMaintenanceType(text1(l))
    const second = parseMaintenanceType(pass2Types[typeLocated.indexOf(l)]?.text ?? '')
    if (first !== null && second !== null && first !== second) return { type: null, note: `A karbantartás fajtája bizonytalan (${first} vagy ${second} órás).` }
    return { type: second ?? first }
  }

  // 6. Soronkénti döntés.
  const rows: SheetRow[] = dataRows.map((d, i) => {
    const typeReading = typeOf(typeCells[i])
    const notes: string[] = []
    const regText2 = pass2Regs[i]?.text ?? ''
    const match2 = fleet.length > 0 ? matchRegistration(regText2, fleet) : undefined
    const match = match2 ?? d.match
    let status: SheetRowStatus = 'ok'
    // A szűkített karakterkészletű második olvasat pontos találata erősebb, mint az első
    // olvasat közelítő találata; ha egyik sem pontos és eltérnek, a sor ellenőrizendő.
    if (match2 && d.match && match2.aircraft.id !== d.match.aircraft.id && !(match2.distance === 0 && d.match.distance > 0)) {
      notes.push(`A lajstromjel bizonytalan (${d.match.aircraft.callSign} vagy ${match2.aircraft.callSign}).`)
      status = 'check'
    }
    const registration = regText2.trim() !== '' && looksLikeRegistration(regText2) ? regText2.trim() : text1(d.reg).trim()

    const cs = options(d.cells[ci])
    const ns = options(d.cells[ni])
    const rs = options(d.cells[ri])
    let current = cs[0] ?? null
    let next = ns[0] ?? null
    let remaining = rs[0] ?? null
    let hours: number | null = null

    const consistent = findConsistent(d)
    if (consistent) {
      current = consistent.c
      next = consistent.n
      remaining = consistent.r
      hours = consistent.r
    } else if (d.cells[ci] === undefined && d.cells[ni] === undefined) {
      if (remaining === 0 || remaining === null) {
        status = 'empty'
        notes.push('A táblázatban nincs óraszám ennél a gépnél.')
      } else {
        hours = remaining
        status = 'check'
        notes.push('Csak a hátralévő idő olvasható, nincs mivel összevetni.')
      }
    } else if (remaining !== null && current !== null && next !== null) {
      status = 'check'
      const nearly = rs.find((r) => cs.some((c) => ns.some((n) => Math.abs(n - c - r) <= 1)))
      if (nearly !== undefined) {
        hours = nearly
        notes.push('A hátralévő idő 1 órával eltér a „Következő − Aktuális” különbségtől (kerekítés?).')
      } else {
        // Javaslat: ha az Aktuális és a Következő mindkét olvasata egyezik és a különbség
        // életszerű, a különbség (négy egybehangzó olvasat a rövid, színes hátterű számmal
        // szemben); különben az olvasott hátralévő idő. Mindkét esetben ellenőrizendő.
        const stableCN = cs.length === 1 && ns.length === 1
        const diff = next - current
        hours = stableCN && diff >= -100 && diff <= 500 ? diff : remaining
        notes.push(`A hátralévő idő (${remaining}) nem egyezik a „Következő − Aktuális” különbséggel (${next} − ${current} = ${next - current}).`)
      }
    } else if (remaining !== null) {
      hours = remaining
      status = 'check'
      notes.push('Az „Aktuális” vagy a „Következő” érték nem olvasható, a hátralévő időt nem tudtam ellenőrizni.')
    } else if (current !== null && next !== null) {
      hours = next - current
      status = 'check'
      notes.push('A hátralévő idő nem olvasható; a „Következő − Aktuális” különbségből számoltam.')
    } else {
      status = 'unreadable'
      notes.push('Az értékek nem olvashatók.')
    }

    if (typeReading.note) notes.push(typeReading.note)
    else if (typeReading.type === null && hours !== null) notes.push('A karbantartás fajtája nem olvasható.')
    return {
      registration,
      aircraftId: match?.aircraft.id ?? null,
      callSign: match?.aircraft.callSign ?? null,
      current,
      next,
      remaining,
      hours,
      maintenanceType: typeReading.type,
      status,
      notes,
    }
  })

  // Ugyanaz a gép többször: egyik sor sem megbízható.
  const seen = new Map<string, number>()
  for (const r of rows) if (r.aircraftId) seen.set(r.aircraftId, (seen.get(r.aircraftId) ?? 0) + 1)
  const finalRows = rows.map((r) =>
    r.aircraftId && (seen.get(r.aircraftId) ?? 0) > 1
      ? { ...r, status: 'check' as const, notes: [...r.notes, `A ${r.callSign} lajstrom többször szerepel a képen; valamelyik sort rosszul olvastam.`] }
      : r,
  )

  const unknown = finalRows.filter((r) => r.aircraftId === null && fleet.length > 0)
  if (unknown.length > 0) warnings.push(`Ismeretlen lajstrom a képen: ${unknown.map((r) => r.registration).join(', ')}.`)

  const matched = new Set(finalRows.map((r) => r.aircraftId).filter((id): id is string => id !== null))
  return {
    date,
    rows: finalRows,
    missingAircraftIds: fleet.filter((a) => !matched.has(a.id)).map((a) => a.id),
    warnings,
  }
}

export { normalizeRegistration }
