import { createDefaultSettings } from '../core/config/defaults'
import type { Settings } from '../core/config/schema'
import { parseSettingsJson, serializeSettings } from '../core/config/settings'

/**
 * A beállítási fájl kezelése (ALP-05), Electron nélkül tesztelhető mag.
 * - Hiányzó fájl: alapértékek, a fájl csak az első mentéskor jön létre.
 * - Sérült vagy újabb verziójú fájl: nem írjuk felül, másolatot készítünk róla.
 * - Mentés: ideiglenes fájlba írás, majd átnevezés, hogy félbeszakadt írás ne rontsa el.
 */

export interface ConfigFileSystem {
  readText(path: string): Promise<string | undefined>
  writeText(path: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  copy(from: string, to: string): Promise<void>
}

export type LoadResult =
  | { readonly status: 'ok'; readonly settings: Settings; readonly migratedFrom?: number }
  | { readonly status: 'missing'; readonly settings: Settings }
  | { readonly status: 'invalid'; readonly errors: readonly string[]; readonly backupPath: string }

export interface ConfigStore {
  load(): Promise<LoadResult>
  save(settings: Settings): Promise<void>
  readonly path: string
}

export function createConfigStore(fs: ConfigFileSystem, path: string, now: () => Date = () => new Date()): ConfigStore {
  const stamp = (): string => now().toISOString().replace(/[:.]/g, '-')
  let blockedReason: string | undefined

  return {
    path,
    async load() {
      const text = await fs.readText(path)
      if (text === undefined) {
        blockedReason = undefined
        return { status: 'missing', settings: createDefaultSettings() }
      }
      const parsed = parseSettingsJson(text)
      if (!parsed.ok) {
        const backupPath = path.replace(/\.json$/, `.hibas-${stamp()}.json`)
        await fs.copy(path, backupPath)
        blockedReason = 'A beállítási fájl hibás; javítsd vagy állítsd vissza, mielőtt a program felülírná.'
        return { status: 'invalid', errors: parsed.errors, backupPath }
      }
      blockedReason = undefined
      if (parsed.migratedFrom !== undefined) {
        await fs.copy(path, path.replace(/\.json$/, `.v${parsed.migratedFrom}-mentes.json`))
        return { status: 'ok', settings: parsed.settings, migratedFrom: parsed.migratedFrom }
      }
      return { status: 'ok', settings: parsed.settings }
    },
    async save(settings) {
      if (blockedReason) throw new Error(blockedReason)
      const text = serializeSettings(settings)
      const tmp = `${path}.tmp`
      await fs.writeText(tmp, text)
      await fs.rename(tmp, path)
    },
  }
}
