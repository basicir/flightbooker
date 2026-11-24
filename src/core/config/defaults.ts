import type { LimitRule } from '../model/limits'
import { TM_REF } from './trainingManual'
import { SETTINGS_FORMAT_VERSION, type Settings } from './schema'

/**
 * Ajánlott alapértékek (7.3 súlyok, 8.2 limitek, 10. fejezet táblázata).
 * A 20 perc és a 2 óra a csapattól származik, a többi kiinduló javaslat, amelyet az
 * oktató az első beállításkor ellenőriz.
 */

export const DEFAULT_WEIGHTS: Settings['weights'] = {
  weatherFlight: 90,
  longNoFly: 80,
  scarcity: 70,
  badWeatherFit: 70,
  priority: 65,
  planStability: 50,
  aircraftReserve: 50,
  avoidFirstFlight: 40,
  preferredAircraft: 35,
  dayOrder: 30,
  instructorLoad: 30,
  instructorContinuity: 30,
  preferredClassroom: 20,
  classroomSize: 40,
}

const OM = 'ORO.FTL minta – a TM (II.6.3) az Operations Manualhoz utal, annak értékével írd felül'
const TM_DUTY = `${TM_REF}, II.6.4`

const rule = (r: Omit<LimitRule, 'severity' | 'warnAtPercent' | 'enabled'> & Partial<LimitRule>): LimitRule => ({
  severity: 'warning',
  warnAtPercent: 80,
  enabled: true,
  ...r,
})

/**
 * 8.2: limit-szabályok. A növendékieket a Training Manual (Rev 8, II.6.4) adja; a
 * „24 egymást követő óra” ablakot naptári nappal közelítjük. A fázisfüggő napi blokkidő a
 * növendéknél állítható (lásd `phaseLimitRule`). Az oktatói értékek ORO.FTL-minták.
 */
export const DEFAULT_LIMIT_RULES: readonly LimitRule[] = [
  rule({ id: 'novendek-blokk-nap', subject: 'student', metric: 'flightTime', window: { kind: 'calendarDay' }, limit: 4, includeSimulator: false, source: `${TM_DUTY} – 24 egymást követő óra` }),
  rule({ id: 'novendek-blokk-ev', subject: 'student', metric: 'flightTime', window: { kind: 'calendarYear' }, limit: 900, includeSimulator: false, source: TM_DUTY }),
  rule({ id: 'novendek-feladat-nap', subject: 'student', metric: 'taskCount', window: { kind: 'calendarDay' }, limit: 2, includeSimulator: true, source: `${TM_DUTY} – 1–4. fázis` }),
  rule({ id: 'novendek-szolgalat-nap', subject: 'student', metric: 'dutyTime', window: { kind: 'calendarDay' }, limit: 12, includeSimulator: true, source: `${TM_DUTY} – 24 egymást követő óra` }),
  rule({ id: 'novendek-szolgalat-30nap', subject: 'student', metric: 'dutyTime', window: { kind: 'rollingDays', days: 30 }, limit: 210, includeSimulator: true, source: TM_DUTY }),
  rule({ id: 'novendek-szolgalat-ev', subject: 'student', metric: 'dutyTime', window: { kind: 'calendarYear' }, limit: 2000, includeSimulator: true, source: TM_DUTY }),
  rule({ id: 'novendek-piheno', subject: 'student', metric: 'restTime', window: { kind: 'betweenDuties' }, limit: 10, includeSimulator: false, source: `${TM_DUTY} – 24 egymást követő órán belül` }),
  rule({ id: 'oktato-repult-nap', subject: 'instructor', metric: 'flightTime', window: { kind: 'calendarDay' }, limit: 8, includeSimulator: false, source: 'Javaslat – az Operations Manual értékével írd felül' }),
  rule({ id: 'oktato-repult-28nap', subject: 'instructor', metric: 'flightTime', window: { kind: 'rollingDays', days: 28 }, limit: 100, includeSimulator: false, source: OM }),
  rule({ id: 'oktato-repult-ev', subject: 'instructor', metric: 'flightTime', window: { kind: 'calendarYear' }, limit: 900, includeSimulator: false, source: OM }),
  rule({ id: 'oktato-repult-12honap', subject: 'instructor', metric: 'flightTime', window: { kind: 'rollingCalendarMonths', months: 12 }, limit: 1000, includeSimulator: false, source: OM }),
  rule({ id: 'oktato-szolgalat-7nap', subject: 'instructor', metric: 'dutyTime', window: { kind: 'rollingDays', days: 7 }, limit: 60, includeSimulator: true, source: OM }),
  rule({ id: 'oktato-szolgalat-14nap', subject: 'instructor', metric: 'dutyTime', window: { kind: 'rollingDays', days: 14 }, limit: 110, includeSimulator: true, source: OM }),
  rule({ id: 'oktato-szolgalat-28nap', subject: 'instructor', metric: 'dutyTime', window: { kind: 'rollingDays', days: 28 }, limit: 190, includeSimulator: true, source: OM }),
  rule({ id: 'oktato-piheno', subject: 'instructor', metric: 'restTime', window: { kind: 'betweenDuties' }, limit: 12, restAtLeastPreviousDuty: true, includeSimulator: true, source: 'ORO.FTL.235 minta – az Operations Manual értékével írd felül' }),
]

/** A limit-szabályok alapértékei új példányként (a beállítás ne ossza meg a konstanst). */
export function defaultLimitRules(): LimitRule[] {
  return DEFAULT_LIMIT_RULES.map((r) => ({ ...r, window: { ...r.window } }))
}

/**
 * Iskolai időjárási minimum (SZB-16): a TM II.6.2 legenyhébb, valódi géppel végzett sora
 * (további VFR kettős / SPIC helyi gyakorlat). A „H-wind” a szél és a széllökés felső határa.
 * A felhőalap és a csapadék nem a TM-ből jön (a TM felhőtávolságot ír elő), csak javaslat.
 */
export const DEFAULT_SCHOOL_MINIMA: Settings['weather']['schoolMinima'] = {
  maxWindKt: 30,
  maxGustKt: 30,
  maxCrosswindKt: 17,
  minVisibilityM: 5000,
  minCloudBaseFt: 1500,
  maxPrecipitationMmPerH: 2,
}

export const DEFAULT_MINIMA_SOURCE = `${TM_REF}, II.6.2 – további VFR kettős / SPIC helyi gyakorlat; a felhőalap és a csapadék javaslat`

/**
 * Karbantartás-fajtánkénti alapértékek (SZB-06): túlrepülés nélkül, 24 órás karbantartással.
 * A túlrepülhető időt az iskola gyakorlata szerint a Beállításokban kell megadni.
 */
export function defaultMaintenanceSettings(): Settings['maintenance'] {
  const type = { overflyHours: 0, durationHours: 24 }
  return { 25: { ...type }, 50: { ...type }, 100: { ...type }, 200: { ...type } }
}

/** Az igény alapértelmezett elsőbbsége (ELS-01): a legfontosabb. */
export const DEFAULT_REQUEST_PRIORITY = 1
/** A helykitöltésre felvett plusz igény elsőbbsége (ELS-01, KIT-05). */
export const DEFAULT_FILL_REQUEST_PRIORITY = 3

const workday = { start: '08:00', end: '18:00' } as const
const openDay = { start: '07:00', end: '19:00' } as const

export function createDefaultSettings(): Settings {
  return {
    formatVersion: SETTINGS_FORMAT_VERSION,
    dataSource: 'live',
    airport: null,
    instructor: {
      workWindows: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: null, sun: null },
      blockedPeriods: [],
    },
    planning: {
      taskSelectionMode: 'automatic',
      dilemmaThreshold: 10,
      minClassAttendancePct: 90,
    },
    weights: { ...DEFAULT_WEIGHTS },
    defaults: {
      engineRunUpMinutes: 20,
      briefingMinutes: 45,
      debriefingMinutes: 30,
      turnaroundMinutes: 15,
      teamSwapMinutes: 10,
      minReserveHours: 2,
      longNoFlyDays: 14,
      studentPriority: 3,
      requestPriority: DEFAULT_REQUEST_PRIORITY,
      fillRequestPriority: DEFAULT_FILL_REQUEST_PRIORITY,
    },
    weather: {
      schoolMinima: { ...DEFAULT_SCHOOL_MINIMA },
      minimaSource: DEFAULT_MINIMA_SOURCE,
    },
    aircraftTypes: {},
    resources: {},
    aircraftHours: {},
    maintenance: defaultMaintenanceSettings(),
    classrooms: {},
    students: [],
    limits: { rules: defaultLimitRules(), manualFlightTime: [] },
    lastSeen: null,
  }
}

/** Az alapértelmezett repülőtér-nyitvatartás az első beállítás űrlapjához. */
export const DEFAULT_OPENING_HOURS: NonNullable<Settings['airport']>['openingHours'] = {
  mon: openDay,
  tue: openDay,
  wed: openDay,
  thu: openDay,
  fri: openDay,
  sat: openDay,
  sun: openDay,
}
