import { z } from 'zod'
import { CRITERIA } from '../model/criteria'
import { MAINTENANCE_TYPES } from '../model/resources'
import { WEEKDAYS, localTimeToMinutes } from '../model/time'

/**
 * A beállítási fájl sémája (ALP-05, SZB-11). Embernek olvasható, verziózott JSON.
 * Minden objektum szigorú: ismeretlen mezőt nem fogad el, így például API-kulcs
 * sem kerülhet a fájlba (ALP-06).
 */

z.config(z.locales.hu())

export const SETTINGS_FORMAT_VERSION = 9

const id = z.string().min(1).max(200)
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, { error: 'ÓÓ:PP alakú idő kell, például 07:30' })
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { error: 'ÉÉÉÉ-HH-NN alakú dátum kell' })
const isoDateTime = z.iso.datetime({ offset: true, error: 'ISO 8601 időpont kell, például 2026-11-12T08:00:00Z' })
const minutes = z.int().min(0).max(24 * 60)
const percent = z.number().min(0).max(100)
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, { error: '#RRGGBB alakú szín kell, például #26A69A' })

/** A FlightLogger-foglalástípusok, amelyekhez szín adható (FLI-12). */
export const FL_COLOR_TYPES = ['singleStudent', 'multiStudent', 'groundTraining', 'extraTheory', 'meeting'] as const
export type FlColorType = (typeof FL_COLOR_TYPES)[number]

/** Az ablak sorrendjét csak érvényes időkre nézzük; a hibás formátumot a regex jelzi. */
function endsAfterStart(start: string, end: string): boolean {
  try {
    return localTimeToMinutes(end) > localTimeToMinutes(start)
  } catch {
    return true
  }
}

const dailyWindow = z
  .strictObject({ start: localTime, end: localTime })
  .refine((w) => endsAfterStart(w.start, w.end), { error: 'A vége a kezdete után legyen.' })

const weeklyWindows = z.strictObject(
  Object.fromEntries(WEEKDAYS.map((d) => [d, dailyWindow.nullable()])) as Record<
    (typeof WEEKDAYS)[number],
    z.ZodNullable<typeof dailyWindow>
  >,
)

export const WeatherLimitsSchema = z.strictObject({
  maxWindKt: z.number().min(0).max(100).optional(),
  maxGustKt: z.number().min(0).max(100).optional(),
  maxCrosswindKt: z.number().min(0).max(100).optional(),
  minVisibilityM: z.number().min(0).max(100_000).optional(),
  minCloudBaseFt: z.number().min(0).max(20_000).optional(),
  maxLowCloudCoverPct: percent.optional(),
  maxPrecipitationMmPerH: z.number().min(0).max(100).optional(),
  maxPrecipitationProbabilityPct: percent.optional(),
})

const runway = z.strictObject({
  /** Például „04” vagy „22L”. */
  designator: z.string().regex(/^(0[1-9]|[12]\d|3[0-6])[LCR]?$/, { error: 'Pályajel 01 és 36 között, például 04 vagy 22L' }),
  /** Valós (földrajzi) irány fokban; az Open-Meteo szélirány is valós. */
  trueHeadingDeg: z.number().min(0).lt(360),
})

const airport = z.strictObject({
  icaoCode: z.string().regex(/^[A-Z]{4}$/, { error: 'Négybetűs ICAO-kód kell' }),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1),
  runways: z.array(runway).min(1, { error: 'Legalább egy pályairány kell az oldalszélhez.' }),
  /** Nyitvatartás naponként (ERF-09). */
  openingHours: weeklyWindows,
})

const blockedPeriod = z.discriminatedUnion('kind', [
  z
    .strictObject({ id, kind: z.literal('once'), start: isoDateTime, end: isoDateTime, note: z.string().max(500).optional() })
    .refine((p) => Date.parse(p.end) > Date.parse(p.start), { error: 'A tiltott időszak vége a kezdete után legyen.' }),
  z
    .strictObject({
      id,
      kind: z.literal('weekly'),
      weekday: z.enum(WEEKDAYS),
      start: localTime,
      end: localTime,
      validFrom: localDate.optional(),
      validTo: localDate.optional(),
      note: z.string().max(500).optional(),
    })
    .refine((p) => endsAfterStart(p.start, p.end), { error: 'A vége a kezdete után legyen.' }),
])

/** Géptípus: a FlightLogger `model` mezője (ERF-01). */
const aircraftType = z.string().min(1).max(100)
const resourceRef = z.union([z.strictObject({ aircraftType }), z.strictObject({ aircraftId: id })])
const taskSelectionMode = z.enum(['automatic', 'manual', 'none'])

const aircraftTypeSettings = z.strictObject({
  engineRunUpMinutes: minutes.optional(),
})

const resourceSettings = z.strictObject({
  kind: z.enum(['aircraft', 'simulator']),
  engineRunUpMinutes: minutes.optional(),
  turnaroundMinutes: minutes.optional(),
  minReserveHours: z.number().min(-100).max(1000).optional(),
})

const maintenanceType = z.literal(MAINTENANCE_TYPES)

const aircraftHoursEntry = z.strictObject({
  date: localDate,
  hoursUntilMaintenance: z.number().min(-100).max(10_000),
  maintenanceType: maintenanceType.optional(),
  enteredAt: isoDateTime,
})

const maintenanceTypeSettings = z.strictObject({
  overflyHours: z.number().min(0).max(100),
  durationHours: z.number().min(0).max(24 * 60),
})

const classroomSettings = z.strictObject({
  capacity: z.int().min(1).max(1000),
  preferenceRank: z.int().min(1).max(10),
})

const student = z.strictObject({
  userId: id,
  allowedResources: z.array(resourceRef),
  preferredResources: z.array(resourceRef).optional(),
  dayOrder: z.int().min(0).max(1000).optional(),
  priority: z.int().min(1).max(5).optional(),
  longNoFlyDays: z.int().min(1).max(365).optional(),
  weatherLimits: WeatherLimitsSchema.optional(),
  taskSelectionMode: taskSelectionMode.optional(),
  /** Kézzel választott feladatsor (program és revízió); hiányában a felismert (SZB-02). */
  syllabusId: z.string().min(1).max(400).optional(),
  /** Képzési fázis a fázisfüggő napi blokkidő-limithez (TM II.6.4). */
  trainingPhase: z.enum(['1-2', '3-4', '5', '6']).optional(),
})

const limitWindow = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('calendarDay') }),
  z.strictObject({ kind: z.literal('calendarWeek') }),
  z.strictObject({ kind: z.literal('calendarYear') }),
  z.strictObject({ kind: z.literal('rollingDays'), days: z.int().min(1).max(400) }),
  z.strictObject({ kind: z.literal('rollingCalendarMonths'), months: z.int().min(1).max(24) }),
  z.strictObject({ kind: z.literal('betweenDuties') }),
])

const limitRule = z.strictObject({
  id,
  subject: z.enum(['instructor', 'student']),
  metric: z.enum(['flightTime', 'dutyTime', 'restTime', 'taskCount']),
  window: limitWindow,
  limit: z.number().min(0).max(10_000),
  restAtLeastPreviousDuty: z.boolean().optional(),
  severity: z.enum(['warning', 'blocking']),
  warnAtPercent: percent,
  includeSimulator: z.boolean(),
  source: z.string().max(500),
  enabled: z.boolean(),
})

const manualFlightTime = z.strictObject({
  id,
  date: localDate,
  minutes: z.int().min(0).max(24 * 60),
  simulator: z.boolean(),
  note: z.string().max(500).optional(),
})

const weights = z.strictObject(
  Object.fromEntries(CRITERIA.map((c) => [c, percent])) as Record<(typeof CRITERIA)[number], typeof percent>,
)

export const SettingsSchema = z
  .strictObject({
    formatVersion: z.literal(SETTINGS_FORMAT_VERSION),
    /** Első beállításig üres (10. fejezet: Első beállítás). */
    airport: airport.nullable(),
    instructor: z.strictObject({
      /** Heti munkaidő-ablak (SZB-13). */
      workWindows: weeklyWindows,
      /** Tiltott időszakok (SZB-14, K35). */
      blockedPeriods: z.array(blockedPeriod),
    }),
    planning: z.strictObject({
      taskSelectionMode,
      /** Dilemma-küszöb súlyozott egységben (9.1). */
      dilemmaThreshold: z.number().min(0).max(100),
      /** Minimális osztályrészvétel százalékban (SZB-09, K22). */
      minClassAttendancePct: percent,
    }),
    weights,
    defaults: z.strictObject({
      engineRunUpMinutes: minutes,
      /** Feladat nélküli igény briefingje; feladatnál a Lecture adja (SZB-02). */
      briefingMinutes: minutes,
      debriefingMinutes: minutes,
      turnaroundMinutes: minutes,
      /**
       * Közös briefing csapatban a csere (KBR-12): a páron belül a két növendék között, és a
       * másik gépre váltó egységek között. Azonos gépen a fordulóidő is kitelik.
       */
      teamSwapMinutes: minutes,
      minReserveHours: z.number().min(-100).max(1000),
      longNoFlyDays: z.int().min(1).max(365),
      /** A növendék foglalási prioritása (NOV-12): 5 a legfontosabb; súlyként hat. */
      studentPriority: z.int().min(1).max(5),
      /** Az igény elsőbbsége (ELS-01): 1 a legfontosabb; szabályként hat (ELS-02). */
      requestPriority: z.int().min(1).max(5),
      /** A helykitöltésre felvett plusz igény elsőbbsége (ELS-01, KIT-05). */
      fillRequestPriority: z.int().min(1).max(5),
    }),
    weather: z.strictObject({
      /** Iskolai minimum: a rossz idő globális küszöbe (SZB-16). */
      schoolMinima: WeatherLimitsSchema,
      minimaSource: z.string().max(500),
    }),
    /** Géptípusonkénti beállítások, a kulcs a FlightLogger `model` mezője. */
    aircraftTypes: z.record(aircraftType, aircraftTypeSettings),
    resources: z.record(id, resourceSettings),
    aircraftHours: z.record(id, aircraftHoursEntry),
    /**
     * Karbantartás-fajtánként a túlrepülhető idő és a karbantartás hossza (SZB-06). A
     * biztonsági puffer a `defaults.minReserveHours` (gépenként felülírható).
     */
    maintenance: z.strictObject({ 25: maintenanceTypeSettings, 50: maintenanceTypeSettings, 100: maintenanceTypeSettings, 200: maintenanceTypeSettings }),
    classrooms: z.record(id, classroomSettings),
    students: z.array(student),
    limits: z.strictObject({
      rules: z.array(limitRule),
      manualFlightTime: z.array(manualFlightTime),
    }),
    /**
     * A gépek megjelenítési sorrendje (azonosítók). A FlightLogger API nem adja ki a foglalási
     * oldal kézi sorrendjét, ezért itt állítható be; hiányában típus, majd lajstrom szerint.
     */
    aircraftOrder: z.array(id).max(1000).optional(),
    /**
     * FlightLogger-import (5.10): a létrehozott foglalás kitöltőszíne típusonként (FLI-12). Hiányzó
     * típusnál nincs szín: a FlightLogger alapja marad.
     */
    flImport: z
      .strictObject({
        colors: z.strictObject(
          Object.fromEntries(FL_COLOR_TYPES.map((k) => [k, hexColor.optional()])) as Record<(typeof FL_COLOR_TYPES)[number], z.ZodOptional<typeof hexColor>>,
        ),
      })
      .optional(),
    /** A legutóbb látott gépek és termek listája a változásjelzéshez (ADT-06). */
    lastSeen: z
      .strictObject({ at: isoDateTime, aircraftIds: z.array(id), classroomIds: z.array(id) })
      .nullable(),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string): void => {
      ctx.addIssue({ code: 'custom', path, message })
    }
    duplicates(s.students.map((st) => st.userId)).forEach((dup) => issue(['students'], `Ismétlődő növendék: ${dup}`))
    duplicates(s.limits.rules.map((r) => r.id)).forEach((dup) => issue(['limits', 'rules'], `Ismétlődő szabály-azonosító: ${dup}`))
    s.limits.rules.forEach((r, i) => {
      if ((r.metric === 'restTime') !== (r.window.kind === 'betweenDuties')) {
        issue(['limits', 'rules', i], 'A pihenőidő-szabály ablaka „betweenDuties”, más szabályé nem lehet az.')
      }
    })
  })

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const dups = new Set<string>()
  for (const v of values) (seen.has(v) ? dups : seen).add(v)
  return [...dups]
}

export type Settings = z.infer<typeof SettingsSchema>
/** Tiltott időszak (SZB-14, K35). */
export type BlockedPeriod = Settings['instructor']['blockedPeriods'][number]
