import { defineQuery } from '../defineQuery'
import type { Connection, Program, Training, TrainingStatus, UserProgram, UserProgramStatus } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/** ADT-04: programok fázisokkal és feladatokkal (a Lecture adja a tervezett perceket). */
export const ProgramsQuery = defineQuery<{ programs: Connection<Program> }, PageVariables>(
  'Programs',
  /* GraphQL */ `
    query Programs($first: Int, $after: String) {
      programs(first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          name
          programType
          aircraftType
          programRevisions(first: 3) {
            ${PAGE_INFO}
            nodes {
              id
              name
              programPhases {
                id
                name
                lectures {
                  id
                  name
                  lessonCategory
                  briefingMinutes
                  debriefingMinutes
                  vfrDualMinutes
                  vfrSoloMinutes
                  vfrSimMinutes
                  vfrSpicMinutes
                  ifrDualMinutes
                  ifrSimMinutes
                  ifrSpicMinutes
                  nightMinutes
                }
              }
            }
          }
        }
      }
    }
  `,
)

/** ADT-04: a növendékek programhoz rendelése. */
export const UserProgramsQuery = defineQuery<
  { userPrograms: Connection<UserProgram> | null },
  PageVariables & { userIds?: string[]; status?: UserProgramStatus[]; all?: boolean; changedAfter?: string }
>(
  'UserPrograms',
  /* GraphQL */ `
    query UserPrograms(
      $userIds: [Id!]
      $status: [UserProgramEnum!]
      $all: Boolean
      $changedAfter: DateTime
      $first: Int
      $after: String
    ) {
      userPrograms(userIds: $userIds, status: $status, all: $all, changedAfter: $changedAfter, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          name
          status
          assignmentDate
          user { id }
          program { id }
          programRevision { id }
        }
      }
    }
  `,
)

/** ADT-04, TRV-19: elkönyvelt feladatok (Training) és a hozzájuk tartozó repülések. */
export const TrainingsQuery = defineQuery<
  { trainings: Connection<Training> },
  PageVariables & {
    userIds?: string[]
    from?: string
    to?: string
    all?: boolean
    status?: TrainingStatus[]
    changedAfter?: string
  }
>(
  'Trainings',
  /* GraphQL */ `
    query Trainings(
      $userIds: [Id!]
      $from: DateTime
      $to: DateTime
      $all: Boolean
      $status: [TrainingStatusEnum!]
      $changedAfter: DateTime
      $first: Int
      $after: String
    ) {
      trainings(
        userIds: $userIds
        from: $from
        to: $to
        all: $all
        status: $status
        changedAfter: $changedAfter
        first: $first
        after: $after
      ) {
        ${PAGE_INFO}
        nodes {
          id
          name
          status
          failedPerformance
          totalSeconds
          briefingSeconds
          debriefingSeconds
          student { id }
          instructor { id }
          lecture {
            id
            name
            lessonCategory
            briefingMinutes
            debriefingMinutes
            vfrDualMinutes
            vfrSoloMinutes
            vfrSimMinutes
            vfrSpicMinutes
            ifrDualMinutes
            ifrSimMinutes
            ifrSpicMinutes
            nightMinutes
            programPhase { id name }
          }
          userProgram { id name programRevision { id name } }
          booking {
            __typename
            ... on SingleStudentBooking { id }
            ... on MultiStudentBooking { id }
          }
          flights { id offBlock onBlock }
          audit { createdAt updatedAt }
        }
      }
    }
  `,
)

/**
 * SZB-02: csak a feladatkatalógushoz kellő mezők (feladat és programrevízió). Az iskola
 * összes elkönyvelt feladatán végiglapoz, ezért a teljes `Trainings`-nél jóval kisebb választ ad.
 */
export const TrainingLecturesQuery = defineQuery<
  { trainings: Connection<Pick<Training, 'id' | 'lecture' | 'userProgram'>> },
  PageVariables & { from?: string; to?: string; all?: boolean; changedAfter?: string }
>(
  'TrainingLectures',
  /* GraphQL */ `
    query TrainingLectures($from: DateTime, $to: DateTime, $all: Boolean, $changedAfter: DateTime, $first: Int, $after: String) {
      trainings(from: $from, to: $to, all: $all, changedAfter: $changedAfter, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          lecture {
            id
            name
            lessonCategory
            briefingMinutes
            debriefingMinutes
            vfrDualMinutes
            vfrSoloMinutes
            vfrSimMinutes
            vfrSpicMinutes
            ifrDualMinutes
            ifrSimMinutes
            ifrSpicMinutes
            nightMinutes
            programPhase { id name }
          }
          userProgram { id name programRevision { id name } }
        }
      }
    }
  `,
)
