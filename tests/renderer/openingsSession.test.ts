import { describe, expect, it } from 'vitest'
import { addExtraRequest, createWeekPlan, dismissWatch, removeExtraRequest, undeferRequest, WeekPlanSchema, type WeekPlan } from '../../src/core/draft/weekPlan'
import { CAPACITY_DISMISSAL_ID } from '../../src/core/engine/openings'
import { plan, type PlanInput } from '../../src/core/engine/plan'
import { defaultFlightRequest } from '../../src/core/draft/weekPlan'
import { newFlightRequest, takenLectureIds } from '../../src/core/progress/autoAssign'
import { computeProgress, type LectureInfo, type TrainingRecord } from '../../src/core/progress/lectures'
import { createOpeningsSession } from '../../src/renderer/src/openingsSession'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, PLANNED_AT, WEEK_START } from '../fixtures/syntheticWeek'

/**
 * „Van még hely?” (KIT-02–05): a közös igényfelvétel, a felvétel és visszahozás a tervezetben,
 * és a tervező szálon futó keresés, amely a lehetőségek teljes bemenetét a szálon tartja.
 */

const settings = baseSettings()
const available = (students: readonly string[]) =>
  Object.fromEntries(students.map((id) => [id, [{ start: at(DAYS[0]!, '00:00'), end: at(DAYS[6]!, '23:00'), unavailable: false }]]))

const L = (id: string, name: string): LectureInfo => ({ id, name, revisionId: 'rev', briefingMinutes: 45, flightMinutes: 60, debriefingMinutes: 30, simulator: false, night: false })
const catalog: Record<string, LectureInfo> = Object.fromEntries([L('a1', 'III./17. PIC I.'), L('a2', 'III./18. PIC II.'), L('a3', 'III./19. PIC III.')].map((l) => [l.id, l]))
const rec = (lectureId: string, day: number): TrainingRecord => ({ lectureId, status: 'PASSED', at: new Date(Date.UTC(2026, 10, day, 10)).toISOString(), revisionId: 'rev' })
const progress = computeProgress([rec('a1', 6)], catalog)

describe('közös igényfelvétel (KIT-05)', () => {
  it('a soron következő, még nem foglalt feladattal, a Heti igények felvételével azonosan', () => {
    const taken = takenLectureIds({ studentId: 'n1', requests: [], progress, catalog, bookings: [], nowMs: Date.parse(PLANNED_AT) })
    const r = newFlightRequest({ settings, studentId: 'n1', id: 'x', taken, progress, catalog })
    expect(r).toEqual(defaultFlightRequest(settings, 'n1', 'x', catalog.a2))
    expect(r.priority).toBeUndefined()
  })

  it('átugorja a hét más igénye által tartott és a FlightLoggerben lefoglalt feladatot; a plusz igény a kitöltő elsőbbséget kapja', () => {
    const held = { ...flight('h', 'n1'), lectureId: 'a2' }
    const taken = takenLectureIds({ studentId: 'n1', requests: [held], progress, catalog, bookings: [], nowMs: Date.parse(PLANNED_AT) })
    const r = newFlightRequest({ settings, studentId: 'n1', id: 'x', taken, progress, catalog, priority: 3 })
    expect(r.lectureId).toBe('a3')
    expect(r.priority).toBe(3)
    const booking = existing('b1', {
      start: at(DAYS[3]!, '09:00'),
      end: at(DAYS[3]!, '11:00'),
      participantIds: ['n1'],
      lessons: [{ studentId: 'n1', lectureName: 'III./19. PIC III.' }],
    })
    const both = takenLectureIds({ studentId: 'n1', requests: [held], progress, catalog, bookings: [booking], nowMs: Date.parse(PLANNED_AT) })
    expect([...both].sort()).toEqual(['a2', 'a3'])
  })
})

describe('felvétel és visszahozás a tervezetben (KIT-03, KIT-05)', () => {
  const week: WeekPlan = { ...createWeekPlan(WEEK_START, PLANNED_AT), requests: [flight('a', 'n1')], selectedStudentIds: ['n1'] }

  it('a plusz igény rendes igény időpont nélkül; a növendék felkerül a hétre, a visszavonás mindent visszaállít', () => {
    const extra = { ...flight('p', 'n2'), priority: 3 }
    const added = addExtraRequest(week, extra)
    expect(added.requests.map((r) => r.id)).toEqual(['a', 'p'])
    expect(added.selectedStudentIds).toEqual(['n1', 'n2'])
    expect(added.decisions).toEqual([])
    const withDecision: WeekPlan = { ...added, decisions: [{ kind: 'assign', requestId: 'p', slot: { start: at(DAYS[1]!, '09:00'), end: at(DAYS[1]!, '11:00') }, acceptWarnings: false }] }
    const undone = removeExtraRequest(withDecision, 'p', ['n2'])
    expect(undone.requests).toEqual(week.requests)
    expect(undone.decisions).toEqual([])
    expect(undone.selectedStudentIds).toEqual(['n1'])
  })

  it('a visszavonás nem veszi le a növendéket, ha közben más igénye is lett, vagy már előtte is a héten volt', () => {
    const added = addExtraRequest(week, { ...flight('p', 'n1'), priority: 3 })
    expect(added.selectedStudentIds).toEqual(['n1'])
    expect(removeExtraRequest(added, 'p', []).selectedStudentIds).toEqual(['n1'])
    const two = { ...addExtraRequest(week, flight('p', 'n2')), requests: [...addExtraRequest(week, flight('p', 'n2')).requests, flight('q', 'n2')] }
    expect(removeExtraRequest(two, 'p', ['n2']).selectedStudentIds).toEqual(['n1', 'n2'])
  })

  it('a „van még hely” napi elutasítása a tervezetben tárolható, és az új nap felülírja (KIT-07)', () => {
    const first = dismissWatch(week, CAPACITY_DISMISSAL_ID, 'capacity', '2026-11-14T23:00:00.000Z', PLANNED_AT)
    const next = dismissWatch(first, CAPACITY_DISMISSAL_ID, 'capacity', '2026-11-15T23:00:00.000Z', PLANNED_AT)
    expect(next.watchDismissals).toEqual([{ requestId: CAPACITY_DISMISSAL_ID, kind: 'capacity', from: '2026-11-15T23:00:00.000Z', at: PLANNED_AT }])
    expect(WeekPlanSchema.safeParse(next).success).toBe(true)
  })

  it('visszahozásnál csak a halasztás szűnik meg, elhelyező döntés nem kerül mellé; a visszavonás a halasztást hozza vissza', () => {
    const deferred: WeekPlan = {
      ...week,
      decisions: [{ kind: 'defer', requestId: 'a' }],
      watchDismissals: [{ requestId: 'a', kind: 'restore', at: PLANNED_AT }],
    }
    const { plan: restored, removed } = undeferRequest(deferred, 'a')
    expect(restored.decisions).toEqual([])
    expect(restored.watchDismissals).toEqual([])
    expect(removed).toEqual([{ kind: 'defer', requestId: 'a' }])
  })
})

describe('keresés a tervező szálon (KIT-01, KIT-04)', () => {
  const snapshot = baseSnapshot({ availabilities: available(['n1', 'n2', 'n3', 'n4', 'n5']) })
  const input: PlanInput = { snapshot, settings, requests: [flight('a', 'n1'), flight('b', 'n2')], decisions: [], options: { now: PLANNED_AT } }
  const result = plan(input)
  const request = { input, result, catalog: {}, progress: {} }

  it('a lista a teljes bemenet nélkül jön vissza (a szálak között kicsi marad), a próba a kulccsal kérhető', () => {
    const session = createOpeningsSession()
    const list = session.find(request)
    expect(list.students.length).toBeGreaterThan(0)
    const option = list.students[0]!.options[0]!
    expect('next' in option).toBe(false)
    const trial = session.trial(list.token, list.students[0]!.studentId, option.key)
    expect('result' in trial).toBe(false)
    expect(trial.ok).toBe(true)
    expect(trial.placed?.requestId).toBe(option.request.id)
  })

  it('a felvett igény ugyanoda kerül, ahová a próba mondta', () => {
    const session = createOpeningsSession()
    const list = session.find(request)
    const student = list.students.find((s) => s.studentId === 'n4')!
    const option = student.options[0]!
    const trial = session.trial(list.token, student.studentId, option.key)
    const after = plan({ ...input, requests: [...input.requests, option.request] })
    expect(after.proposals.find((p) => p.requestId === option.request.id)?.slot).toEqual(trial.placed?.slot)
  })

  it('régebbi keresés lehetőségére a próba hibát ad (a lista újraszámol)', () => {
    const session = createOpeningsSession()
    const first = session.find(request)
    session.find(request)
    const s = first.students[0]!
    expect(() => session.trial(first.token, s.studentId, s.options[0]!.key)).toThrow(/elavult/)
    const second = session.find(request)
    expect(() => session.trial(second.token, s.studentId, 'nincs-ilyen')).toThrow(/már nem szerepel/)
  })
})
