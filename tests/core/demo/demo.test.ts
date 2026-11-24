import { describe, expect, it } from 'vitest'
import { SettingsSchema } from '../../../src/core/config/schema'
import { createDemoBundle, createDemoSettings } from '../../../src/core/demo/demoData'
import { defaultFlightRequest } from '../../../src/core/draft/weekPlan'
import { plan } from '../../../src/core/engine/plan'

describe('bemutató mód', () => {
  const now = new Date('2026-11-15T09:00:00.000Z')
  const bundle = createDemoBundle(now, '2026-11-16')
  const settings = createDemoSettings('2026-11-15', now.toISOString())

  it('a bemutató beállítás érvényes', () => {
    expect(SettingsSchema.safeParse(settings).success).toBe(true)
  })

  it('csak szintetikus neveket tartalmaz', () => {
    for (const person of Object.values(bundle.directory.people)) expect(person.name).toMatch(/^Demó /)
  })

  it('a bemutató hétre a motor tervet készít', () => {
    const requests = settings.students.map((s, i) => defaultFlightRequest(settings, s.userId, `r${i}`))
    const result = plan({ snapshot: bundle.snapshot, settings, requests, decisions: [] })
    expect(result.proposals.length + result.unplaced.length).toBe(requests.length)
    expect(result.proposals.length).toBeGreaterThanOrEqual(5)
  })
})
