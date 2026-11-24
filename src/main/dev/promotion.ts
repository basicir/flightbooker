import { z } from 'zod'
import type { ConnectionTest, PromotionRun, PromotionState } from '../../shared/api'
import { GITHUB_API_HOST, PROMOTE_DISPATCH_PATH, PROMOTE_RUNS_PATH, type AllowedFetch } from '../net/allowedFetch'

/**
 * A DEV-program „Kiadás: dev → main” gombja (FRS-09), Electron nélkül tesztelhető mag. A gomb a
 * GitHub Actions `promote.yml` munkafolyamatát indítja a futó DEV-csomag commitjával: pontosan az
 * kerül ki fő kiadásként, amit a fejlesztő kipróbált. A token csak a kérés fejlécébe kerül;
 * hibaüzenetbe, naplóba nem.
 */

const RUNS_URL = `https://${GITHUB_API_HOST}${PROMOTE_RUNS_PATH}?per_page=1&event=workflow_dispatch`
const DISPATCH_URL = `https://${GITHUB_API_HOST}${PROMOTE_DISPATCH_PATH}`

/** Finomhangolt (github_pat_…) vagy klasszikus (ghp_…) GitHub-token. */
export const GithubTokenSchema = z
  .string()
  .trim()
  .regex(/^(github_pat_|ghp_)[A-Za-z0-9_]{20,255}$/)

const RunsSchema = z.object({
  workflow_runs: z.array(
    z.object({
      status: z.string().max(40),
      conclusion: z.string().max(40).nullable(),
      html_url: z.url().max(500),
      created_at: z.string().max(40),
    }),
  ),
})

export interface PromotionDeps {
  readonly fetch: AllowedFetch
  readonly loadToken: () => Promise<string | undefined>
  readonly buildVersion: string
  readonly buildCommit: string | null
}

const headers = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Foglalastervezo-DEV',
})

/** Érthető magyar hibaüzenet a GitHub válaszkódjából (a token nem szerepel benne). */
export function describeGithubStatus(status: number, githubMessage?: string): string {
  switch (status) {
    case 401:
      return 'A GitHub nem fogadta el a tokent (érvénytelen vagy lejárt). Adj meg újat.'
    case 403:
      return 'A tokennek nincs joga ehhez (a flightbooker repóra „Actions: Read and write” jog kell), vagy elérted a GitHub kéréskorlátját.'
    case 404:
      return 'A munkafolyamat nem érhető el ezzel a tokennel. A token a flightbooker repóra szóljon, „Actions: Read and write” joggal.'
    case 422:
      return `A GitHub elutasította az indítást${githubMessage ? `: ${githubMessage}` : '.'}`
    default:
      return `A GitHub ${status} hibával válaszolt.`
  }
}

async function githubMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { message?: unknown }
    return typeof body.message === 'string' ? body.message.slice(0, 200) : undefined
  } catch {
    return undefined
  }
}

/** A munkafolyamat legutóbbi indítása; ha még egyszer sem futott, `null`. */
export async function latestPromotionRun(fetch: AllowedFetch, token: string): Promise<PromotionRun | null> {
  const response = await fetch(RUNS_URL, { method: 'GET', headers: headers(token) })
  if (!response.ok) throw new Error(describeGithubStatus(response.status))
  const run = RunsSchema.parse(await response.json()).workflow_runs[0]
  return run ? { status: run.status, conclusion: run.conclusion, url: run.html_url, createdAt: run.created_at } : null
}

export async function promotionState(deps: PromotionDeps): Promise<PromotionState> {
  const base = { buildVersion: deps.buildVersion, buildCommit: deps.buildCommit, lastRun: null }
  let token: string | undefined
  try {
    token = await deps.loadToken()
  } catch (error) {
    return { ...base, tokenSaved: true, error: error instanceof Error ? error.message : String(error) }
  }
  if (!token) return { ...base, tokenSaved: false }
  try {
    return { ...base, tokenSaved: true, lastRun: await latestPromotionRun(deps.fetch, token) }
  } catch (error) {
    return { ...base, tokenSaved: true, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A futó DEV-verzió kiadása fő kiadásként: a `promote.yml` indítása a csomag commitjával. */
export async function startPromotion(deps: PromotionDeps): Promise<PromotionState> {
  if (!deps.buildCommit) throw new Error('Ennek a csomagnak nincs ismert commitja (helyi build), ezért nem adható ki.')
  const token = await deps.loadToken()
  if (!token) throw new Error('Előbb add meg a GitHub-tokent.')
  const response = await deps.fetch(DISPATCH_URL, {
    method: 'POST',
    headers: { ...headers(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: 'dev', inputs: { commit: deps.buildCommit } }),
  })
  if (response.status !== 204 && response.status !== 200) throw new Error(describeGithubStatus(response.status, await githubMessage(response)))
  return promotionState(deps)
}

/** A token kipróbálása mentés előtt: olvashatók-e vele a munkafolyamat futásai. */
export async function verifyGithubToken(fetch: AllowedFetch, token: string): Promise<ConnectionTest> {
  const response = await fetch(RUNS_URL, { method: 'GET', headers: headers(token) })
  if (response.ok) return { ok: true, message: 'A token működik, és a rendszer titoktárolójába került. Az indítás jogát a GitHub az első kiadásnál ellenőrzi.' }
  return { ok: false, message: describeGithubStatus(response.status) }
}
