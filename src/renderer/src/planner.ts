import { autoResolveDecisions } from '@core/engine/autoResolve'
import { plan, type PlanInput } from '@core/engine/plan'
import { watchWithCapacity } from '@core/engine/openings'
import type { WatchOptions, WeekWatch } from '@core/engine/weekWatch'
import type { Decision, DecisionIssue, PlanResult } from '@core/model/planning'
import { createOpeningsSession, type OpeningsList, type OpeningsRequest, type TrialView } from './openingsSession'
import type { PlanRequest, PlanResponse } from './planWorker'

/**
 * A háttérszálas motor kliense. Ha a környezetben nincs Worker (például teszt), a motor a
 * hívó szálán fut. Egyszerre egy tervezés számít: a régebbi kérés eredménye elvész.
 */
export interface Planner {
  plan(input: PlanInput): Promise<PlanResult>
  autoResolve(input: PlanInput): Promise<readonly Decision[]>
  issues(input: PlanInput): Promise<readonly DecisionIssue[]>
  /** Hét közbeni figyelés a kiszámolt terv mellett (TRV-15). */
  watch(input: PlanInput, base: PlanResult, options: WatchOptions): Promise<WeekWatch>
  /** „Van még hely?” (KIT-01–03): a beférő plusz igények és visszahozások. */
  openings(request: OpeningsRequest): Promise<OpeningsList>
  /** A legutóbbi keresés egy lehetőségének próbaszámolása (KIT-04). */
  trial(token: number, studentId: string, key: string): Promise<TrialView>
  dispose(): void
}

/** Az üzenet az azonosító nélkül (a változatonként külön, hogy a mezők megmaradjanak). */
type WithoutId<T> = T extends unknown ? Omit<T, 'id'> : never

export function createPlanner(): Planner {
  if (typeof Worker === 'undefined') {
    const session = createOpeningsSession()
    return {
      plan: async (input) => plan(input),
      autoResolve: async (input) => autoResolveDecisions(input),
      issues: async (input) => plan(input).decisionIssues,
      watch: async (input, base, options) => watchWithCapacity(input, base, options),
      openings: async (request) => session.find(request),
      trial: async (token, studentId, key) => session.trial(token, studentId, key),
      dispose: () => undefined,
    }
  }
  const worker = new Worker(new URL('./planWorker.ts', import.meta.url), { type: 'module' })
  let next = 0
  const pending = new Map<number, { resolve: (r: PlanResponse) => void; reject: (e: Error) => void }>()
  worker.onmessage = (event: MessageEvent<PlanResponse>) => {
    const p = pending.get(event.data.id)
    if (!p) return
    pending.delete(event.data.id)
    if (event.data.kind === 'error') p.reject(new Error(event.data.message))
    else p.resolve(event.data)
  }
  worker.onerror = (event) => {
    for (const p of pending.values()) p.reject(new Error(event.message || 'A tervező szál hibát jelzett.'))
    pending.clear()
  }
  const send = (msg: WithoutId<PlanRequest>): Promise<PlanResponse> =>
    new Promise((resolve, reject) => {
      const id = ++next
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...msg, id })
    })
  return {
    plan: async (input) => {
      const r = await send({ kind: 'plan', input })
      if (r.kind !== 'plan') throw new Error('Váratlan válasz a tervező száltól.')
      return r.result
    },
    autoResolve: async (input) => {
      const r = await send({ kind: 'auto', input })
      if (r.kind !== 'auto') throw new Error('Váratlan válasz a tervező száltól.')
      return r.decisions
    },
    issues: async (input) => {
      const r = await send({ kind: 'issues', input })
      if (r.kind !== 'issues') throw new Error('Váratlan válasz a tervező száltól.')
      return r.issues
    },
    watch: async (input, base, options) => {
      const r = await send({ kind: 'watch', input, base, options })
      if (r.kind !== 'watch') throw new Error('Váratlan válasz a tervező száltól.')
      return r.watch
    },
    openings: async (request) => {
      const r = await send({ kind: 'openings', request })
      if (r.kind !== 'openings') throw new Error('Váratlan válasz a tervező száltól.')
      return r.openings
    },
    trial: async (token, studentId, key) => {
      const r = await send({ kind: 'trial', token, studentId, key })
      if (r.kind !== 'trial') throw new Error('Váratlan válasz a tervező száltól.')
      return r.trial
    },
    dispose: () => worker.terminate(),
  }
}
