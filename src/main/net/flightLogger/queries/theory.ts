import { defineQuery } from '../defineQuery'
import type { Connection } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/** A program a revízióival: a FlightLogger elméleti ablakának Program listája (FLI-11). */
export interface ProgramSummary {
  readonly id: string
  readonly name: string
  readonly programType: 'FLIGHT_TRAINING' | 'GROUND_TRAINING' | 'COMBINED_SYLLABUS' | null
  readonly programRevisions: Connection<{ readonly id: string; readonly name: string }> | null
}

/** Tárgy (Subject) egy programrevízióban. */
export interface SubjectCategorySummary {
  readonly id: string
  readonly name: string | null
  readonly theoryCourse: { readonly id: string; readonly name: string } | null
}

/**
 * FLI-11: a programok és revízióik (a fázisok és feladatok nélkül, ezért kicsi). A FlightLogger
 * ablakában a Program felirata „program revízió”.
 */
export const TheoryProgramsQuery = defineQuery<{ programs: Connection<ProgramSummary> }, PageVariables & { programType?: ProgramSummary['programType'] }>(
  'TheoryPrograms',
  /* GraphQL */ `
    query TheoryPrograms($programType: ProgramTypeEnum, $first: Int, $after: String) {
      programs(programType: $programType, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          name
          programType
          programRevisions(first: 20) {
            ${PAGE_INFO}
            nodes { id name }
          }
        }
      }
    }
  `,
)

/** FLI-11: egy programrevízió tárgyai (a FlightLogger ablakában a Subject lista). */
export const SubjectCategoriesQuery = defineQuery<{ subjectCategories: Connection<SubjectCategorySummary> }, PageVariables & { programRevisionId: string }>(
  'SubjectCategories',
  /* GraphQL */ `
    query SubjectCategories($programRevisionId: Id!, $first: Int, $after: String) {
      subjectCategories(programRevisionId: $programRevisionId, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes { id name theoryCourse { id name } }
      }
    }
  `,
)
