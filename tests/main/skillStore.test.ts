import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSkillStore } from '../../src/main/skillStore'

// Szintetikus mérés; az ICAO-kód és a METAR kitalált.
const T = '2026-11-15T06:00:00.000Z'
const LOG = [
  {
    time: T,
    observation: { time: T, windKt: 8, gustKt: 8, visibilityM: 10_000, ceilingFt: null, temperatureC: 5, raw: 'METAR XXXX 150600Z 04008KT 9999 05/02 Q1020' },
    forecasts: [{ model: 'icon_eu', issuedAt: '2026-11-14T18:00:00.000Z', windKt: 10, gustKt: 15, visibilityM: 20_000, ceilingFt: null, temperatureC: 4.5 }],
  },
]

describe('modellpontosság tárolása (ADT-07)', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fb-skill-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('a mérési naplót (a METAR-okkal) is menti és visszaolvassa', async () => {
    const store = createSkillStore(join(dir, 'idojaras-pontossag.json'))
    await store.save({ archive: [], stats: [], log: LOG })
    expect(await store.load()).toEqual({ archive: [], stats: [], log: LOG })
  })

  it('a napló nélküli régebbi fájlt is beolvassa (a mérés nem indul elölről)', async () => {
    const path = join(dir, 'idojaras-pontossag.json')
    const stats = [{ model: 'icon_eu', bucket: 0, group: 'wind', date: '2026-11-14', n: 3, sse: 12 }]
    await writeFile(path, JSON.stringify({ format: 1, archive: [], stats }))
    expect(await createSkillStore(path).load()).toEqual({ archive: [], stats })
  })
})
