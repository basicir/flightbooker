import { describe, expect, it } from 'vitest'
import { changesInput, createWeekPlan, deferBooked, moveRequest, recordedInput, replanRequest, setRecordingStatus, type WeekPlan } from '../../../src/core/draft/weekPlan'
import { linkBookings } from '../../../src/core/engine/bookingLink'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { watchWeek } from '../../../src/core/engine/weekWatch'
import type { ExistingBooking, Slot } from '../../../src/core/model/planning'
import { toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Lemondott foglalás felismerése, elmúlt helyre szóló döntés és a tervezetről indított halasztás
 * (9.6, 9.7). Szintetikus adat.
 */

const f1 = flight('f1', 'n1', { lectureId: 'L1' })

const flBooking = (id: string, day: string, hhmm: string, extra: Partial<ExistingBooking> = {}): ExistingBooking => {
  const fs = toMs(at(day, hhmm))
  const iso = (ms: number): string => new Date(ms).toISOString()
  return existing(id, {
    start: iso(fs - 50 * 60_000),
    end: iso(fs + 75 * 60_000),
    flightStart: iso(fs),
    flightEnd: iso(fs + 60 * 60_000),
    resourceId: 'p1',
    instructorId: INSTRUCTOR,
    participantIds: ['n1'],
    lectureId: 'L1',
    ...extra,
  })
}
const slotOf = (b: ExistingBooking): Slot => ({ start: b.start, end: b.end, flightStart: b.flightStart!, flightEnd: b.flightEnd!, resourceId: b.resourceId! })

describe('lemondott FlightLogger-foglalás (9.6)', () => {
  const fl = flBooking('fl-1', DAYS[2]!, '10:00')
  const recorded = [{ requestId: 'f1', slot: slotOf(fl), bookingId: 'fl-1' }]

  it('a lemondott (CANCELLED) foglalást hiányzónak és lemondottnak ismeri fel, a töröltet csak hiányzónak', () => {
    const cancelled = linkBookings({ snapshot: baseSnapshot({ bookings: [{ ...fl, status: 'CANCELLED' }] }), requests: [f1], recorded })
    expect(cancelled.links).toEqual([])
    expect(cancelled.missing.map((m) => m.requestId)).toEqual(['f1'])
    expect(cancelled.cancelled).toEqual(['f1'])
    const deleted = linkBookings({ snapshot: baseSnapshot({ bookings: [] }), requests: [f1], recorded })
    expect(deleted.missing.map((m) => m.requestId)).toEqual(['f1'])
    expect(deleted.cancelled).toEqual([])
  })

  it('a figyelés a lemondást külön jelzi', () => {
    const input: PlanInput = { snapshot: baseSnapshot({ bookings: [{ ...fl, status: 'CANCELLED' }], weather: weekWeather() }), settings: baseSettings(), requests: [f1], decisions: [], recorded }
    const base = plan(input)
    expect(base.cancelledInFlightLogger).toEqual(['f1'])
    expect(watchWeek(input, base).items).toContainEqual(expect.objectContaining({ kind: 'missing', requestId: 'f1', cancelled: true }))
  })
})

describe('elmúlt helyre szóló döntés', () => {
  it('a vállalt figyelmeztetéses kézi döntés sem tesz a tervezés pillanata elé; az igény újra sorra kerül', () => {
    const past = flBooking('x', DAYS[1]!, '09:00')
    const now = at(DAYS[1]!, '18:00')
    let p: WeekPlan = createWeekPlan(DAYS[0]!, now)
    p = { ...p, requests: [f1] }
    p = moveRequest(p, 'f1', slotOf(past))
    const result = plan({ snapshot: baseSnapshot({ weather: weekWeather(), generatedAt: now }), settings: baseSettings(), requests: [f1], decisions: p.decisions, options: { now } })
    for (const prop of result.proposals) expect(toMs(prop.slot.start)).toBeGreaterThanOrEqual(toMs(now))
    expect(result.proposals.find((x) => x.requestId === 'f1')).toBeDefined()
  })
})

describe('újratervezés és halasztás a tervezetről', () => {
  const fl = flBooking('fl-1', DAYS[2]!, '10:00')
  const nowIso = at(DAYS[1]!, '18:00')
  const recordedPlan = () => {
    let p: WeekPlan = { ...createWeekPlan(DAYS[0]!, nowIso), requests: [f1] }
    p = moveRequest(p, 'f1', slotOf(fl))
    return setRecordingStatus(p, 'f1', 'recorded', slotOf(fl), nowIso, 'fl-1')
  }

  it('az újratervezés a rögzítést és a régi helydöntést is törli', () => {
    const p = replanRequest(recordedPlan(), 'f1', nowIso)
    expect(p.recording['f1']).toBe('planned')
    expect(recordedInput(p)).toEqual([])
    expect(p.decisions.filter((d) => d.requestId === 'f1' && d.kind === 'assign')).toEqual([])
  })

  it('ismert FlightLogger-foglalásnál a halasztás lemondást tesz a rögzítési listára', () => {
    const p = deferBooked(recordedPlan(), 'f1', 'fl-1', nowIso)
    expect(changesInput(p)).toEqual([expect.objectContaining({ requestId: 'f1', kind: 'cancel', bookingId: 'fl-1' })])
    expect(p.decisions).toContainEqual({ kind: 'defer', requestId: 'f1' })
  })

  it('ismeretlen foglalásnál a rögzítés megszűnik és az igény halasztott lesz', () => {
    const p = deferBooked(recordedPlan(), 'f1', undefined, nowIso)
    expect(p.recording['f1']).toBe('planned')
    expect(changesInput(p)).toEqual([])
    expect(p.decisions.filter((d) => d.requestId === 'f1').map((d) => d.kind)).toEqual(['defer'])
  })
})
