import { describe, expect, it } from 'vitest'
import { effectiveResource } from '../../../src/core/config/operations'
import { maintenanceLimits, projectMaintenance, type UsageInterval } from '../../../src/core/engine/maintenance'
import type { Settings } from '../../../src/core/config/schema'
import { autoResolveDecisions, AUTO_RESOLVABLE } from '../../../src/core/engine/autoResolve'
import { plan } from '../../../src/core/engine/plan'
import type { BookingRequest, ExistingBooking, PlanResult } from '../../../src/core/model/planning'
import type { Snapshot } from '../../../src/core/model/snapshot'
import { localTimeToMinutes, WEEKDAYS } from '../../../src/core/model/time'
import { localParts, localToMs, toMs } from '../../../src/core/time/zoned'
import { assessHour, hourValues } from '../../../src/core/weather/rating'
import { at, baseSettings, baseSnapshot, DAYS, existing, flight, rng, theory, TZ, weekWeather } from '../../fixtures/syntheticWeek'

/**
 * Tulajdonságteszt (M3): véletlen, de rögzített magú heteken a motor egyetlen saját
 * javaslata sem sérthet kizáró feltételt (7.2). Az ellenőrzés független a motor
 * kiértékelő kódjától: közvetlenül a bemenetből számol.
 */

interface World {
  readonly snapshot: Snapshot
  readonly settings: Settings
  readonly requests: BookingRequest[]
}

function randomWorld(seed: number): World {
  const r = rng(seed)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const s = baseSettings()

  // Rossz idős időszakok
  const badDays = new Set(DAYS.filter(() => r() < 0.3))
  const weather = weekWeather((date, hour) => badDays.has(date) && hour >= 6 + Math.floor(r() * 4) && hour < 18)

  // Meglévő foglalások: más oktatók, saját foglalás, karbantartás, hosszú kiesés
  const bookings: ExistingBooking[] = []
  for (let i = 0; i < 12; i++) {
    const d = pick(DAYS.slice(0, 5))
    const h = 7 + Math.floor(r() * 8)
    const res = pick(['p1', 'p2', 'c1'])
    const kind = r()
    const start = at(d, `${String(h).padStart(2, '0')}:00`)
    const end = at(d, `${String(h + 2).padStart(2, '0')}:00`)
    if (kind < 0.5) bookings.push(existing(`x${i}`, { resourceId: res, instructorId: 'masik', start, end, flightStart: start, flightEnd: end, participantIds: [pick(['n1', 'n2', 'n3', 'zz'])] }))
    else if (kind < 0.7) bookings.push(existing(`x${i}`, { type: 'meeting', instructorId: 'oktato-1', participantIds: ['oktato-1'], start, end }))
    else if (kind < 0.85) bookings.push(existing(`x${i}`, { type: 'maintenance', resourceId: res, start: at(d, '00:00'), end: at(d, '23:00'), ...(r() < 0.5 ? { maintenanceLevel: 50 as const } : {}) }))
    else bookings.push(existing(`x${i}`, { type: 'operation', resourceId: res, start: at(DAYS[0]!, '06:00'), end: at(DAYS[4]!, '20:00') }))
  }

  // Beállítások: kevés gépóra, tiltott időszakok, szigorú napi limit, ráérések
  const settings: Settings = {
    ...s,
    aircraftHours: Object.fromEntries(Object.entries(s.aircraftHours).map(([id, e]) => [id, { ...e, hoursUntilMaintenance: 1 + Math.floor(r() * 10) }])),
    instructor: {
      ...s.instructor,
      blockedPeriods: r() < 0.5 ? [{ id: 'b', kind: 'weekly', weekday: pick(WEEKDAYS.slice(0, 5)), start: '12:00', end: '13:30' }] : [],
    },
    limits: { ...s.limits, rules: s.limits.rules.map((rule) => (rule.id === 'oktato-repult-nap' ? { ...rule, limit: 2 + Math.floor(r() * 4) } : rule)) },
    students: s.students.map((st) => ({ ...st, allowedResources: r() < 0.3 ? [{ aircraftType: 'PIPER P28A' }, { aircraftType: 'CESSNA 152' }] : [{ aircraftType: 'PIPER P28A' }], priority: 1 + Math.floor(r() * 5), ...(r() < 0.3 ? { weatherLimits: { maxCrosswindKt: 8 } } : {}) })),
  }
  const availabilities: Snapshot['availabilities'] = r() < 0.5 ? { n2: [{ start: at(DAYS[1]!, '08:00'), end: at(DAYS[1]!, '12:00'), unavailable: true }] } : {}

  const requests: BookingRequest[] = []
  const flights = 6 + Math.floor(r() * 10)
  for (let i = 0; i < flights; i++) requests.push(flight(`f${i}`, pick(['n1', 'n2', 'n3', 'n4', 'n5']), { daylightOnly: r() < 0.7 }))
  if (r() < 0.6) requests.push({ ...flight('sim', pick(['n1', 'n2'])), kind: 'simulator', daylightOnly: false })
  if (r() < 0.6) requests.push(theory('th', ['n1', 'n2', 'n3']))

  return { snapshot: baseSnapshot({ bookings, weather, availabilities }), settings, requests }
}

/**
 * Tágabb világ (Tesztelés, 1. pont): sok szabad gép, preferált gépek, elmélet és repülés
 * vegyesen, más oktatók foglalásai. Ebben jött elő a motorpróba miatti oktatói átfedés (H01).
 */
function wideWorld(seed: number): World {
  const r = rng(seed * 7919)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
  const s = baseSettings()
  const settings: Settings = {
    ...s,
    aircraftHours: Object.fromEntries(Object.entries(s.aircraftHours).map(([id, e]) => [id, { ...e, hoursUntilMaintenance: 6 + Math.floor(r() * 30) }])),
    students: s.students.map((st) => ({
      ...st,
      allowedResources: [{ aircraftType: 'PIPER P28A' }, { aircraftType: 'CESSNA 152' }],
      ...(r() < 0.5 ? { preferredResources: [{ aircraftId: pick(['p1', 'p2', 'c1']) }] } : {}),
      priority: 1 + Math.floor(r() * 5),
    })),
  }
  const bookings: ExistingBooking[] = []
  for (let i = 0; i < 6; i++) {
    const d = pick(DAYS.slice(0, 5))
    const h = 8 + Math.floor(r() * 6)
    const start = at(d, `${String(h).padStart(2, '0')}:00`)
    const end = at(d, `${String(h + 1).padStart(2, '0')}:30`)
    bookings.push(existing(`x${i}`, { resourceId: pick(['p1', 'p2', 'c1']), instructorId: 'masik', start, end, flightStart: start, flightEnd: end, participantIds: ['zz'] }))
  }
  const requests: BookingRequest[] = []
  const n = 8 + Math.floor(r() * 8)
  for (let i = 0; i < n; i++) requests.push(flight(`f${String(i).padStart(2, '0')}`, pick(['n1', 'n2', 'n3', 'n4', 'n5']), { durations: { briefing: 30, main: pick([45, 60, 90]), debriefing: 15 } }))
  if (r() < 0.5) requests.push(theory('th', ['n1', 'n2']))
  return { snapshot: baseSnapshot({ bookings }), settings, requests }
}

/** A gép napi első repülésénél a briefing előtt ott a motorpróba ideje (SZB-05), a többinél nincs. */
function runUpProblems(world: World, result: PlanResult): string[] {
  const problems: string[] = []
  const byId = new Map(world.requests.map((q) => [q.id, q]))
  const flights = result.proposals.filter((p) => !p.standby && p.slot.resourceId && p.slot.flightStart && byId.get(p.requestId)?.kind === 'flight')
  for (const p of flights) {
    const req = byId.get(p.requestId)!
    const fs = toMs(p.slot.flightStart!)
    const date = localParts(fs, TZ).date
    const earlier =
      world.snapshot.bookings.some((b) => b.resourceId === p.slot.resourceId && b.flightStart && toMs(b.flightStart) < fs && localParts(toMs(b.flightStart), TZ).date === date) ||
      flights.some((o) => o !== p && o.slot.resourceId === p.slot.resourceId && toMs(o.slot.flightStart!) < fs && localParts(toMs(o.slot.flightStart!), TZ).date === date)
    const lead = (fs - toMs(p.slot.start)) / 60_000
    const runUp = effectiveResource(world.settings, p.slot.resourceId!).engineRunUpMinutes
    if (!earlier && lead !== req.durations.briefing + runUp) problems.push(`${p.requestId}: a napi első repülésnél ${lead} perc a repülés előtt, ${req.durations.briefing + runUp} kellene`)
    if (earlier && lead !== req.durations.briefing) problems.push(`${p.requestId}: nem első repülés, mégis ${lead} perc a repülés előtt`)
  }
  return problems
}

/** Minden igény pontosan egy helyen szerepel: egy javaslat, vagy foglalatlan, vagy halasztott (H17). */
function exactlyOnce(world: World, result: PlanResult): string[] {
  const problems: string[] = []
  for (const q of world.requests) {
    const places = result.proposals.filter((p) => p.requestId === q.id && !p.standby).length
    const deferred = result.deferred.includes(q.id) ? 1 : 0
    const unplaced = result.unplaced.some((u) => u.requestId === q.id) ? 1 : 0
    if (places > 1) problems.push(`${q.id}: ${places} javaslat`)
    if (places + deferred > 1) problems.push(`${q.id}: elhelyezve és halasztva is`)
    if (places + deferred + unplaced === 0) problems.push(`${q.id}: sehol nem szerepel`)
  }
  return problems
}

function violations(world: World, result: PlanResult): string[] {
  const { snapshot, settings, requests } = world
  const problems: string[] = []
  const byId = new Map(requests.map((q) => [q.id, q]))
  const nowMs = toMs(snapshot.generatedAt)
  const today = localParts(nowMs, TZ).date
  const engineProposals = result.proposals.filter((p) => p.decidedBy === 'engine' && !p.standby)
  const all = result.proposals.filter((p) => !p.standby)

  for (const p of engineProposals) {
    const req = byId.get(p.requestId)!
    const start = toMs(p.slot.start)
    const end = toMs(p.slot.end)
    const fs = toMs(p.slot.flightStart ?? p.slot.start)
    const fe = toMs(p.slot.flightEnd ?? p.slot.end)
    const local = localParts(start, TZ)
    const where = `${p.requestId} @ ${p.slot.start}`

    if (start < nowMs) problems.push(`${where}: múltbeli időpont`)

    // Operációs idő ∩ munkaidő
    const wd = WEEKDAYS[DAYS.indexOf(local.date)]!
    const work = settings.instructor.workWindows[wd]
    const open = settings.airport!.openingHours[wd]
    if (!work || !open) problems.push(`${where}: zárt napon`)
    else {
      const from = Math.max(localTimeToMinutes(work.start), localTimeToMinutes(open.start))
      const to = Math.min(localTimeToMinutes(work.end), localTimeToMinutes(open.end))
      const endLocal = localParts(end, TZ)
      if (local.minutes < from || endLocal.minutes > to || endLocal.date !== local.date) problems.push(`${where}: munkaidőn kívül`)
    }

    // Tiltott időszak
    for (const b of settings.instructor.blockedPeriods) {
      if (b.kind !== 'weekly' || b.weekday !== wd) continue
      const bs = localToMs(local.date, localTimeToMinutes(b.start), TZ)
      const be = localToMs(local.date, localTimeToMinutes(b.end), TZ)
      if (start < be && bs < end) problems.push(`${where}: tiltott időszak`)
    }

    // Gép: engedélyezett, megfelelő fajta, nem inaktív
    if (req.kind !== 'theory') {
      const res = p.slot.resourceId!
      const kind = settings.resources[res]?.kind
      if (req.kind === 'flight' && kind !== 'aircraft') problems.push(`${where}: nem repülőgép`)
      if (req.kind === 'simulator' && kind !== 'simulator') problems.push(`${where}: nem szimulátor`)
      if (req.kind === 'flight') {
        const student = settings.students.find((st) => st.userId === req.studentIds[0])!
        const model = snapshot.fleet.find((a) => a.id === res)?.model
        const allowed = student.allowedResources.some((ref) => ('aircraftId' in ref ? ref.aircraftId === res : ref.aircraftType === model))
        if (!allowed) problems.push(`${where}: nem engedélyezett gép`)
      }
      // Kiesés, karbantartás a gépen
      for (const b of snapshot.bookings) {
        if (b.resourceId !== res) continue
        const long = toMs(b.end) - toMs(b.start) > 12 * 3_600_000
        if ((long || b.type === 'maintenance' || b.type === 'operation') && fs < toMs(b.end) && toMs(b.start) < fe) problems.push(`${where}: kieső gépen`)
      }
    }

    // Nappali feladat
    if (req.kind === 'flight' && req.daylightOnly) {
      const d = snapshot.daylight[local.date]!
      if (fs < toMs(d.sunrise) || fe > toMs(d.sunset)) problems.push(`${where}: sötétben`)
    }

    // Iskolai időjárási minimum 0–2 napon belül
    const lead = Math.round((Date.parse(`${local.date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
    if (req.kind === 'flight' && lead <= 2) {
      for (const hour of snapshot.weather) {
        const h = toMs(hour.time)
        if (h + 3_600_000 <= fs || h >= fe) continue
        const runways = settings.airport!.runways.map((rw) => rw.trueHeadingDeg)
        if (assessHour(hourValues(hour, runways), settings.weather.schoolMinima, {}).schoolViolated) problems.push(`${where}: iskolai minimumon kívül`)
      }
    }

    // A motor saját javaslata nem igényelhet jóváhagyást
    for (const w of p.warnings) {
      if (['limitExceeded', 'doubleBooking', 'outsideAvailability', 'hardConstraintOverridden'].includes(w.kind)) problems.push(`${where}: ${w.kind}`)
    }

    // Átfedés más javaslattal: oktató, gép (fordulóidővel), növendék
    for (const q of all) {
      if (q === p) continue
      const qs = toMs(q.slot.start)
      const qe = toMs(q.slot.end)
      if (start < qe && qs < end) problems.push(`${where}: oktatói átfedés ${q.requestId}`)
      if (q.slot.resourceId && q.slot.resourceId === p.slot.resourceId) {
        const ta = effectiveResource(settings, q.slot.resourceId).turnaroundMinutes * 60_000
        if (fs < toMs(q.slot.flightEnd!) + ta && toMs(q.slot.flightStart!) < fe + ta) problems.push(`${where}: gépátfedés ${q.requestId}`)
      }
    }
  }

  // Gépóra-keret és várható karbantartás a teljes héten (SZB-06): tervezett repülés nem esik
  // a karbantartásra, és meglévő foglalást sem szorít rá.
  for (const [res, entry] of Object.entries(settings.aircraftHours)) {
    const limits = maintenanceLimits(settings, entry, effectiveResource(settings, res).minReserveHours)
    const from = localToMs(entry.date, 0, TZ)
    const live = snapshot.bookings.filter((b) => b.resourceId === res && b.status !== 'CANCELLED')
    const existingUsage: UsageInterval[] = [
      ...live
        .filter((b) => b.type !== 'maintenance' && b.flightStart && b.flightEnd && toMs(b.flightStart) >= from)
        .map((b): UsageInterval => ({ start: toMs(b.flightStart!), end: toMs(b.flightEnd!), kind: 'flight', ref: `b:${b.id}` })),
      // Csak a fajtás karbantartás indítja újra a keretet (Q8).
      ...live.filter((b) => b.type === 'maintenance' && b.maintenanceLevel !== undefined && toMs(b.end) > from).map((b): UsageInterval => ({ start: toMs(b.start), end: toMs(b.end), kind: 'maintenance', ref: `b:${b.id}` })),
    ]
    const plannedUsage: UsageInterval[] = result.proposals
      .filter((p) => !p.standby && p.slot.resourceId === res && p.slot.flightStart)
      .map((p) => ({ start: toMs(p.slot.flightStart!), end: toMs(p.slot.flightEnd!), kind: 'flight', ref: `p:${p.requestId}` }))
    const before = projectMaintenance(existingUsage, limits, nowMs)
    const after = projectMaintenance([...existingUsage, ...plannedUsage], limits, nowMs)
    for (const ref of after.blocked) {
      if (ref.startsWith('p:')) problems.push(`${res}: ${ref} a várható karbantartásra esik`)
      else if (!before.blocked.has(ref)) problems.push(`${res}: ${ref} meglévő foglalást a karbantartásra szorít`)
    }
  }
  return problems
}

describe('tulajdonság: a javaslat soha nem sért kizáró feltételt', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1)

  it.each(seeds)('véletlen hét, mag: %i', (seed) => {
    const world = randomWorld(seed)
    const result = plan({ ...world, decisions: [] })
    expect(violations(world, result)).toEqual([])
    // Minden igény sorsa egyértelmű: elhelyezve, foglalatlan vagy halasztva.
    const handled = new Set([...result.proposals.map((p) => p.requestId), ...result.unplaced.map((u) => u.requestId), ...result.deferred])
    for (const q of world.requests) expect(handled.has(q.id), q.id).toBe(true)
  })

  it('a „döntse el a rendszer” után sem sérül kizáró feltétel, és nem marad verseny', () => {
    for (const seed of seeds.slice(0, 10)) {
      const world = randomWorld(seed)
      const first = plan({ ...world, decisions: [] })
      const decisions = first.dilemmas
        .filter((d) => d.type === 'competition')
        .map((d) => d.options.find((o) => o.id === d.recommendedOptionId)!.decision)
        .map((d) => (d.kind === 'assign' ? { ...d, auto: true } : d))
      const second = plan({ ...world, decisions })
      expect(second.dilemmas.filter((d) => d.type === 'competition').length).toBeLessThanOrEqual(first.dilemmas.filter((d) => d.type === 'competition').length)
      const engineOnly = { ...second, proposals: second.proposals.filter((p) => p.decidedBy === 'engine') }
      expect(violations(world, engineOnly)).toEqual([])
    }
  }, 30_000)
})

describe('tulajdonság: tágabb világ (sok gép, preferált gép, vegyes igények)', () => {
  const seeds = Array.from({ length: 30 }, (_, i) => i + 1)
  it.each(seeds)('mag: %i', (seed) => {
    const world = wideWorld(seed)
    const result = plan({ ...world, decisions: [] })
    expect(violations(world, result)).toEqual([])
    expect(runUpProblems(world, result)).toEqual([])
    expect(exactlyOnce(world, result)).toEqual([])
  })

  it('„döntse el a rendszer”: nem marad automatikus dilemma, nem dől meg döntés, nincs átfedés (H13)', () => {
    for (const seed of seeds.slice(0, 12)) {
      const world = wideWorld(seed)
      const decisions = autoResolveDecisions({ ...world, decisions: [] })
      const result = plan({ ...world, decisions })
      expect(result.dilemmas.filter((d) => AUTO_RESOLVABLE.has(d.type))).toEqual([])
      expect(result.decisionIssues).toEqual([])
      const asEngine = { ...result, proposals: result.proposals.map((p) => ({ ...p, decidedBy: 'engine' as const })) }
      expect(violations(world, asEngine)).toEqual([])
    }
  }, 60_000)

  it('döntések mellett is minden igény pontosan egy helyen szerepel', () => {
    for (const seed of seeds.slice(0, 10)) {
      const world = wideWorld(seed)
      const first = plan({ ...world, decisions: [] })
      // Minden dilemmára az ajánlás, és az első javaslat halasztása az elhelyezése után (H17).
      const decisions = first.dilemmas.map((d) => d.options.find((o) => o.id === d.recommendedOptionId)!.decision)
      const firstPlaced = first.proposals.find((p) => !p.standby)
      const extra = firstPlaced ? [{ kind: 'assign' as const, requestId: firstPlaced.requestId, slot: firstPlaced.slot, acceptWarnings: false }, { kind: 'defer' as const, requestId: firstPlaced.requestId }] : []
      const result = plan({ ...world, decisions: [...decisions, ...extra] })
      expect(exactlyOnce(world, result)).toEqual([])
    }
  }, 30_000)
})

describe('teljesítmény', () => {
  it('egy 20 igényes hét tervezése 2 másodperc alatt lefut', () => {
    const world = randomWorld(99)
    const requests = [...world.requests, ...Array.from({ length: 20 - world.requests.length }, (_, i) => flight(`extra${i}`, `n${(i % 5) + 1}`))]
    const started = performance.now()
    plan({ ...world, requests, decisions: [] })
    expect(performance.now() - started).toBeLessThan(2000)
  })

  it('valószerű flotta: 26 gép, 300 foglalás, 20 repülés (H04)', () => {
    const r = rng(7)
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!
    const fleet = [
      ...Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, callSign: `HA-XP${i}`, model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, callSign: `HA-XC${i}`, model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, callSign: `SIM-${i}`, model: 'SIM', aircraftClass: 'SIMULATOR', disabled: false })),
    ]
    const students = Array.from({ length: 13 }, (_, i) => `n${i}`)
    const bookings: ExistingBooking[] = []
    for (let i = 0; i < 300; i++) {
      const d = pick(DAYS.slice(0, 6))
      const h = 7 + Math.floor(r() * 9)
      const start = at(d, `${String(h).padStart(2, '0')}:00`)
      const end = at(d, `${String(h + 2).padStart(2, '0')}:00`)
      bookings.push(existing(`x${i}`, { resourceId: pick(fleet).id, instructorId: `masik${i % 40}`, start, end, flightStart: start, flightEnd: end, participantIds: [`zz${i}`] }))
    }
    const s = baseSettings()
    const allowed = fleet.filter((a) => a.aircraftClass !== 'SIMULATOR').slice(0, 8).map((a) => ({ aircraftId: a.id }))
    const settings: Settings = {
      ...s,
      resources: {},
      aircraftHours: Object.fromEntries(fleet.filter((a) => a.aircraftClass !== 'SIMULATOR').map((a) => [a.id, { date: '2026-11-15', hoursUntilMaintenance: 30, enteredAt: '2026-11-15T07:00:00.000Z' }])),
      students: students.map((userId) => ({ userId, allowedResources: allowed })),
    }
    const requests = Array.from({ length: 20 }, (_, i) => flight(`f${i}`, students[i % students.length]!))
    const snapshot = baseSnapshot({ fleet: fleet as Snapshot['fleet'], bookings, lastFlightAt: Object.fromEntries(students.map((id) => [id, '2026-11-10T10:00:00.000Z'])) })
    const started = performance.now()
    const result = plan({ snapshot, settings, requests, decisions: [] })
    // A mérés idején kb. 0,7 mp; a határ a lassabb gépek miatt bőkezű.
    expect(performance.now() - started).toBeLessThan(4000)
    expect(result.proposals.length).toBeGreaterThan(15)
  }, 20_000)
})
