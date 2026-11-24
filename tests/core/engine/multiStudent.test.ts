import { describe, expect, it } from 'vitest'
import { linkBookings } from '../../../src/core/engine/bookingLink'
import { plan } from '../../../src/core/engine/plan'
import type { LimitRule } from '../../../src/core/model/limits'
import type { BookingRequest, ExistingBooking } from '../../../src/core/model/planning'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, INSTRUCTOR } from '../../fixtures/syntheticWeek'

/**
 * Többnövendékes (multi student) FlightLogger-foglalások és megfigyelők (KBR-10): a foglalás
 * növendékenként egy igényé, a megfigyelő foglalt, de nem repül. Szintetikus adat.
 */

const TUE = DAYS[1]!

const multi = (id: string, extra: Partial<ExistingBooking> = {}): ExistingBooking =>
  existing(id, {
    type: 'multiStudent',
    start: at(TUE, '08:00'),
    end: at(TUE, '11:30'),
    flightStart: at(TUE, '08:30'),
    flightEnd: at(TUE, '11:00'),
    resourceId: 'p1',
    instructorId: INSTRUCTOR,
    participantIds: ['n1', 'n2'],
    lessons: [
      { studentId: 'n1', lectureId: 'L1', lectureName: 'I./7. Kör', flightMinutes: 60 },
      { studentId: 'n2', lectureId: 'L2', lectureName: 'I./8. Kör', flightMinutes: 90 },
    ],
    ...extra,
  })

const withLecture = (id: string, studentId: string, lectureId: string, extra: Partial<BookingRequest> = {}): BookingRequest =>
  flight(id, studentId, { lectureId, taskSelectionMode: 'manual', ...extra })

describe('többnövendékes foglalás párosítása (KBR-10, 9.6)', () => {
  it('a foglalás mindkét növendék igényéé, a saját feladatával és repülési szakaszával; a megfigyelőé nem', () => {
    const snapshot = baseSnapshot({ bookings: [multi('pair', { participantIds: ['n1', 'n2', 'n3'], observerIds: ['n3'] })] })
    const requests = [withLecture('r1', 'n1', 'L1'), withLecture('r2', 'n2', 'L2'), withLecture('r3', 'n3', 'L1')]
    const r = plan({ snapshot, settings: baseSettings(), requests, decisions: [] })
    const links = [...r.recordedInFlightLogger].sort((a, b) => a.requestId.localeCompare(b.requestId))
    expect(links.map((l) => [l.requestId, l.bookingId, l.slot.flightStart, l.slot.flightEnd])).toEqual([
      ['r1', 'pair', at(TUE, '08:30'), at(TUE, '09:30')],
      ['r2', 'pair', at(TUE, '09:30'), at(TUE, '11:00')],
    ])
    expect(links.every((l) => l.slot.start === at(TUE, '08:00') && l.slot.end === at(TUE, '11:30'))).toBe(true)
    // A lefoglalt igények nem kerülnek újra a tervbe; a megfigyelő igénye igen.
    expect(r.proposals.map((p) => p.requestId)).toEqual(['r3'])
  })

  it('a rögzített helyen a növendék foglalását találja meg, nem a csapattársakét (az oktató egyezése nem elég)', () => {
    // Közös briefinges csapat: két pár, azonos kezdéssel és géppel, egymás utáni repüléssel.
    const first = multi('first', { end: at(TUE, '13:50'), flightStart: at(TUE, '08:45'), flightEnd: at(TUE, '10:55'), lessons: [{ studentId: 'n1' }, { studentId: 'n2' }] })
    const second = multi('second', { end: at(TUE, '13:50'), flightStart: at(TUE, '11:10'), flightEnd: at(TUE, '13:20'), participantIds: ['n3', 'n4'], lessons: [{ studentId: 'n3' }, { studentId: 'n4' }] })
    const snapshot = baseSnapshot({ bookings: [first, second] })
    const slot = { start: at(TUE, '08:00'), end: at(TUE, '13:50'), flightStart: at(TUE, '11:10'), flightEnd: at(TUE, '12:10'), resourceId: 'p1' }
    const result = linkBookings({ snapshot, requests: [flight('r3', 'n3')], recorded: [{ requestId: 'r3', slot }] })
    expect(result.links.map((l) => [l.requestId, l.bookingId, l.how])).toEqual([['r3', 'second', 'slot']])
    expect(result.links[0]!.slot).toMatchObject({ flightStart: at(TUE, '11:10'), flightEnd: at(TUE, '12:15') })
  })

  it('az egyik növendék áthelyezése a foglalást nem szabadítja fel: a másik még ott repül', () => {
    const snapshot = baseSnapshot({ bookings: [multi('pair')] })
    const requests = [withLecture('r1', 'n1', 'L1'), withLecture('r2', 'n2', 'L2')]
    const one = linkBookings({ snapshot, requests, changes: [{ kind: 'move', requestId: 'r1', bookingId: 'pair' }] })
    expect(one.superseded).toEqual([])
    expect(one.plannedMoves).toEqual([{ requestId: 'r1', bookingId: 'pair', from: expect.objectContaining({ flightStart: at(TUE, '08:30'), flightEnd: at(TUE, '09:30') }) }])
    expect(one.links.map((l) => [l.requestId, l.bookingId])).toEqual([['r2', 'pair']])
    const both = linkBookings({
      snapshot,
      requests,
      changes: [
        { kind: 'move', requestId: 'r1', bookingId: 'pair' },
        { kind: 'move', requestId: 'r2', bookingId: 'pair' },
      ],
    })
    expect(both.superseded).toEqual(['pair'])
  })
})

describe('megfigyelő és növendéki limit a többnövendékes foglaláson (KBR-10)', () => {
  // Más oktató foglalása a másik gépen: az oktatónk szabad, csak a növendék számít.
  const others = (extra: Partial<ExistingBooking> = {}): ExistingBooking => multi('other', { instructorId: 'oktato-2', resourceId: 'p2', ...extra })

  it('a megfigyelő foglalt: ugyanarra az időre csak figyelmeztetéssel kerülhet', () => {
    const request = flight('f3', 'n3', { timing: { kind: 'fixed', start: at(TUE, '09:00') } })
    const busy = plan({ snapshot: baseSnapshot({ bookings: [others({ participantIds: ['n1', 'n2', 'n3'], observerIds: ['n3'] })] }), settings: baseSettings(), requests: [request], decisions: [] })
    expect(busy.proposals.find((p) => p.requestId === 'f3' && !p.dilemmaId)).toBeUndefined()
    expect(busy.dilemmas.map((d) => [d.type, d.requestIds])).toEqual([['warningSlot', ['f3']]])
    // Megfigyelő nélkül a hely tiszta.
    const free = plan({ snapshot: baseSnapshot({ bookings: [others()] }), settings: baseSettings(), requests: [request], decisions: [] })
    expect(free.dilemmas).toEqual([])
    expect(free.proposals.map((p) => [p.requestId, p.slot.start])).toEqual([['f3', at(TUE, '09:00')]])
  })

  it('a növendék repült idejébe csak a saját szakasza számít, nem a közös ablak', () => {
    const rule: LimitRule = {
      id: 'novendek-repult-nap',
      subject: 'student',
      metric: 'flightTime',
      window: { kind: 'calendarDay' },
      limit: 2.5,
      severity: 'warning',
      warnAtPercent: 100,
      includeSimulator: false,
      source: 'szintetikus',
      enabled: true,
    }
    const s = baseSettings()
    const settings = { ...s, limits: { ...s.limits, rules: [rule] } }
    // 08:30–10:30: két 60 perces feladat; n1-nek ebből 1 óra jut, nem 2.
    const booking = others({ flightEnd: at(TUE, '10:30'), lessons: [{ studentId: 'n1', flightMinutes: 60 }, { studentId: 'n2', flightMinutes: 60 }] })
    const request = flight('f1', 'n1', { timing: { kind: 'fixed', start: at(TUE, '12:00') } })
    const r = plan({ snapshot: baseSnapshot({ bookings: [booking] }), settings, requests: [request], decisions: [] })
    expect(r.dilemmas).toEqual([])
    const p = r.proposals.find((x) => x.requestId === 'f1')!
    expect(p.slot.start).toBe(at(TUE, '12:00'))
    expect(p.warnings.filter((w) => w.kind === 'limitExceeded')).toEqual([])
  })

  it('a megfigyelőnek a foglalás nem repült idő', () => {
    const rule: LimitRule = {
      id: 'novendek-repult-nap',
      subject: 'student',
      metric: 'flightTime',
      window: { kind: 'calendarDay' },
      limit: 1.5,
      severity: 'warning',
      warnAtPercent: 100,
      includeSimulator: false,
      source: 'szintetikus',
      enabled: true,
    }
    const s = baseSettings()
    const settings = { ...s, limits: { ...s.limits, rules: [rule] } }
    const booking = others({ participantIds: ['n1', 'n2', 'n3'], observerIds: ['n3'] })
    const request = flight('f3', 'n3', { timing: { kind: 'fixed', start: at(TUE, '12:00') } })
    const r = plan({ snapshot: baseSnapshot({ bookings: [booking] }), settings, requests: [request], decisions: [] })
    expect(r.dilemmas).toEqual([])
    expect(r.proposals.map((p) => [p.requestId, p.slot.start])).toEqual([['f3', at(TUE, '12:00')]])
  })
})
