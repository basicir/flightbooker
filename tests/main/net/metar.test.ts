import { describe, expect, it, vi } from 'vitest'
import { createAllowedFetch } from '../../../src/main/net/allowedFetch'
import { buildMetarUrl, fetchMetars, MetarError } from '../../../src/main/net/metar'

describe('METAR-letöltés (ADT-07, ALP-02)', () => {
  it('csak az ICAO-kód, a formátum és az időablak kerül az URL-be', () => {
    const url = new URL(buildMetarUrl({ icao: 'XXXX', hours: 24, endAt: new Date('2026-11-08T06:30:00Z') }))
    expect(url.origin + url.pathname).toBe('https://aviationweather.gov/api/data/metar')
    expect(Object.fromEntries(url.searchParams)).toEqual({ ids: 'XXXX', format: 'json', hours: '24', date: '20261108_0630' })
    expect(() => buildMetarUrl({ icao: 'xx', hours: 24 })).toThrow(MetarError)
    expect(() => buildMetarUrl({ icao: 'XXXX', hours: 500 })).toThrow(MetarError)
  })

  it('a választ a listán át kéri le; üres válasz üres lista', async () => {
    const impl = vi.fn(async () => new Response(JSON.stringify([{ obsTime: 1, rawOb: 'METAR XXXX' }, null]), { status: 200 }))
    expect(await fetchMetars({ icao: 'XXXX', hours: 2 }, createAllowedFetch(impl))).toEqual([{ obsTime: 1, rawOb: 'METAR XXXX' }])
    const empty = vi.fn(async () => new Response(null, { status: 204 }))
    expect(await fetchMetars({ icao: 'XXXX', hours: 2 }, createAllowedFetch(empty))).toEqual([])
    const bad = vi.fn(async () => new Response('hiba', { status: 500 }))
    await expect(fetchMetars({ icao: 'XXXX', hours: 2 }, createAllowedFetch(bad))).rejects.toThrow('METAR-letöltési hiba (500)')
  })
})
