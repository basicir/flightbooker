import type { Settings } from '../../core/config/schema'
import { lookupAirport, type AirportLookupResult } from '../../core/airports/lookup'
import type { AirportWeather } from '../../core/model/route'
import type { WeatherHour } from '../../core/model/snapshot'
import { ICAO_PATTERN } from '../../core/route/timing'
import { addDays, daysBetween, localParts } from '../../core/time/zoned'
import type { ForecastRequest, ForecastResponse } from '../net/openMeteo'
import { mapForecast } from './mapping'

/**
 * Az útvonalas igények repülőtereinek előrejelzése (K27, SZB-19, ADT-07). A koordináta a
 * programmal szállított repülőtér-listából jön; az Open-Meteo felé csak koordináta és
 * időablak megy ki (ALP-02).
 */

/** Egy kérésben legfeljebb ennyi repülőtér: a felület egy hét igényeit küldi. */
export const MAX_ROUTE_AIRPORTS = 40

export interface RouteWeatherDeps {
  readonly fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>
  readonly now: Date
  readonly lookup?: (icao: string) => Promise<AirportLookupResult | undefined>
  /** Bemutató módban nincs hálózat: a szintetikus órák jönnek. */
  readonly demoHours?: () => WeatherHour[]
}

export interface RouteWeatherResult {
  readonly weather: Readonly<Record<string, AirportWeather>>
  /** Repülőterenként a hiba (ismeretlen kód, sikertelen letöltés). */
  readonly errors: Readonly<Record<string, string>>
}

export async function fetchRouteWeather(deps: RouteWeatherDeps, settings: Settings, weekStart: string, icaos: readonly string[]): Promise<RouteWeatherResult> {
  const tz = settings.airport?.timezone ?? 'Europe/Budapest'
  const today = localParts(deps.now.getTime(), tz).date
  const days = Math.min(16, Math.max(1, daysBetween(today, addDays(weekStart, 7)) + 1))
  const lookup = deps.lookup ?? lookupAirport
  const weather: Record<string, AirportWeather> = {}
  const errors: Record<string, string> = {}
  const unique = [...new Set(icaos)].filter((c) => ICAO_PATTERN.test(c)).slice(0, MAX_ROUTE_AIRPORTS)
  await Promise.all(
    unique.map(async (icao) => {
      const airport = await lookup(icao)
      if (!airport) {
        errors[icao] = 'Ismeretlen ICAO-kód.'
        return
      }
      const base = { icao, latitude: airport.latitude, longitude: airport.longitude, runwayHeadingsDeg: airport.runways.map((r) => r.trueHeadingDeg) }
      try {
        const hours = deps.demoHours
          ? deps.demoHours()
          : mapForecast(await deps.fetchForecast({ latitude: airport.latitude, longitude: airport.longitude, timezone: 'GMT', forecastDays: days }), tz).hours
        weather[icao] = { ...base, hours }
      } catch (error) {
        // A koordináta előrejelzés nélkül is kell a szakaszidő számításához (90 csomó).
        weather[icao] = { ...base, hours: [] }
        errors[icao] = error instanceof Error ? error.message : String(error)
      }
    }),
  )
  return { weather, errors }
}
