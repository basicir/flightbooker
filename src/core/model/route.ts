import type { WeatherHour } from './snapshot'

/**
 * Útvonalas repülés (K27, SZB-19): az igényhez megadható, mely repülőtereket érinti a gép,
 * és opcionálisan a pontok közötti repült idő (elapsed time). A motor az érintett
 * repülőterek időjárását is nézi, mindegyikét abban az időben, amikor a gép ott lehet.
 */

/** Egy érintett repülőtér az útvonalon. */
export interface RouteStop {
  /** Négybetűs ICAO-kód. */
  readonly icao: string
  /** Az előző ponttól ide tartó szakasz ideje percben; hiányában a motor becsüli. */
  readonly elapsedMinutes?: number
}

export interface FlightRoute {
  /** Az indulás repülőtere; alapból a bázis. */
  readonly departure: string
  /** Az érintett repülőterek sorrendben; az utolsó a cél (visszatéréskor a bázis). */
  readonly stops: readonly RouteStop[]
}

/** Egy útvonal-repülőtér előrejelzése a pillanatképben. */
export interface AirportWeather {
  readonly icao: string
  readonly latitude: number
  readonly longitude: number
  /** Pályairányok valós fokban, az oldalszélhez; üresen nincs oldalszél-számítás. */
  readonly runwayHeadingsDeg: readonly number[]
  readonly hours: readonly WeatherHour[]
}
