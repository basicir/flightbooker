import { describe, expect, it } from 'vitest'
import { createWeekPlan, dismissWatch, recordedInput, setRecordingStatus, type WeekPlan } from '../../src/core/draft/weekPlan'
import { plan, type PlanInput } from '../../src/core/engine/plan'
import { watchWeek } from '../../src/core/engine/weekWatch'
import type { BookingRequest, ExistingBooking, Slot } from '../../src/core/model/planning'
import { toMs } from '../../src/core/time/zoned'
import { recordingStateOf } from '../../src/renderer/src/recordingState'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR, weekWeather } from '../fixtures/syntheticWeek'

/**
 * A rögzítési lista tételének állapota (9.6, H02): a rögzített, de a FlightLoggerben azóta lemondott
 * foglalás nem „átírandó”, akkor sem, ha a motor a lezárt helyet a mostani időtartamra igazítja.
 * Szintetikus adat.
 */

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

const fl = flBooking('fl-1', DAYS[2]!, '10:00')
const recordedAt = at(DAYS[1]!, '08:00')
const generatedAt = at(DAYS[1]!, '18:00')
/** A rögzítés óta hosszabb lett a feladat: a motor a lezárt helyet a mostani időtartamra igazítja. */
const longer: BookingRequest = flight('f1', 'n1', { lectureId: 'L1', durations: { briefing: 30, main: 90, debriefing: 15 } })

const setup = (booking: ExistingBooking, request: BookingRequest) => {
  const weekPlan: WeekPlan = setRecordingStatus({ ...createWeekPlan(DAYS[0]!, recordedAt), requests: [request] }, 'f1', 'recorded', slotOf(fl), recordedAt, 'fl-1')
  const input: PlanInput = {
    snapshot: baseSnapshot({ bookings: [booking], weather: weekWeather(), generatedAt }),
    settings: baseSettings(),
    requests: [request],
    decisions: weekPlan.decisions,
    recorded: recordedInput(weekPlan),
  }
  const result = plan(input)
  return { weekPlan, input, result, proposal: result.proposals.find((p) => p.requestId === 'f1')! }
}

describe('rögzítési lista: lemondott foglalás (9.6)', () => {
  it('a lemondott foglalás „lemondott”, nem átírandó, pedig a lezárt hely ideje eltér a rögzítéskoritól', () => {
    const { weekPlan, result, proposal } = setup({ ...fl, status: 'CANCELLED' }, longer)
    expect(result.cancelledInFlightLogger).toEqual(['f1'])
    // A hibás állapot oka: a motor a döntésig lezárt helyet a mostani időtartamra igazítja.
    expect(toMs(proposal.slot.end)).not.toBe(toMs(fl.end))
    expect(recordingStateOf(proposal, weekPlan, new Set(result.cancelledInFlightLogger))).toBe('cancelled')
  })

  it('a meg nem talált (nem lemondott) foglalás eltérő ideje továbbra is átírandó', () => {
    const { weekPlan, result, proposal } = setup({ ...fl, id: 'other', start: at(DAYS[4]!, '08:00'), end: at(DAYS[4]!, '09:00'), flightStart: undefined, flightEnd: undefined, lectureId: 'Lx', participantIds: ['n9'] }, longer)
    expect(result.cancelledInFlightLogger).toEqual([])
    expect(result.missingInFlightLogger).toEqual(['f1'])
    expect(recordingStateOf(proposal, weekPlan, new Set(result.cancelledInFlightLogger))).toBe('resized')
  })

  it('a meglévő, változatlan foglalás rögzített; a nem rögzített tétel nyitott', () => {
    const { weekPlan, result } = setup(fl, flight('f1', 'n1', { lectureId: 'L1' }))
    expect(result.recordedInFlightLogger.map((b) => b.requestId)).toEqual(['f1'])
    const planned = { ...weekPlan, recording: {} }
    const fake = { requestId: 'f1', slot: slotOf(fl), warnings: [] } as unknown as Parameters<typeof recordingStateOf>[0]
    expect(recordingStateOf(fake, weekPlan, new Set())).toBe('done')
    expect(recordingStateOf(fake, planned, new Set())).toBe('open')
  })

  it('a lemondást a korábbi „Megvan, marad” sem rejti el a javasolt változtatások közül', () => {
    const { weekPlan, input, result } = setup({ ...fl, status: 'CANCELLED' }, longer)
    const kept = dismissWatch(weekPlan, 'f1', 'missing', fl.start, generatedAt)
    const items = watchWeek(input, result, { dismissals: kept.watchDismissals ?? [] }).items
    expect(items).toContainEqual(expect.objectContaining({ kind: 'missing', requestId: 'f1', cancelled: true }))
  })
})
