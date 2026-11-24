import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { serializeSettings } from '../../../src/core/config/settings'
import { createDemoSettings } from '../../../src/core/demo/demoData'
import { copyStableData, readStableSettings } from '../../../src/main/dev/importFromStable'

/** Szintetikus adatmappák egy ideiglenes könyvtárban; valódi felhasználói adat nincs bennük. */
const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fb-atvetel-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

const SETTINGS = createDemoSettings('2026-11-25', '2026-11-25T08:00:00.000Z')

describe('beállítások átvétele a fő változatból (FRS-10)', () => {
  it('a beállítást ellenőrizve olvassa, a régi formátumot is', async () => {
    const stable = await tempDir()
    const old = { ...JSON.parse(serializeSettings(SETTINGS)), formatVersion: 8, dataSource: 'live' }
    await writeFile(join(stable, 'beallitasok.json'), JSON.stringify(old))
    const settings = await readStableSettings(stable)
    expect(settings.students).toEqual(SETTINGS.students)
    expect(settings).not.toHaveProperty('dataSource')
  })

  it('hiányzó vagy hibás beállításnál érthető hiba', async () => {
    const stable = await tempDir()
    await expect(readStableSettings(stable)).rejects.toThrow(/nem található/)
    await writeFile(join(stable, 'beallitasok.json'), '{"formatVersion": 9}')
    await expect(readStableSettings(stable)).rejects.toThrow(/nem olvasható/)
  })

  it('a terveket, a feladatsorokat és a mérést átmásolja; a DEV régi adata és gyorsítótára törlődik', async () => {
    const stable = await tempDir()
    const dev = await tempDir()
    await mkdir(join(stable, 'tervek'))
    await writeFile(join(stable, 'tervek', '2026-11-23.json'), '{}')
    await writeFile(join(stable, 'tervek', '2026-11-30.json'), '{}')
    await mkdir(join(stable, 'feladatsorok'))
    await writeFile(join(stable, 'feladatsorok', 'sajat.json'), '{}')
    await writeFile(join(stable, 'idojaras-pontossag.json'), '{"meres":1}')
    await writeFile(join(stable, 'flightlogger-key.secret'), 'titkos')
    await mkdir(join(dev, 'tervek'))
    await writeFile(join(dev, 'tervek', 'regi.json'), '{}')
    await mkdir(join(dev, 'gyorsitotar'))
    await writeFile(join(dev, 'gyorsitotar', 'x.bin'), 'x')

    const summary = await copyStableData(stable, dev)
    expect(summary).toEqual({ plans: 2, syllabi: 1, weatherLog: true })
    expect((await readdir(join(dev, 'tervek'))).sort()).toEqual(['2026-11-23.json', '2026-11-30.json'])
    expect(await readFile(join(dev, 'idojaras-pontossag.json'), 'utf8')).toBe('{"meres":1}')
    expect(await readdir(dev)).not.toContain('gyorsitotar')
    // Az API-kulcs nem jön át (ALP-06).
    expect(await readdir(dev)).not.toContain('flightlogger-key.secret')
  })

  it('ha a fő változatnak nincs terve, a DEV-é is kiürül; ugyanabba a mappába nem másol', async () => {
    const stable = await tempDir()
    const dev = await tempDir()
    await mkdir(join(dev, 'tervek'))
    await writeFile(join(dev, 'tervek', 'regi.json'), '{}')
    expect(await copyStableData(stable, dev)).toEqual({ plans: 0, syllabi: 0, weatherLog: false })
    expect(await readdir(dev)).not.toContain('tervek')
    await expect(copyStableData(dev, dev)).rejects.toThrow(/ugyanaz/)
  })
})
