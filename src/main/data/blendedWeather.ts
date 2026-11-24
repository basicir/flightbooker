import type { Daylight, WeatherHour } from '../../core/model/snapshot'
import { blendForecasts } from '../../core/weather/blend'
import { WEATHER_CHECK_MODELS, type ModelForecast } from '../../core/weather/forecastCheck'
import { skillWeights } from '../../core/weather/skill'
import type { MetarRecord } from '../../core/weather/metar'
import { OpenMeteoError, type ForecastRequest, type ForecastResponse } from '../net/openMeteo'
import type { MetarRequest } from '../net/metar'
import { mapForecast } from './mapping'
import { updateModelSkill, type ModelSkillSummary, type SkillStore } from './modelSkill'

/**
 * A bázis előrejelzése az összes összevetett modellből (ADT-07), és belőlük a tervezés
 * pontosság szerint súlyozott együttese. Modellenként külön kérés, hogy egy modell hiánya
 * (például az ICON-D2 nem fedi le a bázist) ne rontsa el a többit. Az Open-Meteo felé csak
 * koordináta, időablak és modellnév, a METAR-szolgáltatás felé csak az ICAO-kód megy (ALP-02).
 */

export interface SkillSource {
  readonly fetchMetars: (request: MetarRequest) => Promise<MetarRecord[]>
  readonly store: SkillStore
}

export interface Place {
  readonly icaoCode?: string
  readonly latitude: number
  readonly longitude: number
  readonly timezone: string
}

export const MODEL_IDS: readonly string[] = WEATHER_CHECK_MODELS.map((m) => m.id)

function errorText(error: unknown): string {
  if (error instanceof OpenMeteoError && /no data is available/i.test(error.message)) return 'Erre a helyre nincs adata.'
  return error instanceof Error ? error.message : String(error)
}

export async function fetchModelForecasts(
  fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>,
  place: Place,
  days: number,
): Promise<{ readonly models: ModelForecast[]; readonly daylight: Record<string, Daylight> }> {
  let daylight: Record<string, Daylight> = {}
  const models = await Promise.all(
    MODEL_IDS.map(async (id): Promise<ModelForecast> => {
      try {
        const mapped = mapForecast(await fetchForecast({ latitude: place.latitude, longitude: place.longitude, timezone: 'GMT', forecastDays: days, model: id }), place.timezone)
        if (Object.keys(mapped.daylight).length > Object.keys(daylight).length) daylight = mapped.daylight
        return { model: id, hours: mapped.hours }
      } catch (error) {
        return { model: id, hours: [], error: errorText(error) }
      }
    }),
  )
  return { models, daylight }
}

/** A mérés frissítése; forrás nélkül (teszt) az induló súlyok. */
export async function modelSkill(skill: SkillSource | undefined, now: Date, place: Place, models: readonly ModelForecast[]): Promise<ModelSkillSummary> {
  if (!skill) return { weights: skillWeights([], MODEL_IDS, now.getTime()), measuredHours: 0 }
  return updateModelSkill(
    { ...skill, now },
    place.icaoCode,
    models.filter((m) => !m.error),
    MODEL_IDS,
  )
}

export interface PlanningWeather {
  readonly hours: WeatherHour[]
  readonly daylight: Record<string, Daylight>
  readonly models: readonly string[]
  /** A `models` közül a legutóbbi sikeres letöltéssel pótoltak. */
  readonly staleModels: readonly string[]
  readonly skill: ModelSkillSummary
}

/** Egy modell legutóbbi sikeres előrejelzése egy helyre. */
export interface RememberedForecast {
  readonly fetchedAtMs: number
  readonly hours: ModelForecast['hours']
  readonly daylight: Record<string, Daylight>
}

/**
 * A modellenkénti utolsó jó előrejelzés legfeljebb ennyi ideig pótolhatja a frissítéskor épp
 * le nem jött modellt (két modellfutás között a pótlás nem torzít érdemben).
 */
export const FORECAST_FALLBACK_MAX_AGE_MS = 6 * 3_600_000

/** A főfolyamat memóriája (a munkamenet alatt); a teszt sajátot ad. */
const forecastMemory = new Map<string, RememberedForecast>()

const memoryKey = (place: Place, model: string, days: number): string => `${place.latitude.toFixed(4)}|${place.longitude.toFixed(4)}|${days}|${model}`

/**
 * A tervezés előrejelzése: a modellek súlyozott együttese. Kivételt dob, ha egy modell sem jött
 * le, és a közelmúltból sincs pótlás.
 *
 * Ha egy modell (időtúllépés, átmeneti szerverhiba) épp most nem jön le, de az elmúlt
 * `FORECAST_FALLBACK_MAX_AGE_MS`-ban lejött, a legutóbbi előrejelzése pótolja. Enélkül egy-egy
 * modell kiesése egy frissítés erejéig átrendezné az együttest (például a látás mediánját), és a
 * hét közbeni figyelés a pillanatnyi „romlás” miatt sok foglalás áthelyezését javasolná. A
 * tartósan hiányzó modell (például amelyik a helyet nem fedi le) sosem jött le, így nem pótlódik.
 */
export async function fetchPlanningWeather(
  deps: {
    readonly fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>
    readonly skill?: SkillSource
    readonly now: Date
    readonly memory?: Map<string, RememberedForecast>
  },
  place: Place,
  days: number,
): Promise<PlanningWeather> {
  const memory = deps.memory ?? forecastMemory
  const nowMs = deps.now.getTime()
  const fetched = await fetchModelForecasts(deps.fetchForecast, place, days)
  let daylight = fetched.daylight
  const stale: string[] = []
  const models = fetched.models.map((m): ModelForecast => {
    const key = memoryKey(place, m.model, days)
    if (!m.error && m.hours.length > 0) {
      memory.set(key, { fetchedAtMs: nowMs, hours: m.hours, daylight: fetched.daylight })
      return m
    }
    const last = memory.get(key)
    if (!last || nowMs - last.fetchedAtMs > FORECAST_FALLBACK_MAX_AGE_MS || last.fetchedAtMs > nowMs) return m
    stale.push(m.model)
    if (Object.keys(last.daylight).length > Object.keys(daylight).length) daylight = last.daylight
    return { model: m.model, hours: last.hours }
  })
  const ok = models.filter((m) => !m.error && m.hours.length > 0)
  if (ok.length === 0) throw new Error(`Egyik modell sem adott előrejelzést (${models.map((m) => `${m.model}: ${m.error ?? 'üres'}`).join('; ')}).`)
  // A pontosság mérése csak a friss futásokkal (a pótolt már a korábbi körben bekerült).
  const skill = await modelSkill(deps.skill, deps.now, place, ok.filter((m) => !stale.includes(m.model)))
  return { hours: blendForecasts(ok, skill.weights, nowMs), daylight, models: ok.map((m) => m.model), staleModels: stale, skill }
}
