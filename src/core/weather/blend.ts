import type { WeatherHour } from '../model/snapshot'
import { leadBucket, type SkillGroup, type SkillWeights } from './skill'

/**
 * A tervezés előrejelzése: a modellek pontosság szerint súlyozott együttese (ADT-07).
 *
 * - Folytonos értékek (hőmérséklet, szél, lökés, csapadék, CAPE, alacsony felhőzet):
 *   súlyozott átlag.
 * - Szélirány: súlyozott vektorátlag (a 350° és a 10° átlaga 0°, nem 180°).
 * - Látás, felhőalap (plafon) és időjárás-kód: súlyozott medián, hogy egyetlen modell köde
 *   vagy zivatarkódja ne döntsön egyedül, de a modellek többsége igen.
 *
 * Minden változónál csak az adatot adó modellek számítanak, a súlyuk újranormálva; az órát
 * előrejelző modellek a `sources`-ban vannak.
 */

/** Egy modell órái (a sikertelen modell üres listával vagy kihagyva). */
export interface BlendInput {
  readonly model: string
  readonly hours: readonly WeatherHour[]
}

type Getter = (h: WeatherHour) => number | null | undefined

interface Weighted {
  readonly value: number
  readonly weight: number
}

function collect(entries: readonly { readonly hour: WeatherHour; readonly weight: (g: SkillGroup | 'overall') => number }[], get: Getter, group: SkillGroup | 'overall'): Weighted[] {
  const out: Weighted[] = []
  for (const e of entries) {
    const v = get(e.hour)
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    const w = e.weight(group)
    if (w > 0) out.push({ value: v, weight: w })
  }
  return out
}

export function weightedMean(values: readonly Weighted[]): number | null {
  const total = values.reduce((s, v) => s + v.weight, 0)
  return total > 0 ? values.reduce((s, v) => s + v.value * v.weight, 0) / total : null
}

/**
 * Súlyozott medián: a legkisebb érték, amelyig a súlyok összege eléri a felét. Ha pontosan a
 * felénél vált, a két szomszéd átlaga (két egyenlő súlyú modellnél a kettő közepe).
 */
export function weightedMedian(values: readonly Weighted[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a.value - b.value)
  const total = sorted.reduce((s, v) => s + v.weight, 0)
  if (total <= 0) return null
  let acc = 0
  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i]!.weight
    if (Math.abs(acc - total / 2) < 1e-9 * total && i + 1 < sorted.length) return (sorted[i]!.value + sorted[i + 1]!.value) / 2
    if (acc > total / 2) return sorted[i]!.value
  }
  return sorted[sorted.length - 1]!.value
}

function weightedDirection(entries: readonly { readonly hour: WeatherHour; readonly weight: (g: SkillGroup | 'overall') => number }[]): number | null {
  let x = 0
  let y = 0
  let any = false
  for (const e of entries) {
    const dir = e.hour.windDirectionDeg
    if (dir === null) continue
    const w = e.weight('wind') * Math.max(1, e.hour.windSpeedKt ?? 1)
    x += w * Math.sin((dir * Math.PI) / 180)
    y += w * Math.cos((dir * Math.PI) / 180)
    any = true
  }
  if (!any || (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9)) return null
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
}

const round = (v: number | null, digits: number): number | null => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits)

export interface BlendedHour extends WeatherHour {
  /** Az órára adatot adó modellek. */
  readonly sources?: readonly string[]
}

/**
 * Az órák súlyozott együttese. `weights`: a {@link skillWeights} eredménye; a sávot az óra és a
 * `nowMs` különbsége adja. Az az óra, amelyre egyetlen modell sem ad adatot, kimarad.
 */
export function blendForecasts(inputs: readonly BlendInput[], weights: SkillWeights, nowMs: number): BlendedHour[] {
  const byTime = new Map<string, { hour: WeatherHour; model: string }[]>()
  for (const input of inputs) {
    for (const hour of input.hours) {
      if (hour.temperatureC === null && hour.windSpeedKt === null && hour.windGustKt === null) continue
      const list = byTime.get(hour.time) ?? []
      list.push({ hour, model: input.model })
      byTime.set(hour.time, list)
    }
  }
  const result: BlendedHour[] = []
  for (const [time, list] of [...byTime.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const bucket = leadBucket(Date.parse(time) - nowMs)
    const entries = list.map(({ hour, model }) => {
      const w = weights[model]?.[bucket]
      return { hour, weight: (g: SkillGroup | 'overall'): number => (w ? (g === 'overall' ? w.overall : w.byGroup[g]) : 1) }
    })
    const mean = (get: Getter, group: SkillGroup | 'overall', digits = 1): number | null => round(weightedMean(collect(entries, get, group)), digits)
    const median = (get: Getter, group: SkillGroup | 'overall'): number | null => weightedMedian(collect(entries, get, group))
    const code = median((h) => h.weatherCode, 'overall')
    const ceiling = median((h) => h.ceilingFt, 'ceiling')
    result.push({
      time,
      temperatureC: mean((h) => h.temperatureC, 'temperature'),
      dewPointC: mean((h) => h.dewPointC, 'temperature'),
      windSpeedKt: mean((h) => h.windSpeedKt, 'wind'),
      windDirectionDeg: round(weightedDirection(entries), 0),
      windGustKt: mean((h) => h.windGustKt, 'gust'),
      visibilityM: round(median((h) => h.visibilityM, 'visibility'), 0),
      cloudCoverLowPct: mean((h) => h.cloudCoverLowPct, 'overall', 0),
      precipitationMm: mean((h) => h.precipitationMm, 'overall', 2),
      precipitationProbabilityPct: mean((h) => h.precipitationProbabilityPct, 'overall', 0),
      capeJPerKg: mean((h) => h.capeJPerKg, 'overall', 0),
      weatherCode: code === null ? null : Math.round(code),
      ceilingFt: ceiling === null ? null : Math.round(ceiling),
      sources: list.map((x) => x.model),
    })
  }
  return result
}
