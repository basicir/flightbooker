import type { BlockedPeriod, Settings } from './schema'
import { localTimeToMinutes, WEEKDAYS, type LocalDate, type Weekday } from '../model/time'
import { addDays, localParts, localToMs, toMs } from '../time/zoned'

/**
 * Tiltott időszakok (SZB-14, K35): az oktató „nem érek rá” időszakai. Ismétlődő (a hét egy vagy
 * több napján, opcionálisan érvényességi dátumokkal) vagy eseti (egy időponttól egy időpontig).
 * Az elmúlt időszak nem foglal helyet: a lejárt eseti és a lejárt érvényességű ismétlődő
 * időszak törlődik.
 */

const DEFAULT_TZ = 'Europe/Budapest'

/** Lejárt-e: az eseti vége elmúlt, az ismétlődő érvényessége a mai nap előtt véget ért. */
export function isExpiredBlock(p: BlockedPeriod, nowMs: number, today: LocalDate): boolean {
  return p.kind === 'once' ? toMs(p.end) <= nowMs : p.validTo !== undefined && p.validTo < today
}

/** Folyamatban van-e az eseti időszak. */
export function isOngoingBlock(p: BlockedPeriod, nowMs: number): boolean {
  return p.kind === 'once' && toMs(p.start) <= nowMs && toMs(p.end) > nowMs
}

/** A lejárt tiltott időszakok törlése; ha nincs mit törölni, ugyanazt a beállítást adja. */
export function pruneBlockedPeriods(settings: Settings, nowMs: number): Settings {
  const tz = settings.airport?.timezone ?? DEFAULT_TZ
  const today = localParts(nowMs, tz).date
  const kept = settings.instructor.blockedPeriods.filter((p) => !isExpiredBlock(p, nowMs, today))
  if (kept.length === settings.instructor.blockedPeriods.length) return settings
  return { ...settings, instructor: { ...settings.instructor, blockedPeriods: kept } }
}

/** Megjelenítési sorrend: előbb az ismétlődők a hét napjai és a kezdés szerint, aztán az esetiek időrendben. */
export function sortBlockedPeriods(list: readonly BlockedPeriod[]): BlockedPeriod[] {
  const key = (p: BlockedPeriod): string =>
    p.kind === 'weekly' ? `0|${WEEKDAYS.indexOf(p.weekday)}|${p.start}|${p.end}` : `1|${new Date(toMs(p.start)).toISOString()}`
  return [...list].sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id))
}

export type BlockDraftResult = { readonly ok: true; readonly periods: BlockedPeriod[] } | { readonly ok: false; readonly error: string }

const note = (text: string | undefined): { note?: string } => {
  const t = text?.trim()
  return t ? { note: t.slice(0, 500) } : {}
}

/**
 * Ismétlődő tiltás napokra bontva (napra egy bejegyzés, mert a motor napra nézi). Egész napnál
 * 00:00–23:59.
 */
export function weeklyBlocks(input: {
  readonly weekdays: readonly Weekday[]
  readonly allDay: boolean
  readonly start: string
  readonly end: string
  readonly validFrom?: LocalDate | undefined
  readonly validTo?: LocalDate | undefined
  readonly note?: string | undefined
  readonly idBase: string
}): BlockDraftResult {
  if (input.weekdays.length === 0) return { ok: false, error: 'Válassz legalább egy napot.' }
  const start = input.allDay ? '00:00' : input.start
  const end = input.allDay ? '23:59' : input.end
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return { ok: false, error: 'Add meg a kezdés és a vége idejét.' }
  if (localTimeToMinutes(end) <= localTimeToMinutes(start)) return { ok: false, error: 'A vége a kezdete után legyen.' }
  if (input.validFrom && input.validTo && input.validTo < input.validFrom) return { ok: false, error: 'Az érvényesség vége a kezdete után legyen.' }
  const days = WEEKDAYS.filter((d) => input.weekdays.includes(d))
  return {
    ok: true,
    periods: days.map((weekday, i) => ({
      id: days.length > 1 ? `${input.idBase}-${i + 1}` : input.idBase,
      kind: 'weekly',
      weekday,
      start,
      end,
      ...(input.validFrom ? { validFrom: input.validFrom } : {}),
      ...(input.validTo ? { validTo: input.validTo } : {}),
      ...note(input.note),
    })),
  }
}

/**
 * Eseti tiltás: kezdőnaptól az utolsó napig. Egész napnál az első nap 00:00-tól az utolsó nap
 * végéig, különben a kezdő nap kezdési idejétől az utolsó nap záró idejéig, egyben.
 */
export function onceBlock(input: {
  readonly startDate: LocalDate
  readonly endDate: LocalDate
  readonly allDay: boolean
  readonly start: string
  readonly end: string
  readonly note?: string | undefined
  readonly idBase: string
  readonly tz: string
  readonly nowMs: number
}): BlockDraftResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return { ok: false, error: 'Add meg a kezdő napot.' }
  const endDate = /^\d{4}-\d{2}-\d{2}$/.test(input.endDate) ? input.endDate : input.startDate
  if (endDate < input.startDate) return { ok: false, error: 'Az utolsó nap nem lehet a kezdő nap előtt.' }
  if (!input.allDay && (!/^\d{2}:\d{2}$/.test(input.start) || !/^\d{2}:\d{2}$/.test(input.end))) return { ok: false, error: 'Add meg a kezdés és a vége idejét.' }
  const startMs = localToMs(input.startDate, input.allDay ? 0 : localTimeToMinutes(input.start), input.tz)
  const endMs = input.allDay ? localToMs(addDays(endDate, 1), 0, input.tz) : localToMs(endDate, localTimeToMinutes(input.end), input.tz)
  if (endMs <= startMs) return { ok: false, error: 'A vége a kezdete után legyen.' }
  if (endMs <= input.nowMs) return { ok: false, error: 'Ez az időszak már elmúlt.' }
  return { ok: true, periods: [{ id: input.idBase, kind: 'once', start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString(), ...note(input.note) }] }
}
