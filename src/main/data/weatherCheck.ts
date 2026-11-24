import type { Settings } from '../../core/config/schema'
import type { LocalDate } from '../../core/model/time'
import { addDays, daysBetween, localParts } from '../../core/time/zoned'
import type { WeatherCheckResult } from '../../shared/api'
import type { ForecastRequest, ForecastResponse } from '../net/openMeteo'
import { fetchModelForecasts, modelSkill, type SkillSource } from './blendedWeather'

/**
 * Az indítópult időjárás-ellenőrzése (ADT-07): a bázis előrejelzése az Open-Meteo minden
 * összevetett modelljéből, és a modellek METAR-ral mért pontossága. A letöltött előrejelzés
 * a mérés archívumába is bekerül.
 */

export interface WeatherCheckDeps {
  readonly fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>
  readonly now: Date
  /** A METAR-mérés; nélküle (teszt) az induló súlyok. */
  readonly skill?: SkillSource
}

export async function fetchWeatherCheck(deps: WeatherCheckDeps, settings: Settings, weekStart: LocalDate): Promise<WeatherCheckResult> {
  const fetchedAt = deps.now.toISOString()
  const airport = settings.airport
  if (!airport) throw new Error('Nincs megadva a repülőtér.')
  const tz = airport.timezone
  const today = localParts(deps.now.getTime(), tz).date
  const days = Math.min(16, Math.max(1, daysBetween(today, addDays(weekStart, 7)) + 1))
  const { models } = await fetchModelForecasts(deps.fetchForecast, airport, days)
  const skill = await modelSkill(deps.skill, deps.now, airport, models)
  return { fetchedAt, models, skill }
}
