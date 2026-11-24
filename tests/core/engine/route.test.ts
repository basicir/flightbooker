import { describe, expect, it } from 'vitest'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import type { AirportWeather } from '../../../src/core/model/route'
import type { Proposal } from '../../../src/core/model/planning'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { baseSettings, baseSnapshot, DAYS, flight, TZ, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Útvonalas repülés (K27, SZB-19): az érintett repülőterek időjárása is számít. A bázis
 * (XXXX) egész héten jó; az útvonal-repülőtér (YYYY) időjárása tesztenként változik.
 */
const run = (partial: Partial<PlanInput> & Pick<PlanInput, 'requests'>) => plan({ snapshot: baseSnapshot(), settings: baseSettings(), decisions: [], ...partial })
const dayOf = (p: Proposal): string => localParts(toMs(p.slot.start), TZ).date

const routeAirport = (hours: AirportWeather['hours']): Record<string, AirportWeather> => ({
  YYYY: { icao: 'YYYY', latitude: 47.5, longitude: 22.5, runwayHeadingsDeg: [90, 270], hours },
})
const ROUTE = { departure: 'XXXX', stops: [{ icao: 'YYYY' }, { icao: 'XXXX' }] }

describe('útvonalas repülés időjárása (K27, SZB-19)', () => {
  // Hétfőn és kedden (0–2 nap) az útvonal-repülőtér az iskolai minimum alatt van.
  const badEarly = routeAirport(weekWeather((date) => date === DAYS[0] || date === DAYS[1]))

  it('az útvonal-repülőtér rossz ideje kizárja a közeli napokat', () => {
    const result = run({ snapshot: baseSnapshot({ routeWeather: badEarly }), requests: [flight('f1', 'n1', { route: ROUTE })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect([DAYS[0], DAYS[1]]).not.toContain(dayOf(p))
  })

  it('a helyi repülést az útvonal-repülőtér ideje nem érinti', () => {
    const result = run({ snapshot: baseSnapshot({ routeWeather: badEarly }), requests: [flight('f1', 'n1')] })
    expect(dayOf(result.proposals.find((x) => x.requestId === 'f1')!)).toBe(DAYS[0])
  })

  it('csak abban az ablakban nézi a repülőteret, amikor a gép ott lehet', () => {
    // Hétfőn 8 és 12 között (helyi idő) rossz az útvonal-repülőtér; utána jó. A 60 perces
    // repülés felénél ér oda, így a délutáni hely már jó.
    const weather = routeAirport(weekWeather((date, hour) => date === DAYS[0] && hour >= 8 && hour < 12))
    const settings = baseSettings()
    const monday = { start: '08:00', end: '16:00' }
    const onlyMonday = { ...settings, instructor: { ...settings.instructor, workWindows: { mon: monday, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } }
    const result = run({ settings: onlyMonday, snapshot: baseSnapshot({ routeWeather: weather }), requests: [flight('f1', 'n1', { route: ROUTE })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(dayOf(p)).toBe(DAYS[0])
    // Az érkezés ablaka (érkezés ± 30 perc) nem érhet 12 óra elé.
    const arrival = localParts(toMs(p.slot.flightStart!), TZ).minutes + 30
    expect(arrival - 30).toBeGreaterThanOrEqual(12 * 60)
  })

  it('hiányzó előrejelzésnél jelez, de tervez', () => {
    const result = run({ requests: [flight('f1', 'n1', { route: ROUTE })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(p.warnings.some((w) => w.kind === 'missingData' && w.message.includes('YYYY'))).toBe(true)
  })

  it('a zivatarveszély üzenete megnevezi a repülőteret', () => {
    const hours = weekWeather().map((h) => ({ ...h, capeJPerKg: 1500 }))
    const result = run({ snapshot: baseSnapshot({ routeWeather: routeAirport(hours) }), requests: [flight('f1', 'n1', { route: ROUTE })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(p.warnings.find((w) => w.kind === 'weatherRisk')?.message).toContain('YYYY')
  })

  it('a kitöltetlen útvonal helyi repülésként számít', () => {
    const result = run({ snapshot: baseSnapshot({ routeWeather: badEarly }), requests: [flight('f1', 'n1', { route: { departure: 'XXXX', stops: [{ icao: '' }] } })] })
    expect(dayOf(result.proposals.find((x) => x.requestId === 'f1')!)).toBe(DAYS[0])
  })
})
