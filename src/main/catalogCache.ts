import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { LectureCatalogCache, LectureCatalogCacheStore } from './data/refresh'

/**
 * A feladatkatalógus gyorsítótára a felhasználói adatmappában (SZB-02). Csak feladatnevek,
 * programnevek és tervezett percek vannak benne, személyes adat nincs. Sérült vagy ismeretlen
 * formátumú fájlnál a katalógus teljesen újratöltődik.
 */

const lectureSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.string().max(500),
  revisionId: z.string().max(200).optional(),
  programName: z.string().max(500).optional(),
  briefingMinutes: z.number().min(0).max(10_000),
  flightMinutes: z.number().min(0).max(10_000),
  soloMinutes: z.number().min(0).max(10_000).optional(),
  debriefingMinutes: z.number().min(0).max(10_000),
  simulator: z.boolean(),
  night: z.boolean(),
})

const cacheSchema = z.object({
  format: z.literal(1),
  fetchedAt: z.iso.datetime({ offset: true }),
  lectures: z.array(lectureSchema).max(100_000),
})

export function createCatalogCacheStore(path: string): LectureCatalogCacheStore {
  return {
    async load(): Promise<LectureCatalogCache | undefined> {
      let text: string
      try {
        text = await readFile(path, 'utf8')
      } catch {
        return undefined
      }
      try {
        const parsed = cacheSchema.safeParse(JSON.parse(text))
        return parsed.success ? { fetchedAt: parsed.data.fetchedAt, lectures: parsed.data.lectures } : undefined
      } catch {
        return undefined
      }
    },
    async save(cache: LectureCatalogCache): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      await writeFile(tmp, JSON.stringify({ format: 1, fetchedAt: cache.fetchedAt, lectures: cache.lectures }), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, path)
    },
  }
}
