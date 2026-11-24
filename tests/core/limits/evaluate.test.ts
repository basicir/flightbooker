import { describe, expect, it } from 'vitest'
import { DEFAULT_LIMIT_RULES } from '../../../src/core/config/defaults'
import { checkLimitsWith, LimitLedger, type LimitActivity } from '../../../src/core/limits/evaluate'

const H = 3_600_000
const flightOn = (date: string, startHour: number, hours: number, extra: Partial<LimitActivity> = {}): LimitActivity => {
  const start = Date.parse(`${date}T00:00:00Z`) + startHour * H
  return { date, startMs: start, endMs: start + hours * H, flightMinutes: hours * 60, simulator: false, task: true, duty: true, ...extra }
}
const HORIZON = '2026-11-22'

describe('limitek előrevetítéssel (LIM-01–06)', () => {
  it('napi oktatói limit: a jelölt a már tervezettekkel együtt számít', () => {
    const ledger = new LimitLedger([flightOn('2026-11-16', 6, 4), flightOn('2026-11-16', 11, 3)])
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'instructor', ledger, flightOn('2026-11-16', 15, 2), HORIZON)
    expect(checks.find((c) => c.ruleId === 'oktato-repult-nap')).toMatchObject({ status: 'exceeded', value: 9, limit: 8 })
  })

  it('80% felett közelítést jelez (8.4)', () => {
    const ledger = new LimitLedger([flightOn('2026-11-16', 6, 5)])
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'instructor', ledger, flightOn('2026-11-16', 12, 1.5), HORIZON)
    expect(checks.find((c) => c.ruleId === 'oktato-repult-nap')?.status).toBe('approach')
  })

  it('a gördülő ablak a múltbeli repült időt is tartalmazza (28 nap, 100 óra)', () => {
    const history = Array.from({ length: 25 }, (_, i) => flightOn(`2026-10-${String(22 + (i % 9)).padStart(2, '0')}`, 6, 4, { duty: false }))
    const ledger = new LimitLedger(history)
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'instructor', ledger, flightOn('2026-11-16', 8, 2), HORIZON)
    expect(checks.find((c) => c.ruleId === 'oktato-repult-28nap')?.status).toBe('exceeded')
  })

  it('a szimulátoridő csak akkor számít, ha a szabály kéri (8.3)', () => {
    const ledger = new LimitLedger([flightOn('2026-11-16', 6, 7, { simulator: true })])
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'instructor', ledger, flightOn('2026-11-16', 14, 1.5), HORIZON)
    expect(checks.find((c) => c.ruleId === 'oktato-repult-nap')).toBeUndefined()
  })

  it('pihenőidő: legalább 12 óra, és legalább az előző szolgálat hossza (ORO.FTL.235 minta)', () => {
    const ledger = new LimitLedger([flightOn('2026-11-16', 6, 14)])
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'instructor', ledger, flightOn('2026-11-17', 9, 1), HORIZON)
    expect(checks.find((c) => c.ruleId === 'oktato-piheno')).toMatchObject({ status: 'exceeded', limit: 14 })
  })

  it('növendéki napi feladatszám (K16)', () => {
    const ledger = new LimitLedger([flightOn('2026-11-16', 6, 1, { duty: false }), flightOn('2026-11-16', 9, 1, { duty: false })])
    const checks = checkLimitsWith(DEFAULT_LIMIT_RULES, 'student', ledger, flightOn('2026-11-16', 13, 1, { duty: false }), HORIZON)
    expect(checks.find((c) => c.ruleId === 'novendek-feladat-nap')).toMatchObject({ status: 'exceeded', value: 3, limit: 2 })
  })
})
