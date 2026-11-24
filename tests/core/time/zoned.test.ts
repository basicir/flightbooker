import { describe, expect, it } from 'vitest'
import { addDays, daysBetween, localParts, localToMs, weekdayIndex } from '../../../src/core/time/zoned'

const TZ = 'Europe/Budapest'

describe('időzóna-számítás', () => {
  it('télen UTC+1, nyáron UTC+2', () => {
    expect(new Date(localToMs('2026-11-16', 8 * 60, TZ)).toISOString()).toBe('2026-11-16T07:00:00.000Z')
    expect(new Date(localToMs('2026-07-01', 8 * 60, TZ)).toISOString()).toBe('2026-07-01T06:00:00.000Z')
  })

  it('a nyári időszámítás váltásának napján is helyes', () => {
    // 2026. március 29.: 02:00 → 03:00
    expect(new Date(localToMs('2026-03-29', 12 * 60, TZ)).toISOString()).toBe('2026-03-29T10:00:00.000Z')
    expect(localParts(Date.parse('2026-03-29T10:00:00Z'), TZ)).toEqual({ date: '2026-03-29', minutes: 12 * 60, weekday: 'sun' })
  })

  it('naptári műveletek', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(daysBetween('2026-11-15', '2026-11-19')).toBe(4)
    expect(weekdayIndex('2026-11-16')).toBe(0)
    expect(weekdayIndex('2026-11-22')).toBe(6)
  })
})
