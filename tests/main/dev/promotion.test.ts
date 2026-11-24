import { describe, expect, it, vi } from 'vitest'
import type { AllowedFetch } from '../../../src/main/net/allowedFetch'
import { promotionState, startPromotion, verifyGithubToken, type PromotionDeps } from '../../../src/main/dev/promotion'

/** Szintetikus GitHub-válaszok; a token kitalált, hálózat nincs. */
const TOKEN = 'github_pat_' + 'x'.repeat(30)
const SHA = 'b'.repeat(40)
const RUN = { status: 'completed', conclusion: 'success', html_url: 'https://github.com/o/r/actions/runs/1', created_at: '2026-11-25T08:00:00Z' }

function deps(fetch: AllowedFetch, overrides: Partial<PromotionDeps> = {}): PromotionDeps {
  return { fetch, loadToken: async () => TOKEN, buildVersion: '0.1.1-dev.4', buildCommit: SHA, ...overrides }
}

const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

describe('kiadás gomb (FRS-09)', () => {
  it('a futó DEV-csomag commitját indítja a dev ágról, a tokennel a fejlécben', async () => {
    const fetch = vi.fn<AllowedFetch>(async (url) => (url.endsWith('/dispatches') ? new Response(null, { status: 204 }) : json({ workflow_runs: [RUN] })))
    const state = await startPromotion(deps(fetch))
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toMatch(/\/actions\/workflows\/promote\.yml\/dispatches$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body!)).toEqual({ ref: 'dev', inputs: { commit: SHA } })
    expect(init.headers?.['Authorization']).toBe(`Bearer ${TOKEN}`)
    expect(state).toMatchObject({ tokenSaved: true, buildCommit: SHA, lastRun: { status: 'completed', conclusion: 'success' } })
  })

  it('commit nélkül (helyi build) vagy token nélkül nem indít', async () => {
    const fetch = vi.fn<AllowedFetch>()
    await expect(startPromotion(deps(fetch, { buildCommit: null }))).rejects.toThrow(/helyi build/)
    await expect(startPromotion(deps(fetch, { loadToken: async () => undefined }))).rejects.toThrow(/GitHub-tokent/)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('a GitHub hibáját érthetően adja vissza, a token nélkül', async () => {
    for (const [status, pattern] of [
      [401, /érvénytelen vagy lejárt/],
      [403, /Actions: Read and write/],
      [404, /nem érhető el ezzel a tokennel/],
    ] as const) {
      const fetch = vi.fn<AllowedFetch>(async () => json({ message: 'x' }, status))
      const error = (await startPromotion(deps(fetch)).then(
        () => new Error('nem dobott'),
        (e: unknown) => e as Error,
      )) as Error
      expect(error.message).toMatch(pattern)
      expect(error.message).not.toContain(TOKEN)
    }
  })

  it('állapot: token nélkül nem kérdez a hálózattól; hibánál az üzenetet adja', async () => {
    const fetch = vi.fn<AllowedFetch>(async () => json({}, 401))
    expect(await promotionState(deps(fetch, { loadToken: async () => undefined }))).toEqual({ tokenSaved: false, buildVersion: '0.1.1-dev.4', buildCommit: SHA, lastRun: null })
    expect(fetch).not.toHaveBeenCalled()
    expect((await promotionState(deps(fetch))).error).toMatch(/érvénytelen/)
  })

  it('még soha nem futott munkafolyamatnál nincs utolsó futás', async () => {
    const fetch = vi.fn<AllowedFetch>(async () => json({ workflow_runs: [] }))
    expect((await promotionState(deps(fetch))).lastRun).toBeNull()
  })

  it('a token próbája a futások olvasásával', async () => {
    expect((await verifyGithubToken(vi.fn<AllowedFetch>(async () => json({ workflow_runs: [] })), TOKEN)).ok).toBe(true)
    const bad = await verifyGithubToken(vi.fn<AllowedFetch>(async () => json({}, 401)), TOKEN)
    expect(bad).toMatchObject({ ok: false })
    expect(bad.message).not.toContain(TOKEN)
  })
})
