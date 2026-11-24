import type { IsoDateTime, LocalDate, Minutes } from './time'

/**
 * Erőforrások (4. fejezet): repülőgép és szimulátor – a FlightLoggerben mindkettő `aircraft`.
 * A FlightLoggerből csak azonosító és törzsadat jön; a besorolás és a tervezési
 * paraméterek helyi beállítások.
 */

export type ResourceKind = 'aircraft' | 'simulator'
export type FlightLoggerAircraftClass = 'SINGLE_ENGINE' | 'MULTI_ENGINE' | 'SIMULATOR'

/** A FlightLoggerből olvasott gép, a tervezéshez szükséges mezőkkel. */
export interface FleetEntry {
  readonly id: string
  readonly callSign: string
  readonly model: string
  readonly aircraftClass: FlightLoggerAircraftClass
  readonly disabled: boolean
}

/**
 * Géptípus beállításai (ERF-01, ERF-08). A típus a FlightLogger `model` mezője, így nem kell
 * kézzel kategóriákat felvenni.
 */
export interface AircraftTypeSettings {
  /** Motorpróba és körüljárás a típus gépeinél (ERF-08, SZB-05). */
  readonly engineRunUpMinutes?: Minutes
}

/** Egy erőforrás helyi beállításai (ERF-02, ERF-08, ERF-10, SZB-06). */
export interface ResourceSettings {
  readonly kind: ResourceKind
  /** Felülírja a típus és a globális alapértéket. */
  readonly engineRunUpMinutes?: Minutes
  /** Minimális fordulóidő két repülés között (ERF-10). */
  readonly turnaroundMinutes?: Minutes
  /** Minimális tartalék a gépben órában; negatív is lehet (SZB-06). */
  readonly minReserveHours?: number
}

/** A következő karbantartás fajtája órában (a táblázat „Karbantartás típusa” oszlopa). */
export const MAINTENANCE_TYPES = [25, 50, 100, 200] as const
export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number]

/**
 * Kirepülhető idő (ERF-04): a karbantartásig még repülhető órák, a maintenance crew
 * reggeli dokumentuma alapján. A FlightLogger ezt nem adja (felderítés, 2026-11-10).
 */
export interface AircraftHoursEntry {
  readonly date: LocalDate
  readonly hoursUntilMaintenance: number
  /** A következő karbantartás fajtája: ebből jön a túlrepülhető idő és a karbantartás hossza. */
  readonly maintenanceType?: MaintenanceType
  readonly enteredAt: IsoDateTime
}

/** Karbantartás-fajtánkénti beállítás. */
export interface MaintenanceTypeSettings {
  /** Ennyivel repülhető túl a kirepülhető idő e karbantartás előtt (óra). */
  readonly overflyHours: number
  /** A karbantartás várható hossza (óra), ennyi ideig a gép nem foglalható. */
  readonly durationHours: number
}

/** Terem (ERF-07): a FlightLoggerből csak azonosító és név jön, a férőhely helyi. */
export interface ClassroomSettings {
  readonly capacity: number
  /** 1 = legjobban preferált; azonos érték is lehet. */
  readonly preferenceRank: number
}

/** Erőforrás teljes, alapértékekkel feloldott beállítása a motor számára. */
export interface EffectiveResource {
  readonly id: string
  readonly kind: ResourceKind
  /** A FlightLogger géptípusa (`model`), ha ismert. */
  readonly aircraftType: string | undefined
  readonly engineRunUpMinutes: Minutes
  readonly turnaroundMinutes: Minutes
  readonly minReserveHours: number
}
