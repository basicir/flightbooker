import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type { DataBundle } from '../core/model/dataBundle'
import type { HistoryCache, HistoryCacheStore } from './data/refresh'

/** A törölhető gyorsítótár mappája a felhasználói adatmappában. */
export const CACHE_DIR_NAME = 'gyorsitotar'

/**
 * Törölhető gyorsítótár a felhasználói adatmappa `gyorsitotar` mappájában (koncepció 3.: a név
 * és a foglalás memóriában vagy törölhető gyorsítótárban marad). Csak a gépen él, a repóba
 * nem kerül; a „Minden adat törlése” és a „Gyorsítótár törlése” is eltávolítja. Sérült vagy
 * ismeretlen formátumú fájlt figyelmen kívül hagyunk, akkor minden újra letöltődik.
 *
 * A heti adatban nevek és foglalások vannak, ezért (B1, Q7):
 * - a névjegyzékből csak a hozzárendelt növendékek és az oktató neve kerül lemezre;
 * - a fájl a rendszer titoktárolójával (safeStorage) titkosítva íródik; titkosítás nélkül a
 *   heti adat nem kerül lemezre.
 */

/** Titkosítás a gyorsítótárhoz (élesben a safeStorage). */
export interface CacheCipher {
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * A formátum változásakor a régi fájl figyelmen kívül marad, és minden újra letöltődik.
 * 2: a repülési foglalások megfigyelői és a többnövendékes foglalás feladatai (KBR-10).
 */
const CACHE_FORMAT = 2
const iso = z.iso.datetime({ offset: true })
const withId = z.looseObject({ id: z.string().min(1).max(200) })

async function readJson(path: string, cipher?: CacheCipher): Promise<unknown> {
  try {
    const raw = await readFile(path)
    return JSON.parse(cipher ? cipher.decrypt(raw) : raw.toString('utf8')) as unknown
  } catch {
    return undefined
  }
}

/** Atomi írás: ideiglenes fájlba, majd átnevezés; csak a felhasználó olvashatja. */
async function writeJson(path: string, value: unknown, cipher?: CacheCipher): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  const text = JSON.stringify(value)
  await writeFile(tmp, cipher ? cipher.encrypt(text) : text, { mode: 0o600 })
  await rename(tmp, path)
}

const historyEntry = z.object({ fullAt: iso, fetchedAt: iso, items: z.array(withId).max(200_000) })
const historySchema = z.object({
  format: z.literal(CACHE_FORMAT),
  trainings: historyEntry.extend({ userIds: z.array(z.string().min(1).max(200)).max(10_000) }).optional(),
  flights: historyEntry.optional(),
  pastBookings: historyEntry.extend({ from: iso, to: iso.optional() }).optional(),
})

/** A haladás és a saját repülések gyorsítótára (csak azonosítók, név nincs benne). */
export function createHistoryCacheStore(path: string, cipher?: CacheCipher): HistoryCacheStore {
  return {
    async load(): Promise<HistoryCache | undefined> {
      const parsed = historySchema.safeParse(await readJson(path, cipher))
      if (!parsed.success) return undefined
      // A séma csak a szerkezetet ellenőrzi; a tartalom a saját korábbi letöltésünk.
      return parsed.data as unknown as HistoryCache
    },
    async save(cache: HistoryCache): Promise<void> {
      await writeJson(path, { format: CACHE_FORMAT, ...cache }, cipher)
    },
  }
}

const bundleFile = z.object({
  format: z.literal(CACHE_FORMAT),
  savedAt: iso,
  bundle: z.looseObject({
    source: z.literal('live'),
    fetchedAt: iso,
    snapshot: z.looseObject({ weekStart: z.string() }),
    directory: z.looseObject({}),
  }),
})

/** Ennyi hét adata marad meg; a régebbieket mentéskor töröljük. */
const KEEP_WEEKS = 4

/**
 * Az utolsó letöltött heti adat hetenként: indításkor ezzel azonnal lehet dolgozni, amíg a
 * háttérben a friss letöltődik. Csak élő FlightLogger-adatot tárolunk.
 */
export interface BundleCacheStore {
  load(weekStart: string): Promise<DataBundle | undefined>
  save(bundle: DataBundle): Promise<void>
}

/**
 * A lemezre írható névjegyzék: csak a hozzárendelt növendékek és az oktató (B1). A többi név
 * a friss letöltéskor a memóriában újra megvan.
 */
export function narrowDirectory(bundle: DataBundle, keepIds: readonly string[]): DataBundle {
  const keep = new Set([...keepIds, bundle.snapshot.instructorId])
  const people = Object.fromEntries(Object.entries(bundle.directory.people).filter(([id]) => keep.has(id)))
  return { ...bundle, directory: { ...bundle.directory, people } }
}

/**
 * `cipher` nélkül a heti adat nem kerül lemezre (nevek és foglalások vannak benne); a betöltés
 * ilyenkor üres. `keepIds`: a lemezen megtartott nevek (a hozzárendelt növendékek).
 */
export function createBundleCacheStore(dir: string, cipher?: CacheCipher): BundleCacheStore & { saveNarrowed(bundle: DataBundle, keepIds: readonly string[]): Promise<void> } {
  const fileOf = (weekStart: string): string => join(dir, `het-${weekStart}.bin`)
  const save = async (bundle: DataBundle): Promise<void> => {
    if (bundle.source !== 'live' || !cipher) return
    await writeJson(fileOf(bundle.snapshot.weekStart), { format: CACHE_FORMAT, savedAt: new Date().toISOString(), bundle }, cipher)
    await prune(dir)
  }
  return {
    async load(weekStart: string): Promise<DataBundle | undefined> {
      if (!cipher || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return undefined
      const parsed = bundleFile.safeParse(await readJson(fileOf(weekStart), cipher))
      if (!parsed.success || parsed.data.bundle.snapshot.weekStart !== weekStart) return undefined
      return parsed.data.bundle as unknown as DataBundle
    },
    save,
    saveNarrowed: (bundle, keepIds) => save(narrowDirectory(bundle, keepIds)),
  }
}

async function prune(dir: string): Promise<void> {
  const all = await readdir(dir).catch(() => [] as string[])
  // A korábbi, titkosítatlan formátum fájljai (B1) azonnal törlődnek.
  await Promise.all(all.filter((n) => /^het-\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => rm(join(dir, n), { force: true })))
  const names = all.filter((n) => /^het-\d{4}-\d{2}-\d{2}\.bin$/.test(n))
  if (names.length <= KEEP_WEEKS) return
  const withTime = await Promise.all(names.map(async (n) => ({ n, t: (await stat(join(dir, n)).catch(() => undefined))?.mtimeMs ?? 0 })))
  withTime.sort((a, b) => b.t - a.t)
  await Promise.all(withTime.slice(KEEP_WEEKS).map(({ n }) => rm(join(dir, n), { force: true })))
}
