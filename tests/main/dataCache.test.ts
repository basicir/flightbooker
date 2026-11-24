import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDemoBundle } from '../../src/core/demo/demoData'
import type { DataBundle } from '../../src/core/model/dataBundle'
import { createBundleCacheStore, createHistoryCacheStore, type CacheCipher } from '../../src/main/dataCache'

/** Szintetikus adat (a bemutató csomag) élő forrásként jelölve. */
const liveBundle = (weekStart: string): DataBundle => ({ ...createDemoBundle(new Date('2026-11-11T10:00:00.000Z'), weekStart), source: 'live' })

/** Teszt-titkosítás: megfordított bájtsorrend (a lényeg, hogy a fájl ne legyen olvasható JSON). */
const cipher: CacheCipher = {
  encrypt: (plain) => Buffer.from(Buffer.from(plain, 'utf8').reverse()),
  decrypt: (data) => Buffer.from(data).reverse().toString('utf8'),
}

describe('törölhető gyorsítótár (indítás az utolsó adattal)', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fb-cache-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a hét adatát visszaadja, más hetet és bemutató adatot nem', async () => {
    const store = createBundleCacheStore(join(dir, 'hetek'), cipher)
    const bundle = liveBundle('2026-11-16')
    await store.save(bundle)
    await store.save(createDemoBundle(new Date('2026-11-11T10:00:00.000Z'), '2026-11-23'))
    expect(await store.load('2026-11-16')).toEqual(JSON.parse(JSON.stringify(bundle)))
    expect(await store.load('2026-11-23')).toBeUndefined()
    expect(await store.load('../x')).toBeUndefined()
  })

  it('sérült fájlt figyelmen kívül hagy', async () => {
    const store = createBundleCacheStore(dir, cipher)
    await writeFile(join(dir, 'het-2026-11-16.bin'), '{nem json')
    expect(await store.load('2026-11-16')).toBeUndefined()
    await writeFile(join(dir, 'het-2026-11-16.bin'), cipher.encrypt(JSON.stringify({ format: 99, bundle: {} })))
    expect(await store.load('2026-11-16')).toBeUndefined()
  })

  it('a heti adat titkosítva, szűkített névjegyzékkel kerül lemezre (B1)', async () => {
    const store = createBundleCacheStore(dir, cipher)
    const bundle = liveBundle('2026-11-16')
    const keep = Object.keys(bundle.directory.people).slice(0, 1)
    await store.saveNarrowed(bundle, keep)
    const raw = await readFile(join(dir, 'het-2026-11-16.bin'), 'utf8')
    expect(() => JSON.parse(raw)).toThrow()
    const loaded = await store.load('2026-11-16')
    expect(Object.keys(loaded!.directory.people).sort()).toEqual([...new Set([...keep, bundle.snapshot.instructorId])].filter((id) => bundle.directory.people[id]).sort())
  })

  it('titkosítás nélkül a heti adat nem kerül lemezre (B1)', async () => {
    const store = createBundleCacheStore(dir)
    await store.save(liveBundle('2026-11-16'))
    expect(await readdir(dir)).toEqual([])
    expect(await store.load('2026-11-16')).toBeUndefined()
  })

  it('legfeljebb négy hetet tart meg, a legrégebben írtakat törli', async () => {
    const store = createBundleCacheStore(dir, cipher)
    const weeks = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']
    // A régi, titkosítatlan formátumú fájl is törlődik.
    await writeFile(join(dir, 'het-2026-10-05.json'), '{}')
    for (const [i, w] of weeks.entries()) {
      await store.save(liveBundle(w))
      const t = new Date(Date.UTC(2026, 9, 1 + i))
      await utimes(join(dir, `het-${w}.bin`), t, t)
    }
    await store.save(liveBundle('2026-11-16'))
    expect((await readdir(dir)).sort()).toEqual(['het-2026-10-26.bin', 'het-2026-11-02.bin', 'het-2026-11-09.bin', 'het-2026-11-16.bin'])
  })

  it('a haladás és a repülések gyorsítótára visszaolvasható, a hibás nem', async () => {
    const path = join(dir, 'elozmenyek.json')
    const store = createHistoryCacheStore(path, cipher)
    const at = '2026-11-11T10:00:00.000Z'
    const cache = { flights: { fullAt: at, fetchedAt: at, items: [{ id: 'f1', offBlock: at, onBlock: at, flightType: null, ftSeconds: 0, aircraft: null }] } }
    await store.save(cache)
    expect(await store.load()).toEqual({ format: 2, ...cache })
    await writeFile(path, cipher.encrypt(JSON.stringify({ format: 2, flights: { fullAt: 'tegnap', fetchedAt: at, items: [] } })))
    expect(await store.load()).toBeUndefined()
    // A régebbi formátumú gyorsítótár (például megfigyelők nélküli foglalások) nem használható.
    await writeFile(path, cipher.encrypt(JSON.stringify({ format: 1, ...cache })))
    expect(await store.load()).toBeUndefined()
  })
})
