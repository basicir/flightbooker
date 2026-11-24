/**
 * Limit-szabály (8.2, LIM-05): alany, mérőszám, időablak, határérték, súlyosság, forrás.
 * A számokat az iskola kézikönyvéből kell venni; az alapértékek csak minták.
 */

export type LimitSubject = 'instructor' | 'student'
export type LimitMetric = 'flightTime' | 'dutyTime' | 'restTime' | 'taskCount'

export type LimitWindow =
  | { readonly kind: 'calendarDay' }
  | { readonly kind: 'calendarWeek' }
  | { readonly kind: 'calendarYear' }
  | { readonly kind: 'rollingDays'; readonly days: number }
  | { readonly kind: 'rollingCalendarMonths'; readonly months: number }
  /** Pihenőidő két szolgálat (oktató) vagy két repülési nap (növendék) között. */
  | { readonly kind: 'betweenDuties' }

/** `warning`: túllépés csak dilemmaként, jóváhagyással (7.2, 8.4). */
export type LimitSeverity = 'warning' | 'blocking'

export interface LimitRule {
  readonly id: string
  readonly subject: LimitSubject
  readonly metric: LimitMetric
  readonly window: LimitWindow
  /** Órában (idő-mérőszámoknál) vagy darabban (`taskCount`). Pihenőnél a minimum. */
  readonly limit: number
  /** Pihenőidő: legalább az előző szolgálat hossza (ORO.FTL.235 minta). */
  readonly restAtLeastPreviousDuty?: boolean
  readonly severity: LimitSeverity
  /** Közelítés jelzése a limit hány százalékánál (8.4), alapból 80. */
  readonly warnAtPercent: number
  /** Beleszámít-e a szimulátoridő (8.3). */
  readonly includeSimulator: boolean
  readonly source: string
  readonly enabled: boolean
}

/**
 * Kézi korrekció a limitekhez (8.3, K37): más munkahelyen vagy az API által nem látott
 * időszakban repült idő. Iskolai kulccsal a myFlightLogger nem kérdezhető.
 */
export interface ManualFlightTimeEntry {
  readonly id: string
  /** A nap, amelyre az időt el kell számolni. */
  readonly date: string
  readonly minutes: number
  readonly simulator: boolean
  readonly note?: string
}
