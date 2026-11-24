import type { HourRating, WeatherLimits } from '../model/weather'
import type { WeatherHour } from '../model/snapshot'

/**
 * Az órák időjárási minősítése (7.4, SZB-01, SZB-16, NOV-06).
 *
 * A „nyers” érték (súlyozási dokumentum 3. fejezet) a limithez mért legrosszabb tartalék:
 * 1 = bőven belül, 0 = a limitnél vagy azon túl. A növendéki limit preferencia, csak
 * pontoz; az iskolai minimum 0–2 napon belül kizáró.
 */

/**
 * Becsült felhőalap lábban a hőmérséklet és a harmatpont különbségéből (kb. 400 láb / °C).
 * Csak tartalék, ha a modell felhőprofilja hiányzik: a szabály a gomolyfelhő aljára (jól
 * átkevert, labilis légkör) érvényes. Stabil, párás őszi levegőben a talajközeli kis
 * különbség miatt rendszeresen jóval alacsonyabb felhőalapot ad a valóságosnál.
 */
export function estimateCloudBaseFt(temperatureC: number | null, dewPointC: number | null): number | null {
  if (temperatureC === null || dewPointC === null) return null
  return Math.max(0, (temperatureC - dewPointC) * 400)
}

/** E fölötti felhőzetű réteg számít plafonnak (BKN/OVC, mint a Windy „ceiling” rétegénél). */
export const CEILING_COVER_PCT = 50
/** „Nincs plafon”: a vizsgált profilban (700 hPa, kb. 10 000 láb) nincs ilyen réteg. */
export const NO_CEILING_FT = 10_000

/** A modell egy nyomási szintje: magasság a repülőtér fölött és a felhőzet ott. */
export interface CloudLevel {
  readonly heightAglFt: number | null
  readonly coverPct: number | null
}

/**
 * Plafon a modell nyomási szintenkénti felhőzetéből (lábban a repülőtér fölött): a
 * legalacsonyabb szint, ahol a felhőzet {@link CEILING_COVER_PCT} fölött van; az alatta lévő
 * szint és e szint között lineárisan interpolálva. {@link NO_CEILING_FT}, ha nincs ilyen
 * réteg; `null`, ha a profilból két használható szint sem marad (régi gyorsítótár, hiányzó adat).
 *
 * `low`: a modell alacsonyszintű felhőzete (talaj–800 hPa) és a réteg teteje. A nyomási szintek
 * közé eső vékony rétegfelhőt (stratus) a szintek nem látják: ha az alacsony felhőzet
 * {@link CEILING_COVER_PCT} fölött van, de a szintekből nincs plafon a réteg tetejéig, a plafon
 * a réteg legfelhősebb szintjére kerül (egyenlőségnél a legalacsonyabbra). Óvatos becslés: a
 * DWD saját ICON-plafonjával összevetve így nem marad ki a 600–800 lábas réteg.
 */
export function ceilingFromProfile(levels: readonly CloudLevel[], low?: { readonly coverPct: number | null; readonly topFt: number | null }): number | null {
  const usable = levels
    .filter((l): l is { heightAglFt: number; coverPct: number } => l.heightAglFt !== null && l.coverPct !== null && l.heightAglFt > 0)
    .sort((a, b) => a.heightAglFt - b.heightAglFt)
  if (usable.length < 2) return null
  let ceiling = NO_CEILING_FT
  let prev: { heightAglFt: number; coverPct: number } | undefined
  for (const level of usable) {
    if (level.coverPct > CEILING_COVER_PCT) {
      const f = prev ? (CEILING_COVER_PCT - prev.coverPct) / (level.coverPct - prev.coverPct) : 1
      ceiling = Math.min(NO_CEILING_FT, prev ? prev.heightAglFt + Math.max(0, f) * (level.heightAglFt - prev.heightAglFt) : level.heightAglFt)
      break
    }
    prev = level
  }
  if (low && low.coverPct !== null && low.coverPct > CEILING_COVER_PCT) {
    const top = low.topFt ?? LOW_LAYER_TOP_FT
    if (ceiling > top) {
      let cloudiest: { heightAglFt: number; coverPct: number } | undefined
      for (const level of usable) {
        if (level.heightAglFt > top) break
        if (!cloudiest || level.coverPct > cloudiest.coverPct) cloudiest = level
      }
      if (cloudiest) ceiling = cloudiest.heightAglFt
    }
  }
  return ceiling
}

/** Az alacsony felhőzet (talaj–800 hPa) tetejének közelítése, ha a 800 hPa magassága hiányzik. */
export const LOW_LAYER_TOP_FT = 6500

/**
 * Egy óra felhőalapja: a modell felhőprofiljából számolt plafon, ha van; egyébként a
 * hőmérséklet–harmatpont becslés. `modelled`: a profilból jött-e.
 */
export function hourCloudBase(hour: Pick<WeatherHour, 'ceilingFt' | 'temperatureC' | 'dewPointC'>): { readonly ft: number | null; readonly modelled: boolean } {
  if (typeof hour.ceilingFt === 'number') return { ft: hour.ceilingFt, modelled: true }
  return { ft: estimateCloudBaseFt(hour.temperatureC, hour.dewPointC), modelled: false }
}

/**
 * Oldalszél a legkedvezőbb pályán (csomó). A szélirány és a pályairány is valós (földrajzi) fok.
 * Pálya nélkül `null`.
 */
export function crosswindKt(windSpeedKt: number | null, windDirectionDeg: number | null, runwayHeadingsDeg: readonly number[]): number | null {
  if (windSpeedKt === null || windDirectionDeg === null || runwayHeadingsDeg.length === 0) return null
  let best = Number.POSITIVE_INFINITY
  for (const heading of runwayHeadingsDeg) {
    const angle = ((windDirectionDeg - heading) * Math.PI) / 180
    best = Math.min(best, Math.abs(windSpeedKt * Math.sin(angle)))
  }
  return best
}

export interface HourValues {
  readonly windKt: number | null
  readonly gustKt: number | null
  readonly crosswindKt: number | null
  readonly visibilityM: number | null
  readonly cloudBaseFt: number | null
  readonly lowCloudCoverPct: number | null
  readonly precipitationMmPerH: number | null
  readonly precipitationProbabilityPct: number | null
  readonly capeJPerKg: number | null
  /** WMO időjárás-kód (95, 96, 99: zivatar). */
  readonly weatherCode: number | null
}

export function hourValues(hour: WeatherHour, runwayHeadingsDeg: readonly number[]): HourValues {
  return {
    windKt: hour.windSpeedKt,
    gustKt: hour.windGustKt,
    crosswindKt: crosswindKt(hour.windSpeedKt, hour.windDirectionDeg, runwayHeadingsDeg),
    visibilityM: hour.visibilityM,
    cloudBaseFt: hourCloudBase(hour).ft,
    lowCloudCoverPct: hour.cloudCoverLowPct,
    precipitationMmPerH: hour.precipitationMm,
    precipitationProbabilityPct: hour.precipitationProbabilityPct,
    capeJPerKg: hour.capeJPerKg,
    weatherCode: hour.weatherCode ?? null,
  }
}

type Check = { readonly value: number | null; readonly limit: number | undefined; readonly kind: 'max' | 'min' }

function checks(v: HourValues, l: WeatherLimits): Check[] {
  return [
    { value: v.windKt, limit: l.maxWindKt, kind: 'max' },
    { value: v.gustKt, limit: l.maxGustKt, kind: 'max' },
    { value: v.crosswindKt, limit: l.maxCrosswindKt, kind: 'max' },
    { value: v.visibilityM, limit: l.minVisibilityM, kind: 'min' },
    { value: v.cloudBaseFt, limit: l.minCloudBaseFt, kind: 'min' },
    { value: v.lowCloudCoverPct, limit: l.maxLowCloudCoverPct, kind: 'max' },
    { value: v.precipitationMmPerH, limit: l.maxPrecipitationMmPerH, kind: 'max' },
    { value: v.precipitationProbabilityPct, limit: l.maxPrecipitationProbabilityPct, kind: 'max' },
  ]
}

export interface Margin {
  /** 0–1; `null`, ha egyetlen limithez sincs adat. */
  readonly raw: number | null
  readonly violated: boolean
}

/**
 * A tartalék skálája: a limit felénél jobb érték már „bőven belül” van (nyers 1).
 * Enélkül egy szokványos jó nap (például 10 csomós széllökés 30-as limitnél) is csak
 * 0,67-et kapna, és bizonytalannak látszana.
 */
export const MARGIN_SCALE = 0.5

/** Egy óra tartaléka egy limitkészlethez. */
export function margin(values: HourValues, limits: WeatherLimits): Margin {
  let raw: number | null = null
  let violated = false
  for (const c of checks(values, limits)) {
    if (c.limit === undefined || c.value === null) continue
    let m: number
    if (c.kind === 'max') {
      if (c.value > c.limit) violated = true
      m = c.limit > 0 ? (c.limit - c.value) / (c.limit * MARGIN_SCALE) : c.value <= 0 ? 1 : 0
    } else {
      if (c.value < c.limit) violated = true
      m = c.limit > 0 ? (c.value - c.limit) / (c.limit * MARGIN_SCALE) : 1
    }
    m = Math.min(1, Math.max(0, m))
    raw = raw === null ? m : Math.min(raw, m)
  }
  return { raw: violated ? 0 : raw, violated }
}

/** A szigorúbb érték limitenként: az iskolai minimum és a növendéki limit együtt. */
export function combineLimits(school: WeatherLimits, student: WeatherLimits): WeatherLimits {
  const min = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.min(a, b))
  const max = (a?: number, b?: number): number | undefined => (a === undefined ? b : b === undefined ? a : Math.max(a, b))
  const result: Record<string, number | undefined> = {
    maxWindKt: min(school.maxWindKt, student.maxWindKt),
    maxGustKt: min(school.maxGustKt, student.maxGustKt),
    maxCrosswindKt: min(school.maxCrosswindKt, student.maxCrosswindKt),
    minVisibilityM: max(school.minVisibilityM, student.minVisibilityM),
    minCloudBaseFt: max(school.minCloudBaseFt, student.minCloudBaseFt),
    maxLowCloudCoverPct: min(school.maxLowCloudCoverPct, student.maxLowCloudCoverPct),
    maxPrecipitationMmPerH: min(school.maxPrecipitationMmPerH, student.maxPrecipitationMmPerH),
    maxPrecipitationProbabilityPct: min(school.maxPrecipitationProbabilityPct, student.maxPrecipitationProbabilityPct),
  }
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined)) as WeatherLimits
}

/** E fölött a CAPE zivatarveszélyt jelez (J/kg). */
export const THUNDER_CAPE = 1000
/** E fölött a CAPE már labilis légkört jelez: enyhe pontlevonás (J/kg). */
export const UNSTABLE_CAPE = 500
/** A zivatart jelző WMO-kódok. */
const THUNDER_CODES = new Set([95, 96, 99])

/**
 * Zivatarveszély (H19, Q11): nem kizáró, de a pontot lerontja, és a tervezet jelzi.
 * `cap`: a nyers érték felső határa ezen az órán.
 */
export function convectiveRisk(values: Pick<HourValues, 'capeJPerKg' | 'weatherCode'>): { readonly thunder: boolean; readonly cap: number } {
  const thunder = (values.weatherCode !== null && THUNDER_CODES.has(values.weatherCode)) || (values.capeJPerKg !== null && values.capeJPerKg >= THUNDER_CAPE)
  if (thunder) return { thunder, cap: 0.2 }
  if (values.capeJPerKg !== null && values.capeJPerKg >= UNSTABLE_CAPE) return { thunder, cap: 0.6 }
  return { thunder, cap: 1 }
}

/** Adat nélküli óra semleges értéke. */
export const UNKNOWN_RAW = 0.5
/** Ez alatt az óra bizonytalan (7.4). */
export const MARGINAL_RAW = 0.3

export interface HourAssessment {
  /** A növendék szerinti nyers érték (iskolai + növendéki limit). */
  readonly raw: number
  /** Az iskolai minimum sérül: 0–2 napon belül kizáró. */
  readonly schoolViolated: boolean
  readonly studentViolated: boolean
  readonly rating: HourRating
  readonly hasData: boolean
  /** Zivatarveszély (H19). */
  readonly thunderRisk: boolean
}

export function assessHour(values: HourValues, school: WeatherLimits, student: WeatherLimits): HourAssessment {
  const schoolMargin = margin(values, school)
  const combined = margin(values, combineLimits(school, student))
  const hasData = combined.raw !== null || schoolMargin.raw !== null
  const risk = convectiveRisk(values)
  const raw = Math.min(combined.raw ?? UNKNOWN_RAW, hasData ? risk.cap : 1)
  const rating: HourRating = schoolMargin.violated
    ? 'unflyable'
    : combined.violated || raw < MARGINAL_RAW || !hasData
      ? 'marginal'
      : 'flyable'
  return { raw, schoolViolated: schoolMargin.violated, studentViolated: combined.violated, rating, hasData, thunderRisk: risk.thunder }
}

/**
 * Az előrejelzés megbízhatósága a távolság szerint (súlyozási dokumentum 3. fejezet):
 * 0–2 nap 1,0; 3–5 nap 0,6; 6 naptól 0,3.
 */
export function forecastReliability(leadDays: number): number {
  if (leadDays <= 2) return 1
  if (leadDays <= 5) return 0.6
  return 0.3
}
