import { defineQuery } from '../defineQuery'
import type { Connection, User, UserAvailability, UserRole } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/** ADT-02: felhasználók szerepkör szerint (a szerepkör csak szűrőként érhető el). */
export const UsersByRoleQuery = defineQuery<
  { users: Connection<User> },
  PageVariables & { roles: UserRole[]; changedAfter?: string }
>(
  'UsersByRole',
  /* GraphQL */ `
    query UsersByRole($roles: [UserRoleEnum!], $changedAfter: DateTime, $first: Int, $after: String) {
      users(roles: $roles, changedAfter: $changedAfter, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          callSign
          firstName
          lastName
          currentLocation { kind airport { icaoCode } }
          audit { updatedAt }
        }
      }
    }
  `,
)

/** ADT-02, SZB-03: egy felhasználó ráérései. Az iskolánál külön engedélyezendő funkció. */
export const UserAvailabilitiesQuery = defineQuery<
  { user: { id: string; availabilities: Connection<UserAvailability> } | null },
  PageVariables & { id: string; from: string; to: string }
>(
  'UserAvailabilities',
  /* GraphQL */ `
    query UserAvailabilities($id: String, $from: DateTime, $to: DateTime, $first: Int, $after: String) {
      user(id: $id) {
        id
        availabilities(from: $from, to: $to, first: $first, after: $after) {
          ${PAGE_INFO}
          nodes { startsAt endsAt unavailable }
        }
      }
    }
  `,
)
