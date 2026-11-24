import { defineQuery } from '../defineQuery'
import type { Booking, BookingStatus, BookingSubtype, Connection } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

export interface BookingsVariables extends PageVariables {
  from: string
  to: string
  all?: boolean
  overlap?: boolean
  statuses?: BookingStatus[]
  subtypes?: BookingSubtype[]
  changedAfter?: string
}

/** A foglalásra tervezett feladat (Lecture) mezői: a neve és a tervezett percei. */
const LECTURE_FIELDS = `
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
`

/**
 * ADT-01/02/03: foglalások egy időablakban. Az `all: true` a más oktatókhoz kötött
 * foglalásokat is kéri – ezt a felderítés ellenőrzi (K02). A létrehozó azonosítója nem kell,
 * kommentet csak a karbantartási foglalásnál kérünk: abból derül ki a fajtája (B5, Q8).
 * A repülési foglalásnál a megfigyelők (observer) is kellenek: ők is a foglalásban vannak, csak
 * nem repülnek. A többnövendékes foglalásnál a feladat növendékenként jön (KBR-10).
 */
export const BookingsQuery = defineQuery<{ bookings: Connection<Booking> }, BookingsVariables>(
  'Bookings',
  /* GraphQL */ `
    query Bookings(
      $from: DateTime
      $to: DateTime
      $all: Boolean
      $overlap: Boolean
      $statuses: [BookingStatusEnum!]
      $subtypes: [BookingSubtypeEnum!]
      $changedAfter: DateTime
      $first: Int
      $after: String
    ) {
      bookings(
        from: $from
        to: $to
        all: $all
        overlap: $overlap
        statuses: $statuses
        subtypes: $subtypes
        changedAfter: $changedAfter
        first: $first
        after: $after
      ) {
        ${PAGE_INFO}
        nodes {
          __typename
          ... on Booking { id startsAt endsAt status color }
          ... on MaintenanceBooking { comment }
          ... on AircraftBooking { flightStartsAt flightEndsAt aircraft { id callSign } }
          ... on GroundBooking { classroom { id } }
          ... on SingleStudentBooking {
            instructor { id }
            student { id }
            observers { id }
            plannedLesson {
              id
              lecture { ${LECTURE_FIELDS} }
              userProgram { id name programRevision { id name } }
            }
          }
          ... on MultiStudentBooking {
            instructor { id }
            students { id }
            observers { id }
            plannedLessons {
              id
              student { id }
              lecture { ${LECTURE_FIELDS} }
              userProgram { id name programRevision { id name } }
            }
          }
          ... on TheoryBooking { instructor { id } students { id } class { id } }
          ... on ExtraTheoryBooking { instructor { id } student { id } }
          ... on OperationBooking { pic { id } crew { id } }
          ... on RentalBooking { renter { id } approved }
          ... on MeetingBooking { participants { id } }
        }
      }
    }
  `,
)
