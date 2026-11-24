import { autoResolveDecisions } from '@core/engine/autoResolve'
import { plan, type PlanInput } from '@core/engine/plan'
import { watchWithCapacity } from '@core/engine/openings'
import type { WatchOptions, WeekWatch } from '@core/engine/weekWatch'
import type { Decision, DecisionIssue, PlanResult } from '@core/model/planning'
import { createOpeningsSession, type OpeningsList, type OpeningsRequest, type TrialView } from './openingsSession'

/**
 * A motor háttérszálon (H04, F3): a tervezés másodpercekig is tarthat, ezért nem a felület
 * szálán fut. A motor tiszta függvény, a szál csak üzeneteket vált; hálózatot nem ér.
 */

export type PlanRequest =
  | { readonly id: number; readonly kind: 'plan'; readonly input: PlanInput }
  | { readonly id: number; readonly kind: 'auto'; readonly input: PlanInput }
  | { readonly id: number; readonly kind: 'issues'; readonly input: PlanInput }
  | { readonly id: number; readonly kind: 'watch'; readonly input: PlanInput; readonly base: PlanResult; readonly options: WatchOptions }
  | { readonly id: number; readonly kind: 'openings'; readonly request: OpeningsRequest }
  | { readonly id: number; readonly kind: 'trial'; readonly token: number; readonly studentId: string; readonly key: string }

export type PlanResponse =
  | { readonly id: number; readonly kind: 'plan'; readonly result: PlanResult }
  | { readonly id: number; readonly kind: 'auto'; readonly decisions: readonly Decision[] }
  | { readonly id: number; readonly kind: 'issues'; readonly issues: readonly DecisionIssue[] }
  | { readonly id: number; readonly kind: 'watch'; readonly watch: WeekWatch }
  | { readonly id: number; readonly kind: 'openings'; readonly openings: OpeningsList }
  | { readonly id: number; readonly kind: 'trial'; readonly trial: TrialView }
  | { readonly id: number; readonly kind: 'error'; readonly message: string }

/** A szál globális objektuma (a DOM-típusok mellett a WebWorker-típusok nincsenek betöltve). */
const scope = self as unknown as { onmessage: ((event: MessageEvent<PlanRequest>) => void) | null; postMessage(message: PlanResponse): void }

/** A „Van még hely?” keresés lehetőségei a szálon maradnak (KIT-04). */
const openings = createOpeningsSession()

scope.onmessage = (event) => {
  const msg = event.data
  try {
    if (msg.kind === 'plan') scope.postMessage({ id: msg.id, kind: 'plan', result: plan(msg.input) })
    else if (msg.kind === 'auto') scope.postMessage({ id: msg.id, kind: 'auto', decisions: autoResolveDecisions(msg.input) })
    else if (msg.kind === 'watch') scope.postMessage({ id: msg.id, kind: 'watch', watch: watchWithCapacity(msg.input, msg.base, msg.options) })
    else if (msg.kind === 'openings') scope.postMessage({ id: msg.id, kind: 'openings', openings: openings.find(msg.request) })
    else if (msg.kind === 'trial') scope.postMessage({ id: msg.id, kind: 'trial', trial: openings.trial(msg.token, msg.studentId, msg.key) })
    else scope.postMessage({ id: msg.id, kind: 'issues', issues: plan(msg.input).decisionIssues })
  } catch (error) {
    scope.postMessage({ id: msg.id, kind: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
