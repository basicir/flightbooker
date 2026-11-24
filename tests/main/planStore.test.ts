import { describe, expect, it } from 'vitest'
import { createWeekPlan } from '../../src/core/draft/weekPlan'
import { createPlanStore } from '../../src/main/planStoreCore'

function memoryFs() {
  const files = new Map<string, string>()
  return {
    files,
    fs: {
      readText: async (p: string) => files.get(p),
      writeText: async (p: string, t: string) => void files.set(p, t),
      rename: async (a: string, b: string) => {
        files.set(b, files.get(a)!)
        files.delete(a)
      },
    },
  }
}

describe('heti tervezetek tárolása', () => {
  it('ment és visszaolvas; hiányzó hétre null', async () => {
    const { fs, files } = memoryFs()
    const store = createPlanStore(fs, '/adat/tervek')
    const plan = createWeekPlan('2026-11-16', '2026-11-15T10:00:00.000Z')
    await store.save(plan)
    expect([...files.keys()]).toEqual(['/adat/tervek/terv-2026-11-16.json'])
    await expect(store.load('2026-11-16')).resolves.toEqual(plan)
    await expect(store.load('2026-11-23')).resolves.toBeNull()
  })

  it('érvénytelen tervezetet és hetet elutasít', async () => {
    const { fs } = memoryFs()
    const store = createPlanStore(fs, '/adat/tervek')
    await expect(store.save({ ...createWeekPlan('2026-11-16', '2026-11-15T10:00:00.000Z'), extra: 1 } as never)).rejects.toThrow(/érvénytelen/)
    await expect(store.load('../../etc/passwd')).rejects.toThrow(/Érvénytelen hét/)
  })
})
