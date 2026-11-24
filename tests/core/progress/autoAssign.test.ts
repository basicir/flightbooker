import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import { setRequestTask } from '../../../src/core/draft/weekPlan'
import type { BookingRequest, ExistingBooking } from '../../../src/core/model/planning'
import { assignAutomaticLectures, bookedLectureIds, lectureSequences } from '../../../src/core/progress/autoAssign'
import { computeProgress, type LectureInfo, type TrainingRecord } from '../../../src/core/progress/lectures'

// Szintetikus program (CLAUDE.md 4. pont).
const L = (id: string, name: string, extra: Partial<LectureInfo> = {}): LectureInfo => ({ id, name, revisionId: 'rev', briefingMinutes: 45, flightMinutes: 60, debriefingMinutes: 30, simulator: false, night: false, ...extra })
const CATALOG: Record<string, LectureInfo> = Object.fromEntries(
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
const rec = (lectureId: string, day: number, extra: Partial<TrainingRecord> = {}): TrainingRecord => ({ lectureId, status: 'PASSED', at: new Date(Date.UTC(2026, 10, day, 10)).toISOString(), revisionId: 'rev', ...extra })

// Mint 58_KOG: a III./15. kimaradt, a III./16. a legutóbbi, a III./17–18. megvan.
const PROGRESS = computeProgress([rec('a1', 5), rec('a4', 6), rec('a5', 7), rec('a3', 9), rec('a1', 9, { custom: true, at: new Date(Date.UTC(2026, 10, 9, 8)).toISOString() })], CATALOG)
const NOW = Date.UTC(2026, 10, 11, 12)
const settings = createDefaultSettings()

const req = (id: string, mode: BookingRequest['taskSelectionMode'], extra: Partial<BookingRequest> = {}): BookingRequest => ({
  id,
  kind: 'flight',
  studentIds: ['n1'],
  taskSelectionMode: mode,
  durations: { briefing: 45, main: 60, debriefing: 30 },
  daylightOnly: true,
  origin: 'progress',
  ...extra,
})

const booking = (start: string, lectureName: string, extra: Partial<ExistingBooking> = {}): ExistingBooking => ({
  id: `b-${start}`,
  type: 'singleStudent',
  status: 'OPEN',
  start,
  end: start,
  participantIds: ['n1'],
  plannedLectureName: lectureName,
  ...extra,
})

const run = (requests: BookingRequest[], bookings: ExistingBooking[] = []) =>
  assignAutomaticLectures({ settings, requests, catalog: CATALOG, progressFor: (id) => (id === 'n1' ? PROGRESS : undefined), bookings, nowMs: NOW })

describe('automatikus feladatválasztás (7.5)', () => {
  it('a legutóbbi (egyedi nélküli) feladat utáni első teljesítetlent adja, az időtartammal és a nappali jelleggel', () => {
    const [r] = run([req('r1', 'automatic')])
    expect(r).toMatchObject({ lectureId: 'a6', durations: { briefing: 45, main: 60, debriefing: 30 }, daylightOnly: true })
  })

  it('a növendék több automatikus igénye egymást követő feladatokat kap', () => {
    expect(run([req('r1', 'automatic'), req('r2', 'automatic')]).map((r) => r.lectureId)).toEqual(['a6', 'a7'])
  })

  it('a FlightLoggerben lefoglalt jövőbeli feladatot átugorja, a múltbelit és a lemondottat nem', () => {
    const bookings = [
      booking(new Date(NOW + 86_400_000).toISOString(), 'III./19. PIC III.'),
      booking(new Date(NOW - 86_400_000).toISOString(), 'III./20. PIC IV.'),
      booking(new Date(NOW + 2 * 86_400_000).toISOString(), 'III./20. PIC IV.', { status: 'CANCELLED' }),
    ]
    expect([...bookedLectureIds(PROGRESS, CATALOG, bookings, 'n1', NOW)]).toEqual(['a6'])
    expect(run([req('r1', 'automatic')], bookings)[0]!.lectureId).toBe('a7')
  })

  it('a többnövendékes foglalásból a növendék saját feladatát ugorja át; megfigyelőként nincs feladata (KBR-10)', () => {
    const tomorrow = new Date(NOW + 86_400_000).toISOString()
    const bookings = [
      booking(tomorrow, '', {
        id: 'pair',
        type: 'multiStudent',
        participantIds: ['n2', 'n1'],
        plannedLectureName: undefined,
        lessons: [
          { studentId: 'n2', lectureName: 'III./20. PIC IV.' },
          { studentId: 'n1', lectureName: 'III./19. PIC III.' },
        ],
      }),
      booking(tomorrow, 'III./20. PIC IV.', { id: 'watching', participantIds: ['n3', 'n1'], observerIds: ['n1'] }),
    ]
    expect([...bookedLectureIds(PROGRESS, CATALOG, bookings, 'n1', NOW)]).toEqual(['a6'])
  })

  it('a kézzel választott feladatot nem írja felül, és nem adja oda másik igénynek', () => {
    const manual = req('r1', 'manual', { lectureId: 'a6' })
    const result = run([manual, req('r2', 'automatic')])
    expect(result[0]).toBe(manual)
    expect(result[1]!.lectureId).toBe('a7')
  })

  it('feladat nélküli igényhez nem nyúl, más növendék igényéhez sem', () => {
    const none = req('r1', 'none')
    const other = req('r2', 'automatic', { studentIds: ['n2'] })
    const result = run([none, other])
    expect(result[0]).toBe(none)
    expect(result[1]).toBe(other)
  })

  it('ha a feladat közben teljesült, frissítéskor a rákövetkezőt kapja (TRV-19)', () => {
    const stale = req('r1', 'automatic', { lectureId: 'a3' })
    expect(run([stale])[0]!.lectureId).toBe('a6')
  })

  it('változatlan helyzetben ugyanazt az objektumot adja vissza (nincs fölösleges mentés)', () => {
    const first = run([req('r1', 'automatic')])
    const second = run(first)
    expect(second[0]).toBe(first[0])
  })

  it('a szimulátoros feladat szimulátor-igényt ad', () => {
    const progress = computeProgress([rec('a7', 10)], CATALOG)
    const [r] = assignAutomaticLectures({ settings, requests: [req('r1', 'automatic')], catalog: CATALOG, progressFor: () => progress, bookings: [], nowMs: NOW })
    expect(r).toMatchObject({ lectureId: 'a8', kind: 'simulator', durations: { main: 120 }, daylightOnly: false })
  })
})

describe('feladatválasztás igényenként (SZB-02)', () => {
  it('kézi, feladat nélküli és automatikus mód között vált', () => {
    const manual = setRequestTask(settings, req('r1', 'automatic'), { mode: 'manual', lecture: CATALOG['a2']! })
    expect(manual).toMatchObject({ taskSelectionMode: 'manual', lectureId: 'a2', durations: { main: 30 }, daylightOnly: false })
    const none = setRequestTask(settings, manual, { mode: 'none' })
    expect(none.taskSelectionMode).toBe('none')
    expect(none.lectureId).toBeUndefined()
    expect(none.durations).toEqual({ briefing: 45, main: 60, debriefing: 30 })
    expect(setRequestTask(settings, none, { mode: 'automatic' }).taskSelectionMode).toBe('automatic')
  })

  it('a FlightLoggerben lefoglalt igény a foglalás feladatát tartja, a többi a következőt kapja (9.6)', () => {
    // A III./19. (a6) le van foglalva, az r1 igényé; nélküle a foglalás miatt átugrana.
    const bookings = [booking('2026-11-17T09:00:00.000Z', 'III./19. PIC III.', { lectureId: 'a6' })]
    const linked = new Map([['r1', 'a6']])
    const out = assignAutomaticLectures({ settings, requests: [req('r1', 'automatic', { lectureId: 'a6' }), req('r2', 'automatic')], catalog: CATALOG, progressFor: () => PROGRESS, bookings, nowMs: NOW, linked })
    expect(out.map((r) => r.lectureId)).toEqual(['a6', 'a7'])
    // A korábban elcsúszott feladat a foglaláséra áll vissza.
    const [fixed] = assignAutomaticLectures({ settings, requests: [req('r1', 'automatic', { lectureId: 'a7' })], catalog: CATALOG, progressFor: () => PROGRESS, bookings, nowMs: NOW, linked })
    expect(fixed!.lectureId).toBe('a6')
  })
})

describe('feladatsorrend és elsőbbség (ELS-05)', () => {
  const sequencesOf = (requests: BookingRequest[], progress = PROGRESS) => lectureSequences({ settings, requests, catalog: CATALOG, progressFor: (id) => (id === 'n1' ? progress : undefined) })

  it('a fontosabb igény kapja a korábbi feladatot, a lista sorrendjétől függetlenül', () => {
    const out = run([req('plusz', 'automatic', { priority: 3 }), req('kezi', 'automatic')])
    expect(out.find((r) => r.id === 'kezi')!.lectureId).toBe('a6')
    expect(out.find((r) => r.id === 'plusz')!.lectureId).toBe('a7')
    expect(sequencesOf(out)).toEqual([['kezi', 'plusz']])
  })

  it('a sor a haladást követi: a legutóbbi feladat után előre, a program végén elölről', () => {
    // Legutóbb a III./16. (a3) sikerült; a III./17–18. megvan, a III./15. kimaradt.
    const out = run(['r1', 'r2', 'r3', 'r4'].map((id) => req(id, 'automatic')))
    expect(out.map((r) => r.lectureId)).toEqual(['a6', 'a7', 'a8', 'a2'])
    // A programsorrend az a2-t tenné előre; a haladás szerinti sorban a végére kerül.
    expect(sequencesOf([...out].reverse())).toEqual([['r1', 'r2', 'r3', 'r4']])
  })

  it('a FlightLoggerben lefoglalt feladat a helyén áll a sorban, akkor is, ha a listában előbb van', () => {
    const linked = new Map([['fl', 'a7']])
    const out = assignAutomaticLectures({ settings, requests: [req('fl', 'automatic', { lectureId: 'a7' }), req('uj', 'automatic')], catalog: CATALOG, progressFor: () => PROGRESS, bookings: [], nowMs: NOW, linked })
    expect(out.find((r) => r.id === 'uj')!.lectureId).toBe('a6')
    expect(sequencesOf(out)).toEqual([['uj', 'fl']])
  })

  it('sikertelen legutóbbi feladat ismétlése kerül a sor elejére', () => {
    const failed = computeProgress([rec('a4', 6), rec('a5', 7), rec('a6', 9, { status: 'FAILED' })], CATALOG)
    const linked = new Map([['fl', 'a7']])
    const out = assignAutomaticLectures({ settings, requests: [req('fl', 'automatic', { lectureId: 'a7' }), req('ism', 'automatic')], catalog: CATALOG, progressFor: () => failed, bookings: [], nowMs: NOW, linked })
    expect(out.find((r) => r.id === 'ism')!.lectureId).toBe('a6')
    expect(sequencesOf(out, failed)).toEqual([['ism', 'fl']])
  })

  it('a kézzel választott feladat nem része a sornak; egytagú sor nincs', () => {
    const manual = setRequestTask(settings, req('k', 'automatic'), { mode: 'manual', lecture: CATALOG['a7']! })
    const out = run([manual, req('a', 'automatic')])
    expect(sequencesOf(out)).toEqual([])
  })

  it('ismeretlen haladásnál az elsőbbség, majd a lista sorrendje dönt', () => {
    const requests = [req('x', 'automatic', { lectureId: 'a5', priority: 2 }), req('y', 'automatic', { lectureId: 'a4' }), req('z', 'automatic', { lectureId: 'a6', priority: 2 })]
    expect(lectureSequences({ settings, requests, catalog: CATALOG, progressFor: () => undefined })).toEqual([['y', 'x', 'z']])
  })
})
