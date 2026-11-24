import { describe, expect, it } from 'vitest'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import type { Decision, Proposal } from '../../../src/core/model/planning'
import { localParts, toMs } from '../../../src/core/time/zoned'
import {
  at,
  baseSettings,
  baseSnapshot,
  DAYS,
  existing,
  flight,
  INSTRUCTOR,
  theory,
  TZ,
  weekWeather,
} from '../../fixtures/syntheticWeek'

const run = (partial: Partial<PlanInput> & Pick<PlanInput, 'requests'>) =>
  plan({ snapshot: baseSnapshot(), settings: baseSettings(), decisions: [], ...partial })

const dayOf = (p: Proposal): string => localParts(toMs(p.slot.start), TZ).date
const minutesOf = (iso: string): number => localParts(toMs(iso), TZ).minutes

function assertNoInstructorOverlap(proposals: readonly Proposal[]): void {
  const main = proposals.filter((p) => !p.standby)
  for (let i = 0; i < main.length; i++) {
    for (let j = i + 1; j < main.length; j++) {
      const a = main[i]!
      const b = main[j]!
      const overlap = toMs(a.slot.start) < toMs(b.slot.end) && toMs(b.slot.start) < toMs(a.slot.end)
      expect(overlap, `${a.requestId} és ${b.requestId} átfed`).toBe(false)
    }
  }
}

describe('alapeset: jó idő, három repülés', () => {
  const result = run({ requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })

  it('mindhárom igény dilemma nélkül elhelyeződik', () => {
    expect(result.proposals.map((p) => p.requestId).sort()).toEqual(['f1', 'f2', 'f3'])
    expect(result.dilemmas).toEqual([])
    expect(result.unplaced).toEqual([])
  })

  it('a foglalások nem fedik át egymást az oktatónál, és a munkaidőn belül vannak', () => {
    assertNoInstructorOverlap(result.proposals)
    for (const p of result.proposals) {
      expect(minutesOf(p.slot.start)).toBeGreaterThanOrEqual(8 * 60)
      expect(minutesOf(p.slot.end)).toBeLessThanOrEqual(16 * 60)
      expect(['p1', 'p2']).toContain(p.slot.resourceId)
    }
  })

  it('a gép napi első repülésénél a motorpróbával nő a briefing (SZB-05)', () => {
    for (const p of result.proposals) {
      const briefing = (toMs(p.slot.flightStart!) - toMs(p.slot.start)) / 60_000
      const earlier = result.proposals.some(
        (q) => q !== p && q.slot.resourceId === p.slot.resourceId && dayOf(q) === dayOf(p) && toMs(q.slot.flightStart!) < toMs(p.slot.flightStart!),
      )
      expect(briefing).toBe(earlier ? 30 : 50)
    }
  })

  it('minden javaslathoz van indoklás (9.5)', () => {
    for (const p of result.proposals) expect(p.factors.length).toBeGreaterThan(0)
  })

  it('determinisztikus: ugyanarra a bemenetre ugyanazt adja', () => {
    const again = run({ requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })
    expect(again).toEqual(result)
  })
})

describe('ütközés meglévő foglalással (SZB-04)', () => {
  it('más oktató foglalását a gépen nem használja, amíg van tiszta hely', () => {
    const bookings = DAYS.slice(0, 5).flatMap((d, i) => [
      existing(`m${i}`, { resourceId: 'p1', instructorId: 'masik', start: at(d, '07:30'), end: at(d, '16:00'), flightStart: at(d, '08:00'), flightEnd: at(d, '15:30'), participantIds: ['x'] }),
    ])
    const result = run({ snapshot: baseSnapshot({ bookings }), requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    expect(result.proposals.every((p) => p.slot.resourceId === 'p2')).toBe(true)
    expect(result.proposals.every((p) => p.warnings.every((w) => w.kind !== 'doubleBooking'))).toBe(true)
  })

  it('a hosszú karbantartási foglalás kizárja a gépet (7.2)', () => {
    const maintenance = existing('mx', { type: 'maintenance', resourceId: 'p2', start: at(DAYS[0]!, '00:00'), end: at(DAYS[6]!, '23:00') })
    const result = run({ snapshot: baseSnapshot({ bookings: [maintenance] }), requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })
    expect(result.proposals.every((p) => p.slot.resourceId === 'p1')).toBe(true)
  })

  it('az oktató saját meglévő foglalása mellé nem tesz átfedő javaslatot', () => {
    const mine = DAYS.slice(0, 5).map((d, i) => existing(`own${i}`, { type: 'meeting', instructorId: INSTRUCTOR, participantIds: [INSTRUCTOR], start: at(d, '08:00'), end: at(d, '12:00') }))
    const result = run({ snapshot: baseSnapshot({ bookings: mine }), requests: [flight('f1', 'n1')] })
    expect(minutesOf(result.proposals[0]!.slot.start)).toBeGreaterThanOrEqual(12 * 60)
  })
})

describe('folyamatos oktatói program (súlyozott feltétel)', () => {
  // Az oktatónak hétfőn 13:00–14:00 között meglévő foglalása van (például megbeszélés).
  const meeting = existing('m1', { start: at(DAYS[0]!, '13:00'), end: at(DAYS[0]!, '14:00'), instructorId: INSTRUCTOR, participantIds: ['x'] })
  const gapToMeeting = (p: Proposal): number => Math.max(0, toMs(meeting.start) - toMs(p.slot.end), toMs(p.slot.start) - toMs(meeting.end)) / 60_000
  const withWeight = (w: number) => {
    const settings = baseSettings()
    return run({ snapshot: baseSnapshot({ bookings: [meeting] }), settings: { ...settings, weights: { ...settings.weights, instructorContinuity: w } }, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
  }

  it('a hétfői repülések a meglévő foglaláshoz zárnak, nem marad nagy szünet', () => {
    const result = withWeight(30)
    const monday = result.proposals.filter((p) => dayOf(p) === DAYS[0])
    expect(monday.length).toBeGreaterThan(0)
    // Az oktató hétfői programja egy tömb: a foglalások között legfeljebb fél óra szünet.
    const spans = [...monday.map((p) => [toMs(p.slot.start), toMs(p.slot.end)] as const), [toMs(meeting.start), toMs(meeting.end)] as const].sort((a, b) => a[0] - b[0])
    for (let i = 1; i < spans.length; i++) expect((spans[i]![0] - spans[i - 1]![1]) / 60_000).toBeLessThanOrEqual(30)
    expect(Math.min(...monday.map(gapToMeeting))).toBeLessThanOrEqual(30)
    for (const p of monday) expect(p.factors.find((f) => f.criterion === 'instructorContinuity')?.subScore).toBe(1)
    expect(result.dilemmas).toEqual([])
  })

  it('súly nélkül a feltétel nem számít (0%)', () => {
    const result = withWeight(0)
    expect(result.proposals).toHaveLength(2)
    for (const p of result.proposals) expect(p.factors.find((f) => f.criterion === 'instructorContinuity')?.weight).toBe(0)
  })
})

describe('limit-túllépés (LIM-01–06)', () => {
  const tightDaily = () => {
    const s = baseSettings()
    return { ...s, limits: { ...s.limits, rules: s.limits.rules.map((r) => (r.id === 'oktato-repult-nap' ? { ...r, limit: 1 } : r)) } }
  }

  it('napi 1 órás oktatói limitnél a repüléseket különböző napokra osztja', () => {
    const result = run({ settings: tightDaily(), requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })
    const days = result.proposals.map(dayOf)
    expect(new Set(days).size).toBe(3)
    expect(result.dilemmas).toEqual([])
  })

  it('ha csak túllépéssel fér be, figyelmeztetéses dilemmát nyit, és nem helyezi el magától', () => {
    const settings = tightDaily()
    const onlyMonday = { ...settings, instructor: { ...settings.instructor, workWindows: { ...settings.instructor.workWindows, tue: null, wed: null, thu: null, fri: null } } }
    const result = run({ settings: onlyMonday, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    expect(result.proposals).toHaveLength(1)
    const dilemma = result.dilemmas.find((d) => d.type === 'warningSlot')
    expect(dilemma).toBeDefined()
    expect(dilemma!.options.find((o) => o.decision.kind === 'assign')!.cons.join(' ')).toMatch(/Limit túllépés/)
    expect(result.unplaced.map((u) => u.requestId)).toHaveLength(1)
  })

  it('a túllépés vállalása után a foglalás figyelmeztetéssel kerül a tervbe (LIM-02)', () => {
    const settings = tightDaily()
    const onlyMonday = { ...settings, instructor: { ...settings.instructor, workWindows: { ...settings.instructor.workWindows, tue: null, wed: null, thu: null, fri: null } } }
    const first = run({ settings: onlyMonday, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    const accept = first.dilemmas.find((d) => d.type === 'warningSlot')!.options.find((o) => o.decision.kind === 'assign')!.decision
    const second = run({ settings: onlyMonday, requests: [flight('f1', 'n1'), flight('f2', 'n2')], decisions: [accept] })
    expect(second.proposals).toHaveLength(2)
    const accepted = second.proposals.find((p) => p.decidedBy === 'instructor')!
    expect(accepted.warnings.some((w) => w.kind === 'limitExceeded')).toBe(true)
    expect(second.dilemmas.filter((d) => d.type === 'warningSlot')).toEqual([])
  })
})

describe('rossz idő (7.4, SZB-07, SZB-08)', () => {
  // Hétfő és kedd egész nap rossz, a többi nap jó.
  const weather = weekWeather((date) => date === DAYS[0] || date === DAYS[1])

  it('0–2 napon belül az iskolai minimumon kívüli órára repülést nem tesz', () => {
    const result = run({ snapshot: baseSnapshot({ weather }), requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    for (const p of result.proposals) expect([DAYS[0], DAYS[1]]).not.toContain(dayOf(p))
  })

  it('az időpont nélküli elmélet a rossz idős napra kerül', () => {
    const result = run({ snapshot: baseSnapshot({ weather }), requests: [flight('f1', 'n1'), theory('t1', ['n1', 'n2'])] })
    const t = result.proposals.find((p) => p.requestId === 't1')!
    expect([DAYS[0], DAYS[1]]).toContain(dayOf(t))
    // Két főnek a legkisebb megfelelő terem (4 fős) jár, nem a rangsorban első 10 fős.
    expect(t.slot.classroomId).toBe('r2')
  })

  it('a szimulátor is a rossz időt keresi', () => {
    const result = run({ snapshot: baseSnapshot({ weather }), requests: [{ ...flight('s', 'n1'), kind: 'simulator', daylightOnly: false }] })
    expect([DAYS[0], DAYS[1]]).toContain(dayOf(result.proposals[0]!))
    expect(result.proposals[0]!.slot.resourceId).toBe('s1')
  })
})

describe('kevés gépóra (SZB-06)', () => {
  it('a minimum alá nem foglal, a másik gépet választja', () => {
    const s = baseSettings()
    const settings = { ...s, aircraftHours: { ...s.aircraftHours, p1: { ...s.aircraftHours['p1']!, hoursUntilMaintenance: 2.5 } } }
    const result = run({ settings, requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })
    expect(result.proposals.every((p) => p.slot.resourceId === 'p2')).toBe(true)
  })

  it('negatív minimummal tervezési túlfoglalás engedhető', () => {
    const s = baseSettings()
    const settings = {
      ...s,
      resources: { ...s.resources, p2: { ...s.resources['p2']!, minReserveHours: -1 } },
      aircraftHours: { ...s.aircraftHours, p1: { ...s.aircraftHours['p1']!, hoursUntilMaintenance: 0 }, p2: { ...s.aircraftHours['p2']!, hoursUntilMaintenance: 0.5 } },
    }
    const result = run({ settings, requests: [flight('f1', 'n1')] })
    expect(result.proposals[0]!.slot.resourceId).toBe('p2')
  })
})

describe('verseny és döntések (9.1–9.3, TRV-06, TRV-08, TRV-12)', () => {
  // Egyetlen hely a héten: hétfő 08:00–10:30 (motorpróbával 125 perc), egy gép.
  const s = baseSettings()
  const settings = {
    ...s,
    instructor: {
      ...s.instructor,
      workWindows: { mon: { start: '08:00', end: '10:30' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null },
    },
    students: s.students.map((st) => ({ ...st, allowedResources: [{ aircraftId: 'p1' }] })),
  }
  const requests = [flight('f1', 'n1'), flight('f2', 'n2')]

  it('két egyforma igény egy helyért: dilemma, az ajánlás ideiglenesen elhelyezve', () => {
    const result = run({ settings, requests })
    const competition = result.dilemmas.find((d) => d.type === 'competition')!
    expect(competition).toBeDefined()
    expect(competition.options).toHaveLength(2)
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0]!.dilemmaId).toBe(competition.id)
  })

  it('a másik lehetőség választása után a másik igény kapja a helyet', () => {
    const first = run({ settings, requests })
    const competition = first.dilemmas.find((d) => d.type === 'competition')!
    const other = competition.options.find((o) => o.id !== competition.recommendedOptionId)!
    const second = run({ settings, requests, decisions: [other.decision] })
    expect(second.proposals.map((p) => p.requestId)).toEqual([other.decision.requestId])
    expect(second.proposals[0]!.decidedBy).toBe('instructor')
    expect(second.dilemmas.some((d) => d.type === 'competition')).toBe(false)
  })

  it('a döntés visszavonása visszaállítja az eredeti állapotot (TRV-12)', () => {
    expect(run({ settings, requests, decisions: [] })).toEqual(run({ settings, requests }))
  })

  it('egymásnak ellentmondó döntésnél a későbbi megdől, és ezt jelzi', () => {
    const first = run({ settings, requests })
    const competition = first.dilemmas.find((d) => d.type === 'competition')!
    const decisions: Decision[] = competition.options.map((o) => o.decision)
    const result = run({ settings, requests, decisions })
    expect(result.proposals).toHaveLength(1)
    expect(result.decisionIssues).toHaveLength(1)
    expect(result.decisionIssues[0]!.decisionIndex).toBe(1)
  })

  it('a halasztott igény a deferred listába kerül (TRV-17)', () => {
    const result = run({ settings, requests, decisions: [{ kind: 'defer', requestId: 'f2' }] })
    expect(result.deferred).toEqual(['f2'])
    expect(result.proposals.map((p) => p.requestId)).toEqual(['f1'])
    expect(result.dilemmas).toEqual([])
  })

  it('magasabb prioritás egyértelmű előnyt ad: nincs dilemma (E20-szerű)', () => {
    const prioritized = { ...settings, students: settings.students.map((st) => (st.userId === 'n2' ? { ...st, priority: 5 } : { ...st, priority: 1 })) }
    const result = run({ settings: prioritized, requests })
    expect(result.dilemmas.some((d) => d.type === 'competition')).toBe(false)
    expect(result.proposals.map((p) => p.requestId)).toEqual(['f2'])
  })
})

describe('kizáró feltételek', () => {
  it('tiltott időszakra nem tesz foglalást (SZB-14)', () => {
    const s = baseSettings()
    const settings = {
      ...s,
      instructor: {
        ...s.instructor,
        blockedPeriods: (['mon', 'tue', 'wed', 'thu', 'fri'] as const).map((weekday, i) => ({ id: `b${i}`, kind: 'weekly' as const, weekday, start: '08:00', end: '13:00' })),
      },
    }
    const result = run({ settings, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    for (const p of result.proposals) expect(minutesOf(p.slot.start)).toBeGreaterThanOrEqual(13 * 60)
  })

  it('nappali feladatot sötétbe nem tesz (SZB-12)', () => {
    const s = baseSettings()
    const late = { start: '14:00', end: '20:00' }
    const settings = { ...s, instructor: { ...s.instructor, workWindows: { mon: late, tue: late, wed: late, thu: late, fri: late, sat: null, sun: null } } }
    const result = run({ settings, requests: [flight('f1', 'n1')] })
    const p = result.proposals[0]!
    expect(toMs(p.slot.flightEnd!)).toBeLessThanOrEqual(toMs(at(dayOf(p), '16:10')))
  })

  it('nem engedélyezett gépre nem tesz növendéket (NOV-03)', () => {
    const result = run({ requests: [flight('f1', 'n1')] })
    expect(result.proposals[0]!.slot.resourceId).not.toBe('c1')
  })

  it('fix időpontú igény pontosan a megadott időre kerül (TRV-02)', () => {
    const start = at(DAYS[2]!, '10:00')
    const result = run({ requests: [theory('t1', ['n1'], { timing: { kind: 'fixed', start } })] })
    expect(result.proposals[0]!.slot.start).toBe(start)
  })

  it('két ütköző fix időpont dilemmát ad (9.1)', () => {
    const start = at(DAYS[2]!, '10:00')
    const result = run({ requests: [theory('t1', ['n1'], { timing: { kind: 'fixed', start } }), theory('t2', ['n2'], { timing: { kind: 'fixed', start } })] })
    expect(result.dilemmas.map((d) => d.type)).toEqual(['fixedConflict'])
  })
})

describe('standby elmélet bizonytalan napra (SZB-15)', () => {
  it('3 napnál távolabbi, bizonytalan idejű repülés mellé standby elméletet ajánl', () => {
    // Csak csütörtökön lehet repülni, és aznap az idő bizonytalan (gyenge oldalszél a növendéki limit közelében).
    const s = baseSettings()
    const settings = {
      ...s,
      instructor: { ...s.instructor, workWindows: { mon: null, tue: null, wed: null, thu: { start: '08:00', end: '16:00' }, fri: null, sat: null, sun: null } },
      students: s.students.map((st) => (st.userId === 'n1' ? { ...st, weatherLimits: { maxCrosswindKt: 10 } } : st)),
    }
    const weather = baseSnapshot().weather.map((h) => ({ ...h, windSpeedKt: 8, windDirectionDeg: 110 }))
    const result = run({ settings, snapshot: baseSnapshot({ weather }), requests: [flight('f1', 'n1'), theory('t1', ['n1'])] })
    expect(result.dilemmas.some((d) => d.type === 'standby')).toBe(true)
  })
})

describe('figyelmeztetések', () => {
  it('jelzi a régen repült növendéket, akinek a héten nincs repülése (NOV-08)', () => {
    const snapshot = baseSnapshot({ lastFlightAt: { ...baseSnapshot().lastFlightAt, n4: '2026-10-20T10:00:00.000Z' } })
    const result = run({ snapshot, requests: [flight('f1', 'n1')] })
    expect(result.warnings.filter((w) => w.kind === 'longNoFly').map((w) => w.requestId)).toEqual(['n4'])
  })

  it('jelzi, ha a mai óraszám nincs megadva (ERF-05)', () => {
    const s = baseSettings()
    const stale = Object.fromEntries(Object.entries(s.aircraftHours).map(([id, e]) => [id, { ...e, date: '2026-11-14' }]))
    const result = run({ settings: { ...s, aircraftHours: stale }, requests: [] })
    expect(result.warnings.filter((w) => w.kind === 'staleData').length).toBe(3)
  })
})

describe('nincs hely: csere-lehetőség (9.2)', () => {
  it('a kimaradt igény átveheti egy elhelyezett igény helyét', () => {
    const s = baseSettings()
    const settings = {
      ...s,
      instructor: { ...s.instructor, workWindows: { mon: { start: '08:00', end: '10:30' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      students: s.students.map((st) => ({ ...st, allowedResources: [{ aircraftId: 'p1' }], priority: st.userId === 'n1' ? 5 : 1 })),
    }
    const result = run({ settings, requests: [flight('f1', 'n1'), flight('f2', 'n2')] })
    expect(result.proposals.map((p) => p.requestId)).toEqual(['f1'])
    const noSlot = result.dilemmas.find((d) => d.type === 'noSlot')!
    const swap = noSlot.options.find((o) => o.id.includes(':csere:'))!
    expect(swap).toBeDefined()
    const after = run({ settings, requests: [flight('f1', 'n1'), flight('f2', 'n2')], decisions: [swap.decision] })
    expect(after.proposals.map((p) => p.requestId)).toEqual(['f2'])
  })
})

describe('kevesebb motorpróba (SZB-18, 7.3)', () => {
  // A gép aznap már repül egy másik oktató foglalásával; a fix idejű repülésnek mindkét gép jó.
  const busyOn = (resourceId: string) =>
    existing('mas-oktato', {
      start: at(DAYS[1]!, '08:00'),
      end: at(DAYS[1]!, '09:45'),
      flightStart: at(DAYS[1]!, '08:30'),
      flightEnd: at(DAYS[1]!, '09:30'),
      resourceId,
      instructorId: 'oktato-2',
      participantIds: ['mas-novendek'],
    })
  const request = flight('f1', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '13:00') } })

  it.each(['p1', 'p2'])('arra a gépre teszi, amely aznap már repül (%s), így nem kell újabb motorpróba', (resourceId) => {
    const result = run({ snapshot: baseSnapshot({ bookings: [busyOn(resourceId)] }), requests: [request] })
    const proposal = result.proposals.find((p) => p.requestId === 'f1')!
    expect(proposal.slot.resourceId).toBe(resourceId)
    expect(proposal.factors.find((f) => f.criterion === 'avoidFirstFlight')).toMatchObject({ weight: 40, subScore: 1 })
  })

  it('a gép napi első repülése 0 részpontot kap', () => {
    const result = run({ requests: [request] })
    const proposal = result.proposals.find((p) => p.requestId === 'f1')!
    expect(proposal.factors.find((f) => f.criterion === 'avoidFirstFlight')?.subScore).toBe(0)
  })
})

describe('megfelelő teremméret (SZB-08, 7.3)', () => {
  // r1: 10 fős, rangsorban első; r2: 4 fős.
  const start = at(DAYS[2]!, '10:00')
  const roomOf = (studentIds: string[], extra = {}) =>
    run({ requests: [theory('t1', studentIds, { timing: { kind: 'fixed', start }, ...extra })] }).proposals.find((p) => p.requestId === 't1')?.slot.classroomId

  it('a legkisebb, létszámban megfelelő termet választja, akkor is, ha a nagyobb a rangsorban előrébb van', () => {
    expect(roomOf(['n1', 'n2'])).toBe('r2')
  })

  it('ha a kisebbe nem férnek be, a nagyobbat', () => {
    expect(roomOf(['n1', 'n2', 'n3', 'x4', 'x5'])).toBe('r1')
  })

  it('kézzel megadott terem esetén a méret nem számít', () => {
    expect(roomOf(['n1', 'n2'], { preferredClassroomId: 'r1' })).toBe('r1')
  })
})

describe('időablakok (TRV-02): a foglalás kezdetére', () => {
  const window = (day: string, from: string, to: string) => ({ start: at(day, from), end: at(day, to) })
  const startsIn = (iso: string, w: { start: string; end: string }): boolean => toMs(iso) >= toMs(w.start) && toMs(iso) <= toMs(w.end)

  it('a foglalás az ablakban kezdődik', () => {
    const w = window(DAYS[3]!, '11:00', '12:30')
    const result = run({ requests: [flight('f1', 'n1', { timing: { kind: 'preferred', windows: [w] } })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(startsIn(p.slot.start, w)).toBe(true)
  })

  it('több ablak közül bármelyikben kezdődhet', () => {
    const windows = [window(DAYS[1]!, '09:00', '10:30'), window(DAYS[4]!, '13:00', '14:30')]
    const result = run({ requests: [theory('t1', ['n1', 'n2'], { timing: { kind: 'preferred', windows } })] })
    const p = result.proposals.find((x) => x.requestId === 't1')!
    expect(windows.some((w) => startsIn(p.slot.start, w))).toBe(true)
  })

  it('ha az ablakban nincs tiszta hely, máshová kerül', () => {
    // A munkaidő 16:00-kor véget ér: 16 és 18 között kezdve nem fér be a foglalás.
    const result = run({ requests: [flight('f1', 'n1', { timing: { kind: 'preferred', windows: [window(DAYS[3]!, '16:00', '18:00')] } })] })
    expect(result.proposals.map((x) => x.requestId)).toEqual(['f1'])
  })
})

describe('csak az időablakokon belül (TRV-02)', () => {
  const window = (day: string, from: string, to: string) => ({ start: at(day, from), end: at(day, to) })

  it('az ablakban kezdődő helyre teszi', () => {
    const w = window(DAYS[3]!, '11:00', '12:30')
    const result = run({ requests: [flight('f1', 'n1', { timing: { kind: 'preferred', onlyWithin: true, windows: [w] } })] })
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(toMs(p.slot.start)).toBeGreaterThanOrEqual(toMs(w.start))
    expect(toMs(p.slot.start)).toBeLessThanOrEqual(toMs(w.end))
  })

  it('ha az ablakban nincs hely, nem teszi máshová: dilemma lesz, az akadály az időablak', () => {
    const result = run({ requests: [flight('f1', 'n1', { timing: { kind: 'preferred', onlyWithin: true, windows: [window(DAYS[3]!, '16:00', '18:00')] } })] })
    expect(result.proposals.filter((x) => x.requestId === 'f1')).toEqual([])
    const dilemma = result.dilemmas.find((d) => d.requestIds.includes('f1'))!
    expect(dilemma.blockers?.some((b) => b.code === 'timeWindow')).toBe(true)
  })

  it('a munkaidő vége mínusz a foglalás hossza még belefér', () => {
    // Munkaidő 8–16, elmélet 90 perc: a legkésőbbi kezdés 14:30.
    const w = window(DAYS[2]!, '14:30', '14:30')
    const result = run({ requests: [theory('t1', ['n1'], { timing: { kind: 'preferred', onlyWithin: true, windows: [w] } })] })
    expect(result.proposals.find((x) => x.requestId === 't1')?.slot.start).toBe(w.start)
  })
})
