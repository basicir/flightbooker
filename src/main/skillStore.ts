import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { LOG_DAYS, SKILL_GROUPS } from '../core/weather/skill'
import type { SkillState, SkillStore } from './data/modelSkill'

/**
 * A modellpontosság mérése a felhasználói adatmappában (`idojaras-pontossag.json`). Csak
 * modellnév, időpont, időjárási érték és a bázis nyers METAR-jai vannak benne, személyes adat nincs,
 * ezért nem titkosított.
 * Nem gyorsítótár: hetek alatt gyűlik, a „Gyorsítótár törlése” nem, a „Minden adat törlése”
 * igen törli. Sérült vagy ismeretlen formátumú fájlnál a mérés elölről indul.
 */

const FORMAT = 1
const iso = z.iso.datetime({ offset: true })
const value = z.number().finite().nullable()
const model = z.string().regex(/^[a-z0-9_]{1,40}$/)

const fileSchema = z.object({
  format: z.literal(FORMAT),
  archive: z
    .array(
      z.object({
        model,
        issuedAt: iso,
        hours: z
          .array(z.object({ time: iso, windKt: value, gustKt: value, visibilityM: value, ceilingFt: value, temperatureC: value }))
          .max(400),
      }),
    )
    .max(2_000),
  stats: z
    .array(
      z.object({
        model,
        bucket: z.number().int().min(0).max(10),
        group: z.enum(SKILL_GROUPS),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        n: z.number().int().min(0),
        sse: z.number().finite().min(0),
      }),
    )
    .max(100_000),
  // A mérési napló (LOG_DAYS nap óránként); régebbi fájlban hiányzik.
  log: z
    .array(
      z.object({
        time: iso,
        observation: z.object({ time: iso, windKt: value, gustKt: value, visibilityM: value, ceilingFt: value, temperatureC: value, raw: z.string().max(300).optional() }),
        forecasts: z.array(z.object({ model, issuedAt: iso, windKt: value, gustKt: value, visibilityM: value, ceilingFt: value, temperatureC: value })).max(20),
      }),
    )
    .max(24 * (LOG_DAYS + 1))
    .optional(),
})

/** A modellpontosság mérésének fájlja a felhasználói adatmappában (ADT-07). */
export const SKILL_FILE_NAME = 'idojaras-pontossag.json'

export function createSkillStore(path: string): SkillStore {
  return {
    async load(): Promise<SkillState | undefined> {
      let raw: string
      try {
        raw = await readFile(path, 'utf8')
      } catch {
        return undefined
      }
      try {
        const parsed = fileSchema.safeParse(JSON.parse(raw))
        return parsed.success ? { archive: parsed.data.archive, stats: parsed.data.stats, ...(parsed.data.log ? { log: parsed.data.log } : {}) } : undefined
      } catch {
        return undefined
      }
    },
    async save(state: SkillState): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      await writeFile(tmp, JSON.stringify({ format: FORMAT, ...state }), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, path)
    },
  }
}
