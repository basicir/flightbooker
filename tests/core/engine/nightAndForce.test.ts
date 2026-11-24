import { describe, expect, it } from 'vitest'
import { createSlotExplorer } from '../../../src/core/engine/explore'
import { plan, type PlanInput } from '../../../src/core/engine/plan'
import { civilTwilight } from '../../../src/core/time/solar'
import { localParts, toMs } from '../../../src/core/time/zoned'
import { at, baseSettings, baseSnapshot, DAYS, flight, theory, TZ } from '../../fixtures/syntheticWeek'

const run = (partial: Partial<PlanInput> & Pick<PlanInput, 'requests'>) =>
  plan({ snapshot: baseSnapshot(), settings: baseSettings(), decisions: [], ...partial })

/** Esti munkaidő, hogy az éjszakai repülés beférjen (a nyitvatartás 19:00-ig tart). */
function eveningSettings() {
  const s = baseSettings()
  const day = { start: '08:00', end: '19:00' }
  return { ...s, instructor: { ...s.instructor, workWindows: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: null, sun: null } } }
}

describe('éjszakai repülés: a polgári szürkület után', () => {
  it('a repülés a szürkület vége után kezdődik, a briefing előtte is lehet', () => {
    const settings = eveningSettings()
    const result = run({ settings, requests: [flight('ej', 'n1', { daylightOnly: false })] })
    const p = result.proposals.find((x) => x.requestId === 'ej')!
    expect(p).toBeDefined()
    const date = localParts(toMs(p.slot.flightStart!), TZ).date
    const dusk = civilTwilight(date, settings.airport!.latitude, settings.airport!.longitude).dusk!
    expect(toMs(p.slot.flightStart!)).toBeGreaterThanOrEqual(dusk)
    // A szürkület végéhez igazodik (5 percre kerekítve), nem a félórás rácshoz.
    expect(toMs(p.slot.flightStart!) - dusk).toBeLessThan(5 * 60_000)
    expect(toMs(p.slot.start)).toBeLessThan(dusk)
  })

  it('ha a munkaidő a szürkület előtt véget ér, nem helyezi el, és az okot megnevezi', () => {
    const result = run({ requests: [flight('ej', 'n1', { daylightOnly: false })] })
    expect(result.proposals.some((p) => p.requestId === 'ej')).toBe(false)
    const dilemma = result.dilemmas.find((d) => d.type === 'noSlot')!
    expect(dilemma.summary).toContain('polgári szürkület')
  })

  it('a nappali feladatot továbbra is napnyugta előtt tervezi', () => {
    const result = run({ settings: eveningSettings(), requests: [flight('nap', 'n1')] })
    const p = result.proposals[0]!
    const date = localParts(toMs(p.slot.flightStart!), TZ).date
    expect(toMs(p.slot.flightEnd!)).toBeLessThanOrEqual(toMs(baseSnapshot().daylight[date]!.sunset))
  })
})

describe('„nincs hely” dilemma: kényszerítés és kézi időpont (9.2)', () => {
  const noHours = () => {
    const s = baseSettings()
    return { ...s, aircraftHours: Object.fromEntries(Object.entries(s.aircraftHours).map(([id, e]) => [id, { ...e, hoursUntilMaintenance: 0 }])) }
  }

  it('a legközelebbi helyre erőltetett foglalást kínál, amely a döntés után a tervbe kerül', () => {
    const settings = noHours()
    const first = run({ settings, requests: [flight('f1', 'n1')] })
    const dilemma = first.dilemmas.find((d) => d.type === 'noSlot')!
    const force = dilemma.options.find((o) => o.id.endsWith(':force'))!
    expect(force).toBeDefined()
    expect(force.cons.join(' ')).toContain('túllépné a karbantartási határt')
    expect(dilemma.recommendedOptionId).not.toBe(force.id)
    expect(first.unplaced[0]!.suggestion).toBeDefined()

    const second = run({ settings, requests: [flight('f1', 'n1')], decisions: [force.decision] })
    const p = second.proposals.find((x) => x.requestId === 'f1')!
    expect(p.decidedBy).toBe('instructor')
    expect(p.warnings.some((w) => w.kind === 'hardConstraintOverridden')).toBe(true)
    expect(second.dilemmas).toEqual([])
    expect(second.decisionIssues).toEqual([])
  })

  it('a dilemma strukturáltan is megadja az akadályokat és egy rövid összefoglalót', () => {
    const result = run({ settings: noHours(), requests: [flight('f1', 'n1')] })
    const dilemma = result.dilemmas.find((d) => d.type === 'noSlot')!
    expect(dilemma.blockers?.[0]?.code).toBe('reserve')
    expect(dilemma.blockers?.[0]?.count).toBeGreaterThan(0)
    expect(dilemma.headline).toContain('nem helyezhető el')
    expect(dilemma.headline!.length).toBeLessThan(dilemma.summary.length)
  })

  describe('fix időpontú igény, kevés gépórával (SZB-06)', () => {
    const withHours = (hours: number) => {
      const s = baseSettings()
      return { ...s, aircraftHours: Object.fromEntries(Object.entries(s.aircraftHours).map(([id, e]) => [id, { ...e, hoursUntilMaintenance: hours }])) }
    }
    const fixed = () => flight('fx', 'n1', { timing: { kind: 'fixed', start: at(DAYS[1]!, '10:00') } })

    it('a fix időpontra is felkínálja az erőltetést, és kiírja, mennyi óra maradna a gépben', () => {
      const settings = withHours(1.5)
      const first = run({ settings, requests: [fixed()] })
      const dilemma = first.dilemmas.find((d) => d.type === 'noSlot')!
      const force = dilemma.options.find((o) => o.id.endsWith(':force'))!
      expect(force).toBeDefined()
      expect(force.decision).toMatchObject({ kind: 'assign', requestId: 'fx', acceptWarnings: true })
      // A fix kezdés a foglalás (briefing) kezdete (Q1); a gép napi első repülésénél a
      // 30 perces briefing és a 20 perces motorpróba után indul a repülés (H11).
      expect(force.decision.kind === 'assign' && force.decision.slot.start).toBe(at(DAYS[1]!, '10:00'))
      expect(force.decision.kind === 'assign' && force.decision.slot.flightStart).toBe(at(DAYS[1]!, '10:50'))
      // 1,5 óra keret − 1 óra repülés = 0,5 óra; a biztonsági puffer 2 óra.
      expect(dilemma.headline).toContain('0,5 óra maradna a karbantartásig, a biztonsági puffer 2 óra')
      expect(dilemma.headline).toContain('keret: 1,5 óra (megadva: 11.15.; a karbantartás fajtája nincs megadva, túlrepülés nélkül), puffer: 2 óra, előtte foglalt és tervezett: 0 óra, ez a repülés: 1 óra')
      expect(force.cons.join(' ')).toContain('0,5 óra maradna')

      const second = run({ settings, requests: [fixed()], decisions: [force.decision] })
      const p = second.proposals.find((x) => x.requestId === 'fx')!
      expect(p.slot.start).toBe(at(DAYS[1]!, '10:00'))
      expect(p.slot.flightStart).toBe(at(DAYS[1]!, '10:50'))
      expect(p.warnings.find((w) => w.kind === 'hardConstraintOverridden')?.message).toContain('0,5 óra maradna')
      expect(second.dilemmas).toEqual([])
    })

    it('ha a repülés túllépné a karbantartási határt, azt külön kimondja', () => {
      const dilemma = run({ settings: withHours(0.4), requests: [fixed()] }).dilemmas.find((d) => d.type === 'noSlot')!
      expect(dilemma.headline).toContain('a gép 0,6 órával túllépné a karbantartási határt')
      expect(dilemma.options.some((o) => o.id.endsWith(':force'))).toBe(true)
    })
  })
})

describe('időpont-felderítő a dilemmákhoz (9.2)', () => {
  const settings = baseSettings()
  const requests = [flight('f1', 'n1'), flight('f2', 'n2')]

  it('a térkép minden helyet minősít, és a többi javaslatot foglaltnak veszi', () => {
    const result = plan({ snapshot: baseSnapshot(), settings, requests, decisions: [] })
    const other = result.proposals.find((p) => p.requestId === 'f2')!
    const explorer = createSlotExplorer({ snapshot: baseSnapshot(), settings, requests, proposals: result.proposals }, 'f1')!
    expect(explorer.places).toEqual(['p1', 'p2'])
    const grid = explorer.grid({ fromMinutes: 6 * 60, toMinutes: 22 * 60, stepMinutes: 30 })
    expect(grid.candidates.length).toBe(grid.days.length * 32 * 2)
    // Hétfő 06:00 a munkaidőn kívül: csak felülbírálással.
    const early = grid.candidates.find((c) => c.date === DAYS[0] && c.minutes === 6 * 60 && c.placeId === 'p1')!
    expect(early.status).toBe('blocked')
    expect(early.hardCodes).toContain('window')
    // f2 helyén az oktató foglalt.
    const clash = explorer.at(localParts(toMs(other.slot.flightStart!), TZ).date, localParts(toMs(other.slot.flightStart!), TZ).minutes, other.slot.resourceId!)
    expect(clash.hardCodes).toContain('instructorBusy')
    expect(grid.best[0]!.status).toBe('free')
  })

  it('a kiválasztott hely döntésként a tervbe kerül, a briefinggel együtt', () => {
    const result = plan({ snapshot: baseSnapshot(), settings, requests: [flight('f1', 'n1')], decisions: [] })
    const explorer = createSlotExplorer({ snapshot: baseSnapshot(), settings, requests: [flight('f1', 'n1')], proposals: result.proposals }, 'f1')!
    const c = explorer.at(DAYS[2]!, 10 * 60, 'p1')
    expect(c.slot.flightStart).toBe(at(DAYS[2]!, '10:00'))
    expect(toMs(c.slot.start)).toBeLessThan(toMs(c.slot.flightStart!))
    const after = plan({ snapshot: baseSnapshot(), settings, requests: [flight('f1', 'n1')], decisions: [{ kind: 'assign', requestId: 'f1', slot: c.slot, acceptWarnings: c.status !== 'free' }] })
    expect(after.proposals[0]!.slot).toEqual(c.slot)
    expect(after.proposals[0]!.decidedBy).toBe('instructor')
  })

  it('elméletnél termeket kínál', () => {
    const t = theory('t1', ['n1'])
    const explorer = createSlotExplorer({ snapshot: baseSnapshot(), settings, requests: [t], proposals: [] }, 't1')!
    expect(explorer.places.length).toBeGreaterThan(0)
    const c = explorer.at(DAYS[1]!, 14 * 60, explorer.places[0]!)
    expect(c.slot).toEqual({ start: at(DAYS[1]!, '14:00'), end: at(DAYS[1]!, '15:30'), classroomId: explorer.places[0] })
  })

  it('éjszakai feladatnál a szürkület után a polgári szürkület miatt nem akad meg, előtte igen', () => {
    const night = flight('ej', 'n1', { daylightOnly: false })
    const explorer = createSlotExplorer({ snapshot: baseSnapshot(), settings, requests: [night], proposals: [] }, 'ej')!
    expect(explorer.at(DAYS[0]!, 12 * 60, 'p1').hardCodes).toContain('night')
    expect(explorer.at(DAYS[0]!, 18 * 60, 'p1').hardCodes).not.toContain('night')
  })
})

describe('kényszerítés éjszakai feladatnál (9.2)', () => {
  it('a szürkület utáni, munkaidőn kívüli helyet ajánlja, nem a nappalit', () => {
    const result = run({ requests: [flight('ej', 'n1', { daylightOnly: false })] })
    const force = result.dilemmas.find((d) => d.type === 'noSlot')!.options.find((o) => o.id.endsWith(':force'))!
    expect(force.cons.join(' ')).toContain('munkaidő-ablakon kívül')
    expect(force.cons.join(' ')).not.toContain('szürkület')
    const slot = force.decision.kind === 'assign' ? force.decision.slot : undefined
    const date = localParts(toMs(slot!.flightStart!), TZ).date
    const s = baseSettings()
    expect(toMs(slot!.flightStart!)).toBeGreaterThanOrEqual(civilTwilight(date, s.airport!.latitude, s.airport!.longitude).dusk!)
  })
})
