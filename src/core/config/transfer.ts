import { SettingsSchema, type Settings } from './schema'
import { formatIssues, migrateRaw } from './settings'

/**
 * A beállítások exportja és importja (például másik gépre vagy egy kolléga alapbeállításának
 * átvételéhez). Tiszta függvények: a fájlválasztás és -írás a főfolyamatban van.
 *
 * A fájl egy borítékban a beállítási fájl tartalma. Mindig kimarad belőle, ami ehhez a
 * géphez tartozik, nem a beállításhoz:
 *  - `lastSeen`: a gép- és teremlista-változás jelzésének viszonyítási alapja (ADT-06);
 *  - `aircraftHours`: a napi kirepülhető óraállás, amely gyorsan elavul.
 * A növendékek (csak FlightLogger-azonosító és beállítás, név nem) választhatóan kerülnek bele.
 * Az API-kulcs a titoktárolóban van, a beállítások között nem, így az exportba sem kerülhet (ALP-06).
 */

export const SETTINGS_EXPORT_KIND = 'foglalastervezo-beallitasok'
export const SETTINGS_EXPORT_VERSION = 1

/** Az exportból mindig kimaradó, ehhez a géphez tartozó mezők. */
const MACHINE_KEYS = ['lastSeen', 'aircraftHours'] as const

export interface SettingsExportOptions {
  readonly includeStudents: boolean
  readonly exportedAt: string
  readonly appVersion: string
}

/** Az export fájl tartalma (embernek olvasható JSON). Érvénytelen beállítást nem exportál. */
export function buildSettingsExport(settings: Settings, options: SettingsExportOptions): string {
  const valid = SettingsSchema.safeParse(settings)
  if (!valid.success) throw new Error(`A beállítás érvénytelen, nem exportálható:\n${formatIssues(valid.error.issues).join('\n')}`)
  const { lastSeen: _l, aircraftHours: _h, students, ...rest } = valid.data
  const body = options.includeStudents ? { ...rest, students } : rest
  const envelope = {
    kind: SETTINGS_EXPORT_KIND,
    exportVersion: SETTINGS_EXPORT_VERSION,
    exportedAt: options.exportedAt,
    appVersion: options.appVersion,
    includesStudents: options.includeStudents,
    settings: body,
  }
  return `${JSON.stringify(envelope, null, 2)}\n`
}

/** Javasolt fájlnév: `foglalastervezo-beallitasok-2026-11-12[-novendekekkel].json`. */
export function settingsExportFileName(date: string, includeStudents: boolean): string {
  return `${SETTINGS_EXPORT_KIND}-${date}${includeStudents ? '-novendekekkel' : ''}.json`
}

/** A beolvasott fájl, még alkalmazás előtt (a felület ebből kérdez rá a növendékekre). */
export type SettingsImportFile =
  | {
      readonly ok: true
      /** A fájl beállításai a mostani formátumra migrálva; a kimaradt mezők nélkül. */
      readonly raw: Readonly<Record<string, unknown>>
      readonly includesStudents: boolean
      readonly studentCount: number
      readonly exportedAt?: string
      readonly migratedFrom?: number
    }
  | { readonly ok: false; readonly errors: readonly string[] }

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Az import fájl beolvasása. Elfogadja az exportot és a nyers beállítási fájlt
 * (`beallitasok.json`) is; régebbi formátumot a szokásos migrációkkal hoz a mostanira.
 */
export function readSettingsImport(text: string): SettingsImportFile {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`A fájl nem érvényes JSON: ${(error as Error).message}`] }
  }
  if (!isObject(value)) return { ok: false, errors: ['A fájl tartalma nem JSON-objektum.'] }

  let body: Record<string, unknown>
  let includesStudents: boolean
  let exportedAt: string | undefined
  if (value['kind'] === SETTINGS_EXPORT_KIND) {
    const version = value['exportVersion']
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { ok: false, errors: ['Hiányzik vagy érvénytelen az exportVersion mező.'] }
    if (version > SETTINGS_EXPORT_VERSION) return { ok: false, errors: ['A fájl a program egy újabb verziójával készült. Frissítsd a programot.'] }
    if (!isObject(value['settings'])) return { ok: false, errors: ['A fájlban nincs beállítás.'] }
    body = value['settings']
    includesStudents = value['includesStudents'] === true && Array.isArray(body['students'])
    exportedAt = typeof value['exportedAt'] === 'string' ? value['exportedAt'] : undefined
  } else if ('formatVersion' in value) {
    // Nyers beállítási fájl: mindent tartalmaz, a növendékeket is.
    body = value
    includesStudents = Array.isArray(value['students'])
  } else {
    return { ok: false, errors: ['Ez nem a Foglalástervező beállítási vagy export fájlja.'] }
  }

  // A kimaradt mezők helyére semleges érték kerül, hogy a migráció és az ellenőrzés lefusson;
  // alkalmazáskor ezek a mostani beállításból jönnek.
  const filled = { lastSeen: null, aircraftHours: {}, ...body, students: includesStudents ? body['students'] : [] }
  const migrated = migrateRaw(filled)
  if ('error' in migrated) return { ok: false, errors: [migrated.error] }
  const parsed = SettingsSchema.safeParse(migrated.raw)
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error.issues) }

  const raw: Record<string, unknown> = { ...parsed.data }
  for (const key of MACHINE_KEYS) delete raw[key]
  if (!includesStudents) delete raw['students']
  return {
    ok: true,
    raw,
    includesStudents,
    studentCount: includesStudents ? parsed.data.students.length : 0,
    ...(exportedAt ? { exportedAt } : {}),
    ...(migrated.from !== parsed.data.formatVersion ? { migratedFrom: migrated.from } : {}),
  }
}

/**
 * Az import alkalmazása a mostani beállításra: a fájl értékei felülírják a mostaniakat, a
 * gépre tartozó mezők maradnak, a növendékek csak kérésre (és csak ha a fájlban vannak) cserélődnek.
 */
export function applySettingsImport(current: Settings, file: Extract<SettingsImportFile, { ok: true }>, options: { readonly importStudents: boolean }): Settings {
  const takeStudents = options.importStudents && file.includesStudents
  const next = {
    ...file.raw,
    lastSeen: current.lastSeen,
    aircraftHours: current.aircraftHours,
    students: takeStudents ? file.raw['students'] : current.students,
  }
  // A fájl már ellenőrzött; a mostani beállítás részei is azok, így ez nem bukhat el.
  return SettingsSchema.parse(next)
}
