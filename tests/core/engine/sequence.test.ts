import { describe, expect, it } from 'vitest'
import type { Settings } from '../../../src/core/config/schema'
import { createSlotExplorer } from '../../../src/core/engine/explore'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import type { BookingRequest, PlanResult } from '../../../src/core/model/planning'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR } from '../../fixtures/syntheticWeek'

/**
 * Feladatsorrend (ELS-05): ugyanannak a növendéknek az automatikus feladatú igényei időben is
 * sorban követik egymást; a sorban későbbi nem kezdődhet a korábbi vége előtt.
 */

const settings: Settings = baseSettings()
const auto = (id: string, lectureId: string, extra: Partial<BookingRequest> = {}): BookingRequest => flight(id, 'n1', { taskSelectionMode: 'automatic', lectureId, ...extra })
// n1 régen repült: a hét eleje a legjobb neki, így a sorrend nélkül a későbbi feladat előre kerülne.
const snapshot = baseSnapshot({ lastFlightAt: { n1: '2026-10-01T10:00:00.000Z' } })
const run = (requests: BookingRequest[], extra: Partial<PlanInput> = {}): PlanResult => plan({ snapshot, settings, requests, decisions: [], ...extra })
const slotOf = (r: PlanResult, id: string) => r.proposals.find((p) => p.requestId === id && !p.standby)?.slot

describe('feladatsorrend a motorban (ELS-05)', () => {
  it('a sorban későbbi feladat a korábbi (fix időpontú) után kerül, akkor is, ha előbb jobb helye lenne', () => {
    const a = auto('a', 'L1', { timing: { kind: 'fixed', start: at(DAYS[4]!, '10:00') } })
    const b = auto('b', 'L2')
    const without = run([a, b])
    expect(Date.parse(slotOf(without, 'b')!.start)).toBeLessThan(Date.parse(slotOf(without, 'a')!.start))
    const withOrder = run([a, b], { sequences: [['a', 'b']] })
    expect(Date.parse(slotOf(withOrder, 'b')!.start)).toBeGreaterThanOrEqual(Date.parse(slotOf(withOrder, 'a')!.end))
  })

  it('ha a korábbi feladat nem fér a későbbi elé, „nincs hely” lesz, az akadály a feladatsorrend', () => {
    const a = auto('a', 'L1')
    const b = auto('b', 'L2', { timing: { kind: 'fixed', start: at(DAYS[0]!, '08:30') } })
    const r = run([a, b], { sequences: [['a', 'b']] })
    expect(slotOf(r, 'b')).toBeDefined()
    expect(slotOf(r, 'a')).toBeUndefined()
    const dilemma = r.dilemmas.find((d) => d.requestIds.includes('a') && d.type === 'noSlot')
    expect(dilemma?.blockers?.some((x) => x.code === 'order')).toBe(true)
  })

  it('a kézzel választott feladatú (sorba nem tartozó) igényre nem vonatkozik', () => {
    const a = auto('a', 'L1', { timing: { kind: 'fixed', start: at(DAYS[4]!, '10:00') } })
    const b = auto('b', 'L2', { taskSelectionMode: 'manual' })
    // A sor csak automatikus igényekből áll; a kézi igény nincs benne.
    const r = run([a, b])
    expect(Date.parse(slotOf(r, 'b')!.start)).toBeLessThan(Date.parse(slotOf(r, 'a')!.start))
  })

  it('a FlightLoggerben lefoglalt későbbi feladat helyéhez is igazodik', () => {
    // A b (L2) szerdán 13:00-kor már a FlightLoggerben van (feladat alapján felismerve, 9.6).
    const start = at(DAYS[2]!, '13:00')
    const end = at(DAYS[2]!, '15:00')
    const fl = existing('fl-b', { resourceId: 'p1', instructorId: INSTRUCTOR, participantIds: ['n1'], lectureId: 'L2', start, end, flightStart: at(DAYS[2]!, '13:30'), flightEnd: at(DAYS[2]!, '14:30') })
    const withFl = { ...snapshot, bookings: [fl] }
    const requests = [auto('b', 'L2'), auto('a', 'L1')]
    const r = plan({ snapshot: withFl, settings, requests, decisions: [], sequences: [['a', 'b']] })
    expect(r.recordedInFlightLogger.map((x) => x.requestId)).toEqual(['b'])
    expect(Date.parse(slotOf(r, 'a')!.end)).toBeLessThanOrEqual(Date.parse(start))

    // A dilemma-térkép ugyanezt látja: a FlightLogger-foglalás utáni hely sorrendet sért.
    const explorer = createSlotExplorer({ snapshot: withFl, settings, requests, proposals: r.proposals, sequences: [['a', 'b']], booked: r.recordedInFlightLogger }, 'a')!
    const p1 = explorer.places.find((x) => x === 'p1')!
    expect(explorer.at(DAYS[3]!, 10 * 60, p1).hardCodes).toContain('order')
    expect(explorer.at(DAYS[0]!, 10 * 60, p1).hardCodes).not.toContain('order')
  })

  it('a sorrend az elsőbbségi rétegeken át is érvényes: a plusz igény a kézi után jön', () => {
    const kezi = auto('kezi', 'L1', { timing: { kind: 'fixed', start: at(DAYS[2]!, '10:00') } })
    const plusz = auto('plusz', 'L2', { priority: 3 })
    const r = run([kezi, plusz], { sequences: [['kezi', 'plusz']] })
    expect(Date.parse(slotOf(r, 'plusz')!.start)).toBeGreaterThanOrEqual(Date.parse(slotOf(r, 'kezi')!.end))
  })
})
