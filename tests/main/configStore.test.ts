import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../src/core/config/defaults'
import { SETTINGS_FORMAT_VERSION } from '../../src/core/config/schema'
import { serializeSettings } from '../../src/core/config/settings'
import { createConfigStore, type ConfigFileSystem } from '../../src/main/configStoreCore'

const PATH = '/adat/beallitasok.json'

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const log: string[] = []
  const fs: ConfigFileSystem = {
    readText: async (p) => files.get(p),
    writeText: async (p, t) => {
      log.push(`write ${p}`)
      files.set(p, t)
    },
    rename: async (from, to) => {
      log.push(`rename ${from} -> ${to}`)
      files.set(to, files.get(from)!)
      files.delete(from)
    },
    copy: async (from, to) => {
      log.push(`copy ${from} -> ${to}`)
      files.set(to, files.get(from)!)
    },
  }
  return { fs, files, log }
}

const fixedNow = () => new Date('2026-11-11T07:00:00.000Z')

describe('beállítási fájl (ALP-05)', () => {
  it('hiányzó fájlnál alapértékeket ad, és nem ír semmit', async () => {
    const { fs, log } = memoryFs()
    const result = await createConfigStore(fs, PATH).load()
    expect(result.status).toBe('missing')
    expect(log).toEqual([])
  })

  it('ideiglenes fájlon és átnevezésen keresztül ment, majd visszaolvas', async () => {
    const { fs, files, log } = memoryFs()
    const store = createConfigStore(fs, PATH)
    const settings = { ...createDefaultSettings(), weights: { ...createDefaultSettings().weights, priority: 40 } }
    await store.save(settings)
    expect(log).toEqual([`write ${PATH}.tmp`, `rename ${PATH}.tmp -> ${PATH}`])
    expect(files.has(`${PATH}.tmp`)).toBe(false)
    const loaded = await store.load()
    expect(loaded.status).toBe('ok')
    if (loaded.status === 'ok') expect(loaded.settings.weights.priority).toBe(40)
  })

  it('hibás fájlt nem ír felül: másolatot készít, és a mentést megtagadja', async () => {
    const { fs, files } = memoryFs({ [PATH]: '{"formatVersion": 1, "airport": 5}' })
    const store = createConfigStore(fs, PATH, fixedNow)
    const result = await store.load()
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.backupPath).toBe('/adat/beallitasok.hibas-2026-11-11T07-00-00-000Z.json')
      expect(files.get(result.backupPath)).toBe('{"formatVersion": 1, "airport": 5}')
      expect(result.errors.length).toBeGreaterThan(0)
    }
    await expect(store.save(createDefaultSettings())).rejects.toThrow(/hibás/)
    expect(files.get(PATH)).toBe('{"formatVersion": 1, "airport": 5}')
  })

  it('újabb verziójú fájlt sem ír felül', async () => {
    const newer = serializeSettings(createDefaultSettings()).replace(`"formatVersion": ${SETTINGS_FORMAT_VERSION}`, `"formatVersion": ${SETTINGS_FORMAT_VERSION + 1}`)
    const { fs, files } = memoryFs({ [PATH]: newer })
    const store = createConfigStore(fs, PATH, fixedNow)
    const result = await store.load()
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') expect(result.errors[0]).toMatch(/újabb verziójával/)
    await expect(store.save(createDefaultSettings())).rejects.toThrow()
    expect(files.get(PATH)).toBe(newer)
  })
})
