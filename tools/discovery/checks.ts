import { buildClientSchema, parse, printSchema, validate, type GraphQLSchema } from 'graphql'
import type { FlightLoggerClient } from '../../src/main/net/flightLogger/client'
import {
  AircraftAvailabilitiesQuery,
  AircraftQuery,
  ALL_QUERIES,
  BookingsQuery,
  ClassesQuery,
  ClassroomsQuery,
  FlightsQuery,
  IntrospectionQuery,
  LogbookEntriesQuery,
  LogbookSummationQuery,
  ProgramsQuery,
  TrainingsQuery,
  UserAvailabilitiesQuery,
  UserProgramsQuery,
  UsersByRoleQuery,
  ViewerQuery,
} from '../../src/main/net/flightLogger/queries'
import type { Aircraft, Booking, IdRef, Lecture, Training, UserRole } from '../../src/main/net/flightLogger/types'
import type { ForecastRequest, ForecastResponse } from '../../src/main/net/openMeteo'
import { countBy, distribution, minutesBetween, ratio, type Counts, type Distribution } from './stats'

/**
 * A felderítés (koncepció 13.1, K02) ellenőrzései. Minden ellenőrzés csak névtelen
 * összesítést ad vissza: darabszámot, arányt, enum-értéket, mértékegységet.
 * Név, e-mail, komment és felhasználói azonosító nem kerül az eredménybe; a látott
 * neveket és kommenteket a `sensitive` halmaz gyűjti, hogy a jelentésből kitakarhatók legyenek.
 */

export interface DiscoveryInput {
  readonly client: FlightLoggerClient
  readonly now: Date
  readonly pastDays: number
  readonly futureDays: number
  readonly airport?: { readonly latitude: number; readonly longitude: number }
  /** Egy ismert, nem publikált teszt-foglalás kezdete (opcionális). */
  readonly unpublishedProbe?: Date
  readonly fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>
  readonly saveSchema: (sdl: string) => Promise<string>
  readonly log: (line: string) => void
}

export interface CheckOutcome<T> {
  readonly status: 'ok' | 'hiba' | 'kihagyva'
  readonly durationMs: number
  readonly error?: string
  readonly data?: T
}

export interface ViewerData {
  readonly bookingTimeZone: string | null
  readonly flightTimeZone: string | null
  readonly theoryTimeZone: string | null
}

export interface SchemaData {
  readonly savedTo: string
  readonly typeCount: number
  readonly queryFields: number
  readonly mutationFields: number
  readonly validation: Readonly<Record<string, readonly string[]>>
}

export interface AircraftMaintenanceRow {
  readonly callSign: string
  readonly model: string
  readonly aircraftClass: string
  readonly timeLeft: number | null
  readonly daysLeft: number | null
  readonly cyclesLeft: number | null
  readonly warningStatus: string | null
  readonly warningSubject: string | null
  readonly warningLogType: string | null
  readonly warningMeasurement: string | null
  readonly warningTimerType: string | null
  readonly nextPrimaryService: number | null
  readonly nextServiceDate: string | null
  readonly primaryLogHours: number | null
  readonly primaryLogType: string | null
  readonly primaryLogMeasurement: string | null
  readonly airborneHours: number | null
  /** nextPrimaryService − primaryLog óra: ha ez egyezik a timeLeft-tel, a timeLeft a szervizig hátralévő óra. */
  readonly derivedHoursToService: number | null
}

export interface AircraftData {
  readonly total: number
  readonly byClass: Counts
  readonly byModel: Counts
  readonly disabled: number
  readonly homeAirports: Counts
  readonly locationKinds: Counts
  readonly maintenance: readonly AircraftMaintenanceRow[]
  readonly availabilityEvents: number
  readonly aircraftWithAvailability: number
  readonly availabilityTruncated: number
}

export interface BookingStats {
  readonly total: number
  readonly byType: Counts
  readonly byStatus: Counts
  readonly past: number
  readonly future: number
  readonly aircraftBookings: number
  readonly aircraftNullRatio: number | null
  readonly distinctAircraft: number
  readonly aircraftWithoutBookings: number | null
  readonly instructorPresentRatio: number | null
  readonly distinctInstructors: number
  readonly ownInstructor: number
  readonly otherInstructor: number
  readonly singleStudentNullStudentRatio: number | null
  readonly plannedLessonRatio: number | null
  readonly commentNonEmpty: number
  readonly colors: Counts
  readonly createdByOwn: number
  readonly auditMissingRatio: number | null
  readonly briefingMinutes: Distribution
  readonly flightMinutes: Distribution
  readonly debriefingMinutes: Distribution
  readonly classroomBookings: number
  readonly classroomNullRatio: number | null
}

export interface BookingsData {
  readonly windowFrom: string
  readonly windowTo: string
  readonly own: BookingStats
  readonly all: BookingStats
  readonly ownStudents: number
  readonly ownStudentsBookingsWithOtherInstructor: number
  readonly ownStudentsBookingsWithoutInstructor: number
}

export interface UnpublishedData {
  readonly probe: string | null
  readonly matchesOwn: number
  readonly matchesAll: number
  readonly matches: ReadonlyArray<{ readonly type: string; readonly status: string; readonly color: string | null; readonly createdByOwn: boolean }>
  readonly createdByOwnLast48h: number
}

export interface UsersData {
  readonly byRole: Readonly<Partial<Record<UserRole, number | string>>>
  readonly studentNameVisibleRatio: number | null
  readonly ownStudentsFoundInStudentList: number | null
}

export interface AvailabilityData {
  readonly windowDays: number
  readonly own: { readonly events: number; readonly unavailable: number } | { readonly error: string }
  readonly studentsSampled: number
  readonly studentsWithAny: number
  readonly studentEvents: number
  readonly studentErrors: number
}

export interface ClassroomData {
  readonly active: number
  readonly includingDisabled: number
  readonly locationKinds: Counts
  readonly classes: number | string
  readonly classSizes: Distribution | null
}

export interface ProgramData {
  readonly programs: number
  readonly byType: Counts
  readonly revisions: number
  readonly phases: number
  readonly lectures: number
  readonly lectureCategories: Counts
  readonly briefingMinutes: Distribution
  readonly debriefingMinutes: Distribution
  readonly flightMinutes: Distribution
  readonly lecturesWithoutDurations: number
}

export interface ProgressData {
  readonly studentsQueried: number
  readonly userPrograms: number | string
  readonly userProgramStatus: Counts
  readonly trainings: number | string
  readonly trainingStatus: Counts
  readonly failedPerformance: number
  readonly withFlightsRatio: number | null
  readonly withBookingRatio: number | null
  readonly daysSinceLastFlight: Distribution
  /** A Training → Lecture úton látott feladatok (ha a programs lekérdezés üres). */
  readonly lecturesViaTrainings: number
  readonly lecturesWithPhaseRatio: number | null
  readonly lectureBriefingMinutes: Distribution
  readonly lectureFlightMinutes: Distribution
  readonly lectureDebriefingMinutes: Distribution
  /**
   * Ki látszik oktatóként a saját növendékek feladatainál: növendékszűrővel (`userIds`)
   * és iskolai szinten (szűrő nélkül, utólag a saját növendékekre szűkítve), azonos ablakra.
   */
  readonly trainingVisibility: TrainingVisibility | string
}

export interface TrainingVisibility {
  readonly byStudentFilter: { readonly total: number; readonly ownInstructor: number; readonly otherInstructor: number; readonly distinctInstructors: number }
  readonly schoolWide: {
    readonly total: number
    readonly ofOwnStudents: number
    readonly ownInstructor: number
    readonly otherInstructor: number
    readonly distinctInstructors: number
    /** Saját növendék feladata, amely csak az iskolai szintű lekérdezésben látszik. */
    readonly missingFromStudentFilter: number
  }
}

export interface FlightsData {
  readonly windowDays: number
  readonly own: number
  readonly all: number
  readonly distinctAircraftAll: number
  readonly flightTypes: Counts
}

export interface LogbookData {
  /** `myFlightLogger`, vagy ha az iskolai kulccsal nem érhető el, a saját repülésekből számolt tartalék. */
  readonly source: 'myFlightLogger' | 'flights'
  readonly myFlightLoggerError?: string
  readonly entries365: number
  readonly hours365FromEntries: number
  readonly instructorHours365FromEntries: number
  readonly syntheticHours365FromEntries: number
  readonly includeInFtl: Counts
  readonly summation365Hours: number | null
  readonly summation28Hours: number | null
  readonly summationYearHours: number | null
}

export interface WeatherVariableCoverage {
  readonly nonNull: number
  readonly lastHourAhead: number | null
  readonly unit: string | null
}

export interface WeatherModelData {
  readonly model: string
  readonly status: 'ok' | 'hiba'
  readonly error?: string
  readonly hours?: number
  readonly elevation?: number
  readonly timezone?: string
  readonly variables?: Readonly<Record<string, WeatherVariableCoverage>>
  readonly dailyPresent?: Readonly<Record<string, number>>
}

export interface NetworkData {
  readonly requests: number
  readonly rateLimited: number
  readonly maxRetryAfterSeconds: number | null
  readonly totalMs: number
  readonly byQuery: Counts
}

export interface DiscoveryResult {
  readonly startedAt: string
  readonly finishedAt: string
  readonly settings: { readonly pastDays: number; readonly futureDays: number; readonly weather: boolean; readonly unpublishedProbe: boolean }
  readonly viewer: CheckOutcome<ViewerData>
  readonly schema: CheckOutcome<SchemaData>
  readonly aircraft: CheckOutcome<AircraftData>
  readonly bookings: CheckOutcome<BookingsData>
  readonly unpublished: CheckOutcome<UnpublishedData>
  readonly users: CheckOutcome<UsersData>
  readonly availability: CheckOutcome<AvailabilityData>
  readonly classrooms: CheckOutcome<ClassroomData>
  readonly programs: CheckOutcome<ProgramData>
  readonly progress: CheckOutcome<ProgressData>
  readonly flights: CheckOutcome<FlightsData>
  readonly logbook: CheckOutcome<LogbookData>
  readonly weather: CheckOutcome<readonly WeatherModelData[]>
  readonly network?: NetworkData
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEATHER_MODELS = ['best_match', 'icon_d2', 'icon_eu', 'icon_seamless'] as const
const STUDENT_SAMPLE = 15

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // A hibaüzenet is a jelentésbe kerül, ezért hosszát korlátozzuk.
  return message.length > 400 ? `${message.slice(0, 400)}…` : message
}

async function runCheck<T>(name: string, log: (line: string) => void, fn: () => Promise<T>): Promise<CheckOutcome<T>> {
  const started = Date.now()
  log(`  … ${name}`)
  try {
    const data = await fn()
    return { status: 'ok', durationMs: Date.now() - started, data }
  } catch (error) {
    log(`    ! ${name}: ${errorText(error)}`)
    return { status: 'hiba', durationMs: Date.now() - started, error: errorText(error) }
  }
}

const skipped = <T>(reason: string): CheckOutcome<T> => ({ status: 'kihagyva', durationMs: 0, error: reason })

/**
 * A saját növendékek feladatai növendékszűrővel és iskolai szinten (azonos ablak). Ha az
 * iskolai szintű lekérdezésben más oktató feladatai is látszanak, a haladást onnan kell
 * venni: a növendékszűrős lekérdezés csak a kulcs tulajdonosáét adhatja.
 */
async function compareTrainingVisibility(
  client: FlightLoggerClient,
  studentIds: readonly string[],
  viewerId: string | undefined,
  from: string,
  to: string,
): Promise<TrainingVisibility> {
  const students = new Set(studentIds)
  const instructorStats = (list: readonly Training[]) => {
    const ids = list.map((t) => t.instructor?.id).filter((id): id is string => id !== undefined)
    return {
      ownInstructor: ids.filter((id) => id === viewerId).length,
      otherInstructor: ids.filter((id) => id !== viewerId).length,
      distinctInstructors: new Set(ids).size,
    }
  }
  const filtered = await client.fetchAll(TrainingsQuery, { userIds: [...studentIds], from, to, all: true }, (d) => d.trainings)
  const school = await client.fetchAll(TrainingsQuery, { from, to, all: true }, (d) => d.trainings)
  const ofOwn = school.filter((t) => t.student !== null && students.has(t.student.id))
  const seen = new Set(filtered.map((t) => t.id))
  return {
    byStudentFilter: { total: filtered.length, ...instructorStats(filtered) },
    schoolWide: {
      total: school.length,
      ofOwnStudents: ofOwn.length,
      ...instructorStats(ofOwn),
      missingFromStudentFilter: ofOwn.filter((t) => !seen.has(t.id)).length,
    },
  }
}

const ids = (refs: ReadonlyArray<IdRef | null> | undefined | null): string[] =>
  (refs ?? []).filter((r): r is IdRef => r !== null).map((r) => r.id)

function lectureFlightMinutes(l: Lecture): number {
  return l.vfrDualMinutes + l.vfrSoloMinutes + l.vfrSimMinutes + l.vfrSpicMinutes + l.ifrDualMinutes + l.ifrSimMinutes + l.ifrSpicMinutes
}

function bookingStudents(b: Booking): string[] {
  return [...(b.student ? [b.student.id] : []), ...ids(b.students)]
}

function bookingStats(bookings: readonly Booking[], viewerId: string | undefined, now: Date, aircraftIds: readonly string[] | undefined): BookingStats {
  const aircraftBookings = bookings.filter((b) => 'flightStartsAt' in b && b.flightStartsAt !== undefined)
  const withInstructorField = bookings.filter((b) => 'instructor' in b)
  const instructorIds = withInstructorField.map((b) => b.instructor?.id).filter((id): id is string => !!id)
  const singleStudent = bookings.filter((b) => b.__typename === 'SingleStudentBooking')
  const ground = bookings.filter((b) => 'classroom' in b)
  const seenAircraft = new Set(aircraftBookings.map((b) => b.aircraft?.id).filter((id): id is string => !!id))

  return {
    total: bookings.length,
    byType: countBy(bookings, (b) => b.__typename),
    byStatus: countBy(bookings, (b) => b.status),
    past: bookings.filter((b) => Date.parse(b.startsAt) < now.getTime()).length,
    future: bookings.filter((b) => Date.parse(b.startsAt) >= now.getTime()).length,
    aircraftBookings: aircraftBookings.length,
    aircraftNullRatio: ratio(aircraftBookings, (b) => !b.aircraft),
    distinctAircraft: seenAircraft.size,
    aircraftWithoutBookings: aircraftIds ? aircraftIds.filter((id) => !seenAircraft.has(id)).length : null,
    instructorPresentRatio: ratio(withInstructorField, (b) => !!b.instructor),
    distinctInstructors: new Set(instructorIds).size,
    ownInstructor: viewerId ? instructorIds.filter((id) => id === viewerId).length : 0,
    otherInstructor: viewerId ? instructorIds.filter((id) => id !== viewerId).length : 0,
    singleStudentNullStudentRatio: ratio(singleStudent, (b) => !b.student),
    plannedLessonRatio: ratio(singleStudent, (b) => !!b.plannedLesson),
    commentNonEmpty: bookings.filter((b) => (b.comment ?? '').trim() !== '').length,
    colors: countBy(bookings, (b) => b.color),
    createdByOwn: viewerId ? bookings.filter((b) => b.audit?.createdById === viewerId).length : 0,
    auditMissingRatio: ratio(bookings, (b) => !b.audit?.createdAt),
    briefingMinutes: distribution(aircraftBookings.map((b) => minutesBetween(b.startsAt, b.flightStartsAt) ?? Number.NaN)),
    flightMinutes: distribution(aircraftBookings.map((b) => minutesBetween(b.flightStartsAt, b.flightEndsAt) ?? Number.NaN)),
    debriefingMinutes: distribution(aircraftBookings.map((b) => minutesBetween(b.flightEndsAt, b.endsAt) ?? Number.NaN)),
    classroomBookings: ground.length,
    classroomNullRatio: ratio(ground, (b) => !b.classroom),
  }
}

function summarizeForecast(model: string, response: ForecastResponse, now: Date): WeatherModelData {
  const hourly = response.hourly ?? {}
  const times = (hourly.time ?? []) as readonly string[]
  const offsetMs = (response.utc_offset_seconds ?? 0) * 1000
  const variables: Record<string, WeatherVariableCoverage> = {}
  for (const [name, values] of Object.entries(hourly)) {
    if (name === 'time' || !Array.isArray(values)) continue
    let last = -1
    let nonNull = 0
    values.forEach((v, i) => {
      if (v !== null) {
        nonNull++
        last = i
      }
    })
    const lastTime = last >= 0 ? times[last] : undefined
    // Az Open-Meteo `timezone=auto` mellett helyi időt ad eltolás nélkül; UTC-re visszaszámoljuk.
    const lastMs = lastTime ? Date.parse(`${lastTime}:00Z`) - offsetMs : Number.NaN
    variables[name] = {
      nonNull,
      lastHourAhead: Number.isNaN(lastMs) ? null : Math.round((lastMs - now.getTime()) / 3600000),
      unit: response.hourly_units?.[name] ?? null,
    }
  }
  const daily = response.daily ?? {}
  const dailyPresent: Record<string, number> = {}
  for (const [name, values] of Object.entries(daily)) {
    if (name !== 'time' && Array.isArray(values)) dailyPresent[name] = values.filter((v) => v !== null).length
  }
  return {
    model,
    status: 'ok',
    hours: times.length,
    ...(response.elevation !== undefined ? { elevation: response.elevation } : {}),
    ...(response.timezone !== undefined ? { timezone: response.timezone } : {}),
    variables,
    dailyPresent,
  }
}

export async function runDiscovery(input: DiscoveryInput, sensitive: Set<string>): Promise<Omit<DiscoveryResult, 'network'>> {
  const { client, now, log } = input
  const startedAt = new Date().toISOString()
  const windowFrom = startOfUtcDay(new Date(now.getTime() - input.pastDays * DAY_MS))
  const windowTo = startOfUtcDay(new Date(now.getTime() + (input.futureDays + 1) * DAY_MS))
  const iso = (d: Date): string => d.toISOString()

  log('Felderítés indul.')

  // 1. A kulcs tulajdonosa
  let viewerId: string | undefined
  const viewer = await runCheck('kulcs tulajdonosa', log, async () => {
    const data = await client.query(ViewerQuery, {})
    if (!data.user) throw new Error('A kulcshoz nem tartozik felhasználó.')
    viewerId = data.user.id
    return {
      bookingTimeZone: data.user.bookingTimeZone,
      flightTimeZone: data.user.flightTimeZone,
      theoryTimeZone: data.user.theoryTimeZone,
    }
  })
  if (viewer.status !== 'ok') {
    log('A kulcs nem működik, a további ellenőrzések kimaradnak.')
  }
  const needViewer = <T>(fn: () => Promise<CheckOutcome<T>>): Promise<CheckOutcome<T>> =>
    viewer.status === 'ok' ? fn() : Promise.resolve(skipped<T>('A kulcs ellenőrzése nem sikerült.'))

  // 2. Séma introspekció és a rögzített lekérdezések validálása
  const schema = await needViewer(() =>
    runCheck('séma (introspekció)', log, async () => {
      const result = await client.query(IntrospectionQuery, {})
      const built: GraphQLSchema = buildClientSchema(result)
      const sdl = printSchema(built)
      const savedTo = await input.saveSchema(sdl)
      const validation: Record<string, string[]> = {}
      for (const query of ALL_QUERIES) {
        const errors = validate(built, parse(query.source)).map((e) => e.message)
        if (errors.length > 0) validation[query.name] = errors
      }
      return {
        savedTo,
        typeCount: Object.keys(built.getTypeMap()).filter((n) => !n.startsWith('__')).length,
        queryFields: Object.keys(built.getQueryType()?.getFields() ?? {}).length,
        mutationFields: Object.keys(built.getMutationType()?.getFields() ?? {}).length,
        validation,
      }
    }),
  )

  // 3. Gépek (ADT-01, timeLeft / nextService)
  let aircraftList: Aircraft[] | undefined
  const aircraft = await needViewer(() =>
    runCheck('gépek', log, async () => {
      const list = await client.fetchAll(AircraftQuery, {}, (d) => d.aircraft, { pageSize: 25 })
      aircraftList = list
      const availability = await client.fetchAll(
        AircraftAvailabilitiesQuery,
        { from: iso(now), to: iso(windowTo) },
        (d) => d.aircraft,
        { pageSize: 10 },
      )
      const maintenance = list.map((a): AircraftMaintenanceRow => {
        const w = a.worstMaintenanceWarning
        const primaryLogHours = a.primaryLog ? a.primaryLog.totalSeconds / 3600 : null
        const next = a.nextService?.nextPrimaryService ?? null
        return {
          callSign: a.callSign,
          model: a.model,
          aircraftClass: a.aircraftClass,
          timeLeft: w?.timeLeft ?? null,
          daysLeft: w?.daysLeft ?? null,
          cyclesLeft: w?.cyclesLeft ?? null,
          warningStatus: w?.status ?? null,
          warningSubject: w?.subjectName ?? null,
          warningLogType: w?.logType ?? null,
          warningMeasurement: a.primaryLog?.measurementType ?? a.typeOfTimerMeasurement ?? null,
          warningTimerType: w?.typeOfTimer ?? null,
          nextPrimaryService: next,
          nextServiceDate: a.nextService?.nextServiceDate ?? null,
          primaryLogHours,
          primaryLogType: a.primaryLog?.type ?? null,
          primaryLogMeasurement: a.primaryLog?.measurementType ?? null,
          airborneHours: a.totalAirborneMinutes === null ? null : a.totalAirborneMinutes / 60,
          derivedHoursToService: next !== null && primaryLogHours !== null ? next - primaryLogHours : null,
        }
      })
      return {
        total: list.length,
        byClass: countBy(list, (a) => a.aircraftClass),
        byModel: countBy(list, (a) => a.model),
        disabled: list.filter((a) => a.disabled).length,
        homeAirports: countBy(list, (a) => a.homeAirport?.icaoCode),
        locationKinds: countBy(list, (a) => a.currentLocation?.kind),
        maintenance,
        availabilityEvents: availability.reduce((sum, a) => sum + (a.availabilities.nodes?.length ?? 0), 0),
        aircraftWithAvailability: availability.filter((a) => (a.availabilities.nodes?.length ?? 0) > 0).length,
        availabilityTruncated: availability.filter((a) => a.availabilities.pageInfo.hasNextPage).length,
      }
    }),
  )

  // 4. Foglalások: saját és minden (K02)
  let ownBookings: Booking[] = []
  let allBookings: Booking[] = []
  let ownStudentIds: string[] = []
  const bookings = await needViewer(() =>
    runCheck('foglalások (K02)', log, async () => {
      const base = { from: iso(windowFrom), to: iso(windowTo), overlap: true }
      ownBookings = await client.fetchAll(BookingsQuery, { ...base, all: false }, (d) => d.bookings)
      log(`    saját nézet: ${ownBookings.length} foglalás`)
      allBookings = await client.fetchAll(BookingsQuery, { ...base, all: true }, (d) => d.bookings)
      log(`    teljes nézet (all: true): ${allBookings.length} foglalás`)
      for (const b of [...ownBookings, ...allBookings]) if (b.comment) sensitive.add(b.comment)

      const own = new Set(
        allBookings.filter((b) => b.instructor?.id === viewerId).flatMap(bookingStudents),
      )
      ownStudentIds = [...own]
      const ofOwnStudents = allBookings.filter((b) => bookingStudents(b).some((id) => own.has(id)))
      const aircraftIds = aircraftList?.map((a) => a.id)
      return {
        windowFrom: iso(windowFrom),
        windowTo: iso(windowTo),
        own: bookingStats(ownBookings, viewerId, now, aircraftIds),
        all: bookingStats(allBookings, viewerId, now, aircraftIds),
        ownStudents: own.size,
        ownStudentsBookingsWithOtherInstructor: ofOwnStudents.filter((b) => b.instructor && b.instructor.id !== viewerId).length,
        ownStudentsBookingsWithoutInstructor: ofOwnStudents.filter((b) => 'instructor' in b && !b.instructor).length,
      }
    }),
  )

  // 5. Nem publikált foglalás
  const unpublished =
    bookings.status !== 'ok'
      ? skipped<UnpublishedData>('A foglalások lekérése nem sikerült.')
      : await runCheck('nem publikált foglalás', log, async () => {
          const probe = input.unpublishedProbe
          const match = (b: Booking): boolean => !!probe && Math.abs(Date.parse(b.startsAt) - probe.getTime()) <= 60_000
          const matchedAll = allBookings.filter(match)
          const recentLimit = now.getTime() - 2 * DAY_MS
          return {
            probe: probe ? probe.toISOString() : null,
            matchesOwn: ownBookings.filter(match).length,
            matchesAll: matchedAll.length,
            matches: matchedAll.map((b) => ({
              type: b.__typename,
              status: b.status,
              color: b.color,
              createdByOwn: !!viewerId && b.audit?.createdById === viewerId,
            })),
            createdByOwnLast48h: allBookings.filter(
              (b) => b.audit?.createdById === viewerId && Date.parse(b.audit?.createdAt ?? '') >= recentLimit,
            ).length,
          }
        })

  // 6. Felhasználók
  let studentIds: string[] = []
  const users = await needViewer(() =>
    runCheck('felhasználók', log, async () => {
      const byRole: Partial<Record<UserRole, number | string>> = {}
      let nameRatio: number | null = null
      for (const role of ['STUDENT', 'FLIGHT_INSTRUCTOR', 'INSTRUCTOR', 'GROUND_INSTRUCTOR'] as const) {
        try {
          const list = await client.fetchAll(UsersByRoleQuery, { roles: [role] }, (d) => d.users)
          for (const u of list) {
            // Teljes név és vezetéknév; a rövid hívójelek és keresztnevek túl gyakran
            // egyeznének a jelentés szakszavaival, és a jelentésbe amúgy sem kerülnek.
            if (u.lastName && u.lastName.length >= 4) sensitive.add(u.lastName)
            if (u.firstName && u.lastName) sensitive.add(`${u.firstName} ${u.lastName}`)
          }
          byRole[role] = list.length
          if (role === 'STUDENT') {
            studentIds = list.map((u) => u.id)
            nameRatio = ratio(list, (u) => !!(u.firstName || u.lastName))
          }
        } catch (error) {
          byRole[role] = `hiba: ${errorText(error)}`
        }
      }
      const students = new Set(studentIds)
      return {
        byRole,
        studentNameVisibleRatio: nameRatio,
        ownStudentsFoundInStudentList: ownStudentIds.length === 0 ? null : ratio(ownStudentIds, (id) => students.has(id)),
      }
    }),
  )

  // 7. Ráérések (SZB-03): a funkció aktív-e
  const availabilityDays = 28
  const availability = await needViewer(() =>
    runCheck('ráérések', log, async () => {
      const from = iso(now)
      const to = iso(new Date(now.getTime() + availabilityDays * DAY_MS))
      let own: AvailabilityData['own']
      try {
        const events = await client.fetchAll(UserAvailabilitiesQuery, { id: viewerId!, from, to }, (d) => d.user?.availabilities)
        own = { events: events.length, unavailable: events.filter((e) => e.unavailable).length }
      } catch (error) {
        own = { error: errorText(error) }
      }
      const sample = (ownStudentIds.length > 0 ? ownStudentIds : studentIds).slice(0, STUDENT_SAMPLE)
      let withAny = 0
      let total = 0
      let errors = 0
      for (const id of sample) {
        try {
          const events = await client.fetchAll(UserAvailabilitiesQuery, { id, from, to }, (d) => d.user?.availabilities)
          total += events.length
          if (events.length > 0) withAny++
        } catch {
          errors++
        }
      }
      return { windowDays: availabilityDays, own, studentsSampled: sample.length, studentsWithAny: withAny, studentEvents: total, studentErrors: errors }
    }),
  )

  // 8. Termek és osztályok (ADT-03)
  const classrooms = await needViewer(() =>
    runCheck('termek és osztályok', log, async () => {
      const active = await client.fetchAll(ClassroomsQuery, {}, (d) => d.classrooms)
      const all = await client.fetchAll(ClassroomsQuery, { includeDisabled: true }, (d) => d.classrooms)
      let classes: number | string
      let classSizes: Distribution | null = null
      try {
        const list = await client.fetchAll(ClassesQuery, {}, (d) => d.classes)
        classes = list.length
        classSizes = distribution(list.map((c) => c.users.length))
      } catch (error) {
        classes = `hiba: ${errorText(error)}`
      }
      return {
        active: active.length,
        includingDisabled: all.length,
        locationKinds: countBy(active, (c) => c.currentLocation?.kind),
        classes,
        classSizes,
      }
    }),
  )

  // 9. Programok és feladatok (ADT-04)
  const programs = await needViewer(() =>
    runCheck('programok', log, async () => {
      const list = await client.fetchAll(ProgramsQuery, {}, (d) => d.programs)
      const revisions = list.flatMap((p) => (p.programRevisions.nodes ?? []).filter((r) => r !== null))
      const phases = revisions.flatMap((r) => (r.programPhases ?? []).filter((p) => p !== null))
      const lectures = phases.flatMap((p) => (p.lectures ?? []).filter((l) => l !== null))
      const flight = lectureFlightMinutes
      return {
        programs: list.length,
        byType: countBy(list, (p) => p.programType),
        revisions: revisions.length,
        phases: phases.length,
        lectures: lectures.length,
        lectureCategories: countBy(lectures, (l) => l.lessonCategory),
        briefingMinutes: distribution(lectures.map((l) => l.briefingMinutes)),
        debriefingMinutes: distribution(lectures.map((l) => l.debriefingMinutes)),
        flightMinutes: distribution(lectures.map(flight)),
        lecturesWithoutDurations: lectures.filter((l) => l.briefingMinutes + l.debriefingMinutes + flight(l) === 0).length,
      }
    }),
  )

  // 10. Haladás: userPrograms, trainings (ADT-04, TRV-19, NOV-08)
  const progress =
    viewer.status !== 'ok'
      ? skipped<ProgressData>('A kulcs ellenőrzése nem sikerült.')
      : ownStudentIds.length === 0
        ? skipped<ProgressData>('A vizsgált ablakban nincs saját növendék, akinek a haladását le lehetne kérni.')
        : await runCheck('haladás', log, async () => {
            let userPrograms: number | string
            let userProgramStatus: Counts = {}
            try {
              const list = await client.fetchAll(UserProgramsQuery, { userIds: ownStudentIds, all: true }, (d) => d.userPrograms)
              userPrograms = list.length
              userProgramStatus = countBy(list, (p) => p.status)
            } catch (error) {
              userPrograms = `hiba: ${errorText(error)}`
            }
            const from = iso(new Date(now.getTime() - 120 * DAY_MS))
            let trainings: number | string
            let trainingStatus: Counts = {}
            let failedPerformance = 0
            let withFlightsRatio: number | null = null
            let withBookingRatio: number | null = null
            let daysSince: number[] = []
            const lectures = new Map<string, NonNullable<Training['lecture']>>()
            try {
              const list = await client.fetchAll(TrainingsQuery, { userIds: ownStudentIds, from, to: iso(now), all: true }, (d) => d.trainings)
              trainings = list.length
              trainingStatus = countBy(list, (t) => t.status)
              failedPerformance = list.filter((t) => t.failedPerformance === true).length
              withFlightsRatio = ratio(list, (t) => t.flights.some((f) => f !== null))
              withBookingRatio = ratio(list, (t) => t.booking !== null)
              for (const t of list) if (t.lecture) lectures.set(t.lecture.id, t.lecture)
              const lastByStudent = new Map<string, number>()
              for (const t of list) {
                const sid = t.student?.id
                if (!sid) continue
                for (const f of t.flights) {
                  const on = f ? Date.parse(f.onBlock) : Number.NaN
                  if (!Number.isNaN(on) && on > (lastByStudent.get(sid) ?? 0)) lastByStudent.set(sid, on)
                }
              }
              daysSince = [...lastByStudent.values()].map((t) => (now.getTime() - t) / DAY_MS)
            } catch (error) {
              trainings = `hiba: ${errorText(error)}`
            }
            let trainingVisibility: TrainingVisibility | string
            try {
              trainingVisibility = await compareTrainingVisibility(client, ownStudentIds, viewerId, from, iso(now))
            } catch (error) {
              trainingVisibility = `hiba: ${errorText(error)}`
            }
            return {
              studentsQueried: ownStudentIds.length,
              userPrograms,
              userProgramStatus,
              trainings,
              trainingStatus,
              failedPerformance,
              withFlightsRatio,
              withBookingRatio,
              daysSinceLastFlight: distribution(daysSince),
              lecturesViaTrainings: lectures.size,
              lecturesWithPhaseRatio: ratio([...lectures.values()], (l) => l.programPhase !== null),
              lectureBriefingMinutes: distribution([...lectures.values()].map((l) => l.briefingMinutes)),
              lectureFlightMinutes: distribution([...lectures.values()].map(lectureFlightMinutes)),
              lectureDebriefingMinutes: distribution([...lectures.values()].map((l) => l.debriefingMinutes)),
              trainingVisibility,
            }
          })

  // 11. Repülések (block time)
  const flightDays = 28
  const flights = await needViewer(() =>
    runCheck('repülések', log, async () => {
      const vars = { from: iso(new Date(now.getTime() - flightDays * DAY_MS)), to: iso(now) }
      const own = await client.fetchAll(FlightsQuery, { ...vars, all: false }, (d) => d.flights)
      const all = await client.fetchAll(FlightsQuery, { ...vars, all: true }, (d) => d.flights)
      return {
        windowDays: flightDays,
        own: own.length,
        all: all.length,
        distinctAircraftAll: new Set(all.map((f) => f.aircraft?.id).filter(Boolean)).size,
        flightTypes: countBy(all, (f) => f.flightType),
      }
    }),
  )

  // 12. Oktatói logbook (ADT-05, LIM-01)
  const logbook = await needViewer(() =>
    runCheck('logbook', log, async () => {
      const from365 = iso(new Date(now.getTime() - 365 * DAY_MS))
      const hours = (s: number | null | undefined): number => (s ?? 0) / 3600
      let entries
      try {
        entries = await client.fetchAll(LogbookEntriesQuery, { from: from365, to: iso(now) }, (d) => d.myFlightLogger?.logbookEntries)
      } catch (error) {
        // Iskolai (account-specific) kulccsal a myFlightLogger nem kérdezhető. Tartalék: a saját
        // repülések block time-ja ebben a fiókban (a más munkahelyen repült idő így nem látszik).
        const flightsOwn = await client.fetchAll(FlightsQuery, { from: from365, to: iso(now), all: false }, (d) => d.flights)
        const blockHours = (from: number): number =>
          flightsOwn
            .filter((f) => Date.parse(f.offBlock) >= from)
            .reduce((s, f) => s + Math.max(0, (minutesBetween(f.offBlock, f.onBlock) ?? 0) / 60), 0)
        const yearStart = Date.UTC(now.getUTCFullYear(), 0, 1)
        return {
          source: 'flights' as const,
          myFlightLoggerError: errorText(error),
          entries365: flightsOwn.length,
          hours365FromEntries: blockHours(0),
          instructorHours365FromEntries: Number.NaN,
          syntheticHours365FromEntries: Number.NaN,
          includeInFtl: {},
          summation365Hours: null,
          summation28Hours: blockHours(now.getTime() - 28 * DAY_MS),
          summationYearHours: blockHours(yearStart),
        }
      }
      const summation = async (from: string): Promise<number | null> => {
        const data = await client.query(LogbookSummationQuery, { from, to: iso(now) })
        const total = data.myFlightLogger?.logbookSummations?.totalSeconds
        return total === null || total === undefined ? null : total / 3600
      }
      const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString()
      return {
        source: 'myFlightLogger' as const,
        entries365: entries.length,
        hours365FromEntries: entries.reduce((s, e) => s + hours(e.totalSeconds), 0),
        instructorHours365FromEntries: entries.reduce((s, e) => s + hours(e.flightInstructorSeconds), 0),
        syntheticHours365FromEntries: entries.reduce((s, e) => s + hours(e.syntheticTrainingSeconds), 0),
        includeInFtl: countBy(entries, (e) => (e.includeInFtl === null ? null : String(e.includeInFtl))),
        summation365Hours: await summation(from365),
        summation28Hours: await summation(iso(new Date(now.getTime() - 28 * DAY_MS))),
        summationYearHours: await summation(yearStart),
      }
    }),
  )

  // 13. Open-Meteo (ADT-07): ICON-D2 lefedettség és látástávolság
  const airport = input.airport
  const weather = !airport
    ? skipped<readonly WeatherModelData[]>('Nem adtál meg koordinátát.')
    : await runCheck('időjárás (Open-Meteo)', log, async () => {
        const results: WeatherModelData[] = []
        for (const model of WEATHER_MODELS) {
          try {
            const response = await input.fetchForecast({
              latitude: airport.latitude,
              longitude: airport.longitude,
              forecastDays: 7,
              ...(model === 'best_match' ? {} : { model }),
            })
            results.push(summarizeForecast(model, response, now))
          } catch (error) {
            results.push({ model, status: 'hiba', error: errorText(error) })
          }
        }
        return results
      })

  log('Felderítés kész.')
  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    settings: {
      pastDays: input.pastDays,
      futureDays: input.futureDays,
      weather: !!airport,
      unpublishedProbe: !!input.unpublishedProbe,
    },
    viewer,
    schema,
    aircraft,
    bookings,
    unpublished,
    users,
    availability,
    classrooms,
    programs,
    progress,
    flights,
    logbook,
    weather,
  }
}
