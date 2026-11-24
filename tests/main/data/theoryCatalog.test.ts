import { describe, expect, it } from 'vitest'
import { loadTheoryCatalog, type TheoryCatalogCacheStore } from '../../../src/main/data/theoryCatalog'
import type { FlightLoggerClient } from '../../../src/main/net/flightLogger/client'

/** Szintetikus programlista (FLI-11). */
const PROGRAMS = [
  { id: 'p1', name: 'Teszt Ground School', programType: 'GROUND_TRAINING', programRevisions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'r1', name: 'Revision 6' }] } },
  { id: 'p2', name: 'Teszt PPL', programType: 'FLIGHT_TRAINING', programRevisions: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'r2', name: 'Rev 4' }, null] } },
]

function fakeClient(programs: unknown[], subjectsByRevision: Record<string, unknown[]>, calls: string[]): Pick<FlightLoggerClient, 'fetchAll'> {
  return {
    fetchAll: (async (query: { name: string }, vars: { programRevisionId?: string }) => {
      calls.push(`${query.name}${vars.programRevisionId ? `:${vars.programRevisionId}` : ''}`)
      if (query.name === 'TheoryPrograms') return programs
      if (query.name === 'SubjectCategories') return subjectsByRevision[vars.programRevisionId ?? ''] ?? []
      throw new Error('ismeretlen lekérdezés')
    }) as unknown as FlightLoggerClient['fetchAll'],
  }
}

function memoryCache(): TheoryCatalogCacheStore & { saved: number } {
  let value: Awaited<ReturnType<TheoryCatalogCacheStore['load']>>
  const store = {
    saved: 0,
    async load() {
      return value
    },
    async save(c: NonNullable<typeof value>) {
      value = c
      store.saved++
    },
  }
  return store
}

const NOW = new Date('2026-11-22T20:00:00.000Z')

describe('FlightLogger programlista (FLI-11)', () => {
  it('a programok revíziónként, a FlightLogger feliratával; tárgy csak az elméleti programokhoz', async () => {
    const calls: string[] = []
    const catalog = await loadTheoryCatalog({ client: fakeClient(PROGRAMS, { r1: [{ id: 's1', name: 'VFR Cross Country Groundschool', theoryCourse: null }, { id: 's2', name: null, theoryCourse: null }] }, calls), now: NOW })
    expect(catalog.programs.map((p) => [p.revisionId, p.label, p.programType])).toEqual([
      ['r1', 'Teszt Ground School Revision 6', 'GROUND_TRAINING'],
      ['r2', 'Teszt PPL Rev 4', 'FLIGHT_TRAINING'],
    ])
    expect(catalog.subjects).toEqual([{ id: 's1', name: 'VFR Cross Country Groundschool', revisionId: 'r1' }])
    expect(calls).toEqual(['TheoryPrograms', 'SubjectCategories:r1'])
    expect(catalog.errors).toEqual([])
    expect(catalog.source).toBe('live')
  })

  it('üres programlistánál jelzi, hogy szabad szöveggel is megadható', async () => {
    const catalog = await loadTheoryCatalog({ client: fakeClient([], {}, []), now: NOW })
    expect(catalog.programs).toEqual([])
    expect(catalog.errors[0]).toMatch(/nem adott programlistát/)
  })

  it('a friss gyorsítótárból dolgozik; kérésre és 7 nap után újratölt; üres válasznál a régit tartja', async () => {
    const cache = memoryCache()
    const calls: string[] = []
    await loadTheoryCatalog({ client: fakeClient(PROGRAMS, {}, calls), now: NOW, cache })
    expect(cache.saved).toBe(1)
    const again = await loadTheoryCatalog({ client: fakeClient(PROGRAMS, {}, calls), now: new Date(NOW.getTime() + 3_600_000), cache })
    expect(again.source).toBe('cache')
    expect(calls.filter((c) => c === 'TheoryPrograms')).toHaveLength(1)
    const forced = await loadTheoryCatalog({ client: fakeClient(PROGRAMS, {}, calls), now: NOW, cache, force: true })
    expect(forced.source).toBe('live')
    const empty = await loadTheoryCatalog({ client: fakeClient([], {}, calls), now: new Date(NOW.getTime() + 8 * 86_400_000), cache })
    expect(empty.source).toBe('cache')
    expect(empty.programs).toHaveLength(2)
    expect(empty.errors[0]).toMatch(/nem adott programlistát/)
  })
})
