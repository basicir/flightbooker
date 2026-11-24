import { findOpenings, trialPlan, type Opening, type StudentOpenings, type TrialResult } from '@core/engine'
import type { PlanInput } from '@core/engine/plan'
import type { PlanResult } from '@core/model/planning'
import type { LectureInfo, StudentProgress } from '@core/progress/lectures'

/**
 * A „Van még hely?” keresés (KIT-01–04) a tervező szálon. A lehetőségek a felvétel utáni teljes
 * bemenetet is hordozzák (`next`), ezért azok a szálon maradnak: a felület csak a megjelenítéshez
 * szükséges részt kapja, és a próbaszámolást a lehetőség kulcsával kéri. Egyszerre a legutóbbi
 * keresés lehetőségei élnek.
 */

export interface OpeningsRequest {
  readonly input: PlanInput
  readonly result: PlanResult
  readonly catalog: Readonly<Record<string, LectureInfo>>
  /** A növendékek haladása (a szál nem éri el a hét adatát). */
  readonly progress: Readonly<Record<string, StudentProgress | undefined>>
  readonly days?: number
  readonly excludeStudents?: readonly string[]
  readonly restoreLocked?: readonly string[]
}

/** A próbaszámolás a terv nélkül (az a szálon marad). */
export type TrialView = Omit<TrialResult, 'result'>

export type OpeningView = Omit<Opening, 'next' | 'trial'> & { readonly trial?: TrialView }

export interface StudentOpeningsView extends Omit<StudentOpenings, 'options'> {
  readonly options: readonly OpeningView[]
}

export interface OpeningsList {
  /** A keresés sorszáma: a próbaszámolás ezzel hivatkozik a lehetőségre. */
  readonly token: number
  readonly students: readonly StudentOpeningsView[]
}

const trialView = ({ result: _result, ...rest }: TrialResult): TrialView => rest

export interface OpeningsSession {
  find(request: OpeningsRequest): OpeningsList
  /** A legutóbbi keresés egy lehetőségének próbaszámolása; régebbi keresésre hibát ad. */
  trial(token: number, studentId: string, key: string): TrialView
}

export function createOpeningsSession(): OpeningsSession {
  let last: { readonly token: number; readonly request: OpeningsRequest; readonly students: readonly StudentOpenings[] } | null = null
  let counter = 0
  return {
    find(request) {
      const students = findOpenings({
        input: request.input,
        result: request.result,
        catalog: request.catalog,
        progressFor: (id) => request.progress[id],
        ...(request.days !== undefined ? { days: request.days } : {}),
        ...(request.excludeStudents ? { excludeStudents: new Set(request.excludeStudents) } : {}),
        ...(request.restoreLocked ? { restoreLocked: new Set(request.restoreLocked) } : {}),
      })
      const token = ++counter
      last = { token, request, students }
      return {
        token,
        students: students.map((s) => ({
          ...s,
          options: s.options.map(({ next: _next, trial, ...rest }) => ({ ...rest, ...(trial ? { trial: trialView(trial) } : {}) })),
        })),
      }
    },
    trial(token, studentId, key) {
      if (!last || last.token !== token) throw new Error('A keresés elavult, a lista újraszámol.')
      const option = last.students.find((s) => s.studentId === studentId)?.options.find((o) => o.key === key)
      if (!option) throw new Error('A lehetőség már nem szerepel a listán.')
      return trialView(option.trial ?? trialPlan({ input: last.request.input, result: last.request.result }, option.next, option.request.id))
    },
  }
}
