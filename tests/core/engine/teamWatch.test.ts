import { describe, expect, it } from 'vitest'
import { createWeekPlan, planTeamMove, teamsOf, type WeekPlan } from '../../../src/core/draft/weekPlan'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { flightLoggerTeams } from '../../../src/core/engine/teams'
import { watchWeek, type WatchItem } from '../../../src/core/engine/weekWatch'
import type { BookingRequest, ExistingBooking } from '../../../src/core/model/planning'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR, TZ, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Hét közbeni figyelés közös briefing csapatoknál (KBR-10, KBR-11): a FlightLoggerben közös
 * kezdéssel felvett foglalások egymással nem ütköznek, és a csapat egy javaslatként mozog.
 * Szintetikus adat.
 */

const MON = DAYS[0]!
const DURATIONS = { briefing: 45, main: 60, debriefing: 30 }
const member = (id: string, studentId: string, extra: Partial<BookingRequest> = {}): BookingRequest =>
  flight(id, studentId, { lectureId: 'L7', taskSelectionMode: 'manual', durations: DURATIONS, ...extra })

/** A tervdokumentum példája a FlightLoggerben: két pár hétfőn, közös kezdéssel és véggel. */
const pair = (id: string, students: [string, string], flightStart: string, flightEnd: string): ExistingBooking =>
  existing(id, {
    type: 'multiStudent',
    start: at(MON, '08:00'),
    end: at(MON, '14:10'),
    flightStart: at(MON, flightStart),
    flightEnd: at(MON, flightEnd),
    resourceId: 'p1',
    instructorId: INSTRUCTOR,
    participantIds: [...students],
    lessons: students.map((studentId) => ({ studentId, lectureId: 'L7', flightMinutes: 60 })),
  })
const X = pair('fl-x', ['n1', 'n2'], '09:05', '11:15')
const Y = pair('fl-y', ['n3', 'n4'], '11:30', '13:40')

const badMonday = () => weekWeather((d) => d === MON)
const dateOf = (iso: string): string => localParts(toMs(iso), TZ).date

function watch(requests: BookingRequest[], bookings: ExistingBooking[], weather = weekWeather(), settings = baseSettings()) {
  const input: PlanInput = { snapshot: baseSnapshot({ bookings, weather }), settings, requests, decisions: [] }
  const base = plan(input)
  return { input, base, watch: watchWeek(input, base) }
}

const team = (extra: Partial<BookingRequest> = {}): BookingRequest[] => ['n1', 'n2', 'n3', 'n4'].map((n, i) => member(`t${i + 1}`, n, extra))

describe('a FlightLoggerben közös kezdéssel felvett foglalások (KBR-10)', () => {
  it('felismeri az azonos kezdésű, egymás után repülő foglalásokat; az átfedőket és a magában álló egyénit nem', () => {
    const single = existing('egyedi', { start: at(MON, '08:00'), end: at(MON, '10:00'), flightStart: at(MON, '08:45'), flightEnd: at(MON, '09:45'), resourceId: 'p2', instructorId: 'masik', participantIds: ['n5'] })
    const overlapping = existing('atfedo', { ...Y, id: 'atfedo', type: 'singleStudent', instructorId: 'masik2', flightStart: at(MON, '09:00'), flightEnd: at(MON, '10:00') })
    const overlapping2 = existing('atfedo2', { ...overlapping, id: 'atfedo2', flightStart: at(MON, '09:30'), flightEnd: at(MON, '10:30') })
    const groups = flightLoggerTeams([X, Y, single, overlapping, overlapping2])
    expect([...groups.keys()].sort()).toEqual(['fl-x', 'fl-y'])
    expect(groups.get('fl-x')).toBe(groups.get('fl-y'))
  })

  it('a FlightLoggerben lévő pár jó időben nem kap javaslatot (a két növendék közös ideje nem ütközés)', () => {
    const { base, watch: w } = watch(team().slice(0, 2), [X])
    expect(base.recordedInFlightLogger.map((l) => l.requestId).sort()).toEqual(['t1', 't2'])
    expect(w.items).toEqual([])
  })

  it('a csapat foglalásai jó időben sem ütköznek egymással', () => {
    const { watch: w } = watch(team({ briefingTeamId: 'T' }), [X, Y])
    expect(w.watched.booked).toBe(4)
    expect(w.items).toEqual([])
  })
})

describe('a csapat a hét közbeni figyelésben (KBR-11)', () => {
  it('rossz időben a csapat egy javaslatként mozog, minden taggal; elfogadás után együtt kerül az új helyre', () => {
    const requests = team({ briefingTeamId: 'T' })
    const { input, watch: w } = watch(requests, [X, Y], badMonday())
    expect(w.items).toHaveLength(1)
    const item = w.items[0] as Extract<WatchItem, { kind: 'move' }>
    expect(item).toMatchObject({ kind: 'move', urgent: true, requestId: 't1', bookingId: 'fl-x', team: { teamId: 'T' } })
    expect(item.team!.members.map((m) => [m.requestId, m.bookingId])).toEqual([
      ['t1', 'fl-x'],
      ['t2', 'fl-x'],
      ['t3', 'fl-y'],
      ['t4', 'fl-y'],
    ])
    const to = item.team!.members.map((m) => m.to)
    expect(new Set(to.map((s) => s.start)).size).toBe(1)
    expect(dateOf(to[0]!.start)).not.toBe(MON)

    // Elfogadás a foglalási tervbe: mindegyik foglalás áthelyezendő, a csapat együtt az új helyen.
    const week: WeekPlan = { ...createWeekPlan(MON, '2026-11-15T10:00:00.000Z'), requests, briefingTeams: [{ id: 'T', origin: 'auto', createdAt: '2026-11-15T09:00:00.000Z' }] }
    const accepted = planTeamMove(week, item.team!.teamId, item.team!.members.map((m) => ({ requestId: m.requestId, ...(m.bookingId ? { bookingId: m.bookingId } : {}), slot: m.to })), '2026-11-15T10:00:00.000Z')
    const changes = Object.entries(accepted.flChanges ?? {}).map(([requestId, c]) => ({ kind: 'move' as const, requestId, bookingId: c.bookingId }))
    const after = plan({ ...input, decisions: accepted.decisions, changes })
    expect(after.dilemmas).toEqual([])
    expect(after.teams[0]).toMatchObject({ state: 'placed', start: to[0]!.start })
    expect(after.proposals.map((p) => [p.requestId, p.change?.bookingId])).toEqual([
      ['t1', 'fl-x'],
      ['t2', 'fl-x'],
      ['t3', 'fl-y'],
      ['t4', 'fl-y'],
    ])
    expect(after.supersededBookings).toEqual(['fl-x', 'fl-y'])
  })

  it('a FlightLoggerben közvetlenül felvett csapatból elfogadáskor kézi csapat lesz', () => {
    const requests = team()
    const { watch: w } = watch(requests, [X, Y], badMonday())
    expect(w.items).toHaveLength(1)
    const item = w.items[0] as Extract<WatchItem, { kind: 'move' }>
    expect(item.team?.teamId).toBeUndefined()
    const week: WeekPlan = { ...createWeekPlan(MON, '2026-11-15T10:00:00.000Z'), requests }
    const accepted = planTeamMove(week, undefined, item.team!.members.map((m) => ({ requestId: m.requestId, ...(m.bookingId ? { bookingId: m.bookingId } : {}), slot: m.to })), '2026-11-15T10:00:00.000Z', 'K1')
    expect(teamsOf(accepted).map((t) => [t.id, t.origin, t.memberIds])).toEqual([['K1', 'manual', ['t1', 't2', 't3', 't4']]])
  })

  it('ha a csapat egyben sehol nem fér be, a tagok kiválva, egyenként kapnak javaslatot', () => {
    const s = baseSettings()
    const short = { start: '08:00', end: '11:00' }
    // Hétfőn a csapat már bent van (a FlightLoggerben), a hét többi napján csak rövid a munkaidő.
    const settings = { ...s, instructor: { ...s.instructor, workWindows: { mon: { start: '08:00', end: '16:00' }, tue: short, wed: short, thu: short, fri: short, sat: null, sun: null } } }
    const { watch: w } = watch(team({ briefingTeamId: 'T' }), [X, Y], badMonday(), settings)
    expect(w.items.length).toBeGreaterThan(0)
    for (const item of w.items) {
      expect(item.kind).toBe('move')
      if (item.kind !== 'move') continue
      expect(item.team).toBeUndefined()
      expect(item.leavesTeam).toBe('T')
      expect(dateOf(item.to.start)).not.toBe(MON)
    }
  })
})
