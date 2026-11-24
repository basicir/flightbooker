import type { WeatherHour } from '../model/snapshot'
import type { LocalDate } from '../model/time'
import type { HourRating, WeatherLimits } from '../model/weather'
import { sunEvents } from '../time/solar'
import { HOUR_MS, localParts, toMs } from '../time/zoned'
import { assessHour, hourValues } from './rating'

/**
 * Időjárás-ellenőrzés az indítópulton (ADT-07, 7.4): a tervezés előrejelzését (a modellek
 * pontosság szerint súlyozott együttese, `blend.ts`) egymás mellé teszi az egyes modellekkel,
 * hogy látszódjon, mennyire egyeznek.
 */

/**
 * Az összevetett modellek. A lista egyben engedélyezési lista: a főfolyamat csak ezeket
 * kéri le (az Open-Meteo felé így is csak koordináta, időablak és modellnév megy, ALP-02).
 */
export const WEATHER_CHECK_MODELS = [
  { id: 'icon_d2', label: 'DWD ICON-D2', detail: '2 km, kb. 2 nap; csak Németország környéke' },
  { id: 'icon_eu', label: 'DWD ICON-EU', detail: '7 km, kb. 5 nap' },
  { id: 'icon_global', label: 'DWD ICON', detail: '13 km, kb. 7,5 nap' },
  { id: 'ecmwf_ifs025', label: 'ECMWF IFS', detail: '25 km, 15 nap' },
  { id: 'gfs_seamless', label: 'NOAA GFS', detail: '3–25 km, 16 nap' },
  { id: 'ukmo_seamless', label: 'UK Met Office', detail: '10 km, kb. 7 nap' },
  { id: 'meteofrance_seamless', label: 'Météo-France', detail: 'ARPEGE, kb. 4,5 nap' },
  // HARMONIE-AROME (2 km): az Open-Meteo best_match-e Nyíregyházán (2026-11-15).
  { id: 'dmi_seamless', label: 'DMI HARMONIE', detail: 'HARMONIE-AROME 2 km, kb. 2,5 nap, utána ECMWF' },
] as const

export type WeatherCheckModelId = (typeof WEATHER_CHECK_MODELS)[number]['id']

export const WEATHER_CHECK_MODEL_IDS: readonly string[] = WEATHER_CHECK_MODELS.map((m) => m.id)

/** Egy modell órás előrejelzése; `error`, ha a modell nem adott adatot. */
export interface ModelForecast {
  readonly model: string
  readonly hours: readonly WeatherHour[]
  readonly error?: string
}

export interface ForecastPlace {
  readonly timeZone: string
  readonly latitude: number
  readonly longitude: number
  readonly runwayHeadingsDeg: readonly number[]
}

/** Egy modell egy napja: a nappali órák összesítése az iskolai minimum szerint. */
export interface DayForecast {
  readonly date: LocalDate
  /** A nappali órák közül ennyire ad a modell adatot (0: a modell nem lát el idáig). */
  readonly hours: number
  readonly flyable: number
  readonly marginal: number
  readonly unflyable: number
  readonly tempMinC: number | null
  readonly tempMaxC: number | null
  readonly windMaxKt: number | null
  readonly gustMaxKt: number | null
  readonly crosswindMaxKt: number | null
  readonly visibilityMinM: number | null
  /** A legalacsonyabb felhőalap (plafon, `NO_CEILING_FT`: nincs), láb. */
  readonly cloudBaseMinFt: number | null
  readonly lowCloudMaxPct: number | null
  /** A nappali órák csapadékösszege, mm. */
  readonly precipitationMm: number | null
  readonly precipitationProbabilityMaxPct: number | null
  readonly thunder: boolean
}

export type DayVerdict = 'good' | 'mixed' | 'poor' | 'nodata'

/** Napkelte és napnyugta közötti órák (az óra közepe esik a nappalba). */
function isDaylightHour(time: string, date: LocalDate, place: ForecastPlace): boolean {
  const mid = toMs(time) + HOUR_MS / 2
  if (localParts(mid, place.timeZone).date !== date) return false
  const sun = sunEvents(date, place.latitude, place.longitude, -0.833)
  // Sarkvidéki nap: ha nincs napkelte/napnyugta, az egész nap számít.
  if (sun.rise === undefined || sun.set === undefined) return true
  return mid >= sun.rise && mid <= sun.set
}

function hasData(h: WeatherHour): boolean {
  return h.temperatureC !== null || h.windSpeedKt !== null || h.windGustKt !== null
}

const maxOf = (a: number | null, b: number | null): number | null => (b === null ? a : a === null ? b : Math.max(a, b))
const minOf = (a: number | null, b: number | null): number | null => (b === null ? a : a === null ? b : Math.min(a, b))

/** Egy nap összesítése egy modell óráiból (nappali órák, iskolai minimum). */
export function summarizeDay(hours: readonly WeatherHour[], date: LocalDate, place: ForecastPlace, schoolMinima: WeatherLimits): DayForecast {
  let count = 0
  let flyable = 0
  let marginal = 0
  let unflyable = 0
  let tempMinC: number | null = null
  let tempMaxC: number | null = null
  let windMaxKt: number | null = null
  let gustMaxKt: number | null = null
  let crosswindMaxKt: number | null = null
  let visibilityMinM: number | null = null
  let cloudBaseMinFt: number | null = null
  let lowCloudMaxPct: number | null = null
  let precipitationMm: number | null = null
  let precipitationProbabilityMaxPct: number | null = null
  let thunder = false
  for (const h of hours) {
    if (!hasData(h) || !isDaylightHour(h.time, date, place)) continue
    count++
    const v = hourValues(h, place.runwayHeadingsDeg)
    const a = assessHour(v, schoolMinima, {})
    if (a.rating === 'flyable') flyable++
    else if (a.rating === 'marginal') marginal++
    else unflyable++
    thunder ||= a.thunderRisk
    tempMinC = minOf(tempMinC, h.temperatureC)
    tempMaxC = maxOf(tempMaxC, h.temperatureC)
    windMaxKt = maxOf(windMaxKt, v.windKt)
    gustMaxKt = maxOf(gustMaxKt, v.gustKt)
    crosswindMaxKt = maxOf(crosswindMaxKt, v.crosswindKt)
    visibilityMinM = minOf(visibilityMinM, v.visibilityM)
    cloudBaseMinFt = minOf(cloudBaseMinFt, v.cloudBaseFt)
    lowCloudMaxPct = maxOf(lowCloudMaxPct, v.lowCloudCoverPct)
    if (v.precipitationMmPerH !== null) precipitationMm = (precipitationMm ?? 0) + v.precipitationMmPerH
    precipitationProbabilityMaxPct = maxOf(precipitationProbabilityMaxPct, v.precipitationProbabilityPct)
  }
  return {
    date,
    hours: count,
    flyable,
    marginal,
    unflyable,
    tempMinC,
    tempMaxC,
    windMaxKt,
    gustMaxKt,
    crosswindMaxKt,
    visibilityMinM,
    cloudBaseMinFt,
    lowCloudMaxPct,
    precipitationMm: precipitationMm === null ? null : Math.round(precipitationMm * 10) / 10,
    precipitationProbabilityMaxPct,
    thunder,
  }
}

/**
 * A nap egy szóban: jó, ha a nappali órák legalább fele repülhető; rossz, ha legalább fele
 * az iskolai minimumon kívül esik; egyébként vegyes.
 */
export function dayVerdict(day: DayForecast): DayVerdict {
  if (day.hours === 0) return 'nodata'
  if (day.flyable * 2 >= day.hours) return 'good'
  if (day.unflyable * 2 >= day.hours) return 'poor'
  return 'mixed'
}

export interface DayConsensus {
  readonly date: LocalDate
  /** Ennyi modell ad adatot a napra (a tervezésé is beleszámít). */
  readonly models: number
  readonly good: number
  readonly mixed: number
  readonly poor: number
  /** A többség ítélete; döntetlennél és adat nélkül `null`. */
  readonly majority: Exclude<DayVerdict, 'nodata'> | null
  /** A legnagyobb és a legkisebb napi széllökés különbsége a modellek között, csomó. */
  readonly gustSpreadKt: number | null
  /** A tervezés előrejelzése eltér a többi modell többségétől. */
  readonly engineDisagrees: boolean
}

/**
 * A modellek egyetértése egy napon. `engine`: a tervezés napja; a többségbe a többi modell
 * számít, hogy a tervezés eltérése látszódjon. `minHours`: az ennél kevesebb nappali órát
 * lefedő modellnap (az előrejelzés vége, például csak a délelőtt) nem számít bele.
 */
export function dayConsensus(date: LocalDate, engine: DayForecast | undefined, others: readonly DayForecast[], minHours = 1): DayConsensus {
  const counts = (d: DayForecast): boolean => d.hours > 0 && d.hours >= minHours
  engine = engine && counts(engine) ? engine : undefined
  others = others.filter(counts)
  const all = [...(engine ? [engine] : []), ...others]
  const verdicts = all.map(dayVerdict)
  const good = verdicts.filter((v) => v === 'good').length
  const mixed = verdicts.filter((v) => v === 'mixed').length
  const poor = verdicts.filter((v) => v === 'poor').length
  const otherVerdicts = others.map(dayVerdict)
  const majorityOf = (vs: readonly DayVerdict[]): DayConsensus['majority'] => {
    const counts = (['good', 'mixed', 'poor'] as const).map((v) => ({ v, n: vs.filter((x) => x === v).length })).sort((a, b) => b.n - a.n)
    const [first, second] = counts as [{ v: 'good' | 'mixed' | 'poor'; n: number }, { n: number }]
    return first.n === 0 || first.n === second.n ? null : first.v
  }
  const othersMajority = majorityOf(otherVerdicts)
  const engineVerdict = engine ? dayVerdict(engine) : 'nodata'
  // Legalább két másik modell kell, hogy a többségnek legyen értelme.
  const engineDisagrees = otherVerdicts.length >= 2 && othersMajority !== null && engineVerdict !== 'nodata' && engineVerdict !== othersMajority
  const gusts = all.map((d) => d.gustMaxKt).filter((g): g is number => g !== null)
  return {
    date,
    models: all.length,
    good,
    mixed,
    poor,
    majority: majorityOf(verdicts),
    gustSpreadKt: gusts.length >= 2 ? Math.round(Math.max(...gusts) - Math.min(...gusts)) : null,
    engineDisagrees,
  }
}

/** Az utolsó óra, amelyre a modell adatot ad (az előrejelzés hossza). */
export function forecastHorizon(hours: readonly WeatherHour[]): string | null {
  for (let i = hours.length - 1; i >= 0; i--) {
    if (hasData(hours[i]!)) return hours[i]!.time
  }
  return null
}

/** A meteogram egy órája: a megjelenített értékek és az iskolai minimum szerinti minősítés. */
export interface HourPoint {
  /** Az óra kezdete, UTC ezredmásodperc. */
  readonly ms: number
  readonly rating: HourRating
  readonly thunder: boolean
  readonly temperatureC: number | null
  readonly windKt: number | null
  readonly windDirectionDeg: number | null
  readonly gustKt: number | null
  readonly crosswindKt: number | null
  readonly visibilityM: number | null
  readonly cloudBaseFt: number | null
  readonly lowCloudCoverPct: number | null
  readonly precipitationMm: number | null
  readonly precipitationProbabilityPct: number | null
}

/**
 * Egy modell órái a meteogramhoz a `[fromMs, toMs)` időablakban; az adat nélküli óra
 * kimarad (a vonal ott megszakad).
 */
export function hourPoints(hours: readonly WeatherHour[], fromMs: number, toMs: number, place: ForecastPlace, schoolMinima: WeatherLimits): HourPoint[] {
  const result: HourPoint[] = []
  for (const h of hours) {
    const ms = Date.parse(h.time)
    if (ms < fromMs || ms >= toMs || !hasData(h)) continue
    const v = hourValues(h, place.runwayHeadingsDeg)
    const a = assessHour(v, schoolMinima, {})
    result.push({
      ms,
      rating: a.rating,
      thunder: a.thunderRisk,
      temperatureC: h.temperatureC,
      windKt: v.windKt,
      windDirectionDeg: h.windDirectionDeg,
      gustKt: v.gustKt,
      crosswindKt: v.crosswindKt,
      visibilityM: v.visibilityM,
      cloudBaseFt: v.cloudBaseFt,
      lowCloudCoverPct: v.lowCloudCoverPct,
      precipitationMm: v.precipitationMmPerH,
      precipitationProbabilityPct: v.precipitationProbabilityPct,
    })
  }
  return result.sort((a, b) => a.ms - b.ms)
}
