import { describe, expect, it } from 'vitest'
import { bookingLessonOf, bookingStudentIds, flyingParticipantIds, isObserver, studentFlightSegment } from '../../../src/core/model/bookingStudents'
import type { ExistingBooking } from '../../../src/core/model/planning'
import { at, DAYS, existing } from '../../fixtures/syntheticWeek'

/** Többnövendékes foglalás: a növendékek egymás után repülnek a közös ablakban (KBR-10, szintetikus adat). */

const DAY = DAYS[1]!
const pair = (extra: Partial<ExistingBooking> = {}): ExistingBooking =>
  existing('pair', {
    type: 'multiStudent',
    start: at(DAY, '08:00'),
    end: at(DAY, '11:30'),
    flightStart: at(DAY, '08:30'),
    flightEnd: at(DAY, '11:00'),
    resourceId: 'p1',
    participantIds: ['n1', 'n2', 'n3'],
    observerIds: ['n3'],
    lessons: [
      { studentId: 'n1', lectureId: 'L1', lectureName: 'I./7. Kör', flightMinutes: 60 },
      { studentId: 'n2', lectureId: 'L2', lectureName: 'I./8. Kör', flightMinutes: 90 },
    ],
    ...extra,
  })
const ms = (iso: string): number => Date.parse(iso)

describe('a foglalás növendékei és megfigyelői', () => {
  it('a megfigyelő résztvevő, de nem repül és nincs feladata', () => {
    const b = pair()
    expect(isObserver(b, 'n3')).toBe(true)
    expect(flyingParticipantIds(b)).toEqual(['n1', 'n2'])
    expect(bookingStudentIds(b)).toEqual(['n1', 'n2'])
    expect(bookingLessonOf(b, 'n3')).toBeUndefined()
    expect(bookingLessonOf(b, 'n2')).toMatchObject({ lectureId: 'L2' })
    expect(studentFlightSegment(b, 'n3')).toBeUndefined()
  })

  it('a szakaszok a feladatok repült idejének arányában, a FlightLogger sorrendjében', () => {
    const b = pair()
    // 150 perces ablak, 60 : 90 arányban.
    expect(studentFlightSegment(b, 'n1')).toEqual({ start: ms(at(DAY, '08:30')), end: ms(at(DAY, '09:30')) })
    expect(studentFlightSegment(b, 'n2')).toEqual({ start: ms(at(DAY, '09:30')), end: ms(at(DAY, '11:00')) })
  })

  it('ismeretlen feladatidőnél egyenlő részekben', () => {
    const b = pair({ lessons: [{ studentId: 'n1' }, { studentId: 'n2', flightMinutes: 90 }] })
    expect(studentFlightSegment(b, 'n1')).toEqual({ start: ms(at(DAY, '08:30')), end: ms(at(DAY, '09:45')) })
    expect(studentFlightSegment(b, 'n2')).toEqual({ start: ms(at(DAY, '09:45')), end: ms(at(DAY, '11:00')) })
  })

  it('egynövendékes foglalásnál a teljes ablak; a régebbi adat feladata a növendéké', () => {
    const single = existing('s', { start: at(DAY, '08:00'), end: at(DAY, '10:00'), flightStart: at(DAY, '08:30'), flightEnd: at(DAY, '09:30'), participantIds: ['n1'], lectureId: 'L1', plannedLectureName: 'I./7. Kör' })
    expect(studentFlightSegment(single, 'n1')).toEqual({ start: ms(at(DAY, '08:30')), end: ms(at(DAY, '09:30')) })
    expect(bookingLessonOf(single, 'n1')).toEqual({ studentId: 'n1', lectureId: 'L1', lectureName: 'I./7. Kör' })
    expect(bookingLessonOf(single, 'n2')).toBeUndefined()
  })
})
