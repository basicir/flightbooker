import { describe, expect, it } from 'vitest'
import { isExpiredBlock, onceBlock, pruneBlockedPeriods, sortBlockedPeriods, weeklyBlocks } from '../../../src/core/config/blockedPeriods'
import type { BlockedPeriod } from '../../../src/core/config/schema'
import { at, baseSettings, DAYS, TZ } from '../../fixtures/syntheticWeek'

/** Tiltott időszakok (SZB-14, K35): lejárat, sorrend, felvétel. Szintetikus adat. */

const nowMs = Date.parse(at(DAYS[2]!, '12:00'))
const today = DAYS[2]!

const once = (id: string, start: string, end: string): BlockedPeriod => ({ id, kind: 'once', start, end })

describe('tiltott időszakok', () => {
  it('az elmúlt eseti és a lejárt ismétlődő időszak törlődik, a folyamatban lévő marad', () => {
    const past = once('mult', at(DAYS[1]!, '08:00'), at(DAYS[1]!, '10:00'))
    const ongoing = once('most', at(DAYS[2]!, '11:00'), at(DAYS[2]!, '13:00'))
    const expiredWeekly: BlockedPeriod = { id: 'regi', kind: 'weekly', weekday: 'mon', start: '08:00', end: '10:00', validTo: DAYS[1]! }
    const weekly: BlockedPeriod = { id: 'heti', kind: 'weekly', weekday: 'tue', start: '08:00', end: '10:00' }
    expect(isExpiredBlock(past, nowMs, today)).toBe(true)
    expect(isExpiredBlock(ongoing, nowMs, today)).toBe(false)
    const s = baseSettings()
    const withPeriods = { ...s, instructor: { ...s.instructor, blockedPeriods: [past, ongoing, expiredWeekly, weekly] } }
    expect(pruneBlockedPeriods(withPeriods, nowMs).instructor.blockedPeriods.map((p) => p.id)).toEqual(['most', 'heti'])
    // Változás nélkül ugyanaz az objektum (nincs fölösleges mentés).
    const clean = { ...s, instructor: { ...s.instructor, blockedPeriods: [weekly] } }
    expect(pruneBlockedPeriods(clean, nowMs)).toBe(clean)
  })

  it('ismétlődőt több napra egyszerre, egész napra is fel lehet venni', () => {
    const r = weeklyBlocks({ weekdays: ['wed', 'mon'], allDay: true, start: '', end: '', note: ' egyetem ', idBase: 't' })
    expect(r).toEqual({
      ok: true,
      periods: [
        { id: 't-1', kind: 'weekly', weekday: 'mon', start: '00:00', end: '23:59', note: 'egyetem' },
        { id: 't-2', kind: 'weekly', weekday: 'wed', start: '00:00', end: '23:59', note: 'egyetem' },
      ],
    })
    expect(weeklyBlocks({ weekdays: [], allDay: true, start: '', end: '', idBase: 't' }).ok).toBe(false)
    expect(weeklyBlocks({ weekdays: ['mon'], allDay: false, start: '10:00', end: '09:00', idBase: 't' }).ok).toBe(false)
  })

  it('az eseti időszak több napos is lehet; egész napnál az utolsó nap végéig tart; elmúltat nem vesz fel', () => {
    const r = onceBlock({ startDate: DAYS[3]!, endDate: DAYS[4]!, allDay: true, start: '', end: '', idBase: 'e', tz: TZ, nowMs })
    expect(r).toEqual({ ok: true, periods: [{ id: 'e', kind: 'once', start: at(DAYS[3]!, '00:00'), end: at(DAYS[5]!, '00:00') }] })
    expect(onceBlock({ startDate: DAYS[1]!, endDate: DAYS[1]!, allDay: true, start: '', end: '', idBase: 'e', tz: TZ, nowMs })).toEqual({ ok: false, error: 'Ez az időszak már elmúlt.' })
  })

  it('előbb az ismétlődők a hét napjai szerint, aztán az esetiek időrendben', () => {
    const list: BlockedPeriod[] = [
      once('b', at(DAYS[4]!, '08:00'), at(DAYS[4]!, '09:00')),
      { id: 'w2', kind: 'weekly', weekday: 'fri', start: '08:00', end: '09:00' },
      once('a', at(DAYS[3]!, '08:00'), at(DAYS[3]!, '09:00')),
      { id: 'w1', kind: 'weekly', weekday: 'mon', start: '08:00', end: '09:00' },
    ]
    expect(sortBlockedPeriods(list).map((p) => p.id)).toEqual(['w1', 'w2', 'a', 'b'])
  })
})
