import { effectiveStudent } from '../config/operations'
import type { Settings } from '../config/schema'
import type { BookingRequest, ExistingBooking, PlanWarning, Slot, TeamUnit } from '../model/planning'
import { localToMs, MINUTE_MS, toIso, toMs } from '../time/zoned'
import type { Evaluation, PlanningContext, Times } from './context'

/**
 * Közös briefing csapatok (KBR-01, KBR-02, KBR-07). A csapat tagjai azonos időben kezdenek:
 * közös briefing, utána egymás után repülnek, a végén közös debriefing. A foglalások egysége a
 * pár (két egymás után repülő tag ugyanazon a gépen, multi student foglalás) vagy az egyéni
 * foglalás; mindegyik a közös kezdéstől a közös végig tart, csak a repülési ablakuk más.
 *
 * Időszerkezet:
 * - briefing és debriefing: a tagok közül a leghosszabb;
 * - sorrend: napi sorrend (NOV-05), prioritás (NOV-12, a nagyobb előbb), azonosító;
 * - pár: két egymás után repülő tag ugyanazon a gépen, ha mindkettőnek van feladata (a
 *   FlightLogger a feladat nélküli multi student foglalást nem regisztrálja jól);
 * - rés: a páron belül a csere; az egységek között azonos gépen a csere és a fordulóidő közül a
 *   nagyobb, más gépen a csere; a gép napi első repülése előtt legalább a motorpróba (SZB-05).
 */

/** A FlightLoggerben lévő (vagy rögzítettnek jelölt) tag: a csapat többi része hozzá igazodik. */
export interface RecordedMember {
  readonly request: BookingRequest
  readonly slot: Slot
  readonly bookingId?: string
}

export interface ActiveTeam {
  readonly id: string
  /** Az elhelyezendő tagok a repülés sorrendjében. */
  readonly members: readonly BookingRequest[]
  /** A már rögzített tagok (azonos közös kezdéssel), a repülésük sorrendjében. */
  readonly recorded: readonly RecordedMember[]
  /** A közös briefing és debriefing percben. */
  readonly briefing: number
  readonly debriefing: number
}

export interface TeamsInput {
  readonly requests: readonly BookingRequest[]
  readonly settings: Settings
  /** Halasztott és ezen a héten egyénileg tervezett (`teamOff`) igények. */
  readonly excluded: ReadonlySet<string>
  /** A FlightLoggerben lévő vagy rögzítettnek jelölt igények helye. */
  readonly recorded: ReadonlyMap<string, { readonly slot: Slot; readonly bookingId?: string }>
}

const teamWarning = (requestId: string, message: string): PlanWarning => ({ kind: 'team', message: `Közös briefing: ${message}`, requestId })

/** A hét működő csapatai (legalább két taggal) és a csapatból kimaradó tagok jelzései (KBR-05, KBR-06). */
export function activeTeams(input: TeamsInput): { readonly teams: ActiveTeam[]; readonly warnings: PlanWarning[] } {
  const warnings: PlanWarning[] = []
  const byTeam = new Map<string, BookingRequest[]>()
  for (const r of [...input.requests].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!r.briefingTeamId || input.excluded.has(r.id)) continue
    if (r.kind === 'theory') {
      warnings.push(teamWarning(r.id, 'elmélet nem lehet csapattag, külön tervezem.'))
      continue
    }
    if (r.timing?.kind === 'fixed' && !input.recorded.has(r.id)) {
      warnings.push(teamWarning(r.id, 'fix időpontú igény nem lehet csapattag, egyénileg tervezem.'))
      continue
    }
    byTeam.set(r.briefingTeamId, [...(byTeam.get(r.briefingTeamId) ?? []), r])
  }
  const order = (r: BookingRequest): { dayOrder: number; priority: number } => {
    const st = input.settings.students.find((s) => s.userId === r.studentIds[0])
    const e = st ? effectiveStudent(input.settings, st) : undefined
    return { dayOrder: e?.dayOrder ?? Number.POSITIVE_INFINITY, priority: e?.priority ?? input.settings.defaults.studentPriority }
  }
  const teams: ActiveTeam[] = []
  for (const [id, all] of [...byTeam].sort(([a], [b]) => a.localeCompare(b))) {
    // Egy növendék egy csapatban egyszer repül.
    const seen = new Set<string>()
    const candidates = all.filter((r) => {
      const sid = r.studentIds[0] ?? ''
      if (seen.has(sid)) {
        warnings.push(teamWarning(r.id, 'a növendéknek már van igénye ebben a csapatban, ezt egyénileg tervezem.'))
        return false
      }
      seen.add(sid)
      return true
    })
    // A rögzített tagok közül a legkorábbi közös kezdésűek a csapat; a máshova foglalt tag kimarad.
    const recordedAll = candidates.filter((r) => input.recorded.has(r.id))
    const commonStart = Math.min(...recordedAll.map((r) => toMs(input.recorded.get(r.id)!.slot.start)))
    const recorded: RecordedMember[] = []
    for (const r of recordedAll) {
      const rec = input.recorded.get(r.id)!
      if (toMs(rec.slot.start) === commonStart) recorded.push({ request: r, slot: rec.slot, ...(rec.bookingId ? { bookingId: rec.bookingId } : {}) })
      else warnings.push(teamWarning(r.id, 'a FlightLoggerben a csapattól külön foglalták, egyéniként kezelem.'))
    }
    const members = candidates.filter((r) => !input.recorded.has(r.id))
    if (members.length + recorded.length < 2) {
      for (const r of [...members, ...recorded.map((x) => x.request)]) warnings.push(teamWarning(r.id, 'csapattárs nélkül, egyénileg tervezem.'))
      continue
    }
    members.sort((a, b) => {
      const oa = order(a)
      const ob = order(b)
      return oa.dayOrder - ob.dayOrder || ob.priority - oa.priority || a.id.localeCompare(b.id)
    })
    recorded.sort((a, b) => toMs(a.slot.flightStart ?? a.slot.start) - toMs(b.slot.flightStart ?? b.slot.start) || a.request.id.localeCompare(b.request.id))
    const everyone = [...members, ...recorded.map((x) => x.request)]
    teams.push({
      id,
      members,
      recorded,
      briefing: Math.max(...everyone.map((r) => r.durations.briefing)),
      debriefing: Math.max(...everyone.map((r) => r.durations.debriefing)),
    })
  }
  return { teams, warnings }
}

interface LayoutUnit {
  readonly requestIds: string[]
  readonly resourceId: string | undefined
  readonly flightStartMs: number
  flightEndMs: number
  /** Párba állhat-e még (egy tag, van feladata, nem rögzített). */
  pairable: boolean
}

/** A csapat elrendezése egy közös kezdéssel és a tagok gépeivel. */
export interface TeamLayout {
  readonly startMs: number
  readonly endMs: number
  /** Az elhelyezendő tagok ideje: közös kezdés és vég, saját repülés. */
  readonly times: ReadonlyMap<string, Times>
  /** A FlightLogger-foglalások (a rögzítettekkel együtt) a repülés sorrendjében. */
  readonly units: readonly LayoutUnit[]
}

/**
 * Az elrendezés: a közös kezdés után a briefing, majd a tagok egymás után (KBR-01, KBR-02). Ha
 * van rögzített tag, a kezdés az övé, és a többiek az ő repülése után jönnek.
 */
export function layoutTeam(ctx: PlanningContext, team: ActiveTeam, startMs: number, resources: ReadonlyArray<string | undefined>, swapMinutes: number): TeamLayout {
  const swap = swapMinutes * MINUTE_MS
  const units: LayoutUnit[] = []
  const bookingOf = (id: string): string | undefined => team.recorded.find((x) => x.request.id === id)?.bookingId
  for (const r of team.recorded) {
    const fs = toMs(r.slot.flightStart ?? r.slot.start)
    const fe = toMs(r.slot.flightEnd ?? r.slot.end)
    // Egy foglalás: a FlightLogger-foglalás azonosítója szerint; a még le nem hozott rögzítésnél
    // (azonosító nélkül) az előző taggal, ha ugyanazon a gépen a csere után közvetlenül repül.
    const previous = units[units.length - 1]
    const same =
      r.bookingId !== undefined
        ? units.find((u) => u.requestIds.some((id) => bookingOf(id) === r.bookingId))
        : previous !== undefined &&
            previous.requestIds.length === 1 &&
            bookingOf(previous.requestIds[0]!) === undefined &&
            previous.resourceId !== undefined &&
            previous.resourceId === r.slot.resourceId &&
            fs - previous.flightEndMs <= swap &&
            r.request.lectureId !== undefined &&
            team.recorded.find((x) => x.request.id === previous.requestIds[0])?.request.lectureId !== undefined
          ? previous
          : undefined
    if (same) {
      same.requestIds.push(r.request.id)
      same.flightEndMs = Math.max(same.flightEndMs, fe)
    } else units.push({ requestIds: [r.request.id], resourceId: r.slot.resourceId, flightStartMs: fs, flightEndMs: fe, pairable: false })
  }
  const start = team.recorded.length > 0 ? Math.min(...team.recorded.map((r) => toMs(r.slot.start))) : startMs
  const used = new Set(units.map((u) => u.resourceId).filter((id): id is string => id !== undefined))
  let last = units.reduce<LayoutUnit | undefined>((x, u) => (!x || u.flightEndMs > x.flightEndMs ? u : x), undefined)
  let t = last ? last.flightEndMs : start + team.briefing * MINUTE_MS
  const flights: Array<{ id: string; fs: number; fe: number; resourceId: string | undefined }> = []
  team.members.forEach((m, i) => {
    const res = resources[i]
    const pair = last !== undefined && last.pairable && res !== undefined && last.resourceId === res && m.lectureId !== undefined
    let gap = 0
    if (last !== undefined) gap = pair ? swap : last.resourceId !== undefined && last.resourceId === res ? Math.max(swap, ctx.resource(res).turnaroundMinutes * MINUTE_MS) : swap
    if (m.kind === 'flight' && res !== undefined && !used.has(res) && ctx.isFirstFlightOfDay(res, t + gap, m.id)) gap = Math.max(gap, ctx.resource(res).engineRunUpMinutes * MINUTE_MS)
    const fs = t + gap
    const fe = fs + m.durations.main * MINUTE_MS
    if (pair && last) {
      last.requestIds.push(m.id)
      last.flightEndMs = fe
      last.pairable = false
    } else {
      last = { requestIds: [m.id], resourceId: res, flightStartMs: fs, flightEndMs: fe, pairable: m.lectureId !== undefined }
      units.push(last)
    }
    if (res !== undefined) used.add(res)
    flights.push({ id: m.id, fs, fe, resourceId: res })
    t = fe
  })
  const endMs = t + team.debriefing * MINUTE_MS
  const times = new Map<string, Times>()
  for (const f of flights) times.set(f.id, { startMs: start, endMs, flightStartMs: f.fs, flightEndMs: f.fe, resourceId: f.resourceId, classroomId: undefined })
  return { startMs: start, endMs, times, units }
}

/** A FlightLogger-foglalások a tervezet fogalmaival (a rögzítési listához, KBR-09). */
export function teamUnits(layout: TeamLayout): TeamUnit[] {
  return layout.units.map((u) => ({
    requestIds: [...u.requestIds],
    bookingType: u.requestIds.length > 1 ? 'multiStudent' : 'singleStudent',
    ...(u.resourceId ? { resourceId: u.resourceId } : {}),
    flightStart: toIso(u.flightStartMs),
    flightEnd: toIso(u.flightEndMs),
  }))
}

/**
 * A tagok gépkiosztásának változatai: mindegyikben egy „fő gép”, amelyre minden tag kerül, aki
 * repülhet vele (így a legtöbb pár képződik), a többiek az első engedélyezett gépükre. A fő gép
 * sorrendje: amelyre a legtöbb tag repülhet, azon belül az azonosító; rögzített tagnál az utolsó
 * rögzített egység gépe kerül előre.
 */
export function resourceVariants(ctx: PlanningContext, team: ActiveTeam, extra: ReadonlyArray<string | undefined> = []): Array<Array<string | undefined>> {
  const allowed = team.members.map((m) => ctx.resourcesFor(m).map((r) => r.resourceId).filter((id): id is string => id !== undefined))
  const counts = new Map<string, number>()
  for (const list of allowed) for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1)
  const lastRecorded = [...team.recorded].reverse().find((r) => r.slot.resourceId)?.slot.resourceId
  const mains = [...counts.keys()].sort((a, b) => Number(b === lastRecorded) - Number(a === lastRecorded) || counts.get(b)! - counts.get(a)! || a.localeCompare(b))
  const variants = mains.map((main) => allowed.map((list) => (list.includes(main) ? main : list[0])))
  if (variants.length === 0) variants.push(team.members.map(() => undefined))
  if (extra.length === team.members.length) {
    // Döntésnél a választott gép a többi tagé is, ha repülhetnek vele (így párt alkothatnak).
    const picked = extra.filter((id): id is string => id !== undefined)
    const main = [...new Set(picked)].sort((a, b) => picked.filter((x) => x === b).length - picked.filter((x) => x === a).length || a.localeCompare(b))[0]
    variants.unshift(extra.map((id, i) => id ?? (main !== undefined && allowed[i]!.includes(main) ? main : variants[0]![i])))
  }
  const seen = new Set<string>()
  return variants.filter((v) => {
    const key = v.join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A csapat egy lehetséges helye: a tagok kiértékelésével. */
export interface TeamCandidate {
  readonly layout: TeamLayout
  readonly resources: ReadonlyArray<string | undefined>
  readonly evaluations: readonly Evaluation[]
  /** Egyik tagnál sincs jóváhagyást igénylő figyelmeztetés. */
  readonly clean: boolean
  /** A tagok súlyozott pontjának átlaga (0–100). */
  readonly score: number
  /** Minden preferált időablakú tag ablakában kezdődik (TRV-02). */
  readonly inWindows: boolean
}

/** A közös kezdés jelöltjei a héten: a rács pontjai az operációs időn belül; éjszakai csapatnál a szürkület is. */
export function teamStarts(ctx: PlanningContext, team: ActiveTeam, swapMinutes: number): number[] {
  if (team.recorded.length > 0) return [Math.min(...team.recorded.map((r) => toMs(r.slot.start)))]
  const n = team.members.length
  const minimal = team.briefing + team.members.reduce((s, m) => s + m.durations.main, 0) + (n - 1) * swapMinutes + team.debriefing
  const night = team.members.every((m) => m.kind === 'flight' && !m.daylightOnly)
  const starts: number[] = []
  for (const date of ctx.weekDays) {
    if (date < ctx.today) continue
    const window = ctx.windowFor(date)
    if (!window) continue
    const minutes = new Set<number>()
    const first = Math.ceil(window.start / ctx.stepMinutes) * ctx.stepMinutes
    for (let m = first; m + minimal <= window.end; m += ctx.stepMinutes) minutes.add(m)
    const dusk = night ? ctx.duskOf(date) : undefined
    if (dusk !== undefined) {
      const m = Math.ceil((dusk - localToMs(date, 0, ctx.tz)) / MINUTE_MS / 5) * 5 - team.briefing
      if (m >= window.start && m + minimal <= window.end) minutes.add(m)
    }
    for (const m of [...minutes].sort((a, b) => a - b)) {
      const ms = localToMs(date, m, ctx.tz)
      if (ms >= ctx.nowMs) starts.push(ms)
    }
  }
  return starts
}

/** Egy elrendezés kiértékelése tagonként (`normal` mód, gyorsítótárral); kizáró sértésnél nincs jelölt. */
export function evaluateLayout(ctx: PlanningContext, team: ActiveTeam, layout: TeamLayout, resources: ReadonlyArray<string | undefined>): TeamCandidate | undefined {
  const evaluations: Evaluation[] = []
  for (const m of team.members) {
    const e = ctx.evaluateCandidate(m, layout.times.get(m.id)!)
    if (!e) return undefined
    evaluations.push(e)
  }
  const preferred = team.members.filter((m) => m.timing?.kind === 'preferred')
  const inWindows = preferred.every((m) => m.timing?.kind === 'preferred' && m.timing.windows.some((w) => layout.startMs >= toMs(w.start) && layout.startMs <= toMs(w.end)))
  return {
    layout,
    resources,
    evaluations,
    clean: evaluations.every((e) => !e.needsApproval),
    score: evaluations.reduce((s, e) => s + e.weighted.score, 0) / Math.max(1, evaluations.length),
    inWindows: preferred.length > 0 && inWindows,
  }
}

/**
 * A csapat minden lehetséges helye a héten (közös kezdés × gépkiosztás). `prefer`: tagonként az
 * előnyben részesített gép (például a mostani), az első változat ez.
 */
export function teamCandidates(ctx: PlanningContext, team: ActiveTeam, swapMinutes: number, prefer: ReadonlyArray<string | undefined> = []): TeamCandidate[] {
  const result: TeamCandidate[] = []
  const variants = resourceVariants(ctx, team, prefer)
  for (const start of teamStarts(ctx, team, swapMinutes)) {
    for (const resources of variants) {
      const c = evaluateLayout(ctx, team, layoutTeam(ctx, team, start, resources, swapMinutes), resources)
      if (c) result.push(c)
    }
  }
  return result
}

/** Jobb-e az egyik jelölt: az ablakban kezdődő, a nagyobb pontú, a korábbi. */
export function betterTeamCandidate(a: TeamCandidate, b: TeamCandidate): boolean {
  if (a.inWindows !== b.inWindows) return a.inWindows
  if (a.score !== b.score) return a.score > b.score
  return a.layout.startMs < b.layout.startMs
}

/**
 * A FlightLoggerben közös briefinggel felvett foglalások (KBR-10): ugyanannak az oktatónak az
 * azonos kezdésű, gépes oktatási (egy- és többnövendékes) foglalásai, egymást nem átfedő repülési
 * ablakkal. Csoport a legalább két ilyen foglalás, és az egyedüli többnövendékes foglalás is (a
 * növendékei egymás után repülnek). Az eredmény: foglalás → csoport kulcsa.
 */
export function flightLoggerTeams(bookings: readonly ExistingBooking[]): Map<string, string> {
  const groups = new Map<string, ExistingBooking[]>()
  for (const b of bookings) {
    if (b.status === 'CANCELLED' || (b.type !== 'singleStudent' && b.type !== 'multiStudent')) continue
    if (!b.resourceId || !b.flightStart || !b.flightEnd || !b.instructorId) continue
    const key = `fl:${b.instructorId}|${toMs(b.start)}`
    groups.set(key, [...(groups.get(key) ?? []), b])
  }
  const result = new Map<string, string>()
  for (const [key, list] of groups) {
    if (list.length < 2 && list[0]?.type !== 'multiStudent') continue
    const sorted = [...list].sort((a, b) => toMs(a.flightStart!) - toMs(b.flightStart!))
    const disjoint = sorted.every((b, i) => i === 0 || toMs(b.flightStart!) >= toMs(sorted[i - 1]!.flightEnd!))
    if (!disjoint) continue
    for (const b of list) result.set(b.id, key)
  }
  return result
}
