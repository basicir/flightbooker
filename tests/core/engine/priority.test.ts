import { describe, expect, it } from 'vitest'
import type { Settings } from '../../../src/core/config/schema'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import type { BookingRequest, ExistingBooking, PlanResult, Proposal } from '../../../src/core/model/planning'
import type { Snapshot } from '../../../src/core/model/snapshot'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, rng, theory, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Az igény elsőbbsége (ELS-01–04): a motor rétegenként, a legfontosabbal kezdve helyez el. Egy
 * kevésbé fontos (például helykitöltő) igény nem veheti el a fontosabb helyét, és a helyén sem
 * változtat; verseny és csere csak a fontossági sorrend szerint.
 */

const run = (snapshot: Snapshot, settings: Settings, requests: readonly BookingRequest[], extra: Partial<PlanInput> = {}): PlanResult =>
  plan({ snapshot, settings, requests, decisions: [], ...extra })

/** A nem tartalék javaslat helye: a repülés (gépidő) kezdete és a gép, elméletnél a kezdés és a terem. */
const placeOf = (p: Proposal): string => `${p.slot.flightStart ?? p.slot.start}|${p.slot.resourceId ?? ''}|${p.slot.classroomId ?? ''}`
const places = (r: PlanResult, ids?: ReadonlySet<string>): Record<string, string> =>
  Object.fromEntries(r.proposals.filter((p) => !p.standby && (!ids || ids.has(p.requestId))).map((p) => [p.requestId, placeOf(p)]))

describe('elsőbbség: azonos elsőbbségnél a terv változatlan (visszafelé kompatibilis)', () => {
  const world = (): { snapshot: Snapshot; settings: Settings; requests: BookingRequest[] } => {
    const settings = baseSettings()
    const snapshot = baseSnapshot({
      weather: weekWeather((date, hour) => date === DAYS[2] && hour >= 9 && hour < 14),
      bookings: [existing('x1', { resourceId: 'p1', instructorId: 'masik', start: at(DAYS[0]!, '09:00'), end: at(DAYS[0]!, '12:00'), participantIds: ['zz'] })],
    })
    const requests: BookingRequest[] = [
      flight('a', 'n1'),
      flight('b', 'n2'),
      flight('c', 'n3'),
      flight('d', 'n1'),
      { ...flight('sim', 'n4'), kind: 'simulator', daylightOnly: false },
      theory('th', ['n1', 'n2', 'n3']),
    ]
    return { snapshot, settings, requests }
  }

  it('elsőbbség nélkül, mind 1-essel és mind 3-assal ugyanaz a terv', () => {
    const { snapshot, settings, requests } = world()
    const none = run(snapshot, settings, requests)
    const ones = run(snapshot, settings, requests.map((r) => ({ ...r, priority: 1 })))
    const threes = run(snapshot, settings, requests.map((r) => ({ ...r, priority: 3 })))
    expect(places(ones)).toEqual(places(none))
    expect(places(threes)).toEqual(places(none))
    expect(ones.dilemmas.map((d) => d.id)).toEqual(none.dilemmas.map((d) => d.id))
    expect(threes.dilemmas.map((d) => d.id)).toEqual(none.dilemmas.map((d) => d.id))
  })

  it('az alapértelmezett elsőbbség a beállításokból jön', () => {
    const { snapshot, settings, requests } = world()
    const s: Settings = { ...settings, defaults: { ...settings.defaults, requestPriority: 4 } }
    // A b igény 3-as, a többi az alapérték szerint 4-es: b előbb kap helyet.
    const mixed = run(snapshot, s, requests.map((r) => (r.id === 'b' ? { ...r, priority: 3 } : r)))
    const explicit = run(snapshot, settings, requests.map((r) => ({ ...r, priority: r.id === 'b' ? 1 : 2 })))
    expect(places(mixed)).toEqual(places(explicit))
  })
})

describe('elsőbbség: a kevésbé fontos igény nem szorítja ki a fontosabbat (ELS-02)', () => {
  // Egy géppel: n2 csak hétfő reggel ér rá, n1 régen repült (a hét eleje a legjobb neki).
  const settings: Settings = { ...baseSettings(), students: ['n1', 'n2'].map((userId) => ({ userId, allowedResources: [{ aircraftId: 'p1' }] })) }
  const snapshot = baseSnapshot({
    availabilities: { n2: [{ start: at(DAYS[0]!, '08:00'), end: at(DAYS[0]!, '10:30'), unavailable: false }] },
    lastFlightAt: { n1: '2026-10-01T10:00:00.000Z', n2: '2026-11-10T10:00:00.000Z' },
  })
  const manual = flight('kezi', 'n1')
  const fill = flight('plusz', 'n2')

  it('azonos elsőbbségnél a kevés helyű igény elviszi a másik legjobb helyét', () => {
    const alone = run(snapshot, settings, [manual])
    const both = run(snapshot, settings, [manual, fill])
    expect(places(both)['plusz']).toBe(places(alone)['kezi'])
    expect(places(both)['kezi']).not.toBe(places(alone)['kezi'])
  })

  it('3-as elsőbbséggel a kézi igény ott marad, ahol nélküle lenne, a plusz igény nem kap helyet', () => {
    const alone = run(snapshot, settings, [manual])
    const both = run(snapshot, settings, [manual, { ...fill, priority: 3 }])
    expect(places(both)['kezi']).toBe(places(alone)['kezi'])
    expect(places(both)['plusz']).toBeUndefined()
    expect(both.unplaced.map((u) => u.requestId)).toEqual(['plusz'])
    // Verseny-dilemma csak azonos elsőbbségűek között lehet (ELS-03).
    expect(both.dilemmas.some((d) => d.type === 'competition')).toBe(false)
  })

  it('fordított elsőbbséggel a fontosabb (a plusz igény) kapja a helyet', () => {
    const both = run(snapshot, settings, [{ ...manual, priority: 2 }, { ...fill, priority: 1 }])
    const alone = run(snapshot, settings, [fill])
    expect(places(both)['plusz']).toBe(places(alone)['plusz'])
  })

  it('a fix időpont elsőbbségtől függetlenül előbb kerül helyre', () => {
    const alone = run(snapshot, settings, [manual])
    const fixedStart = alone.proposals.find((p) => p.requestId === 'kezi')!.slot.start
    const fixedFill: BookingRequest = { ...flight('fixplusz', 'n1'), priority: 5, timing: { kind: 'fixed', start: fixedStart } }
    const both = run(snapshot, settings, [manual, fixedFill])
    expect(both.proposals.find((p) => p.requestId === 'fixplusz')?.slot.start).toBe(fixedStart)
    expect(places(both)['kezi']).not.toBe(places(alone)['kezi'])
  })
})

describe('elsőbbség: csere csak kevésbé fontos igény helyére (ELS-03)', () => {
  // Egyetlen hely a héten: hétfő reggel a p1-en (a p1 többi ideje karbantartás). A növendéki
  // prioritás (NOV-12) egyértelművé teszi a győztest, így nincs verseny-dilemma, a vesztes „nincs
  // hely” dilemmát kap, amelyben a csere szóba jöhet.
  const settings: Settings = {
    ...baseSettings(),
    students: [
      { userId: 'n1', allowedResources: [{ aircraftId: 'p1' }], priority: 5 },
      { userId: 'n2', allowedResources: [{ aircraftId: 'p1' }], priority: 1 },
    ],
  }
  const bookings: ExistingBooking[] = [existing('karb', { type: 'maintenance', resourceId: 'p1', start: at(DAYS[0]!, '10:30'), end: at(DAYS[6]!, '23:00') })]
  const snapshot = baseSnapshot({ bookings })
  const swapsOf = (r: PlanResult, id: string): string[] =>
    r.dilemmas.filter((d) => d.requestIds.includes(id) && d.type === 'noSlot').flatMap((d) => d.options.map((o) => o.id).filter((o) => o.includes(':csere:')))

  it('azonos elsőbbségnél a kimaradt igény átveheti a másik helyét', () => {
    const r = run(snapshot, settings, [flight('a', 'n1'), flight('b', 'n2')])
    const out = r.unplaced.map((u) => u.requestId)
    expect(out).toHaveLength(1)
    expect(swapsOf(r, out[0]!)).not.toHaveLength(0)
  })

  it('a kevésbé fontos kimaradt igény nem kapja meg a fontosabb helyét cserére', () => {
    const r = run(snapshot, settings, [flight('a', 'n1'), { ...flight('b', 'n2'), priority: 3 }])
    expect(r.unplaced.map((u) => u.requestId)).toEqual(['b'])
    expect(swapsOf(r, 'b')).toEqual([])
  })
})

describe('elsőbbség: a csapat elsőbbsége a legfontosabb tagjáé (ELS-04)', () => {
  it('a 3-as csapat a fontosabb egyéni igény után kerül helyre, az 1-es tagú csapat előtte', () => {
    const settings: Settings = { ...baseSettings(), instructor: { ...baseSettings().instructor, workWindows: { mon: { start: '08:00', end: '12:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } }
    const snapshot = baseSnapshot()
    const team = (p1: number, p2: number): BookingRequest[] => [
      { ...flight('t1', 'n1'), briefingTeamId: 'cs', priority: p1 },
      { ...flight('t2', 'n2'), briefingTeamId: 'cs', priority: p2 },
    ]
    const single = flight('egy', 'n3')
    const alone = run(snapshot, settings, [single])
    const low = run(snapshot, settings, [single, ...team(3, 3)])
    expect(places(low)['egy']).toBe(places(alone)['egy'])
    const high = run(snapshot, settings, [{ ...single, priority: 2 }, ...team(1, 3)])
    const teamAlone = run(snapshot, settings, team(1, 3))
    expect(places(high)['t1']).toBe(places(teamAlone)['t1'])
    expect(places(high)['t2']).toBe(places(teamAlone)['t2'])
  })
})

describe('elsőbbség: a rossz idő megítélése (SZB-16) csak a legalább ilyen fontos repülésekből', () => {
  it('egy új növendék plusz igénye nem viszi el az elméletet a kézi növendék számára rossz órákról', () => {
    // Kedd 10–14: 12 csomós, csütörtök 10–14: 16 csomós oldalszél. Mindkettő az iskolai minimumon
    // belül, de n1 egyéni limitjén (8 csomó) kívül: n1-nek mindkettő rossz, n6-nak csak a csütörtök.
    const windy = (date: string, hour: number): boolean => (date === DAYS[1] || date === DAYS[3]) && hour >= 10 && hour < 14
    const thursday = at(DAYS[3]!, '12:00').slice(0, 10)
    const hours = weekWeather(windy).map((h) => (h.windSpeedKt !== 30 ? h : h.time.startsWith(thursday) ? { ...h, windSpeedKt: 16, windGustKt: 18 } : { ...h, windSpeedKt: 12, windGustKt: 14 }))
    const s = baseSettings()
    const settings: Settings = {
      ...s,
      students: [
        { userId: 'n1', allowedResources: [{ aircraftType: 'PIPER P28A' }], weatherLimits: { maxCrosswindKt: 8 } },
        { userId: 'n2', allowedResources: [{ aircraftType: 'PIPER P28A' }] },
        { userId: 'n6', allowedResources: [{ aircraftType: 'PIPER P28A' }] },
      ],
    }
    const snapshot = baseSnapshot({ weather: hours })
    const base = [flight('f1', 'n1'), theory('th', ['n1', 'n2'])]
    const before = run(snapshot, settings, base)
    const after = run(snapshot, settings, [...base, { ...flight('plusz', 'n6'), priority: 3 }])
    // Az elmélet n1 rossz óráira kerül (rossz időre illesztés, SZB-08), és ott is marad.
    const thBefore = before.proposals.find((p) => p.requestId === 'th' && !p.standby)!
    expect(Date.parse(thBefore.slot.start)).toBeGreaterThanOrEqual(Date.parse(at(DAYS[1]!, '09:00')))
    expect(Date.parse(thBefore.slot.end)).toBeLessThanOrEqual(Date.parse(at(DAYS[1]!, '15:00')))
    expect(places(after, new Set(['f1', 'th']))).toEqual(places(before))
  })
})

/**
 * Tulajdonságteszt: véletlen heteken a kézi (alapértelmezett elsőbbségű) igények helye nem változik,
 * ha kevésbé fontos plusz igények kerülnek melléjük – akkor sem, ha a plusz igény új növendéké
 * (a rossz idő megítélése az elméletnél és a szimulátornál ettől független, SZB-16).
 */
describe('tulajdonság: plusz igény felvétele a fontosabb igények helyét nem változtatja (ELS-02)', () => {
  const world = (seed: number): { snapshot: Snapshot; settings: Settings; base: BookingRequest[]; extra: BookingRequest[] } => {
    const r = rng(seed * 104729)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
    const s = baseSettings()
    const badDays = new Set(DAYS.filter(() => r() < 0.3))
    const weather = weekWeather((date, hour) => badDays.has(date) && hour >= 7 + Math.floor(r() * 3) && hour < 15)
    const bookings: ExistingBooking[] = []
    for (let i = 0; i < 8; i++) {
      const d = pick(DAYS.slice(0, 5))
      const h = 8 + Math.floor(r() * 6)
      const start = at(d, `${String(h).padStart(2, '0')}:00`)
      const end = at(d, `${String(h + 2).padStart(2, '0')}:00`)
      if (r() < 0.6) bookings.push(existing(`x${i}`, { resourceId: pick(['p1', 'p2', 'c1']), instructorId: 'masik', start, end, flightStart: start, flightEnd: end, participantIds: ['zz'] }))
      else bookings.push(existing(`x${i}`, { type: 'maintenance', resourceId: pick(['p1', 'p2']), start: at(d, '00:00'), end: at(d, '23:00') }))
    }
    const settings: Settings = {
      ...s,
      limits: { ...s.limits, rules: s.limits.rules.map((rule) => (rule.id === 'oktato-repult-nap' ? { ...rule, limit: 3 + Math.floor(r() * 4) } : rule)) },
      students: [...s.students, { userId: 'n6', allowedResources: [{ aircraftType: 'PIPER P28A' }] }].map((st) => ({ ...st, priority: 1 + Math.floor(r() * 5), ...(r() < 0.3 ? { weatherLimits: { maxCrosswindKt: 8 } } : {}) })),
    }
    const base: BookingRequest[] = []
    const baseCount = 4 + Math.floor(r() * 6)
    for (let i = 0; i < baseCount; i++) base.push(flight(`f${i}`, pick(['n1', 'n2', 'n3', 'n4']), { daylightOnly: r() < 0.8 }))
    if (r() < 0.6) base.push({ ...flight('sim', pick(['n1', 'n2'])), kind: 'simulator', daylightOnly: false })
    if (r() < 0.7) base.push(theory('th', ['n1', 'n2', 'n3']))
    const extra: BookingRequest[] = []
    const extraCount = 2 + Math.floor(r() * 5)
    for (let i = 0; i < extraCount; i++) extra.push(flight(`p${i}`, pick(['n1', 'n3', 'n5', 'n6']), { priority: pick([2, 3, 3, 5]) }))
    return { snapshot: baseSnapshot({ bookings, weather }), settings, base, extra }
  }

  const seeds = Array.from({ length: 30 }, (_, i) => i + 1)
  it.each(seeds)('mag: %i', (seed) => {
    const { snapshot, settings, base, extra } = world(seed)
    const ids = new Set(base.map((b) => b.id))
    const before = run(snapshot, settings, base)
    const after = run(snapshot, settings, [...base, ...extra])
    expect(places(after, ids)).toEqual(places(before, ids))
    expect(after.unplaced.filter((u) => ids.has(u.requestId)).map((u) => u.requestId)).toEqual(before.unplaced.map((u) => u.requestId))
    const baseDilemmas = (x: PlanResult): string[] => x.dilemmas.filter((d) => d.type !== 'standby' && d.requestIds.every((id) => ids.has(id))).map((d) => d.id)
    expect(baseDilemmas(after)).toEqual(baseDilemmas(before))
    // Vegyes dilemma (fontosabb és plusz igény) nem keletkezik, standbyn kívül.
    expect(after.dilemmas.filter((d) => d.type !== 'standby' && d.requestIds.some((id) => ids.has(id)) && d.requestIds.some((id) => !ids.has(id)))).toEqual([])
  })
})
