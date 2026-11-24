import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import {
  aircraftNeedingHoursEntry,
  aircraftWithHoursEntry,
  aircraftTypesOf,
  allowedResourceIds,
  assignStudent,
  classifyResources,
  effectiveResource,
  effectiveStudent,
  findUnclassifiedResources,
  isPreferredResource,
  recordAircraftHours,
  sheetEntryDate,
  unassignStudent,
} from '../../../src/core/config/operations'
import type { Settings } from '../../../src/core/config/schema'
import type { FleetEntry } from '../../../src/core/model/resources'

// Szintetikus flotta; lajstromjelek kitaláltak.
const FLEET: FleetEntry[] = [
  { id: 'a1', callSign: 'HA-XAA', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'a2', callSign: 'HA-XAB', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'a3', callSign: 'HA-XAC', model: 'PIPER PA44', aircraftClass: 'MULTI_ENGINE', disabled: true },
  { id: 's1', callSign: 'SIM-X', model: 'ALX', aircraftClass: 'SIMULATOR', disabled: false },
]

function configured(): Settings {
  const base: Settings = {
    ...createDefaultSettings(),
    aircraftTypes: { 'PIPER P28A': { engineRunUpMinutes: 25 } },
  }
  return classifyResources(base, [
    { aircraftId: 'a1', kind: 'aircraft' },
    { aircraftId: 'a2', kind: 'aircraft' },
  ])
}

describe('erőforrások besorolása (ERF-01–03)', () => {
  it('új erőforrásnál rákérdez, a szimulátort a FlightLogger osztályából javasolja', () => {
    const unclassified = findUnclassifiedResources(configured(), FLEET)
    expect(unclassified).toEqual([{ aircraftId: 's1', callSign: 'SIM-X', model: 'ALX', suggestedKind: 'simulator' }])
  })

  it('a besorolás után nincs több kérdés', () => {
    const s = classifyResources(configured(), [{ aircraftId: 's1', kind: 'simulator' }])
    expect(findUnclassifiedResources(s, FLEET)).toEqual([])
    expect(s.resources['s1']).toEqual({ kind: 'simulator' })
  })
})

describe('kirepülhető idő (ERF-04, ERF-05)', () => {
  it('megnyitáskor bekéri azoknál a gépeknél, ahol aznap még nincs megadva', () => {
    let s = configured()
    expect(aircraftNeedingHoursEntry(s, FLEET, '2026-11-11').map((a) => a.id)).toEqual(['a1', 'a2'])
    s = recordAircraftHours(s, 'a1', 12.5, '2026-11-11', '2026-11-11T06:30:00Z')
    expect(aircraftNeedingHoursEntry(s, FLEET, '2026-11-11').map((a) => a.id)).toEqual(['a2'])
    expect(aircraftNeedingHoursEntry(s, FLEET, '2026-11-12').map((a) => a.id)).toEqual(['a1', 'a2'])
  })
})

describe('feloldott beállítások', () => {
  it('gép > géptípus > globális alapérték (ERF-08, ERF-10, SZB-06)', () => {
    let s = configured()
    expect(effectiveResource(s, 'a1', 'aircraft', 'PIPER P28A')).toMatchObject({ engineRunUpMinutes: 25, turnaroundMinutes: 15, minReserveHours: 2, aircraftType: 'PIPER P28A' })
    expect(effectiveResource(s, 'a2', 'aircraft', 'CESSNA 152')).toMatchObject({ engineRunUpMinutes: 20 })
    s = { ...s, resources: { ...s.resources, a1: { ...s.resources['a1']!, engineRunUpMinutes: 30, minReserveHours: -1 } } }
    expect(effectiveResource(s, 'a1', 'aircraft', 'PIPER P28A')).toMatchObject({ engineRunUpMinutes: 30, minReserveHours: -1 })
  })

  it('a növendék hiányzó értékei az alapértékből jönnek (NOV-07, NOV-08, NOV-12)', () => {
    const s = configured()
    expect(effectiveStudent(s, { userId: 'u1', allowedResources: [], priority: 5 })).toMatchObject({
      priority: 5,
      preferredResources: [],
      longNoFlyDays: 14,
      taskSelectionMode: 'automatic',
      weatherLimits: {},
    })
  })
})

describe('növendékek és gépek (NOV-01–04)', () => {
  it('géptípus és egyedi gép szerint engedélyez, a letiltott gépet kihagyja', () => {
    const student = { userId: 'u1', allowedResources: [{ aircraftType: 'PIPER P28A' }, { aircraftId: 'a3' }] }
    expect(allowedResourceIds(student, FLEET)).toEqual(['a1'])
    expect(allowedResourceIds({ userId: 'u2', allowedResources: [] }, FLEET)).toEqual([])
  })

  it('több preferált gépet vagy géptípust is felismer (NOV-04)', () => {
    const student = { userId: 'u1', allowedResources: [], preferredResources: [{ aircraftType: 'CESSNA 152' }, { aircraftId: 'a3' }] }
    expect(isPreferredResource(student, FLEET[1]!)).toBe(true)
    expect(isPreferredResource(student, FLEET[2]!)).toBe(true)
    expect(isPreferredResource(student, FLEET[0]!)).toBe(false)
  })

  it('a flotta géptípusai ábécérendben, ismétlés nélkül', () => {
    expect(aircraftTypesOf(FLEET)).toEqual(['ALX', 'CESSNA 152', 'PIPER P28A', 'PIPER PA44'])
  })

  it('a hozzárendelés tartós és nem duplikál', () => {
    let s = assignStudent(configured(), 'u1')
    s = assignStudent(s, 'u1')
    expect(s.students).toEqual([{ userId: 'u1', allowedResources: [] }])
    expect(unassignStudent(s, 'u1').students).toEqual([])
  })
})

describe('fotóból beolvasott kirepülhető idő (ERF-04)', () => {
  it('a lajstromokat csak a nyilvántartott repülőgépekhez illesztjük', () => {
    expect(aircraftWithHoursEntry(configured(), FLEET).map((a) => a.id)).toEqual(['a1', 'a2'])
  })

  it('az érték a táblázat napjára vonatkozik, ha az olvasható és nem jövőbeli', () => {
    expect(sheetEntryDate('2026-11-11', '2026-11-11')).toBe('2026-11-11')
    expect(sheetEntryDate('2026-11-09', '2026-11-11')).toBe('2026-11-09')
    expect(sheetEntryDate('2026-11-12', '2026-11-11')).toBe('2026-11-11')
    expect(sheetEntryDate(null, '2026-11-11')).toBe('2026-11-11')
    expect(sheetEntryDate('2026-09-01', '2026-11-11')).toBe('2026-11-11')
  })
})
