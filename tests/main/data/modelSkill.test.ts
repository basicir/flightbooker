import { describe, expect, it, vi } from 'vitest'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import type { MetarRecord } from '../../../src/core/weather/metar'
import { fetchPlanningWeather } from '../../../src/main/data/blendedWeather'
import { updateModelSkill, type SkillState, type SkillStore } from '../../../src/main/data/modelSkill'
import type { ForecastRequest } from '../../../src/main/net/openMeteo'
import type { MetarRequest } from '../../../src/main/net/metar'

const H = 3_600_000
const T0 = Date.parse('2026-11-10T00:00:00Z')
const iso = (ms: number): string => new Date(ms).toISOString()

function memoryStore(initial?: SkillState): SkillStore & { state: SkillState | undefined } {
  const store = {
    state: initial,
    load: async () => store.state,
    save: async (s: SkillState) => {
      store.state = s
    },
  }
  return store
}

function hour(ms: number, windKt: number): WeatherHour {
  return {
    time: iso(ms),
    temperatureC: 5,
    dewPointC: 2,
    windSpeedKt: windKt,
    windDirectionDeg: 40,
    windGustKt: windKt + 5,
    visibilityM: 20_000,
    cloudCoverLowPct: 20,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    capeJPerKg: 0,
    weatherCode: 1,
    ceilingFt: 10_000,
  }
}

/** Szintetikus METAR: mindig 8 csomó, CAVOK. */
const metarAt = (ms: number): MetarRecord => ({ obsTime: ms / 1000, rawOb: 'METAR XXXX 000000Z 05008KT CAVOK 05/02 Q1020', wspd: 8, temp: 5, clouds: [] })

describe('modellpontosság frissítése (ADT-07)', () => {
  it('archivál, a következő frissítéskor a METAR-ral mér, és a pontosabb modell kap nagyobb súlyt', async () => {
    const store = memoryStore()
    const fetchMetars = vi.fn(async (r: MetarRequest) => {
      const end = r.endAt ? r.endAt.getTime() : T0 + 30 * H
      return Array.from({ length: r.hours }, (_, i) => metarAt(end - i * H))
    })
    const hours = (wind: number) => Array.from({ length: 24 }, (_, i) => hour(T0 + (i + 1) * H, wind))
    // Első letöltés: csak archiválás, mérendő elmúlt óra még nincs.
    const first = await updateModelSkill({ fetchMetars, store, now: new Date(T0) }, 'XXXX', [
      { model: 'icon_eu', hours: hours(8) },
      { model: 'gfs_seamless', hours: hours(14) },
    ], ['icon_eu', 'gfs_seamless'])
    expect(first.measuredHours).toBe(0)
    expect(fetchMetars).not.toHaveBeenCalled()
    expect(store.state!.archive).toHaveLength(2)

    // 30 órával később: a 24 óra elmúlt, a METAR lejön, a mérés megtörténik.
    const second = await updateModelSkill({ fetchMetars, store, now: new Date(T0 + 30 * H) }, 'XXXX', [], ['icon_eu', 'gfs_seamless'])
    expect(fetchMetars).toHaveBeenCalledOnce()
    expect(fetchMetars.mock.calls[0]![0]).toMatchObject({ icao: 'XXXX', hours: 30 })
    expect(second.measuredHours).toBe(48)
    expect(store.state!.archive).toHaveLength(0)
    expect(second.weights['icon_eu']![0]!.byGroup.wind).toBeGreaterThan(second.weights['gfs_seamless']![0]!.byGroup.wind)
    expect(second.weights['icon_eu']![0]!.rmse.wind).toBe(0)
    expect(second.weights['gfs_seamless']![0]!.rmse.wind).toBe(6)
  })

  it('a METAR hibája nem állítja meg: a korábbi mérés és az archívum megmarad', async () => {
    const store = memoryStore({ archive: [{ model: 'icon_eu', issuedAt: iso(T0), hours: [{ time: iso(T0 + H), windKt: 8, gustKt: 10, visibilityM: null, ceilingFt: null, temperatureC: 5 }] }], stats: [] })
    const fetchMetars = vi.fn(async () => {
      throw new Error('nincs hálózat')
    })
    const result = await updateModelSkill({ fetchMetars, store, now: new Date(T0 + 2 * H) }, 'XXXX', [], ['icon_eu'])
    expect(result.error).toBe('METAR: nincs hálózat')
    expect(store.state!.archive[0]!.hours).toHaveLength(1)
  })

  it('régen elmúlt órákhoz visszafelé lapoz (legfeljebb 168 óra kérésenként)', async () => {
    const store = memoryStore({ archive: [{ model: 'icon_eu', issuedAt: iso(T0), hours: [{ time: iso(T0 + H), windKt: 8, gustKt: 10, visibilityM: null, ceilingFt: null, temperatureC: 5 }] }], stats: [] })
    const fetchMetars = vi.fn(async (_r: MetarRequest) => [] as MetarRecord[])
    await updateModelSkill({ fetchMetars, store, now: new Date(T0 + H + 40 * H) }, 'XXXX', [], ['icon_eu'])
    expect(fetchMetars.mock.calls.map((c) => c[0].hours)).toEqual([41])
    const later = memoryStore({ archive: [{ model: 'icon_eu', issuedAt: iso(T0), hours: [{ time: iso(T0 + H), windKt: 8, gustKt: 10, visibilityM: null, ceilingFt: null, temperatureC: 5 }] }], stats: [] })
    fetchMetars.mockClear()
    await updateModelSkill({ fetchMetars, store: later, now: new Date(T0 + 200 * H) }, 'XXXX', [], ['icon_eu'])
    expect(fetchMetars.mock.calls.map((c) => c[0].hours)).toEqual([168, 32])
    expect(fetchMetars.mock.calls[1]![0].endAt).toEqual(new Date(T0 + 32 * H))
  })
})

describe('a tervezés előrejelzése a modellek súlyozott együttese (ADT-07)', () => {
  it('minden modellt lekér, és a sikeresekből súlyoz', async () => {
    const calls: ForecastRequest[] = []
    const fetchForecast = vi.fn(async (r: ForecastRequest) => {
      calls.push(r)
      if (r.model === 'icon_d2') throw new Error('Open-Meteo hiba (400): No data is available for this location')
      const wind = r.model === 'gfs_seamless' ? 20 : 10
      return { latitude: 1, longitude: 2, elevation: 100, hourly: { time: ['2026-11-16T08:00'], temperature_2m: [5], wind_speed_10m: [wind], visibility: [r.model === 'dmi_seamless' ? 2000 : 20_000] } }
    })
    const result = await fetchPlanningWeather({ fetchForecast, now: new Date('2026-11-16T06:00:00Z') }, { icaoCode: 'XXXX', latitude: 1, longitude: 2, timezone: 'Europe/Budapest' }, 3)
    expect(calls.every((c) => c.model !== undefined)).toBe(true)
    expect(result.models).not.toContain('icon_d2')
    expect(result.models.length).toBe(calls.length - 1)
    const [h] = result.hours
    // A szél átlag: a GFS 20 csomója csak részben húzza fel.
    expect(h!.windSpeedKt!).toBeGreaterThan(10)
    expect(h!.windSpeedKt!).toBeLessThan(13)
    // A látás medián: egyetlen modell köde nem dönt.
    expect(h!.visibilityM).toBe(20_000)
    expect(result.skill.measuredHours).toBe(0)
  })

  it('ha egy modell sem jön le, hibát ad', async () => {
    const fetchForecast = vi.fn(async () => {
      throw new Error('nincs hálózat')
    })
    await expect(fetchPlanningWeather({ fetchForecast, now: new Date() }, { latitude: 1, longitude: 2, timezone: 'UTC' }, 1)).rejects.toThrow('Egyik modell sem adott előrejelzést')
  })
})

describe('átmenetileg le nem jött modell pótlása (frissítés közbeni időjárás-ugrás ellen)', () => {
  const place = { icaoCode: 'XXXX', latitude: 1, longitude: 2, timezone: 'Europe/Budapest' }
  const reply = (r: ForecastRequest) => ({
    latitude: 1,
    longitude: 2,
    elevation: 100,
    hourly: { time: ['2026-11-16T08:00'], temperature_2m: [5], wind_speed_10m: [10], visibility: [r.model === 'dmi_seamless' ? 2000 : 20_000] },
  })

  it('a most hibás modellt a legutóbbi sikeres letöltése pótolja, így az együttes nem ugrik', async () => {
    const memory = new Map()
    const now = new Date('2026-11-16T06:00:00Z')
    const first = await fetchPlanningWeather({ fetchForecast: vi.fn(async (r: ForecastRequest) => reply(r)), now, memory }, place, 3)
    const failing = vi.fn(async (r: ForecastRequest) => {
      if (r.model !== 'dmi_seamless') throw new Error('Az Open-Meteo 30 másodperc alatt nem válaszolt.')
      return reply(r)
    })
    const second = await fetchPlanningWeather({ fetchForecast: failing, now: new Date(now.getTime() + H), memory }, place, 3)
    expect(second.models).toEqual(first.models)
    expect(second.staleModels.length).toBe(first.models.length - 1)
    expect(second.staleModels).not.toContain('dmi_seamless')
    // Pótlás nélkül a köd-modell egyedül döntené el a látást.
    expect(second.hours[0]!.visibilityM).toBe(first.hours[0]!.visibilityM)
  })

  it('a hat óránál régebbi letöltés már nem pótol, és a sosem lejött modell sem', async () => {
    const memory = new Map()
    const now = new Date('2026-11-16T06:00:00Z')
    await fetchPlanningWeather({ fetchForecast: vi.fn(async (r: ForecastRequest) => {
      if (r.model === 'icon_d2') throw new Error('Open-Meteo hiba (400): No data is available for this location')
      return reply(r)
    }), now, memory }, place, 3)
    const onlyDmi = vi.fn(async (r: ForecastRequest) => {
      if (r.model !== 'dmi_seamless') throw new Error('hiba')
      return reply(r)
    })
    const soon = await fetchPlanningWeather({ fetchForecast: onlyDmi, now: new Date(now.getTime() + H), memory }, place, 3)
    expect(soon.models).not.toContain('icon_d2')
    const late = await fetchPlanningWeather({ fetchForecast: onlyDmi, now: new Date(now.getTime() + 7 * H), memory }, place, 3)
    expect(late.models).toEqual(['dmi_seamless'])
    expect(late.staleModels).toEqual([])
  })
})
