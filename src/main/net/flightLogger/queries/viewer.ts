import { defineQuery } from '../defineQuery'
import type { Viewer } from '../types'

/** A kulcs tulajdonosa: a `user` argumentum nélkül a hitelesített felhasználót adja. */
export const ViewerQuery = defineQuery<{ user: Viewer | null }>(
  'Viewer',
  /* GraphQL */ `
    query Viewer {
      user {
        id
        bookingTimeZone
        flightTimeZone
        theoryTimeZone
      }
    }
  `,
)
