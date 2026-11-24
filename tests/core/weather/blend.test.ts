import { describe, expect, it } from 'vitest'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import { blendForecasts, weightedMean, weightedMedian } from '../../../src/core/weather/blend'
import { skillWeights } from '../../../src/core/weather/skill'

const NOW = Date.parse('2026-11-16T06:00:00Z')
const TIME = '2026-11-16T10:00:00.000Z'

function hour(over: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time: TIME,
    temperatureC: 5,
    dewPointC: 2,
    windSpeedKt: 8,
    windDirectionDeg: 40,
    windGustKt: 14,
    visibilityM: 20_000,
    cloudCoverLowPct: 20,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    capeJPerKg: 0,
    weatherCode: 1,
    ceilingFt: 10_000,
    ...over,
  }
}

/** Egyenlő súlyok: a PRIOR_SKILL-ben nem szereplő modellnevek. */
const equal = skillWeights([], ['a', 'b', 'c'], NOW)

describe('súlyozott együttes (ADT-07)', () => {
  it('súlyozott átlag és medián', () => {
    expect(weightedMean([{ value: 10, weight: 1 }, { value: 20, weight: 3 }])).toBe(17.5)
    expect(weightedMedian([{ value: 2000, weight: 1 }, { value: 20_000, weight: 1 }, { value: 18_000, weight: 1 }])).toBe(18_000)
    // Ha a modellek többsége ködöt mond, a medián is.
    expect(weightedMedian([{ value: 2000, weight: 2 }, { value: 20_000, weight: 1 }, { value: 18_000, weight: 0.5 }])).toBe(2000)
    // Pontosan félúton a két szomszéd közepe.
    expect(weightedMedian([{ value: 1000, weight: 1 }, { value: 3000, weight: 1 }])).toBe(2000)
    expect(weightedMedian([])).toBeNull()
  })

  it('egyetlen modell köde nem dönt, a szél átlagolódik, az irány vektorként', () => {
    const [h] = blendForecasts(
      [
        { model: 'a', hours: [hour({ visibilityM: 1500, windSpeedKt: 6, windDirectionDeg: 350, ceilingFt: 400 })] },
        { model: 'b', hours: [hour({ visibilityM: 20_000, windSpeedKt: 9, windDirectionDeg: 10 })] },
        { model: 'c', hours: [hour({ visibilityM: 25_000, windSpeedKt: 12, windDirectionDeg: 10, ceilingFt: 3000 })] },
      ],
      equal,
      NOW,
    )
    expect(h).toMatchObject({ time: TIME, visibilityM: 20_000, windSpeedKt: 9, ceilingFt: 3000, sources: ['a', 'b', 'c'] })
    expect(h!.windDirectionDeg).toBeGreaterThanOrEqual(0)
    expect(h!.windDirectionDeg! > 355 || h!.windDirectionDeg! < 10).toBe(true)
  })

  it('a hiányzó változónál csak az adatot adó modellek számítanak; adat nélküli óra kimarad', () => {
    const hours = blendForecasts(
      [
        { model: 'a', hours: [hour({ visibilityM: null, ceilingFt: null }), hour({ time: '2026-11-16T11:00:00.000Z', temperatureC: null, windSpeedKt: null, windGustKt: null })] },
        { model: 'b', hours: [hour({ visibilityM: 4000, ceilingFt: 1200 })] },
      ],
      equal,
      NOW,
    )
    expect(hours).toHaveLength(1)
    expect(hours[0]).toMatchObject({ visibilityM: 4000, ceilingFt: 1200, sources: ['a', 'b'] })
  })

  it('a pontosabb modell többet számít', () => {
    const date = '2026-11-15'
    const stats = [
      { model: 'a', bucket: 0, group: 'wind' as const, date, n: 1000, sse: 1000 },
      { model: 'b', bucket: 0, group: 'wind' as const, date, n: 1000, sse: 25_000 },
    ]
    const w = skillWeights(stats, ['a', 'b'], NOW)
    const [h] = blendForecasts([{ model: 'a', hours: [hour({ windSpeedKt: 10 })] }, { model: 'b', hours: [hour({ windSpeedKt: 20 })] }], w, NOW)
    expect(h!.windSpeedKt!).toBeLessThan(11)
  })
})
