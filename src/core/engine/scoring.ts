import type { Criterion, Weights } from '../model/criteria'
import type { RequestKind, ScoreFactor } from '../model/planning'
import { forecastReliability } from '../weather/rating'

/**
 * Részpontok (súlyozási dokumentum 3. fejezet). Minden függvény 0 és 1 közötti értéket ad.
 * A paraméterek a dokumentum alapértékei; a múltbeli hetek visszajátszása hangolja őket.
 */

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Időjárás repülésnél: 0,5 + megbízhatóság × (nyers − 0,5). */
export function weatherFlightScore(raw: number, leadDays: number): number {
  return clamp01(0.5 + forecastReliability(leadDays) * (raw - 0.5))
}

/** Rossz idő illesztése elméletnél és szimulátornál: 0,5 + megbízhatóság × ((1 − nyers) − 0,5). */
export function badWeatherFitScore(raw: number, leadDays: number): number {
  return clamp01(0.5 + forecastReliability(leadDays) * (1 - raw - 0.5))
}

/** Sürgősség: 3 napig 0, a küszöbig (alapból 14 nap) egyenletesen nő 1-ig. */
export function urgency(daysSinceLastFlight: number, thresholdDays: number): number {
  const start = 3
  if (thresholdDays <= start) return daysSinceLastFlight >= thresholdDays ? 1 : 0
  return clamp01((daysSinceLastFlight - start) / (thresholdDays - start))
}

/** Korai időpont: hétfőn 1, vasárnap 0 (0 = hétfő … 6 = vasárnap). */
export function earlyFactor(weekdayIndex: number): number {
  return clamp01((6 - weekdayIndex) / 6)
}

/** Hogyan viszonyul a gép a növendék preferenciájához (NOV-04). */
export type Familiarity = 'preferred' | 'sameType' | 'other' | 'noPreference'

/**
 * Régen repült növendék: sürgősség × (0,5 + 0,5 × korai időpont). Nem preferált gépen a
 * részpont szorzódik: azonos típus × 0,5, egyéb engedélyezett gép × 0,25.
 */
export function longNoFlyScore(daysSinceLastFlight: number, thresholdDays: number, weekdayIndex: number, familiarity: Familiarity): number {
  const multiplier = familiarity === 'sameType' ? 0.5 : familiarity === 'other' ? 0.25 : 1
  return urgency(daysSinceLastFlight, thresholdDays) * (0.5 + 0.5 * earlyFactor(weekdayIndex)) * multiplier
}

/** Szűkösség: 1 − (a héten maradó elfogadható helyek / 5), legalább 0. */
export function scarcityScore(alternatives: number): number {
  return clamp01(1 - alternatives / 5)
}

/** Gépóra-tartalék: a minimumtól 8 órán át egyenletesen nő 1-ig. A minimum alatt kizáró (külön szűrés). */
export function reserveScore(remainingHours: number, minReserveHours: number): number {
  return clamp01((remainingHours - minReserveHours) / 8)
}

/** Időbeli sorrend: a preferált helyen 1, egy pozícióval odébb 0,5, távolabb 0; sorrend nélkül 1. */
export function dayOrderScore(positionOffset: number | undefined): number {
  if (positionOffset === undefined) return 1
  const offset = Math.abs(positionOffset)
  return offset === 0 ? 1 : offset === 1 ? 0.5 : 0
}

/** Preferált gép 1, azonos típus 0,6, egyéb engedélyezett gép 0,2; preferencia nélkül 1. */
export function preferredAircraftScore(familiarity: Familiarity): number {
  return familiarity === 'sameType' ? 0.6 : familiarity === 'other' ? 0.2 : 1
}

/**
 * Kevesebb motorpróba: 1, ha a gép aznap már repül (meglévő vagy tervezett foglalással), így
 * ez a foglalás nem nyit új gépnapot; 0, ha a gép aznap ezzel a foglalással repülne először,
 * és a napi motorpróba miatt hosszabb a briefing (SZB-05).
 */
export function avoidFirstFlightScore(aircraftAlreadyFliesThatDay: boolean): number {
  return aircraftAlreadyFliesThatDay ? 1 : 0
}

/** Oktató napi terhelése: a nap foglalt ideje a foglalással együtt, 4 óráig 1, 8 óránál 0. */
export function instructorLoadScore(dayHours: number): number {
  return clamp01((8 - dayHours) / 4)
}

/** Ennyi szünet a nap más foglalásaitól még teljes értékű (fordulóidő, átállás). */
export const CONTINUITY_FREE_MINUTES = 30
/** Ekkora szünetnél a folyamatosság részpontja már 0. */
export const CONTINUITY_ZERO_MINUTES = 180

/**
 * Folyamatos oktatói program: a foglalás és az oktató aznapi legközelebbi másik foglalása
 * közötti szünet. Fél óráig 1, 3 óránál 0, közte egyenletesen csökken. Ha az oktatónak aznap
 * nincs más foglalása, a foglalás nem nyit szünetet: 1 (hogy melyik napra kerüljön, azt a
 * napi terhelés dönti el).
 */
export function continuityScore(gapMinutes: number | undefined): number {
  if (gapMinutes === undefined) return 1
  return clamp01((CONTINUITY_ZERO_MINUTES - gapMinutes) / (CONTINUITY_ZERO_MINUTES - CONTINUITY_FREE_MINUTES))
}

/** Terv stabilitása: változatlan 1, azonos nap ≤ 2 óra eltéréssel 0,6, azonos nap 0,3, másik nap 0. */
export function stabilityScore(change: 'unchanged' | 'sameDayNear' | 'sameDayFar' | 'otherDay'): number {
  return { unchanged: 1, sameDayNear: 0.6, sameDayFar: 0.3, otherDay: 0 }[change]
}

/** Preferált terem 1, más megfelelő terem 0,5. */
export function preferredClassroomScore(preferred: boolean): number {
  return preferred ? 1 : 0.5
}

/**
 * Megfelelő teremméret: a legkisebb, a résztvevőknek elég terem 1; a nagyobb terem a
 * legkisebb megfelelő és a saját férőhelye arányában kevesebb (például 8 helyett 20 fős
 * terem: 0,4). Ismeretlen férőhelynél 0,5.
 */
export function classroomSizeScore(capacity: number | undefined, smallestFittingCapacity: number | undefined): number {
  if (capacity === undefined || smallestFittingCapacity === undefined || capacity <= 0) return 0.5
  return clamp01(smallestFittingCapacity / capacity)
}

/** Foglalási prioritás: (prioritás − 1) / 4 az 1–5-ös skálán. */
export function priorityScore(priority: number): number {
  return clamp01((priority - 1) / 4)
}

/**
 * Tevékenységenként pontozott feltételek (súlyozási dokumentum 2.1: az alapsúlyok összege
 * repülésnél 520 a „kevesebb motorpróba” és a „folyamatos oktatói program” feltétellel,
 * újratervezéskor 570, elméletnél 190 a „megfelelő teremméret” feltétellel). Más tevékenységek
 * között szabály dönt, nem súly (2.3).
 */
export const CRITERIA_BY_KIND: Readonly<Record<RequestKind, readonly Criterion[]>> = {
  flight: ['weatherFlight', 'longNoFly', 'scarcity', 'priority', 'aircraftReserve', 'preferredAircraft', 'avoidFirstFlight', 'dayOrder', 'instructorLoad', 'instructorContinuity'],
  simulator: ['badWeatherFit', 'scarcity', 'priority', 'dayOrder', 'instructorLoad', 'instructorContinuity'],
  theory: ['badWeatherFit', 'preferredClassroom', 'classroomSize', 'instructorLoad', 'instructorContinuity'],
}

export function criteriaFor(kind: RequestKind, replanning: boolean): readonly Criterion[] {
  const base = CRITERIA_BY_KIND[kind]
  return replanning ? [...base, 'planStability'] : base
}

export type SubScores = Partial<Record<Criterion, number>>

export interface WeightedResult {
  /** Súlyozott átlag 0 és 100 között (7.3). */
  readonly score: number
  /** Σ súly × részpont, súlyozott egységben (súlyozási dokumentum 2.). */
  readonly weightedSum: number
  readonly factors: readonly ScoreFactor[]
}

export function weigh(subScores: SubScores, criteria: readonly Criterion[], weights: Weights): WeightedResult {
  let sum = 0
  let total = 0
  const factors: ScoreFactor[] = []
  for (const criterion of criteria) {
    const subScore = subScores[criterion]
    if (subScore === undefined) continue
    const weight = weights[criterion]
    sum += weight * subScore
    total += weight
    factors.push({ criterion, weight, subScore })
  }
  return { score: total === 0 ? 0 : (100 * sum) / total, weightedSum: sum, factors }
}

/** Két lehetőség súlyozott előnye: Σ w × (sA − sB). Pozitív = A nyer. */
export function advantage(a: SubScores, b: SubScores, criteria: readonly Criterion[], weights: Weights): number {
  let total = 0
  for (const criterion of criteria) {
    const sa = a[criterion]
    const sb = b[criterion]
    if (sa === undefined || sb === undefined) continue
    total += weights[criterion] * (sa - sb)
  }
  return total
}

/** A „Miért ide?” magyarázat legnagyobb hatású feltételei: súly × részpont szerint. */
export function topFactors(factors: readonly ScoreFactor[], count = 3): ScoreFactor[] {
  return [...factors].sort((a, b) => b.weight * b.subScore - a.weight * a.subScore || a.criterion.localeCompare(b.criterion)).slice(0, count)
}
