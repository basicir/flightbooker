import { describe, expect, it } from 'vitest'
import { civilTwilight, sunEvents } from '../../../src/core/time/solar'

describe('napállás és polgári szürkület', () => {
  const min = 60_000

  it('Budapest környékén a napnyugta és a szürkület a csillagászati évkönyv szerinti (±3 perc)', () => {
    // Kitalált, Budapest-közeli koordináta; 2026. 11. 16.: napnyugta ~15:07 UTC, polgári szürkület vége ~15:40 UTC.
    const sun = sunEvents('2026-11-16', 47.43, 19.26, -0.833)
    const civil = civilTwilight('2026-11-16', 47.43, 19.26)
    expect(Math.abs(sun.set! - Date.parse('2026-11-16T15:07:00Z'))).toBeLessThan(3 * min)
    expect(Math.abs(civil.dusk! - Date.parse('2026-11-16T15:40:00Z'))).toBeLessThan(3 * min)
    expect(civil.dawn!).toBeLessThan(sun.rise!)
  })

  it('a szürkület vége nyáron is a napnyugta után 30–45 perccel van', () => {
    const sun = sunEvents('2026-06-21', 47.43, 19.26, -0.833)
    const civil = civilTwilight('2026-06-21', 47.43, 19.26)
    const diff = (civil.dusk! - sun.set!) / min
    expect(diff).toBeGreaterThan(30)
    expect(diff).toBeLessThan(45)
  })

  it('sarki nappalon nincs szürkület', () => {
    expect(civilTwilight('2026-06-21', 80, 0)).toEqual({})
  })
})
