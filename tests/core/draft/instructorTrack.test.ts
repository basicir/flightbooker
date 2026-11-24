import { describe, expect, it } from 'vitest'
import { instructorOwnBookings, isInstructorBooking } from '../../../src/core/draft/instructorTrack'
import { at, DAYS, existing, INSTRUCTOR } from '../../fixtures/syntheticWeek'

/** Az oktatói sáv FlightLogger-foglalásai (U2, szintetikus adat). */

const DAY = DAYS[2]!
const none = new Set<string>()

describe('az oktatói sáv saját FlightLogger-foglalásai', () => {
  const flight = existing('fl-gep', { start: at(DAY, '10:00'), end: at(DAY, '12:00'), flightStart: at(DAY, '10:30'), flightEnd: at(DAY, '11:30'), resourceId: 'p1', instructorId: INSTRUCTOR, participantIds: ['n1'] })
  const theory = existing('fl-terem', { type: 'theory', start: at(DAY, '08:00'), end: at(DAY, '09:00'), classroomId: 't1', instructorId: INSTRUCTOR, participantIds: ['n2'] })
  const meeting = existing('fl-megbeszeles', { type: 'meeting', start: at(DAY, '13:00'), end: at(DAY, '14:00'), participantIds: ['masik', INSTRUCTOR] })
  const other = existing('fl-masik', { start: at(DAY, '10:00'), end: at(DAY, '12:00'), resourceId: 'p2', instructorId: 'masik', participantIds: ['n3'] })
  const cancelled = existing('fl-lemondott', { status: 'CANCELLED', start: at(DAY, '15:00'), end: at(DAY, '16:00'), resourceId: 'p1', instructorId: INSTRUCTOR, participantIds: ['n1'] })
  const all = [flight, theory, meeting, other, cancelled]

  it('a géppel és teremmel, a FlightLoggeren foglalt saját óra is látszik, kezdés szerint', () => {
    expect(instructorOwnBookings(all, INSTRUCTOR, none, none).map((b) => b.id)).toEqual(['fl-terem', 'fl-gep', 'fl-megbeszeles'])
  })

  it('más oktató foglalása és a lemondott foglalás kimarad', () => {
    expect(isInstructorBooking(other, INSTRUCTOR)).toBe(false)
    expect(isInstructorBooking(meeting, INSTRUCTOR)).toBe(true)
    expect(instructorOwnBookings(all, INSTRUCTOR, none, none).map((b) => b.id)).not.toContain('fl-lemondott')
  })

  it('a terv igényéhez kötött és az áthelyezettnek jelölt foglalás nem kétszer látszik', () => {
    const ids = instructorOwnBookings(all, INSTRUCTOR, new Set(['fl-gep']), new Set(['fl-terem'])).map((b) => b.id)
    expect(ids).toEqual(['fl-megbeszeles'])
  })
})
