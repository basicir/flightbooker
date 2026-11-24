import { buildSchema, introspectionFromSchema } from 'graphql'

/**
 * Szintetikus FlightLogger-válaszok a felderítés teszteléséhez. Minden név, komment
 * és azonosító kitalált; valódi adat nem szerepel a repóban (CLAUDE.md 4. pont).
 * A kérés műveletneve alapján válaszol, mint egy nagyon egyszerű szerver.
 */

export const SYNTHETIC = {
  apiKey: 'szintetikus-kulcs-1234',
  viewerId: 'u-oktato-szint',
  otherInstructorId: 'u-masik-szint',
  students: [
    { id: 'u-novendek-1', firstName: 'Kitalált', lastName: 'Kornélia', callSign: 'KKO' },
    { id: 'u-novendek-2', firstName: 'Próba', lastName: 'Pálma', callSign: 'PPA' },
  ],
  instructors: [
    { id: 'u-oktato-szint', firstName: 'Szintetikus', lastName: 'Szilárd', callSign: 'SZSZ' },
    { id: 'u-masik-szint', firstName: 'Minta', lastName: 'Marcell', callSign: 'MIM' },
  ],
  secretComment: 'STANDBY – Kitalált Kornélia helyett, hívd: proba@example.com',
  unpublishedStart: '2026-11-12T08:00:00.000Z',
} as const

const conn = <T>(nodes: T[]) => ({ pageInfo: { hasNextPage: false, endCursor: null }, nodes })

const NOW = Date.parse('2026-11-10T12:00:00Z')
const at = (hoursFromNow: number): string => new Date(NOW + hoursFromNow * 3600_000).toISOString()

function aircraft() {
  const make = (id: string, callSign: string, cls: string, primaryHours: number, next: number) => ({
    id,
    callSign,
    model: cls === 'SIMULATOR' ? 'SIM-1' : 'PA-28',
    aircraftClass: cls,
    aircraftType: 'AIRPLANE',
    disabled: false,
    homeAirport: { icaoCode: 'XXXX' },
    currentLocation: { kind: 'AIRPORT', airport: { icaoCode: 'XXXX' } },
    totalAirborneMinutes: primaryHours * 60,
    timerSeconds: null,
    typeOfTimer: null,
    typeOfTimerMeasurement: null,
    primaryLog: { type: 'AIRBORNE', measurementType: 'DECIMAL_HOURS', totalSeconds: primaryHours * 3600 },
    nextService: {
      nextPrimaryService: next,
      nextSecondaryService: null,
      nextTertiaryService: null,
      nextServiceDate: null,
      nextServiceCycles: null,
      primaryWarningColor: null,
      dateWarningColor: null,
    },
    worstMaintenanceWarning: {
      timeLeft: cls === 'SIMULATOR' ? null : next - primaryHours,
      daysLeft: 40,
      cyclesLeft: null,
      expiryTime: null,
      expiryDate: null,
      status: 'OK',
      subjectName: '50 órás átvizsgálás',
      logType: 'primary',
      typeOfTimer: 'AIRBORNE',
      color: null,
      blockable: false,
    },
    audit: { updatedAt: at(-1), createdAt: at(-1000) },
  })
  return [make('a1', 'HA-SZA', 'SINGLE_ENGINE', 1000, 1012.5), make('a2', 'HA-SZB', 'SINGLE_ENGINE', 500, 503), make('s1', 'SIM-A', 'SIMULATOR', 10, 0)]
}

function booking(id: string, instructorId: string | null, studentId: string, aircraftId: string, startHours: number, extra: Record<string, unknown> = {}) {
  return {
    __typename: 'SingleStudentBooking',
    id,
    startsAt: at(startHours),
    endsAt: at(startHours + 2),
    status: 'OPEN',
    comment: null,
    color: null,
    audit: { createdAt: at(-10), updatedAt: at(-10), createdById: instructorId, updatedById: instructorId },
    flightStartsAt: at(startHours + 0.5),
    flightEndsAt: at(startHours + 1.5),
    aircraft: { id: aircraftId, callSign: aircraftId === 'a1' ? 'HA-SZA' : 'HA-SZB' },
    instructor: instructorId ? { id: instructorId } : null,
    student: { id: studentId },
    plannedLesson: null,
    ...extra,
  }
}

const ownBookings = [
  booking('b1', SYNTHETIC.viewerId, 'u-novendek-1', 'a1', 20, { comment: SYNTHETIC.secretComment }),
  booking('b2', SYNTHETIC.viewerId, 'u-novendek-2', 'a2', -30),
  booking('b-unpub', SYNTHETIC.viewerId, 'u-novendek-2', 'a2', (Date.parse(SYNTHETIC.unpublishedStart) - NOW) / 3600_000, {
    color: '#cccccc',
  }),
]
const otherBookings = [
  booking('b3', SYNTHETIC.otherInstructorId, 'u-novendek-1', 'a2', 46),
  booking('b4', null, 'u-novendek-x', 'a1', 50),
]

const SCHEMA = buildSchema('type Query { a: String } type Mutation { b: String }')

export function syntheticNow(): Date {
  return new Date(NOW)
}

export function respond(operationName: string, variables: Record<string, unknown>): unknown {
  switch (operationName) {
    case 'Viewer':
      return { user: { id: SYNTHETIC.viewerId, bookingTimeZone: 'Europe/Budapest', flightTimeZone: 'UTC', theoryTimeZone: null } }
    case 'IntrospectionQuery':
      return introspectionFromSchema(SCHEMA)
    case 'Aircraft':
      return { aircraft: conn(aircraft()) }
    case 'AircraftAvailabilities':
      return { aircraft: conn(aircraft().map((a) => ({ id: a.id, availabilities: conn([{ startsAt: at(1), endsAt: at(20) }]) }))) }
    case 'Bookings':
      return { bookings: conn(variables['all'] ? [...ownBookings, ...otherBookings] : ownBookings) }
    case 'UsersByRole': {
      const roles = variables['roles'] as string[]
      const list = roles[0] === 'STUDENT' ? SYNTHETIC.students : roles[0] === 'FLIGHT_INSTRUCTOR' ? SYNTHETIC.instructors : []
      return { users: conn(list.map((u) => ({ ...u, currentLocation: null, audit: null }))) }
    }
    case 'UserAvailabilities':
      return {
        user: {
          id: variables['id'],
          availabilities: conn(variables['id'] === SYNTHETIC.viewerId ? [{ startsAt: at(1), endsAt: at(9), unavailable: false }] : []),
        },
      }
    case 'Classrooms':
      return { classrooms: conn([{ id: 'c1', name: 'Kitalált terem', currentLocation: { kind: 'AIRPORT', airport: null } }]) }
    case 'Classes':
      return { classes: conn([{ id: 'k1', name: 'Kitalált osztály', users: [{ id: 'u-novendek-1' }, { id: 'u-novendek-2' }] }]) }
    case 'Programs':
      return {
        programs: conn([
          {
            id: 'p1',
            name: 'Szintetikus PPL',
            programType: 'FLIGHT_TRAINING',
            aircraftType: 'AIRPLANE',
            programRevisions: conn([
              {
                id: 'r1',
                name: 'v1',
                programPhases: [
                  {
                    id: 'ph1',
                    name: 'Alapok',
                    lectures: [
                      {
                        id: 'l1',
                        name: 'Első óra',
                        lessonCategory: 'FLIGHT_LESSON',
                        briefingMinutes: 30,
                        debriefingMinutes: 15,
                        vfrDualMinutes: 60,
                        vfrSoloMinutes: 0,
                        vfrSimMinutes: 0,
                        vfrSpicMinutes: 0,
                        ifrDualMinutes: 0,
                        ifrSimMinutes: 0,
                        ifrSpicMinutes: 0,
                        nightMinutes: 0,
                      },
                    ],
                  },
                ],
              },
            ]),
          },
        ]),
      }
    case 'UserPrograms':
      return { userPrograms: conn([{ id: 'up1', name: 'Szintetikus PPL', status: 'ACTIVE', assignmentDate: at(-2000), user: { id: 'u-novendek-1' }, program: { id: 'p1' }, programRevision: { id: 'r1' } }]) }
    case 'Trainings':
    case 'TrainingLectures':
      return {
        trainings: conn([
          {
            id: 't1',
            name: 'Első óra',
            status: 'PASSED',
            failedPerformance: null,
            totalSeconds: 3600,
            briefingSeconds: 1800,
            debriefingSeconds: 900,
            student: { id: 'u-novendek-1' },
            instructor: { id: SYNTHETIC.viewerId },
            lecture: {
              id: 'l1',
              name: 'Első óra',
              lessonCategory: 'FLIGHT_LESSON',
              briefingMinutes: 30,
              debriefingMinutes: 15,
              vfrDualMinutes: 60,
              vfrSoloMinutes: 0,
              vfrSimMinutes: 0,
              vfrSpicMinutes: 0,
              ifrDualMinutes: 0,
              ifrSimMinutes: 0,
              ifrSpicMinutes: 0,
              nightMinutes: 0,
              programPhase: { id: 'ph1', name: 'Alapok' },
            },
            userProgram: { id: 'up1' },
            booking: { __typename: 'SingleStudentBooking', id: 'b0' },
            flights: [{ id: 'f1', offBlock: at(-24 * 5 - 1), onBlock: at(-24 * 5) }],
            audit: null,
          },
        ]),
      }
    case 'Flights':
      return { flights: conn([{ id: 'f1', offBlock: at(-121), onBlock: at(-120), flightType: 'DUAL', ftSeconds: 3600, aircraft: { id: 'a1' } }]) }
    case 'LogbookEntries':
      return {
        myFlightLogger: {
          logbookEntries: conn([
            { id: 'e1', offBlock: at(-121), onBlock: at(-120), totalSeconds: 3600, flightInstructorSeconds: 3600, syntheticTrainingSeconds: 0, instructorSyntheticTrainingSeconds: 0, includeInFtl: true },
          ]),
        },
      }
    case 'LogbookSummation':
      return { myFlightLogger: { logbookSummations: { totalSeconds: 3600, flightInstructorSeconds: 3600, syntheticTrainingSeconds: 0, instructorSyntheticTrainingSeconds: 0 } } }
    default:
      throw new Error(`Ismeretlen művelet a szintetikus szerverben: ${operationName}`)
  }
}

export function syntheticForecast(model: string | undefined) {
  const hours = 168
  const coverage = model === 'icon_d2' ? 48 : model === 'icon_eu' ? 120 : hours
  const series = (present: number) => Array.from({ length: hours }, (_, i) => (i < present ? 5 : null))
  const time = Array.from({ length: hours }, (_, i) => new Date(Date.UTC(2026, 10, 10, i)).toISOString().slice(0, 16))
  return {
    latitude: 1,
    longitude: 2,
    elevation: 100,
    timezone: 'GMT',
    utc_offset_seconds: 0,
    hourly_units: { wind_speed_10m: 'kn', visibility: 'm' },
    hourly: { time, wind_speed_10m: series(coverage), visibility: series(model === undefined ? hours : coverage) },
    daily: { time: ['2026-11-10'], sunrise: ['2026-11-10T06:40'], sunset: ['2026-11-10T16:20'] },
  }
}
