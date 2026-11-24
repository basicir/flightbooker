import type { TrainingPhase } from '../config/trainingManual'
import type { WeatherLimits } from './weather'

/**
 * Oktató és növendék (4. fejezet). Helyben csak azonosító és preferencia tárolódik
 * (3.3); a nevet a FlightLoggerből olvassuk, és csak memóriában tartjuk.
 */

export type TaskSelectionMode = 'automatic' | 'manual' | 'none'

/**
 * Hivatkozás engedélyezett vagy preferált gépre: egyedi gép vagy géptípus (NOV-03, NOV-04).
 * A géptípus a FlightLogger `model` mezője (például „PIPER P28A”), nem helyi kategória.
 */
export type ResourceRef = { readonly aircraftType: string } | { readonly aircraftId: string }

export interface StudentSettings {
  /** FlightLogger felhasználó-azonosító. */
  readonly userId: string
  /** Mely gépekkel repülhet (NOV-03). Üres lista = egyikkel sem. */
  readonly allowedResources: readonly ResourceRef[]
  /** Preferált gépek vagy géptípusok (NOV-04); több is lehet. */
  readonly preferredResources?: readonly ResourceRef[]
  /** Napon belüli sorrend, kisebb = korábban (NOV-05). */
  readonly dayOrder?: number
  /** Foglalási prioritás 1–5 (NOV-12). */
  readonly priority?: number
  /** „Régen repült” küszöb napban (NOV-08). */
  readonly longNoFlyDays?: number
  /** Növendéki időjárási limit: preferencia, csak pontoz (NOV-06, K15). */
  readonly weatherLimits?: WeatherLimits
  readonly taskSelectionMode?: TaskSelectionMode
  /** Kézzel választott feladatsor (program és revízió); hiányában a felismert (SZB-02). */
  readonly syllabusId?: string
  /** Képzési fázis a fázisfüggő napi blokkidő-limithez (TM II.6.4). */
  readonly trainingPhase?: TrainingPhase
}

export interface EffectiveStudent {
  readonly userId: string
  readonly allowedResources: readonly ResourceRef[]
  readonly preferredResources: readonly ResourceRef[]
  readonly dayOrder: number | undefined
  readonly priority: number
  readonly longNoFlyDays: number
  readonly weatherLimits: WeatherLimits
  readonly taskSelectionMode: TaskSelectionMode
}
