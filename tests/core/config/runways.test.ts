import { describe, expect, it } from 'vitest'
import { reciprocalDesignator, reciprocalHeading, removeRunway, updateRunway } from '../../../src/core/config/runways'

describe('pályairányok párja (7.4)', () => {
  it('kiszámolja az ellentétes jelet és a valós irányt', () => {
    expect(reciprocalDesignator('04')).toBe('22')
    expect(reciprocalDesignator('36')).toBe('18')
    expect(reciprocalDesignator('18')).toBe('36')
    expect(reciprocalDesignator('09L')).toBe('27R')
    expect(reciprocalDesignator('40')).toBeUndefined()
    expect(reciprocalHeading(355)).toBe(175)
    expect(reciprocalHeading(41)).toBe(221)
    expect(reciprocalHeading(221)).toBe(41)
  })

  it('a jel megadásakor felveszi a párt, az irány változását követi', () => {
    let rw = updateRunway([{ designator: '', trueHeadingDeg: 0 }], 0, { designator: '36' })
    expect(rw).toEqual([
      { designator: '36', trueHeadingDeg: 0 },
      { designator: '18', trueHeadingDeg: 180 },
    ])
    rw = updateRunway(rw, 0, { trueHeadingDeg: 355 })
    expect(rw[1]).toEqual({ designator: '18', trueHeadingDeg: 175 })
    rw = updateRunway(rw, 1, { trueHeadingDeg: 176 })
    expect(rw[0]).toEqual({ designator: '36', trueHeadingDeg: 356 })
  })

  it('a jel átírásakor a pár is átíródik, nem keletkezik új sor', () => {
    let rw = updateRunway([{ designator: '', trueHeadingDeg: 0 }], 0, { designator: '04' })
    expect(rw[0]).toEqual({ designator: '04', trueHeadingDeg: 40 })
    rw = updateRunway(rw, 0, { designator: '05' })
    expect(rw).toEqual([
      { designator: '05', trueHeadingDeg: 40 },
      { designator: '23', trueHeadingDeg: 220 },
    ])
  })

  it('törléskor a párt is törli', () => {
    const rw = [
      { designator: '04', trueHeadingDeg: 41 },
      { designator: '22', trueHeadingDeg: 221 },
      { designator: '13', trueHeadingDeg: 131 },
    ]
    expect(removeRunway(rw, 1)).toEqual([{ designator: '13', trueHeadingDeg: 131 }])
  })
})
