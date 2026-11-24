import { describe, expect, it, vi } from 'vitest'
import { fetchRouteWeather } from '../../../src/main/data/routeWeather'
import type { ForecastRequest } from '../../../src/main/net/openMeteo'
import { baseSettings, PLANNED_AT, WEEK_START } from '../../fixtures/syntheticWeek'

const lookup = async (icao: string) =>
  icao === 'YYYY' || icao === 'ZZZZ' ? { icaoCode: icao, latitude: 47.25, longitude: 21.75, runways: [{ designator: '09', trueHeadingDeg: 92 }], headingsEstimated: false } : undefined

describe('útvonal-repülőterek előrejelzése (K27, SZB-19, ALP-02)', () => {
  it('csak koordinátát és időablakot kér, a pályairányt átadja', async () => {
    const calls: ForecastRequest[] = []
    const fetchForecast = vi.fn(async (r: ForecastRequest) => {
      calls.push(r)
      return { latitude: r.latitude, longitude: r.longitude, hourly: { time: ['2026-11-16T08:00'], wind_speed_10m: [7] } }
    })
    const result = await fetchRouteWeather({ fetchForecast, now: new Date(PLANNED_AT), lookup }, baseSettings(), WEEK_START, ['YYYY', 'YYYY'])
    expect(fetchForecast).toHaveBeenCalledTimes(1)
    expect(Object.keys(calls[0]!).sort()).toEqual(['forecastDays', 'latitude', 'longitude', 'timezone'])
    expect(calls[0]!.forecastDays).toBe(9)
    expect(result.weather['YYYY']).toMatchObject({ latitude: 47.25, runwayHeadingsDeg: [92] })
    expect(result.weather['YYYY']!.hours[0]).toMatchObject({ time: '2026-11-16T08:00:00.000Z', windSpeedKt: 7 })
  })

  it('az ismeretlen kódot és a sikertelen letöltést repülőterenként jelzi', async () => {
    const fetchForecast = vi.fn(async () => {
      throw new Error('hálózati hiba')
    })
    const result = await fetchRouteWeather({ fetchForecast, now: new Date(PLANNED_AT), lookup }, baseSettings(), WEEK_START, ['QQQQ', 'ZZZZ', 'rossz'])
    expect(result.errors).toEqual({ QQQQ: 'Ismeretlen ICAO-kód.', ZZZZ: 'hálózati hiba' })
    // A koordináta megmarad a szakaszidőhöz, de óra nincs.
    expect(Object.keys(result.weather)).toEqual(['ZZZZ'])
    expect(result.weather['ZZZZ']).toMatchObject({ latitude: 47.25, hours: [] })
  })

  it('bemutató módban nem hív hálózatot', async () => {
    const fetchForecast = vi.fn()
    const result = await fetchRouteWeather({ fetchForecast, now: new Date(PLANNED_AT), lookup, demoHours: () => [] }, baseSettings(), WEEK_START, ['YYYY'])
    expect(fetchForecast).not.toHaveBeenCalled()
    expect(result.weather['YYYY']?.hours).toEqual([])
  })
})
