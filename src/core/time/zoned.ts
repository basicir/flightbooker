import { WEEKDAYS, type LocalDate, type Weekday } from '../model/time'

/**
 * Időzóna-számítás külső könyvtár nélkül, az Intl API-val. Determinisztikus: csak az
 * időzóna-adatbázistól függ, a futtató gép órájától nem.
 */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    formatters.set(timeZone, f)
  }
  return f
}

export interface LocalParts {
  readonly date: LocalDate
  /** Percek helyi éjfél óta. */
  readonly minutes: number
  readonly weekday: Weekday
}

export const MINUTE_MS = 60_000
export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

export function toMs(iso: string): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`Érvénytelen időpont: ${iso}`)
  return ms
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/**
 * Gyorsítótár: a motor ugyanazokat a rácspontokat sokszor kérdezi le. Korlátos méretű,
 * és csak tiszta függvények eredményét tárolja, így a determinizmust nem érinti.
 */
const CACHE_LIMIT = 200_000
/** Időzónánként, ezredmásodperc szerint (szöveges kulcs nélkül, mert ez a leggyakoribb hívás). */
const partsCache = new Map<string, Map<number, LocalParts>>()
/** Az óra kezdetének helyi része: az órán belüli időpontok ebből számolhatók. */
const hourCache = new Map<string, Map<number, LocalParts>>()
const addDaysCache = new Map<string, LocalDate>()
const weekdayCache = new Map<LocalDate, Weekday>()

function remember<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= CACHE_LIMIT) cache.clear()
  cache.set(key, value)
  return value
}

export function localParts(ms: number, timeZone: string): LocalParts {
  let byMs = partsCache.get(timeZone)
  if (!byMs) partsCache.set(timeZone, (byMs = new Map()))
  const cached = byMs.get(ms)
  if (cached) return cached
  if (byMs.size >= CACHE_LIMIT) byMs.clear()
  const result = fromHour(ms, timeZone) ?? computeLocalParts(ms, timeZone)
  byMs.set(ms, result)
  return result
}

/**
 * Az időzóna-váltás mindig egész órakor történik, ezért az órán belüli időpont helyi ideje az
 * óra kezdetéből adódik. Ha a nap átfordulna (félórás eltolású zónánál), `undefined`.
 */
function fromHour(ms: number, timeZone: string): LocalParts | undefined {
  if (!Number.isInteger(ms)) return undefined
  const hourStart = Math.floor(ms / HOUR_MS) * HOUR_MS
  let byHour = hourCache.get(timeZone)
  if (!byHour) hourCache.set(timeZone, (byHour = new Map()))
  let base = byHour.get(hourStart)
  if (!base) {
    if (byHour.size >= CACHE_LIMIT) byHour.clear()
    base = computeLocalParts(hourStart, timeZone)
    byHour.set(hourStart, base)
  }
  const offsetMinutes = Math.floor((ms - hourStart) / MINUTE_MS)
  if (ms - hourStart !== offsetMinutes * MINUTE_MS) return undefined
  const minutes = base.minutes + offsetMinutes
  return minutes < 24 * 60 ? { date: base.date, minutes, weekday: base.weekday } : undefined
}

function computeLocalParts(ms: number, timeZone: string): LocalParts {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  const date = `${parts['year']}-${parts['month']}-${parts['day']}`
  return { date, minutes: Number(parts['hour']) * 60 + Number(parts['minute']), weekday: weekdayOf(date) }
}

/** A naptári nap hét napja (hétfő = mon). */
export function weekdayOf(date: LocalDate): Weekday {
  const cached = weekdayCache.get(date)
  if (cached) return cached
  return remember(weekdayCache, date, computeWeekday(date))
}

function computeWeekday(date: LocalDate): Weekday {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = vasárnap
  return WEEKDAYS[(js + 6) % 7]!
}

/** 0 = hétfő … 6 = vasárnap. */
export function weekdayIndex(date: LocalDate): number {
  return WEEKDAYS.indexOf(weekdayOf(date))
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const key = `${date}|${days}`
  const cached = addDaysCache.get(key)
  if (cached) return cached
  return remember(addDaysCache, key, computeAddDays(date, days))
}

function computeAddDays(date: LocalDate, days: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const dayNumberCache = new Map<LocalDate, number>()
function dayNumber(date: LocalDate): number {
  let n = dayNumberCache.get(date)
  if (n === undefined) {
    n = Math.round(Date.parse(`${date}T00:00:00Z`) / DAY_MS)
    remember(dayNumberCache, date, n)
  }
  return n
}

/** b − a napokban. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  return dayNumber(b) - dayNumber(a)
}

const localToMsCache = new Map<string, number>()

/** Helyi dátum és idő → UTC ezredmásodperc. Nyári időszámítás váltásakor is helyes. */
export function localToMs(date: LocalDate, minutes: number, timeZone: string): number {
  const key = `${timeZone}|${date}|${minutes}`
  const cached = localToMsCache.get(key)
  if (cached !== undefined) return cached
  return remember(localToMsCache, key, computeLocalToMs(date, minutes, timeZone))
}

function computeLocalToMs(date: LocalDate, minutes: number, timeZone: string): number {
  const guess = Date.parse(`${date}T00:00:00Z`) + minutes * MINUTE_MS
  let result = guess
  for (let i = 0; i < 3; i++) {
    const p = localParts(result, timeZone)
    const actual = Date.parse(`${p.date}T00:00:00Z`) + p.minutes * MINUTE_MS
    const diff = actual - guess
    if (diff === 0) return result
    result -= diff
  }
  return result
}

export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}
