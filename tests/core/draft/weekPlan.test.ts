import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import { workWindowOn } from '../../../src/core/config/operations'
import { applyLecture, createWeekPlan, setBriefingSource, setRequestTask, syncBriefingTimes, defaultFlightRequest, defaultWeekStart, moveRequest, relativeWeekLabel, removeRequest, requestTotals, resetRequest, setComment, WeekPlanSchema, type WeekPlan } from '../../../src/core/draft/weekPlan'

const NOW = '2026-11-15T10:00:00.000Z'
const slot = { start: '2026-11-16T07:00:00.000Z', end: '2026-11-16T09:00:00.000Z' }

describe('heti tervezet', () => {
  it('a hetet a mai naphoz képest nevezi meg', () => {
    const today = '2026-11-11'
    expect(relativeWeekLabel('2026-11-09', today)).toBe('ez a hét')
    expect(relativeWeekLabel('2026-11-16', today)).toBe('jövő hét')
    expect(relativeWeekLabel('2026-11-23', today)).toBe('jövő utáni hét')
    expect(relativeWeekLabel('2026-11-30', today)).toBe('3 hét múlva')
    expect(relativeWeekLabel('2026-11-02', today)).toBe('múlt hét')
    expect(relativeWeekLabel('2026-10-26', today)).toBe('múlt előtti hét')
    expect(relativeWeekLabel('2026-10-19', today)).toBe('3 héttel ezelőtt')
    // Vasárnap még az aktuális hét; a hétfő a következő.
    expect(relativeWeekLabel('2026-11-16', '2026-11-15')).toBe('jövő hét')
    // Évváltáson és óraátállításon át is egész hetet számol.
    expect(relativeWeekLabel('2027-01-04', '2026-12-30')).toBe('jövő hét')
    expect(relativeWeekLabel('2026-03-30', '2026-03-25')).toBe('jövő hét')
  })

  it('csütörtökig az aktuális, péntektől a következő hetet nyitja meg (K19)', () => {
    expect(defaultWeekStart('2026-11-09')).toBe('2026-11-09') // hétfő
    expect(defaultWeekStart('2026-11-11')).toBe('2026-11-09') // szerda
    expect(defaultWeekStart('2026-11-12')).toBe('2026-11-09') // csütörtök
    expect(defaultWeekStart('2026-11-13')).toBe('2026-11-16') // péntek
    expect(defaultWeekStart('2026-11-14')).toBe('2026-11-16') // szombat
    expect(defaultWeekStart('2026-11-15')).toBe('2026-11-16') // vasárnap
    expect(defaultWeekStart('2026-11-18')).toBe('2026-11-16')
    // Évváltáson át is.
    expect(defaultWeekStart('2027-01-01')).toBe('2027-01-04') // péntek
    expect(defaultWeekStart('2026-12-31')).toBe('2026-12-28') // csütörtök
  })

  it('a halasztott igények átkerülnek a következő hétre (TRV-17)', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }] }
    const previous = {
      ...createWeekPlan('2026-11-09', NOW),
      requests: [defaultFlightRequest(settings, 'n1', 'r1'), defaultFlightRequest(settings, 'n1', 'r2')],
      decisions: [{ kind: 'defer' as const, requestId: 'r2' }],
    }
    const next = createWeekPlan('2026-11-16', NOW, previous)
    expect(next.requests.map((r) => [r.id, r.origin, r.deferredFromWeek])).toEqual([['r2-h', 'deferred', '2026-11-09']])
    expect(next.selectedStudentIds).toEqual(['n1'])
    expect(WeekPlanSchema.safeParse(next).success).toBe(true)
  })

  it('feladat nélkül a feladat nélküli alapértékeket használja (TRV-21)', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }] }
    const r = defaultFlightRequest(settings, 'n1', 'r')
    expect(r.durations).toEqual({ briefing: 45, main: 60, debriefing: 30 })
    expect(r.lectureId).toBeUndefined()
  })

  it('a feladatból veszi a repülés idejét, a fajtát és a nappali jelleget; a briefing alapból a beállításé (SZB-02)', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }] }
    const night = { id: 'l1', name: 'III./12. Szintetikus éjszakai', briefingMinutes: 40, flightMinutes: 70, debriefingMinutes: 20, simulator: false, night: true }
    const r = defaultFlightRequest(settings, 'n1', 'r', night)
    expect(r).toMatchObject({ lectureId: 'l1', kind: 'flight', durations: { briefing: 45, main: 70, debriefing: 30 }, daylightOnly: false, taskSelectionMode: 'automatic' })
    const sim = { ...night, id: 'l2', simulator: true, night: false }
    expect(applyLecture(settings, r, sim)).toMatchObject({ lectureId: 'l2', kind: 'simulator', daylightOnly: false })
    expect(applyLecture(settings, r, undefined).lectureId).toBeUndefined()
  })

  it('feladat nélküli módban nem választ feladatot', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [], taskSelectionMode: 'none' as const }] }
    const lecture = { id: 'l1', name: 'I./1. X', briefingMinutes: 45, flightMinutes: 30, debriefingMinutes: 30, simulator: false, night: false }
    expect(defaultFlightRequest(settings, 'n1', 'r', lecture).lectureId).toBeUndefined()
  })

  it('a kézi mozgatás felülírja az igény korábbi elhelyezését (TRV-10)', () => {
    let plan: WeekPlan = { ...createWeekPlan('2026-11-16', NOW), decisions: [{ kind: 'defer', requestId: 'r1' }, { kind: 'comment', requestId: 'r1', comment: 'x' }] }
    plan = moveRequest(plan, 'r1', slot)
    expect(plan.decisions).toEqual([{ kind: 'comment', requestId: 'r1', comment: 'x' }, { kind: 'assign', requestId: 'r1', slot, acceptWarnings: true, fromDraft: true }])
    expect(resetRequest(plan, 'r1').decisions).toEqual([{ kind: 'comment', requestId: 'r1', comment: 'x' }])
  })

  it('komment beállítása és törlése (TRV-07, TRV-09)', () => {
    let plan = setComment(createWeekPlan('2026-11-16', NOW), 'r1', '  standby  ')
    expect(plan.decisions).toEqual([{ kind: 'comment', requestId: 'r1', comment: 'standby' }])
    plan = setComment(plan, 'r1', '')
    expect(plan.decisions).toEqual([])
  })

  it('az igény törlése a döntéseit is törli (TRV-20)', () => {
    const settings = createDefaultSettings()
    const plan = { ...createWeekPlan('2026-11-16', NOW), requests: [defaultFlightRequest(settings, 'n1', 'r1')], decisions: [{ kind: 'defer' as const, requestId: 'r1' }] }
    expect(removeRequest(plan, 'r1')).toMatchObject({ requests: [], decisions: [] })
  })

  it('összesíti a heti repült időt az igények alapján, növendékenként is (TRV-20)', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }, { userId: 'n2', allowedResources: [] }] }
    const f = (id: string, student: string, main: number) => ({ ...defaultFlightRequest(settings, student, id), durations: { briefing: 30, main, debriefing: 15 } })
    const sim = { ...f('s1', 'n2', 90), kind: 'simulator' as const }
    const theory = { ...f('t1', 'n1', 120), kind: 'theory' as const }
    const { total, byStudent } = requestTotals([f('a', 'n1', 60), f('b', 'n1', 75), f('c', 'n2', 50), sim, theory])
    expect(total).toEqual({ flightMinutes: 185, flightCount: 3, simulatorMinutes: 90, simulatorCount: 1, instructorMinutes: 185 + 90 + 4 * 45 })
    expect(byStudent.get('n1')).toMatchObject({ flightMinutes: 135, flightCount: 2, simulatorMinutes: 0 })
    expect(byStudent.get('n2')).toMatchObject({ flightMinutes: 50, simulatorMinutes: 90, simulatorCount: 1 })
  })

  it('a briefing és a debriefing forrása választható: alap, feladat szerint vagy kézi', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }] }
    const l1 = { id: 'l1', name: 'I./3. Szintetikus', briefingMinutes: 40, flightMinutes: 70, debriefingMinutes: 20, simulator: false, night: false }
    const l2 = { ...l1, id: 'l2', name: 'I./4. Szintetikus', briefingMinutes: 0, debriefingMinutes: 25, flightMinutes: 50 }
    const base = defaultFlightRequest(settings, 'n1', 'r', l1)

    const byLecture = setBriefingSource(settings, base, 'lecture', l1)
    expect(byLecture.durations).toEqual({ briefing: 40, main: 70, debriefing: 20 })
    // Feladatváltáskor a forrás marad; ahol a feladatban nincs érték, az alapérték jön.
    expect(applyLecture(settings, byLecture, l2).durations).toEqual({ briefing: 45, main: 50, debriefing: 25 })
    // Feladat nélkül a „feladat szerint” is az alapértékre esik vissza.
    expect(setRequestTask(settings, byLecture, { mode: 'none' }).durations).toMatchObject({ briefing: 45, debriefing: 30 })

    const manual = { ...base, briefingSource: 'manual' as const, durations: { ...base.durations, briefing: 15, debriefing: 10 } }
    expect(applyLecture(settings, manual, l2).durations).toEqual({ briefing: 15, main: 50, debriefing: 10 })
    expect(setBriefingSource(settings, manual, 'default', l2).durations).toEqual({ briefing: 45, main: 70, debriefing: 30 })
  })

  it('az alapérték változását követik a nem kézi igények, a kéziek nem', () => {
    const settings = { ...createDefaultSettings(), students: [{ userId: 'n1', allowedResources: [] }] }
    const l1 = { id: 'l1', name: 'I./3. Szintetikus', briefingMinutes: 40, flightMinutes: 70, debriefingMinutes: 20, simulator: false, night: false }
    const auto = defaultFlightRequest(settings, 'n1', 'a', l1)
    const lecture = setBriefingSource(settings, defaultFlightRequest(settings, 'n1', 'b', l1), 'lecture', l1)
    const manual = { ...auto, id: 'c', briefingSource: 'manual' as const, durations: { ...auto.durations, briefing: 15 } }
    const changed = { ...settings, defaults: { ...settings.defaults, briefingMinutes: 60 } }
    const [a, b, c] = syncBriefingTimes(changed, [auto, lecture, manual], { l1 })
    expect(a!.durations.briefing).toBe(60)
    expect(b).toBe(lecture)
    expect(c).toBe(manual)
  })
})

describe('útvonal a tervezetben (K27, SZB-19)', () => {
  const withRoute = (route: unknown): unknown => {
    const plan = createWeekPlan('2026-11-16', '2026-11-12T08:00:00.000Z')
    const request = { ...defaultFlightRequest(createDefaultSettings(), 'n1', 'igeny-1', undefined), route }
    return { ...plan, requests: [request] }
  }

  it('elfogadja a félig kitöltött útvonalat is (szerkesztés közben)', () => {
    expect(WeekPlanSchema.safeParse(withRoute({ departure: 'LHXX', stops: [{ icao: 'LH' }, { icao: 'LHYY', elapsedMinutes: 45 }] })).success).toBe(true)
  })

  it('a hibás kódot és szakaszidőt elutasítja', () => {
    expect(WeekPlanSchema.safeParse(withRoute({ departure: 'lhxx', stops: [] })).success).toBe(false)
    expect(WeekPlanSchema.safeParse(withRoute({ departure: 'LHXX', stops: [{ icao: 'LHYY', elapsedMinutes: 0 }] })).success).toBe(false)
  })
})

describe('időablakok a tervezetben (TRV-02)', () => {
  const withTiming = (timing: unknown): unknown => {
    const plan = createWeekPlan('2026-11-16', '2026-11-12T08:00:00.000Z')
    const request = { ...defaultFlightRequest(createDefaultSettings(), 'n1', 'igeny-1', undefined), timing }
    return { ...plan, requests: [request] }
  }

  it('több ablakot elfogad', () => {
    const windows = [
      { start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T11:00:00.000Z' },
      { start: '2026-11-19T13:00:00.000Z', end: '2026-11-19T17:00:00.000Z' },
    ]
    const parsed = WeekPlanSchema.safeParse(withTiming({ kind: 'preferred', windows }))
    expect(parsed.success && parsed.data.requests[0]!.timing).toEqual({ kind: 'preferred', windows })
  })

  it('a fordított vagy üres ablakot elutasítja, a pontos kezdést (nulla hosszú ablak) elfogadja', () => {
    expect(WeekPlanSchema.safeParse(withTiming({ kind: 'preferred', windows: [{ start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T08:00:00.000Z' }] })).success).toBe(true)
    expect(WeekPlanSchema.safeParse(withTiming({ kind: 'preferred', windows: [] })).success).toBe(false)
    expect(WeekPlanSchema.safeParse(withTiming({ kind: 'preferred', windows: [{ start: '2026-11-17T11:00:00.000Z', end: '2026-11-17T08:00:00.000Z' }] })).success).toBe(false)
  })

  it('a régi, egyetlen preferált kezdést pontos kezdési ablakká alakítja', () => {
    const parsed = WeekPlanSchema.safeParse(withTiming({ kind: 'preferred', start: '2026-11-17T08:00:00.000Z' }))
    expect(parsed.success && parsed.data.requests[0]!.timing).toEqual({ kind: 'preferred', windows: [{ start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T08:00:00.000Z' }] })
  })
})

describe('csak az időablakokon belül a tervezetben (TRV-02)', () => {
  it('megőrzi a „csak ezeken belül” jelölést', () => {
    const plan = createWeekPlan('2026-11-16', '2026-11-12T08:00:00.000Z')
    const timing = { kind: 'preferred' as const, onlyWithin: true, windows: [{ start: '2026-11-17T08:00:00.000Z', end: '2026-11-17T11:00:00.000Z' }] }
    const request = { ...defaultFlightRequest(createDefaultSettings(), 'n1', 'igeny-1', undefined), timing }
    const parsed = WeekPlanSchema.safeParse({ ...plan, requests: [request] })
    expect(parsed.success && parsed.data.requests[0]!.timing).toEqual(timing)
  })
})

describe('napi munkaidő (TRV-02 alapértékhez)', () => {
  it('a munkaidő és a nyitvatartás metszete; szabadnapon nincs', () => {
    const base = createDefaultSettings()
    const settings = { ...base, instructor: { ...base.instructor, workWindows: { ...base.instructor.workWindows, mon: { start: '08:00', end: '16:00' }, sun: null } } }
    expect(workWindowOn(settings, '2026-11-16')).toEqual({ start: 8 * 60, end: 16 * 60 })
    expect(workWindowOn(settings, '2026-11-22')).toBeUndefined()
  })
})
