import { describe, expect, it } from 'vitest'
import { paidTime } from '../../../src/core/draft/paidTime'
import { plan } from '../../../src/core/engine/plan'
import type { ExistingBooking } from '../../../src/core/model/planning'
import type { LectureInfo } from '../../../src/core/progress/lectures'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR, theory } from '../../fixtures/syntheticWeek'

/** Az oktató fizetett ideje: repült idő (egyedül/SPIC is), szimulátor és elmélet; briefing nem (szintetikus adat). */

const lecture = (id: string, name: string, flightMinutes: number, soloMinutes?: number): LectureInfo => ({
  id,
  name,
  briefingMinutes: 45,
  flightMinutes,
  ...(soloMinutes !== undefined ? { soloMinutes } : {}),
  debriefingMinutes: 30,
  simulator: false,
  night: false,
})
const CATALOG: Record<string, LectureInfo> = {
  dual: lecture('dual', 'I./3. Kettős', 60, 0),
  solo: lecture('solo', 'II./1. Egyedül', 60, 60),
  // Az API-ból percek nélkül jött feladat: a feladatsor azonos kódú feladata dönt.
  api: lecture('api', 'II./1. Egyedül (API)', 60),
}

/** Az oktató foglalása hétfőn: 50 perc előkészület, 60 perc repülés, 15 perc utána. */
const mine = (id: string, extra: Partial<ExistingBooking> = {}): ExistingBooking =>
  existing(id, { start: at(DAYS[0]!, '08:40'), end: at(DAYS[0]!, '10:45'), flightStart: at(DAYS[0]!, '09:30'), flightEnd: at(DAYS[0]!, '10:30'), resourceId: 'p1', instructorId: INSTRUCTOR, participantIds: ['n1'], ...extra })

describe('az oktató fizetett ideje', () => {
  it('a FlightLogger-foglalásokból: csak a repülési rész, a szimulátor és az elmélet; más oktatóé, lemondott és áthelyezett nem', () => {
    const bookings: ExistingBooking[] = [
      mine('f'),
      mine('other', { instructorId: 'oktato-2' }),
      mine('cancelled', { status: 'CANCELLED' }),
      mine('moved'),
      mine('sim', { resourceId: 's1' }),
      mine('solo', { lectureId: 'api', plannedLectureName: 'II./1. Egyedül (API)' }),
      existing('th', { type: 'theory', start: at(DAYS[1]!, '13:00'), end: at(DAYS[1]!, '14:30'), classroomId: 'r1', instructorId: INSTRUCTOR, participantIds: ['n1'] }),
      existing('meet', { type: 'meeting', start: at(DAYS[1]!, '15:00'), end: at(DAYS[1]!, '16:00'), classroomId: 'r2', instructorId: INSTRUCTOR, participantIds: [] }),
      mine('nextWeek', { start: at('2026-11-23', '08:40'), end: at('2026-11-23', '10:45'), flightStart: at('2026-11-23', '09:30'), flightEnd: at('2026-11-23', '10:30') }),
    ]
    const snapshot = baseSnapshot({ bookings })
    const result = { ...plan({ snapshot, settings: baseSettings(), requests: [], decisions: [] }), supersededBookings: ['moved'] }
    const paid = paidTime({ snapshot, settings: baseSettings(), requests: [], result, catalog: CATALOG })
    expect(paid).toMatchObject({
      paidMinutes: 120 + 60 + 90,
      flightMinutes: 120,
      theoryMinutes: 90,
      soloMinutes: 60,
      simulatorMinutes: 60,
      bookedMinutes: 270,
    })
    // Tételesen, okokkal: a megbeszélés és az áthelyezendő régi hely kimarad.
    expect(paid.items.map((i) => [i.bookingId, i.category, i.minutes])).toEqual([
      ['f', 'flight', 60],
      ['sim', 'simulator', 60],
      ['solo', 'flight', 60],
      ['th', 'theory', 90],
    ])
    expect(paid.skipped.map((x) => x.bookingId)).toEqual(['moved', 'meet'])
  })

  it('a teremben tartott foglalás elmélet bármilyen fajtaként; a terv igényéhez tartozó akkor is az övé, ha az oktató mezője üres', () => {
    const room = (id: string, start: string, end: string, extra: Partial<ExistingBooking> = {}) =>
      existing(id, { start: at(DAYS[0]!, start), end: at(DAYS[0]!, end), classroomId: 'r1', instructorId: INSTRUCTOR, participantIds: ['n1'], ...extra })
    const bookings = [
      room('single', '08:00', '09:00', { type: 'singleStudent' }),
      room('noInstructor', '10:00', '11:30', { type: 'theory', instructorId: undefined }),
      room('meet', '12:00', '13:00', { type: 'meeting' }),
      room('foreign', '14:00', '15:00', { type: 'theory', instructorId: undefined }),
    ]
    const snapshot = baseSnapshot({ bookings })
    const base = plan({ snapshot, settings: baseSettings(), requests: [], decisions: [] })
    const t = theory('t', ['n1'])
    const result = { ...base, recordedInFlightLogger: [{ requestId: 't', bookingId: 'noInstructor', slot: { start: bookings[1]!.start, end: bookings[1]!.end, classroomId: 'r1' } }] }
    const paid = paidTime({ snapshot, settings: baseSettings(), requests: [t], result, catalog: CATALOG })
    expect(paid.items.map((i) => [i.bookingId, i.category, i.minutes])).toEqual([
      ['single', 'theory', 60],
      ['noInstructor', 'theory', 90],
    ])
    expect(paid.skipped.map((x) => x.bookingId)).toEqual(['meet'])
  })

  it('a terv elméletéhez tartozó, oktató nélküli megbeszélés elmélet; a többi megbeszélése nem számít', () => {
    const meeting = (id: string, start: string, end: string, participants: string[]) =>
      existing(id, { type: 'meeting', start: at(DAYS[1]!, start), end: at(DAYS[1]!, end), participantIds: participants })
    const bookings = [meeting('lesson', '09:00', '10:30', [INSTRUCTOR, 'n1']), meeting('staff', '11:00', '12:00', [INSTRUCTOR]), meeting('foreign', '13:00', '14:00', ['oktato-2'])]
    const snapshot = baseSnapshot({ bookings })
    const t = theory('t', ['n1'])
    const base = plan({ snapshot, settings: baseSettings(), requests: [t], decisions: [], recorded: [{ requestId: 't', slot: { start: bookings[0]!.start, end: bookings[0]!.end, classroomId: 'r1' } }] })
    expect(base.recordedInFlightLogger.map((l) => l.bookingId)).toEqual(['lesson'])
    const paid = paidTime({ snapshot, settings: baseSettings(), requests: [t], result: base, catalog: CATALOG })
    expect(paid.items.map((i) => [i.bookingId, i.category, i.minutes])).toEqual([['lesson', 'theory', 90]])
    expect(paid.skipped.map((x) => x.bookingId)).toEqual(['staff'])
  })

  it('a FlightLogger-foglalással átfedő tervtételt nem számolja kétszer', () => {
    const fl = mine('f')
    const snapshot = baseSnapshot({ bookings: [fl] })
    const requests = [flight('a', 'n2')]
    const result = plan({ snapshot, settings: baseSettings(), requests, decisions: [{ kind: 'assign', requestId: 'a', slot: { start: fl.start, end: fl.end, flightStart: fl.flightStart!, flightEnd: fl.flightEnd!, resourceId: 'p2' }, acceptWarnings: true }] })
    const paid = paidTime({ snapshot, settings: baseSettings(), requests, result, catalog: CATALOG })
    expect(paid.paidMinutes).toBe(60)
    expect(paid.skipped).toMatchObject([{ requestId: 'a' }])
  })

  it('közös briefingnél a briefing alatt átfedő tervtétel számít; a többnövendékes foglalás egyszer, egyedül repült része növendékenként (KBR-10)', () => {
    // 1. pár a FlightLoggerben: 08:00–13:50, repülés 08:45–10:55 (n1 kettős, n2 egyedül).
    const pair = existing('pair', {
      type: 'multiStudent',
      start: at(DAYS[1]!, '08:00'),
      end: at(DAYS[1]!, '13:50'),
      flightStart: at(DAYS[1]!, '08:45'),
      flightEnd: at(DAYS[1]!, '10:55'),
      resourceId: 'p1',
      instructorId: INSTRUCTOR,
      participantIds: ['n1', 'n2'],
      lessons: [
        { studentId: 'n1', lectureId: 'dual', lectureName: 'I./3. Kettős', flightMinutes: 60 },
        { studentId: 'n2', lectureId: 'solo', lectureName: 'II./1. Egyedül', flightMinutes: 60 },
      ],
    })
    const snapshot = baseSnapshot({ bookings: [pair] })
    // A 2. pár még csak a tervben: a briefing alatt átfed az 1. pár foglalásával, a repülése nem.
    const requests = [flight('c', 'n3')]
    const slot = { start: at(DAYS[1]!, '10:40'), end: at(DAYS[1]!, '12:25'), flightStart: at(DAYS[1]!, '11:10'), flightEnd: at(DAYS[1]!, '12:10'), resourceId: 'p1' }
    const result = plan({ snapshot, settings: baseSettings(), requests, decisions: [{ kind: 'assign', requestId: 'c', slot, acceptWarnings: true }] })
    const paid = paidTime({ snapshot, settings: baseSettings(), requests, result, catalog: CATALOG })
    expect(paid.items.map((i) => [i.bookingId ?? i.requestId, i.minutes])).toEqual([
      ['pair', 130],
      ['c', 60],
    ])
    expect(paid.skipped).toEqual([])
    expect(paid.soloMinutes).toBe(65)
  })

  it('a terv még nem rögzített tételeiből: a repülés, a szimulátor és az elmélet fő része; a standby nem', () => {
    const sim = flight('s', 'n3', { kind: 'simulator', daylightOnly: false, durations: { briefing: 30, main: 120, debriefing: 15 } })
    const requests = [flight('a', 'n1', { lectureId: 'dual' }), flight('b', 'n2', { lectureId: 'solo' }), sim, theory('t', ['n1', 'n2'])]
    const snapshot = baseSnapshot()
    const result = plan({ snapshot, settings: baseSettings(), requests, decisions: [] })
    expect(result.proposals.map((p) => p.requestId).sort()).toEqual(['a', 'b', 's', 't'])
    const paid = paidTime({ snapshot, settings: baseSettings(), requests, result, catalog: CATALOG })
    expect(paid).toMatchObject({ paidMinutes: 120 + 120 + 90, flightMinutes: 120, theoryMinutes: 90, soloMinutes: 60, simulatorMinutes: 120, bookedMinutes: 0 })
    expect(paid.items.every((i) => i.source === 'plan')).toBe(true)
    const withStandby = { ...result, proposals: [...result.proposals, { ...result.proposals.find((p) => p.requestId === 't')!, standby: true }] }
    expect(paidTime({ snapshot, settings: baseSettings(), requests, result: withStandby, catalog: CATALOG }).theoryMinutes).toBe(90)
  })
})
