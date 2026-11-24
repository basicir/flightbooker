/**
 * Időjárási minimumok (7.4, SZB-16, NOV-06). Mind opcionális: a hiányzó érték nem korlátoz.
 * Az iskolai minimum minden növendékre érvényes; a növendéki limit preferencia.
 * Egységek: szél csomó, látástávolság méter, felhőalap láb, csapadék mm/óra.
 */
export interface WeatherLimits {
  readonly maxWindKt?: number
  readonly maxGustKt?: number
  readonly maxCrosswindKt?: number
  readonly minVisibilityM?: number
  /** Felhőalap (a modell plafonja, profil nélkül a hőmérséklet–harmatpont becslés), láb. */
  readonly minCloudBaseFt?: number
  readonly maxLowCloudCoverPct?: number
  readonly maxPrecipitationMmPerH?: number
  readonly maxPrecipitationProbabilityPct?: number
}

/** Egy óra minősítése (4. fejezet: időjárási ablak). */
export type HourRating = 'flyable' | 'marginal' | 'unflyable'
