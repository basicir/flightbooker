import { describe, expect, it } from 'vitest'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import {
  assessHour,
  ceilingFromProfile,
  combineLimits,
  crosswindKt,
  estimateCloudBaseFt,
  forecastReliability,
  hourCloudBase,
  hourValues,
  margin,
  NO_CEILING_FT,
  type HourValues,
} from '../../../src/core/weather/rating'

const calm: HourValues = {
  windKt: 5,
  gustKt: 8,
  crosswindKt: 1,
  visibilityM: 20_000,
  cloudBaseFt: 3200,
  lowCloudCoverPct: 10,
  precipitationMmPerH: 0,
  precipitationProbabilityPct: 5,
  capeJPerKg: 0,
  weatherCode: 0,
}

describe('időjárás (7.4, SZB-01, SZB-16)', () => {
  it('oldalszél a legkedvezőbb pályán, a pályairányból számolva', () => {
    expect(crosswindKt(10, 40, [40, 220])).toBeCloseTo(0)
    expect(crosswindKt(10, 130, [40, 220])).toBeCloseTo(10)
    expect(crosswindKt(10, 70, [40, 220])).toBeCloseTo(5)
    expect(crosswindKt(10, 70, [])).toBeNull()
  })

  it('felhőalap-becslés a hőmérséklet és a harmatpont különbségéből', () => {
    expect(estimateCloudBaseFt(10, 2)).toBe(3200)
    expect(estimateCloudBaseFt(5, 5)).toBe(0)
    expect(estimateCloudBaseFt(null, 2)).toBeNull()
  })

  it('plafon a modell szintenkénti felhőzetéből: az 50% fölötti réteg alja, interpolálva', () => {
    // Szintetikus őszi profil: párás talajközel, összefüggő réteg kb. 1700 lábon.
    const levels = [
      { heightAglFt: 330, coverPct: 4 },
      { heightAglFt: 1000, coverPct: 30 },
      { heightAglFt: 1700, coverPct: 100 },
      { heightAglFt: 2500, coverPct: 8 },
    ]
    expect(ceilingFromProfile(levels)).toBeCloseTo(1000 + (20 / 70) * 700)
    // A szintek sorrendje és a föld alatti / hiányzó szint nem számít.
    expect(ceilingFromProfile([{ heightAglFt: -150, coverPct: 100 }, { heightAglFt: null, coverPct: 100 }, ...[...levels].reverse()])).toBeCloseTo(1200)
    // Az 50% még szórványos (4/8), nem plafon.
    expect(ceilingFromProfile([{ heightAglFt: 500, coverPct: 50 }, { heightAglFt: 2000, coverPct: 40 }])).toBe(NO_CEILING_FT)
    // A legalsó szint már borult: annak a magassága.
    expect(ceilingFromProfile([{ heightAglFt: 300, coverPct: 90 }, { heightAglFt: 1000, coverPct: 100 }])).toBe(300)
    // Profil nélkül nincs érték.
    expect(ceilingFromProfile([{ heightAglFt: 300, coverPct: 90 }, { heightAglFt: null, coverPct: null }])).toBeNull()
  })

  it('a szintek közé eső vékony rétegfelhőt az alacsony felhőzet jelzi (DWD-plafonnal összevetve)', () => {
    // Szintetikus reggeli profil: a szintek legfeljebb 37%-ot látnak, az alacsony felhőzet 92%.
    const levels = [
      { heightAglFt: 290, coverPct: 19 },
      { heightAglFt: 1000, coverPct: 37 },
      { heightAglFt: 1730, coverPct: 0 },
      { heightAglFt: 4030, coverPct: 0 },
      { heightAglFt: 6200, coverPct: 0 },
    ]
    expect(ceilingFromProfile(levels)).toBe(NO_CEILING_FT)
    expect(ceilingFromProfile(levels, { coverPct: 92, topFt: 6200 })).toBe(1000)
    // Egyenlőségnél a legalacsonyabb szint; 800 hPa magassága nélkül a becsült réteg tető.
    expect(ceilingFromProfile([{ heightAglFt: 300, coverPct: 0 }, { heightAglFt: 1000, coverPct: 0 }, { heightAglFt: 9000, coverPct: 0 }], { coverPct: 60, topFt: null })).toBe(300)
    // 50% vagy kevesebb alacsony felhő, illetve már megvan a plafon a rétegen belül: nem változik.
    expect(ceilingFromProfile(levels, { coverPct: 50, topFt: 6200 })).toBe(NO_CEILING_FT)
    expect(ceilingFromProfile([{ heightAglFt: 1000, coverPct: 20 }, { heightAglFt: 2000, coverPct: 80 }], { coverPct: 90, topFt: 6200 })).toBe(1500)
  })

  it('a modell plafonja elsőbbséget kap a hőmérséklet–harmatpont becslés előtt', () => {
    const hour: WeatherHour = {
      time: '2026-11-19T12:00:00.000Z',
      temperatureC: 11,
      dewPointC: 8,
      windSpeedKt: 5,
      windDirectionDeg: 40,
      windGustKt: 8,
      visibilityM: 20_000,
      cloudCoverLowPct: 60,
      precipitationMm: 0,
      precipitationProbabilityPct: 5,
      capeJPerKg: 0,
    }
    // A becslés 1200 láb lenne: 1500-as minimumnál ez rossz napot mutatna.
    expect(hourCloudBase(hour)).toEqual({ ft: 1200, modelled: false })
    expect(hourCloudBase({ ...hour, ceilingFt: 4100 })).toEqual({ ft: 4100, modelled: true })
    expect(hourCloudBase({ ...hour, ceilingFt: null })).toEqual({ ft: 1200, modelled: false })
    expect(hourValues({ ...hour, ceilingFt: NO_CEILING_FT }, []).cloudBaseFt).toBe(NO_CEILING_FT)
    expect(margin(hourValues({ ...hour, ceilingFt: NO_CEILING_FT }, []), { minCloudBaseFt: 1500 })).toEqual({ raw: 1, violated: false })
  })

  it('a nyers érték a limithez mért legrosszabb tartalék, sérülésnél 0', () => {
    expect(margin(calm, { maxWindKt: 25 })).toEqual({ raw: 1, violated: false })
    expect(margin({ ...calm, windKt: 15 }, { maxWindKt: 25 })).toEqual({ raw: 0.8, violated: false })
    expect(margin({ ...calm, gustKt: 10 }, { maxGustKt: 30 }).raw).toBe(1)
    expect(margin({ ...calm, windKt: 30 }, { maxWindKt: 25 })).toEqual({ raw: 0, violated: true })
    expect(margin(calm, { minVisibilityM: 5000 }).raw).toBe(1)
    expect(margin({ ...calm, visibilityM: 6000 }, { minVisibilityM: 5000 }).raw).toBeCloseTo(0.4)
    expect(margin(calm, {}).raw).toBeNull()
  })

  it('a szigorúbb limit érvényes, ha az iskolai és a növendéki limit együtt van', () => {
    expect(combineLimits({ maxWindKt: 25, minVisibilityM: 5000 }, { maxWindKt: 15, minVisibilityM: 8000 })).toEqual({ maxWindKt: 15, minVisibilityM: 8000 })
  })

  it('az iskolai minimum sérülése nem repülhető, a növendéki limité csak bizonytalan (K15)', () => {
    expect(assessHour({ ...calm, windKt: 30 }, { maxWindKt: 25 }, {}).rating).toBe('unflyable')
    const student = assessHour({ ...calm, windKt: 18 }, { maxWindKt: 25 }, { maxWindKt: 15 })
    expect(student.rating).toBe('marginal')
    expect(student.schoolViolated).toBe(false)
    expect(assessHour(calm, { maxWindKt: 25 }, {}).rating).toBe('flyable')
  })

  it('a megbízhatóság a távolsággal csökken', () => {
    expect([0, 2, 3, 5, 6, 9].map(forecastReliability)).toEqual([1, 1, 0.6, 0.6, 0.3, 0.3])
  })
})
