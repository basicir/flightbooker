import { defineQuery } from '../defineQuery'
import type { Connection, Flight, LogbookEntry, LogbookSummation } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/** Repülések időablakban (block time: offBlock–onBlock). */
export const FlightsQuery = defineQuery<
  { flights: Connection<Flight> },
  PageVariables & { from: string; to: string; all?: boolean; changedAfter?: string }
>(
  'Flights',
  /* GraphQL */ `
    query Flights($from: DateTime, $to: DateTime, $all: Boolean, $changedAfter: DateTime, $first: Int, $after: String) {
      flights(from: $from, to: $to, all: $all, changedAfter: $changedAfter, first: $first, after: $after) {
        ${PAGE_INFO}
        nodes { id offBlock onBlock flightType ftSeconds aircraft { id } }
      }
    }
  `,
)

/**
 * ADT-05, LIM-01: az oktató logbookja a limitekhez. A myFlightLogger a kulcs
 * tulajdonosának minden fiókját lefedi. Név és e-mail szándékosan nincs lekérdezve.
 */
export const LogbookEntriesQuery = defineQuery<
  { myFlightLogger: { logbookEntries: Connection<LogbookEntry> | null } | null },
  PageVariables & { from: string; to: string }
>(
  'LogbookEntries',
  /* GraphQL */ `
    query LogbookEntries($from: DateTime, $to: DateTime, $first: Int, $after: String) {
      myFlightLogger {
        logbookEntries(from: $from, to: $to, first: $first, after: $after) {
          ${PAGE_INFO}
          nodes {
            id
            offBlock
            onBlock
            totalSeconds
            flightInstructorSeconds
            syntheticTrainingSeconds
            instructorSyntheticTrainingSeconds
            includeInFtl
          }
        }
      }
    }
  `,
)

export const LogbookSummationQuery = defineQuery<
  { myFlightLogger: { logbookSummations: LogbookSummation | null } | null },
  { from: string; to: string }
>(
  'LogbookSummation',
  /* GraphQL */ `
    query LogbookSummation($from: DateTime, $to: DateTime) {
      myFlightLogger {
        logbookSummations(from: $from, to: $to) {
          totalSeconds
          flightInstructorSeconds
          syntheticTrainingSeconds
          instructorSyntheticTrainingSeconds
        }
      }
    }
  `,
)
