import { readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type { UpdatePrefs, UpdatePrefsStore } from './updaterCore'

/**
 * A frissítés gépenkénti beállítása (FRS-06) külön fájlban: a beállítás-exportba (ALP-07) nem
 * kerül, mert gépre szól. Hiányzó vagy hibás fájlnál az automatikus frissítés be van kapcsolva.
 */
const PrefsSchema = z.object({ autoUpdate: z.boolean() })

export function createPrefsStore(file: string): UpdatePrefsStore {
  return {
    async load(): Promise<UpdatePrefs> {
      try {
        const parsed = PrefsSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
        return parsed.success ? parsed.data : { autoUpdate: true }
      } catch {
        return { autoUpdate: true }
      }
    },
    async save(prefs) {
      await writeFile(file, `${JSON.stringify(PrefsSchema.parse(prefs), null, 2)}\n`, 'utf8')
    },
  }
}
