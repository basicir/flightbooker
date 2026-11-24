import { bookingLessonOf, bookingStudentIds, studentFlightSegment } from '../model/bookingStudents'
import type { BookingRequest, ExistingBooking, Slot } from '../model/planning'
import type { Snapshot } from '../model/snapshot'
import type { IsoDateTime } from '../model/time'
import { addDays, localToMs, overlaps, toIso, toMs } from '../time/zoned'

/**
 * Az igények és a FlightLogger-foglalások párosítása (9.6, H02). A tervezet csak olvassa a
 * FlightLoggert, ezért a foglalás sorsát innen tudjuk: megvan-e, hol van, és melyik igényé.
 *
 * Rögzítettnek jelölt igénynél a sorrend:
 * 1. a korábban már párosított foglalás azonosítója (a FlightLoggerben áthelyezett foglalás
 *    azonosítója nem változik);
 * 2. a rögzített hely: időben átfedő foglalás ugyanazon a gépen (elméletnél teremben), az
 *    oktatóval vagy a növendékkel;
 * 3. ha az adat a rögzítésnél régebbi, a hely le van zárva (a frissítés még nem hozta le);
 * 4. máshová tették a FlightLoggerben: repülésnél és szimulátornál a növendék és a feladat
 *    (az oktató héten belüli foglalása ugyanazzal a feladattal), elméletnél a résztvevők (az
 *    oktató héten belüli termes foglalása – vagy oktató nélküli megbeszélés, amelynek ő is
 *    résztvevője –, amelyen az igény minden növendéke vagy az osztálya szerepel); több jelöltnél a
 *    rögzített időponthoz legközelebbi;
 * 5. különben hiányzik.
 *
 * Az 1–2. pont minden rögzített igényre lefut, mielőtt a 4. kezdődne: a máshová tett foglalás
 * keresése nem viheti el egy másik igény a helyén lévő foglalását.
 *
 * Rögzítettnek nem jelölt igénynél a növendék és a feladat szerinti foglalás felismerés: az
 * oktató közvetlenül a FlightLoggerben foglalta le. Halasztott igénynél ugyanez csak jelzés
 * (még le kell mondani). Minden foglalás legfeljebb egy igényhez tartozik; a többnövendékes
 * (multi student) repülés növendékenként egyhez, a növendék saját feladatával és repülési
 * szakaszával (KBR-10). Repülésnél a helyen talált foglalásban a növendéknek is benne kell
 * lennie (megfigyelőként nem elég), mert a közös briefinges foglalások mind átfednek az oktatóéval.
 *
 * A FlightLogger-jelölés (hét közbeni figyelés, 9.7) mindezt megelőzi: a jelölt igény rendes
 * tervezett tétel, amelynek a FlightLoggerben már van foglalása, és azt át kell írni (vagy le kell
 * mondani). A foglalás régi helye nem foglal, és az igény nem párosul vele újra, amíg a jelölés áll.
 * A lemondott foglalás eltűnése a frissítésből a lemondás végét jelzi.
 */

/**
 * FlightLogger-jelölés egy tervezett igényen: a FlightLoggerben már van foglalása, amelyet át
 * kell írni a terv szerinti helyre (`move`), vagy le kell mondani, mert az igény halasztott
 * (`cancel`). Nem rögzítés: a motor az igényt ugyanúgy tervezi, mint a többit.
 */
export type PlannedChange =
  | { readonly kind: 'move'; readonly requestId: string; readonly bookingId: string }
  | {
      readonly kind: 'cancel'
      readonly requestId: string
      readonly bookingId: string
      /** Mikor jelezte, hogy a FlightLoggerben lemondta (a frissítésig nincs teendő). */
      readonly doneAt?: IsoDateTime
    }

/** A rögzítési lista egy tétele a motor bemenetében. */
export interface RecordedEntry {
  readonly requestId: string
  /** A hely a rögzítés pillanatában (vagy a hét közbeni áthelyezés után). */
  readonly slot: Slot
  /** Mikor jelölte rögzítettnek (vagy áthelyezettnek); régebbi tervezetben hiányzik. */
  readonly at?: IsoDateTime
  /** A már párosított FlightLogger-foglalás azonosítója. */
  readonly bookingId?: string
}

export interface BookingLink {
  readonly requestId: string
  readonly bookingId: string
  /** A FlightLogger-foglalás helye. */
  readonly slot: Slot
  readonly recorded: boolean
  readonly how: 'id' | 'slot' | 'lecture' | 'participants'
  /** Rögzített igénynél: a foglalás máshol van (más kezdés vagy gép), mint a rögzített hely. */
  readonly moved: boolean
}

export interface LinkResult {
  readonly links: readonly BookingLink[]
  /** Rögzített, de az adat a rögzítésnél régebbi és még nincs benne: a hely le van zárva. */
  readonly pending: readonly RecordedEntry[]
  /** Rögzített, de a rögzítésnél frissebb adatban sincs meg (eltérés). */
  readonly missing: readonly RecordedEntry[]
  /**
   * A hiányzók közül azok igénye, amelyeknek a foglalása a FlightLoggerben lemondott állapotú
   * (`CANCELLED`): ott lemondták, nem csak nem található. A törölt foglalást a FlightLogger nem
   * adja vissza, az egyszerűen hiányzik.
   */
  readonly cancelled: readonly string[]
  /**
   * A frissítésnél régebbi adatban egy áthelyezett foglalás régi helye: a tervezés nem számol
   * vele, mert az oktató szerint már máshol van.
   */
  readonly superseded: readonly string[]
  /** Halasztott igény, amelynek a foglalása még megvan (és még nem kezdődött el). */
  readonly deferredStillBooked: readonly BookingLink[]
  /** Áthelyezendőnek jelölt igény; `from`: a foglalás mostani helye (ha még megvan). */
  readonly plannedMoves: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string; readonly from?: Slot }>
  /** Tervbe tett lemondás; `done`: az oktató jelezte, hogy lemondta, a frissítés még nem hozta le. */
  readonly plannedCancels: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string; readonly slot: Slot; readonly done: boolean }>
  /** A frissítés szerint már elvégzett tervbe tett változtatások (a tervezetből törölhetők). */
  readonly completedChanges: ReadonlyArray<{ readonly requestId: string; readonly kind: PlannedChange['kind']; readonly bookingId: string; readonly slot?: Slot }>
}

export interface LinkInput {
  readonly snapshot: Snapshot
  readonly requests: readonly BookingRequest[]
  readonly recorded?: readonly RecordedEntry[]
  /** A halasztott igények (a rögzítettek nélkül). */
  readonly deferred?: ReadonlySet<string>
  /** A foglalási tervbe tett, a FlightLoggerben még elvégzendő változtatások. */
  readonly changes?: readonly PlannedChange[]
}

/**
 * A FlightLogger-foglalás helye az igény szemszögéből: többnövendékes foglalásnál a repülés a
 * növendék saját szakasza (KBR-10), máskor a foglalás teljes helye.
 */
export function bookingSlotFor(b: ExistingBooking, request: Pick<BookingRequest, 'kind' | 'studentIds'>): Slot {
  const slot = bookingSlot(b)
  const studentId = request.studentIds[0]
  if (b.type !== 'multiStudent' || request.kind === 'theory' || request.studentIds.length !== 1 || !studentId) return slot
  const segment = studentFlightSegment(b, studentId)
  return segment ? { ...slot, flightStart: toIso(segment.start), flightEnd: toIso(segment.end) } : slot
}

/** A FlightLogger-foglalás helye a tervezet fogalmaival. */
export function bookingSlot(b: ExistingBooking): Slot {
  return {
    start: b.start,
    end: b.end,
    ...(b.flightStart ? { flightStart: b.flightStart } : {}),
    ...(b.flightEnd ? { flightEnd: b.flightEnd } : {}),
    ...(b.resourceId ? { resourceId: b.resourceId } : {}),
    ...(b.classroomId ? { classroomId: b.classroomId } : {}),
  }
}

const samePlace = (a: Slot, b: Slot): boolean => toMs(a.start) === toMs(b.start) && a.resourceId === b.resourceId && a.classroomId === b.classroomId

export function linkBookings(input: LinkInput): LinkResult {
  const { snapshot } = input
  const me = snapshot.instructorId
  const generatedMs = toMs(snapshot.generatedAt)
  const weekStartMs = localToMs(snapshot.weekStart, 0, snapshot.timezone)
  const weekEndMs = localToMs(addDays(snapshot.weekStart, 7), 0, snapshot.timezone)
  const active = snapshot.bookings.filter((b) => b.status !== 'CANCELLED')
  const cancelledBookings = snapshot.bookings.filter((b) => b.status === 'CANCELLED')
  const byBookingId = new Map(active.map((b) => [b.id, b]))
  const requestById = new Map(input.requests.map((r) => [r.id, r]))
  const superseded = new Set<string>()
  /**
   * Melyik foglalás kié (KBR-10): a foglalás azonosítójához a lefoglalt növendékek, `*` esetén az
   * egész foglalás. A többnövendékes repülés növendékenként egy igényhez tartozhat, minden más
   * foglalás csak egyhez.
   */
  const claims = new Map<string, Set<string>>()
  const seatOf = (b: ExistingBooking, request: BookingRequest): string =>
    b.type === 'multiStudent' && request.kind !== 'theory' && request.studentIds.length === 1 ? request.studentIds[0]! : '*'
  const isFree = (b: ExistingBooking, request: BookingRequest): boolean => {
    const taken = claims.get(b.id)
    if (!taken) return true
    const seat = seatOf(b, request)
    return seat !== '*' && !taken.has('*') && !taken.has(seat)
  }
  const claim = (b: ExistingBooking, request: BookingRequest): void => {
    const taken = claims.get(b.id) ?? new Set<string>()
    taken.add(seatOf(b, request))
    claims.set(b.id, taken)
  }
  /**
   * A foglalás régi helye nem foglal (áthelyezés, lemondás, a régebbi adat): a többnövendékes
   * foglalásé csak akkor, ha minden növendékét érinti, különben a többiek még ott repülnek.
   */
  const supersede = (b: ExistingBooking, request: BookingRequest): void => {
    claim(b, request)
    const taken = claims.get(b.id)!
    const students = bookingStudentIds(b) ?? []
    if (taken.has('*') || students.every((id) => taken.has(id))) superseded.add(b.id)
  }
  const links: BookingLink[] = []
  const pending: RecordedEntry[] = []
  const missing: RecordedEntry[] = []
  const cancelled: string[] = []
  const stillBooked: BookingLink[] = []

  /** A rögzített helyen lévő foglalás: időben átfed, ugyanaz a gép vagy terem, közös személy. */
  /**
   * Az oktatóé-e a foglalás: ő az oktató, vagy (az oktató nélküli megbeszélésként felvett
   * elméletnél) résztvevő.
   */
  const withMe = (b: ExistingBooking): boolean => b.instructorId === me || (b.instructorId === undefined && b.participantIds.includes(me))
  /** Elméletnél a megbeszélésként felvett, terem nélküli foglalás is lehet az övé. */
  const roomFits = (b: ExistingBooking, classroomId: string | undefined): boolean =>
    b.resourceId === undefined && (b.classroomId !== undefined ? b.classroomId === classroomId : b.type === 'meeting')
  const atSlot = (request: BookingRequest, slot: Slot) => (b: ExistingBooking): boolean => {
    if (!overlaps(toMs(b.start), toMs(b.end), toMs(slot.start), toMs(slot.end))) return false
    const sameResource = request.kind === 'theory' ? roomFits(b, slot.classroomId) : b.resourceId !== undefined && b.resourceId === slot.resourceId
    // Repülési foglalásnál a növendéknek benne kell lennie: az oktató egyezése nem elég (KBR-10).
    const students = request.kind === 'theory' ? undefined : bookingStudentIds(b)
    const samePeople =
      students && students.length > 0 ? request.studentIds.some((id) => students.includes(id)) : withMe(b) || request.studentIds.some((id) => b.participantIds.includes(id))
    return sameResource && samePeople
  }

  /** Az oktató héten belüli foglalásai a növendékkel és ugyanazzal a feladattal. */
  const byLecture = (request: BookingRequest): ExistingBooking[] => {
    const studentId = request.studentIds[0]
    if (request.kind === 'theory' || !request.lectureId || request.studentIds.length !== 1 || !studentId) return []
    return active.filter(
      (b) =>
        isFree(b, request) &&
        bookingLessonOf(b, studentId)?.lectureId === request.lectureId &&
        b.instructorId === me &&
        b.resourceId !== undefined &&
        overlaps(toMs(b.start), toMs(b.end), weekStartMs, weekEndMs),
    )
  }
  /**
   * Rögzített elmélet máshová tett foglalása (4. pont): az oktató héten belüli termes foglalása,
   * amelyen az igény minden növendéke (vagy az osztálya) szerepel. Csak rögzített igénynél, mert
   * ott az oktató jelezte, hogy a foglalás a FlightLoggerben van.
   */
  const byParticipants = (request: BookingRequest): ExistingBooking[] => {
    if (request.kind !== 'theory') return []
    return active.filter(
      (b) =>
        isFree(b, request) &&
        b.resourceId === undefined &&
        (b.classroomId !== undefined || b.type === 'meeting') &&
        withMe(b) &&
        b.type !== 'maintenance' &&
        overlaps(toMs(b.start), toMs(b.end), weekStartMs, weekEndMs) &&
        ((request.classId !== undefined && b.classId === request.classId) || (request.studentIds.length > 0 && request.studentIds.every((id) => b.participantIds.includes(id)))),
    )
  }
  const closestTo = (list: readonly ExistingBooking[], ms: number): ExistingBooking | undefined =>
    [...list].sort((a, b) => Math.abs(toMs(a.start) - ms) - Math.abs(toMs(b.start) - ms) || toMs(a.start) - toMs(b.start) || a.id.localeCompare(b.id))[0]

  const link = (request: BookingRequest, b: ExistingBooking, how: BookingLink['how'], recordedSlot?: Slot): BookingLink => {
    claim(b, request)
    const slot = bookingSlotFor(b, request)
    return { requestId: request.id, bookingId: b.id, slot, recorded: recordedSlot !== undefined, how, moved: recordedSlot !== undefined && !samePlace(slot, recordedSlot) }
  }

  // 0. FlightLogger-jelölések
  const changed = new Set<string>()
  const plannedMoves: Array<LinkResult['plannedMoves'][number]> = []
  const plannedCancels: Array<LinkResult['plannedCancels'][number]> = []
  const completedChanges: Array<LinkResult['completedChanges'][number]> = []
  for (const c of [...(input.changes ?? [])].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    const request = requestById.get(c.requestId)
    if (!request || changed.has(request.id)) continue
    changed.add(request.id)
    const b = byBookingId.get(c.bookingId)
    const current = b && isFree(b, request) ? b : undefined
    if (c.kind === 'move') {
      // A terv szerinti hely csak a tervezés után ismert; ott dől el, hogy kell-e még átírni.
      if (current) supersede(current, request)
      plannedMoves.push({ requestId: request.id, bookingId: c.bookingId, ...(current ? { from: bookingSlotFor(current, request) } : {}) })
      continue
    }
    if (!current) {
      // A foglalás már nincs meg (lemondták): kész.
      completedChanges.push({ requestId: request.id, kind: 'cancel', bookingId: c.bookingId })
      continue
    }
    supersede(current, request)
    plannedCancels.push({ requestId: request.id, bookingId: current.id, slot: bookingSlotFor(current, request), done: c.doneAt !== undefined && generatedMs < toMs(c.doneAt) })
  }
  // A kész lemondás igénye halasztott marad (a tervezet ezt rögzíti), ezért nem ismerjük fel újra.
  const handled = new Set([...plannedMoves.map((m) => m.requestId), ...plannedCancels.map((m) => m.requestId), ...completedChanges.map((m) => m.requestId)])

  // 1. Rögzítettnek jelölt igények
  const recordedIds = new Set<string>(handled)
  const entries: Array<{ readonly entry: RecordedEntry; readonly request: BookingRequest; readonly stale: boolean }> = []
  for (const entry of [...(input.recorded ?? [])].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    const request = requestById.get(entry.requestId)
    if (!request || recordedIds.has(request.id)) continue
    recordedIds.add(request.id)
    entries.push({ entry, request, stale: entry.at !== undefined && generatedMs < toMs(entry.at) })
  }
  // a) a párosított foglalás azonosítója és a rögzített hely, minden igényre
  const unresolved: typeof entries = []
  for (const x of entries) {
    const { entry, request, stale } = x
    const known = entry.bookingId ? byBookingId.get(entry.bookingId) : undefined
    if (known && isFree(known, request) && (!stale || atSlot(request, entry.slot)(known))) {
      links.push(link(request, known, 'id', entry.slot))
      continue
    }
    const here = active.find((b) => isFree(b, request) && atSlot(request, entry.slot)(b))
    if (here) links.push(link(request, here, 'slot', entry.slot))
    else unresolved.push(x)
  }
  // b) a rögzítésnél régebbi adat: a hely le van zárva, a régi hely nem foglal
  const searchable: typeof entries = []
  for (const x of unresolved) {
    if (!x.stale) {
      searchable.push(x)
      continue
    }
    const known = x.entry.bookingId ? byBookingId.get(x.entry.bookingId) : undefined
    if (known && isFree(known, x.request)) supersede(known, x.request)
    pending.push(x.entry)
  }
  // c) máshová tették a FlightLoggerben; különben hiányzik
  for (const { entry, request } of searchable) {
    const ref = toMs(entry.slot.start)
    const byLesson = closestTo(byLecture(request), ref)
    const moved = byLesson ?? closestTo(byParticipants(request), ref)
    if (moved) links.push(link(request, moved, byLesson ? 'lecture' : 'participants', entry.slot))
    else {
      missing.push(entry)
      if (cancelledBookings.some((b) => b.id === entry.bookingId || atSlot(request, entry.slot)(b))) cancelled.push(request.id)
    }
  }

  // 2. A FlightLoggerben közvetlenül lefoglalt (rögzítettnek nem jelölt) igények
  const others = input.requests.filter((r) => !recordedIds.has(r.id)).sort((a, b) => a.id.localeCompare(b.id))
  for (const request of others) {
    if (input.deferred?.has(request.id)) continue
    const found = closestTo(byLecture(request), Number.NEGATIVE_INFINITY)
    if (found) links.push(link(request, found, 'lecture'))
  }

  // 3. Halasztott igény, amelynek a foglalása még megvan
  for (const request of others) {
    if (!input.deferred?.has(request.id)) continue
    const found = closestTo(byLecture(request).filter((b) => toMs(b.start) >= generatedMs), Number.NEGATIVE_INFINITY)
    if (found) stillBooked.push(link(request, found, 'lecture'))
  }

  return { links, pending, missing, cancelled: cancelled.sort(), superseded: [...superseded].sort(), deferredStillBooked: stillBooked, plannedMoves, plannedCancels, completedChanges }
}

/** A tervezés pillanatképe az áthelyezett foglalások régi helye nélkül. */
export function withoutSuperseded(snapshot: Snapshot, superseded: readonly string[]): Snapshot {
  if (superseded.length === 0) return snapshot
  const drop = new Set(superseded)
  return { ...snapshot, bookings: snapshot.bookings.filter((b) => !drop.has(b.id)) }
}
