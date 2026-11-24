import { describe, expect, it } from 'vitest'
import { plan } from '../../../src/core/engine/plan'
import type { BookingRequest, Decision, PlanResult } from '../../../src/core/model/planning'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR, PLANNED_AT } from '../../fixtures/syntheticWeek'

/**
 * Közös briefing csapatok (KBR-01, KBR-02, KBR-07). A tervdokumentum példája: 45 perc briefing,
 * 60 perc repülés, 30 perc debriefing, 10 perc csere, 15 perc fordulóidő, 20 perc motorpróba.
 * Szintetikus adat.
 */

const MON = DAYS[0]!
const WED = DAYS[2]!
const DURATIONS = { briefing: 45, main: 60, debriefing: 30 }

const member = (id: string, studentId: string, extra: Partial<BookingRequest> = {}): BookingRequest =>
  flight(id, studentId, { lectureId: 'L7', taskSelectionMode: 'manual', durations: DURATIONS, briefingTeamId: 'T', ...extra })
const four = (extra: Partial<BookingRequest> = {}): BookingRequest[] => ['n1', 'n2', 'n3', 'n4'].map((n, i) => member(`t${i + 1}`, n, extra))

const slotOf = (r: PlanResult, id: string) => r.proposals.find((p) => p.requestId === id && !p.standby)?.slot

describe('közös briefing csapat elrendezése (KBR-01, KBR-02)', () => {
  it('a négyfős csapat: közös kezdés, két pár egymás után ugyanazon a gépen, közös debriefing', () => {
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: four(), decisions: [] })
    expect(r.dilemmas).toEqual([])
    expect(r.teams).toEqual([
      {
        teamId: 'T',
        requestIds: ['t1', 't2', 't3', 't4'],
        state: 'placed',
        start: at(MON, '08:00'),
        end: at(MON, '14:10'),
        units: [
          // A gép napi első repülése: a briefing után a motorpróba (SZB-05); a páron belül 10 perc csere.
          { requestIds: ['t1', 't2'], bookingType: 'multiStudent', resourceId: 'p1', flightStart: at(MON, '09:05'), flightEnd: at(MON, '11:15') },
          // Azonos gépen a pár után a fordulóidő (15 perc) a nagyobb.
          { requestIds: ['t3', 't4'], bookingType: 'multiStudent', resourceId: 'p1', flightStart: at(MON, '11:30'), flightEnd: at(MON, '13:40') },
        ],
      },
    ])
    // Minden tag foglalása a közös kezdéstől a közös végig tart, a repülése a sajátja.
    expect(['t1', 't2', 't3', 't4'].map((id) => [slotOf(r, id)?.flightStart, slotOf(r, id)?.flightEnd])).toEqual([
      [at(MON, '09:05'), at(MON, '10:05')],
      [at(MON, '10:15'), at(MON, '11:15')],
      [at(MON, '11:30'), at(MON, '12:30')],
      [at(MON, '12:40'), at(MON, '13:40')],
    ])
    for (const p of r.proposals) {
      expect(p).toMatchObject({ teamId: 'T', decidedBy: 'engine', slot: { start: at(MON, '08:00'), end: at(MON, '14:10') } })
      expect(p.warnings.filter((w) => w.kind === 'doubleBooking')).toEqual([])
    }
  })

  it('a sorrend a napi sorrend (NOV-05) szerint: aki előre kér, az kezd', () => {
    const s = baseSettings()
    const settings = { ...s, students: s.students.map((st) => (st.userId === 'n3' ? { ...st, dayOrder: 1 } : st)) }
    const r = plan({ snapshot: baseSnapshot(), settings, requests: four(), decisions: [] })
    expect(r.teams[0]!.units.map((u) => u.requestIds)).toEqual([
      ['t3', 't1'],
      ['t2', 't4'],
    ])
  })

  it('páratlan létszám és más gép: a pár mellett egyéni foglalás, a gép első repülése előtt motorpróba', () => {
    const s = baseSettings()
    const settings = { ...s, students: s.students.map((st) => (st.userId === 'n3' ? { ...st, allowedResources: [{ aircraftType: 'CESSNA 152' }] } : st)) }
    const requests = four().slice(0, 3)
    const r = plan({ snapshot: baseSnapshot(), settings, requests, decisions: [] })
    expect(r.teams[0]).toMatchObject({
      start: at(MON, '08:00'),
      end: at(MON, '13:05'),
      units: [
        { requestIds: ['t1', 't2'], bookingType: 'multiStudent', resourceId: 'p1', flightStart: at(MON, '09:05'), flightEnd: at(MON, '11:15') },
        { requestIds: ['t3'], bookingType: 'singleStudent', resourceId: 'c1', flightStart: at(MON, '11:35'), flightEnd: at(MON, '12:35') },
      ],
    })
  })

  it('feladat nélkül nincs pár (a FlightLogger így nem regisztrálná): egyéni foglalások fordulóidővel', () => {
    const requests = four({ lectureId: undefined, taskSelectionMode: 'none' }).slice(0, 2).map(({ lectureId: _l, ...r }) => r)
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests, decisions: [] })
    expect(r.teams[0]!.units).toEqual([
      { requestIds: ['t1'], bookingType: 'singleStudent', resourceId: 'p1', flightStart: at(MON, '09:05'), flightEnd: at(MON, '10:05') },
      { requestIds: ['t2'], bookingType: 'singleStudent', resourceId: 'p1', flightStart: at(MON, '10:20'), flightEnd: at(MON, '11:20') },
    ])
  })
})

describe('csapatdöntések és dilemmák (KBR-07)', () => {
  it('a csapatdöntés a közös kezdést és a gépet adja; a többi tag is oda kerül', () => {
    const decisions: Decision[] = [{ kind: 'assign', requestId: 't1', slot: { start: at(WED, '09:00'), end: at(WED, '15:10'), resourceId: 'p2' }, acceptWarnings: false, team: 'T' }]
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: four(), decisions })
    expect(r.decisionIssues).toEqual([])
    expect(r.teams[0]).toMatchObject({ start: at(WED, '09:00'), units: [{ requestIds: ['t1', 't2'], resourceId: 'p2' }, { requestIds: ['t3', 't4'], resourceId: 'p2' }] })
    expect(r.proposals.every((p) => p.decidedBy === 'instructor')).toBe(true)
  })

  it('csapattagra egyéni elhelyező döntés nem alkalmazható', () => {
    const decisions: Decision[] = [{ kind: 'assign', requestId: 't2', slot: { start: at(WED, '09:00'), end: at(WED, '11:15'), flightStart: at(WED, '09:45'), flightEnd: at(WED, '10:45'), resourceId: 'p1' }, acceptWarnings: false }]
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: four(), decisions })
    expect(r.decisionIssues.map((i) => i.decisionIndex)).toEqual([0])
    expect(r.teams[0]!.state).toBe('placed')
  })

  it('ha együtt sehol nem fér be: dilemma; „ezen a héten egyénileg” után a tagok egyenként kerülnek helyre', () => {
    const s = baseSettings()
    const short = { start: '08:00', end: '12:00' }
    const settings = { ...s, instructor: { ...s.instructor, workWindows: { mon: short, tue: short, wed: short, thu: short, fri: short, sat: null, sun: null } } }
    const r = plan({ snapshot: baseSnapshot(), settings, requests: four(), decisions: [] })
    expect(r.dilemmas.map((d) => [d.type, d.requestIds, d.recommendedOptionId])).toEqual([['team', ['t1', 't2', 't3', 't4'], 'csapat:T:solo']])
    expect(r.dilemmas[0]!.options.map((o) => o.id)).toEqual(['csapat:T:solo', 'csapat:T:defer'])
    expect(r.unplaced.map((u) => u.requestId)).toEqual(['t1', 't2', 't3', 't4'])
    expect(r.teams[0]).toMatchObject({ state: 'unplaced', units: [] })
    expect(r.proposals).toEqual([])

    const solo = r.dilemmas[0]!.options[0]!
    const after = plan({ snapshot: baseSnapshot(), settings, requests: four(), decisions: [solo.decision, ...(solo.also ?? [])] })
    // Egyénileg a szokásos dilemmák jöhetnek (például verseny), csapatdilemma nem.
    expect(after.dilemmas.filter((d) => d.type === 'team')).toEqual([])
    expect(after.teams).toEqual([])
    expect(after.proposals.map((p) => [p.requestId, p.teamId]).sort()).toEqual([['t1', undefined], ['t2', undefined], ['t3', undefined], ['t4', undefined]])
  })

  it('a limit a csapattársakkal együtt számít: tagonként tiszta, együtt figyelmeztetéses hely vállalható', () => {
    const s = baseSettings()
    const settings = { ...s, limits: { ...s.limits, rules: s.limits.rules.map((rule) => (rule.id === 'oktato-repult-nap' ? { ...rule, limit: 3 } : rule)) } }
    const r = plan({ snapshot: baseSnapshot(), settings, requests: four(), decisions: [] })
    const d = r.dilemmas.find((x) => x.type === 'team')!
    expect(d.options.map((o) => o.id)).toEqual(['csapat:T:accept', 'csapat:T:solo', 'csapat:T:defer'])
    // A napi limit túllépése súlyos figyelmeztetés: az ajánlás az egyéni tervezés.
    expect(d.recommendedOptionId).toBe('csapat:T:solo')
    const accept = d.options[0]!
    expect([accept.decision, ...(accept.also ?? [])].map((x) => [x.kind, x.requestId, x.kind === 'assign' ? x.team : undefined])).toEqual([
      ['assign', 't1', 'T'],
      ['assign', 't2', 'T'],
      ['assign', 't3', 'T'],
      ['assign', 't4', 'T'],
    ])
    const after = plan({ snapshot: baseSnapshot(), settings, requests: four(), decisions: [accept.decision, ...(accept.also ?? [])] })
    expect(after.dilemmas.filter((x) => x.type === 'team')).toEqual([])
    expect(after.teams[0]!.state).toBe('placed')
    expect(after.proposals.some((p) => p.warnings.some((w) => w.kind === 'limitExceeded'))).toBe(true)
  })
})

describe('a csapat életciklusa (KBR-05, KBR-06)', () => {
  it('halasztás után egy tag marad: nem csapat, egyénileg tervezett, jelzéssel', () => {
    const requests = four().slice(0, 2)
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests, decisions: [{ kind: 'defer', requestId: 't2' }] })
    expect(r.teams).toEqual([])
    expect(r.deferred).toEqual(['t2'])
    expect(r.proposals.map((p) => [p.requestId, p.teamId])).toEqual([['t1', undefined]])
    expect(r.warnings.filter((w) => w.kind === 'team').map((w) => w.requestId)).toEqual(['t1'])
  })

  it('a rögzített pár után a többiek a közös kezdéshez igazodnak', () => {
    const base = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: four(), decisions: [] })
    const recorded = ['t1', 't2'].map((id) => ({ requestId: id, slot: slotOf(base, id)!, at: '2026-11-15T10:00:00.000Z' }))
    expect(Date.parse(recorded[0]!.at) > Date.parse(PLANNED_AT)).toBe(true)
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: four(), decisions: [], recorded })
    expect(r.proposals.filter((p) => p.recorded).map((p) => p.requestId)).toEqual(['t1', 't2'])
    expect(['t3', 't4'].map((id) => slotOf(r, id))).toEqual(['t3', 't4'].map((id) => slotOf(base, id)))
    expect(r.teams[0]!.units.map((u) => u.requestIds)).toEqual([
      ['t1', 't2'],
      ['t3', 't4'],
    ])
  })

  it('a FlightLoggerben lévő pár után: a csapattárs foglalása nem kettős foglalás', () => {
    const pair = existing('fl-pair', {
      type: 'multiStudent',
      start: at(MON, '08:00'),
      end: at(MON, '14:10'),
      flightStart: at(MON, '09:05'),
      flightEnd: at(MON, '11:15'),
      resourceId: 'p1',
      instructorId: INSTRUCTOR,
      participantIds: ['n1', 'n2'],
      lessons: [
        { studentId: 'n1', lectureId: 'L7', flightMinutes: 60 },
        { studentId: 'n2', lectureId: 'L7', flightMinutes: 60 },
      ],
    })
    const r = plan({ snapshot: baseSnapshot({ bookings: [pair] }), settings: baseSettings(), requests: four(), decisions: [] })
    expect(r.recordedInFlightLogger.map((l) => l.requestId).sort()).toEqual(['t1', 't2'])
    expect(r.dilemmas).toEqual([])
    expect(['t3', 't4'].map((id) => [slotOf(r, id)?.start, slotOf(r, id)?.flightStart])).toEqual([
      [at(MON, '08:00'), at(MON, '11:30')],
      [at(MON, '08:00'), at(MON, '12:40')],
    ])
    expect(r.proposals.flatMap((p) => p.warnings).filter((w) => w.kind === 'doubleBooking')).toEqual([])
  })
})
