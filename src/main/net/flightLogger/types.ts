/**
 * A rögzített lekérdezések válaszainak típusai. Csak a lekérdezett mezőket írják le,
 * a nevek a FlightLogger GraphQL-sémáját követik (docs/schema.graphql, a felderítés után).
 */

export interface PageInfo {
  readonly hasNextPage: boolean
  readonly endCursor: string | null
}

export interface Connection<T> {
  readonly pageInfo: PageInfo
  readonly nodes: ReadonlyArray<T | null> | null
}

export interface IdRef {
  readonly id: string
}

export interface Audit {
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly createdById?: string | null
  readonly updatedById?: string | null
}

export type AircraftClass = 'MULTI_ENGINE' | 'SIMULATOR' | 'SINGLE_ENGINE'
export type BookingStatus = 'CANCELLED' | 'COMPLETED' | 'OPEN' | 'PARTIALLY_COMPLETED'
export type BookingSubtype =
  | 'CLASS_THEORY'
  | 'EXAM'
  | 'EXTRA_THEORY'
  | 'MAINTENANCE'
  | 'MEETING'
  | 'MULTI_STUDENT'
  | 'OPERATION'
  | 'PROGRESS_TEST'
  | 'RENTAL'
  | 'SINGLE_STUDENT'
  | 'THEORY_RELEASE'
  | 'TYPE_QUESTIONNAIRE'
export type UserRole =
  | 'ADMINISTRATOR'
  | 'CREW'
  | 'FLIGHT_INSTRUCTOR'
  | 'GROUND_INSTRUCTOR'
  | 'GUEST'
  | 'INSTRUCTOR'
  | 'RENTER'
  | 'STAFF'
  | 'STUDENT'
export type TrainingStatus = 'CREDITED' | 'FAILED' | 'NOT_FLOWN' | 'PARTIALLY_COMPLETED' | 'PASSED'
export type UserProgramStatus = 'ACTIVE' | 'COMPLETED' | 'DISCONTINUED' | 'STANDBY'

export interface Viewer {
  readonly id: string
  readonly bookingTimeZone: string | null
  readonly flightTimeZone: string | null
  readonly theoryTimeZone: string | null
}

export interface AirportRef {
  readonly icaoCode: string | null
}

export interface CurrentLocation {
  readonly kind: 'AIRPORT' | 'ALL_LOCATIONS'
  readonly airport: AirportRef | null
}

export interface ServiceSummary {
  readonly nextPrimaryService: number | null
  readonly nextSecondaryService: number | null
  readonly nextTertiaryService: number | null
  readonly nextServiceDate: string | null
  readonly nextServiceCycles: number | null
  readonly primaryWarningColor: string | null
  readonly dateWarningColor: string | null
}

export interface MaintenanceWarning {
  readonly timeLeft: number | null
  readonly daysLeft: number | null
  readonly cyclesLeft: number | null
  readonly expiryTime: number | null
  readonly expiryDate: string | null
  readonly status: string
  readonly subjectName: string
  readonly logType: string | null
  readonly typeOfTimer: string | null
  readonly color: string | null
  readonly blockable: boolean
}

export interface FlightLogConfiguration {
  readonly type: string
  readonly measurementType: string
  readonly totalSeconds: number
}

export interface Aircraft {
  readonly id: string
  readonly callSign: string
  readonly model: string
  readonly aircraftClass: AircraftClass
  readonly aircraftType: string
  readonly disabled: boolean
  readonly homeAirport: AirportRef | null
  readonly currentLocation: CurrentLocation | null
  readonly totalAirborneMinutes: number | null
  readonly timerSeconds: number | null
  readonly typeOfTimer: string | null
  readonly typeOfTimerMeasurement: string | null
  readonly primaryLog: FlightLogConfiguration | null
  readonly nextService: ServiceSummary | null
  readonly worstMaintenanceWarning: MaintenanceWarning | null
  readonly audit: Audit | null
}

export interface AircraftAvailabilities {
  readonly id: string
  readonly availabilities: Connection<{ readonly startsAt: string; readonly endsAt: string }>
}

/** A BookingUnion tagjainak közös, lapos nézete. A nem releváns mezők hiányoznak. */
export interface Booking {
  readonly __typename: string
  readonly id: string
  readonly startsAt: string
  readonly endsAt: string
  readonly status: BookingStatus
  /** Csak karbantartási foglalásnál kérjük le (a fajtája miatt). */
  readonly comment?: string | null
  readonly color: string | null
  readonly audit?: Audit | null
  readonly flightStartsAt?: string
  readonly flightEndsAt?: string
  readonly aircraft?: (IdRef & { readonly callSign: string }) | null
  readonly classroom?: IdRef | null
  readonly instructor?: IdRef | null
  readonly student?: IdRef | null
  readonly students?: ReadonlyArray<IdRef | null>
  readonly class?: IdRef | null
  readonly pic?: IdRef | null
  readonly crew?: ReadonlyArray<IdRef | null>
  readonly renter?: IdRef | null
  readonly participants?: ReadonlyArray<IdRef | null>
  /** Megfigyelők az egy- és a többnövendékes repülési foglaláson. */
  readonly observers?: ReadonlyArray<IdRef | null>
  readonly plannedLesson?: PlannedLesson | null
  /** A többnövendékes foglalás tervezett feladatai, növendékenként egy (KBR-10). */
  readonly plannedLessons?: ReadonlyArray<(PlannedLesson & { readonly student: IdRef | null }) | null> | null
  readonly approved?: boolean
}

/** A foglalásra tervezett feladat (`Training`) a lekérdezett mezőkkel. */
export interface PlannedLesson {
  readonly id: string
  readonly lecture: (IdRef & Partial<Lecture>) | null
  readonly userProgram?: UserProgramRef | null
}

export interface User {
  readonly id: string
  readonly callSign: string
  readonly firstName: string | null
  readonly lastName: string | null
  readonly currentLocation: CurrentLocation | null
  readonly audit: Audit | null
}

export interface UserAvailability {
  readonly startsAt: string
  readonly endsAt: string
  readonly unavailable: boolean
}

export interface Classroom {
  readonly id: string
  readonly name: string
  readonly currentLocation: CurrentLocation | null
}

export interface SchoolClass {
  readonly id: string
  readonly name: string
  readonly users: ReadonlyArray<IdRef | null>
}

export interface Lecture {
  readonly id: string
  readonly name: string
  readonly lessonCategory: string
  readonly briefingMinutes: number
  readonly debriefingMinutes: number
  readonly vfrDualMinutes: number
  readonly vfrSoloMinutes: number
  readonly vfrSimMinutes: number
  readonly vfrSpicMinutes: number
  readonly ifrDualMinutes: number
  readonly ifrSimMinutes: number
  readonly ifrSpicMinutes: number
  readonly nightMinutes: number
}

export interface Program {
  readonly id: string
  readonly name: string
  readonly programType: string | null
  readonly aircraftType: string | null
  readonly programRevisions: Connection<{
    readonly id: string
    readonly name: string
    readonly programPhases: ReadonlyArray<{
      readonly id: string
      readonly name: string
      readonly lectures: ReadonlyArray<Lecture | null> | null
    } | null> | null
  }>
}

export interface UserProgram {
  readonly id: string
  readonly name: string
  readonly status: string
  readonly assignmentDate: string
  readonly user: IdRef | null
  readonly program: IdRef | null
  readonly programRevision: IdRef | null
}

/** A feladathoz tartozó program és revízió (a revízió szerkezete az iskolai kulccsal nem olvasható). */
export interface UserProgramRef {
  readonly id: string
  readonly name?: string | null
  readonly programRevision?: { readonly id: string; readonly name: string } | null
}

export interface Training {
  readonly id: string
  readonly name: string
  readonly status: TrainingStatus
  readonly failedPerformance: boolean | null
  readonly totalSeconds: number
  readonly briefingSeconds: number
  readonly debriefingSeconds: number
  readonly student: IdRef | null
  readonly instructor: IdRef | null
  readonly lecture: (Lecture & { readonly programPhase: { readonly id: string; readonly name: string } | null }) | null
  readonly userProgram: UserProgramRef | null
  readonly booking: { readonly __typename: string; readonly id?: string } | null
  readonly flights: ReadonlyArray<{ readonly id: string; readonly offBlock: string; readonly onBlock: string } | null>
  readonly audit: Audit | null
}

export interface Flight {
  readonly id: string
  readonly offBlock: string
  readonly onBlock: string
  readonly flightType: string | null
  readonly ftSeconds: number
  readonly aircraft: IdRef | null
}

export interface LogbookEntry {
  readonly id: string
  readonly offBlock: string
  readonly onBlock: string
  readonly totalSeconds: number | null
  readonly flightInstructorSeconds: number | null
  readonly syntheticTrainingSeconds: number | null
  readonly instructorSyntheticTrainingSeconds: number | null
  readonly includeInFtl: boolean | null
}

export interface LogbookSummation {
  readonly totalSeconds: number | null
  readonly flightInstructorSeconds: number | null
  readonly syntheticTrainingSeconds: number | null
  readonly instructorSyntheticTrainingSeconds: number | null
}
