/**
 * Időfogalmak. A motor minden időpontot ISO 8601 UTC-szövegként kap és ad vissza;
 * a helyi idő (operációs idő, munkaidő-ablak, tiltott időszak) „ÓÓ:PP” alakú,
 * és a repülőtér időzónájában értendő (ERF-09).
 */

/** ISO 8601 időpont, például `2026-11-12T08:00:00Z`. */
export type IsoDateTime = string
/** Naptári nap a repülőtér időzónájában, például `2026-11-12`. */
export type LocalDate = string
/** Helyi idő a nap folyamán, „ÓÓ:PP”, például `07:30`. */
export type LocalTime = string
/** Időtartam percben. */
export type Minutes = number

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  mon: 'hétfő',
  tue: 'kedd',
  wed: 'szerda',
  thu: 'csütörtök',
  fri: 'péntek',
  sat: 'szombat',
  sun: 'vasárnap',
}

/** Egy nap nyitott időablaka helyi időben; a vége a kezdete után van. */
export interface DailyWindow {
  readonly start: LocalTime
  readonly end: LocalTime
}

/** Hét napjaira bontott időablak; `null` = aznap zárva / nem dolgozik. */
export type WeeklyWindows = Readonly<Record<Weekday, DailyWindow | null>>

export interface TimeRange {
  readonly start: IsoDateTime
  readonly end: IsoDateTime
}

/** „ÓÓ:PP” → percek éjfél óta. */
export function localTimeToMinutes(time: LocalTime): Minutes {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) throw new Error(`Érvénytelen időpont: ${time}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`Érvénytelen időpont: ${time}`)
  return hours * 60 + minutes
}
