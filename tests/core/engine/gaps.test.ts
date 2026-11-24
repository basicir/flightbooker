import { describe, expect, it } from 'vitest'
import { plan } from '../../../src/core/engine/plan'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, TZ } from '../../fixtures/syntheticWeek'

const MON = DAYS[0]!

/** Csak hétfőn dolgozik az oktató, és a növendék csak a p1 géppel repülhet. */
function mondayOnly() {
  const s = baseSettings()
  return {
    ...s,
    instructor: { ...s.instructor, workWindows: { mon: { start: '08:00', end: '16:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } },
    students: [{ userId: 'n1', allowedResources: [{ aircraftId: 'p1' }] }],
  }
}

const hhmm = (iso: string): string => {
  const m = localParts(toMs(iso), TZ).minutes
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

describe('a gép csak a repülés idejére foglalt', () => {
  it('a briefinggel együtt hosszabb foglalás befér egy rövidebb géplyukba', () => {
    // A p1 gép 09:50-ig repül (+15 perc fordulóidő), 11:20-tól újra repül: a lyuk 75 perc.
    // A 60 perces repülés + 15 perc fordulóidő pont befér; a 45 perces briefing és a
    // 30 perces debriefing alatt a gép mással repülhet.
    const bookings = [
      existing('x1', { start: at(MON, '06:00'), end: at(MON, '10:20'), flightStart: at(MON, '07:00'), flightEnd: at(MON, '09:50'), resourceId: 'p1', instructorId: 'masik', participantIds: ['nx'] }),
      existing('x2', { start: at(MON, '10:30'), end: at(MON, '13:00'), flightStart: at(MON, '11:20'), flightEnd: at(MON, '12:20'), resourceId: 'p1', instructorId: 'masik', participantIds: ['ny'] }),
      // A gép délután sem szabad, így csak a lyuk marad.
      existing('x3', { start: at(MON, '12:30'), end: at(MON, '17:00'), flightStart: at(MON, '12:35'), flightEnd: at(MON, '16:30'), resourceId: 'p1', instructorId: 'masik', participantIds: ['nz'] }),
    ]
    const result = plan({
      snapshot: baseSnapshot({ bookings }),
      settings: mondayOnly(),
      requests: [flight('f1', 'n1', { durations: { briefing: 45, main: 60, debriefing: 30 } })],
      decisions: [],
    })
    expect(result.unplaced).toEqual([])
    const p = result.proposals.find((x) => x.requestId === 'f1')!
    expect(p.slot.resourceId).toBe('p1')
    expect(hhmm(p.slot.flightStart!)).toBe('10:05')
    expect(hhmm(p.slot.flightEnd!)).toBe('11:05')
    expect(hhmm(p.slot.start)).toBe('09:20')
    expect(hhmm(p.slot.end)).toBe('11:35')
  })
})

describe('indoklás, ha nincs hely (TRV-16)', () => {
  it('megmondja, ha a növendékhez nincs engedélyezett gép', () => {
    const s = { ...mondayOnly(), students: [{ userId: 'n1', allowedResources: [] }] }
    const result = plan({ snapshot: baseSnapshot(), settings: s, requests: [flight('f1', 'n1')], decisions: [] })
    expect(result.unplaced[0]?.reason).toMatch(/nincs engedélyezett aktív repülőgép/)
  })

  it('felsorolja az akadályokat és a legközelebbi helyet', () => {
    // Karbantartás egész nap: kizáró (a más foglalással való ütközés csak figyelmeztetés, SZB-04).
    const bookings = [existing('x1', { type: 'maintenance', start: at(MON, '07:00'), end: at(MON, '12:00'), flightStart: at(MON, '07:00'), flightEnd: at(MON, '12:00'), resourceId: 'p1', participantIds: [] }), existing('x2', { type: 'maintenance', start: at(MON, '12:00'), end: at(MON, '17:00'), flightStart: at(MON, '12:00'), flightEnd: at(MON, '17:00'), resourceId: 'p1', participantIds: [] })]
    const result = plan({ snapshot: baseSnapshot({ bookings }), settings: mondayOnly(), requests: [flight('f1', 'n1')], decisions: [] })
    const reason = result.unplaced.find((u) => u.requestId === 'f1')?.reason ?? ''
    expect(reason).toMatch(/lehetséges időpontot vizsgált meg/)
    expect(reason).toMatch(/a gép foglalt/)
    expect(reason).toMatch(/Legközelebb ez állt: .*HA-XPA/)
    const dilemma = result.dilemmas.find((d) => d.type === 'noSlot')
    expect(dilemma?.summary).toMatch(/a gép foglalt/)
  })

  it('megmondja, ha a heti időablakba nem fér bele a foglalás', () => {
    const s = { ...mondayOnly(), instructor: { ...mondayOnly().instructor, workWindows: { mon: { start: '08:00', end: '09:00' }, tue: null, wed: null, thu: null, fri: null, sat: null, sun: null } } }
    const result = plan({ snapshot: baseSnapshot(), settings: s, requests: [flight('f1', 'n1')], decisions: [] })
    expect(result.unplaced[0]?.reason).toMatch(/egyik napon sem fér be/)
  })
})
