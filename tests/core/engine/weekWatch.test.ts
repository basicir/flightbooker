import { describe, expect, it } from 'vitest'
import {
  applyCompletedChanges,
  changesInput,
  completeMove,
  createWeekPlan,
  dismissWatch,
  lockedCarriedIds,
  markCancelled,
  markMovedInFlightLogger,
  planCancel,
  planMove,
  recordedInput,
  rememberBookingIds,
  restoreDeferred,
  revertChange,
  setRecordingStatus,
  syncDeferred,
  type WeekPlan,
} from '../../../src/core/draft/weekPlan'
import { linkBookings } from '../../../src/core/engine/bookingLink'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { dismissalOf, watchWeek, WATCH_NOTICE_MINUTES } from '../../../src/core/engine/weekWatch'
import type { ExistingBooking, Slot } from '../../../src/core/model/planning'
import type { WeatherHour } from '../../../src/core/model/snapshot'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, goodHour, INSTRUCTOR, PLANNED_AT, theory, TZ, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Hét közbeni figyelés (6. fejezet 9. lépés, TRV-15) és a FlightLogger-foglalások párosítása
 * (9.6). Szintetikus adat: kitalált azonosítók és lajstromjelek.
 */

const dateOf = (iso: string): string => localParts(toMs(iso), TZ).date

/** Az oktató FlightLogger-foglalása az n1 növendékkel, hétfőn 9:30-as repüléssel (motorpróbával). */
const flBooking = (id: string, day = DAYS[0]!, hhmm = '09:30', extra: Partial<ExistingBooking> = {}): ExistingBooking => {
  const flightStart = at(day, hhmm)
  const fs = toMs(flightStart)
  const iso = (ms: number): string => new Date(ms).toISOString()
  return existing(id, {
    start: iso(fs - 50 * 60_000),
    end: iso(fs + 75 * 60_000),
    flightStart,
    flightEnd: iso(fs + 60 * 60_000),
    resourceId: 'p1',
    instructorId: INSTRUCTOR,
    participantIds: ['n1'],
    lectureId: 'L1',
    ...extra,
  })
}
const slotOf = (b: ExistingBooking): Slot => ({ start: b.start, end: b.end, flightStart: b.flightStart!, flightEnd: b.flightEnd!, resourceId: b.resourceId! })

/** Hétfőn végig az iskolai minimum alatti szél (lökés 40 kt). */
const badMonday = (): WeatherHour[] => weekWeather((d) => d === DAYS[0])
/** Hétfőn 16 kt oldalszél: a 17 kt-s minimumon belül, de bizonytalan (nyers érték 0,3 alatt). */
const marginalMonday = (): WeatherHour[] =>
  weekWeather().map((h) => (dateOf(h.time) === DAYS[0] ? { ...goodHour(h.time), windSpeedKt: 16, windDirectionDeg: 131, windGustKt: 18 } : h))

const f1 = flight('f1', 'n1', { lectureId: 'L1' })

function booked(weather: WeatherHour[], extra: Partial<PlanInput> = {}) {
  const fl = flBooking('fl-1')
  const input: PlanInput = {
    snapshot: baseSnapshot({ bookings: [fl], weather }),
    settings: baseSettings(),
    requests: [f1],
    decisions: [],
    recorded: [{ requestId: 'f1', slot: slotOf(fl), at: '2026-11-14T12:00:00.000Z' }],
    ...extra,
  }
  const base = plan(input)
  return { fl, input, base }
}

describe('FlightLogger-foglalások párosítása (9.6)', () => {
  const snapshot = (bookings: ExistingBooking[], generatedAt = PLANNED_AT) => baseSnapshot({ bookings, generatedAt })

  it('a rögzített helyen lévő foglalást párosítja, és megjegyzi az azonosítóját', () => {
    const fl = flBooking('fl-1')
    const r = linkBookings({ snapshot: snapshot([fl]), requests: [f1], recorded: [{ requestId: 'f1', slot: slotOf(fl) }] })
    expect(r.links).toEqual([{ requestId: 'f1', bookingId: 'fl-1', slot: slotOf(fl), recorded: true, how: 'slot', moved: false }])
  })

  it('a FlightLoggerben áthelyezett foglalást az azonosítója, vagy a növendék és a feladat alapján is megtalálja', () => {
    const old = slotOf(flBooking('fl-1'))
    const moved = flBooking('fl-1', DAYS[2]!, '11:00')
    const byId = linkBookings({ snapshot: snapshot([moved]), requests: [f1], recorded: [{ requestId: 'f1', slot: old, bookingId: 'fl-1' }] })
    expect(byId.links[0]).toMatchObject({ bookingId: 'fl-1', how: 'id', moved: true, slot: { flightStart: moved.flightStart } })
    const recreated = flBooking('fl-9', DAYS[2]!, '11:00')
    const byLecture = linkBookings({ snapshot: snapshot([recreated]), requests: [f1], recorded: [{ requestId: 'f1', slot: old }] })
    expect(byLecture.links[0]).toMatchObject({ bookingId: 'fl-9', how: 'lecture', moved: true })
    // Más oktató foglalása nem az igényé.
    const foreign = linkBookings({ snapshot: snapshot([{ ...recreated, instructorId: 'oktato-2' }]), requests: [f1], recorded: [{ requestId: 'f1', slot: old }] })
    expect(foreign.links).toEqual([])
    expect(foreign.missing.map((m) => m.requestId)).toEqual(['f1'])
  })

  it('a máshová tett rögzített elméletet a résztvevők alapján találja meg, és nem veszi el más igény foglalását', () => {
    const t1 = theory('t1', ['n1'])
    const t2 = theory('t2', ['n1'])
    const recordedSlot: Slot = { start: at(DAYS[0]!, '13:00'), end: at(DAYS[0]!, '14:00'), classroomId: 'r1' }
    const lesson = (id: string, start: string, end: string, extra: Partial<ExistingBooking> = {}) =>
      existing(id, { type: 'theory', start: at(DAYS[0]!, start), end: at(DAYS[0]!, end), classroomId: 'r2', instructorId: INSTRUCTOR, participantIds: ['n1'], ...extra })
    const moved = lesson('th-1', '14:30', '15:30')
    const r = linkBookings({ snapshot: snapshot([moved]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] })
    expect(r.links).toEqual([{ requestId: 't1', bookingId: 'th-1', slot: { start: moved.start, end: moved.end, classroomId: 'r2' }, recorded: true, how: 'participants', moved: true }])
    // Más oktató vagy más növendék elmélete nem az övé.
    expect(linkBookings({ snapshot: snapshot([{ ...moved, instructorId: 'oktato-2' }]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] }).missing).toHaveLength(1)
    expect(linkBookings({ snapshot: snapshot([{ ...moved, participantIds: ['n2'] }]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] }).missing).toHaveLength(1)
    // A t2 a saját helyén lévő foglalást kapja, akkor is, ha a t1 keresése előbb járna.
    const own = lesson('th-2', '15:00', '16:00')
    const both = linkBookings({
      snapshot: snapshot([own]),
      requests: [t1, t2],
      recorded: [
        { requestId: 't1', slot: recordedSlot },
        { requestId: 't2', slot: { start: own.start, end: own.end, classroomId: 'r2' } },
      ],
    })
    expect(both.links.map((l) => [l.requestId, l.bookingId, l.how])).toEqual([['t2', 'th-2', 'slot']])
    expect(both.missing.map((m) => m.requestId)).toEqual(['t1'])
  })

  it('a megbeszélésként, oktató nélkül felvett elméletet is párosítja, ha az oktató résztvevő', () => {
    const t1 = theory('t1', ['n1'])
    const recordedSlot: Slot = { start: at(DAYS[0]!, '13:00'), end: at(DAYS[0]!, '14:00'), classroomId: 'r1' }
    const meeting = (id: string, start: string, end: string, participants: string[]) =>
      existing(id, { type: 'meeting', start: at(DAYS[0]!, start), end: at(DAYS[0]!, end), participantIds: participants })
    const here = linkBookings({ snapshot: snapshot([meeting('m1', '13:00', '14:00', [INSTRUCTOR, 'n1'])]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] })
    expect(here.links.map((l) => [l.bookingId, l.how])).toEqual([['m1', 'slot']])
    const moved = linkBookings({ snapshot: snapshot([meeting('m2', '15:00', '16:00', [INSTRUCTOR, 'n1'])]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] })
    expect(moved.links.map((l) => [l.bookingId, l.how])).toEqual([['m2', 'participants']])
    // Más megbeszélése (ő nincs rajta) nem az övé.
    const foreign = linkBookings({ snapshot: snapshot([meeting('m3', '15:00', '16:00', ['oktato-2', 'n1'])]), requests: [t1], recorded: [{ requestId: 't1', slot: recordedSlot }] })
    expect(foreign.links).toEqual([])
  })

  it('a rögzítésnél régebbi adatban a hely le van zárva, a régi hely nem foglal', () => {
    const fl = flBooking('fl-1')
    const next = slotOf(flBooking('x', DAYS[1]!))
    const r = linkBookings({ snapshot: snapshot([fl]), requests: [f1], recorded: [{ requestId: 'f1', slot: next, at: '2026-11-15T09:30:00.000Z', bookingId: 'fl-1' }] })
    expect(r.links).toEqual([])
    expect(r.pending.map((p) => p.requestId)).toEqual(['f1'])
    expect(r.superseded).toEqual(['fl-1'])
    // Ha a régebbi adatban is a rögzített helyen van, párosít.
    const same = linkBookings({ snapshot: snapshot([fl]), requests: [f1], recorded: [{ requestId: 'f1', slot: slotOf(fl), at: '2026-11-15T09:30:00.000Z' }] })
    expect(same.links.map((l) => l.how)).toEqual(['slot'])
  })

  it('a rögzítettnek nem jelölt igény foglalását felismeri; a halasztottét jelzi', () => {
    const f2 = flight('f2', 'n2', { lectureId: 'L2' })
    const f3 = flight('f3', 'n3', { lectureId: 'L3' })
    const b2 = flBooking('fl-2', DAYS[1]!, '09:30', { participantIds: ['n2'], lectureId: 'L2' })
    const b3 = flBooking('fl-3', DAYS[2]!, '09:30', { participantIds: ['n3'], lectureId: 'L3', resourceId: 'p2' })
    const r = linkBookings({ snapshot: snapshot([b2, b3]), requests: [f2, f3], deferred: new Set(['f3']) })
    expect(r.links).toEqual([{ requestId: 'f2', bookingId: 'fl-2', slot: slotOf(b2), recorded: false, how: 'lecture', moved: false }])
    expect(r.deferredStillBooked.map((l) => [l.requestId, l.bookingId])).toEqual([['f3', 'fl-3']])
  })
})

describe('a motor a FlightLoggerben lévő igényt nem tervezi újra', () => {
  it('a felismert foglalás igénye nem kerül újra a tervbe, és a régen repült növendék nem kap figyelmeztetést', () => {
    const b = flBooking('fl-1', DAYS[1]!)
    const snapshot = baseSnapshot({ bookings: [b], lastFlightAt: { n1: '2026-10-01T10:00:00.000Z' } })
    const r = plan({ snapshot, settings: baseSettings(), requests: [f1], decisions: [] })
    expect(r.proposals).toEqual([])
    expect(r.recordedInFlightLogger).toEqual([{ requestId: 'f1', bookingId: 'fl-1', slot: slotOf(b), detected: true }])
    expect(r.warnings.filter((w) => w.kind === 'longNoFly')).toEqual([])
  })

  it('a hiányzó rögzített foglalás helye le van zárva és jelzést kap', () => {
    const slot = slotOf(flBooking('x'))
    const r = plan({ snapshot: baseSnapshot(), settings: baseSettings(), requests: [f1], decisions: [], recorded: [{ requestId: 'f1', slot }] })
    expect(r.missingInFlightLogger).toEqual(['f1'])
    expect(r.proposals[0]).toMatchObject({ requestId: 'f1', recorded: true, slot: { start: slot.start } })
  })

  it('az áthelyezés után a régi FlightLogger-hely nem foglal a frissítésig', () => {
    const old = flBooking('fl-1')
    const f2 = flight('f2', 'n2', { timing: { kind: 'fixed', start: old.start } })
    const recorded = [{ requestId: 'f1', slot: slotOf(flBooking('x', DAYS[2]!)), at: '2026-11-15T09:30:00.000Z', bookingId: 'fl-1' }]
    const r = plan({ snapshot: baseSnapshot({ bookings: [old] }), settings: baseSettings(), requests: [f1, f2], decisions: [], recorded })
    const p2 = r.proposals.find((p) => p.requestId === 'f2')!
    expect(p2.warnings.filter((w) => w.kind === 'doubleBooking')).toEqual([])
    expect(r.supersededBookings).toEqual(['fl-1'])
  })
})

describe('hét közbeni figyelés (TRV-15)', () => {
  it('jó helyen lévő foglalásnál nincs javaslat', () => {
    const { input, base } = booked(weekWeather())
    expect(base.recordedInFlightLogger.map((b) => b.requestId)).toEqual(['f1'])
    expect(watchWeek(input, base)).toEqual({ items: [], watched: { booked: 1, deferred: 0 } })
  })

  it('ha a foglalás idejére az iskolai minimum alatti idő jön, sürgős áthelyezést javasol repülhető időre', () => {
    const { fl, input, base } = booked(badMonday())
    const [item] = watchWeek(input, base).items
    expect(item).toMatchObject({ kind: 'move', requestId: 'f1', bookingId: 'fl-1', urgent: true, from: { start: fl.start }, weather: { from: 'unflyable', to: 'flyable' } })
    if (item?.kind !== 'move') throw new Error('áthelyezés kellett')
    expect(dateOf(item.to.start)).toBe(DAYS[1])
    expect(item.reasons.some((r) => r.includes('iskolai időjárási minimum'))).toBe(true)
  })

  it('ha a héten nincs jobb hely, kockázatként jelzi', () => {
    const { input, base } = booked(weekWeather(() => true))
    expect(watchWeek(input, base).items.map((i) => i.kind)).toEqual(['atRisk'])
  })

  it('bizonytalan időnél csak akkor javasol, ha máshol repülhető és érdemben jobb', () => {
    const { input, base } = booked(marginalMonday())
    const [item] = watchWeek(input, base).items
    expect(item).toMatchObject({ kind: 'move', urgent: false, weather: { from: 'marginal', to: 'flyable' } })
  })

  it('az elutasítás a foglalás helyéhez kötődik', () => {
    const { fl, input, base } = booked(marginalMonday())
    const item = watchWeek(input, base).items[0]!
    const d = dismissalOf(item)!
    expect(d).toEqual({ kind: 'improve', from: fl.start })
    expect(watchWeek(input, base, { dismissals: [{ requestId: 'f1', ...d }] }).items).toEqual([])
    // Más helyre szóló (régi) elutasítás nem rejti el.
    expect(watchWeek(input, base, { dismissals: [{ requestId: 'f1', kind: 'improve', from: at(DAYS[3]!, '08:00') }] }).items).toHaveLength(1)
    // A sürgős baj nem rejtődik el a „javasolt” elutasításával.
    const urgent = booked(badMonday())
    expect(watchWeek(urgent.input, urgent.base, { dismissals: [{ requestId: 'f1', ...d }] }).items.map((i) => i.kind)).toEqual(['move'])
  })

  it(`a ${WATCH_NOTICE_MINUTES} percen belül kezdődő foglalást nem mozdítja`, () => {
    const { input, base } = booked(badMonday(), { options: { now: at(DAYS[0]!, '07:30') } })
    expect(watchWeek(input, base)).toEqual({ items: [], watched: { booked: 0, deferred: 0 } })
  })

  it('a halasztott igényt visszahozza, ha a héten repülhető tiszta helye van', () => {
    const f2 = flight('f2', 'n2')
    const input: PlanInput = { snapshot: baseSnapshot(), settings: baseSettings(), requests: [f2], decisions: [{ kind: 'defer', requestId: 'f2' }] }
    const base = plan(input)
    const [item] = watchWeek(input, base).items
    expect(item).toMatchObject({ kind: 'restore', requestId: 'f2', weather: 'flyable' })
    if (item?.kind !== 'restore') throw new Error('visszahozás kellett')
    expect(toMs(item.to.start)).toBeGreaterThanOrEqual(toMs(PLANNED_AT) + WATCH_NOTICE_MINUTES * 60_000)
    // A következő héten már eldöntött másolat nem hozható vissza; rossz időben sincs javaslat.
    expect(watchWeek(input, base, { noRestore: ['f2'] }).items).toEqual([])
    const bad = { ...input, snapshot: baseSnapshot({ weather: weekWeather(() => true) }) }
    expect(watchWeek(bad, plan(bad)).items).toEqual([])
    // Csak a megbízható előrejelzés távján (2 nap): a távolabbi napra nem hoz vissza.
    const late = { ...input, options: { now: at(DAYS[0]!, '06:00') }, snapshot: baseSnapshot({ weather: weekWeather((d) => d <= DAYS[2]!) }) }
    expect(watchWeek(late, plan(late)).items).toEqual([])
  })

  it('a visszahozás megnevezi, kit szorítana ki a tervből', () => {
    // Csak hétfő délelőtt dolgozik az oktató: egy repülés fér be. Az n3 sürgős és elsőbbségű.
    const s = baseSettings()
    const monday = { start: '08:00', end: '10:30' }
    const settings = {
      ...s,
      instructor: { ...s.instructor, workWindows: { mon: monday, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
      students: s.students.map((st) => (st.userId === 'n3' ? { ...st, priority: 5 } : st.userId === 'n2' ? { ...st, priority: 1 } : st)),
    }
    const snapshot = baseSnapshot({ lastFlightAt: { n2: '2026-11-13T10:00:00.000Z', n3: '2026-10-01T10:00:00.000Z' } })
    const input: PlanInput = { snapshot, settings, requests: [flight('f2', 'n2'), flight('f3', 'n3')], decisions: [{ kind: 'defer', requestId: 'f3' }] }
    const base = plan(input)
    expect(base.proposals.map((p) => p.requestId)).toEqual(['f2'])
    const [item] = watchWeek(input, base).items
    expect(item).toMatchObject({ kind: 'restore', requestId: 'f3', displaced: ['f2'], moved: [] })
  })

  it('a visszahozás megnevezi, kit tenne át máshová a tervben (közös próba, KIT-08)', () => {
    // Hétfőn és kedden délelőtt egy-egy repülés fér be; n3 csak hétfőn ér rá.
    const s = baseSettings()
    const morning = { start: '08:00', end: '10:30' }
    const settings = { ...s, instructor: { ...s.instructor, workWindows: { mon: morning, tue: morning, wed: null, thu: null, fri: null, sat: null, sun: null } } }
    const snapshot = baseSnapshot({ availabilities: { n3: [{ start: at(DAYS[0]!, '07:00'), end: at(DAYS[0]!, '11:00'), unavailable: false }] } })
    const input: PlanInput = { snapshot, settings, requests: [flight('f2', 'n2'), flight('f3', 'n3')], decisions: [{ kind: 'defer', requestId: 'f3' }] }
    const base = plan(input)
    expect(base.proposals.find((p) => p.requestId === 'f2')!.slot.start.slice(0, 10)).toBe(at(DAYS[0]!, '09:00').slice(0, 10))
    const [item] = watchWeek(input, base).items
    expect(item).toMatchObject({ kind: 'restore', requestId: 'f3', displaced: [], moved: ['f2'] })
  })

  it('jelzi a hiányzó rögzített és a még foglalt halasztott igényt', () => {
    const slot = slotOf(flBooking('x'))
    const f3 = flight('f3', 'n3', { lectureId: 'L3' })
    const b3 = flBooking('fl-3', DAYS[2]!, '09:30', { participantIds: ['n3'], lectureId: 'L3' })
    const input: PlanInput = {
      snapshot: baseSnapshot({ bookings: [b3] }),
      settings: baseSettings(),
      requests: [f1, f3],
      decisions: [{ kind: 'defer', requestId: 'f3' }],
      recorded: [{ requestId: 'f1', slot }],
    }
    const items = watchWeek(input, plan(input)).items
    expect(items.map((i) => [i.kind, i.requestId])).toEqual([
      ['missing', 'f1'],
      ['stillBooked', 'f3'],
    ])
  })
})

describe('FlightLogger-jelölés a tervezett igényen (9.7)', () => {
  const later = slotOf(flBooking('y', DAYS[2]!))
  const move = [{ kind: 'move' as const, requestId: 'f1', bookingId: 'fl-1' }]

  it('az áthelyezendőnek jelölt igény rendes tervezett tétel: a döntés helyén áll, a régi hely nem foglal, a figyelés nem nézi újra', () => {
    const { fl, input } = booked(badMonday())
    const withMove: PlanInput = { ...input, decisions: [{ kind: 'assign', requestId: 'f1', slot: later, acceptWarnings: false }], changes: move }
    const r = plan(withMove)
    expect(r.recordedInFlightLogger).toEqual([])
    expect(r.supersededBookings).toEqual(['fl-1'])
    expect(r.proposals).toMatchObject([{ requestId: 'f1', decidedBy: 'instructor', slot: { start: later.start }, change: { kind: 'move', bookingId: 'fl-1', from: { start: fl.start } } }])
    expect(r.proposals[0]!.recorded).toBeUndefined()
    expect(watchWeek(withMove, r).items).toEqual([])
    // Döntés nélkül a motor tervezi (hétfőn rossz az idő, máshová teszi), a jelölés marad.
    const free = plan({ ...withMove, decisions: [] })
    expect(free.proposals[0]).toMatchObject({ decidedBy: 'engine', change: { kind: 'move' } })
    expect(dateOf(free.proposals[0]!.slot.start)).not.toBe(DAYS[0])
    // A frissítés szerint már a terv szerinti helyen van: kész.
    const done = plan({ ...withMove, snapshot: baseSnapshot({ bookings: [flBooking('fl-1', DAYS[2]!)], weather: badMonday() }) })
    expect(done.completedChanges).toEqual([{ requestId: 'f1', kind: 'move', bookingId: 'fl-1', slot: later }])
    expect(done.proposals[0]!.change).toBeUndefined()
    // Ha a terv a FlightLogger szerinti helyre tér vissza, nincs mit átírni.
    const back = plan({ ...input, decisions: [{ kind: 'assign', requestId: 'f1', slot: slotOf(fl), acceptWarnings: true }], changes: move })
    expect(back.completedChanges).toEqual([{ requestId: 'f1', kind: 'move', bookingId: 'fl-1', slot: slotOf(fl) }])
  })

  it('a tervbe tett lemondás halaszt, teendőt ad, és nem kínál visszahozást', () => {
    const { input } = booked(badMonday())
    const cancel: PlanInput = { ...input, decisions: [{ kind: 'defer', requestId: 'f1' }], changes: [{ kind: 'cancel', requestId: 'f1', bookingId: 'fl-1' }] }
    const r = plan(cancel)
    expect(r.deferred).toEqual(['f1'])
    expect(r.plannedCancels).toMatchObject([{ requestId: 'f1', bookingId: 'fl-1', done: false }])
    expect(r.supersededBookings).toEqual(['fl-1'])
    expect(watchWeek(cancel, r).items).toEqual([])
    // Lemondta, a frissítés még nem hozta le: nincs teendő; ha már nincs meg, kész.
    const marked = plan({ ...cancel, changes: [{ kind: 'cancel', requestId: 'f1', bookingId: 'fl-1', doneAt: '2026-11-15T09:30:00.000Z' }] })
    expect(marked.plannedCancels).toMatchObject([{ requestId: 'f1', done: true }])
    const gone = plan({ ...cancel, snapshot: baseSnapshot({ weather: badMonday() }) })
    expect(gone.completedChanges).toEqual([{ requestId: 'f1', kind: 'cancel', bookingId: 'fl-1' }])
    expect(gone.deferred).toEqual(['f1'])
    // Visszavont halasztásnál a lemondás jelölése sem áll: a foglalás marad, ahol van.
    const undone = plan({ ...cancel, decisions: [] })
    expect(undone.plannedCancels).toEqual([])
    expect(undone.recordedInFlightLogger.map((b) => b.bookingId)).toEqual(['fl-1'])
  })
})

describe('a tervezet hét közbeni műveletei', () => {
  const base = (): WeekPlan => ({ ...createWeekPlan('2026-11-16', '2026-11-15T09:00:00.000Z'), requests: [f1, flight('f2', 'n2')] })
  const slot = slotOf(flBooking('x'))
  const later = slotOf(flBooking('y', DAYS[2]!))

  it('az áthelyezés az új helyet, az időpontot és a régi foglalást is menti; az elutasítások törlődnek', () => {
    let wp = setRecordingStatus(base(), 'f1', 'recorded', slot, '2026-11-15T10:00:00.000Z')
    wp = rememberBookingIds(wp, [{ requestId: 'f1', bookingId: 'fl-1' }, { requestId: 'f2', bookingId: 'fl-2' }])
    expect(wp.recordedBookings).toEqual({ f1: 'fl-1' })
    expect(rememberBookingIds(wp, [{ requestId: 'f1', bookingId: 'fl-1' }])).toBe(wp)
    wp = dismissWatch(wp, 'f1', 'improve', slot.start, '2026-11-15T10:05:00.000Z')
    wp = markMovedInFlightLogger(wp, 'f1', later, 'fl-1', '2026-11-15T11:00:00.000Z')
    expect(recordedInput(wp)).toEqual([{ requestId: 'f1', slot: later, at: '2026-11-15T11:00:00.000Z', bookingId: 'fl-1' }])
    expect(wp.watchDismissals).toEqual([])
  })

  it('az áthelyezés és a lemondás előbb csak a foglalási tervbe kerül; a FlightLoggerben elvégezve zárul', () => {
    const recorded = setRecordingStatus(base(), 'f1', 'recorded', slot, '2026-11-15T10:00:00.000Z', 'fl-1')
    // Áthelyezés a tervbe: jelölés és kézi döntés a javasolt helyre; a „mégsem” mindkettőt viszi.
    let wp = planMove(recorded, 'f1', 'fl-1', later)
    expect(changesInput(wp)).toEqual([{ kind: 'move', requestId: 'f1', bookingId: 'fl-1' }])
    expect(wp.decisions).toEqual([{ kind: 'assign', requestId: 'f1', slot: later, acceptWarnings: false }])
    const reverted = revertChange(wp, 'f1')
    expect([reverted.flChanges, reverted.decisions]).toEqual([{}, []])
    // A FlightLoggerben átírta: a terv szerinti hely rögzített, a jelölés és a döntés megszűnik.
    wp = completeMove(wp, 'f1', later, '2026-11-15T11:00:00.000Z')
    expect(changesInput(wp)).toEqual([])
    expect(wp.decisions).toEqual([])
    expect(recordedInput(wp)).toEqual([{ requestId: 'f1', slot: later, at: '2026-11-15T11:00:00.000Z', bookingId: 'fl-1' }])
    // Lemondás a tervbe: a halasztás döntésként is bekerül; a „mégsem” azt is visszavonja.
    let c = planCancel(recorded, 'f1', 'fl-1')
    expect(c.decisions).toEqual([{ kind: 'defer', requestId: 'f1' }])
    expect(revertChange(c, 'f1').decisions).toEqual([])
    c = markCancelled(c, 'f1', '2026-11-15T12:00:00.000Z')
    expect(changesInput(c)).toEqual([{ kind: 'cancel', requestId: 'f1', bookingId: 'fl-1', doneAt: '2026-11-15T12:00:00.000Z' }])
    // A frissítés szerint lemondva: a rögzítés megszűnik, a halasztás marad.
    c = applyCompletedChanges(c, [{ requestId: 'f1', kind: 'cancel', bookingId: 'fl-1' }], '2026-11-15T13:00:00.000Z')
    expect(changesInput(c)).toEqual([])
    expect(recordedInput(c)).toEqual([])
    expect(c.decisions).toEqual([{ kind: 'defer', requestId: 'f1' }])
    // A visszahozott halasztás a javasolt helyre kerül.
    expect(restoreDeferred(c, 'f1', later).decisions).toEqual([{ kind: 'assign', requestId: 'f1', slot: later, acceptWarnings: false }])
  })

  it('a következő héten rögzített vagy eldöntött másolat nem tűnik el, és nem hozható vissza (H07)', () => {
    const previous: WeekPlan = { ...base(), decisions: [{ kind: 'defer', requestId: 'f1' }, { kind: 'defer', requestId: 'f2' }] }
    let next = createWeekPlan('2026-11-23', '2026-11-15T09:00:00.000Z', previous)
    next = setRecordingStatus(next, 'f1-h', 'recorded', slot, '2026-11-15T10:00:00.000Z')
    expect(lockedCarriedIds(next, '2026-11-16')).toEqual(['f1'])
    // Ha a forrás halasztását visszavonják, a rögzített másolat marad, a többi kikerül.
    const synced = syncDeferred(next, { ...previous, decisions: [] })
    expect(synced.requests.map((r) => r.id)).toEqual(['f1-h'])
    // Akit csak a kikerült másolat hozott a hétre, az a kijelöltek közül is kikerül.
    expect(next.selectedStudentIds).toEqual(['n1', 'n2'])
    expect(synced.selectedStudentIds).toEqual(['n1'])
  })
})
