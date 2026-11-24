import { describe, expect, it } from 'vitest'
import type { Settings } from '../../../src/core/config/schema'
import { CAPACITY_DISMISSAL_ID, findOpenings, watchWithCapacity, type OpeningsInput, type StudentOpenings } from '../../../src/core/engine/openings'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { trialPlan, withRequests } from '../../../src/core/engine/trial'
import type { BookingRequest, Decision, ExistingBooking, PlanResult } from '../../../src/core/model/planning'
import type { Snapshot } from '../../../src/core/model/snapshot'
import { assignAutomaticLectures, lectureSequences } from '../../../src/core/progress/autoAssign'
import { computeProgress, type LectureInfo, type TrainingRecord } from '../../../src/core/progress/lectures'
import { at, badHour, baseSettings, baseSnapshot, DAYS, existing, flight, PLANNED_AT, rng, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Helykeresés és próbaszámolás (KIT-01–04, KIT-08): ki fér még be a héten, és a felvétel mit
 * tenne a tervvel. Szintetikus forgatókönyvek a terv szerint.
 */

interface State {
  readonly input: PlanInput
  readonly result: PlanResult
}

const state = (snapshot: Snapshot, settings: Settings, requests: readonly BookingRequest[], decisions: readonly Decision[] = []): State => {
  const input: PlanInput = { snapshot, settings, requests, decisions, options: { now: PLANNED_AT } }
  return { input, result: plan(input) }
}

const openings = (s: State, extra: Partial<OpeningsInput> = {}): StudentOpenings[] => findOpenings({ ...s, catalog: {}, progressFor: () => undefined, ...extra })
const ids = (list: readonly StudentOpenings[]): string[] => list.map((x) => x.studentId)

/** Ráérés mindenkinek a hétre (a hiányzó ráérés külön jelzés, A6). */
const available = (students: readonly string[]): Snapshot['availabilities'] =>
  Object.fromEntries(students.map((id) => [id, [{ start: at(DAYS[0]!, '00:00'), end: at(DAYS[6]!, '23:00'), unavailable: false }]]))

describe('helykeresés: van hely (KIT-01)', () => {
  const settings = baseSettings()
  const snapshot = baseSnapshot({ availabilities: available(['n1', 'n2', 'n3', 'n4', 'n5']) })
  const base = state(snapshot, settings, [flight('a', 'n1'), flight('b', 'n2'), flight('c', 'n3'), flight('d', 'n1')])

  it('minden növendéknél van lehetőség, a felvenni kívánt igény a kitöltő elsőbbséggel', () => {
    const list = openings(base)
    expect(ids(list).sort()).toEqual(['n1', 'n2', 'n3', 'n4', 'n5'])
    for (const s of list) {
      expect(s.missingAvailability).toBe(false)
      expect(s.options.map((o) => o.kind)).toEqual(['default'])
      expect(s.options[0]!.request.priority).toBe(3)
      expect(s.options[0]!.weather).toBe('flyable')
      expect(Date.parse(s.options[0]!.best.start)).toBeGreaterThanOrEqual(Date.parse(PLANNED_AT) + 2 * 3_600_000)
    }
  })

  it('a próbaszámolás szerint mellékhatás nélkül felvehető, és a kézi igények nem mozdulnak', () => {
    const option = openings(base).find((s) => s.studentId === 'n4')!.options[0]!
    const trial = trialPlan(base, option.next, option.request.id)
    expect(trial.ok).toBe(true)
    expect(trial.placed?.requestId).toBe(option.request.id)
    expect(trial.moved).toEqual([])
    expect(trial.displaced).toEqual([])
  })

  it('sorrend: aki régebben repült (vagy még soha) elöl, a ráérés nélküli a végén', () => {
    const s2 = state(
      baseSnapshot({
        availabilities: available(['n1', 'n2', 'n4', 'n5']),
        lastFlightAt: { n1: '2026-11-12T10:00:00.000Z', n2: '2026-11-01T10:00:00.000Z', n3: '2026-10-01T10:00:00.000Z', n4: null, n5: '2026-11-10T10:00:00.000Z' },
      }),
      settings,
      [],
    )
    const list = openings(s2)
    expect(ids(list)).toEqual(['n4', 'n2', 'n5', 'n1', 'n3'])
    expect(list.find((s) => s.studentId === 'n3')!.missingAvailability).toBe(true)
  })

  it('a hét közbeni figyelés időtávja: csak a következő napokra', () => {
    const list = openings(base, { days: 2 })
    const until = Date.parse(PLANNED_AT) + 2 * 24 * 3_600_000
    for (const s of list) for (const o of s.options) expect(Date.parse(o.best.start)).toBeLessThan(until)
  })
})

describe('helykeresés: halasztott igény (KIT-03)', () => {
  const settings = baseSettings()
  const snapshot = baseSnapshot({ availabilities: available(['n1', 'n2', 'n3', 'n4', 'n5']) })
  const base = state(snapshot, settings, [flight('a', 'n1'), flight('b', 'n2')], [{ kind: 'defer', requestId: 'b' }])

  it('a halasztott igényű növendéknél csak a visszahozás szerepel, és az a próba szerint befér', () => {
    const n2 = openings(base).find((s) => s.studentId === 'n2')!
    expect(n2.options.map((o) => o.key)).toEqual(['restore:b'])
    const trial = trialPlan(base, n2.options[0]!.next, 'b')
    expect(trial.ok).toBe(true)
    expect(trial.result.deferred).not.toContain('b')
  })

  it('zárolt (H07) vagy elutasított visszahozásnál a növendék kimarad', () => {
    expect(ids(openings(base, { restoreLocked: new Set(['b']) }))).not.toContain('n2')
    expect(ids(openings(base, { excludeStudents: new Set(['n2']) }))).not.toContain('n2')
  })
})

describe('helykeresés: nincs hely', () => {
  it('csak rossz idő: repülésnek nincs lehetősége', () => {
    const weather = weekWeather(() => true)
    expect(weather.every((h) => h.windSpeedKt === badHour(h.time).windSpeedKt)).toBe(true)
    const s = state(baseSnapshot({ weather }), baseSettings(), [])
    expect(openings(s)).toEqual([])
  })

  it('az oktató napi repült idő limitje miatt nincs tiszta hely', () => {
    const settings = baseSettings()
    const strict: Settings = { ...settings, limits: { ...settings.limits, rules: settings.limits.rules.map((r) => (r.id === 'oktato-repult-nap' ? { ...r, limit: 0.5 } : r)) } }
    expect(openings(state(baseSnapshot(), strict, []))).toEqual([])
  })
})

describe('helykeresés: két plusz igény ugyanarra a helyre', () => {
  // Az oktató csak hétfőn 8 és 11 között dolgozik: egyetlen foglalás fér be (45 + 20 + 60 + 30 perc).
  const s = baseSettings()
  const settings: Settings = {
    ...s,
    instructor: { ...s.instructor, workWindows: { mon: { start: '08:00', end: '11:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
    students: ['n1', 'n2'].map((userId) => ({ userId, allowedResources: [{ aircraftId: 'p1' }] })),
  }
  const base = state(baseSnapshot({ availabilities: available(['n1', 'n2']) }), settings, [])

  it('mindkettő listán van, de az egyik felvétele után a másiknak már nincs helye', () => {
    const list = openings(base)
    expect(ids(list).sort()).toEqual(['n1', 'n2'])
    const first = list.find((x) => x.studentId === 'n1')!.options[0]!
    expect(trialPlan(base, first.next, first.request.id).ok).toBe(true)

    const after: State = { input: first.next, result: plan(first.next) }
    expect(openings(after)).toEqual([])

    // Ha a régi listáról mégis felvennénk a másodikat, a próba megmutatja, hogy nem fér be.
    const second = list.find((x) => x.studentId === 'n2')!.options[0]!.request
    const requests = [...after.input.requests, second]
    const trial = trialPlan(after, withRequests(after.input, requests, []), second.id)
    expect(trial.ok).toBe(false)
    expect(trial.placed).toBeUndefined()
  })
})

describe('helykeresés feladatokkal (KIT-02, ELS-05)', () => {
  const L = (id: string, name: string, extra: Partial<LectureInfo> = {}): LectureInfo => ({ id, name, revisionId: 'rev', briefingMinutes: 45, flightMinutes: 60, debriefingMinutes: 30, simulator: false, night: false, ...extra })
  const catalog: Record<string, LectureInfo> = Object.fromEntries(
    [
      L('a1', 'III./14. Éjszakai II.', { night: true }),
      L('a2', 'III./15. Éjszakai ellenőrző', { night: true, flightMinutes: 30 }),
      L('a3', 'III./16. Egyedül éjszaka', { night: true, flightMinutes: 40 }),
      L('a4', 'III./17. PIC I.'),
      L('a5', 'III./18. PIC II.'),
      L('a6', 'III./19. PIC III.'),
      L('a7', 'III./20. PIC IV.'),
      L('a8', 'IV./1.S. Műszeres (FNPT II.)', { simulator: true, flightMinutes: 120 }),
    ].map((l) => [l.id, l]),
  )
  const rec = (lectureId: string, day: number): TrainingRecord => ({ lectureId, status: 'PASSED', at: new Date(Date.UTC(2026, 10, day, 10)).toISOString(), revisionId: 'rev' })
  // A III./16. a legutóbbi, a III./15. kimaradt, a III./17–18. megvan.
  const progress = computeProgress([rec('a1', 5), rec('a4', 6), rec('a5', 7), rec('a3', 9)], catalog)
  const settings = baseSettings()
  const snapshot = baseSnapshot({ availabilities: available(['n1', 'n2', 'n3', 'n4', 'n5']) })
  const progressFor = (id: string) => (id === 'n1' ? progress : undefined)

  it('az automatikus a következő feladatot kapja, utána a kézi feladatok közül csak a beférők; a sorban az új a régi után jön', () => {
    const raw = flight('r1', 'n1', { taskSelectionMode: 'automatic' })
    const requests = assignAutomaticLectures({ settings, requests: [raw], catalog, progressFor, bookings: [], nowMs: Date.parse(PLANNED_AT) })
    expect(requests[0]!.lectureId).toBe('a6')
    const input: PlanInput = { snapshot, settings, requests, decisions: [], options: { now: PLANNED_AT }, sequences: lectureSequences({ settings, requests, catalog, progressFor }) }
    const base: State = { input, result: plan(input) }
    const n1 = findOpenings({ ...base, catalog, progressFor }).find((s) => s.studentId === 'n1')!
    // a7 automatikusan, a8 szimulátoron; az a2 éjszakai, a munkaidőbe (16 óráig) nem fér, ezért nincs a listán.
    expect(n1.options.map((o) => o.key)).toEqual(['default', 'lecture:a8', 'none'])
    const auto = n1.options[0]!
    expect(auto.request).toMatchObject({ lectureId: 'a7', taskSelectionMode: 'automatic', priority: 3 })
    expect(auto.next.sequences).toEqual([['r1', auto.request.id]])
    const r1 = base.result.proposals.find((p) => p.requestId === 'r1')!
    expect(Date.parse(auto.best.start)).toBeGreaterThanOrEqual(Date.parse(r1.slot.end))
    expect(n1.options[1]!.request).toMatchObject({ kind: 'simulator', lectureId: 'a8', taskSelectionMode: 'manual' })
    expect(n1.options[1]!.weather).toBeUndefined()
  })
})

describe('helykeresés: teljesítmény', () => {
  it('valószerű flotta: 26 gép, 300 foglalás, 13 növendék, 12 repülés', () => {
    const r = rng(11)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
    const fleet = [
      ...Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, callSign: `HA-XP${i}`, model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, callSign: `HA-XC${i}`, model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, callSign: `SIM-${i}`, model: 'SIM', aircraftClass: 'SIMULATOR', disabled: false })),
    ]
    const students = Array.from({ length: 13 }, (_, i) => `n${i}`)
    const bookings: ExistingBooking[] = []
    for (let i = 0; i < 300; i++) {
      const d = pick(DAYS.slice(0, 6))
      const h = 7 + Math.floor(r() * 9)
      const start = at(d, `${String(h).padStart(2, '0')}:00`)
      const end = at(d, `${String(h + 2).padStart(2, '0')}:00`)
      bookings.push(existing(`x${i}`, { resourceId: pick(fleet).id, instructorId: `masik${i % 40}`, start, end, flightStart: start, flightEnd: end, participantIds: [`zz${i}`] }))
    }
    const s = baseSettings()
    const allowed = fleet.filter((a) => a.aircraftClass !== 'SIMULATOR').slice(0, 8).map((a) => ({ aircraftId: a.id }))
    const settings: Settings = {
      ...s,
      resources: {},
      aircraftHours: Object.fromEntries(fleet.filter((a) => a.aircraftClass !== 'SIMULATOR').map((a) => [a.id, { date: '2026-11-15', hoursUntilMaintenance: 30, enteredAt: '2026-11-15T07:00:00.000Z' }])),
      students: students.map((userId) => ({ userId, allowedResources: allowed })),
    }
    // 12 repülés: az oktató hetéből marad szabad idő (20 repülés kitöltené a heti munkaidőt).
    const requests = Array.from({ length: 12 }, (_, i) => flight(`f${i}`, students[i % students.length]!))
    const snapshot = baseSnapshot({ fleet: fleet as Snapshot['fleet'], bookings, lastFlightAt: Object.fromEntries(students.map((id) => [id, '2026-11-10T10:00:00.000Z'])) })
    const base = state(snapshot, settings, requests)
    const started = performance.now()
    const list = openings(base)
    const elapsed = performance.now() - started
    // A határ bőkezű (a lassabb gépek miatt); a lista a próbaszámolás nélkül készül.
    expect(elapsed).toBeLessThan(4000)
    expect(list.length).toBeGreaterThan(0)
  }, 20_000)
})

describe('próbaszámolás: mellékhatások megnevezése (KIT-04, KIT-08)', () => {
  it('a visszahozott, kevés helyű igény elmozdít egy azonos elsőbbségű igényt, és a próba megnevezi', () => {
    // Egy gép; n2 csak hétfő reggel ér rá, n1 régen repült (neki is a hétfő reggel a legjobb).
    const settings: Settings = { ...baseSettings(), students: ['n1', 'n2'].map((userId) => ({ userId, allowedResources: [{ aircraftId: 'p1' }] })) }
    const snapshot = baseSnapshot({
      availabilities: { n2: [{ start: at(DAYS[0]!, '08:00'), end: at(DAYS[0]!, '10:30'), unavailable: false }] },
      lastFlightAt: { n1: '2026-10-01T10:00:00.000Z', n2: '2026-11-10T10:00:00.000Z' },
    })
    const base = state(snapshot, settings, [flight('a', 'n1'), flight('b', 'n2')], [{ kind: 'defer', requestId: 'b' }])
    // A mostani tervben a hely foglalt (a-é), a visszahozásról mégis a teljes próba dönt: a
    // halasztott igény a saját elsőbbségével kerül vissza, és átrendezheti a tervet.
    const n2 = findOpenings({ ...base, catalog: {}, progressFor: () => undefined }).find((s) => s.studentId === 'n2')!
    expect(n2.options.map((o) => o.key)).toEqual(['restore:b'])
    const trial = n2.options[0]!.trial!
    expect(trial.placed?.requestId).toBe('b')
    expect(trial.moved.map((m) => m.requestId)).toEqual(['a'])
    expect(trial.displaced).toEqual([])
    expect(trial.ok).toBe(true)
    // Ugyanez a próba függetlenül is.
    const again = trialPlan(base, { ...base.input, decisions: [] }, 'b')
    expect(again.moved.map((m) => m.requestId)).toEqual(['a'])
  })
})

describe('hét közbeni figyelés: van még hely a következő 2 napban (KIT-07)', () => {
  const capacity = { catalog: {}, progress: {} }

  it('egyetlen összefoglaló a 2 napra; a ráérés nélküli növendék nem ad jelzést; képességadat nélkül nincs keresés', () => {
    const base = state(baseSnapshot({ availabilities: available(['n1', 'n2', 'n3']) }), baseSettings(), [flight('a', 'n1')])
    const watch = watchWithCapacity(base.input, base.result, { capacity })
    const found = watch.capacity!
    expect(found.days).toBe(2)
    expect(found.students.map((s) => s.studentId).sort()).toEqual(['n1', 'n2', 'n3'])
    const until = Date.parse(PLANNED_AT) + 2 * 24 * 3_600_000
    for (const s of found.students) {
      expect(s.options).toBeGreaterThan(0)
      expect(Date.parse(s.first.start)).toBeLessThan(until)
    }
    // A nap kezdete a repülőtér idejében (vasárnap 0:00 Budapesten).
    expect(found.dismissFrom).toBe('2026-11-14T23:00:00.000Z')
    expect(watchWithCapacity(base.input, base.result, {}).capacity).toBeUndefined()
  })

  it('a „Most nem” aznapra elhallgattatja, a tegnapi elutasítás nem', () => {
    const base = state(baseSnapshot({ availabilities: available(['n1']) }), baseSettings(), [])
    const today = { requestId: CAPACITY_DISMISSAL_ID, kind: 'capacity' as const, from: '2026-11-14T23:00:00.000Z' }
    const yesterday = { ...today, from: '2026-11-13T23:00:00.000Z' }
    expect(watchWithCapacity(base.input, base.result, { capacity, dismissals: [today] }).capacity).toBeUndefined()
    expect(watchWithCapacity(base.input, base.result, { capacity, dismissals: [yesterday] }).capacity?.students.map((s) => s.studentId)).toEqual(['n1'])
  })

  describe('a visszahozható halasztott igényt visszahozottnak veszi', () => {
    // Az oktató csak hétfőn 8 és 11 között dolgozik: egyetlen foglalás fér be.
    const s = baseSettings()
    const settings: Settings = {
      ...s,
      instructor: { ...s.instructor, workWindows: { mon: { start: '08:00', end: '11:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      students: ['n1', 'n2'].map((userId) => ({ userId, allowedResources: [{ aircraftId: 'p1' }] })),
    }
    const snapshot = baseSnapshot({ availabilities: available(['n1', 'n2']) })
    const base = state(snapshot, settings, [flight('b', 'n1')], [{ kind: 'defer', requestId: 'b' }])

    it('a visszahozás elveszi az egyetlen helyet, ezért nincs plusz hely', () => {
      const watch = watchWithCapacity(base.input, base.result, { capacity })
      expect(watch.items.map((i) => `${i.kind}:${i.requestId}`)).toEqual(['restore:b'])
      expect(watch.capacity).toBeUndefined()
      // A visszahozás nélkül a hely szabad lenne n2-nek: a mostani terv szerint ő beférne.
      expect(ids(openings(base, { days: 2 }))).toContain('n2')
    })

    it('elutasított visszahozásnál a hely szabad marad, a halasztott igényű növendék kimarad', () => {
      const watch = watchWithCapacity(base.input, base.result, { capacity, dismissals: [{ requestId: 'b', kind: 'restore' }] })
      expect(watch.items).toEqual([])
      expect(watch.capacity?.students.map((x) => x.studentId)).toEqual(['n2'])
    })
  })
})
