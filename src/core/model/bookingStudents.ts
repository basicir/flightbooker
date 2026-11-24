import type { BookingLesson, ExistingBooking } from './planning'

/**
 * Egy FlightLogger-foglalás növendékei, megfigyelői és a növendékenkénti repülési szakasz
 * (KBR-10). A többnövendékes (multi student) foglalásban a növendékek egymás után repülnek egy
 * közös repülési ablakban; a FlightLogger csak az ablakot tárolja, a szakaszokat innen becsüljük.
 */

const FLIGHT_BOOKINGS: ReadonlySet<ExistingBooking['type']> = new Set(['singleStudent', 'multiStudent'])

/** Megfigyelő-e a foglaláson (résztvevő, de nem repül, nincs feladata). */
export function isObserver(b: ExistingBooking, personId: string): boolean {
  return b.observerIds?.includes(personId) ?? false
}

/** A foglalás repülő résztvevői: a megfigyelők nélkül. */
export function flyingParticipantIds(b: ExistingBooking): string[] {
  return b.participantIds.filter((id) => !isObserver(b, id))
}

/**
 * Repülési foglalás növendékei (Student 1, Student 2 sorrendben), megfigyelők nélkül; más
 * foglalásfajtánál `undefined`.
 */
export function bookingStudentIds(b: ExistingBooking): string[] | undefined {
  if (!FLIGHT_BOOKINGS.has(b.type)) return undefined
  return b.lessons && b.lessons.length > 0 ? b.lessons.map((l) => l.studentId) : flyingParticipantIds(b)
}

/**
 * A növendék tervezett feladata a foglaláson. A megfigyelőnek nincs feladata. A régebbi (a
 * növendékenkénti feladat előtti) adatban az egynövendékes foglalás feladata a növendéké.
 */
export function bookingLessonOf(b: ExistingBooking, studentId: string): BookingLesson | undefined {
  if (isObserver(b, studentId)) return undefined
  const own = b.lessons?.find((l) => l.studentId === studentId)
  if (own) return own
  if (b.lessons === undefined && b.type === 'singleStudent' && b.participantIds.includes(studentId) && (b.lectureId || b.plannedLectureName)) {
    return { studentId, ...(b.lectureId ? { lectureId: b.lectureId } : {}), ...(b.plannedLectureName ? { lectureName: b.plannedLectureName } : {}) }
  }
  return undefined
}

/**
 * A növendék repülési szakasza a foglaláson, ezredmásodpercben. Egynövendékes foglalásnál a
 * teljes repülési ablak. Többnövendékesnél az ablakot a növendékek a FlightLogger sorrendjében
 * repülik, a feladatuk repült idejének arányában (ismeretlen időnél egyenlő részben). A
 * megfigyelőnek és a foglaláson kívülinek nincs szakasza.
 */
export function studentFlightSegment(b: ExistingBooking, studentId: string): { readonly start: number; readonly end: number } | undefined {
  if (!b.flightStart || !b.flightEnd || isObserver(b, studentId)) return undefined
  const start = Date.parse(b.flightStart)
  const end = Date.parse(b.flightEnd)
  if (b.type !== 'multiStudent') return b.participantIds.includes(studentId) ? { start, end } : undefined
  const students = bookingStudentIds(b) ?? []
  const index = students.indexOf(studentId)
  if (index < 0) return undefined
  const weights = students.map((id) => {
    const m = b.lessons?.find((l) => l.studentId === id)?.flightMinutes
    return m !== undefined && m > 0 ? m : 0
  })
  const known = weights.every((w) => w > 0)
  const parts = known ? weights : students.map(() => 1)
  const total = parts.reduce((s, w) => s + w, 0)
  const before = parts.slice(0, index).reduce((s, w) => s + w, 0)
  const span = end - start
  return { start: start + Math.round((span * before) / total), end: start + Math.round((span * (before + parts[index]!)) / total) }
}
