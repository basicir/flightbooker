import type { BookingLesson, ExistingBooking } from '../../core/model/planning'
import type { FleetEntry } from '../../core/model/resources'
import type { Daylight, FlownActivity, WeatherHour } from '../../core/model/snapshot'
import { lectureInfoOf, type LectureInfo, type TrainingRecord } from '../../core/progress/lectures'
import { localParts } from '../../core/time/zoned'
import { ceilingFromProfile } from '../../core/weather/rating'
import { CLOUD_PROFILE_LEVELS_HPA, type ForecastResponse } from '../net/openMeteo'
import type { Aircraft, Booking, PlannedLesson, Training } from '../net/flightLogger/types'

/** A FlightLogger és az Open-Meteo válaszainak leképezése a motor pillanatképére (tiszta függvények). */

const TYPE_BY_TYPENAME: Readonly<Record<string, ExistingBooking['type']>> = {
  SingleStudentBooking: 'singleStudent',
  MultiStudentBooking: 'multiStudent',
  ClassTheoryBooking: 'classTheory',
  ExtraTheoryBooking: 'theory',
  ExamBooking: 'theory',
  ProgressTestBooking: 'theory',
  TheoryReleaseBooking: 'theory',
  TypeQuestionnaireBooking: 'theory',
  MaintenanceBooking: 'maintenance',
  OperationBooking: 'operation',
  MeetingBooking: 'meeting',
  RentalBooking: 'rental',
}

export function mapAircraft(a: Aircraft): FleetEntry {
  return { id: a.id, callSign: a.callSign, model: a.model, aircraftClass: a.aircraftClass, disabled: a.disabled }
}

export function mapBooking(b: Booking): ExistingBooking {
  const ids = (refs: ReadonlyArray<{ id: string } | null> | undefined): string[] => (refs ?? []).filter((r): r is { id: string } => r !== null).map((r) => r.id)
  const students = [...(b.student ? [b.student.id] : []), ...ids(b.students)]
  // A megfigyelő is résztvevő (foglalt), de nem repül, és nincs feladata (KBR-10).
  const observers = ids(b.observers).filter((id) => !students.includes(id))
  const participants = [
    ...students,
    ...ids(b.crew),
    ...(b.pic ? [b.pic.id] : []),
    ...(b.renter ? [b.renter.id] : []),
    ...ids(b.participants),
    ...observers,
  ]
  const lessons = lessonsOf(b, students)
  const instructorId = b.instructor?.id ?? b.pic?.id
  return {
    id: b.id,
    type: TYPE_BY_TYPENAME[b.__typename] ?? 'other',
    status: b.status,
    start: b.startsAt,
    end: b.endsAt,
    ...(b.flightStartsAt ? { flightStart: b.flightStartsAt } : {}),
    ...(b.flightEndsAt ? { flightEnd: b.flightEndsAt } : {}),
    ...(b.aircraft ? { resourceId: b.aircraft.id } : {}),
    ...(b.classroom ? { classroomId: b.classroom.id } : {}),
    ...(instructorId ? { instructorId } : {}),
    ...(b.class ? { classId: b.class.id } : {}),
    participantIds: [...new Set(participants)],
    ...(b.__typename === 'MaintenanceBooking' ? maintenanceLevelOf(b.comment) : {}),
    ...(b.color ? { color: b.color } : {}),
    ...(typeof b.plannedLesson?.lecture?.name === 'string' ? { plannedLectureName: b.plannedLesson.lecture.name } : {}),
    ...(typeof b.plannedLesson?.lecture?.id === 'string' ? { lectureId: b.plannedLesson.lecture.id } : {}),
    ...(lessons ? { lessons } : {}),
    ...(observers.length > 0 ? { observerIds: [...new Set(observers)] } : {}),
  }
}

/**
 * A repülési foglalás növendékei a tervezett feladatukkal, a FlightLogger sorrendjében (Student 1,
 * Student 2). Más foglalásfajtánál nincs. A többnövendékes foglalás feladatai növendékenként
 * jönnek; ha egy feladat a növendékek listáján kívüli növendékhez tartozik, a végére kerül.
 */
function lessonsOf(b: Booking, students: readonly string[]): BookingLesson[] | undefined {
  if (b.__typename !== 'SingleStudentBooking' && b.__typename !== 'MultiStudentBooking') return undefined
  const planned = new Map<string, PlannedLesson>()
  if (b.__typename === 'SingleStudentBooking' && b.student && b.plannedLesson) planned.set(b.student.id, b.plannedLesson)
  for (const p of b.plannedLessons ?? []) {
    if (p?.student && !planned.has(p.student.id)) planned.set(p.student.id, p)
  }
  const order = [...new Set([...students, ...planned.keys()])]
  return order.map((studentId) => {
    const lecture = planned.get(studentId)?.lecture
    const name = typeof lecture?.name === 'string' ? lecture.name : undefined
    const flightMinutes = lecture && name !== undefined ? lectureInfoOf({ ...lecture, name }).flightMinutes : 0
    return {
      studentId,
      ...(typeof lecture?.id === 'string' ? { lectureId: lecture.id } : {}),
      ...(name !== undefined ? { lectureName: name } : {}),
      ...(flightMinutes > 0 ? { flightMinutes } : {}),
    }
  })
}

/**
 * A karbantartás fajtája a komment szövegéből (Q8): a karbantartó az 50, 100 vagy 200 órás
 * karbantartást így jelzi; más szöveg (például javítás) esetén nincs fajta. A szöveg maga nem
 * kerül tovább.
 */
export function maintenanceLevelOf(comment: string | null | undefined): { maintenanceLevel?: 50 | 100 | 200 } {
  const m = /(?:^|\D)(50|100|200)(?!\d)/.exec(comment ?? '')
  return m ? { maintenanceLevel: Number(m[1]) as 50 | 100 | 200 } : {}
}

const programOf = (up: { readonly name?: string | null; readonly programRevision?: { readonly id: string; readonly name?: string } | null } | null | undefined) => ({
  revisionId: up?.programRevision?.id,
  programName: up?.name ?? undefined,
  revisionName: up?.programRevision?.name ?? undefined,
})

/** Feladatok az elkönyvelt feladatokból, programrevízióval (SZB-02). */
export function lecturesFromTrainings(trainings: ReadonlyArray<Pick<Training, 'lecture' | 'userProgram'>>): LectureInfo[] {
  return trainings.flatMap((t) => (t.lecture ? [lectureInfoOf(t.lecture, programOf(t.userProgram))] : []))
}

/** Feladatok a foglalások tervezett feladataiból; a még senki által nem repült feladatokat is pótolja. */
export function lecturesFromBookings(bookings: readonly Booking[]): LectureInfo[] {
  return bookings.flatMap((b) =>
    [b.plannedLesson, ...(b.plannedLessons ?? [])].flatMap((p) => {
      const lecture = p?.lecture
      if (!lecture || typeof lecture.name !== 'string') return []
      return [lectureInfoOf({ ...lecture, name: lecture.name }, programOf(p.userProgram))]
    }),
  )
}

/** Növendékenként az elkönyvelt feladatok a haladáshoz. */
export function trainingRecordsByStudent(trainings: readonly Training[]): Record<string, TrainingRecord[]> {
  const result: Record<string, TrainingRecord[]> = {}
  for (const t of trainings) {
    const sid = t.student?.id
    if (!sid || !t.lecture) continue
    const firstFlight = t.flights.find((f) => f !== null)?.offBlock
    const program = programOf(t.userProgram)
    ;(result[sid] ??= []).push({
      lectureId: t.lecture.id,
      status: t.status,
      at: firstFlight ?? t.audit?.createdAt ?? undefined,
      ...(program.revisionId ? { revisionId: program.revisionId } : {}),
      ...(program.programName ? { programName: program.programName } : {}),
      ...(program.revisionName ? { revisionName: program.revisionName } : {}),
      lectureName: t.lecture.name,
      custom: /^\s*custom lesson\b/i.test(t.name),
    })
  }
  return result
}

/**
 * A növendékek múltbeli repülései (block time) a növendéki limitekhez (TM II.6.4). A
 * szimulátort a feladat tervezett perceiből ismerjük fel; azonos repülés csak egyszer számít.
 */
export function studentFlightsFrom(trainings: readonly Training[], studentIds: readonly string[], fromMs: number): Record<string, FlownActivity[]> {
  const result: Record<string, FlownActivity[]> = Object.fromEntries(studentIds.map((id) => [id, []]))
  const seen = new Set<string>()
  for (const t of trainings) {
    const sid = t.student?.id
    if (!sid || !(sid in result)) continue
    const simulator = t.lecture ? lectureInfoOf(t.lecture).simulator : false
    for (const f of t.flights) {
      if (!f || !f.offBlock || !f.onBlock || seen.has(`${sid}|${f.id}`)) continue
      if (Date.parse(f.onBlock) < fromMs) continue
      seen.add(`${sid}|${f.id}`)
      result[sid]!.push({ start: f.offBlock, end: f.onBlock, simulator })
    }
  }
  return result
}

/** A növendékek utolsó repülése az elvégzett feladatok repüléseiből (NOV-08). */
export function lastFlights(trainings: readonly Training[], studentIds: readonly string[]): Record<string, string | null> {
  const result: Record<string, string | null> = Object.fromEntries(studentIds.map((id) => [id, null]))
  for (const t of trainings) {
    const sid = t.student?.id
    if (!sid || !(sid in result)) continue
    for (const f of t.flights) {
      if (!f) continue
      const current = result[sid]
      if (!current || Date.parse(f.onBlock) > Date.parse(current)) result[sid] = f.onBlock
    }
  }
  return result
}

const FT_PER_M = 3.28084

/** Az Open-Meteo órás értékei UTC-ben (a kérés `timezone=GMT`-vel megy). */
export function mapForecast(response: ForecastResponse, timeZone: string): { hours: WeatherHour[]; daylight: Record<string, Daylight> } {
  const h = response.hourly ?? {}
  const times = (h.time ?? []) as readonly string[]
  const num = (name: string, i: number): number | null => {
    const v = (h[name] as ReadonlyArray<number | string | null> | undefined)?.[i]
    return typeof v === 'number' ? v : null
  }
  // Plafon a modell felhőprofiljából; a geopotenciális magasság tengerszint feletti, a
  // válasz `elevation` mezője a koordináta terepmagassága.
  const elevation = typeof response.elevation === 'number' ? response.elevation : null
  const ceilingAt = (i: number): number | null => {
    if (elevation === null) return null
    const agl = (z: number | null): number | null => (z === null ? null : (z - elevation) * FT_PER_M)
    const ft = ceilingFromProfile(
      CLOUD_PROFILE_LEVELS_HPA.map((p) => ({ heightAglFt: agl(num(`geopotential_height_${p}hPa`, i)), coverPct: num(`cloud_cover_${p}hPa`, i) })),
      // Az ICON alacsony felhőzete a talajtól 800 hPa-ig tart.
      { coverPct: num('cloud_cover_low', i), topFt: agl(num('geopotential_height_800hPa', i)) },
    )
    return ft === null ? null : Math.round(ft)
  }
  const hours: WeatherHour[] = times.map((t, i) => ({
    time: new Date(`${t}:00Z`).toISOString(),
    temperatureC: num('temperature_2m', i),
    dewPointC: num('dew_point_2m', i),
    windSpeedKt: num('wind_speed_10m', i),
    windDirectionDeg: num('wind_direction_10m', i),
    windGustKt: num('wind_gusts_10m', i),
    visibilityM: num('visibility', i),
    cloudCoverLowPct: num('cloud_cover_low', i),
    precipitationMm: num('precipitation', i),
    precipitationProbabilityPct: num('precipitation_probability', i),
    capeJPerKg: num('cape', i),
    weatherCode: num('weather_code', i),
    ceilingFt: ceilingAt(i),
  }))
  const daylight: Record<string, Daylight> = {}
  const d = response.daily ?? {}
  const sunrise = (d['sunrise'] ?? []) as ReadonlyArray<string | number | null>
  const sunset = (d['sunset'] ?? []) as ReadonlyArray<string | number | null>
  sunrise.forEach((rise, i) => {
    const set = sunset[i]
    if (typeof rise !== 'string' || typeof set !== 'string') return
    const riseIso = new Date(`${rise}:00Z`).toISOString()
    const date = localParts(Date.parse(riseIso), timeZone).date
    daylight[date] = { sunrise: riseIso, sunset: new Date(`${set}:00Z`).toISOString() }
  })
  return { hours, daylight }
}
