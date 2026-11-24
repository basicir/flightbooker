import type { WeatherHour } from '../model/snapshot'
import { DAY_MS, HOUR_MS } from '../time/zoned'
import { MAX_OBSERVED_VISIBILITY_M, type Observation } from './metar'

/**
 * A modellek mért pontossága a bázis METAR-jához (ADT-07): a letöltött előrejelzéseket
 * eltesszük, és amikor az óra elmúlt, összevetjük a megfigyeléssel. A súly a hiba
 * négyzetének fordítottja, előrejelzési távolságonként és változócsoportonként.
 *
 * Kevés mérésnél az induló (irodalmi) súly dominál: a mért négyzetes hibát {@link PRIOR_HOURS}
 * órányi „képzelt” mérés húzza az induló értékhez, így a súly fokozatosan vált át.
 * Tiszta függvények; a tárolás és a hálózat a főfolyamatban van.
 */

/** A pontosság változócsoportjai. A többi változó (csapadék, CAPE …) az átlagos súlyt kapja. */
export const SKILL_GROUPS = ['wind', 'gust', 'visibility', 'ceiling', 'temperature'] as const
export type SkillGroup = (typeof SKILL_GROUPS)[number]

/** Előrejelzési távolság-sávok órában: [0,24), [24,48), [48,72), [72,120), [120,∞). */
export const LEAD_BUCKET_STARTS_H = [0, 24, 48, 72, 120] as const
export const LEAD_BUCKET_LABELS = ['0–1 nap', '1–2 nap', '2–3 nap', '3–5 nap', '5+ nap'] as const

export function leadBucket(leadMs: number): number {
  const h = Math.max(0, leadMs) / HOUR_MS
  let b = 0
  for (let i = 0; i < LEAD_BUCKET_STARTS_H.length; i++) if (h >= LEAD_BUCKET_STARTS_H[i]!) b = i
  return b
}

/** Ennyi órányi mérés után a mért és az induló súly egyenlő arányban számít. */
export const PRIOR_HOURS = 72
/** A súlyhoz az utolsó ennyi nap mérése számít (az évszak és a modellváltás miatt). */
export const SKILL_WINDOW_DAYS = 30
/** Ennél régebben elmúlt, megfigyelés nélküli óra nem vár tovább a mérésre. */
export const VERIFY_GRACE_MS = 2 * DAY_MS
/** Ennél távolabbi órát nem mérünk (a sávok vége). */
export const MAX_LEAD_MS = 8 * DAY_MS

/** Tipikus négyzetes hiba csoportonként (a skála: kt, kt, km, ezer láb, °C). */
const REFERENCE_MSE: Readonly<Record<SkillGroup, number>> = { wind: 9, gust: 25, visibility: 9, ceiling: 2.25, temperature: 4 }

/**
 * Induló relatív pontosság modellenként és sávonként (1 = átlagos). A nagy felbontású helyi
 * modellek (DMI HARMONIE, ICON-D2/EU) az első két napon jobbak, az ECMWF a középtávon.
 * Csak induló érték: a METAR-mérés fokozatosan felülírja.
 */
export const PRIOR_SKILL: Readonly<Record<string, readonly number[]>> = {
  icon_d2: [1.3, 1.2, 1, 1, 1],
  dmi_seamless: [1.3, 1.2, 1, 1, 1],
  icon_eu: [1.2, 1.15, 1.1, 1, 1],
  icon_global: [1, 1, 1, 1, 1],
  ecmwf_ifs025: [1, 1.05, 1.1, 1.2, 1.25],
  gfs_seamless: [0.85, 0.85, 0.9, 0.9, 0.95],
  ukmo_seamless: [1, 1, 1.05, 1.05, 1.05],
  meteofrance_seamless: [1.05, 1, 1, 1, 1],
}

const priorSkill = (model: string, bucket: number): number => PRIOR_SKILL[model]?.[bucket] ?? 1

/** Egy archivált óra a méréshez szükséges értékekkel. */
export interface VerifiableHour {
  readonly time: string
  readonly windKt: number | null
  readonly gustKt: number | null
  readonly visibilityM: number | null
  readonly ceilingFt: number | null
  readonly temperatureC: number | null
}

/** Egy modell egy letöltése, a még nem mért órákkal. */
export interface ArchivedForecast {
  readonly model: string
  readonly issuedAt: string
  readonly hours: readonly VerifiableHour[]
}

/** Napi összesítés: modell, sáv, csoport és nap szerint a mérések száma és a négyzetes hiba összege. */
export interface SkillDay {
  readonly model: string
  readonly bucket: number
  readonly group: SkillGroup
  /** A mért óra napja (UTC, YYYY-MM-DD). */
  readonly date: string
  readonly n: number
  readonly sse: number
}

const round1 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10) / 10)

/** Egy modell óráiból a méréshez eltett rész: csak a jövőbeli, {@link MAX_LEAD_MS}-en belüli órák. */
export function toArchived(model: string, issuedAt: string, hours: readonly WeatherHour[]): ArchivedForecast {
  const issuedMs = Date.parse(issuedAt)
  return {
    model,
    issuedAt,
    hours: hours
      .filter((h) => {
        const ms = Date.parse(h.time)
        return ms > issuedMs && ms - issuedMs <= MAX_LEAD_MS && (h.windSpeedKt !== null || h.visibilityM !== null || h.temperatureC !== null)
      })
      .map((h) => ({
        time: h.time,
        windKt: round1(h.windSpeedKt),
        gustKt: round1(h.windGustKt),
        visibilityM: h.visibilityM === null ? null : Math.round(h.visibilityM),
        ceilingFt: typeof h.ceilingFt === 'number' ? Math.round(h.ceilingFt) : null,
        temperatureC: round1(h.temperatureC),
      })),
  }
}

/** Egy modellből tervezési időszakonként (12 óra) egy letöltés marad: a legfrissebb. */
export const ARCHIVE_SLOT_MS = 12 * HOUR_MS

/** Új letöltések felvétele az archívumba; ugyanabban az időszakban a régebbit felváltja. */
export function addToArchive(archive: readonly ArchivedForecast[], added: readonly ArchivedForecast[]): ArchivedForecast[] {
  const slot = (f: ArchivedForecast): string => `${f.model}|${Math.floor(Date.parse(f.issuedAt) / ARCHIVE_SLOT_MS)}`
  const bySlot = new Map<string, ArchivedForecast>()
  for (const f of [...archive, ...added]) {
    if (f.hours.length === 0) continue
    const prev = bySlot.get(slot(f))
    if (!prev || Date.parse(f.issuedAt) >= Date.parse(prev.issuedAt)) bySlot.set(slot(f), f)
  }
  return [...bySlot.values()].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt) || a.model.localeCompare(b.model))
}

/**
 * A csoport hibája egy órán, a súly skáláján (kt, kt, km, ezer láb, °C); `null`, ha a
 * modell vagy a megfigyelés nem ad értéket. A látás 10 km-nél, a plafon 5000 lábnál
 * levágva: e fölött a tervezésnek mindegy, és a METAR sem különbözteti meg.
 */
export function groupError(group: SkillGroup, f: VerifiableHour, o: Observation): number | null {
  const diff = (a: number | null, b: number | null): number | null => (a === null || b === null ? null : a - b)
  switch (group) {
    case 'wind':
      return diff(f.windKt, o.windKt)
    case 'gust':
      return diff(f.gustKt, o.gustKt)
    case 'visibility': {
      const cap = (v: number | null): number | null => (v === null ? null : Math.min(MAX_OBSERVED_VISIBILITY_M, v) / 1000)
      return diff(cap(f.visibilityM), cap(o.visibilityM))
    }
    case 'ceiling': {
      if (f.ceilingFt === null) return null
      const cap = (v: number | null): number => Math.min(5000, v ?? 5000) / 1000
      return cap(f.ceilingFt) - cap(o.ceilingFt)
    }
    case 'temperature':
      return diff(f.temperatureC, o.temperatureC)
  }
}

/** A mérési napló ennyi napot őriz (a felületen látható METAR-ok és modellértékek). */
export const LOG_DAYS = 7

/** Egy modell előrejelzése a mért órára: a legfrissebb (legrövidebb távú) letöltéséből. */
export interface LoggedForecast {
  readonly model: string
  readonly issuedAt: string
  readonly windKt: number | null
  readonly gustKt: number | null
  readonly visibilityM: number | null
  readonly ceilingFt: number | null
  readonly temperatureC: number | null
}

/** A mérési napló egy órája: a METAR-megfigyelés és a modellek előrejelzése rá. */
export interface VerificationLogHour {
  readonly time: string
  readonly observation: Observation
  readonly forecasts: readonly LoggedForecast[]
}

export interface VerifyResult {
  readonly archive: ArchivedForecast[]
  readonly stats: SkillDay[]
  /** Ennyi modellórát mértünk most. */
  readonly verifiedHours: number
  /** A mérési napló az utolsó {@link LOG_DAYS} napra, idő szerint. */
  readonly log: VerificationLogHour[]
}

/**
 * A napló bővítése: óránként a megfigyelés és modellenként a legfrissebb előrejelzés marad;
 * a {@link LOG_DAYS}-nál régebbi órák kikerülnek.
 */
export function mergeLog(log: readonly VerificationLogHour[], added: readonly VerificationLogHour[], nowMs: number): VerificationLogHour[] {
  const byTime = new Map<string, { observation: Observation; forecasts: Map<string, LoggedForecast> }>()
  for (const h of [...log, ...added]) {
    const cur = byTime.get(h.time) ?? { observation: h.observation, forecasts: new Map<string, LoggedForecast>() }
    cur.observation = h.observation
    for (const f of h.forecasts) {
      const prev = cur.forecasts.get(f.model)
      if (!prev || Date.parse(f.issuedAt) > Date.parse(prev.issuedAt)) cur.forecasts.set(f.model, f)
    }
    byTime.set(h.time, cur)
  }
  const oldest = nowMs - LOG_DAYS * DAY_MS
  return [...byTime.entries()]
    .filter(([time]) => Date.parse(time) >= oldest)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, v]) => ({ time, observation: v.observation, forecasts: [...v.forecasts.values()].sort((a, b) => a.model.localeCompare(b.model)) }))
}

/**
 * A „talált” előrejelzés tűrése csoportonként, a súly skáláján (kt, kt, km, ezer láb, °C):
 * szél ±5 kt, lökés ±7 kt, látás ±2 km (10 km fölött mindegy), plafon ±500 ft (5000 ft fölött
 * mindegy), hőmérséklet ±2 °C.
 */
export const HIT_TOLERANCE: Readonly<Record<SkillGroup, number>> = { wind: 5, gust: 7, visibility: 2, ceiling: 0.5, temperature: 2 }

/** Talált-e a modell egy csoportban; `null`, ha nincs mit összevetni. */
export function isHit(group: SkillGroup, f: LoggedForecast, o: Observation): boolean | null {
  const e = groupError(group, { time: '', ...f }, o)
  return e === null ? null : Math.abs(e) <= HIT_TOLERANCE[group] + 1e-9
}

export interface HitRate {
  readonly hits: number
  readonly n: number
}

/** Modellenként és csoportonként a találatok a naplóban. */
export function hitRates(log: readonly VerificationLogHour[]): Record<string, Record<SkillGroup, HitRate>> {
  const out: Record<string, Record<SkillGroup, { hits: number; n: number }>> = {}
  for (const h of log) {
    for (const f of h.forecasts) {
      const m = (out[f.model] ??= Object.fromEntries(SKILL_GROUPS.map((g) => [g, { hits: 0, n: 0 }])) as Record<SkillGroup, { hits: number; n: number }>)
      for (const g of SKILL_GROUPS) {
        const hit = isHit(g, f, h.observation)
        if (hit === null) continue
        m[g].n++
        if (hit) m[g].hits++
      }
    }
  }
  return out
}

/**
 * Az elmúlt, megfigyeléssel rendelkező órák mérése: a hiba a napi összesítésbe kerül, az óra
 * kikerül az archívumból (egy óra csak egyszer számít). A megfigyelés nélkül
 * {@link VERIFY_GRACE_MS}-nél régebben elmúlt óra is kikerül.
 */
export function verifyArchive(
  archive: readonly ArchivedForecast[],
  observations: readonly Observation[],
  stats: readonly SkillDay[],
  nowMs: number,
  log: readonly VerificationLogHour[] = [],
): VerifyResult {
  const obs = new Map(observations.map((o) => [o.time, o]))
  const logged: VerificationLogHour[] = []
  const acc = new Map<string, { model: string; bucket: number; group: SkillGroup; date: string; n: number; sse: number }>()
  for (const s of stats) acc.set(`${s.model}|${s.bucket}|${s.group}|${s.date}`, { ...s })
  let verifiedHours = 0
  const nextArchive: ArchivedForecast[] = []
  for (const f of archive) {
    const issuedMs = Date.parse(f.issuedAt)
    const remaining: VerifiableHour[] = []
    for (const h of f.hours) {
      const ms = Date.parse(h.time)
      const o = obs.get(new Date(ms).toISOString())
      if (!o) {
        if (ms > nowMs - VERIFY_GRACE_MS) remaining.push(h)
        continue
      }
      verifiedHours++
      const { time: _time, ...values } = h
      logged.push({ time: o.time, observation: o, forecasts: [{ model: f.model, issuedAt: f.issuedAt, ...values }] })
      const bucket = leadBucket(ms - issuedMs)
      const date = new Date(ms).toISOString().slice(0, 10)
      for (const group of SKILL_GROUPS) {
        const e = groupError(group, h, o)
        if (e === null) continue
        const key = `${f.model}|${bucket}|${group}|${date}`
        const cur = acc.get(key) ?? { model: f.model, bucket, group, date, n: 0, sse: 0 }
        cur.n++
        cur.sse += e * e
        acc.set(key, cur)
      }
    }
    if (remaining.length > 0) nextArchive.push({ ...f, hours: remaining })
  }
  const oldest = new Date(nowMs - 2 * SKILL_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10)
  const nextStats = [...acc.values()]
    .filter((s) => s.date >= oldest)
    .map((s) => ({ ...s, sse: Math.round(s.sse * 1000) / 1000 }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.model.localeCompare(b.model) || a.bucket - b.bucket || a.group.localeCompare(b.group))
  return { archive: nextArchive, stats: nextStats, verifiedHours, log: mergeLog(log, logged, nowMs) }
}

/** Egy modell súlya egy sávban: csoportonként és átlagosan, a mérések számával. */
export interface ModelBucketWeight {
  readonly byGroup: Readonly<Record<SkillGroup, number>>
  /** A csoportsúlyok átlaga: a többi változóhoz (csapadék, CAPE, felhőzet …). */
  readonly overall: number
  /** Mért órák száma csoportonként. */
  readonly n: Readonly<Record<SkillGroup, number>>
  /** Négyzetes középhiba csoportonként (a súly skáláján); mérés nélkül `null`. */
  readonly rmse: Readonly<Record<SkillGroup, number | null>>
}

/** Modellenként és sávonként a (nem normált) súly. */
export type SkillWeights = Readonly<Record<string, readonly ModelBucketWeight[]>>

/**
 * Súlyok a napi összesítésből: `1 / mse`, ahol az mse a mért és az induló négyzetes hiba
 * keveréke (`(sse + PRIOR_HOURS · mse₀) / (n + PRIOR_HOURS)`, `mse₀ = referencia / pontosság²`).
 * Mérés nélkül tehát a súly az induló pontosság négyzetével arányos.
 */
export function skillWeights(stats: readonly SkillDay[], models: readonly string[], nowMs: number): SkillWeights {
  const from = new Date(nowMs - SKILL_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10)
  const sums = new Map<string, { n: number; sse: number }>()
  for (const s of stats) {
    if (s.date < from) continue
    const key = `${s.model}|${s.bucket}|${s.group}`
    const cur = sums.get(key) ?? { n: 0, sse: 0 }
    cur.n += s.n
    cur.sse += s.sse
    sums.set(key, cur)
  }
  const result: Record<string, ModelBucketWeight[]> = {}
  for (const model of models) {
    result[model] = LEAD_BUCKET_STARTS_H.map((_, bucket) => {
      const byGroup = {} as Record<SkillGroup, number>
      const n = {} as Record<SkillGroup, number>
      const rmse = {} as Record<SkillGroup, number | null>
      for (const group of SKILL_GROUPS) {
        const s = sums.get(`${model}|${bucket}|${group}`) ?? { n: 0, sse: 0 }
        const prior = REFERENCE_MSE[group] / priorSkill(model, bucket) ** 2
        const mse = (s.sse + PRIOR_HOURS * prior) / (s.n + PRIOR_HOURS)
        byGroup[group] = REFERENCE_MSE[group] / mse
        n[group] = s.n
        rmse[group] = s.n > 0 ? Math.sqrt(s.sse / s.n) : null
      }
      const overall = SKILL_GROUPS.reduce((sum, g) => sum + byGroup[g], 0) / SKILL_GROUPS.length
      return { byGroup, overall, n, rmse }
    })
  }
  return result
}

/** A felületnek: a súlyok és a mérés állapota. */
export interface ModelSkillSummary {
  readonly weights: SkillWeights
  /** Az ablakban (30 nap) mért modellórák száma (szél szerint). */
  readonly measuredHours: number
  /** A METAR-letöltés vagy a tárolás hibája; ekkor a korábbi mérés számít. */
  readonly error?: string
  /** Az utolsó {@link LOG_DAYS} nap mért órái: a METAR és a modellek előrejelzése rá. */
  readonly log?: readonly VerificationLogHour[]
}

/**
 * A modellek részesedése egy sávban (0–1, összesen 1) az átlagos súly szerint, csak az
 * `available` modellek között.
 */
export function bucketShares(weights: SkillWeights, bucket: number, available: readonly string[]): Record<string, number> {
  const raw = available.map((m) => [m, weights[m]?.[bucket]?.overall ?? 0] as const)
  const total = raw.reduce((s, [, w]) => s + w, 0)
  return Object.fromEntries(raw.map(([m, w]) => [m, total > 0 ? w / total : 0]))
}
