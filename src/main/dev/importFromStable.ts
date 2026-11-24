import { cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Settings } from '../../core/config/schema'
import { parseSettingsJson, SETTINGS_FILE_NAME } from '../../core/config/settings'
import type { StableImportSummary } from '../../shared/api'
import { CACHE_DIR_NAME } from '../dataCache'
import { SKILL_FILE_NAME } from '../skillStore'

/**
 * A fő változat (Foglalástervező) adatainak átvétele a fejlesztői változatba (FRS-10), hogy a DEV
 * ugyanazzal a beállítással legyen kipróbálható. A DEV saját adatait felülírja; a fő változatéhoz
 * nem nyúl (csak olvassa).
 *
 * Átjön: a beállítás (a növendékekkel), a mentett heti tervek, a saját feladatsorok és a
 * modellpontosság mérése. Nem jön át: az API-kulcs (a fő változat titoktárolójában van, és a
 * kulcsot mindig a felhasználó írja be – ALP-06), a gyorsítótár (a DEV-é törlődik, a következő
 * frissítés újratölti) és a gépenkénti frissítési beállítás.
 *
 * Két úton fut: a DEV első indításakor magától, ha a DEV-nek még nincs beállítása (ilyenkor nincs
 * mit felülírni), illetve kézzel, a Beállítások → Frissítés vagy az első beállítás gombjával.
 */

/** A mappák, amelyek egészükben átjönnek: heti tervek és saját feladatsorok. */
export const COPIED_DIRS = { plans: 'tervek', syllabi: 'feladatsorok' } as const

/** A fő változat beállítása, a mostani formátumra hozva és ellenőrizve. */
export async function readStableSettings(stableDir: string): Promise<Settings> {
  let text: string
  try {
    text = await readFile(join(stableDir, SETTINGS_FILE_NAME), 'utf8')
  } catch {
    throw new Error('A Foglalástervező beállítása nem található ezen a gépen (még nincs beállítva, vagy más felhasználóval fut).')
  }
  const parsed = parseSettingsJson(text)
  if (!parsed.ok) throw new Error(`A Foglalástervező beállítási fájlja nem olvasható:\n${parsed.errors.join('\n')}`)
  return parsed.settings
}

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  )

async function countJsonFiles(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true }).catch(() => [] as string[])
  return entries.filter((name) => name.endsWith('.json')).length
}

/** A DEV beállítási tárolója annyiban, amennyi az átvételhez kell (configStoreCore). */
export interface SettingsTarget {
  load(): Promise<{ readonly status: string }>
  save(settings: Settings): Promise<void>
}

async function apply(settings: Settings, stableDir: string, devDir: string, target: SettingsTarget): Promise<StableImportSummary> {
  const copied = await copyStableData(stableDir, devDir)
  await target.save(settings)
  return { ...copied, students: settings.students.length }
}

/** Kézi átvétel: előbb a beállítás ellenőrzése (ha hiányzik vagy hibás, semmi nem íródik felül). */
export async function importFromStable(stableDir: string, devDir: string, target: SettingsTarget): Promise<StableImportSummary> {
  return apply(await readStableSettings(stableDir), stableDir, devDir, target)
}

/**
 * Első DEV-indításkor: ha a DEV-nek még nincs beállítása, és a fő változatnak van érvényes, magától
 * átveszi. Egyébként (van már DEV-beállítás, vagy a fő változaté hiányzik) nem nyúl semmihez.
 */
export async function importFromStableIfEmpty(stableDir: string, devDir: string, target: SettingsTarget): Promise<StableImportSummary | null> {
  if ((await target.load()).status !== 'missing') return null
  const settings = await readStableSettings(stableDir).catch(() => null)
  return settings ? apply(settings, stableDir, devDir, target) : null
}

/** A tervek, a feladatsorok és a mérés átmásolása; a DEV gyorsítótára törlődik. */
export async function copyStableData(stableDir: string, devDir: string): Promise<Omit<StableImportSummary, 'students'>> {
  if (resolve(stableDir) === resolve(devDir)) throw new Error('A forrás és a cél ugyanaz a mappa.')
  const counts = { plans: 0, syllabi: 0 }
  for (const [key, dir] of Object.entries(COPIED_DIRS) as [keyof typeof COPIED_DIRS, string][]) {
    const target = join(devDir, dir)
    await rm(target, { recursive: true, force: true })
    if (await exists(join(stableDir, dir))) {
      await cp(join(stableDir, dir), target, { recursive: true })
      counts[key] = await countJsonFiles(target)
    }
  }
  const weatherLog = join(stableDir, SKILL_FILE_NAME)
  await rm(join(devDir, SKILL_FILE_NAME), { force: true })
  const hasWeatherLog = await exists(weatherLog)
  if (hasWeatherLog) await cp(weatherLog, join(devDir, SKILL_FILE_NAME))
  await rm(join(devDir, CACHE_DIR_NAME), { recursive: true, force: true })
  return { ...counts, weatherLog: hasWeatherLog }
}
