import { requestPriorityOf } from '../config/operations'
import type { Settings } from '../config/schema'
import { applyLecture, defaultFlightRequest } from '../draft/weekPlan'
import { bookingLessonOf } from '../model/bookingStudents'
import type { BookingRequest, ExistingBooking } from '../model/planning'
import { lectureOrderKey, programLectures, repeatsLastLecture, suggestNextLecture, type LectureInfo, type StudentProgress } from './lectures'

/**
 * Automatikus feladatválasztás (7.5, SZB-02). Szabályok:
 * - a legutóbb repült feladat (egyedi feladat nélkül) utáni első, még nem teljesített feladat;
 *   sikertelen feladat után ugyanaz;
 * - a FlightLoggerben már lefoglalt jövőbeli feladatokat átugorja;
 * - a növendék több igénye a héten egymást követő feladatokat kap, elsőbbség, azon belül a lista
 *   sorrendjében (ELS-05; a későbbi a korábbi sikerét feltételezi; a tervezet ezt jelzi, és a
 *   motor időben is ebben a sorrendben helyezi el őket, lásd `lectureSequences`);
 * - csak az automatikus módú igényeket módosítja; a kézzel választott feladatot nem írja
 *   felül, de azt sem adja oda másik igénynek;
 * - a FlightLoggerben már lefoglalt igény (9.6 párosítás) a foglalás feladatát tartja: azt
 *   a FlightLoggerben ezzel a feladattal vitték fel, ezért nem ugrik a következőre.
 * Ha a feladat elkészül (elkönyvelik), a következő frissítéskor az automatikus igény a
 * rákövetkezőt kapja (TRV-19).
 */

const keyOf = (name: string): string | undefined => {
  const k = lectureOrderKey(name)
  return k ? `${k[0]}/${k[1]}` : undefined
}

/** A növendék jövőbeli, FlightLoggerben lefoglalt feladatai a programja feladatlistájára vetítve. */
export function bookedLectureIds(
  progress: StudentProgress | undefined,
  catalog: Readonly<Record<string, LectureInfo>>,
  bookings: readonly ExistingBooking[],
  studentId: string,
  nowMs: number,
): Set<string> {
  const result = new Set<string>()
  if (!progress) return result
  const byKey = new Map<string, string>()
  for (const l of programLectures(catalog, progress.revisionId)) {
    const key = keyOf(l.name)
    if (key && !byKey.has(key)) byKey.set(key, l.id)
  }
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || Date.parse(b.start) < nowMs) continue
    // A növendék saját feladata: a többnövendékes foglalásnál növendékenként, a megfigyelőnek nincs (KBR-10).
    const name = bookingLessonOf(b, studentId)?.lectureName
    if (!name) continue
    const id = byKey.get(keyOf(name) ?? '')
    if (id) result.add(id)
  }
  return result
}

/**
 * A növendék már foglalt feladatai: a FlightLoggerben jövőre lefoglaltak és amelyeket a hét más
 * igénye tart. Az új igény ezeket átugorja.
 */
export function takenLectureIds(o: {
  readonly studentId: string
  readonly requests: readonly BookingRequest[]
  readonly progress: StudentProgress | undefined
  readonly catalog: Readonly<Record<string, LectureInfo>>
  readonly bookings: readonly ExistingBooking[]
  readonly nowMs: number
}): Set<string> {
  const taken = bookedLectureIds(o.progress, o.catalog, o.bookings, o.studentId, o.nowMs)
  for (const r of o.requests) if (r.studentIds.includes(o.studentId) && r.lectureId) taken.add(r.lectureId)
  return taken
}

/**
 * Új repülési igény a növendéknek, ahogy a Heti igényeken a felvétel létrehozza (KIT-05): időpont
 * nélkül, a soron következő, még nem foglalt feladattal (automatikus módban a feladatot utána a
 * kiosztás adja). A plusz igény ugyanezzel készül, csak a kitöltő elsőbbséggel.
 */
export function newFlightRequest(o: {
  readonly settings: Settings
  readonly studentId: string
  readonly id: string
  readonly taken: ReadonlySet<string>
  readonly progress: StudentProgress | undefined
  readonly catalog: Readonly<Record<string, LectureInfo>>
  readonly priority?: number
}): BookingRequest {
  const request = defaultFlightRequest(o.settings, o.studentId, o.id, suggestNextLecture(o.progress, o.catalog, o.taken))
  return o.priority === undefined ? request : { ...request, priority: o.priority }
}

export interface AutoAssignInput {
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  readonly catalog: Readonly<Record<string, LectureInfo>>
  readonly progressFor: (studentId: string) => StudentProgress | undefined
  readonly bookings: readonly ExistingBooking[]
  readonly nowMs: number
  /** A FlightLoggerben már lefoglalt igények: igény → a foglalás feladata (ha ismert). */
  readonly linked?: ReadonlyMap<string, string | undefined>
}

/** Az automatikus módú igények feladatának kiosztása. Változatlan igény ugyanaz az objektum marad. */
export function assignAutomaticLectures(input: AutoAssignInput): BookingRequest[] {
  const result = [...input.requests]
  const students = [...new Set(input.requests.filter((r) => r.kind !== 'theory' && r.taskSelectionMode === 'automatic').map((r) => r.studentIds[0]).filter((id): id is string => !!id))]
  for (const studentId of students) {
    const progress = input.progressFor(studentId)
    if (!progress) continue
    const own = result.map((r, i) => ({ r, i })).filter(({ r }) => r.kind !== 'theory' && r.studentIds[0] === studentId)
    const taken = bookedLectureIds(progress, input.catalog, input.bookings, studentId, input.nowMs)
    for (const { r, i } of own) {
      if (input.linked?.has(r.id)) {
        // A lefoglalt igény a foglalás feladatát kapja (automatikus módban), és azt tartja.
        const booked = input.linked.get(r.id)
        const lecture = booked ? input.catalog[booked] : undefined
        if (r.taskSelectionMode === 'automatic' && lecture && r.lectureId !== lecture.id) result[i] = applyLecture(input.settings, r, lecture)
        const kept = result[i]!.lectureId
        if (kept) taken.add(kept)
        continue
      }
      if (r.taskSelectionMode !== 'automatic' && r.lectureId) taken.add(r.lectureId)
    }
    // Elsőbbség, azon belül a lista sorrendje (ELS-05): a fontosabb igény kapja a korábbi feladatot.
    const ordered = [...own].sort((a, b) => requestPriorityOf(input.settings, a.r) - requestPriorityOf(input.settings, b.r) || a.i - b.i)
    for (const { r, i } of ordered) {
      if (r.taskSelectionMode !== 'automatic' || input.linked?.has(r.id)) continue
      const lecture = suggestNextLecture(progress, input.catalog, taken)
      if (lecture) {
        taken.add(lecture.id)
        if (r.lectureId !== lecture.id) result[i] = applyLecture(input.settings, r, lecture)
      } else if (r.lectureId) {
        result[i] = applyLecture(input.settings, r, undefined)
      }
    }
  }
  return result
}

export interface SequenceInput {
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  readonly catalog: Readonly<Record<string, LectureInfo>>
  readonly progressFor: (studentId: string) => StudentProgress | undefined
}

/**
 * Feladatsorrend a héten (ELS-05): növendékenként az automatikus feladatú igények abban a
 * sorrendben, ahogy a feladatuk a növendék haladásában következik – a legutóbb repült feladat
 * után a programban előre, a végén elölről, sikertelen feladatnál az ismétléssel kezdve (mint a
 * `nextLecture`). A FlightLoggerben már lefoglalt igény a foglalása feladatával áll a sorban. A
 * motor ezt időben is betartja: a sorban későbbi igény nem kezdődhet a korábbi vége előtt.
 *
 * Csak a legalább kéttagú sorok kerülnek bele. A kézzel választott feladatú igény nem része a
 * sornak (azt az oktató tudatosan választotta). Ismeretlen haladásnál, vagy ha egy feladat nincs a
 * programban, az elsőbbség, azon belül a lista sorrendje dönt.
 */
export function lectureSequences(input: SequenceInput): string[][] {
  const byStudent = new Map<string, Array<{ readonly r: BookingRequest; readonly i: number }>>()
  input.requests.forEach((r, i) => {
    const studentId = r.studentIds[0]
    if (r.kind === 'theory' || r.taskSelectionMode !== 'automatic' || !r.lectureId || !studentId) return
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), { r, i }])
  })
  const result: string[][] = []
  for (const [studentId, list] of [...byStudent].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length < 2) continue
    const progress = input.progressFor(studentId)
    const program = progress ? programLectures(input.catalog, progress.revisionId) : []
    const position = new Map(program.map((l, k) => [l.id, k]))
    const last = progress?.lastLectureId
    const lastIndex = last !== undefined ? (position.get(last) ?? -1) : -1
    const repeat = progress !== undefined && repeatsLastLecture(progress)
    const rank = (lectureId: string): number | undefined => {
      const k = position.get(lectureId)
      if (k === undefined) return undefined
      if (repeat && lectureId === last) return -1
      return (k - lastIndex - 1 + program.length) % program.length
    }
    const ranked = list.every(({ r }) => rank(r.lectureId!) !== undefined)
    const sorted = [...list].sort(
      (a, b) =>
        (ranked ? rank(a.r.lectureId!)! - rank(b.r.lectureId!)! : 0) ||
        requestPriorityOf(input.settings, a.r) - requestPriorityOf(input.settings, b.r) ||
        a.i - b.i,
    )
    result.push(sorted.map(({ r }) => r.id))
  }
  return result
}
