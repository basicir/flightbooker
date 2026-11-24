import { describe, expect, it } from 'vitest'
import { aircraftChoice, capacityFromName, prefillClassrooms, setAircraftChoice } from '../../../src/core/config/operations'
import { createDefaultSettings, DEFAULT_SCHOOL_MINIMA } from '../../../src/core/config/defaults'
import { matchingWeatherPreset, phaseLimitRule, TM_WEATHER_PRESETS } from '../../../src/core/config/trainingManual'
import { LimitLedger, checkLimitsWith, type LimitActivity } from '../../../src/core/limits/evaluate'
import type { StudentSettings } from '../../../src/core/model/people'
import type { FleetEntry } from '../../../src/core/model/resources'

// Szintetikus flotta és termek; a lajstromjelek és a nevek kitaláltak.
const FLEET: FleetEntry[] = [
  { id: 'p1', callSign: 'HA-XPA', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'p2', callSign: 'HA-XPB', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'c1', callSign: 'HA-XCA', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
]

describe('terem férőhelye a névből (ERF-07)', () => {
  it.each([
    ['18 Classroom I.(T1-new building)', 18],
    ['  30 Classroom III. (SIM II.)', 30],
    ['Emeleti kis tárgyaló', 1],
    ['LHNY AFIS', 1],
    ['Classroom 12', 1],
    ['0 terem', 1],
  ])('%s → %i', (name, capacity) => {
    expect(capacityFromName(name)).toBe(capacity)
  })

  it('csak a még be nem állított termeket tölti ki', () => {
    const settings = { ...createDefaultSettings(), classrooms: { t1: { capacity: 5, preferenceRank: 2 } } }
    const next = prefillClassrooms(settings, ['t1', 't2', 't3'], { t1: '18 Terem', t2: '23 Terem', t3: 'Iroda' })
    expect(next.classrooms).toEqual({ t1: { capacity: 5, preferenceRank: 2 }, t2: { capacity: 23, preferenceRank: 1 }, t3: { capacity: 1, preferenceRank: 1 } })
    expect(prefillClassrooms(next, ['t1', 't2', 't3'], {})).toBe(next)
  })
})

describe('gépválasztás egy listán (NOV-03, NOV-04)', () => {
  const empty: StudentSettings = { userId: 'u1', allowedResources: [] }

  it('a típus kijelölése a típus összes lajstromát jelöli', () => {
    const next = setAircraftChoice(empty, FLEET, ['p1', 'p2'], 'allowed')
    expect(next.allowedResources).toEqual([{ aircraftId: 'p1' }, { aircraftId: 'p2' }])
    expect(next.preferredResources).toBeUndefined()
  })

  it('a preferált gép egyben engedélyezett is', () => {
    const next = setAircraftChoice(empty, FLEET, ['c1'], 'preferred')
    expect(next.allowedResources).toEqual([{ aircraftId: 'c1' }])
    expect(next.preferredResources).toEqual([{ aircraftId: 'c1' }])
    expect(aircraftChoice(next, FLEET[2]!)).toBe('preferred')
  })

  it('a régi, típusra szóló hivatkozást lajstromokra bontja, az ismeretlent megtartja', () => {
    const legacy: StudentSettings = { userId: 'u1', allowedResources: [{ aircraftType: 'PIPER P28A' }, { aircraftId: 'eladott' }], preferredResources: [{ aircraftType: 'CESSNA 152' }] }
    expect(aircraftChoice(legacy, FLEET[2]!)).toBe('preferred')
    const next = setAircraftChoice(legacy, FLEET, ['p2'], 'none')
    expect(next.allowedResources).toEqual([{ aircraftId: 'eladott' }, { aircraftId: 'p1' }, { aircraftId: 'c1' }])
    expect(next.preferredResources).toEqual([{ aircraftId: 'c1' }])
  })

  it('a kijelölés megszüntetése a preferenciát is törli', () => {
    const preferred = setAircraftChoice(empty, FLEET, ['p1'], 'preferred')
    const cleared = setAircraftChoice(preferred, FLEET, ['p1'], 'none')
    expect(cleared.allowedResources).toEqual([])
    expect(cleared.preferredResources).toBeUndefined()
  })
})

describe('Training Manual Rev 8 értékei', () => {
  it('az iskolai minimum a II.6.2 legenyhébb, géppel végzett sora', () => {
    expect(DEFAULT_SCHOOL_MINIMA).toMatchObject({ minVisibilityM: 5000, maxCrosswindKt: 17, maxWindKt: 30, maxGustKt: 30 })
    expect(createDefaultSettings().weather.minimaSource).toContain('TM Rev 8')
  })

  it('a növendék limitjéből felismeri a TM sorát', () => {
    const solo = TM_WEATHER_PRESETS.find((p) => p.id === 'solo-local')!
    expect(solo.limits).toEqual({ minVisibilityM: 8000, maxCrosswindKt: 10, maxWindKt: 15, maxGustKt: 15 })
    expect(matchingWeatherPreset({ ...solo.limits })?.id).toBe('solo-local')
    expect(matchingWeatherPreset({ ...solo.limits, maxGustKt: 20 })).toBeUndefined()
    expect(matchingWeatherPreset(undefined)).toBeUndefined()
  })

  it('a fázisfüggő napi blokkidő (II.6.4) figyelmeztet a túllépésnél', () => {
    expect(phaseLimitRule(undefined)).toBeUndefined()
    const rule = phaseLimitRule('1-2')!
    expect(rule).toMatchObject({ subject: 'student', metric: 'flightTime', limit: 2.5, severity: 'warning' })
    const day = '2026-11-16'
    const at = (h: number): number => Date.parse(`${day}T${String(h).padStart(2, '0')}:00:00Z`)
    const flight = (from: number, minutes: number): LimitActivity => ({ date: day, startMs: at(from), endMs: at(from) + minutes * 60_000, flightMinutes: minutes, simulator: false, task: true, duty: true })
    const ledger = new LimitLedger([flight(8, 90)])
    expect(checkLimitsWith([rule], 'student', ledger, flight(12, 30), day)).toEqual([expect.objectContaining({ status: 'approach' })])
    expect(checkLimitsWith([rule], 'student', ledger, flight(12, 90), day)).toEqual([expect.objectContaining({ status: 'exceeded', value: 3, limit: 2.5 })])
  })
})
