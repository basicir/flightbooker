import { describe, expect, it } from 'vitest'
import { DEFAULT_SCHOOL_MINIMA } from '../../../src/core/config/defaults'
import { demoModelForecasts } from '../../../src/core/demo/demoData'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import { localToMs, toIso } from '../../../src/core/time/zoned'
import {
  dayConsensus,
  dayVerdict,
  forecastHorizon,
  hourPoints,
  summarizeDay,
  WEATHER_CHECK_MODELS,
  type DayForecast,
  type ForecastPlace,
} from '../../../src/core/weather/forecastCheck'

const TZ = 'Europe/Budapest'
const DATE = '2026-11-16'
const place: ForecastPlace = { timeZone: TZ, latitude: 47.5, longitude: 21.5, runwayHeadingsDeg: [41, 221] }

function hour(localHour: number, over: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time: toIso(localToMs(DATE, localHour * 60, TZ)),
    temperatureC: 8,
    dewPointC: 2,
    windSpeedKt: 6,
    windDirectionDeg: 41,
    windGustKt: 10,
    visibilityM: 20_000,
    cloudCoverLowPct: 10,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    capeJPerKg: 0,
    weatherCode: 1,
    ...over,
  }
}

const day = (over: Partial<DayForecast>): DayForecast => ({
  date: DATE,
  hours: 10,
  flyable: 10,
  marginal: 0,
  unflyable: 0,
  tempMinC: null,
  tempMaxC: null,
  windMaxKt: null,
  gustMaxKt: null,
  crosswindMaxKt: null,
  visibilityMinM: null,
  cloudBaseMinFt: null,
  lowCloudMaxPct: null,
  precipitationMm: null,
  precipitationProbabilityMaxPct: null,
  thunder: false,
  ...over,
})

describe('időjárás-ellenőrzés az indítópulton (ADT-07, 7.4)', () => {
  it('csak a nappali órákat összesíti, az iskolai minimum szerint', () => {
    const hours = Array.from({ length: 24 }, (_, h) =>
      // Éjjel viharos: nem számíthat bele. Délben két óra széllökés a limit fölött.
      h < 6 || h >= 17 ? hour(h, { windGustKt: 50 }) : h === 12 || h === 13 ? hour(h, { windGustKt: 35, precipitationMm: 1.25 }) : hour(h),
    )
    const d = summarizeDay(hours, DATE, place, DEFAULT_SCHOOL_MINIMA)
    // Novemberben kb. 6:40 és 15:55 között van nappal.
    expect(d.hours).toBeGreaterThanOrEqual(8)
    expect(d.hours).toBeLessThanOrEqual(10)
    expect(d.unflyable).toBe(2)
    expect(d.flyable).toBe(d.hours - 2)
    expect(d.gustMaxKt).toBe(35)
    expect(d.precipitationMm).toBe(2.5)
    expect(d.cloudBaseMinFt).toBe(2400)
    expect(d.crosswindMaxKt).toBeCloseTo(0)
    expect(dayVerdict(d)).toBe('good')
  })

  it('a modell előrejelzésén túli nap „nincs adat”', () => {
    const hours = Array.from({ length: 24 }, (_, h) => hour(h, { temperatureC: null, windSpeedKt: null, windGustKt: null }))
    const d = summarizeDay(hours, DATE, place, DEFAULT_SCHOOL_MINIMA)
    expect(d.hours).toBe(0)
    expect(dayVerdict(d)).toBe('nodata')
    expect(forecastHorizon(hours)).toBeNull()
    expect(forecastHorizon([hour(9), hour(10), hour(11, { temperatureC: null, windSpeedKt: null, windGustKt: null })])).toBe(hour(10).time)
  })

  it('zivatar és rossz nap', () => {
    const hours = Array.from({ length: 24 }, (_, h) => hour(h, { windGustKt: 40, weatherCode: 95 }))
    const d = summarizeDay(hours, DATE, place, DEFAULT_SCHOOL_MINIMA)
    expect(d.thunder).toBe(true)
    expect(dayVerdict(d)).toBe('poor')
    expect(dayVerdict(day({ flyable: 4, marginal: 4, unflyable: 2 }))).toBe('mixed')
  })

  it('jelzi, ha a tervezés előrejelzése eltér a többi modell többségétől', () => {
    const good = day({ gustMaxKt: 12 })
    const poor = day({ flyable: 0, unflyable: 10, gustMaxKt: 34 })
    const c = dayConsensus(DATE, good, [poor, poor, good])
    expect(c).toMatchObject({ models: 4, good: 2, poor: 2, majority: null, gustSpreadKt: 22, engineDisagrees: true })
    expect(dayConsensus(DATE, good, [good, good, poor])).toMatchObject({ majority: 'good', engineDisagrees: false })
    // Egyetlen másik modell alapján nincs „többség”.
    expect(dayConsensus(DATE, good, [poor]).engineDisagrees).toBe(false)
    // Az előrejelzés végén csak részben lefedett nap (például csak a délelőtt) nem számít.
    expect(dayConsensus(DATE, good, [poor, poor, day({ hours: 3, flyable: 3 })], 8)).toMatchObject({ models: 3, majority: 'poor', engineDisagrees: true })
    expect(dayConsensus(DATE, good, [poor, poor, day({ hours: 3, flyable: 3 }), day({ hours: 3, flyable: 3 })], 8).models).toBe(3)
    // Az adat nélküli modell nem számít.
    expect(dayConsensus(DATE, undefined, [day({ hours: 0, flyable: 0 })])).toMatchObject({ models: 0, majority: null })
  })

  it('meteogram: az időablak órái sorrendben, minősítéssel; az adat nélküli óra kimarad', () => {
    const empty = { temperatureC: null, windSpeedKt: null, windGustKt: null }
    const hours = [hour(12, { windGustKt: 35 }), hour(10), hour(11, empty), hour(23), hour(3)]
    const from = localToMs(DATE, 6 * 60, TZ)
    const to = localToMs(DATE, 18 * 60, TZ)
    const points = hourPoints(hours, from, to, place, DEFAULT_SCHOOL_MINIMA)
    expect(points.map((p) => p.ms)).toEqual([localToMs(DATE, 600, TZ), localToMs(DATE, 720, TZ)])
    expect(points.map((p) => p.rating)).toEqual(['flyable', 'unflyable'])
    expect(points[1]).toMatchObject({ gustKt: 35, cloudBaseFt: 2400, thunder: false })
  })

  it('a bemutató modellek: az ICON-D2 nem fedi le a bázist, a többi eltérő hosszú', () => {
    const models = demoModelForecasts(new Date('2026-11-15T09:00:00.000Z'), DATE)
    expect(models.map((m) => m.model)).toEqual(WEATHER_CHECK_MODELS.map((m) => m.id))
    expect(models.find((m) => m.model === 'icon_d2')).toMatchObject({ hours: [], error: 'Erre a helyre nincs adata.' })
    const horizon = (id: string): string | null => forecastHorizon(models.find((m) => m.model === id)!.hours)
    expect(horizon('meteofrance_seamless')! < horizon('ecmwf_ifs025')!).toBe(true)
  })
})
