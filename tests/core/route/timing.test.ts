import { describe, expect, it } from 'vitest'
import type { BookingRequest } from '../../../src/core/model/planning'
import { distanceKm, isRouteFlight, legMinutesAt, routeAirports, routeLabel, routeLegs, routePointTimes, routeTotalMinutes } from '../../../src/core/route/timing'
import { flight } from '../../fixtures/syntheticWeek'

// Szintetikus repülőterek: egy egyenes mentén, egyenlő közökkel (kb. 111 km / fok).
const COORDS: Record<string, { latitude: number; longitude: number }> = {
  XXXX: { latitude: 47, longitude: 20 },
  YYYY: { latitude: 47, longitude: 21 },
  ZZZZ: { latitude: 47, longitude: 23 },
}
const coords = (icao: string) => COORDS[icao]
const MIN = 60_000

describe('útvonal időzítése (K27, SZB-19)', () => {
  it('a megadott szakaszidőkből számolja az érkezést', () => {
    const points = routePointTimes({ departure: 'XXXX', stops: [{ icao: 'YYYY', elapsedMinutes: 40 }, { icao: 'XXXX', elapsedMinutes: 50 }] }, 0, 120 * MIN, coords)
    expect(points.map((p) => [p.icao, p.role, p.atMs / MIN, p.estimated])).toEqual([
      ['XXXX', 'departure', 0, false],
      ['YYYY', 'stop', 40, false],
      ['XXXX', 'destination', 90, false],
    ])
    // A köztes pont ablaka az érkezés előtt és után fél óra; a célé csak előtte.
    expect([points[1]!.fromMs / MIN, points[1]!.toMs / MIN]).toEqual([10, 70])
    expect([points[2]!.fromMs / MIN, points[2]!.toMs / MIN]).toEqual([60, 90])
    expect([points[0]!.fromMs / MIN, points[0]!.toMs / MIN]).toEqual([0, 30])
  })

  it('a hiányzó szakaszidőt a távolságból számolja, 90 csomóval', () => {
    // X→Y kb. 76 km = 41 NM → 27 perc 90 csomóval.
    const nm = distanceKm(COORDS['XXXX']!, COORDS['YYYY']!) / 1.852
    expect(legMinutesAt(nm)).toBe(27)
    const route = { departure: 'XXXX', stops: [{ icao: 'YYYY' }, { icao: 'XXXX' }] }
    const legs = routeLegs(route, 120, coords)
    expect(legs.map((l) => [l.minutes, l.source])).toEqual([
      [27, 'distance'],
      [27, 'distance'],
    ])
    expect(routeTotalMinutes(route, 120, coords)).toBe(54)
    const points = routePointTimes(route, 0, 120 * MIN, coords)
    expect(points.map((p) => p.atMs / MIN)).toEqual([0, 27, 54])
    expect(points[1]!.estimated).toBe(true)
  })

  it('a kézi érték felülírja a számoltat, a többi szakasz számolt marad', () => {
    const route = { departure: 'XXXX', stops: [{ icao: 'YYYY', elapsedMinutes: 35 }, { icao: 'ZZZZ' }] }
    const legs = routeLegs(route, 120, coords)
    expect(legs[0]).toMatchObject({ minutes: 35, source: 'manual' })
    expect(legs[1]!.source).toBe('distance')
    expect(legs[1]!.minutes).toBe(legMinutesAt(distanceKm(COORDS['YYYY']!, COORDS['ZZZZ']!) / 1.852))
  })

  it('ismeretlen koordinátánál a maradék időből kap egyenlő részt', () => {
    // X→Q és Q→X ismeretlen: a 100 percből 50–50.
    const points = routePointTimes({ departure: 'XXXX', stops: [{ icao: 'QQQQ' }, { icao: 'XXXX' }] }, 0, 100 * MIN, coords)
    expect(points.map((p) => p.atMs / MIN)).toEqual([0, 50, 100])
    // X→Y számolt (27 perc), Y→Q ismeretlen: a maradék 73 perc.
    const legs = routeLegs({ departure: 'XXXX', stops: [{ icao: 'YYYY' }, { icao: 'QQQQ' }] }, 100, coords)
    expect(legs.map((l) => [l.minutes, l.source])).toEqual([
      [27, 'distance'],
      [73, 'share'],
    ])
  })

  it('a repülésnél hosszabb megadott idő az érkezést a repülés végére teszi', () => {
    const points = routePointTimes({ departure: 'XXXX', stops: [{ icao: 'YYYY', elapsedMinutes: 90 }, { icao: 'XXXX', elapsedMinutes: 90 }] }, 0, 120 * MIN, coords)
    expect(points.map((p) => p.atMs / MIN)).toEqual([0, 90, 120])
  })

  it('a kitöltetlen pontokat kihagyja', () => {
    const r = flight('f1', 'n1', { route: { departure: 'XXXX', stops: [{ icao: 'YY' }, { icao: 'ZZZZ' }] } })
    expect(isRouteFlight(r)).toBe(true)
    expect(routeLabel(r.route!)).toBe('XXXX → ZZZZ')
    expect(isRouteFlight(flight('f2', 'n1', { route: { departure: 'XXXX', stops: [{ icao: '' }] } }))).toBe(false)
    expect(isRouteFlight({ ...r, kind: 'simulator' })).toBe(false)
  })

  it('a szükséges repülőterek a bázis nélkül, egyszer', () => {
    const requests: BookingRequest[] = [
      flight('f1', 'n1', { route: { departure: 'XXXX', stops: [{ icao: 'ZZZZ' }, { icao: 'XXXX' }] } }),
      flight('f2', 'n2', { route: { departure: 'YYYY', stops: [{ icao: 'ZZZZ' }] } }),
      flight('f3', 'n3'),
    ]
    expect(routeAirports(requests, 'XXXX')).toEqual(['YYYY', 'ZZZZ'])
  })

  it('a távolság ésszerű', () => {
    expect(distanceKm(COORDS['XXXX']!, COORDS['YYYY']!)).toBeGreaterThan(70)
    expect(distanceKm(COORDS['XXXX']!, COORDS['YYYY']!)).toBeLessThan(80)
  })
})
