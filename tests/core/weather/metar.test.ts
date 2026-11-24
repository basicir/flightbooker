import { describe, expect, it } from 'vitest'
import { hourlyObservations, metarCeilingFt, metarVisibilityM } from '../../../src/core/weather/metar'

// Szintetikus METAR-rekordok (az aviationweather.gov JSON-formájában), kitalált állomással.
const at = (iso: string): number => Date.parse(iso) / 1000

describe('METAR értelmezése (ADT-07)', () => {
  it('a látást a nyers jelentésből méterben olvassa, a CAVOK és a 9999 10 km', () => {
    expect(metarVisibilityM({ rawOb: 'METAR XXXX 150645Z AUTO 02005KT 4700 BR NCD M01/M02 Q1027' })).toBe(4700)
    expect(metarVisibilityM({ rawOb: 'METAR XXXX 150845Z AUTO VRB02KT CAVOK 02/00 Q1026' })).toBe(10_000)
    expect(metarVisibilityM({ rawOb: 'METAR XXXX 151745Z AUTO 10003KT 060V170 9999 OVC035 06/02 Q1021' })).toBe(10_000)
    // Olvashatatlan nyers jelentésnél a JSON mérföldes értéke.
    expect(metarVisibilityM({ rawOb: '', visib: '6+' })).toBe(10_000)
    expect(metarVisibilityM({ rawOb: '', visib: 2 })).toBeCloseTo(3219, 0)
    expect(metarVisibilityM({})).toBeNull()
  })

  it('a plafon a legalacsonyabb BKN/OVC/VV réteg, a FEW/SCT nem az', () => {
    expect(metarCeilingFt({ clouds: [{ cover: 'SCT', base: 800 }, { cover: 'BKN', base: 2500 }, { cover: 'OVC', base: 1800 }] })).toBe(1800)
    expect(metarCeilingFt({ clouds: [{ cover: 'FEW', base: 1000 }] })).toBeNull()
    expect(metarCeilingFt({ clouds: [{ cover: 'OVX', base: 200 }] })).toBe(200)
    expect(metarCeilingFt({})).toBeNull()
  })

  it('egész óránként a legközelebbi jelentés; lökés nélkül a lökés a szélsebesség', () => {
    const obs = hourlyObservations([
      { obsTime: at('2026-11-15T06:15:00Z'), rawOb: 'METAR XXXX 150615Z 05004KT 6000 NCD 01/00 Q1027', wspd: 4, temp: 1, clouds: [] },
      { obsTime: at('2026-11-15T06:45:00Z'), rawOb: 'METAR XXXX 150645Z 05012G25KT 4700 BKN012 02/01 Q1027', wspd: 12, wgst: 25, temp: 2, clouds: [{ cover: 'BKN', base: 1200 }] },
      { obsTime: at('2026-11-15T07:15:00Z'), rawOb: 'METAR XXXX 150715Z 05006KT CAVOK 03/01 Q1027', wspd: 6, temp: 3, clouds: [] },
    ])
    expect(obs.map((o) => o.time)).toEqual(['2026-11-15T06:00:00.000Z', '2026-11-15T07:00:00.000Z'])
    // 07:00-hoz a 06:45 és a 07:15 egyformán közel van: a korábbi számít.
    expect(obs[1]).toEqual({ time: '2026-11-15T07:00:00.000Z', windKt: 12, gustKt: 25, visibilityM: 4700, ceilingFt: 1200, temperatureC: 2, raw: 'METAR XXXX 150645Z 05012G25KT 4700 BKN012 02/01 Q1027' })
    expect(obs[0]).toMatchObject({ windKt: 4, gustKt: 4, visibilityM: 6000, ceilingFt: null })
  })
})
