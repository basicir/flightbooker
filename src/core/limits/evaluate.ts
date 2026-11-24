import type { LimitRule } from '../model/limits'
import type { LocalDate } from '../model/time'
import { addDays, daysBetween, weekdayIndex } from '../time/zoned'

/**
 * Limit-szabályok kiértékelése előrevetítéssel (8.3, LIM-01–06). A limit a már repült
 * és a tervezett idő összegére nézendő; gördülő ablaknál minden érintett napra külön.
 */

/** Egy tevékenység a limitek szempontjából, helyi napra bontva. */
export interface LimitActivity {
  readonly date: LocalDate
  readonly startMs: number
  readonly endMs: number
  /** Repült (block) idő percben; nem repülésnél 0. */
  readonly flightMinutes: number
  readonly simulator: boolean
  /** Feladatnak számít-e (repülés vagy szimulátor). */
  readonly task: boolean
  /** Szolgálati időnek számít-e (oktatónál minden foglalás). */
  readonly duty: boolean
}

interface DayAggregate {
  flightMinutes: number
  simMinutes: number
  tasks: number
  simTasks: number
  dutyStart: number
  dutyEnd: number
  flyingStart: number
  flyingEnd: number
}

type Metric = 'flight' | 'flightSim' | 'duty' | 'tasks' | 'tasksSim'

/** Az első index, ahol a rendezett lista eleme ≥ x. */
function lowerBound(sorted: readonly string[], x: string): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid]! < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Egy alany (oktató vagy növendék) tevékenységei napokra összesítve. */
export class LimitLedger {
  readonly #days = new Map<LocalDate, DayAggregate>()

  constructor(activities: readonly LimitActivity[]) {
    for (const a of activities) this.#add(a)
  }

  #add(a: LimitActivity): void {
    const agg = this.#days.get(a.date) ?? {
      flightMinutes: 0,
      simMinutes: 0,
      tasks: 0,
      simTasks: 0,
      dutyStart: Number.POSITIVE_INFINITY,
      dutyEnd: Number.NEGATIVE_INFINITY,
      flyingStart: Number.POSITIVE_INFINITY,
      flyingEnd: Number.NEGATIVE_INFINITY,
    }
    if (a.simulator) agg.simMinutes += a.flightMinutes
    else agg.flightMinutes += a.flightMinutes
    if (a.task) {
      if (a.simulator) agg.simTasks++
      else agg.tasks++
    }
    if (a.duty) {
      agg.dutyStart = Math.min(agg.dutyStart, a.startMs)
      agg.dutyEnd = Math.max(agg.dutyEnd, a.endMs)
    }
    if (a.task && !a.simulator) {
      agg.flyingStart = Math.min(agg.flyingStart, a.startMs)
      agg.flyingEnd = Math.max(agg.flyingEnd, a.endMs)
    }
    this.#days.set(a.date, agg)
  }

  day(date: LocalDate): Readonly<DayAggregate> | undefined {
    return this.#days.get(date)
  }

  #prefix: { dates: LocalDate[]; sums: Record<Metric, number[]> } | undefined

  /** Napi összegek prefixösszege: egy ablak összege két bináris kereséssel. */
  #prefixSums(): { dates: LocalDate[]; sums: Record<Metric, number[]> } {
    if (this.#prefix) return this.#prefix
    const dates = [...this.#days.keys()].sort()
    const sums: Record<Metric, number[]> = { flight: [0], flightSim: [0], duty: [0], tasks: [0], tasksSim: [0] }
    for (const date of dates) {
      const agg = this.#days.get(date)!
      const add = (m: Metric, v: number): void => {
        sums[m].push(sums[m][sums[m].length - 1]! + v)
      }
      add('flight', agg.flightMinutes)
      add('flightSim', agg.flightMinutes + agg.simMinutes)
      add('duty', Number.isFinite(agg.dutyStart) ? (agg.dutyEnd - agg.dutyStart) / 60_000 : 0)
      add('tasks', agg.tasks)
      add('tasksSim', agg.tasks + agg.simTasks)
    }
    this.#prefix = { dates, sums }
    return this.#prefix
  }

  /** Napi érték összege az [from, to] napokra (mindkettő benne). */
  sum(metric: Metric, from: LocalDate, to: LocalDate): number {
    const { dates, sums } = this.#prefixSums()
    const series = sums[metric]
    return series[lowerBound(dates, `${to}~`)]! - series[lowerBound(dates, from)]!
  }

  /** A megadott nap előtti / utáni legközelebbi nap, amelyen a feltétel teljesül. */
  neighbour(date: LocalDate, direction: -1 | 1, subject: 'instructor' | 'student'): LocalDate | undefined {
    const { dates } = this.#prefixSums()
    let i = direction < 0 ? lowerBound(dates, date) - 1 : lowerBound(dates, `${date}~`)
    for (; i >= 0 && i < dates.length; i += direction) {
      if (isActive(subject, this.#days.get(dates[i]!)!)) return dates[i]
    }
    return undefined
  }
}

export type LimitStatus = 'ok' | 'approach' | 'exceeded'

export interface LimitCheck {
  readonly ruleId: string
  readonly status: LimitStatus
  /** Órában (idő) vagy darabban; pihenőnél a legrövidebb pihenő órában. */
  readonly value: number
  readonly limit: number
  readonly windowEnd: LocalDate
}

type Window = { readonly from: LocalDate; readonly to: LocalDate }
/** Ablakfajtánként (és hosszanként), azon belül a nap és a horizont szerint. */
const windowCache = new Map<string, Map<string, readonly Window[]>>()

function windowsContaining(rule: LimitRule, date: LocalDate, horizonEnd: LocalDate): readonly Window[] {
  const w = rule.window
  const kind = w.kind === 'rollingDays' ? `d${w.days}` : w.kind === 'rollingCalendarMonths' ? `m${w.months}` : w.kind
  let byDate = windowCache.get(kind)
  if (!byDate) windowCache.set(kind, (byDate = new Map()))
  const key = date + horizonEnd
  const cached = byDate.get(key)
  if (cached) return cached
  if (byDate.size > 50_000) byDate.clear()
  const result = computeWindows(rule, date, horizonEnd)
  byDate.set(key, result)
  return result
}

function computeWindows(rule: LimitRule, date: LocalDate, horizonEnd: LocalDate): Window[] {
  const w = rule.window
  switch (w.kind) {
    case 'calendarDay':
      return [{ from: date, to: date }]
    case 'calendarWeek': {
      const monday = addDays(date, -weekdayIndex(date))
      return [{ from: monday, to: addDays(monday, 6) }]
    }
    case 'calendarYear':
      return [{ from: `${date.slice(0, 4)}-01-01`, to: `${date.slice(0, 4)}-12-31` }]
    case 'rollingDays': {
      const result: Array<{ from: LocalDate; to: LocalDate }> = []
      const lastEnd = addDays(date, w.days - 1) < horizonEnd ? addDays(date, w.days - 1) : horizonEnd
      for (let end = date; end <= lastEnd; end = addDays(end, 1)) result.push({ from: addDays(end, -(w.days - 1)), to: end })
      return result
    }
    case 'rollingCalendarMonths': {
      const result: Array<{ from: LocalDate; to: LocalDate }> = []
      for (let end = date; end <= horizonEnd; end = addDays(end, 1)) {
        const [y, m] = end.split('-').map(Number) as [number, number]
        const startMonth = new Date(Date.UTC(y, m - 1 - (w.months - 1), 1)).toISOString().slice(0, 10)
        result.push({ from: startMonth, to: end })
      }
      return result
    }
    case 'betweenDuties':
      return []
  }
}

function status(value: number, limit: number, warnAtPercent: number): LimitStatus {
  if (value > limit + 1e-9) return 'exceeded'
  if (limit > 0 && value >= (limit * warnAtPercent) / 100 - 1e-9) return 'approach'
  return 'ok'
}

function contribution(a: LimitActivity, metric: 'flight' | 'flightSim' | 'tasks' | 'tasksSim'): number {
  if (metric === 'flight') return a.simulator ? 0 : a.flightMinutes
  if (metric === 'flightSim') return a.flightMinutes
  if (metric === 'tasks') return a.task && !a.simulator ? 1 : 0
  return a.task ? 1 : 0
}

/** A jelölt napjának összesítése a jelölttel együtt (a főkönyv módosítása nélkül). */
function mergedDay(ledger: LimitLedger, a: LimitActivity): DayAggregate {
  const base = ledger.day(a.date)
  const agg: DayAggregate = base
    ? { ...base }
    : {
        flightMinutes: 0,
        simMinutes: 0,
        tasks: 0,
        simTasks: 0,
        dutyStart: Number.POSITIVE_INFINITY,
        dutyEnd: Number.NEGATIVE_INFINITY,
        flyingStart: Number.POSITIVE_INFINITY,
        flyingEnd: Number.NEGATIVE_INFINITY,
      }
  if (a.duty) {
    agg.dutyStart = Math.min(agg.dutyStart, a.startMs)
    agg.dutyEnd = Math.max(agg.dutyEnd, a.endMs)
  }
  if (a.task && !a.simulator) {
    agg.flyingStart = Math.min(agg.flyingStart, a.startMs)
    agg.flyingEnd = Math.max(agg.flyingEnd, a.endMs)
  }
  return agg
}

const dutyMinutes = (agg: DayAggregate | undefined): number =>
  agg && Number.isFinite(agg.dutyStart) ? (agg.dutyEnd - agg.dutyStart) / 60_000 : 0

/**
 * Az összes szabály ellenőrzése egy új tevékenységgel: a főkönyv a már repült és a
 * tervezett tevékenységeket tartalmazza, a jelöltet ehhez adjuk hozzá (LIM-06).
 * Csak a nem rendben lévő eredményeket adja vissza.
 */
export function checkLimitsWith(
  rules: readonly LimitRule[],
  subject: 'instructor' | 'student',
  ledger: LimitLedger,
  activity: LimitActivity,
  horizonEnd: LocalDate,
): LimitCheck[] {
  const results: LimitCheck[] = []
  const merged = mergedDay(ledger, activity)
  const dutyDelta = dutyMinutes(merged) - dutyMinutes(ledger.day(activity.date))
  for (const rule of rules) {
    if (!rule.enabled || rule.subject !== subject) continue
    if (rule.metric === 'restTime') {
      const check = checkRest(rule, subject, ledger, activity.date, merged)
      if (check) results.push(check)
      continue
    }
    let worst: LimitCheck | undefined
    for (const window of windowsContaining(rule, activity.date, horizonEnd)) {
      let value: number
      if (rule.metric === 'flightTime') {
        const metric = rule.includeSimulator ? 'flightSim' : 'flight'
        value = (ledger.sum(metric, window.from, window.to) + contribution(activity, metric)) / 60
      } else if (rule.metric === 'dutyTime') {
        value = (ledger.sum('duty', window.from, window.to) + dutyDelta) / 60
      } else {
        const metric = rule.includeSimulator ? 'tasksSim' : 'tasks'
        value = ledger.sum(metric, window.from, window.to) + contribution(activity, metric)
      }
      const s = status(value, rule.limit, rule.warnAtPercent)
      if (!worst || value / (rule.limit || 1) > worst.value / (worst.limit || 1)) {
        worst = { ruleId: rule.id, status: s, value, limit: rule.limit, windowEnd: window.to }
      }
    }
    if (worst && worst.status !== 'ok') results.push(worst)
  }
  return results
}

function isActive(subject: 'instructor' | 'student', a: DayAggregate): boolean {
  return subject === 'instructor' ? Number.isFinite(a.dutyStart) : Number.isFinite(a.flyingStart)
}

function restStart(subject: 'instructor' | 'student', a: DayAggregate): number {
  return subject === 'instructor' ? a.dutyStart : a.flyingStart
}

function restEnd(subject: 'instructor' | 'student', a: DayAggregate): number {
  return subject === 'instructor' ? a.dutyEnd : a.flyingEnd
}

function restGap(rule: LimitRule, subject: 'instructor' | 'student', earlier: DayAggregate, later: DayAggregate): { gapH: number; requiredH: number } {
  const gapH = (restStart(subject, later) - restEnd(subject, earlier)) / 3_600_000
  const previousDutyH = (restEnd(subject, earlier) - restStart(subject, earlier)) / 3_600_000
  return { gapH, requiredH: rule.restAtLeastPreviousDuty ? Math.max(rule.limit, previousDutyH) : rule.limit }
}

function checkRest(
  rule: LimitRule,
  subject: 'instructor' | 'student',
  ledger: LimitLedger,
  date: LocalDate,
  today: DayAggregate,
): LimitCheck | undefined {
  if (!isActive(subject, today)) return undefined
  let shortest: { gapH: number; requiredH: number } | undefined
  const before = ledger.neighbour(date, -1, subject)
  const after = ledger.neighbour(date, 1, subject)
  for (const pair of [
    before && daysBetween(before, date) <= 2 ? restGap(rule, subject, ledger.day(before)!, today) : undefined,
    after && daysBetween(date, after) <= 2 ? restGap(rule, subject, today, ledger.day(after)!) : undefined,
  ]) {
    if (pair && (!shortest || pair.gapH - pair.requiredH < shortest.gapH - shortest.requiredH)) shortest = pair
  }
  if (!shortest) return undefined
  if (shortest.gapH + 1e-9 < shortest.requiredH) {
    return { ruleId: rule.id, status: 'exceeded', value: shortest.gapH, limit: shortest.requiredH, windowEnd: date }
  }
  return undefined
}
