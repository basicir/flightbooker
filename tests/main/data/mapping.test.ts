import { describe, expect, it } from 'vitest'
import { lastFlights, lecturesFromBookings, mapBooking, mapForecast } from '../../../src/main/data/mapping'
import type { Booking, Training } from '../../../src/main/net/flightLogger/types'

const base: Booking = {
  __typename: 'SingleStudentBooking',
  id: 'b1',
  startsAt: '2026-11-16T07:00:00Z',
  endsAt: '2026-11-16T09:00:00Z',
  status: 'OPEN',
  comment: '  ',
  color: '#4AADFF',
}

describe('FlightLogger → pillanatkép', () => {
  it('egynövendékes repülés: gép, oktató, növendék, időszerkezet', () => {
    const b = mapBooking({ ...base, flightStartsAt: '2026-11-16T07:30:00Z', flightEndsAt: '2026-11-16T08:30:00Z', aircraft: { id: 'a1', callSign: 'HA-XXA' }, instructor: { id: 'o1' }, student: { id: 'n1' } })
    expect(b).toEqual({
      id: 'b1',
      type: 'singleStudent',
      status: 'OPEN',
      start: '2026-11-16T07:00:00Z',
      end: '2026-11-16T09:00:00Z',
      flightStart: '2026-11-16T07:30:00Z',
      flightEnd: '2026-11-16T08:30:00Z',
      resourceId: 'a1',
      instructorId: 'o1',
      participantIds: ['n1'],
      lessons: [{ studentId: 'n1' }],
      color: '#4AADFF',
    })
  })

  it('többnövendékes repülés: a növendékek sorrendben a saját feladatukkal, a megfigyelő résztvevő, de feladat nélkül (KBR-10)', () => {
    const lecture = (id: string, name: string, vfrDualMinutes: number) => ({ id, name, vfrDualMinutes, vfrSoloMinutes: 0 })
    const b = mapBooking({
      ...base,
      __typename: 'MultiStudentBooking',
      flightStartsAt: '2026-11-16T07:30:00Z',
      flightEndsAt: '2026-11-16T09:30:00Z',
      aircraft: { id: 'a1', callSign: 'HA-XXA' },
      instructor: { id: 'o1' },
      students: [{ id: 'n1' }, { id: 'n2' }],
      observers: [{ id: 'n3' }, null],
      plannedLessons: [
        { id: 't2', student: { id: 'n2' }, lecture: lecture('lec-2', 'I./8. Szintetikus', 45) },
        { id: 't1', student: { id: 'n1' }, lecture: lecture('lec-1', 'I./7. Szintetikus', 60) },
      ],
    })
    expect(b).toMatchObject({
      type: 'multiStudent',
      participantIds: ['n1', 'n2', 'n3'],
      observerIds: ['n3'],
      lessons: [
        { studentId: 'n1', lectureId: 'lec-1', lectureName: 'I./7. Szintetikus', flightMinutes: 60 },
        { studentId: 'n2', lectureId: 'lec-2', lectureName: 'I./8. Szintetikus', flightMinutes: 45 },
      ],
    })
    expect(b.lectureId).toBeUndefined()
  })

  it('egynövendékes repülés megfigyelővel: a feladat csak a növendéké (KBR-10)', () => {
    const b = mapBooking({ ...base, student: { id: 'n1' }, observers: [{ id: 'n2' }], plannedLesson: { id: 'pl1', lecture: { id: 'lec-1', name: 'III./19. Szintetikus' } } })
    expect(b).toMatchObject({ participantIds: ['n1', 'n2'], observerIds: ['n2'], lessons: [{ studentId: 'n1', lectureId: 'lec-1', lectureName: 'III./19. Szintetikus' }] })
  })

  it('a többnövendékes foglalás feladatai a feladatkatalógusba is bekerülnek', () => {
    const lectures = lecturesFromBookings([
      { ...base, __typename: 'MultiStudentBooking', plannedLessons: [{ id: 't1', student: { id: 'n1' }, lecture: { id: 'lec-1', name: 'I./7. Szintetikus', vfrDualMinutes: 60 } }, null] },
    ])
    expect(lectures.map((l) => [l.id, l.flightMinutes])).toEqual([['lec-1', 60]])
  })

  it('a tervezett feladat neve és azonosítója a párosításhoz (9.6)', () => {
    const b = mapBooking({ ...base, plannedLesson: { id: 'pl1', lecture: { id: 'lec-1', name: 'III./19. Szintetikus' } } })
    expect(b).toMatchObject({ plannedLectureName: 'III./19. Szintetikus', lectureId: 'lec-1' })
  })

  it('elméletnél a terem, az oktató, a növendékek és az osztály (9.6)', () => {
    const b = mapBooking({ ...base, __typename: 'ExtraTheoryBooking', classroom: { id: 'r1' }, instructor: { id: 'o1' }, students: [{ id: 'n1' }], class: { id: 'c1' } })
    expect(b).toMatchObject({ type: 'theory', classroomId: 'r1', instructorId: 'o1', participantIds: ['n1'], classId: 'c1' })
  })

  it('a komment szövegét nem viszi tovább (B5)', () => {
    const b = mapBooking({ ...base, comment: 'STANDBY – szintetikus' })
    expect(JSON.stringify(b)).not.toContain('STANDBY')
    expect(b.maintenanceLevel).toBeUndefined()
  })

  it('karbantartásnál a kommentből csak a fajta marad (Q8)', () => {
    expect(mapBooking({ ...base, __typename: 'MaintenanceBooking', comment: '100 órás karbantartás' }).maintenanceLevel).toBe(100)
    expect(mapBooking({ ...base, __typename: 'MaintenanceBooking', comment: 'Javítás: fékbetét' }).maintenanceLevel).toBeUndefined()
    expect(mapBooking({ ...base, __typename: 'MaintenanceBooking', comment: '1500 h ellenőrzés' }).maintenanceLevel).toBeUndefined()
    expect(JSON.stringify(mapBooking({ ...base, __typename: 'MaintenanceBooking', comment: '50h' }))).not.toContain('50h')
  })

  it.each([
    ['MaintenanceBooking', 'maintenance'],
    ['OperationBooking', 'operation'],
    ['MeetingBooking', 'meeting'],
    ['ClassTheoryBooking', 'classTheory'],
    ['RentalBooking', 'rental'],
    ['ValamiUjBooking', 'other'],
  ])('%s → %s', (typename, type) => {
    expect(mapBooking({ ...base, __typename: typename }).type).toBe(type)
  })

  it('operációnál a PIC az oktató, a személyzet résztvevő; a megbeszélés résztvevői is', () => {
    expect(mapBooking({ ...base, __typename: 'OperationBooking', pic: { id: 'p1' }, crew: [{ id: 'c1' }, null] })).toMatchObject({ instructorId: 'p1', participantIds: ['c1', 'p1'] })
    expect(mapBooking({ ...base, __typename: 'MeetingBooking', participants: [{ id: 'o1' }, { id: 'o2' }], classroom: { id: 'r1' } })).toMatchObject({ participantIds: ['o1', 'o2'], classroomId: 'r1' })
  })

  it('az utolsó repülés a feladatok repüléseiből (NOV-08)', () => {
    const t = (sid: string, onBlock: string) => ({ student: { id: sid }, flights: [{ id: 'f', offBlock: onBlock, onBlock }] }) as unknown as Training
    expect(lastFlights([t('n1', '2026-11-01T10:00:00Z'), t('n1', '2026-11-05T10:00:00Z'), t('x', '2026-11-09T10:00:00Z')], ['n1', 'n2'])).toEqual({ n1: '2026-11-05T10:00:00Z', n2: null })
  })

  it('az Open-Meteo GMT-időit UTC-ként olvassa, a napkeltét helyi naphoz rendeli', () => {
    const mapped = mapForecast(
      {
        latitude: 1,
        longitude: 2,
        hourly: { time: ['2026-11-16T07:00'], wind_speed_10m: [12], visibility: [null] },
        daily: { time: ['2026-11-16'], sunrise: ['2026-11-16T05:50'], sunset: ['2026-11-16T15:10'] },
      },
      'Europe/Budapest',
    )
    expect(mapped.hours[0]).toMatchObject({ time: '2026-11-16T07:00:00.000Z', windSpeedKt: 12, visibilityM: null, temperatureC: null })
    expect(mapped.daylight).toEqual({ '2026-11-16': { sunrise: '2026-11-16T05:50:00.000Z', sunset: '2026-11-16T15:10:00.000Z' } })
    // Felhőprofil nélkül nincs plafon: a becslés marad.
    expect(mapped.hours[0]!.ceilingFt).toBeNull()
  })

  it('a plafont a nyomási szintek felhőzetéből és a terepmagasság fölötti magasságból számolja', () => {
    const mapped = mapForecast(
      {
        latitude: 1,
        longitude: 2,
        elevation: 100,
        hourly: {
          time: ['2026-11-19T11:00', '2026-11-19T12:00'],
          // 1000 hPa a terep alatt (kimarad), 925 hPa-n összefüggő réteg.
          geopotential_height_1000hPa: [80, 80],
          cloud_cover_1000hPa: [100, 100],
          geopotential_height_975hPa: [300, 300],
          cloud_cover_975hPa: [10, 10],
          geopotential_height_925hPa: [700, 700],
          cloud_cover_925hPa: [100, 20],
          geopotential_height_850hPa: [1400, 1400],
          cloud_cover_850hPa: [0, 0],
        },
      },
      'Europe/Budapest',
    )
    // 200 m és 600 m AGL között 10% → 100%: az 50% 200 + 40/90·400 m-nél van.
    expect(mapped.hours[0]!.ceilingFt).toBe(Math.round((200 + (40 / 90) * 400) * 3.28084))
    expect(mapped.hours[1]!.ceilingFt).toBe(10_000)
  })
})
