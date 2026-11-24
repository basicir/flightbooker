import type { Settings } from '../config/schema'
import { bookingLessonOf, bookingStudentIds, studentFlightSegment } from '../model/bookingStudents'
import type { BookingRequest, ExistingBooking, PlanResult } from '../model/planning'
import type { Snapshot } from '../model/snapshot'
import type { IsoDateTime } from '../model/time'
import { lectureOrderKey, type LectureInfo } from '../progress/lectures'
import { addDays, localToMs, overlaps, toMs } from '../time/zoned'

/**
 * Az oktató fizetett ideje a héten: a repült idő (az egyedül és SPIC-ként repült is), a
 * szimulátoros idő és az elméleti órák. Nem fizetett: a briefing, a debriefing és a motorpróba
 * (ezért a repülésnél és a szimulátornál csak a gépidő számít) és a standby elmélet (csak rossz
 * időben tartják). A repült időn belül az egyedül/SPIC rész tájékoztatásul külön látszik.
 *
 * Források: a hét FlightLogger-foglalásai, amelyeken ő az oktató, vagy amelyek a terve egy
 * igényéhez tartoznak (9.6 párosítás; a FlightLoggerben az oktató mezője üres is lehet), és a terv
 * még nem FlightLoggerben lévő tételei. Gépes oktatási foglalás repülés vagy szimulátor; a gép
 * nélküli, teremben tartott foglalás elmélet, bármilyen foglalásfajtaként vették fel (például
 * egynövendékesként), kivéve a megbeszélést, a karbantartást, az üzemi repülést és a bérlést. A tervbe tett áthelyezés régi
 * FlightLogger-helye és a lemondandó foglalás nem számít (`supersededBookings`). A terv tétele,
 * amely időben átfed egy beszámított FlightLogger-foglalásával, nem számít még egyszer (az
 * oktató egyszerre csak egy helyen lehet; jellemzően a még le nem hozott rögzítés). Repülésnél
 * ehhez a repülési ablak számít, nem a teljes foglalás: a közös briefinges foglalások a briefing
 * alatt átfednek (KBR-01). A többnövendékes foglalás egyedül repült része növendékenként, a
 * saját feladata szerint számolódik.
 *
 * A tételes lista (`items`, `skipped`) az ellenőrzéshez van: a felület soronként mutatja.
 */

export type PaidCategory = 'flight' | 'simulator' | 'theory'

/** Egy beszámított tétel. */
export interface PaidItem {
  readonly category: PaidCategory
  readonly source: 'flightLogger' | 'plan'
  /** A foglalás (repülésnél és szimulátornál a gépidő) kezdete és vége. */
  readonly start: IsoDateTime
  readonly end: IsoDateTime
  readonly minutes: number
  /** Repülésnél ebből egyedül vagy SPIC-ként (tájékoztatásul). */
  readonly soloMinutes: number
  readonly bookingId?: string
  readonly requestId?: string
  readonly resourceId?: string
  readonly classroomId?: string
}

/** Egy saját foglalás vagy tervtétel, amely nem számít bele, az okával. */
export interface SkippedItem {
  readonly start: IsoDateTime
  readonly reason: string
  readonly bookingId?: string
  readonly requestId?: string
}

export interface PaidTime {
  /** Fizetett összesen: a repült idő, a szimulátor és az elmélet, percben. */
  readonly paidMinutes: number
  /** Repült idő (a repülési rész), az egyedül és SPIC-ként repülttel együtt. */
  readonly flightMinutes: number
  readonly theoryMinutes: number
  /** A repült időből egyedül vagy SPIC-ként repült (tájékoztatásul; része a fizetettnek). */
  readonly soloMinutes: number
  /** Szimulátoros gépidő (része a fizetettnek). */
  readonly simulatorMinutes: number
  /** A fizetettből a FlightLoggerben már lefoglalt (a többi a terv még nem rögzített része). */
  readonly bookedMinutes: number
  /** A beszámított tételek időrendben. */
  readonly items: readonly PaidItem[]
  /** A nem beszámított saját foglalások és tervtételek, okkal. */
  readonly skipped: readonly SkippedItem[]
}

export interface PaidTimeInput {
  readonly snapshot: Snapshot
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  readonly result: PlanResult
  readonly catalog: Readonly<Record<string, LectureInfo>>
}

/** Elméleti foglalásfajták (terem nélkül is elméletnek számítanak). */
const THEORY_TYPES: ReadonlySet<ExistingBooking['type']> = new Set(['theory', 'classTheory'])
const FLIGHT_TYPES: ReadonlySet<ExistingBooking['type']> = new Set(['singleStudent', 'multiStudent'])
/** Nem oktatás: teremben vagy géppel sem számít. */
const NOT_TEACHING: ReadonlySet<ExistingBooking['type']> = new Set(['meeting', 'maintenance', 'operation', 'rental'])
const minutesBetween = (a: string, b: string): number => Math.max(0, Math.round((toMs(b) - toMs(a)) / 60_000))

/** Miért nem számít egy saját FlightLogger-foglalás (fajta szerint). */
const SKIP_REASON: Partial<Record<ExistingBooking['type'], string>> = {
  meeting: 'megbeszélés – nem tartozik a terv egyik elméletéhez sem',
  maintenance: 'karbantartás',
  operation: 'üzemi repülés (nem oktatás)',
  rental: 'bérlés (nem oktatás)',
}

export function paidTime(input: PaidTimeInput): PaidTime {
  const { snapshot, settings, result, catalog } = input
  const me = snapshot.instructorId
  const weekStart = localToMs(snapshot.weekStart, 0, snapshot.timezone)
  const weekEnd = localToMs(addDays(snapshot.weekStart, 7), 0, snapshot.timezone)
  const inWeek = (iso: string): boolean => toMs(iso) >= weekStart && toMs(iso) < weekEnd
  const fleet = new Map(snapshot.fleet.map((a) => [a.id, a]))
  const isSimulator = (id: string): boolean => (settings.resources[id]?.kind ?? (fleet.get(id)?.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')) === 'simulator'

  // A feladat egyedül repült hányada; a percek nélküli feladatnál a feladatsor azonos kódú feladata.
  const keyOf = (name: string): string | undefined => {
    const k = lectureOrderKey(name)
    return k ? `${k[0]}/${k[1]}` : undefined
  }
  // Azonos kódú feladat előbb ugyanabból a revízióból (más revízióban más lehet), utána bármelyikből.
  const byKey = new Map<string, LectureInfo>()
  for (const l of Object.values(catalog)) {
    const k = keyOf(l.name)
    if (!k || l.soloMinutes === undefined || l.flightMinutes <= 0) continue
    if (l.revisionId && !byKey.has(`${l.revisionId}|${k}`)) byKey.set(`${l.revisionId}|${k}`, l)
    if (!byKey.has(k)) byKey.set(k, l)
  }
  const soloShare = (lecture: { readonly id?: string | undefined; readonly name?: string | undefined }): number => {
    const own = lecture.id ? catalog[lecture.id] : undefined
    const name = own?.name ?? lecture.name
    const k = name ? keyOf(name) : undefined
    const sameRevision = own?.revisionId && k ? byKey.get(`${own.revisionId}|${k}`) : undefined
    const known = own?.soloMinutes !== undefined && own.flightMinutes > 0 ? own : (sameRevision ?? (k ? byKey.get(k) : undefined))
    if (!known || known.soloMinutes === undefined || known.flightMinutes <= 0) return 0
    return Math.min(1, known.soloMinutes / known.flightMinutes)
  }

  /**
   * A foglalás egyedül vagy SPIC-ként repült része. A többnövendékes foglalásnál növendékenként, a
   * saját szakasza és feladata szerint (KBR-10); szakasz nélkül a foglalás feladata szerint.
   */
  const soloOfBooking = (b: ExistingBooking, minutes: number): number => {
    if (b.type === 'multiStudent') {
      const parts = (bookingStudentIds(b) ?? []).map((id) => {
        const seg = studentFlightSegment(b, id)
        const lesson = bookingLessonOf(b, id)
        return seg && lesson ? ((seg.end - seg.start) / 60_000) * soloShare({ id: lesson.lectureId, name: lesson.lectureName }) : 0
      })
      return Math.round(parts.reduce((sum, x) => sum + x, 0))
    }
    return Math.round(minutes * soloShare({ id: b.lectureId, name: b.plannedLectureName }))
  }

  const items: PaidItem[] = []
  const skipped: SkippedItem[] = []
  /** A beszámított FlightLogger-foglalások ideje az átfedő tervtételhez: repülésnél a repülési ablak. */
  const counted: Array<readonly [number, number]> = []

  // A FlightLogger-foglalások, amelyeken ő az oktató, vagy a terve igényéhez tartoznak
  const superseded = new Set(result.supersededBookings)
  const linkedKind = new Map(result.recordedInFlightLogger.map((l) => [l.bookingId, input.requests.find((r) => r.id === l.requestId)?.kind]))
  for (const b of snapshot.bookings) {
    const linked = linkedKind.has(b.id)
    // Oktató nélküli megbeszélés, amelyen résztvevő: az övé (az elmélet néha így kerül fel).
    const mine = b.instructorId === me || (b.instructorId === undefined && b.participantIds.includes(me))
    if (b.status === 'CANCELLED' || (!mine && !linked) || !inWeek(b.start)) continue
    const where = { ...(b.resourceId ? { resourceId: b.resourceId } : {}), ...(b.classroomId ? { classroomId: b.classroomId } : {}) }
    if (superseded.has(b.id)) {
      skipped.push({ start: b.start, bookingId: b.id, reason: 'a tervben áthelyezendő vagy lemondandó: a régi helye nem számít' })
      continue
    }
    const kind = linkedKind.get(b.id)
    if (b.resourceId !== undefined && !NOT_TEACHING.has(b.type) && (FLIGHT_TYPES.has(b.type) || (linked && kind !== 'theory'))) {
      const start = b.flightStart ?? b.start
      const end = b.flightEnd ?? b.end
      const minutes = minutesBetween(start, end)
      const sim = isSimulator(b.resourceId)
      const solo = sim ? 0 : soloOfBooking(b, minutes)
      items.push({ category: sim ? 'simulator' : 'flight', source: 'flightLogger', start, end, minutes, soloMinutes: solo, bookingId: b.id, ...where })
      counted.push([toMs(start), toMs(end)])
    } else if (b.resourceId === undefined && (kind === 'theory' || (!NOT_TEACHING.has(b.type) && (b.classroomId !== undefined || THEORY_TYPES.has(b.type))))) {
      // A terv elméletéhez tartozó megbeszélés is elmélet (a FlightLoggerben néha így veszik fel).
      items.push({ category: 'theory', source: 'flightLogger', start: b.start, end: b.end, minutes: minutesBetween(b.start, b.end), soloMinutes: 0, bookingId: b.id, ...where })
      counted.push([toMs(b.start), toMs(b.end)])
    } else {
      skipped.push({
        start: b.start,
        bookingId: b.id,
        reason: SKIP_REASON[b.type] ?? (b.resourceId ? 'gépes, de nem oktatási foglalásfajta' : 'gép és terem nélküli, nem elméleti foglalás (nem tudni, mi volt)'),
      })
    }
  }

  // A terv még nem FlightLoggerben lévő tételei (a lefoglaltak fent, foglalásként számítanak)
  const requests = new Map(input.requests.map((r) => [r.id, r]))
  for (const p of result.proposals) {
    const r = requests.get(p.requestId)
    if (!r || !inWeek(p.slot.start)) continue
    if (p.standby) {
      skipped.push({ start: p.slot.start, requestId: r.id, reason: 'standby elmélet: csak rossz időben tartják' })
      continue
    }
    const own = r.kind === 'theory' || !p.slot.flightStart || !p.slot.flightEnd ? ([p.slot.start, p.slot.end] as const) : ([p.slot.flightStart, p.slot.flightEnd] as const)
    if (counted.some(([s, e]) => overlaps(s, e, toMs(own[0]), toMs(own[1])))) {
      skipped.push({ start: p.slot.start, requestId: r.id, reason: 'ugyanekkor FlightLogger-foglalásod van (beszámítva): nem számolom kétszer' })
      continue
    }
    const where = { ...(p.slot.resourceId ? { resourceId: p.slot.resourceId } : {}), ...(p.slot.classroomId ? { classroomId: p.slot.classroomId } : {}) }
    if (r.kind === 'theory') {
      items.push({ category: 'theory', source: 'plan', start: p.slot.start, end: p.slot.end, minutes: r.durations.main, soloMinutes: 0, requestId: r.id, ...where })
      continue
    }
    const start = p.slot.flightStart ?? p.slot.start
    const end = p.slot.flightEnd ?? p.slot.end
    const minutes = p.slot.flightStart && p.slot.flightEnd ? minutesBetween(start, end) : r.durations.main
    const sim = r.kind === 'simulator'
    items.push({ category: sim ? 'simulator' : 'flight', source: 'plan', start, end, minutes, soloMinutes: sim ? 0 : Math.round(minutes * soloShare({ id: r.lectureId })), requestId: r.id, ...where })
  }

  items.sort((a, b) => toMs(a.start) - toMs(b.start))
  skipped.sort((a, b) => toMs(a.start) - toMs(b.start))
  const sum = (pick: (i: PaidItem) => number): number => items.reduce((n, i) => n + pick(i), 0)
  const flight = sum((i) => (i.category === 'flight' ? i.minutes : 0))
  const simulator = sum((i) => (i.category === 'simulator' ? i.minutes : 0))
  const theory = sum((i) => (i.category === 'theory' ? i.minutes : 0))
  return {
    paidMinutes: flight + simulator + theory,
    flightMinutes: flight,
    theoryMinutes: theory,
    soloMinutes: sum((i) => i.soloMinutes),
    simulatorMinutes: simulator,
    bookedMinutes: sum((i) => (i.source === 'flightLogger' ? i.minutes : 0)),
    items,
    skipped,
  }
}
