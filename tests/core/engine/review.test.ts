import { describe, expect, it } from 'vitest'
import { autoResolveDecisions, AUTO_RESOLVABLE } from '../../../src/core/engine/autoResolve'
import { createSlotExplorer } from '../../../src/core/engine/explore'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { createWeekPlan, recordedInput, setRecordingStatus, syncDeferred, type WeekPlan } from '../../../src/core/draft/weekPlan'
import type { Decision, Proposal } from '../../../src/core/model/planning'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, goodHour, INSTRUCTOR, theory, TZ, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * A 2026-11-12-i átfogó felülvizsgálat hibáinak (H01–H24) és javaslatainak tesztjei.
 * Mindegyik a hiba reprodukcióján alapul: a javítás előtt ezek buknak.
 */

const run = (partial: Partial<PlanInput> & Pick<PlanInput, 'requests'>) => plan({ snapshot: baseSnapshot(), settings: baseSettings(), decisions: [], ...partial })
const hm = (iso: string): string => {
  const m = localParts(toMs(iso), TZ).minutes
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
const main = (ps: readonly Proposal[]): Proposal[] => ps.filter((p) => !p.standby)
const minutes = (a: string, b: string): number => (toMs(b) - toMs(a)) / 60_000

/** Szerdától bizonytalan idő: mérsékelt oldalszél (a nyers érték 0,3 és 0,7 közé esik). */
const marginalFromWednesday = () => {
  const marginal = (time: string) => ({ ...goodHour(time), windSpeedKt: 14, windDirectionDeg: 131, windGustKt: 16 })
  return weekWeather().map((h) => (localParts(toMs(h.time), TZ).date >= DAYS[2]! ? marginal(h.time) : h))
}

describe('H02: a rögzített foglalás nem duplázódik', () => {
  const requests = [flight('f1', 'n1'), flight('f2', 'n2')]
  const first = run({ requests })
  const p = first.proposals.find((x) => x.requestId === 'f1')!

  it('frissítés előtt a rögzített hely le van zárva', () => {
    const r = run({ requests, recorded: [{ requestId: 'f1', slot: p.slot }] })
    const f1 = r.proposals.find((x) => x.requestId === 'f1')!
    expect(f1.slot).toEqual(p.slot)
    expect(f1.recorded).toBe(true)
  })

  it('a frissítés után a FlightLogger-foglalás veszi át, az igény nem kerül máshová', () => {
    const fl = existing('fl-1', { start: p.slot.start, end: p.slot.end, flightStart: p.slot.flightStart!, flightEnd: p.slot.flightEnd!, resourceId: p.slot.resourceId!, instructorId: INSTRUCTOR, participantIds: ['n1'] })
    const r = plan({ snapshot: baseSnapshot({ bookings: [fl] }), settings: baseSettings(), requests, decisions: [], recorded: [{ requestId: 'f1', slot: p.slot }] })
    expect(r.proposals.some((x) => x.requestId === 'f1')).toBe(false)
    expect(r.recordedInFlightLogger).toEqual([{ requestId: 'f1', bookingId: 'fl-1', slot: { start: p.slot.start, end: p.slot.end, flightStart: p.slot.flightStart, flightEnd: p.slot.flightEnd, resourceId: p.slot.resourceId } }])
    expect(r.dilemmas).toEqual([])
  })

  it('a rögzítési állapot a helyet is menti, a visszaállítás törli', () => {
    let wp: WeekPlan = { ...createWeekPlan('2026-11-16', '2026-11-15T09:00:00.000Z'), requests }
    wp = setRecordingStatus(wp, 'f1', 'recorded', p.slot, '2026-11-15T10:00:00.000Z')
    expect(recordedInput(wp)).toEqual([{ requestId: 'f1', slot: p.slot, at: '2026-11-15T10:00:00.000Z' }])
    expect(wp.metrics?.firstRecordedAt).toBe('2026-11-15T10:00:00.000Z')
    wp = setRecordingStatus(wp, 'f1', 'planned', undefined, '2026-11-15T11:00:00.000Z')
    expect(recordedInput(wp)).toEqual([])
  })
})

describe('H03: napkelte és napnyugta adat nélkül is számít', () => {
  const s = baseSettings()
  const late = { start: '08:00', end: '19:00' }
  const settings = { ...s, instructor: { ...s.instructor, workWindows: { mon: late, tue: late, wed: late, thu: late, fri: late, sat: null, sun: null } } }
  const requests = [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '17:00') } })]

  it('az Open-Meteo adata nélkül a koordinátákból számolt napnyugta zárja ki a sötét repülést', () => {
    const r = plan({ snapshot: baseSnapshot({ daylight: {}, weather: [] }), settings, requests, decisions: [] })
    expect(r.proposals).toEqual([])
    expect(r.dilemmas[0]!.type).toBe('noSlot')
  })

  it('repülőtér nélkül nappali feladat nem tervezhető', () => {
    const r = plan({ snapshot: baseSnapshot({ daylight: {}, weather: [] }), settings: { ...settings, airport: null }, requests: [flight('f2', 'n1')], decisions: [] })
    expect(r.proposals).toEqual([])
  })
})

describe('H05, H06: standby elmélet', () => {
  const settings = { ...baseSettings(), classrooms: { r1: { capacity: 10, preferenceRank: 1 }, r2: { capacity: 4, preferenceRank: 2 }, r3: { capacity: 6, preferenceRank: 3 } } }
  const snapshot = baseSnapshot({ weather: marginalFromWednesday(), classroomIds: ['r1', 'r2', 'r3'] })
  const requests = [
    flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[3]!, '09:00') } }),
    flight('f2', 'n1', { timing: { kind: 'fixed', start: at(DAYS[4]!, '09:00') } }),
    theory('th', ['n1', 'n2']),
  ]
  const first = plan({ snapshot, settings, requests, decisions: [] })
  const dilemma = first.dilemmas.find((d) => d.type === 'standby')!

  it('egy „nem” elég: más teremmel és más repüléssel sem jön újra (H05)', () => {
    expect(dilemma).toBeDefined()
    const no = dilemma.options.find((o) => o.decision.kind === 'noStandby')!.decision
    const r = plan({ snapshot, settings, requests, decisions: [no] })
    expect(r.dilemmas.filter((d) => d.type === 'standby')).toEqual([])
  })

  it('a standby a saját hosszával kerül be, és az elmélet saját helye is megmarad (H06, Q4)', () => {
    const yes = dilemma.options.find((o) => o.decision.kind === 'standby')!.decision
    const r = plan({ snapshot, settings, requests, decisions: [yes] })
    const th = r.proposals.filter((p) => p.requestId === 'th')
    expect(th).toHaveLength(2)
    const sb = th.find((p) => p.standby)!
    expect(minutes(sb.slot.start, sb.slot.end)).toBe(90)
    expect(sb.pairedRequestId).toBeDefined()
    const flightP = r.proposals.find((p) => p.requestId === sb.pairedRequestId && !p.standby)!
    expect(sb.slot.start).toBe(flightP.slot.start)
    expect(th.some((p) => !p.standby)).toBe(true)
  })

  it('a többi résztvevő foglaltságát a standby is figyeli (H06)', () => {
    // n2 a csütörtöki repülés idejében másik foglalásban van: oda nem ajánlható standby.
    const busy = existing('n2-busy', { start: at(DAYS[3]!, '08:00'), end: at(DAYS[3]!, '12:00'), participantIds: ['n2'], instructorId: 'masik' })
    const r = plan({ snapshot: { ...snapshot, bookings: [busy] }, settings, requests, decisions: [] })
    const offered = r.dilemmas.filter((d) => d.type === 'standby')
    const onThursday = offered.some((d) => {
      const opt = d.options.find((o) => o.decision.kind === 'standby')!.decision
      return opt.kind === 'standby' && localParts(toMs(opt.slot.start), TZ).date === DAYS[3]
    })
    expect(onThursday).toBe(false)
  })

  it('a párosított repülés mozgásával a standby is mozog (H06)', () => {
    const yes = dilemma.options.find((o) => o.decision.kind === 'standby')!.decision as Extract<Decision, { kind: 'standby' }>
    const paired = first.proposals.find((p) => p.requestId === yes.pairedRequestId)!
    // A repülést egy órával később tesszük (kézi mozgatás).
    const later = (iso: string | undefined) => (iso ? new Date(toMs(iso) + 3_600_000).toISOString() : undefined)
    const moved: Decision = {
      kind: 'assign',
      requestId: paired.requestId,
      slot: { ...paired.slot, start: later(paired.slot.start)!, end: later(paired.slot.end)!, flightStart: later(paired.slot.flightStart)!, flightEnd: later(paired.slot.flightEnd)! },
      acceptWarnings: true,
      fromDraft: true,
    }
    const r = plan({ snapshot, settings, requests, decisions: [yes, moved] })
    const sb = r.proposals.find((p) => p.requestId === 'th' && p.standby)!
    const f = r.proposals.find((p) => p.requestId === paired.requestId)!
    expect(sb.slot.start).toBe(f.slot.start)
  })
})

describe('H07: a halasztás átvitele szinkronizálódik', () => {
  const prevBase: WeekPlan = { ...createWeekPlan('2026-11-09', '2026-11-08T09:00:00.000Z'), requests: [flight('a', 'n1'), flight('b', 'n2')] }
  it('a később hozott halasztás is átkerül, a visszavont kikerül', () => {
    const prev1: WeekPlan = { ...prevBase, decisions: [{ kind: 'defer', requestId: 'a' }] }
    let week = createWeekPlan('2026-11-16', '2026-11-08T10:00:00.000Z', prev1)
    expect(week.requests.map((r) => r.id)).toEqual(['a-h'])
    // Az előző héten utólag a „b” is halasztás lett, az „a” halasztását visszavonták.
    const prev2: WeekPlan = { ...prevBase, decisions: [{ kind: 'defer', requestId: 'b' }] }
    week = syncDeferred(week, prev2)
    expect(week.requests.map((r) => r.id)).toEqual(['b-h'])
  })
  it('ha a hozott igényről már döntés született, nem tűnik el', () => {
    const prev1: WeekPlan = { ...prevBase, decisions: [{ kind: 'defer', requestId: 'a' }] }
    const week = { ...createWeekPlan('2026-11-16', '2026-11-08T10:00:00.000Z', prev1), decisions: [{ kind: 'comment' as const, requestId: 'a-h', comment: 'x' }] }
    expect(syncDeferred(week, prevBase).requests.map((r) => r.id)).toEqual(['a-h'])
  })
  it('változás nélkül ugyanazt az objektumot adja', () => {
    const prev1: WeekPlan = { ...prevBase, decisions: [{ kind: 'defer', requestId: 'a' }] }
    const week = createWeekPlan('2026-11-16', '2026-11-08T10:00:00.000Z', prev1)
    expect(syncDeferred(week, prev1)).toBe(week)
  })
})

describe('H08: a régi döntés megdől, ha a helye már nem tiszta', () => {
  it('karbantartás a választott helyen: döntési hiba, és az igény új helyet kap', () => {
    const first = run({ requests: [flight('f1', 'n1')] })
    const p = first.proposals[0]!
    const decision: Decision = { kind: 'assign', requestId: 'f1', slot: p.slot, acceptWarnings: false }
    const maint = existing('m1', { type: 'maintenance', resourceId: p.slot.resourceId!, start: at(localParts(toMs(p.slot.start), TZ).date, '00:00'), end: at(localParts(toMs(p.slot.start), TZ).date, '23:00') })
    const r = plan({ snapshot: baseSnapshot({ bookings: [maint] }), settings: baseSettings(), requests: [flight('f1', 'n1')], decisions: [decision] })
    expect(r.decisionIssues).toHaveLength(1)
    const f1 = r.proposals.find((x) => x.requestId === 'f1')!
    expect(f1.decidedBy).toBe('engine')
    expect(f1.warnings.some((w) => w.kind === 'hardConstraintOverridden')).toBe(false)
  })
})

describe('H10: az érintkező ráérési sávok egynek számítanak', () => {
  it('08–12 és 12–16 mellett a 11:00-s repülés nem „ráérésen kívüli”', () => {
    const requests = [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '11:00') } })]
    const availabilities = {
      n1: [
        { start: at(DAYS[1]!, '08:00'), end: at(DAYS[1]!, '12:00'), unavailable: false },
        { start: at(DAYS[1]!, '12:00'), end: at(DAYS[1]!, '16:00'), unavailable: false },
      ],
    }
    const r = plan({ snapshot: baseSnapshot({ availabilities }), settings: baseSettings(), requests, decisions: [] })
    expect(r.dilemmas).toEqual([])
    expect(r.proposals[0]!.warnings.some((w) => w.kind === 'outsideAvailability')).toBe(false)
  })
})

describe('H11: a fix időpont a foglalás kezdete', () => {
  it('a gép napi első repülésénél a motorpróba a repülést tolja, nem a foglalást', () => {
    const r = run({ requests: [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '09:00') } })] })
    const p = r.proposals[0]!
    expect(hm(p.slot.start)).toBe('09:00')
    expect(hm(p.slot.flightStart!)).toBe('09:50')
  })
})

describe('H12: a kézi mozgatás után a motorpróba újraszámolódik', () => {
  it('a gép napi első repülésévé tett foglalás megkapja a motorpróbát, a többi elveszíti', () => {
    const first = run({ requests: [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '12:00') } })] })
    const p = first.proposals[0]!
    // Áthúzzuk a gép egy olyan napjára, ahol már repül valaki korábban: nem kell motorpróba.
    const day = DAYS[2]!
    const other = existing('x', { resourceId: p.slot.resourceId!, start: at(day, '08:00'), end: at(day, '09:30'), flightStart: at(day, '08:00'), flightEnd: at(day, '09:30'), instructorId: 'masik', participantIds: ['zz'] })
    const slot = { start: at(day, '10:10'), flightStart: at(day, '11:00'), flightEnd: at(day, '12:00'), end: at(day, '12:15'), resourceId: p.slot.resourceId! }
    const r = plan({ snapshot: baseSnapshot({ bookings: [other] }), settings: baseSettings(), requests: [flight('f1', 'n1')], decisions: [{ kind: 'assign', requestId: 'f1', slot, acceptWarnings: true, fromDraft: true }] })
    const moved = r.proposals.find((x) => x.requestId === 'f1')!
    expect(hm(moved.slot.flightStart!)).toBe('11:00')
    expect(hm(moved.slot.start)).toBe('10:30')
  })
})

describe('H13: a „döntse el a rendszer” egy kattintással végez', () => {
  it('ismétel, amíg van automatikusan eldönthető dilemma, és minden döntést megjelöl', () => {
    const requests = ['n1', 'n2', 'n3', 'n4', 'n5'].flatMap((n, i) => [flight(`a${i}`, n), flight(`b${i}`, n)])
    const input: PlanInput = { snapshot: baseSnapshot(), settings: baseSettings(), requests, decisions: [] }
    const added = autoResolveDecisions(input)
    const after = plan({ ...input, decisions: added })
    expect(after.dilemmas.filter((d) => AUTO_RESOLVABLE.has(d.type))).toEqual([])
    expect(after.decisionIssues).toEqual([])
    for (const d of added) expect('auto' in d && d.auto).toBe(true)
  })
  it('a fix ütközés kézi marad', () => {
    expect(AUTO_RESOLVABLE.has('fixedConflict')).toBe(false)
  })
})

describe('H17: a halasztás visszavonja a korábbi elhelyezést', () => {
  it('az igény nem lehet egyszerre elhelyezve és halasztva', () => {
    const first = run({ requests: [flight('f1', 'n1')] })
    const p = first.proposals[0]!
    const r = run({ requests: [flight('f1', 'n1')], decisions: [{ kind: 'assign', requestId: 'f1', slot: p.slot, acceptWarnings: false }, { kind: 'defer', requestId: 'f1' }] })
    expect(r.proposals).toEqual([])
    expect(r.deferred).toEqual(['f1'])
  })
})

describe('H18: a terem ütközését is felismeri a döntésnél', () => {
  it('két elmélet ugyanabban a teremben: a második döntés megdől', () => {
    const slot = { start: at(DAYS[1]!, '10:00'), end: at(DAYS[1]!, '11:30'), classroomId: 'r1' }
    const r = run({
      requests: [theory('t1', ['n1']), theory('t2', ['n3'])],
      decisions: [
        { kind: 'assign', requestId: 't1', slot, acceptWarnings: true },
        { kind: 'assign', requestId: 't2', slot, acceptWarnings: true },
      ],
    })
    expect(r.decisionIssues.map((i) => i.decisionIndex)).toEqual([1])
  })
})

describe('H19: zivatarveszély', () => {
  it('magas CAPE mellett a repülés figyelmeztetést kap, és jobb napot választ', () => {
    // Hétfőn zivatarveszély, a többi nap jó.
    const weather = weekWeather().map((h) => (localParts(toMs(h.time), TZ).date === DAYS[0] ? { ...h, capeJPerKg: 1500 } : h))
    const atMonday = run({ snapshot: baseSnapshot({ weather }), requests: [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[0]!, '10:00') } })] })
    expect(atMonday.proposals[0]!.warnings.some((w) => w.kind === 'weatherRisk')).toBe(true)
    const free = run({ snapshot: baseSnapshot({ weather }), requests: [flight('f2', 'n1')] })
    expect(localParts(toMs(free.proposals[0]!.slot.start), TZ).date).not.toBe(DAYS[0])
  })
})

describe('H20: a tervezés pillanata a tényleges idő', () => {
  it('a gyorsítótárból dolgozva sem ajánl a mostani időnél korábbit', () => {
    const now = at(DAYS[2]!, '12:00')
    const r = run({ requests: [flight('f1', 'n1')], options: { now } })
    for (const p of main(r.proposals)) expect(toMs(p.slot.start)).toBeGreaterThanOrEqual(toMs(now))
  })
})

describe('H22, H23: figyelmeztetéses hely és limitüzenet', () => {
  it('a limitüzenet olvasható nevet és mértékegységet mutat', () => {
    const s = baseSettings()
    const settings = { ...s, limits: { ...s.limits, rules: s.limits.rules.map((r) => (r.id === 'oktato-repult-nap' ? { ...r, limit: 1 } : r)) } }
    const r = run({ settings, requests: [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '09:00') } }), flight('f2', 'n2', { timing: { kind: 'fixed', start: at(DAYS[1]!, '12:00') } })] })
    const messages = [...r.dilemmas.flatMap((d) => d.options.flatMap((o) => o.cons)), ...r.proposals.flatMap((p) => p.warnings.map((w) => w.message))].join(' ')
    expect(messages).toMatch(/oktató: repült \(blokk-\) idő naptári napon: [\d,]+ óra \/ 1 óra/)
    expect(messages).not.toContain('oktato-repult-nap')
  })
})

describe('A6, A10: hiányzó adat jelzése', () => {
  it('a ráérés nélküli növendék és az engedélyezett gép nélküli növendék is jelzést kap', () => {
    const s = baseSettings()
    const settings = { ...s, students: s.students.map((st) => (st.userId === 'n2' ? { ...st, allowedResources: [] } : st)) }
    const r = run({ settings, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    expect(r.warnings.filter((w) => w.kind === 'missingData' && w.requestId === 'n1')).toHaveLength(1)
    expect(r.warnings.some((w) => w.kind === 'missingData' && w.requestId === 'n2' && w.message.startsWith('Nincs engedélyezett'))).toBe(true)
  })
})

describe('A7: előrejelzés nélküli napra más a standby szövege', () => {
  it('nem „bizonytalan időjárású”, hanem „még nincs előrejelzés”', () => {
    const settings = baseSettings()
    const weather = weekWeather().filter((h) => localParts(toMs(h.time), TZ).date < DAYS[2]!)
    const r = run({ settings, snapshot: baseSnapshot({ weather }), requests: [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[3]!, '09:00') } }), theory('th', ['n1', 'n2'])] })
    const d = r.dilemmas.find((x) => x.type === 'standby')
    expect(d?.summary).toContain('még nincs előrejelzés')
  })
})

describe('időpont-térkép a standby javaslatokkal', () => {
  it('a térkép a kétszer szereplő igényt (saját hely és standby) is kezeli', () => {
    const settings = { ...baseSettings(), classrooms: { r1: { capacity: 10, preferenceRank: 1 }, r2: { capacity: 4, preferenceRank: 2 } } }
    const snapshot = baseSnapshot({ weather: marginalFromWednesday() })
    const requests = [flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[3]!, '09:00') } }), theory('th', ['n1', 'n2']), flight('f2', 'n3')]
    const first = plan({ snapshot, settings, requests, decisions: [] })
    const yes = first.dilemmas.find((d) => d.type === 'standby')!.options[0]!.decision
    const r = plan({ snapshot, settings, requests, decisions: [yes] })
    const explorer = createSlotExplorer({ snapshot, settings, requests, proposals: r.proposals }, 'f2')!
    expect(explorer.grid().candidates.length).toBeGreaterThan(0)
  })
})

describe('Döntés után megváltozott időtartam (SZB-02, TRV-06)', () => {
  // A 2 órás feladat helyére döntés születik, majd az igény másfél órás feladatra vált:
  // a döntés a repülés kezdetét tartja, a hossz az igény jelenlegi időtartamából jön.
  const long = flight('f1', 'n1', { durations: { briefing: 30, main: 120, debriefing: 15 } })
  const short = flight('f1', 'n1', { durations: { briefing: 30, main: 90, debriefing: 15 } })
  const first = run({ requests: [long] })
  const p = first.proposals[0]!

  for (const acceptWarnings of [false, true]) {
    it(`a foglalás a rövidebb feladathoz igazodik (acceptWarnings: ${acceptWarnings})`, () => {
      const r = run({ requests: [short], decisions: [{ kind: 'assign', requestId: 'f1', slot: p.slot, acceptWarnings, fromDraft: true }] })
      expect(r.decisionIssues).toEqual([])
      const f1 = r.proposals.find((x) => x.requestId === 'f1')!
      expect(f1.decidedBy).toBe('instructor')
      expect(f1.slot.flightStart).toBe(p.slot.flightStart)
      expect(f1.slot.start).toBe(p.slot.start)
      expect(minutes(f1.slot.flightStart!, f1.slot.flightEnd!)).toBe(90)
      expect(minutes(f1.slot.flightEnd!, f1.slot.end)).toBe(15)
    })
  }

  it('az elmélet hossza is a jelenlegi időtartamot követi', () => {
    const t90 = theory('t1', ['n1'])
    const tp = run({ requests: [t90] }).proposals.find((x) => x.requestId === 't1' && !x.standby)!
    const t60 = theory('t1', ['n1'], { durations: { briefing: 0, main: 60, debriefing: 0 } })
    const r = run({ requests: [t60], decisions: [{ kind: 'assign', requestId: 't1', slot: tp.slot, acceptWarnings: true, fromDraft: true }] })
    const t1 = r.proposals.find((x) => x.requestId === 't1' && !x.standby)!
    expect(t1.slot.start).toBe(tp.slot.start)
    expect(minutes(t1.slot.start, t1.slot.end)).toBe(60)
  })
})

describe('Rögzítés után megváltozott feladat (H02, SZB-02)', () => {
  // A 2 órás feladat helyét rögzítettnek jelöli, majd az igény másfél órás feladatra vált, mielőtt
  // a frissítés a FlightLogger-foglalást lehozná: a lezárt hely a repülés kezdetét tartja, a hossza
  // az igény mostani időtartamát követi (nem marad bent a 2 órás).
  const long = flight('f1', 'n1', { durations: { briefing: 30, main: 120, debriefing: 15 } })
  const short = flight('f1', 'n1', { durations: { briefing: 30, main: 90, debriefing: 15 } })
  const p = run({ requests: [long] }).proposals[0]!

  it('a rögzített hely a rövidebb feladathoz igazodik', () => {
    const r = run({ requests: [short], recorded: [{ requestId: 'f1', slot: p.slot }] })
    const f1 = r.proposals.find((x) => x.requestId === 'f1')!
    expect(f1.recorded).toBe(true)
    expect(f1.slot.flightStart).toBe(p.slot.flightStart)
    expect(f1.slot.start).toBe(p.slot.start)
    expect(f1.slot.resourceId).toBe(p.slot.resourceId)
    expect(minutes(f1.slot.flightStart!, f1.slot.flightEnd!)).toBe(90)
    expect(minutes(f1.slot.flightEnd!, f1.slot.end)).toBe(15)
  })

  it('változatlan feladatnál a rögzített hely pontosan marad', () => {
    const r = run({ requests: [long], recorded: [{ requestId: 'f1', slot: p.slot }] })
    expect(r.proposals.find((x) => x.requestId === 'f1')!.slot).toEqual(p.slot)
  })

  it('az elmélet hossza is követi', () => {
    const t90 = theory('t1', ['n1'])
    const tp = run({ requests: [t90] }).proposals.find((x) => x.requestId === 't1' && !x.standby)!
    const t60 = theory('t1', ['n1'], { durations: { briefing: 0, main: 60, debriefing: 0 } })
    const r = run({ requests: [t60], recorded: [{ requestId: 't1', slot: tp.slot }] })
    const t1 = r.proposals.find((x) => x.requestId === 't1' && !x.standby)!
    expect(t1.slot.start).toBe(tp.slot.start)
    expect(minutes(t1.slot.start, t1.slot.end)).toBe(60)
  })
})

describe('Elméleti terem létszáma: az oktató is résztvevő (ERF-07)', () => {
  const settings = { ...baseSettings(), classrooms: { r1: { capacity: 10, preferenceRank: 1 }, r2: { capacity: 4, preferenceRank: 2 } } }
  const snapshot = baseSnapshot({ classroomIds: ['r1', 'r2'] })

  it('4 növendék + oktató nem fér a 4 fős terembe', () => {
    const r = plan({ snapshot, settings, requests: [theory('th', ['n1', 'n2', 'n3', 'n4'], { preferredClassroomId: 'r2' })], decisions: [] })
    const th = r.proposals.find((p) => p.requestId === 'th' && !p.standby)!
    expect(th.slot.classroomId).toBe('r1')
  })

  it('3 növendék + oktató befér a 4 fős terembe', () => {
    const r = plan({ snapshot, settings, requests: [theory('th', ['n1', 'n2', 'n3'], { preferredClassroomId: 'r2' })], decisions: [] })
    const th = r.proposals.find((p) => p.requestId === 'th' && !p.standby)!
    expect(th.slot.classroomId).toBe('r2')
  })

  it('ha egyik terem sem elég, az üzenet az oktatót is beszámolja', () => {
    const small = { ...baseSettings(), classrooms: { r1: { capacity: 3, preferenceRank: 1 }, r2: { capacity: 2, preferenceRank: 2 } } }
    const r = plan({ snapshot, settings: small, requests: [theory('th', ['n1', 'n2', 'n3'])], decisions: [] })
    expect(r.proposals.some((p) => p.requestId === 'th')).toBe(false)
  })
})
