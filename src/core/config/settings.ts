import type { z } from 'zod'
import { DEFAULT_FILL_REQUEST_PRIORITY, DEFAULT_REQUEST_PRIORITY, DEFAULT_WEIGHTS, defaultMaintenanceSettings } from './defaults'
import { SETTINGS_FORMAT_VERSION, SettingsSchema, type Settings } from './schema'

/**
 * A beállítási fájl beolvasása és kiírása (ALP-05). Tiszta függvények: a fájlkezelés
 * a főfolyamat configStore-jában van. A formátum verziózott; régebbi fájlt lépésenként
 * migrálunk, újabb verzióval készült fájlt nem írunk felül.
 */

export const SETTINGS_FILE_NAME = 'beallitasok.json'

export type SettingsParseResult =
  | { readonly ok: true; readonly settings: Settings; readonly migratedFrom?: number }
  | { readonly ok: false; readonly errors: readonly string[] }

type RawSettings = Record<string, unknown>

/**
 * Migrációk: a kulcs a forrásverzió, a függvény a következő verzióra alakít.
 * Új verziónál ide kerül egy lépés, és nő a SETTINGS_FORMAT_VERSION.
 */
export const MIGRATIONS: Readonly<Record<number, (raw: RawSettings) => RawSettings>> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
  3: migrateV3toV4,
  4: migrateV4toV5,
  5: migrateV5toV6,
  6: migrateV6toV7,
  7: migrateV7toV8,
  8: migrateV8toV9,
}

/**
 * 1 → 2: a helyi kategóriák helyett a FlightLogger géptípusa (ERF-01); több preferált gép
 * (NOV-04); a repülési idő feladatfüggő, ezért a globális és a növendéki érték megszűnik;
 * a CAPE-limit kikerül. A kategóriára hivatkozó engedélyek elvesznek, mert a kategória és a
 * típus között nincs megfeleltetés – ezeket a Beállításokban kell újra megadni.
 */
function migrateV1toV2(raw: RawSettings): RawSettings {
  const obj = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
  const withoutCape = (limits: unknown): unknown => {
    if (typeof limits !== 'object' || limits === null) return limits
    const { maxCapeJPerKg: _cape, ...rest } = limits as Record<string, unknown>
    return rest
  }
  const isAircraftRef = (ref: unknown): boolean => typeof ref === 'object' && ref !== null && 'aircraftId' in ref
  const { categories: _categories, ...rest } = raw
  const resources = Object.fromEntries(
    Object.entries(obj(raw['resources'])).map(([id, r]) => {
      const { categoryId: _c, ...kept } = obj(r)
      return [id, kept]
    }),
  )
  const students = (Array.isArray(raw['students']) ? raw['students'] : []).map((st: unknown) => {
    const { preferredResource, briefingMinutes: _b, flightMinutes: _f, debriefingMinutes: _d, weatherLimits, allowedResources, ...kept } = obj(st)
    return {
      ...kept,
      allowedResources: (Array.isArray(allowedResources) ? allowedResources : []).filter(isAircraftRef),
      ...(isAircraftRef(preferredResource) ? { preferredResources: [preferredResource] } : {}),
      ...(weatherLimits !== undefined ? { weatherLimits: withoutCape(weatherLimits) } : {}),
    }
  })
  const { flightMinutes: _flight, ...defaults } = obj(raw['defaults'])
  const weather = obj(raw['weather'])
  return {
    ...rest,
    aircraftTypes: {},
    resources,
    students,
    defaults,
    weather: { ...weather, schoolMinima: withoutCape(weather['schoolMinima']) },
  }
}

/**
 * 2 → 3: új súlyozott feltétel, a „Kevesebb motorpróba” (a gép napi első repülése kerülendő),
 * alapból 40%. A meglévő súlyok változatlanok.
 */
function migrateV2toV3(raw: RawSettings): RawSettings {
  const weights = raw['weights']
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) return raw
  return { ...raw, weights: { avoidFirstFlight: 40, ...(weights as Record<string, unknown>) } }
}

/**
 * 3 → 4: új súlyozott feltétel, a „Megfelelő teremméret” (a legkisebb, létszámban épp
 * megfelelő terem), alapból 40%. A meglévő súlyok változatlanok.
 */
function migrateV3toV4(raw: RawSettings): RawSettings {
  const weights = raw['weights']
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) return raw
  return { ...raw, weights: { classroomSize: 40, ...(weights as Record<string, unknown>) } }
}

/**
 * 4 → 5: karbantartás-fajtánkénti túlrepülés és karbantartási hossz (SZB-06). Az alapérték
 * túlrepülés nélküli, így a meglévő tervezés a beállításig nem lesz megengedőbb.
 */
function migrateV4toV5(raw: RawSettings): RawSettings {
  return raw['maintenance'] === undefined ? { ...raw, maintenance: defaultMaintenanceSettings() } : raw
}

/**
 * 5 → 6: új súlyozott feltétel, a „Folyamatos oktatói program” (ne maradjon nagy szünet az
 * oktató napján), az ajánlott súllyal. A meglévő súlyok változatlanok.
 */
function migrateV5toV6(raw: RawSettings): RawSettings {
  const weights = raw['weights']
  if (typeof weights !== 'object' || weights === null || Array.isArray(weights)) return raw
  return { ...raw, weights: { instructorContinuity: DEFAULT_WEIGHTS.instructorContinuity, ...(weights as Record<string, unknown>) } }
}

/** 6 → 7: közös briefing csapatban a csereidő (KBR-12), alapból 10 perc. */
function migrateV6toV7(raw: RawSettings): RawSettings {
  const defaults = raw['defaults']
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return raw
  return { ...raw, defaults: { teamSwapMinutes: 10, ...(defaults as Record<string, unknown>) } }
}

/**
 * 7 → 8: az igény elsőbbsége (ELS-01): a normál igényé alapból 1 (a legfontosabb), a
 * helykitöltésre felvett plusz igényé 3. A meglévő igények elsőbbség nélkül az 1-est kapják,
 * így a terv nem változik.
 */
function migrateV7toV8(raw: RawSettings): RawSettings {
  const defaults = raw['defaults']
  if (typeof defaults !== 'object' || defaults === null || Array.isArray(defaults)) return raw
  return { ...raw, defaults: { requestPriority: DEFAULT_REQUEST_PRIORITY, fillRequestPriority: DEFAULT_FILL_REQUEST_PRIORITY, ...(defaults as Record<string, unknown>) } }
}

/** 8 → 9: a bemutató mód megszűnt, a program mindig a FlightLoggerből dolgozik; az adatforrás mező kikerül. */
function migrateV8toV9(raw: RawSettings): RawSettings {
  const { dataSource: _removed, ...rest } = raw
  return rest
}

export function formatIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = issue.path.map(String).join('.')
    return path ? `${path}: ${issue.message}` : issue.message
  })
}

export function migrateRaw(
  raw: RawSettings,
  migrations: Readonly<Record<number, (raw: RawSettings) => RawSettings>> = MIGRATIONS,
  target: number = SETTINGS_FORMAT_VERSION,
): { raw: RawSettings; from: number } | { error: string } {
  const version = raw['formatVersion']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return { error: 'Hiányzik vagy érvénytelen a formatVersion mező.' }
  }
  if (version > target) {
    return {
      error: `A fájl a program egy újabb verziójával készült (${version}. formátum, ez a program a ${target}.-at ismeri). Frissítsd a programot.`,
    }
  }
  let current = raw
  for (let v = version; v < target; v++) {
    const step = migrations[v]
    if (!step) return { error: `Nincs migráció a ${v}. formátumról.` }
    current = { ...step(current), formatVersion: v + 1 }
  }
  return { raw: current, from: version }
}

export function parseSettings(value: unknown): SettingsParseResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, errors: ['A beállítási fájl tartalma nem JSON-objektum.'] }
  }
  const migrated = migrateRaw(value as RawSettings)
  if ('error' in migrated) return { ok: false, errors: [migrated.error] }
  const result = SettingsSchema.safeParse(migrated.raw)
  if (!result.success) return { ok: false, errors: formatIssues(result.error.issues) }
  return migrated.from === SETTINGS_FORMAT_VERSION
    ? { ok: true, settings: result.data }
    : { ok: true, settings: result.data, migratedFrom: migrated.from }
}

export function parseSettingsJson(text: string): SettingsParseResult {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`A beállítási fájl nem érvényes JSON: ${(error as Error).message}`] }
  }
  return parseSettings(value)
}

/** Embernek olvasható kiírás: 2 szóközös behúzás, záró sortörés. Érvénytelen beállítást nem ír ki. */
export function serializeSettings(settings: Settings): string {
  const result = SettingsSchema.safeParse(settings)
  if (!result.success) {
    throw new Error(`A beállítás érvénytelen, nem menthető:\n${formatIssues(result.error.issues).join('\n')}`)
  }
  return `${JSON.stringify(result.data, null, 2)}\n`
}
