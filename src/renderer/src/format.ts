import type { DataBundle } from '@core/model/dataBundle'
import { theoryTypeOf, type BookingRequest, type ExistingBooking, type TheoryType } from '@core/model/planning'
import { WEEKDAY_LABELS } from '@core/model/time'
import { localParts, localToMs, toMs } from '@core/time/zoned'

/** Magyar dátum- és időformázás a repülőtér időzónájában. */

export const pad = (n: number): string => String(n).padStart(2, '0')

export function hhmm(minutes: number): string {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** Időtartam óra:perc alakban, például 390 → „6:30” (a heti összesítésekhez). */
export function hoursMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}:${pad(m % 60)}`
}

export function timeOf(iso: string, tz: string): string {
  return hhmm(localParts(toMs(iso), tz).minutes)
}

export function dateLabel(date: string): string {
  const [, m, d] = date.split('-')
  return `${m}.${d}.`
}

export function dayLabel(date: string): string {
  const p = localParts(Date.parse(`${date}T12:00:00Z`), 'UTC')
  return `${WEEKDAY_LABELS[p.weekday]} ${dateLabel(date)}`
}

/** A FlightLogger űrlapjához: „2026.11.16. 08:30”. */
export function dateTimeFull(iso: string, tz: string): string {
  const p = localParts(toMs(iso), tz)
  return `${p.date.replace(/-/g, '.')}. ${hhmm(p.minutes)}`
}

export function dateTimeShort(iso: string, tz: string): string {
  const p = localParts(toMs(iso), tz)
  return `${WEEKDAY_LABELS[p.weekday]} ${hhmm(p.minutes)}`
}

/** `<input type="datetime-local">` értéke a repülőtér idejében. */
export function toLocalInput(iso: string, tz: string): string {
  const p = localParts(toMs(iso), tz)
  return `${p.date}T${hhmm(p.minutes)}`
}

export function fromLocalInput(value: string, tz: string): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return undefined
  return new Date(localToMs(m[1]!, Number(m[2]) * 60 + Number(m[3]), tz)).toISOString()
}

export function relativeAge(iso: string, now: number): string {
  const minutes = Math.round((now - toMs(iso)) / 60_000)
  if (minutes < 1) return 'most'
  if (minutes < 60) return `${minutes} perce`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} órája`
  return `${Math.round(hours / 24)} napja`
}

export const KIND_LABELS: Readonly<Record<BookingRequest['kind'], string>> = {
  flight: 'Repülés',
  simulator: 'Szimulátor',
  theory: 'Elmélet',
}

/** Az elmélet típusa (FLI-01) a felületen; a FlightLogger saját elnevezése zárójelben. */
export const THEORY_TYPE_LABELS: Readonly<Record<TheoryType, string>> = {
  meeting: 'Megbeszélés (Meeting)',
  groundTraining: 'Csoportos elmélet (Ground training)',
  extraTheory: 'Extra elmélet (Extra theory)',
}

/** Az elmélet típusa röviden (listákban, szövegben). */
export const THEORY_TYPE_SHORT: Readonly<Record<TheoryType, string>> = {
  meeting: 'Megbeszélés',
  groundTraining: 'Csoportos elmélet',
  extraTheory: 'Extra elmélet',
}

/** Az igény fajtája a felületen; elméletnél a típusa is, a FlightLogger nevével. */
export function requestKindLabel(request: Pick<BookingRequest, 'kind' | 'theoryType'>): string {
  return request.kind === 'theory' ? THEORY_TYPE_LABELS[theoryTypeOf(request)] : KIND_LABELS[request.kind]
}

/** Az igény fajtája röviden; elméletnél a típusa. */
export function requestKindShort(request: Pick<BookingRequest, 'kind' | 'theoryType'>): string {
  return request.kind === 'theory' ? THEORY_TYPE_SHORT[theoryTypeOf(request)] : KIND_LABELS[request.kind]
}

/** A FlightLogger-foglalás fajtája a felületen. */
export const BOOKING_TYPE_LABELS: Readonly<Record<ExistingBooking['type'], string>> = {
  singleStudent: 'Egynövendékes repülés',
  multiStudent: 'Többnövendékes foglalás',
  classTheory: 'Osztály elmélet',
  theory: 'Elmélet',
  maintenance: 'Karbantartás',
  operation: 'Üzemi repülés',
  meeting: 'Megbeszélés',
  rental: 'Bérlés',
  other: 'Egyéb foglalás',
}

/** A FlightLogger-foglalás állapota a felületen. */
export const BOOKING_STATUS_LABELS: Readonly<Record<ExistingBooking['status'], string>> = {
  OPEN: 'nyitott',
  COMPLETED: 'lezárt',
  PARTIALLY_COMPLETED: 'részben lezárt',
  CANCELLED: 'lemondott',
}

export function personName(bundle: DataBundle | null, id: string): string {
  return bundle?.directory.people[id]?.name ?? `ismeretlen (${id.slice(0, 6)})`
}

export function requestLabel(bundle: DataBundle | null, request: BookingRequest | undefined): string {
  if (!request) return 'törölt igény'
  const who = request.studentIds.map((id) => personName(bundle, id)).join(', ') || 'nincs résztvevő'
  const lecture = request.lectureId ? bundle?.directory.lectures[request.lectureId]?.name : undefined
  return `${who} – ${lecture ?? requestKindShort(request).toLowerCase()}`
}

/** A motor szövegeiben a «req:ID» jelölőt a növendék nevére és a feladatra cseréli. */
export function resolveText(text: string, bundle: DataBundle | null, requests: readonly BookingRequest[]): string {
  return text.replace(/«req:([^»]+)»/g, (_m, id: string) => requestLabel(bundle, requests.find((r) => r.id === id)))
}

export function resourceLabel(bundle: DataBundle | null, id: string | undefined): string {
  if (!id) return '–'
  const aircraft = bundle?.snapshot.fleet.find((a) => a.id === id)
  if (aircraft) return aircraft.callSign
  return bundle?.directory.classrooms[id] ?? id
}
