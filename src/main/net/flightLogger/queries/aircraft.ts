import { defineQuery } from '../defineQuery'
import type { Aircraft, AircraftAvailabilities, Connection } from '../types'
import { PAGE_INFO, type PageVariables } from './common'

/**
 * ADT-01: aktív gépek és szimulátorok, karbantartási adatokkal.
 * A `worstMaintenanceWarning.logMeasurementType` és `.typeOfTimerMeasurement` mezőt
 * szándékosan nem kérjük: élesben szerverhibát adnak (felderítés, 2026-11-10).
 * A mértékegység a `primaryLog.measurementType`-ból olvasható.
 */
export const AircraftQuery = defineQuery<{ aircraft: Connection<Aircraft> }, PageVariables>(
  'Aircraft',
  /* GraphQL */ `
    query Aircraft($first: Int, $after: String) {
      aircraft(first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          callSign
          model
          aircraftClass
          aircraftType
          disabled
          homeAirport { icaoCode }
          currentLocation { kind airport { icaoCode } }
          totalAirborneMinutes
          timerSeconds
          typeOfTimer
          typeOfTimerMeasurement
          primaryLog { type measurementType totalSeconds }
          nextService {
            nextPrimaryService
            nextSecondaryService
            nextTertiaryService
            nextServiceDate
            nextServiceCycles
            primaryWarningColor
            dateWarningColor
          }
          worstMaintenanceWarning {
            timeLeft
            daysLeft
            cyclesLeft
            expiryTime
            expiryDate
            status
            subjectName
            logType
            typeOfTimer
            color
            blockable
          }
          audit { updatedAt createdAt }
        }
      }
    }
  `,
)

/**
 * A gépek elérhetőségi eseményei. Külön lekérdezés, mert a beágyazott kapcsolat a
 * gépek lapméretével szorozva túllépné az összetettségi korlátot; kis lapmérettel hívandó.
 */
export const AircraftAvailabilitiesQuery = defineQuery<
  { aircraft: Connection<AircraftAvailabilities> },
  PageVariables & { from: string; to: string }
>(
  'AircraftAvailabilities',
  /* GraphQL */ `
    query AircraftAvailabilities($from: DateTime, $to: DateTime, $first: Int, $after: String) {
      aircraft(first: $first, after: $after) {
        ${PAGE_INFO}
        nodes {
          id
          availabilities(from: $from, to: $to, first: 50) {
            ${PAGE_INFO}
            nodes { startsAt endsAt }
          }
        }
      }
    }
  `,
)
