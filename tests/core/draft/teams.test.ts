import { describe, expect, it } from 'vitest'
import { lessonCode, teamLessonCodes, teamPanelData } from '../../../src/core/draft/teamPanel'
import {
  addToTeamManually,
  createTeam,
  createWeekPlan,
  moveTeam,
  moveToTeam,
  normalizeTeams,
  rejoinTeam,
  removeFromTeam,
  removeRequest,
  teamsOf,
  WeekPlanSchema,
  type WeekPlan,
} from '../../../src/core/draft/weekPlan'
import type { BookingRequest } from '../../../src/core/model/planning'
import type { LectureInfo } from '../../../src/core/progress/lectures'

/** Közös briefing csapatok a heti tervezetben (KBR-03, KBR-04, KBR-05). Szintetikus adat. */

const NOW = '2026-11-15T10:00:00.000Z'
const LATER = '2026-11-15T10:05:00.000Z'
const slot = { start: '2026-11-16T07:00:00.000Z', end: '2026-11-16T09:00:00.000Z', flightStart: '2026-11-16T07:45:00.000Z', flightEnd: '2026-11-16T08:45:00.000Z', resourceId: 'p1' }

const req = (id: string, studentId: string): BookingRequest => ({
  id,
  kind: 'flight',
  studentIds: [studentId],
  lectureId: 'L7',
  taskSelectionMode: 'manual',
  durations: { briefing: 45, main: 60, debriefing: 30 },
  daylightOnly: true,
  origin: 'progress',
})

const week = (): WeekPlan => ({
  ...createWeekPlan('2026-11-16', NOW),
  requests: [req('r1', 'n1'), req('r2', 'n2'), req('r3', 'n3'), req('r4', 'n4')],
  decisions: [
    { kind: 'assign', requestId: 'r1', slot, acceptWarnings: false },
    { kind: 'comment', requestId: 'r1', comment: 'megjegyzés' },
  ],
})

const teamOf = (plan: WeekPlan, id: string): string | undefined => plan.requests.find((r) => r.id === id)?.briefingTeamId

describe('közös briefing csapatok a tervezetben', () => {
  it('a panel csapata: a tagok egyéni helye törlődik, a komment marad; a név a létrehozás sorrendjéből jön', () => {
    let plan = createTeam(week(), ['r1', 'r2'], 'auto', NOW, 'A')
    plan = createTeam(plan, ['r3', 'r4'], 'auto', NOW, 'B')
    expect(teamsOf(plan).map((t) => [t.id, t.label, t.memberIds])).toEqual([
      ['A', '1. csapat', ['r1', 'r2']],
      ['B', '2. csapat', ['r3', 'r4']],
    ])
    expect(plan.decisions).toEqual([{ kind: 'comment', requestId: 'r1', comment: 'megjegyzés' }])
    expect(WeekPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('kézi csapatba szervezés: az első újat nyit, a következő a legutóbbi kézi csapatba kerül, az automatikusba soha (KBR-04)', () => {
    const auto = createTeam(week(), ['r3', 'r4'], 'auto', NOW, 'A')
    const first = addToTeamManually(auto, 'r1', LATER, 'K1')
    expect(first).toMatchObject({ teamId: 'K1', created: true })
    const second = addToTeamManually(first.plan, 'r2', LATER)
    expect(second).toMatchObject({ teamId: 'K1', created: false })
    expect(teamsOf(second.plan).map((t) => [t.id, t.origin, t.memberIds])).toEqual([
      ['A', 'auto', ['r3', 'r4']],
      ['K1', 'manual', ['r1', 'r2']],
    ])
    // Új kézi csapat után a következő kézi szervezés már abba megy.
    const fresh = createTeam(second.plan, ['r2'], 'manual', LATER, 'K2')
    expect(addToTeamManually(fresh, 'r4', LATER).teamId).toBe('K2')
  })

  it('áthelyezés, kivétel és törlés: az üres csapat eltűnik, a tagság az igénnyel megy (KBR-05)', () => {
    let plan = createTeam(week(), ['r1', 'r2'], 'auto', NOW, 'A')
    plan = createTeam(plan, ['r3'], 'manual', LATER, 'K1')
    plan = moveToTeam(plan, 'r3', 'A')
    expect(teamOf(plan, 'r3')).toBe('A')
    expect(teamsOf(plan).map((t) => t.id)).toEqual(['A'])
    expect(plan.briefingTeams?.map((t) => t.id)).toEqual(['A'])
    // Csapatdöntés a tagon: kivételkor törlődik (a csapat kezdése már nem az övé).
    plan = { ...plan, decisions: [...plan.decisions, { kind: 'assign', requestId: 'r3', slot, acceptWarnings: false, team: 'A' }, { kind: 'teamOff', requestId: 'r3' }] }
    plan = removeFromTeam(plan, 'r3')
    expect(teamOf(plan, 'r3')).toBeUndefined()
    expect(plan.decisions.filter((d) => d.requestId === 'r3')).toEqual([])
    plan = removeRequest(removeRequest(plan, 'r1'), 'r2')
    expect(teamsOf(plan)).toEqual([])
    expect(normalizeTeams(plan, NOW).briefingTeams).toBeUndefined()
  })

  it('az ismeretlen csapatra hivatkozó igényhez kézi csapat jön létre', () => {
    const plan = { ...week(), requests: week().requests.map((r) => (r.id === 'r1' || r.id === 'r2' ? { ...r, briefingTeamId: 'X' } : r)) }
    expect(teamsOf(normalizeTeams(plan, NOW)).map((t) => [t.id, t.origin, t.memberIds])).toEqual([['X', 'manual', ['r1', 'r2']]])
  })

  it('a halasztott tag csapat nélkül megy át a következő hétre', () => {
    const plan = { ...createTeam(week(), ['r1', 'r2'], 'auto', NOW, 'A'), decisions: [{ kind: 'defer' as const, requestId: 'r2' }] }
    const next = createWeekPlan('2026-11-23', LATER, plan)
    expect(next.requests.map((r) => [r.id, r.briefingTeamId])).toEqual([['r2-h', undefined]])
  })
})

const lecture = (id: string, name: string, revisionId: string): LectureInfo => ({ id, name, revisionId, briefingMinutes: 45, flightMinutes: 60, debriefingMinutes: 30, simulator: false, night: false })
const CATALOG: Record<string, LectureInfo> = {
  'r6-7': lecture('r6-7', 'I./7. Traffic patterns I.', 'rev6'),
  'r7-7': lecture('r7-7', 'I./7. Traffic patterns I.', 'rev7'),
  'r7-8': lecture('r7-8', 'I./8. Traffic patterns II.', 'rev7'),
  'r7-17a': lecture('r7-17a', 'IV./17.A. Basic IFR – Instrument Patterns I.', 'rev7'),
}

describe('a „Közös briefing szervezése” panel (KBR-03)', () => {
  it('a feladat kódja revíziótól független', () => {
    expect(lessonCode('I./7. Traffic patterns I.')).toBe('I./7')
    expect(lessonCode('IV./17.A. Basic IFR')).toBe('IV./17.A')
    expect(lessonCode('Custom lesson - Szintetikus')).toBe('Custom lesson - Szintetikus')
  })

  it('feladatkód szerint csoportosít, csak ahol legalább két igény van; a tiltottakat okkal jelzi', () => {
    const requests: BookingRequest[] = [
      { ...req('a', 'n1'), lectureId: 'r6-7' },
      { ...req('b', 'n2'), lectureId: 'r7-7' },
      { ...req('c', 'n3'), lectureId: 'r7-7', timing: { kind: 'fixed', start: '2026-11-17T08:00:00.000Z' } },
      { ...req('d', 'n4'), lectureId: 'r7-8' },
      { ...req('e', 'n5'), lectureId: 'r7-7' },
      { ...req('f', 'n6'), lectureId: 'r7-17a' },
    ]
    const data = teamPanelData(requests, [{ kind: 'defer', requestId: 'e' }], CATALOG, new Set(['a']))
    expect(data.groups.map((g) => [g.code, g.requestIds])).toEqual([['I./7', ['a', 'b', 'c', 'e']]])
    expect([...data.blocked]).toEqual([
      ['a', 'booked'],
      ['c', 'fixed'],
      ['e', 'deferred'],
    ])
  })

  it('vegyes feladatú csapat felismerése', () => {
    const requests: BookingRequest[] = [
      { ...req('a', 'n1'), lectureId: 'r6-7', briefingTeamId: 'T' },
      { ...req('b', 'n2'), lectureId: 'r7-7', briefingTeamId: 'T' },
      { ...req('c', 'n3'), lectureId: 'r7-8', briefingTeamId: 'U' },
      { ...req('d', 'n4'), lectureId: 'r7-7', briefingTeamId: 'U' },
    ]
    expect(teamLessonCodes(requests, 'T', CATALOG)).toEqual(['I./7'])
    expect(teamLessonCodes(requests, 'U', CATALOG)).toEqual(['I./7', 'I./8'])
  })
})

describe('a csapat a tervezeten (KBR-08)', () => {
  it('a mozgatás minden tagnak csapatdöntést ad, a korábbi elhelyezés és az „egyénileg” helyett', () => {
    let plan = createTeam(week(), ['r1', 'r2'], 'auto', NOW, 'A')
    plan = { ...plan, decisions: [...plan.decisions, { kind: 'teamOff', requestId: 'r2' }] }
    const moved = moveTeam(plan, 'A', [
      { requestId: 'r1', slot },
      { requestId: 'r2', slot: { ...slot, resourceId: 'p2' } },
    ])
    expect(moved.decisions.filter((d) => d.kind !== 'comment')).toEqual([
      { kind: 'assign', requestId: 'r1', slot, acceptWarnings: true, fromDraft: true, team: 'A' },
      { kind: 'assign', requestId: 'r2', slot: { ...slot, resourceId: 'p2' }, acceptWarnings: true, fromDraft: true, team: 'A' },
    ])
    expect(rejoinTeam(plan, 'r2').decisions.some((d) => d.kind === 'teamOff')).toBe(false)
  })
})
