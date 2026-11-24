import { describe, expect, it } from 'vitest'
import { lookupAirport } from '../../../src/core/airports/lookup'

describe('repülőtér keresése ICAO-kódból (beépített lista)', () => {
  it('megtalálja a koordinátát és a pályákat valós iránnyal', async () => {
    const r = await lookupAirport('lhbp')
    expect(r).toBeDefined()
    expect(r!.icaoCode).toBe('LHBP')
    expect(r!.latitude).toBeCloseTo(47.43, 1)
    expect(r!.longitude).toBeCloseTo(19.26, 1)
    const designators = r!.runways.map((x) => x.designator)
    expect(designators).toEqual(expect.arrayContaining(['13L', '31R', '13R', '31L']))
    for (const rw of r!.runways) {
      expect(rw.trueHeadingDeg).toBeGreaterThanOrEqual(0)
      expect(rw.trueHeadingDeg).toBeLessThan(360)
    }
  })

  it('ismeretlen vagy hibás kódra nem ad eredményt', async () => {
    expect(await lookupAirport('ZZZY')).toBeUndefined()
    expect(await lookupAirport('LH')).toBeUndefined()
  })
})
