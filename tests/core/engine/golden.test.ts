import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS } from '../../../src/core/config/defaults'
import type { Criterion } from '../../../src/core/model/criteria'
import {
  advantage,
  badWeatherFitScore,
  dayOrderScore,
  instructorLoadScore,
  continuityScore,
  longNoFlyScore,
  preferredAircraftScore,
  preferredClassroomScore,
  priorityScore,
  reserveScore,
  scarcityScore,
  stabilityScore,
  weatherFlightScore,
  type SubScores,
} from '../../../src/core/engine/scoring'

/**
 * Aranytesztek a súlyozási dokumentum (Foglalási feltételek súlyozása) példáira.
 * A terv vasárnap készül: hétfő 1, kedd 2, szerda 3, csütörtök 4, szombat 6 napra van.
 * Hétköznap-index: hétfő 0 … vasárnap 6.
 */
const MON = 0
const TUE = 1
const WED = 2
const THU = 3
const SAT = 5
const lead = (weekday: number): number => weekday + 1
const THRESHOLD = 10

const r2 = (x: number): number => Math.round(x * 100) / 100

describe('részpontok a dokumentum 3. fejezetének példáival', () => {
  it('időjárás: nyers 0,9 két napra 0,90, négy napra 0,74, hat napra 0,62', () => {
    expect(r2(weatherFlightScore(0.9, 2))).toBe(0.9)
    expect(r2(weatherFlightScore(0.9, 4))).toBe(0.74)
    expect(r2(weatherFlightScore(0.9, 6))).toBe(0.62)
  })

  it('rossz idő illesztése: nyers 0,1 két napra 0,90, hat napra 0,62', () => {
    expect(r2(badWeatherFitScore(0.1, 2))).toBe(0.9)
    expect(r2(badWeatherFitScore(0.1, 6))).toBe(0.62)
  })

  it('régen repült: 13 nap csütörtök 0,68, szokatlan gépen 0,34; 5 nap csütörtök 0,14', () => {
    expect(r2(longNoFlyScore(13, 14, THU, 'preferred'))).toBe(0.68)
    expect(r2(longNoFlyScore(13, 14, THU, 'sameType'))).toBe(0.34)
    expect(r2(longNoFlyScore(5, 14, THU, 'preferred'))).toBe(0.14)
    expect(longNoFlyScore(3, 14, MON, 'preferred')).toBe(0)
    expect(r2(longNoFlyScore(20, 14, TUE, 'other'))).toBe(0.23)
  })

  it('szűkösség: nincs más hely 1,0; három másik hely 0,4', () => {
    expect(scarcityScore(0)).toBe(1)
    expect(r2(scarcityScore(3))).toBe(0.4)
    expect(scarcityScore(7)).toBe(0)
  })

  it('gépóra-tartalék: 3 óra 0,12; 6 óra 0,50; 15 óra 1,0 (2 órás minimummal)', () => {
    expect(r2(reserveScore(3, 2))).toBe(0.13)
    expect(reserveScore(3, 2)).toBeCloseTo(0.125)
    expect(reserveScore(6, 2)).toBe(0.5)
    expect(reserveScore(15, 2)).toBe(1)
  })

  it('a többi részpont', () => {
    expect([dayOrderScore(0), dayOrderScore(1), dayOrderScore(-2), dayOrderScore(undefined)]).toEqual([1, 0.5, 0, 1])
    expect([preferredAircraftScore('preferred'), preferredAircraftScore('sameType'), preferredAircraftScore('other')]).toEqual([1, 0.6, 0.2])
    expect([instructorLoadScore(4), instructorLoadScore(6), instructorLoadScore(8)]).toEqual([1, 0.5, 0])
    // Folyamatos program: fél óra szünetig 1, 3 óránál 0; aznapi más foglalás nélkül 1.
    expect([continuityScore(0), continuityScore(30), continuityScore(105), continuityScore(180), continuityScore(300), continuityScore(undefined)]).toEqual([1, 1, 0.5, 0, 0, 1])
    expect([stabilityScore('unchanged'), stabilityScore('sameDayNear'), stabilityScore('sameDayFar'), stabilityScore('otherDay')]).toEqual([1, 0.6, 0.3, 0])
    expect([preferredClassroomScore(true), preferredClassroomScore(false)]).toEqual([1, 0.5])
    expect([priorityScore(5), priorityScore(3), priorityScore(1)]).toEqual([1, 0.5, 0])
  })
})

interface Example {
  readonly id: string
  readonly a: SubScores
  readonly b: SubScores
  /** A dokumentumban közölt előny, egy tizedesre. */
  readonly expected: number
  /** Egy igény több hely: a nagyobb nyer. Két igény egy hely: a küszöb alatt dilemma. */
  readonly decision: 'A' | 'B' | 'dilemma'
}

const examples: Example[] = [
  // 5.1 Egy igény, több lehetséges hely
  { id: 'E1', a: { weatherFlight: weatherFlightScore(0.3, lead(TUE)), preferredAircraft: 1 }, b: { weatherFlight: weatherFlightScore(0.9, lead(TUE)), preferredAircraft: 0.6 }, expected: -40, decision: 'B' },
  {
    id: 'E2',
    a: { weatherFlight: weatherFlightScore(0.3, lead(MON)), longNoFly: longNoFlyScore(13, 14, MON, 'preferred') },
    b: { weatherFlight: weatherFlightScore(0.9, lead(WED)), longNoFly: longNoFlyScore(13, 14, WED, 'preferred') },
    expected: -27.5,
    decision: 'B',
  },
  {
    id: 'E3',
    a: { weatherFlight: weatherFlightScore(0.7, lead(MON)), longNoFly: longNoFlyScore(13, 14, MON, 'preferred') },
    b: { weatherFlight: weatherFlightScore(0.9, lead(WED)), longNoFly: longNoFlyScore(13, 14, WED, 'preferred') },
    expected: 8.5,
    decision: 'A',
  },
  { id: 'E4', a: { aircraftReserve: reserveScore(3, 2), preferredAircraft: 1 }, b: { aircraftReserve: reserveScore(15, 2), preferredAircraft: 0.6 }, expected: -29.8, decision: 'B' },
  { id: 'E5', a: { weatherFlight: weatherFlightScore(0.9, lead(TUE)), aircraftReserve: reserveScore(3, 2) }, b: { weatherFlight: weatherFlightScore(0.3, lead(TUE)), aircraftReserve: reserveScore(15, 2) }, expected: 10.3, decision: 'A' },
  { id: 'E6', a: { dayOrder: dayOrderScore(0), weatherFlight: weatherFlightScore(0.5, lead(TUE)) }, b: { dayOrder: dayOrderScore(2), weatherFlight: weatherFlightScore(0.9, lead(TUE)) }, expected: -6, decision: 'B' },
  {
    id: 'E7',
    a: { weatherFlight: weatherFlightScore(0.8, lead(TUE)), longNoFly: longNoFlyScore(13, 14, TUE, 'preferred'), instructorLoad: instructorLoadScore(8) },
    b: { weatherFlight: weatherFlightScore(0.8, lead(WED)), longNoFly: longNoFlyScore(13, 14, WED, 'preferred'), instructorLoad: instructorLoadScore(4) },
    expected: -13.1,
    decision: 'B',
  },
  // 5.2 Két igény, egy hely
  {
    id: 'E9',
    a: { longNoFly: longNoFlyScore(13, 14, THU, 'sameType'), preferredAircraft: 0.6, dayOrder: dayOrderScore(1) },
    b: { longNoFly: longNoFlyScore(5, 14, THU, 'preferred'), preferredAircraft: 1, dayOrder: dayOrderScore(0) },
    expected: -12.6,
    decision: 'B',
  },
  { id: 'E10', a: { scarcity: scarcityScore(0), weatherFlight: weatherFlightScore(0.3, lead(MON)) }, b: { scarcity: scarcityScore(5), weatherFlight: weatherFlightScore(0.8, lead(MON)) }, expected: 25, decision: 'A' },
  { id: 'E11', a: { longNoFly: longNoFlyScore(5, 14, WED, 'preferred'), scarcity: scarcityScore(0) }, b: { longNoFly: longNoFlyScore(13, 14, WED, 'preferred'), scarcity: scarcityScore(3) }, expected: -6.5, decision: 'dilemma' },
  { id: 'E12', a: { longNoFly: longNoFlyScore(12, 14, THU, 'preferred') }, b: { longNoFly: longNoFlyScore(11, 14, THU, 'preferred') }, expected: 5.5, decision: 'dilemma' },
  {
    id: 'E13',
    a: { longNoFly: longNoFlyScore(20, 14, TUE, 'sameType'), preferredAircraft: 0.6 },
    b: { longNoFly: longNoFlyScore(12, 14, TUE, 'preferred'), preferredAircraft: 1 },
    expected: -37.3,
    decision: 'B',
  },
  { id: 'E20', a: { priority: priorityScore(5), longNoFly: longNoFlyScore(5, 14, THU, 'preferred') }, b: { priority: priorityScore(1), longNoFly: longNoFlyScore(13, 14, THU, 'preferred') }, expected: 21.4, decision: 'A' },
  { id: 'E21', a: { priority: priorityScore(4), longNoFly: longNoFlyScore(5, 14, THU, 'preferred') }, b: { priority: priorityScore(3), longNoFly: longNoFlyScore(13, 14, THU, 'preferred') }, expected: -27.4, decision: 'B' },
  {
    id: 'E22',
    a: { priority: priorityScore(4), preferredAircraft: 0.6, dayOrder: dayOrderScore(1) },
    b: { priority: priorityScore(1), preferredAircraft: 1, dayOrder: dayOrderScore(0) },
    expected: 19.8,
    decision: 'A',
  },
  { id: 'E23', a: { priority: priorityScore(5), scarcity: scarcityScore(5) }, b: { priority: priorityScore(1), scarcity: scarcityScore(0) }, expected: -5, decision: 'dilemma' },
  // 5.3 Elmélet és szimulátor
  { id: 'E14', a: { badWeatherFit: badWeatherFitScore(0.1, lead(TUE)), preferredClassroom: 0.5 }, b: { badWeatherFit: badWeatherFitScore(0.9, lead(TUE)), preferredClassroom: 1 }, expected: 46, decision: 'A' },
  { id: 'E15', a: { badWeatherFit: badWeatherFitScore(0.2, lead(TUE)) }, b: { badWeatherFit: badWeatherFitScore(0.1, lead(SAT)) }, expected: 12.6, decision: 'A' },
  // 5.4 Újratervezés: A a meglévő hely, B másik nap
  { id: 'E17', a: { planStability: 1, weatherFlight: weatherFlightScore(0.35, 3) }, b: { planStability: 0, weatherFlight: weatherFlightScore(0.85, 4) }, expected: 23, decision: 'A' },
  { id: 'E18', a: { planStability: 1, weatherFlight: weatherFlightScore(0.2, 1) }, b: { planStability: 0, weatherFlight: weatherFlightScore(0.9, 2) }, expected: -13, decision: 'B' },
  { id: 'E19', a: { planStability: 1, weatherFlight: weatherFlightScore(0.55, 1) }, b: { planStability: 0, weatherFlight: weatherFlightScore(0.9, 2) }, expected: 18.5, decision: 'A' },
]

const twoRequestExamples = new Set(['E9', 'E10', 'E11', 'E12', 'E13', 'E20', 'E21', 'E22', 'E23'])

describe('a súlyozási dokumentum kidolgozott példái (5. fejezet)', () => {
  it.each(examples.map((e) => [e.id, e] as const))('%s', (_id, example) => {
    const criteria = [...new Set([...Object.keys(example.a), ...Object.keys(example.b)])] as Criterion[]
    const adv = advantage(example.a, example.b, criteria, DEFAULT_WEIGHTS)
    expect(Math.round(adv * 10) / 10).toBeCloseTo(example.expected, 0)
    expect(Math.abs(adv - example.expected)).toBeLessThan(0.15)

    const decision = twoRequestExamples.has(example.id) && Math.abs(adv) < THRESHOLD ? 'dilemma' : adv > 0 ? 'A' : 'B'
    expect(decision).toBe(example.decision)
  })

  it('a 7. fejezet táblázata: a 10 egységes küszöbbel csak E11, E12, E23 dilemma', () => {
    const dilemmas = examples.filter((e) => twoRequestExamples.has(e.id) && Math.abs(e.expected) < THRESHOLD).map((e) => e.id)
    expect(dilemmas).toEqual(['E11', 'E12', 'E23'])
  })
})
