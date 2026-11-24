import { describe, expect, it } from 'vitest'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import type { Observation } from '../../../src/core/weather/metar'
import {
  addToArchive,
  bucketShares,
  hitRates,
  isHit,
  leadBucket,
  LOG_DAYS,
  mergeLog,
  PRIOR_HOURS,
  PRIOR_SKILL,
  skillWeights,
  toArchived,
  verifyArchive,
  type ArchivedForecast,
} from '../../../src/core/weather/skill'

const H = 3_600_000
const T0 = Date.parse('2026-11-10T00:00:00Z')
const iso = (ms: number): string => new Date(ms).toISOString()

function hour(ms: number, over: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time: iso(ms),
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

const obsAt = (ms: number, over: Partial<Observation> = {}): Observation => ({
  time: iso(ms),
  windKt: 8,
  gustKt: 8,
  visibilityM: 10_000,
  ceilingFt: null,
  temperatureC: 5,
  ...over,
})

describe('modellpontosság METAR-ral (ADT-07)', () => {
  it('előrejelzési távolság-sávok', () => {
    expect([0, 23, 24, 47, 48, 71, 72, 119, 120, 500].map((h) => leadBucket(h * H))).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4])
  })

  it('csak a jövőbeli, 8 napon belüli órák kerülnek az archívumba; időszakonként a legfrissebb letöltés', () => {
    const hours = [hour(T0 - H), hour(T0 + H), hour(T0 + 9 * 24 * H)]
    const a = toArchived('icon_eu', iso(T0), hours)
    expect(a.hours.map((h) => h.time)).toEqual([iso(T0 + H)])
    expect(a.hours[0]).toEqual({ time: iso(T0 + H), windKt: 8, gustKt: 14, visibilityM: 20_000, ceilingFt: 10_000, temperatureC: 5 })
    const later = toArchived('icon_eu', iso(T0 + 2 * H), [hour(T0 + 3 * H)])
    const other = toArchived('icon_eu', iso(T0 + 13 * H), [hour(T0 + 14 * H)])
    const archive = addToArchive([a], [later, other])
    expect(archive.map((f) => f.issuedAt)).toEqual([iso(T0 + 2 * H), iso(T0 + 13 * H)])
  })

  it('a mért óra a napi összesítésbe kerül és kikerül az archívumból; a túl régi, mérés nélküli óra elvész', () => {
    const archive: ArchivedForecast[] = [
      toArchived('icon_eu', iso(T0), [hour(T0 + 30 * H, { windSpeedKt: 11, visibilityM: 3000, ceilingFt: 1200 }), hour(T0 + 31 * H), hour(T0 + 100 * H)]),
    ]
    const now = T0 + 32 * H
    const r = verifyArchive(archive, [obsAt(T0 + 30 * H, { windKt: 8, visibilityM: 5000, ceilingFt: 1500 })], [], now)
    expect(r.verifiedHours).toBe(1)
    // A 31. óra még vár a megfigyelésre, a 100. jövőbeli.
    expect(r.archive[0]!.hours.map((h) => h.time)).toEqual([iso(T0 + 31 * H), iso(T0 + 100 * H)])
    const byGroup = Object.fromEntries(r.stats.map((s) => [s.group, s]))
    expect(byGroup['wind']).toMatchObject({ model: 'icon_eu', bucket: 1, date: '2026-11-11', n: 1, sse: 9 })
    expect(byGroup['visibility']!.sse).toBeCloseTo(4)
    // A plafon ezer lábban: 1,2 − 1,5.
    expect(byGroup['ceiling']!.sse).toBeCloseTo(0.09)
    // Két nap múlva a mérés nélküli óra kikerül.
    expect(verifyArchive(r.archive, [], r.stats, T0 + 31 * H + 49 * H).archive[0]!.hours.map((h) => h.time)).toEqual([iso(T0 + 100 * H)])
  })

  it('mérés nélkül az induló pontosság négyzete a súly; sok mérésnél a mért hiba dönt', () => {
    const now = T0 + 40 * 24 * H
    const empty = skillWeights([], ['icon_eu', 'gfs_seamless'], now)
    expect(empty['icon_eu']![0]!.overall).toBeCloseTo(PRIOR_SKILL['icon_eu']![0]! ** 2)
    expect(empty['gfs_seamless']![0]!.byGroup.wind).toBeCloseTo(PRIOR_SKILL['gfs_seamless']![0]! ** 2)

    // A GFS szélhibája 1 kt, az ICON-EU-é 4 kt, sok órán át.
    const date = '2026-12-18'
    const stats = [
      { model: 'gfs_seamless', bucket: 0, group: 'wind' as const, date, n: 500, sse: 500 },
      { model: 'icon_eu', bucket: 0, group: 'wind' as const, date, n: 500, sse: 8000 },
    ]
    const w = skillWeights(stats, ['icon_eu', 'gfs_seamless'], now)
    expect(w['gfs_seamless']![0]!.byGroup.wind).toBeGreaterThan(4 * w['icon_eu']![0]!.byGroup.wind)
    expect(w['gfs_seamless']![0]!.rmse.wind).toBeCloseTo(1)
    // A többi csoport és sáv marad az induló értéken.
    expect(w['gfs_seamless']![1]!.byGroup.wind).toBeCloseTo(empty['gfs_seamless']![1]!.byGroup.wind)

    // Kevés mérés: az induló érték felé húz (PRIOR_HOURS óránál félúton).
    const few = skillWeights([{ model: 'icon_eu', bucket: 0, group: 'wind', date, n: PRIOR_HOURS, sse: PRIOR_HOURS * 36 }], ['icon_eu'], now)
    const prior = 9 / PRIOR_SKILL['icon_eu']![0]! ** 2
    expect(few['icon_eu']![0]!.byGroup.wind).toBeCloseTo(9 / ((36 + prior) / 2))

    // A 30 napnál régebbi mérés nem számít.
    const old = skillWeights([{ ...stats[0]!, date: '2026-11-01' }], ['gfs_seamless'], now)
    expect(old['gfs_seamless']![0]!.n.wind).toBe(0)

    const shares = bucketShares(w, 0, ['icon_eu', 'gfs_seamless'])
    expect(shares['icon_eu']! + shares['gfs_seamless']!).toBeCloseTo(1)
  })
})

describe('mérési napló: a METAR-ok és a modellek előrejelzése rájuk (ADT-07)', () => {
  it('óránként a METAR és modellenként a legfrissebb előrejelzés kerül a naplóba', () => {
    const early = toArchived('icon_eu', iso(T0), [hour(T0 + 30 * H, { windSpeedKt: 20 })])
    const late = toArchived('icon_eu', iso(T0 + 13 * H), [hour(T0 + 30 * H, { windSpeedKt: 9 })])
    const gfs = toArchived('gfs_seamless', iso(T0 + 13 * H), [hour(T0 + 30 * H, { windSpeedKt: 15 })])
    const o = { ...obsAt(T0 + 30 * H, { windKt: 8 }), raw: 'METAR XXXX 110600Z 04008KT 9999 05/02 Q1020' }
    const r = verifyArchive(addToArchive([], [early, late, gfs]), [o], [], T0 + 32 * H)
    expect(r.log).toHaveLength(1)
    expect(r.log[0]!.observation.raw).toBe(o.raw)
    expect(r.log[0]!.forecasts.map((f) => [f.model, f.issuedAt, f.windKt])).toEqual([
      ['gfs_seamless', iso(T0 + 13 * H), 15],
      ['icon_eu', iso(T0 + 13 * H), 9],
    ])
  })

  it('a meglévő naplóhoz hozzáad, és a régi órákat elhagyja', () => {
    const old = { time: iso(T0), observation: obsAt(T0), forecasts: [] }
    const recent = { time: iso(T0 + 100 * H), observation: obsAt(T0 + 100 * H), forecasts: [] }
    const now = T0 + LOG_DAYS * 24 * H + 50 * H
    expect(mergeLog([old, recent], [], now).map((h) => h.time)).toEqual([iso(T0 + 100 * H)])
    // A korábbi napló órái a mostani mérés mellett is megmaradnak.
    const r = verifyArchive([toArchived('icon_eu', iso(T0 + 150 * H), [hour(T0 + 160 * H)])], [obsAt(T0 + 160 * H)], [], T0 + 161 * H, [recent])
    expect(r.log.map((h) => h.time)).toEqual([iso(T0 + 100 * H), iso(T0 + 160 * H)])
  })

  it('a találati arány a tűrésen belüli órák aránya, csoportonként', () => {
    const f = (windKt: number, visibilityM: number | null, ceilingFt: number | null) => ({ model: 'icon_eu', issuedAt: iso(T0), windKt, gustKt: null, visibilityM, ceilingFt, temperatureC: 5 })
    const log = [
      { time: iso(T0 + H), observation: obsAt(T0 + H, { windKt: 8, visibilityM: 4000, ceilingFt: 1200 }), forecasts: [f(12, 5500, 1600)] },
      { time: iso(T0 + 2 * H), observation: obsAt(T0 + 2 * H, { windKt: 8, visibilityM: 10_000, ceilingFt: null }), forecasts: [f(14, 20_000, 9000)] },
    ]
    const r = hitRates(log)['icon_eu']!
    expect(r.wind).toEqual({ hits: 1, n: 2 }) // 4 kt talált, 6 kt nem
    expect(r.visibility).toEqual({ hits: 2, n: 2 }) // 1,5 km; 10 km fölött mindegy
    expect(r.ceiling).toEqual({ hits: 2, n: 2 }) // 400 ft; 5000 ft fölött mindegy
    expect(r.gust).toEqual({ hits: 0, n: 0 }) // a modell nem adott lökést
    expect(isHit('wind', f(14, null, null), obsAt(T0, { windKt: 8 }))).toBe(false)
  })
})
