import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import { importAircraftOrder, moveAircraft, orderFleet, placeAircraft, resetAircraftOrder } from '../../../src/core/config/operations'
import type { FleetEntry } from '../../../src/core/model/resources'

// Szintetikus flotta; a lajstromjelek kitaláltak.
const FLEET: FleetEntry[] = [
  { id: 'p2', callSign: 'HA-XPB', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'c1', callSign: 'HA-XCA', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 'p1', callSign: 'HA-XPA', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
  { id: 's1', callSign: 'SIM-X', model: 'ALX', aircraftClass: 'SIMULATOR', disabled: false },
  { id: 's2', callSign: 'SIM-X2', model: 'ALX', aircraftClass: 'SIMULATOR', disabled: false },
]
const ids = (fleet: readonly FleetEntry[]): string[] => fleet.map((a) => a.id)

describe('gépek sorrendje (ERF-01)', () => {
  it('beállítás nélkül típus, majd lajstrom szerint', () => {
    expect(ids(orderFleet(FLEET, undefined))).toEqual(['s1', 's2', 'c1', 'p1', 'p2'])
  })

  it('a beállított sorrend elöl, az új gépek utána', () => {
    expect(ids(orderFleet(FLEET, ['p2', 'c1']))).toEqual(['p2', 'c1', 's1', 's2', 'p1'])
  })

  it('a mozgatás a teljes sorrendet menti, a széleken nem mozdít', () => {
    const s = moveAircraft(createDefaultSettings(), FLEET, 'p2', -1)
    expect(s.aircraftOrder).toEqual(['s1', 's2', 'c1', 'p2', 'p1'])
    const top = moveAircraft(s, FLEET, 's1', -1)
    expect(top).toBe(s)
    expect(resetAircraftOrder(s).aircraftOrder).toBeUndefined()
  })

  it('húzással bármelyik helyre tehető a gép (ERF-01)', () => {
    const base = createDefaultSettings()
    // Alapsorrend: s1, s2, c1, p1, p2
    expect(placeAircraft(base, FLEET, 'p2', 0).aircraftOrder).toEqual(['p2', 's1', 's2', 'c1', 'p1'])
    expect(placeAircraft(base, FLEET, 's1', 4).aircraftOrder).toEqual(['s2', 'c1', 'p1', 'p2', 's1'])
    expect(placeAircraft(base, FLEET, 'c1', 1).aircraftOrder).toEqual(['s1', 'c1', 's2', 'p1', 'p2'])
    expect(placeAircraft(base, FLEET, 'c1', 2)).toBe(base)
    expect(placeAircraft(base, FLEET, 'nincs', 0)).toBe(base)
    expect(placeAircraft(base, FLEET, 'c1', 5)).toBe(base)
  })

  it('a FlightLoggerből kimásolt géplista sorrendjét veszi át', () => {
    const copied = 'Aircraft\nShowing All\nHA-XPA PIPER P28A\nHA-XCA CESSNA 152\nHA-XPB PIPER P28A\nSIM-X2 ALX-87\nClassrooms'
    const result = importAircraftOrder(createDefaultSettings(), FLEET, copied)
    expect(result.found).toBe(4)
    expect(result.missing).toEqual(['SIM-X'])
    // A „SIM-X” nem talál bele a „SIM-X2”-be: a lajstromnak egész szónak kell lennie.
    expect(result.settings.aircraftOrder).toEqual(['p1', 'c1', 'p2', 's2', 's1'])
  })

  it('egy sorba másolt szövegből is működik, találat nélkül nem változtat', () => {
    const result = importAircraftOrder(createDefaultSettings(), FLEET, 'ha-xcb ha-xpb CESSNA ha-xca')
    expect(result.settings.aircraftOrder?.slice(0, 2)).toEqual(['p2', 'c1'])
    const none = createDefaultSettings()
    expect(importAircraftOrder(none, FLEET, 'semmi').settings).toBe(none)
  })
})
