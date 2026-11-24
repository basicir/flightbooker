import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import type { Settings } from '../../../src/core/config/schema'
import { maintenanceLimits, projectMaintenance, type UsageInterval } from '../../../src/core/engine/maintenance'
import { plan } from '../../../src/core/engine/plan'
import type { Proposal } from '../../../src/core/model/planning'
import { toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight } from '../../fixtures/syntheticWeek'

/**
 * Túlrepülés, biztonsági puffer és várható karbantartás (SZB-06, ERF-04). A példa a
 * felhasználó leírása: a gépben 8 óra van, a következő 200 órás karbantartás előtt 10 óra
 * túlrepülhető, a puffer 2 óra, a karbantartás 24 óra. A foglalások szerint szerda 12:00-ig
 * 15, 14:00-ig 17, 16:00-ig 19 órát repül, így a karbantartás szerda 12:00-tól esedékes.
 */

const [MON, TUE, WED, THU] = DAYS as [string, string, string, string]
const HOUR = 3_600_000

function withMaintenance(s: Settings): Settings {
  return { ...s, maintenance: { ...s.maintenance, 200: { overflyHours: 10, durationHours: 24 } } }
}

const entry = { date: '2026-11-15', hoursUntilMaintenance: 8, maintenanceType: 200 as const, enteredAt: '2026-11-15T07:00:00.000Z' }

const flightIv = (ref: string, start: string, end: string): UsageInterval => ({ start: toMs(start), end: toMs(end), kind: 'flight', ref })

/** Hétfő 6, kedd 6, szerda 09–12 3 óra (15 óra 12:00-ig), majd 12–14 és 14–16. */
const WEEK: UsageInterval[] = [
  flightIv('mon', at(MON, '08:00'), at(MON, '14:00')),
  flightIv('tue', at(TUE, '08:00'), at(TUE, '14:00')),
  flightIv('wed1', at(WED, '09:00'), at(WED, '12:00')),
  flightIv('wed2', at(WED, '12:00'), at(WED, '14:00')),
  flightIv('wed3', at(WED, '14:00'), at(WED, '16:00')),
]

describe('keret: túlrepülés és puffer (SZB-06)', () => {
  it('a 200 órás karbantartás előtti túlrepüléssel 18 óra a keret, ebből 16 tervezhető', () => {
    const limits = maintenanceLimits(withMaintenance(createDefaultSettings()), entry, 2)
    expect(limits).toMatchObject({ type: 200, overflyHours: 10, limitHours: 18, usableHours: 16, durationHours: 24 })
  })

  it('ismeretlen karbantartás-fajtánál nincs túlrepülés, és a leghosszabb karbantartással számol', () => {
    const s = createDefaultSettings()
    const settings = { ...s, maintenance: { ...s.maintenance, 100: { overflyHours: 5, durationHours: 48 } } }
    const { maintenanceType: _t, ...untyped } = entry
    expect(maintenanceLimits(settings, untyped, 2)).toMatchObject({ type: undefined, overflyHours: 0, limitHours: 8, usableHours: 6, durationHours: 48 })
  })
})

describe('várható karbantartás (SZB-06)', () => {
  const limits = maintenanceLimits(withMaintenance(createDefaultSettings()), entry, 2)
  const now = toMs(at(DAYS[0]!, '00:00')) - 14 * HOUR

  it('a példa szerint szerda 12:00-tól csütörtök 12:00-ig tart, a délutáni repülések rá esnek', () => {
    const p = projectMaintenance(WEEK, limits, now)
    expect(p.window).toEqual({ start: toMs(at(WED, '12:00')), end: toMs(at(THU, '12:00')) })
    expect([...p.blocked].sort()).toEqual(['wed2', 'wed3'])
    expect(p.usedHours).toBe(15)
  })

  it('a karbantartás utáni repülést nem korlátozza (a számláló újraindul)', () => {
    const p = projectMaintenance([...WEEK, flightIv('thu', at(THU, '12:00'), at(THU, '15:00'))], limits, now)
    expect(p.blocked.has('thu')).toBe(false)
  })

  it('a még beleférő repülés nem mozdítja a karbantartást', () => {
    const p = projectMaintenance([...WEEK, flightIv('extra', at(MON, '14:30'), at(MON, '15:30'))], limits, now)
    expect(p.window?.start).toBe(toMs(at(WED, '12:00')))
    expect(p.blocked.has('extra')).toBe(false)
    expect(p.usedHours).toBe(16)
  })

  it('a keretet túllépő korábbi repülés előrébb hozza a karbantartást', () => {
    const p = projectMaintenance([...WEEK, flightIv('extra', at(MON, '14:30'), at(MON, '16:30'))], limits, now)
    expect(p.window?.start).toBe(toMs(at(WED, '09:00')))
    expect([...p.blocked].sort()).toEqual(['wed1', 'wed2', 'wed3'])
  })

  it('a FlightLoggerben rögzített karbantartás a keret elfogyása előtt lezárja a számlálást', () => {
    const scheduled: UsageInterval = { start: toMs(at(TUE, '14:00')), end: toMs(at(WED, '08:00')), kind: 'maintenance', ref: 'mx' }
    const p = projectMaintenance([...WEEK, scheduled], limits, now)
    expect(p.window).toBeUndefined()
    expect(p.blocked.size).toBe(0)
    expect(p.scheduledRef).toBe('mx')
  })

  it('ha a keret már egy múltbeli repülésnél elfogyott, a karbantartás mostantól számít', () => {
    const later = toMs(at(WED, '13:00'))
    const p = projectMaintenance(WEEK, limits, later)
    expect(p.window).toEqual({ start: later, end: later + 24 * HOUR })
  })

  it('ha a keret kitart, nincs várható karbantartás', () => {
    const p = projectMaintenance(WEEK.slice(0, 3), limits, now)
    expect(p.window).toBeUndefined()
    expect(p.usedHours).toBe(15)
  })
})

describe('a motor a várható karbantartásra nem foglal (SZB-06)', () => {
  const s = withMaintenance(baseSettings())
  const settings: Settings = {
    ...s,
    aircraftHours: {
      ...s.aircraftHours,
      p1: entry,
      // A másik Piper nem használható: nincs benne óra.
      p2: { ...s.aircraftHours['p2']!, hoursUntilMaintenance: 0 },
    },
  }
  const book = (id: string, day: string, from: string, to: string) => existing(id, { resourceId: 'p1', start: at(day, from), end: at(day, to), flightStart: at(day, from), flightEnd: at(day, to) })
  const snapshot = baseSnapshot({
    bookings: [book('b-mon', MON, '08:00', '14:00'), book('b-tue', TUE, '08:00', '14:00'), book('b-wed1', WED, '09:00', '12:00'), book('b-wed2', WED, '12:00', '14:00'), book('b-wed3', WED, '14:00', '16:00')],
  })
  const result = plan({ snapshot, settings, decisions: [], requests: [flight('f1', 'n1'), flight('f2', 'n2'), flight('f3', 'n3')] })
  const flightStart = (p: Proposal): number => toMs(p.slot.flightStart!)
  const flightHours = (p: Proposal): number => (toMs(p.slot.flightEnd!) - flightStart(p)) / HOUR

  it('mindhárom repülés elhelyeződik, a karbantartás idejére egy sem', () => {
    expect(result.proposals.map((p) => p.requestId).sort()).toEqual(['f1', 'f2', 'f3'])
    for (const p of result.proposals) {
      expect(p.slot.resourceId).toBe('p1')
      const start = flightStart(p)
      expect(start >= toMs(at(WED, '12:00')) && start < toMs(at(THU, '12:00')), `${p.requestId}: ${p.slot.flightStart}`).toBe(false)
    }
  })

  it('a karbantartás előtt csak annyit foglal, amennyi a meglévő foglalásokat nem szorítja ki', () => {
    const before = result.proposals.filter((p) => flightStart(p) < toMs(at(WED, '12:00')))
    expect(before.reduce((sum, p) => sum + flightHours(p), 0)).toBeLessThanOrEqual(1)
  })

  it('általános figyelmeztetésben jelzi a várható karbantartást és az érintett foglalásokat', () => {
    const w = result.warnings.find((x) => x.kind === 'maintenanceDue' && x.message.startsWith('HA-XPA'))
    expect(w?.message).toContain('11.18. 12:00')
    expect(w?.message).toContain('11.19. 12:00')
    expect(w?.message).toContain('200 órás')
    expect(w?.message).toContain('2 foglalás')
  })

  it('a karbantartásra eső fix időpontnál az erőltetés indoklása megmondja, miért nem lehet', () => {
    const fixed = plan({ snapshot, settings, decisions: [], requests: [flight('fx', 'n1', { timing: { kind: 'fixed', start: at(THU, '09:00') } })] })
    const dilemma = fixed.dilemmas.find((d) => d.type === 'noSlot')!
    expect(dilemma.blockers?.some((b) => b.code === 'reserve')).toBe(true)
    const force = dilemma.options.find((o) => o.id.endsWith(':force'))!
    expect(force.cons.join(' ')).toContain('a gép várható karbantartására esne (11.18. 12:00 – 11.19. 12:00)')
    expect(force.cons.join(' ')).toContain('keret: 8 óra (megadva: 11.15.) + 10 óra túlrepülés (200 órás karbantartás előtt), puffer: 2 óra')
  })
})
