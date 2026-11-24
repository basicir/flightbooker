import { defineQuery } from '../defineQuery'
import type { Classroom, Connection, SchoolClass } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/** ADT-03: termek. Férőhely mező nincs az API-ban, az helyi beállítás (ERF-07). */
export const ClassroomsQuery = defineQuery<
  { classrooms: Connection<Classroom> },
  PageVariables & { includeDisabled?: boolean }
>(
  'Classrooms',
  /* GraphQL */ `
    query Classrooms($includeDisabled: Boolean, $first: Int, $after: String) {
      classrooms(includeDisabled: $includeDisabled, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes { id name currentLocation { kind airport { icaoCode } } }
      }
    }
  `,
)

/** Osztályok (növendékcsoportok) tagsággal. */
export const ClassesQuery = defineQuery<{ classes: Connection<SchoolClass> }, PageVariables & { changedAfter?: string }>(
  'Classes',
  /* GraphQL */ `
    query Classes($changedAfter: DateTime, $first: Int, $after: String) {
      classes(changedAfter: $changedAfter, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes { id name users { id } }
      }
    }
  `,
)
