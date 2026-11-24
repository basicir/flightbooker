import type { Settings } from '../config/schema'
import type { BookingRequest, HardCode, PlanWarning, Proposal, Slot } from '../model/planning'
import type { Snapshot } from '../model/snapshot'
import type { LocalDate } from '../model/time'
import { civilTwilight } from '../time/solar'
import { localParts, localToMs } from '../time/zoned'
import { PlanningContext, severityOf, type Evaluation } from './context'

/**
 * Időpont-felderítő a dilemmákhoz (9.2, TRV-16): egy igény minden lehetséges helyét
 * kiértékeli a kiszámolt terv mellett, hogy az oktató egy heti térképen lássa, hol szabad,
 * hol csak figyelmeztetéssel vagy felülbírálással fér be – és miért. Tiszta függvény: a
 * terv nem változik, csak a döntés (assign) rögzíti a választott helyet.
 */

export interface ExploreInput {
  readonly snapshot: Snapshot
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  /** A kiszámolt terv javaslatai; a vizsgált igényé kivételével foglaltnak számítanak. */
  readonly proposals: readonly Proposal[]
  /** A tervezés tényleges pillanata (H20). */
  readonly now?: string
  /** Feladatsorrend (ELS-05), a terv bemenetéből: a térkép is ezt tartja. */
  readonly sequences?: ReadonlyArray<readonly string[]>
  /** A FlightLoggerben már lefoglalt igények helye (a sorrendhez). */
  readonly booked?: ReadonlyArray<{ readonly requestId: string; readonly slot: Slot }>
}

/** `free`: tiszta hely; `warning`: jóváhagyással (limit, kettős foglalás, ráérés); `blocked`: csak felülbírálással. */
export type CandidateStatus = 'free' | 'warning' | 'blocked'

export interface SlotCandidate {
  readonly slot: Slot
  readonly date: LocalDate
  /** A fő rész (repülés, gépidő, elméleti óra) kezdete, helyi percekben. */
  readonly minutes: number
  /** Gép vagy terem azonosítója. */
  readonly placeId: string
  readonly status: CandidateStatus
  readonly hardCodes: readonly HardCode[]
  /** A felülbírálás súlya (0: nincs mit felülbírálni; ≤ 3: csak munkaidő vagy tiltott időszak). */
  readonly severity: number
  /** Megsértett kizáró feltételek: csak felülbírálással foglalható. */
  readonly overrides: readonly string[]
  /** Jóváhagyást igénylő figyelmeztetések (limit, kettős foglalás, ráérés). */
  readonly approvals: readonly string[]
  /** Súlyozott pont 0 és 100 között. */
  readonly score: number
}

export interface SlotGrid {
  readonly days: readonly LocalDate[]
  readonly fromMinutes: number
  readonly toMinutes: number
  readonly stepMinutes: number
  readonly candidates: readonly SlotCandidate[]
  /** A legjobb néhány hely: szabad, majd figyelmeztetéses, majd a legkevesebb akadályú. */
  readonly best: readonly SlotCandidate[]
  /** Polgári szürkület a bázisrepülőtéren (UTC ms), napi bontásban. */
  readonly twilight: Readonly<Record<LocalDate, { readonly dawn?: number; readonly dusk?: number }>>
}

export interface SlotExplorer {
  readonly request: BookingRequest
  /** Az igényhez használható gépek vagy termek (NOV-03, ERF-07). */
  readonly places: readonly string[]
  readonly timezone: string
  grid(options?: { readonly fromMinutes?: number; readonly toMinutes?: number; readonly stepMinutes?: number }): SlotGrid
  /** Egy adott kezdés kiértékelése (finomhangoláshoz). */
  at(date: LocalDate, minutes: number, placeId: string): SlotCandidate
}

const APPROVAL: ReadonlySet<PlanWarning['kind']> = new Set(['limitExceeded', 'doubleBooking', 'outsideAvailability'])
const STATUS_RANK: Readonly<Record<CandidateStatus, number>> = { free: 0, warning: 1, blocked: 2 }

/** Rendezés: jobb státusz, enyhébb és kevesebb akadály, magasabb pont, korábbi időpont. */
export function compareCandidates(a: SlotCandidate, b: SlotCandidate): number {
  return (
    STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
    a.severity - b.severity ||
    a.hardCodes.length - b.hardCodes.length ||
    b.score - a.score ||
    a.slot.start.localeCompare(b.slot.start) ||
    a.placeId.localeCompare(b.placeId)
  )
}

export function createSlotExplorer(input: ExploreInput, requestId: string): SlotExplorer | undefined {
  const request = input.requests.find((r) => r.id === requestId)
  if (!request) return undefined
  const ctx = new PlanningContext(input.snapshot, input.settings, input.requests, input.now ? { now: input.now } : {})
  ctx.setSequences(input.sequences ?? [], input.booked ?? [])
  const byId = new Map(input.requests.map((r) => [r.id, r]))
  for (const p of input.proposals) {
    if (p.requestId === requestId) continue
    const other = byId.get(p.requestId)
    if (other) ctx.place({ request: other, times: ctx.timesOfSlot(p.slot), standby: p.standby, ...(p.pairedRequestId ? { pairedRequestId: p.pairedRequestId } : {}) })
  }
  const isTheory = request.kind === 'theory'
  const places = ctx.resourcesFor(request).map((r) => r.resourceId ?? r.classroomId!)

  const candidateOf = (e: Evaluation, placeId: string): SlotCandidate => {
    const local = localParts(e.times.flightStartMs, ctx.tz)
    const approvals = e.warnings.filter((w) => APPROVAL.has(w.kind)).map((w) => w.message)
    return {
      slot: ctx.slotOf(e.times, request),
      date: local.date,
      minutes: local.minutes,
      placeId,
      status: e.hardViolations.length > 0 ? 'blocked' : e.needsApproval ? 'warning' : 'free',
      hardCodes: e.hardCodes,
      severity: severityOf(e.hardCodes),
      overrides: [...new Set(e.hardViolations)],
      approvals: [...new Set(approvals)],
      score: Math.round(e.weighted.score),
    }
  }

  const evaluateAt = (anchorMs: number, placeId: string): SlotCandidate => {
    const times = ctx.timesAt(request, anchorMs, isTheory ? undefined : placeId, isTheory ? placeId : undefined)
    return candidateOf(ctx.evaluate(request, times, 'forced')!, placeId)
  }

  return {
    request,
    places,
    timezone: ctx.tz,
    at: (date, minutes, placeId) => evaluateAt(localToMs(date, minutes, ctx.tz), placeId),
    grid: (options = {}) => {
      const fromMinutes = options.fromMinutes ?? 6 * 60
      const toMinutes = options.toMinutes ?? 22 * 60
      const stepMinutes = options.stepMinutes ?? 30
      const days = ctx.weekDays.filter((d) => d >= ctx.today)
      const candidates: SlotCandidate[] = []
      const seen = new Set<string>()
      for (const date of days) {
        for (let m = fromMinutes; m < toMinutes; m += stepMinutes) {
          const anchor = localToMs(date, m, ctx.tz)
          for (const placeId of places) {
            candidates.push(evaluateAt(anchor, placeId))
            seen.add(`${anchor}|${placeId}`)
          }
        }
      }
      // A legjobb helyek közé a motor saját jelöltjei is bekerülnek (szürkülethez, résekhez
      // igazított kezdések), amelyek a félórás rácson nincsenek rajta.
      const pool = [...candidates]
      const base = ctx.anchorsFor(request)
      for (const placeId of places) {
        const extra = isTheory ? base : [...base, ...ctx.gapAnchorsFor(request, placeId)]
        for (const anchor of extra) {
          if (seen.has(`${anchor}|${placeId}`)) continue
          seen.add(`${anchor}|${placeId}`)
          pool.push(evaluateAt(anchor, placeId))
        }
      }
      // Változatosság: előbb naponként a legjobb, utána a maradék helyek sorrendben.
      const best: SlotCandidate[] = []
      const taken = new Set<string>()
      const ranked = pool.filter((x) => !x.hardCodes.includes('past')).sort(compareCandidates)
      const usedDays = new Set<string>()
      for (const pass of [0, 1]) {
        for (const c of ranked) {
          if (best.length >= 5) break
          const key = `${c.date}|${c.minutes}`
          if (taken.has(key) || (pass === 0 && usedDays.has(c.date))) continue
          taken.add(key)
          usedDays.add(c.date)
          best.push(c)
        }
      }
      best.sort(compareCandidates)
      const airport = input.settings.airport
      const twilight = Object.fromEntries(days.map((d) => [d, airport ? civilTwilight(d, airport.latitude, airport.longitude) : {}]))
      return { days, fromMinutes, toMinutes, stepMinutes, candidates, best, twilight }
    },
  }
}
