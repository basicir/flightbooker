import { describe, expect, it } from 'vitest'
import { createWeekPlan, planCancel, planMove, setRecordingStatus, WeekPlanSchema, type WeekPlan } from '../../../src/core/draft/weekPlan'
import {
  applyReceipt,
  FL_RECEIPT_FORMAT,
  FlImportPackageSchema,
  importBookingsFor,
  importPackageText,
  openImportEntries,
  parseReceipt,
  type FlReceipt,
  type ImportContext,
} from '../../../src/core/flImport/importBookings'
import type { BookingRequest, ExistingBooking, PlannedTeam, Proposal, Slot } from '../../../src/core/model/planning'

/** Szintetikus adatok (CLAUDE.md 4. pont): kitalált nevek, kódok, lajstromjelek. */
const TZ = 'Europe/Budapest'
const NOW = '2026-11-15T10:00:00.000Z'

const people: Record<string, { callSign: string; name: string }> = {
  n1: { callSign: 'TSTA', name: 'Teszt Elek' },
  n2: { callSign: '12_MIN', name: 'Minta Anna' },
  n3: { callSign: 'PRBB', name: 'Próba Béla' },
}
const ctx: ImportContext = {
  timezone: TZ,
  instructor: { callSign: 'OKTA', name: 'Oktató Olga' },
  person: (id) => people[id] ?? { name: `ismeretlen ${id}` },
  program: (id) => (id === 'n3' ? undefined : 'PPL(A) – Revision 2'),
  lesson: (id) => ({ l1: 'I./1.A. Ismerkedő repülés', l2: 'I./2.A. Egyenes vonalú repülés' })[id],
  aircraft: (id) => (id === 'g1' ? { id: 'g1', callSign: 'HA-XYZ', model: 'TESZT 152' } : undefined),
  classroom: (id) => (id === 'c1' ? { id: 'c1', name: 'Terem 1' } : undefined),
  className: (id) => (id === 'o1' ? 'Teszt osztály A' : undefined),
}

const flight = (id: string, student: string, lectureId?: string): BookingRequest => ({
  id,
  kind: 'flight',
  studentIds: [student],
  ...(lectureId ? { lectureId } : {}),
  taskSelectionMode: 'manual',
  durations: { briefing: 45, main: 60, debriefing: 30 },
  daylightOnly: true,
  origin: 'manual',
})
const theory = (id: string, studentIds: string[], theoryType?: BookingRequest['theoryType']): BookingRequest => ({
  id,
  kind: 'theory',
  studentIds,
  ...(theoryType ? { theoryType } : {}),
  taskSelectionMode: 'none',
  durations: { briefing: 0, main: 90, debriefing: 0 },
  daylightOnly: false,
  origin: 'manual',
})
const proposal = (requestId: string, slot: Slot, extra: Partial<Proposal> = {}): Proposal => ({
  requestId,
  slot,
  score: 80,
  factors: [],
  warnings: [],
  standby: false,
  decidedBy: 'engine',
  assumptions: [],
  ...extra,
})

// 2026-11-17 kedd, téli idő (UTC+1).
const flightSlot: Slot = {
  start: '2026-11-17T07:00:00.000Z',
  flightStart: '2026-11-17T07:45:00.000Z',
  flightEnd: '2026-11-17T08:45:00.000Z',
  end: '2026-11-17T09:15:00.000Z',
  resourceId: 'g1',
}
const theorySlot: Slot = { start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T10:30:00.000Z', classroomId: 'c1' }

describe('FlightLogger-import: tételek (FLI-01, FLI-02)', () => {
  it('a repülés Single student, a négy időpont a FlightLogger formátumában', () => {
    const [b] = importBookingsFor(ctx, { kind: 'single', request: flight('r1', 'n1', 'l1'), proposal: proposal('r1', flightSlot, { comment: 'Teszt komment' }) })
    expect(b).toMatchObject({
      id: 'r1',
      requestIds: ['r1'],
      flType: 'Single student',
      tile: 'Single student',
      date: '2026-11-17',
      instructor: { callSign: 'OKTA', name: 'Oktató Olga' },
      students: [{ callSign: 'TSTA', name: 'Teszt Elek', program: 'PPL(A) – Revision 2', lesson: 'I./1.A. Ismerkedő repülés' }],
      aircraft: { id: 'g1', callSign: 'HA-XYZ', model: 'TESZT 152' },
      times: {
        briefing: { date: '17.11.2026', time: '08:00' },
        start: { date: '17.11.2026', time: '08:45' },
        end: { date: '17.11.2026', time: '09:45' },
        debriefing: { date: '17.11.2026', time: '10:15' },
      },
      minutes: { start: 480, end: 615, flightStart: 525, flightEnd: 585 },
      comment: 'Teszt komment',
    })
    expect(b?.label).toBe('Teszt Elek · I./1.A. Ismerkedő repülés · HA-XYZ')
  })

  it('az elmélet alapból megbeszélés (Meeting)', () => {
    const [b] = importBookingsFor(ctx, { kind: 'single', request: theory('t0', ['n1']), proposal: proposal('t0', theorySlot) })
    expect(b?.flType).toBe('Meeting')
  })

  it('a Ground training a növendékekkel és az igényen megadott FlightLogger-mezőkkel (FLI-11)', () => {
    const request: BookingRequest = {
      ...theory('t1', ['n1', 'n2'], 'groundTraining'),
      classId: 'o1',
      flTheory: { programRevisionId: 'r6', program: 'Teszt Ground School Revision 6', subjectId: 's1', subject: 'VFR Groundschool', sessionType: 'Progress test', session: 'Navigáció 3.' },
    }
    const [g] = importBookingsFor(ctx, { kind: 'single', request, proposal: proposal('t1', theorySlot) })
    expect(g?.theory).toEqual({ className: 'Teszt osztály A', program: 'Teszt Ground School Revision 6', subject: 'VFR Groundschool', sessionType: 'Progress test', session: 'Navigáció 3.' })
    // Üres mező nem kerül a csomagba.
    const [plain] = importBookingsFor(ctx, { kind: 'single', request: theory('t1', ['n1'], 'groundTraining'), proposal: proposal('t1', theorySlot) })
    expect(plain?.theory).toBeUndefined()
    const [b] = importBookingsFor(ctx, { kind: 'single', request: theory('t1', ['n1', 'n2'], 'groundTraining'), proposal: proposal('t1', theorySlot) })
    expect(b).toMatchObject({
      flType: 'Ground lesson',
      tile: 'Ground training',
      instructor: { callSign: 'OKTA' },
      students: [{ callSign: 'TSTA' }, { callSign: '12_MIN' }],
      classroom: { id: 'c1', name: 'Terem 1' },
      times: { start: { date: '18.11.2026', time: '10:00' }, end: { date: '18.11.2026', time: '11:30' } },
    })
    expect(b?.times.briefing).toBeUndefined()
    // Elméletnél a növendék repülési programja és feladata nem kerül bele.
    expect(b?.students[0]?.program).toBeUndefined()
  })

  it('az extra elmélet növendékenként külön tétel, a rögzítéshez mind kell; a program mindegyiken', () => {
    const list = importBookingsFor(ctx, { kind: 'single', request: { ...theory('t2', ['n1', 'n2'], 'extraTheory'), flTheory: { program: 'Teszt Theory Revision 2' } }, proposal: proposal('t2', theorySlot) })
    expect(list.map((b) => b.theory?.program)).toEqual(['Teszt Theory Revision 2', 'Teszt Theory Revision 2'])
    expect(list.map((b) => [b.id, b.flType, b.partOf, b.students.map((s) => s.callSign)])).toEqual([
      ['t2#n1', 'Extra theory', 2, ['TSTA']],
      ['t2#n2', 'Extra theory', 2, ['12_MIN']],
    ])
  })

  it('a megbeszélésnek nincs oktató mezője: az oktató résztvevő', () => {
    const [b] = importBookingsFor(ctx, { kind: 'single', request: theory('t3', ['n2'], 'meeting'), proposal: proposal('t3', theorySlot) })
    expect(b?.flType).toBe('Meeting')
    expect(b?.instructor).toBeUndefined()
    expect(b?.participants.map((p) => p.callSign)).toEqual(['12_MIN', 'OKTA'])
  })

  it('a közös briefing pár Multi student: a Briefing és a Debriefing a csapaté, a Start és az End az egységé (KBR-09)', () => {
    const team: Slot = { start: '2026-11-19T07:00:00.000Z', end: '2026-11-19T11:00:00.000Z', resourceId: 'g1' }
    const unit = { requestIds: ['r2', 'r3'], bookingType: 'multiStudent' as const, resourceId: 'g1', flightStart: '2026-11-19T07:45:00.000Z', flightEnd: '2026-11-19T09:55:00.000Z' }
    const planned: PlannedTeam = { teamId: 'k1', requestIds: ['r2', 'r3'], state: 'placed', start: team.start, end: team.end, units: [unit] }
    const [b] = importBookingsFor(ctx, {
      kind: 'unit',
      team: planned,
      unit,
      members: [
        { request: flight('r2', 'n1', 'l1'), proposal: proposal('r2', { ...team, flightStart: unit.flightStart, flightEnd: '2026-11-19T08:45:00.000Z' }, { teamId: 'k1' }) },
        { request: flight('r3', 'n2', 'l2'), proposal: proposal('r3', { ...team, flightStart: '2026-11-19T08:55:00.000Z', flightEnd: unit.flightEnd }, { teamId: 'k1' }) },
      ],
    })
    expect(b).toMatchObject({
      id: 'r2+r3',
      requestIds: ['r2', 'r3'],
      flType: 'Multi student',
      students: [{ callSign: 'TSTA', lesson: 'I./1.A. Ismerkedő repülés' }, { callSign: '12_MIN', lesson: 'I./2.A. Egyenes vonalú repülés' }],
      times: { briefing: { time: '08:00' }, start: { time: '08:45' }, end: { time: '10:55' }, debriefing: { time: '12:00' } },
    })
  })
})

describe('FlightLogger-import: szín és komment (FLI-12)', () => {
  it('a beállított típusszín a foglaláson; szín nélkül nincs mező', () => {
    const colored: ImportContext = { ...ctx, color: (type) => (type === 'Single student' ? '#26A69A' : undefined) }
    const [f] = importBookingsFor(colored, { kind: 'single', request: flight('r1', 'n1', 'l1'), proposal: proposal('r1', flightSlot) })
    expect(f?.color).toBe('#26A69A')
    const [m] = importBookingsFor(colored, { kind: 'single', request: theory('t3', ['n2'], 'meeting'), proposal: proposal('t3', theorySlot) })
    expect(m?.color).toBeUndefined()
    expect(FlImportPackageSchema.safeParse(JSON.parse(importPackageText([f!, m!], TZ, NOW))).success).toBe(true)
  })

  it('a komment a tervezetről jön, hiányában az igény FlightLogger-kommentje', () => {
    const withNote = { ...flight('r1', 'n1', 'l1'), note: 'Az igény kommentje' }
    expect(importBookingsFor(ctx, { kind: 'single', request: withNote, proposal: proposal('r1', flightSlot) })[0]?.comment).toBe('Az igény kommentje')
    expect(importBookingsFor(ctx, { kind: 'single', request: withNote, proposal: proposal('r1', flightSlot, { comment: 'Tervezet' }) })[0]?.comment).toBe('Tervezet')
    expect(importBookingsFor(ctx, { kind: 'single', request: { ...theory('t1', ['n1']), note: 'Elmélet komment' }, proposal: proposal('t1', theorySlot) })[0]?.comment).toBe('Elmélet komment')
  })
})

describe('FlightLogger-import: nyitott tételek és csomag (FLI-03)', () => {
  const requests = [flight('r1', 'n1', 'l1'), flight('r2', 'n2'), flight('r3', 'n3'), flight('r4', 'n1')]
  const plan: WeekPlan = { ...createWeekPlan('2026-11-16', NOW), requests }
  const proposals = [
    proposal('r2', { ...flightSlot, start: '2026-11-18T07:00:00.000Z' }),
    proposal('r1', flightSlot),
    proposal('r3', flightSlot, { standby: true }),
    proposal('r4', flightSlot, { change: { kind: 'move', bookingId: 'b1', from: flightSlot } as unknown as NonNullable<Proposal['change']> }),
  ]

  it('a standby és a rögzített tétel kimarad, az áthelyezendő átírásként jön; időrendben', () => {
    const entries = openImportEntries({ proposals, teams: [] }, plan)
    expect(entries.map((e) => (e.kind === 'single' ? e.request.id : 'unit'))).toEqual(['r1', 'r4', 'r2'])
    expect(entries.map((e) => (e.kind !== 'cancel' ? e.update?.bookingId : 'x'))).toEqual([undefined, 'b1', undefined])
    const recorded = setRecordingStatus(plan, 'r1', 'recorded', flightSlot, NOW)
    expect(openImportEntries({ proposals, teams: [] }, recorded).map((e) => (e.kind === 'single' ? e.request.id : ''))).toEqual(['r4', 'r2'])
  })

  it('az áthelyezés a meglévő foglalás átírása: azonosító és a régi hely, szín nélkül (9.7)', () => {
    const from: Slot = { ...flightSlot, start: '2026-11-16T12:00:00.000Z', end: '2026-11-16T14:15:00.000Z' }
    const moved = proposal('r1', flightSlot, { change: { kind: 'move', bookingId: '11500397', from } })
    // A már rögzített igény áthelyezése is jön (a jelölés a rögzítés felett áll).
    const recorded = setRecordingStatus(plan, 'r1', 'recorded', from, NOW)
    const [entry] = openImportEntries({ proposals: [moved], teams: [] }, recorded)
    const [booking] = importBookingsFor({ ...ctx, color: () => '#26a69a' }, entry!)
    expect(booking?.update).toEqual({ bookingId: '11500397', from: { date: '2026-11-16', start: '13:00', end: '15:15' } })
    expect(booking?.color).toBeUndefined()
    expect(booking?.times.briefing).toEqual({ date: '17.11.2026', time: '08:00' })
    // Ha a foglalás a frissítés szerint már nincs meg, új foglalásként jön.
    const gone = proposal('r1', flightSlot, { change: { kind: 'move', bookingId: '11500397' } })
    const [fresh] = openImportEntries({ proposals: [gone], teams: [] }, recorded)
    expect(fresh?.kind === 'single' && fresh.update).toBeFalsy()
  })

  it('a csomag a saját sémáján átmegy', () => {
    const bookings = openImportEntries({ proposals, teams: [] }, plan).flatMap((e) => importBookingsFor(ctx, e))
    const parsed = FlImportPackageSchema.safeParse(JSON.parse(importPackageText(bookings, TZ, NOW)))
    expect(parsed.success).toBe(true)
    expect(parsed.data?.bookings).toHaveLength(3)
    expect(parsed.data?.version).toBe(2)
  })
})

describe('FlightLogger-import: átírás, lemondás, vegyes csapat (FLI-14, FLI-15)', () => {
  const team: Slot = { start: '2026-11-19T07:00:00.000Z', end: '2026-11-19T11:00:00.000Z', resourceId: 'g1' }
  const pairUnit = { requestIds: ['a', 'b'], bookingType: 'multiStudent' as const, resourceId: 'g1', flightStart: '2026-11-19T07:45:00.000Z', flightEnd: '2026-11-19T09:55:00.000Z' }
  const pairTeam: PlannedTeam = { teamId: 'k1', requestIds: ['a', 'b'], state: 'placed', start: team.start, end: team.end, units: [pairUnit] }
  const oldA: Slot = { start: '2026-11-18T07:00:00.000Z', end: '2026-11-18T09:00:00.000Z', resourceId: 'g1' }
  const oldB: Slot = { start: '2026-11-18T10:00:00.000Z', end: '2026-11-18T12:00:00.000Z', resourceId: 'g1' }
  const requests = [flight('a', 'n1', 'l1'), flight('b', 'n2', 'l2')]
  const plan: WeekPlan = { ...createWeekPlan('2026-11-16', NOW), requests }
  const move = (bookingId: string, from: Slot): Partial<Proposal> => ({ change: { kind: 'move', bookingId, from } })
  const kinds = (entries: ReturnType<typeof openImportEntries>) =>
    entries.map((e) => (e.kind === 'cancel' ? `lemond:${e.bookingId}` : `${e.kind}:${e.update ? `${e.update.bookingId}${e.update.full ? '!' : ''}` : 'új'}`))

  it('vegyes pár: az egyik tag meglévő foglalása a pár foglalása lesz (típus és növendékek is)', () => {
    const proposals = [proposal('a', { ...team, flightStart: pairUnit.flightStart, flightEnd: '2026-11-19T08:45:00.000Z' }, { teamId: 'k1', ...move('X', oldA) }), proposal('b', { ...team, flightStart: '2026-11-19T08:55:00.000Z', flightEnd: pairUnit.flightEnd }, { teamId: 'k1' })]
    const entries = openImportEntries({ proposals, teams: [pairTeam] }, plan)
    expect(kinds(entries)).toEqual(['unit:X!'])
    const [b] = importBookingsFor(ctx, entries[0]!)
    expect(b).toMatchObject({ flType: 'Multi student', update: { bookingId: 'X', full: true, from: { date: '2026-11-18', start: '08:00' } } })
  })

  it('két egyéni foglalásból pár: az elsőt átírja, a másikat lemondja', () => {
    const proposals = [
      proposal('a', { ...team, flightStart: pairUnit.flightStart, flightEnd: '2026-11-19T08:45:00.000Z' }, { teamId: 'k1', ...move('X', oldA) }),
      proposal('b', { ...team, flightStart: '2026-11-19T08:55:00.000Z', flightEnd: pairUnit.flightEnd }, { teamId: 'k1', ...move('Y', oldB) }),
    ]
    const entries = openImportEntries({ proposals, teams: [pairTeam] }, plan)
    expect(kinds(entries)).toEqual(['lemond:Y', 'unit:X!'])
    const cancel = importBookingsFor(ctx, entries[0]!)[0]
    expect(cancel).toMatchObject({ id: 'cancel:Y', requestIds: ['b'], cancel: { bookingId: 'Y', from: { date: '2026-11-18', start: '11:00', end: '13:00' } } })
    expect(cancel?.color).toBeUndefined()
  })

  it('szétvált pár: az első tag átírja (növendékkel együtt), a második újat kap', () => {
    const proposals = [proposal('a', flightSlot, move('X', oldA)), proposal('b', { ...flightSlot, start: '2026-11-17T10:00:00.000Z', end: '2026-11-17T12:00:00.000Z' }, move('X', oldA))]
    expect(kinds(openImportEntries({ proposals, teams: [] }, plan))).toEqual(['single:X!', 'single:új'])
  })

  it('a tervbe tett lemondás lemondási tétel; a visszaigazolás lezárja', () => {
    const cancelPlan = planCancel(setRecordingStatus(plan, 'a', 'recorded', oldA, NOW, 'X'), 'a', 'X')
    const entries = openImportEntries({ proposals: [], teams: [], plannedCancels: [{ requestId: 'a', bookingId: 'X', slot: oldA, done: false }] }, cancelPlan)
    expect(kinds(entries)).toEqual(['lemond:X'])
    expect(openImportEntries({ proposals: [], teams: [], plannedCancels: [{ requestId: 'a', bookingId: 'X', slot: oldA, done: true }] }, cancelPlan)).toEqual([])
    const r = parseReceipt(JSON.stringify({ format: FL_RECEIPT_FORMAT, version: 2, createdAt: NOW, items: [{ id: 'cancel:X', requestIds: ['a'], status: 'created', cancel: true, at: NOW }] }))!
    const out = applyReceipt(cancelPlan, r, [], NOW)
    expect(out.cancelled).toEqual(['a'])
    expect(out.plan.flChanges?.['a']).toMatchObject({ kind: 'cancel', bookingId: 'X', doneAt: NOW })
    expect(WeekPlanSchema.safeParse(out.plan).success).toBe(true)
  })

  it('több növendékes extra elmélet: a növendékenkénti foglalások átírása a pillanatkép alapján', () => {
    const from: Slot = { start: '2026-11-18T09:00:00.000Z', end: '2026-11-18T10:00:00.000Z', classroomId: 'c1' }
    const b = (id: string, sid: string): ExistingBooking => ({ id, type: 'theory', status: 'OPEN', start: from.start, end: from.end, classroomId: 'c1', instructorId: 'i1', participantIds: [sid] })
    const req = theory('t1', ['n1', 'n2', 'n3'], 'extraTheory')
    const p = proposal('t1', theorySlot, move('E1', from))
    const entries = openImportEntries({ proposals: [p], teams: [] }, { ...plan, requests: [req] }, [b('E1', 'n1'), b('E2', 'n2'), b('E9', 'n9')])
    const items = importBookingsFor(ctx, entries[0]!)
    expect(items.map((i) => [i.id, i.update?.bookingId ?? 'új'])).toEqual([['t1#n1', 'E1'], ['t1#n2', 'E2'], ['t1#n3', 'új']])
    // Az áthelyezés csak akkor zárul le, ha minden növendék tétele kész.
    const marked = planMove(setRecordingStatus({ ...plan, requests: [req] }, 't1', 'recorded', from, NOW, 'E1'), 't1', 'E1', theorySlot)
    const receipt = (n: number) => parseReceipt(JSON.stringify({ format: FL_RECEIPT_FORMAT, version: 2, createdAt: NOW, items: items.slice(0, n).map((i) => ({ id: i.id, requestIds: i.requestIds, partOf: i.partOf, status: 'created', at: NOW })) }))!
    expect(applyReceipt(marked, receipt(2), [p], NOW).pending).toEqual(['t1'])
    expect(applyReceipt(marked, receipt(3), [p], NOW).moved).toEqual(['t1'])
  })
})

describe('FlightLogger-import: visszaigazolás (FLI-08)', () => {
  const requests = [flight('r1', 'n1', 'l1'), flight('r2', 'n2'), theory('t2', ['n1', 'n2'], 'extraTheory')]
  const plan: WeekPlan = { ...createWeekPlan('2026-11-16', NOW), requests }
  const proposals = [proposal('r1', flightSlot), proposal('r2', flightSlot), proposal('t2', theorySlot)]
  const receipt = (items: FlReceipt['items']): string => JSON.stringify({ format: FL_RECEIPT_FORMAT, version: 1, createdAt: NOW, items })

  it('csak a saját formátumát ismeri fel', () => {
    expect(parseReceipt('Teszt Elek')).toBeNull()
    expect(parseReceipt('{"format":"flightbooker-fl-receipt","version":1}')).toBeNull()
    expect(parseReceipt('{"format":"masik","items":[]}')).toBeNull()
    expect(parseReceipt(receipt([]))).not.toBeNull()
  })

  it('a létrehozott tétel rögzített lesz a terv szerinti helyével; a kihagyott nem', () => {
    const r = parseReceipt(receipt([
      { id: 'r1', requestIds: ['r1'], status: 'created', at: NOW },
      { id: 'r2', requestIds: ['r2'], status: 'skipped', at: NOW },
      { id: 'torolt', requestIds: ['torolt'], status: 'created', at: NOW },
    ]))!
    const out = applyReceipt(plan, r, proposals, NOW)
    expect(out.recorded).toEqual(['r1'])
    expect(out.skipped).toEqual(['r2'])
    expect(out.pending).toEqual(['torolt'])
    expect(out.plan.recording).toEqual({ r1: 'recorded' })
    expect(out.plan.recordedSlots?.['r1']).toEqual(flightSlot)
    expect(WeekPlanSchema.safeParse(out.plan).success).toBe(true)
    // Ismételt beolvasás: nincs újabb változás.
    const again = applyReceipt(out.plan, r, proposals, NOW)
    expect(again.recorded).toEqual([])
    expect(again.already).toEqual(['r1'])
  })

  it('az átírt áthelyezés lezárul: az igény az új helyén rögzített, a foglalás azonosítója megmarad (9.7)', () => {
    const from: Slot = { ...flightSlot, start: '2026-11-17T07:00:00.000Z', end: '2026-11-17T09:15:00.000Z' }
    const recorded = setRecordingStatus(plan, 'r1', 'recorded', from, NOW, '11500397')
    const marked = planMove(recorded, 'r1', '11500397', flightSlot)
    const moved = [proposal('r1', flightSlot, { change: { kind: 'move', bookingId: '11500397', from } }), proposal('r2', flightSlot)]
    const r = parseReceipt(JSON.stringify({ format: FL_RECEIPT_FORMAT, version: 2, createdAt: NOW, items: [{ id: 'r1', requestIds: ['r1'], status: 'created', update: true, at: NOW }] }))!
    const out = applyReceipt(marked, r, moved, NOW)
    expect(out.recorded).toEqual(['r1'])
    expect(out.moved).toEqual(['r1'])
    expect(out.plan.flChanges?.['r1']).toBeUndefined()
    expect(out.plan.recording['r1']).toBe('recorded')
    expect(out.plan.recordedSlots?.['r1']).toEqual(flightSlot)
    expect(out.plan.recordedBookings?.['r1']).toBe('11500397')
    expect(out.plan.decisions.some((d) => d.requestId === 'r1' && d.kind === 'assign')).toBe(false)
    expect(WeekPlanSchema.safeParse(out.plan).success).toBe(true)
  })

  it('az extra elmélet csak akkor rögzített, ha minden növendék foglalása létrejött', () => {
    const half = parseReceipt(receipt([{ id: 't2#n1', requestIds: ['t2'], partOf: 2, status: 'created', at: NOW }]))!
    expect(applyReceipt(plan, half, proposals, NOW).pending).toEqual(['t2'])
    const full = parseReceipt(receipt([
      { id: 't2#n1', requestIds: ['t2'], partOf: 2, status: 'created', at: NOW },
      { id: 't2#n2', requestIds: ['t2'], partOf: 2, status: 'created', at: NOW },
    ]))!
    expect(applyReceipt(plan, full, proposals, NOW).recorded).toEqual(['t2'])
  })

  it('az elmélet típusa és FlightLogger-mezői a tervezet sémájában megmaradnak', () => {
    expect(WeekPlanSchema.safeParse({ ...plan, requests: [theory('t9', ['n1'], 'meeting')] }).success).toBe(true)
    expect(WeekPlanSchema.safeParse({ ...plan, requests: [{ ...theory('t9', ['n1'], 'groundTraining'), flTheory: { program: 'P', subject: 'S', sessionType: 'Exam', session: 'x' } }] }).success).toBe(true)
    expect(WeekPlanSchema.safeParse({ ...plan, requests: [{ ...theory('t9', ['n1'], 'groundTraining'), flTheory: { sessionType: 'Buli' } }] }).success).toBe(false)
    expect(WeekPlanSchema.safeParse({ ...plan, requests: [{ ...theory('t9', ['n1']), theoryType: 'party' }] }).success).toBe(false)
  })
})
