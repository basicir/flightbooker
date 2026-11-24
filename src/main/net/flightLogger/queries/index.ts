import { AircraftAvailabilitiesQuery, AircraftQuery } from './aircraft'
import { BookingsQuery } from './bookings'
import { ClassesQuery, ClassroomsQuery } from './classrooms'
import { FlightsQuery, LogbookEntriesQuery, LogbookSummationQuery } from './flights'
import { IntrospectionQuery } from './introspection'
import { ProgramsQuery, TrainingLecturesQuery, TrainingsQuery, UserProgramsQuery } from './programs'
import { SubjectCategoriesQuery, TheoryProgramsQuery } from './theory'
import { UserAvailabilitiesQuery, UsersByRoleQuery } from './users'
import { ViewerQuery } from './viewer'

export {
  AircraftAvailabilitiesQuery,
  AircraftQuery,
  BookingsQuery,
  ClassesQuery,
  ClassroomsQuery,
  FlightsQuery,
  IntrospectionQuery,
  LogbookEntriesQuery,
  LogbookSummationQuery,
  ProgramsQuery,
  SubjectCategoriesQuery,
  TheoryProgramsQuery,
  TrainingLecturesQuery,
  TrainingsQuery,
  UserAvailabilitiesQuery,
  UserProgramsQuery,
  UsersByRoleQuery,
  ViewerQuery,
}

/** Minden rögzített lekérdezés; a tesztek és a felderítés sémavalidációja ezen fut végig. */
export const ALL_QUERIES = [
  ViewerQuery,
  AircraftQuery,
  AircraftAvailabilitiesQuery,
  BookingsQuery,
  UsersByRoleQuery,
  UserAvailabilitiesQuery,
  ClassroomsQuery,
  ClassesQuery,
  ProgramsQuery,
  TheoryProgramsQuery,
  SubjectCategoriesQuery,
  UserProgramsQuery,
  TrainingsQuery,
  TrainingLecturesQuery,
  FlightsQuery,
  LogbookEntriesQuery,
  LogbookSummationQuery,
  IntrospectionQuery,
] as const
