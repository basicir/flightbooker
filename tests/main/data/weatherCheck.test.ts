import { describe, expect, it, vi } from 'vitest'
import { fetchWeatherCheck } from '../../../src/main/data/weatherCheck'
import { buildForecastUrl, OpenMeteoError, type ForecastRequest } from '../../../src/main/net/openMeteo'
import { WEATHER_CHECK_MODELS } from '../../../src/core/weather/forecastCheck'
import { baseSettings, PLANNED_AT, WEEK_START } from '../../fixtures/syntheticWeek'

describe('időjárás-ellenőrzés: modellek lekérése (ADT-07, ALP-02)', () => {
  it('modellenként egy kérés, csak koordinátával, időablakkal és modellnévvel', async () => {
    const calls: ForecastRequest[] = []
    const fetchForecast = vi.fn(async (r: ForecastRequest) => {
      calls.push(r)
      return { latitude: r.latitude, longitude: r.longitude, hourly: { time: ['2026-11-16T08:00'], wind_gusts_10m: [12] } }
    })
    const result = await fetchWeatherCheck({ fetchForecast, now: new Date(PLANNED_AT) }, baseSettings(), WEEK_START)
    expect(calls.map((c) => c.model)).toEqual(WEATHER_CHECK_MODELS.map((m) => m.id))
    for (const c of calls) {
      expect(Object.keys(c).sort()).toEqual(['forecastDays', 'latitude', 'longitude', 'model', 'timezone'])
      expect(c).toMatchObject({ latitude: 47.5, longitude: 21.5, forecastDays: 9 })
      // A modellnév átmegy az URL-ellenőrzésen.
      expect(buildForecastUrl(c)).toContain(`models=${c.model}`)
    }
    expect(result.fetchedAt).toBe(PLANNED_AT)
    expect(result.models[0]!.hours[0]).toMatchObject({ time: '2026-11-16T08:00:00.000Z', windGustKt: 12 })
  })

  it('a hibás modell nem rontja el a többit; a lefedetlen helyet magyarul jelzi', async () => {
    const fetchForecast = vi.fn(async (r: ForecastRequest) => {
      if (r.model === 'icon_d2') throw new OpenMeteoError('Open-Meteo hiba (400): No data is available for this location', 400)
      if (r.model === 'gfs_seamless') throw new Error('hálózati hiba')
      return { latitude: r.latitude, longitude: r.longitude, hourly: { time: ['2026-11-16T08:00'], wind_gusts_10m: [12] } }
    })
    const result = await fetchWeatherCheck({ fetchForecast, now: new Date(PLANNED_AT) }, baseSettings(), WEEK_START)
    const byId = Object.fromEntries(result.models.map((m) => [m.model, m]))
    expect(byId['icon_d2']).toEqual({ model: 'icon_d2', hours: [], error: 'Erre a helyre nincs adata.' })
    expect(byId['gfs_seamless']).toMatchObject({ hours: [], error: 'hálózati hiba' })
    expect(byId['icon_eu']!.hours).toHaveLength(1)
    expect(byId['icon_eu']!.error).toBeUndefined()
  })

  it('bemutató módban nincs hálózat; repülőtér nélkül hiba', async () => {
    const fetchForecast = vi.fn()
    const demo = vi.fn(() => [{ model: 'icon_eu', hours: [] }])
    const result = await fetchWeatherCheck({ fetchForecast, now: new Date(PLANNED_AT), demo }, baseSettings(), WEEK_START)
    expect(fetchForecast).not.toHaveBeenCalled()
    expect(result.models).toEqual([{ model: 'icon_eu', hours: [] }])
    await expect(fetchWeatherCheck({ fetchForecast, now: new Date(PLANNED_AT) }, { ...baseSettings(), airport: null }, WEEK_START)).rejects.toThrow('Nincs megadva a repülőtér.')
  })
})
