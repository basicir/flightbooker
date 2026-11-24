import { describe, expect, it, vi } from 'vitest'
import { createAllowedFetch } from '../../../src/main/net/allowedFetch'
import { buildForecastUrl, fetchForecast, OpenMeteoError } from '../../../src/main/net/openMeteo'

describe('Open-Meteo kliens (ADT-07)', () => {
  it('csak koordinátát, időablakot és változókat küld, csomóban kéri a szelet', () => {
    const url = new URL(buildForecastUrl({ latitude: 47.12345678, longitude: 19.5, model: 'icon_d2', forecastDays: 3 }))
    expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
    expect(url.searchParams.get('latitude')).toBe('47.1235')
    expect(url.searchParams.get('wind_speed_unit')).toBe('kn')
    expect(url.searchParams.get('models')).toBe('icon_d2')
    expect(url.searchParams.get('forecast_days')).toBe('3')
    expect(url.searchParams.get('hourly')).toContain('visibility')
    // Felhőprofil a plafonhoz: szintenkénti felhőzet és magasság.
    expect(url.searchParams.get('hourly')?.split(',')).toEqual(expect.arrayContaining(['cloud_cover_925hPa', 'geopotential_height_925hPa', 'cloud_cover_700hPa']))
    expect([...url.searchParams.keys()].sort()).toEqual(
      ['daily', 'forecast_days', 'hourly', 'latitude', 'longitude', 'models', 'timezone', 'wind_speed_unit'].sort(),
    )
  })

  it.each([
    [{ latitude: 91, longitude: 0 }],
    [{ latitude: 0, longitude: 181 }],
    [{ latitude: Number.NaN, longitude: 0 }],
    [{ latitude: 0, longitude: 0, forecastDays: 17 }],
    [{ latitude: 0, longitude: 0, model: 'icon_d2&x=1' }],
  ])('érvénytelen kérést elutasít: %o', (request) => {
    expect(() => buildForecastUrl(request)).toThrow(OpenMeteoError)
  })

  it('az engedélyezési listán keresztül, GET-tel kér', async () => {
    const impl = vi.fn(async (_input: string, _init: RequestInit) => new Response(JSON.stringify({ latitude: 1, longitude: 2 })))
    await fetchForecast({ latitude: 1, longitude: 2 }, createAllowedFetch(impl))
    expect(impl.mock.calls[0]![1].method).toBe('GET')
  })

  it('a hibás választ az Open-Meteo indoklásával jelzi', async () => {
    const impl = vi.fn(async () => new Response(JSON.stringify({ error: true, reason: 'Cannot initialize' }), { status: 400 }))
    await expect(fetchForecast({ latitude: 1, longitude: 2 }, createAllowedFetch(impl))).rejects.toThrow('Cannot initialize')
  })
})
