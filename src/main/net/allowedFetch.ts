import { z } from 'zod'
import { assertReadOnlyRequestBody } from './readOnlyGuard'
import { RELEASE_REPO } from './releaseRepo'

/**
 * Engedélyezési lista (ALP-02). Ez az alkalmazás egyetlen pontja, ahol hálózati
 * kérés indulhat; az ESLint minden más fájlban tiltja a fetch-et.
 *
 * - api.flightlogger.net: csak POST /graphql, és a törzs csak olvasó lekérdezés (ALP-03).
 * - api.open-meteo.com: csak GET, törzs nélkül.
 * - aviationweather.gov: csak GET /api/data/metar, törzs nélkül; a lekérdezésben csak az ICAO-kód
 *   és az időablak lehet (ids, hours, date, format) – a modellpontosság méréséhez (ADT-07).
 * - api.github.com: csak GET, csak a program saját repójának kiadáslistája (FRS-02).
 * - github.com: csak GET, csak a saját repó egy kiadási fájlja; innen egyetlen átirányítás
 *   engedett a GitHub fájltárhelyére (`allowedDownload`). Személyes adat egyik felé sem megy.
 * - Csak a fejlesztői (DEV) változatban, külön belépési ponton (`createDevPromoteFetch`): a saját repó
 *   „Kiadás: dev → main” munkafolyamatának indítása és utolsó futásai, a fejlesztő GitHub-tokenjével
 *   (FRS-09). A fő változatban ez a kérés nem indulhat el.
 * Más átirányítást nem követünk, mert az kivezethetne a listáról.
 */

export const FLIGHTLOGGER_HOST = 'api.flightlogger.net'
export const OPEN_METEO_HOST = 'api.open-meteo.com'
export const AVIATION_WEATHER_HOST = 'aviationweather.gov'
export const GITHUB_API_HOST = 'api.github.com'
export const GITHUB_HOST = 'github.com'
/** A kiadási fájlok tárhelyei: csak a github.com letöltési címének átirányításaként érhetők el. */
export const RELEASE_ASSET_HOSTS: readonly string[] = ['release-assets.githubusercontent.com', 'objects.githubusercontent.com']

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** A saját repó kiadáslistája (FRS-02). */
export const RELEASES_API_PATH = `/repos/${RELEASE_REPO.owner}/${RELEASE_REPO.name}/releases`
/** A saját repó egy kiadási fájlja: `/<owner>/<repo>/releases/download/v<verzió>/<fájlnév>`. */
const RELEASE_DOWNLOAD_PATH = new RegExp(
  `^/${escapeRegExp(RELEASE_REPO.owner)}/${escapeRegExp(RELEASE_REPO.name)}/releases/download/v\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}(?:-dev\\.\\d{1,6})?/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$`,
)

const noBody = (host: string) => (body: unknown): void => {
  if (body !== undefined && body !== null) throw new NetworkPolicyError(`A(z) ${host} felé nem mehet kéréstörzs.`)
}

/** A METAR-kérés csak ezeket a paramétereket viheti, csak ezekkel az értékekkel. */
const METAR_PARAMS: Readonly<Record<string, RegExp>> = {
  ids: /^[A-Z]{4}$/,
  format: /^json$/,
  hours: /^\d{1,3}$/,
  date: /^\d{8}_\d{4}$/,
}

interface HostRule {
  readonly methods: readonly string[]
  /** Pontos útvonalak; vagy `pathPattern`. */
  readonly paths?: readonly string[]
  readonly pathPattern?: RegExp
  /** Ha meg van adva, az URL csak ezeket a paramétereket viheti, csak ilyen értékkel. */
  readonly queryParams?: Readonly<Record<string, RegExp>>
  readonly checkBody: (body: unknown) => void
}

const RULES: Readonly<Record<string, HostRule>> = {
  [FLIGHTLOGGER_HOST]: {
    methods: ['POST'],
    paths: ['/graphql'],
    checkBody: assertReadOnlyRequestBody,
  },
  [OPEN_METEO_HOST]: {
    methods: ['GET'],
    paths: ['/v1/forecast'],
    checkBody: (body) => {
      if (body !== undefined && body !== null) throw new NetworkPolicyError('Az Open-Meteo felé nem mehet kéréstörzs.')
    },
  },
  [AVIATION_WEATHER_HOST]: {
    methods: ['GET'],
    paths: ['/api/data/metar'],
    queryParams: METAR_PARAMS,
    checkBody: noBody(AVIATION_WEATHER_HOST),
  },
  [GITHUB_API_HOST]: {
    methods: ['GET'],
    paths: [RELEASES_API_PATH],
    queryParams: { per_page: /^\d{1,3}$/ },
    checkBody: noBody(GITHUB_API_HOST),
  },
  [GITHUB_HOST]: {
    methods: ['GET'],
    pathPattern: RELEASE_DOWNLOAD_PATH,
    queryParams: {},
    checkBody: noBody(GITHUB_HOST),
  },
}

export class NetworkPolicyError extends Error {
  override readonly name = 'NetworkPolicyError'
}

export interface AllowedRequestInit {
  readonly method: 'GET' | 'POST'
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: string
  readonly signal?: AbortSignal
}

export type AllowedFetch = (url: string, init: AllowedRequestInit) => Promise<Response>

type FetchImpl = (input: string, init: RequestInit) => Promise<Response>

function parseHttpsUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new NetworkPolicyError('Érvénytelen URL, a kérés nem indul el.')
  }
  if (url.protocol !== 'https:') throw new NetworkPolicyError(`Csak https engedett, ${url.protocol} nem.`)
  if (url.username || url.password) throw new NetworkPolicyError('Az URL nem tartalmazhat hitelesítő adatot.')
  if (url.port !== '') throw new NetworkPolicyError('Nem szabványos port nem engedett.')
  return url
}

/** Kivételt dob, ha a kérés nem felel meg az engedélyezési listának. Hálózatot nem ér. */
export function assertRequestAllowed(rawUrl: string, init: AllowedRequestInit): URL {
  const url = parseHttpsUrl(rawUrl)
  const rule = Object.hasOwn(RULES, url.hostname) ? RULES[url.hostname] : undefined
  if (!rule) throw new NetworkPolicyError(`A(z) ${url.hostname} hoszt nincs az engedélyezési listán.`)
  if (!rule.methods.includes(init.method)) {
    throw new NetworkPolicyError(`${init.method} kérés nem engedett a(z) ${url.hostname} felé.`)
  }
  const pathOk = rule.pathPattern ? rule.pathPattern.test(url.pathname) : (rule.paths ?? []).includes(url.pathname)
  if (!pathOk) {
    throw new NetworkPolicyError(`A(z) ${url.pathname} útvonal nem engedett a(z) ${url.hostname} felé.`)
  }
  if (url.hostname === FLIGHTLOGGER_HOST && url.search !== '') {
    throw new NetworkPolicyError('A FlightLogger felé nem mehet lekérdezés az URL-ben.')
  }
  if (rule.queryParams) {
    for (const [key, value] of url.searchParams) {
      const pattern = Object.hasOwn(rule.queryParams, key) ? rule.queryParams[key] : undefined
      if (!pattern || !pattern.test(value)) throw new NetworkPolicyError(`A kérésben nem engedett paraméter: ${key}.`)
    }
  }
  rule.checkBody(init.body)
  return url
}

/**
 * A kiadási fájl átirányításának célja: csak https, csak a GitHub fájltárhelye, port és
 * hitelesítő adat nélkül. (Az aláírt URL lekérdezési paramétereit a GitHub adja.)
 */
export function assertRedirectTargetAllowed(location: string | null): URL {
  if (!location) throw new NetworkPolicyError('A letöltés átirányítása cél nélkül érkezett.')
  const url = parseHttpsUrl(location)
  if (!RELEASE_ASSET_HOSTS.includes(url.hostname)) {
    throw new NetworkPolicyError(`A letöltés átirányítása nem engedett hosztra mutat: ${url.hostname}.`)
  }
  return url
}

export function createAllowedFetch(fetchImpl: FetchImpl): AllowedFetch {
  return async (rawUrl, init) => {
    const url = assertRequestAllowed(rawUrl, init)
    const requestInit: RequestInit = {
      method: init.method,
      redirect: 'error',
      credentials: 'omit',
    }
    if (init.headers) requestInit.headers = { ...init.headers }
    if (init.body !== undefined) requestInit.body = init.body
    if (init.signal) requestInit.signal = init.signal
    return fetchImpl(url.toString(), requestInit)
  }
}

export interface AllowedDownloadInit {
  readonly headers?: Readonly<Record<string, string>>
  readonly signal?: AbortSignal
}

/** Egy kiadási fájl letöltése a github.com címéről, legfeljebb egy engedett átirányítással. */
export type AllowedDownload = (url: string, init?: AllowedDownloadInit) => Promise<Response>

export function createAllowedDownload(fetchImpl: FetchImpl): AllowedDownload {
  return async (rawUrl, init = {}) => {
    const url = assertRequestAllowed(rawUrl, { method: 'GET' })
    if (url.hostname !== GITHUB_HOST) throw new NetworkPolicyError('Letöltés csak a kiadások címéről indulhat.')
    const base: RequestInit = { method: 'GET', credentials: 'omit' }
    if (init.headers) base.headers = { ...init.headers }
    if (init.signal) base.signal = init.signal
    const first = await fetchImpl(url.toString(), { ...base, redirect: 'manual' })
    if (first.status < 300 || first.status >= 400) return first
    const target = assertRedirectTargetAllowed(first.headers.get('location'))
    await first.body?.cancel().catch(() => undefined)
    return fetchImpl(target.toString(), { ...base, redirect: 'error' })
  }
}

/** A „Kiadás: dev → main” munkafolyamat (promote.yml) a saját repóban (FRS-09). */
export const PROMOTE_WORKFLOW_PATH = `/repos/${RELEASE_REPO.owner}/${RELEASE_REPO.name}/actions/workflows/promote.yml`
export const PROMOTE_DISPATCH_PATH = `${PROMOTE_WORKFLOW_PATH}/dispatches`
export const PROMOTE_RUNS_PATH = `${PROMOTE_WORKFLOW_PATH}/runs`

/** Az indítás törzse: csak a dev ág és a kiadandó (a DEV-ben kipróbált) commit. */
const PromoteDispatchBody = z.strictObject({ ref: z.literal('dev'), inputs: z.strictObject({ commit: z.string().regex(/^[0-9a-f]{40}$/) }) })

/** A DEV-gomb kérése: POST az indításra (rögzített törzzsel), vagy GET az utolsó futásokra. */
export function assertPromoteRequestAllowed(rawUrl: string, init: AllowedRequestInit): URL {
  const url = parseHttpsUrl(rawUrl)
  if (url.hostname !== GITHUB_API_HOST) throw new NetworkPolicyError(`A kiadás indítása csak a(z) ${GITHUB_API_HOST} felé mehet.`)
  if (init.method === 'POST') {
    if (url.pathname !== PROMOTE_DISPATCH_PATH || url.search !== '') throw new NetworkPolicyError('Csak a „Kiadás: dev → main” munkafolyamat indítható.')
    let body: unknown
    try {
      body = JSON.parse(init.body ?? '')
    } catch {
      throw new NetworkPolicyError('A kiadás indításának törzse érvénytelen.')
    }
    if (!PromoteDispatchBody.safeParse(body).success) throw new NetworkPolicyError('A kiadás indításának törzse csak a dev ág és egy commit-azonosító lehet.')
    return url
  }
  if (url.pathname !== PROMOTE_RUNS_PATH) throw new NetworkPolicyError('Csak a „Kiadás: dev → main” futásai kérdezhetők le.')
  for (const [key, value] of url.searchParams) {
    const ok = (key === 'per_page' && /^\d{1,2}$/.test(value)) || (key === 'event' && value === 'workflow_dispatch')
    if (!ok) throw new NetworkPolicyError(`A kérésben nem engedett paraméter: ${key}.`)
  }
  noBody(GITHUB_API_HOST)(init.body)
  return url
}

/**
 * A DEV-gomb hálózati belépési pontja (FRS-09). Csak a fejlesztői csatornán hozható létre: a fő
 * változatban (és helyi buildben) kivételt dob, így ott ez a kérés el sem indulhat.
 */
export function createPromoteFetch(fetchImpl: FetchImpl, channel: string | null): AllowedFetch {
  if (channel !== 'dev') throw new NetworkPolicyError('A kiadás indítása csak a fejlesztői (DEV) változatban engedett.')
  return async (rawUrl, init) => {
    const url = assertPromoteRequestAllowed(rawUrl, init)
    const requestInit: RequestInit = { method: init.method, redirect: 'error', credentials: 'omit' }
    if (init.headers) requestInit.headers = { ...init.headers }
    if (init.body !== undefined) requestInit.body = init.body
    if (init.signal) requestInit.signal = init.signal
    return fetchImpl(url.toString(), requestInit)
  }
}

export const createDevPromoteFetch = (channel: string | null): AllowedFetch => createPromoteFetch((input, init) => globalThis.fetch(input, init), channel)

/** Az alkalmazás egyetlen éles hálózati belépési pontja. */
export const allowedFetch: AllowedFetch = createAllowedFetch((input, init) => globalThis.fetch(input, init))

/** A frissítő letöltései (FRS-03), ugyanazon az engedélyezési listán át. */
export const allowedDownload: AllowedDownload = createAllowedDownload((input, init) => globalThis.fetch(input, init))
