import { allowedFetch as defaultFetch, type AllowedFetch } from '../allowedFetch'
import { assertReadOnlyQuery } from '../readOnlyGuard'
import type { PersistedQuery } from './defineQuery'
import type { Connection } from './types'

export const FLIGHTLOGGER_ENDPOINT = 'https://api.flightlogger.net/graphql'

export class FlightLoggerHttpError extends Error {
  override readonly name = 'FlightLoggerHttpError'
  constructor(
    readonly status: number,
    readonly queryName: string,
    /** Ennyiszer próbálta újra (átmeneti szerverhibánál). */
    readonly retries = 0,
  ) {
    super(
      `A FlightLogger ${status} HTTP-státusszal válaszolt (${queryName})${retries > 0 ? `, ${retries} újrapróbálás után is` : ''}.` +
        (TRANSIENT_STATUSES.has(status) ? ' A FlightLogger szervere átmenetileg hibázik; próbáld újra néhány perc múlva.' : ''),
    )
  }
}

/**
 * Átmeneti szerverhibák: a kérés (csak olvasó lekérdezés, ALP-03) biztonságosan újrapróbálható.
 * A FlightLogger ilyenkor a saját hibaoldalát adja (500), terhelésnél gyakran csak minden
 * néhányadik kérésnél.
 */
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([500, 502, 503, 504])

export class FlightLoggerGraphQLError extends Error {
  override readonly name = 'FlightLoggerGraphQLError'
  constructor(
    readonly queryName: string,
    readonly messages: readonly string[],
    readonly codes: readonly string[],
  ) {
    super(`A FlightLogger hibát adott a(z) ${queryName} lekérdezésre: ${messages.join(' | ')}`)
  }
}

export class FlightLoggerRateLimitError extends Error {
  override readonly name = 'FlightLoggerRateLimitError'
  constructor(readonly queryName: string) {
    super(`A FlightLogger kéréskorlátja (429) az újrapróbálások után sem engedett (${queryName}).`)
  }
}

export class FlightLoggerTimeoutError extends Error {
  override readonly name = 'FlightLoggerTimeoutError'
  constructor(
    readonly queryName: string,
    seconds: number,
  ) {
    super(`A FlightLogger ${seconds} másodpercen belül sem válaszolt (${queryName}), többszöri próbálkozás után sem.`)
  }
}

export interface RequestEvent {
  readonly queryName: string
  readonly status: number
  readonly durationMs: number
  readonly retryAfterSeconds?: number
}

export interface FlightLoggerClientOptions {
  readonly apiKey: string
  readonly fetch?: AllowedFetch
  readonly sleep?: (ms: number) => Promise<void>
  readonly now?: () => number
  /** Újrapróbálások száma 429, átmeneti szerverhiba (5xx) és időtúllépés után. */
  readonly maxRetries?: number
  /** Ennél hosszabb Retry-After-t nem várunk ki, hanem hibát adunk. */
  readonly maxRetryAfterSeconds?: number
  readonly pageSize?: number
  readonly maxPages?: number
  readonly onRequest?: (event: RequestEvent) => void
  /** Egy kérés legfeljebb ennyi ideig tarthat (ms); utána újrapróbálja, majd hibát ad. */
  readonly requestTimeoutMs?: number
  /**
   * Egyszerre legfeljebb ennyi kérés fut (a párhuzamos betöltéshez); alapból 3. Az első
   * 429-es válasz után a kliens egyesével küld, mert a korlátozott kérés is a korlátba számít.
   */
  readonly maxConcurrent?: number
  /** A közös várakozás meghosszabbodása (ms) 429 után: ennyivel nőtt a tényleges kiesés. */
  readonly onPause?: (addedMs: number) => void
  /**
   * A teljes frissítés megszakítása (H24): ha jelez, a futó kérés leáll, és új kérés nem indul.
   */
  readonly signal?: AbortSignal
}

/** A lapozás elérte a lapszám-korlátot: a hívó kisebb időablakokra bonthatja a kérést. */
export class FlightLoggerPageLimitError extends Error {
  override readonly name = 'FlightLoggerPageLimitError'
  constructor(queryName: string, maxPages: number) {
    super(`A lapozás elérte a ${maxPages} oldalas korlátot (${queryName}).`)
  }
}

/** A felhasználó (vagy egy újabb frissítés) megszakította a letöltést. */
export class FlightLoggerAbortedError extends Error {
  override readonly name = 'FlightLoggerAbortedError'
  constructor() {
    super('A frissítés megszakadt.')
  }
}

/**
 * Lapméret hívásonként. A FlightLogger összetettségi korlátja (5000) a lapméret és a
 * beágyazott kapcsolatok szorzatával nő, ezért a beágyazott lekérdezéseknél kisebb lap kell.
 */
export interface PageOptions {
  readonly pageSize?: number
}

interface GraphQLResponse<T> {
  data?: T | null
  errors?: ReadonlyArray<{ message?: unknown; extensions?: { code?: unknown } }>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** A FlightLogger összetettségi korlátjának hibája (a lapmérettel arányos). */
function isComplexityError(error: unknown): boolean {
  return error instanceof FlightLoggerGraphQLError && error.messages.some((m) => /complexity/i.test(m))
}

/** Retry-After: másodperc vagy HTTP-dátum (RFC 9110). */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === '') return undefined
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) return Number(trimmed)
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, Math.ceil((date - nowMs) / 1000))
}

/**
 * Csak olvasó FlightLogger GraphQL-kliens (ALP-03). Kizárólag `defineQuery`-vel
 * létrehozott, rögzített lekérdezést küld, és küldés előtt újra lefuttatja a guardot.
 * Az API-kulcs csak az Authorization fejlécben szerepel; hibaüzenetbe, naplóba nem kerül.
 */
export class FlightLoggerClient {
  readonly #apiKey: string
  readonly #fetch: AllowedFetch
  readonly #sleep: (ms: number) => Promise<void>
  readonly #now: () => number
  readonly #maxRetries: number
  readonly #maxRetryAfterSeconds: number
  readonly #pageSize: number
  readonly #maxPages: number
  readonly #onRequest: ((event: RequestEvent) => void) | undefined
  readonly #timeoutMs: number
  readonly #maxConcurrent: number
  readonly #onPause: ((addedMs: number) => void) | undefined
  readonly #abort: AbortSignal | undefined
  #running = 0
  readonly #waiting: Array<() => void> = []
  /** Közös szünet a 429 után: addig egyetlen kérés sem indul (időbélyeg, ms). */
  #pausedUntil = 0
  /** Volt-e már 429: onnantól egyesével küldünk. */
  #throttled = false

  constructor(options: FlightLoggerClientOptions) {
    const key = options.apiKey.trim()
    if (key === '') throw new Error('Hiányzik az API-kulcs.')
    this.#apiKey = key
    this.#fetch = options.fetch ?? defaultFetch
    this.#sleep = options.sleep ?? defaultSleep
    this.#now = options.now ?? Date.now
    this.#maxRetries = options.maxRetries ?? 4
    this.#maxRetryAfterSeconds = options.maxRetryAfterSeconds ?? 120
    this.#pageSize = options.pageSize ?? 100
    this.#maxPages = options.maxPages ?? 200
    this.#onRequest = options.onRequest
    this.#timeoutMs = options.requestTimeoutMs ?? 45_000
    this.#maxConcurrent = Math.max(1, options.maxConcurrent ?? 3)
    this.#onPause = options.onPause
    this.#abort = options.signal
  }

  #limit(): number {
    return this.#throttled ? 1 : this.#maxConcurrent
  }

  /** Egyidejű kérések korlátja: a FlightLogger kéréskorlátját a párhuzamos betöltés se terhelje túl. */
  async #acquire(): Promise<void> {
    if (this.#waiting.length === 0 && this.#running < this.#limit()) {
      this.#running++
      return
    }
    await new Promise<void>((resolve) => this.#waiting.push(resolve))
  }

  #release(): void {
    this.#running--
    while (this.#waiting.length > 0 && this.#running < this.#limit()) {
      this.#running++
      this.#waiting.shift()!()
    }
  }

  /**
   * 429 után minden kérés közösen vár (nem egyenként, egyszerre újrapróbálva): a FlightLogger
   * a korlátozott kéréseket is beszámítja, így az egyidejű újrapróbálás csak tovább nyújtaná.
   */
  #pauseFor(ms: number): void {
    this.#throttled = true
    const until = this.#now() + ms
    if (until <= this.#pausedUntil) return
    const added = until - Math.max(this.#pausedUntil, this.#now())
    this.#pausedUntil = until
    this.#onPause?.(added)
  }

  /** Ne kerüljön a kulcs véletlenül naplóba (console.log, JSON.stringify). */
  toJSON(): Record<string, string> {
    return { client: 'FlightLoggerClient' }
  }

  async query<TData, TVariables extends Record<string, unknown>>(
    query: PersistedQuery<TData, TVariables>,
    variables: TVariables,
  ): Promise<TData> {
    assertReadOnlyQuery(query.source)
    await this.#acquire()
    try {
      return await this.#send(query, variables)
    } finally {
      this.#release()
    }
  }

  async #send<TData, TVariables extends Record<string, unknown>>(query: PersistedQuery<TData, TVariables>, variables: TVariables): Promise<TData> {
    assertReadOnlyQuery(query.source)
    const body = JSON.stringify({ query: query.source, variables, operationName: query.name })

    for (let attempt = 0; ; attempt++) {
      if (this.#abort?.aborted) throw new FlightLoggerAbortedError()
      const pause = this.#pausedUntil - this.#now()
      if (pause > 0) await this.#sleep(pause)
      if (this.#abort?.aborted) throw new FlightLoggerAbortedError()
      const started = this.#now()
      // Időkorlát: beragadt kapcsolatnál a betöltés ne álljon meg örökre.
      const timeout = AbortSignal.timeout(this.#timeoutMs)
      const signal = this.#abort ? AbortSignal.any([timeout, this.#abort]) : timeout
      let response: Response
      try {
        response = await this.#fetch(FLIGHTLOGGER_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body,
          signal,
        })
      } catch (error) {
        if (this.#abort?.aborted) throw new FlightLoggerAbortedError()
        if (!signal.aborted) throw error
        this.#onRequest?.({ queryName: query.name, status: 0, durationMs: this.#now() - started })
        if (attempt >= this.#maxRetries) throw new FlightLoggerTimeoutError(query.name, Math.round(this.#timeoutMs / 1000))
        continue
      }
      const durationMs = this.#now() - started

      if (response.status === 429) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'), this.#now())
        this.#onRequest?.({ queryName: query.name, status: 429, durationMs, retryAfterSeconds: retryAfter })
        const waitSeconds = retryAfter ?? Math.min(2 ** attempt, 30)
        if (attempt >= this.#maxRetries || waitSeconds > this.#maxRetryAfterSeconds) {
          throw new FlightLoggerRateLimitError(query.name)
        }
        this.#pauseFor(waitSeconds * 1000)
        continue
      }

      this.#onRequest?.({ queryName: query.name, status: response.status, durationMs })

      // Átmeneti szerverhiba: növekvő várakozással újra (1, 2, 4, 8 s), csak ez a kérés vár.
      if (TRANSIENT_STATUSES.has(response.status)) {
        if (attempt >= this.#maxRetries) throw new FlightLoggerHttpError(response.status, query.name, attempt)
        await this.#sleep(Math.min(2 ** attempt, 8) * 1000)
        continue
      }

      let payload: GraphQLResponse<TData> | undefined
      try {
        payload = (await response.json()) as GraphQLResponse<TData>
      } catch {
        payload = undefined
      }

      if (payload?.errors && payload.errors.length > 0) {
        const messages = payload.errors.map((e) => this.#redact(String(e.message ?? 'ismeretlen hiba')))
        const codes = payload.errors.map((e) => String(e.extensions?.code ?? '')).filter((c) => c !== '')
        throw new FlightLoggerGraphQLError(query.name, messages, codes)
      }
      if (!response.ok) throw new FlightLoggerHttpError(response.status, query.name)
      if (!payload || payload.data === undefined || payload.data === null) {
        throw new FlightLoggerGraphQLError(query.name, ['A válasz nem tartalmaz adatot.'], [])
      }
      return payload.data
    }
  }

  /**
   * Végiglapoz egy kapcsolaton (`first` / `after`). A `select` adja meg, hol van a
   * lapozandó kapcsolat a válaszban (lehet beágyazott is, például a logbooknál).
   */
  async *paginate<TData, TVariables extends Record<string, unknown>, TNode>(
    query: PersistedQuery<TData, TVariables>,
    variables: Omit<TVariables, 'first' | 'after'>,
    select: (data: TData) => Connection<TNode> | null | undefined,
    options: PageOptions = {},
  ): AsyncGenerator<TNode, void, undefined> {
    let after: string | null = null
    let first = options.pageSize ?? this.#pageSize
    for (let page = 0; page < this.#maxPages; page++) {
      const vars = { ...variables, first, after } as unknown as TVariables
      let data: TData
      try {
        data = await this.query(query, vars)
      } catch (error) {
        // Túl összetett lekérdezésnél (nagy lap) az első lapot kisebb lapmérettel kérjük újra;
        // a lapméret csak az első lap előtt változik, így elem nem marad ki.
        if (page === 0 && after === null && first > 10 && isComplexityError(error)) {
          first = Math.max(10, Math.floor(first / 2))
          page--
          continue
        }
        throw error
      }
      const connection = select(data)
      if (!connection) return
      for (const node of connection.nodes ?? []) {
        if (node !== null) yield node
      }
      if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return
      after = connection.pageInfo.endCursor
    }
    throw new FlightLoggerPageLimitError(query.name, this.#maxPages)
  }

  async fetchAll<TData, TVariables extends Record<string, unknown>, TNode>(
    query: PersistedQuery<TData, TVariables>,
    variables: Omit<TVariables, 'first' | 'after'>,
    select: (data: TData) => Connection<TNode> | null | undefined,
    options: PageOptions = {},
  ): Promise<TNode[]> {
    const result: TNode[] = []
    for await (const node of this.paginate(query, variables, select, options)) result.push(node)
    return result
  }

  #redact(text: string): string {
    return text.split(this.#apiKey).join('***')
  }
}
