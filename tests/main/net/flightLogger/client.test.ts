import { describe, expect, it, vi } from 'vitest'
import { createAllowedFetch } from '../../../../src/main/net/allowedFetch'
import {
  FlightLoggerClient,
  FlightLoggerGraphQLError,
  FlightLoggerHttpError,
  FlightLoggerRateLimitError,
  FlightLoggerTimeoutError,
  parseRetryAfter,
} from '../../../../src/main/net/flightLogger/client'
import { defineQuery, type PersistedQuery } from '../../../../src/main/net/flightLogger/defineQuery'
import { AircraftQuery } from '../../../../src/main/net/flightLogger/queries'
import { ReadOnlyViolationError } from '../../../../src/main/net/readOnlyGuard'

// Szintetikus kulcs, nem valódi.
const FAKE_KEY = 'teszt-kulcs-0000'

const json = (value: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

function makeClient(responses: Response[]) {
  const impl = vi.fn(async (_input: string, _init: RequestInit) => {
    const next = responses.shift()
    if (!next) throw new Error('nincs több válasz')
    return next
  })
  const sleep = vi.fn(async (_ms: number) => {})
  const client = new FlightLoggerClient({ apiKey: FAKE_KEY, fetch: createAllowedFetch(impl), sleep, pageSize: 2 })
  return { client, impl, sleep }
}

const Simple = defineQuery<{ a: number }>('Simple', 'query Simple { a }')

describe('FlightLoggerClient időkorlát', () => {
  it('beragadt kérésnél újrapróbál, majd érthető hibát ad (nem vár örökké)', async () => {
    let calls = 0
    // Szintetikus „szerver”, amely soha nem válaszol, csak a megszakításra áll le.
    const hanging = createAllowedFetch(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          calls++
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? new Error('abort')))
        }),
    )
    const client = new FlightLoggerClient({ apiKey: FAKE_KEY, fetch: hanging, requestTimeoutMs: 20, maxRetries: 2 })
    await expect(client.query(Simple, {})).rejects.toBeInstanceOf(FlightLoggerTimeoutError)
    expect(calls).toBe(3)
  })
})

describe('FlightLoggerClient', () => {
  it('POST-tal, Bearer-kulccsal küld, és a rögzített lekérdezést adja át', async () => {
    const { client, impl } = makeClient([json({ data: { a: 1 } })])
    await expect(client.query(Simple, {})).resolves.toEqual({ a: 1 })
    const [url, init] = impl.mock.calls[0]!
    expect(url).toBe('https://api.flightlogger.net/graphql')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${FAKE_KEY}`)
    expect(JSON.parse(init.body as string)).toMatchObject({ query: Simple.source, operationName: 'Simple' })
  })

  it('kézzel összerakott mutation-t nem küld el (a defineQuery megkerülése esetén sem)', async () => {
    const { client, impl } = makeClient([])
    const forged = { name: 'X', source: 'mutation { deleteBookings(ids: ["1"]) }' } as unknown as PersistedQuery<unknown>
    await expect(client.query(forged, {})).rejects.toThrow(ReadOnlyViolationError)
    expect(impl).not.toHaveBeenCalled()
  })

  it('a defineQuery mutation-nel már létrehozáskor hibát dob', () => {
    expect(() => defineQuery('Create', 'mutation { createSingleStudentBooking(input: {}) { id } }')).toThrow(
      ReadOnlyViolationError,
    )
  })

  it('429 esetén kivárja a Retry-After-t, majd újrapróbál', async () => {
    const { client, sleep, impl } = makeClient([
      new Response('', { status: 429, headers: { 'Retry-After': '3' } }),
      json({ data: { a: 2 } }),
    ])
    await expect(client.query(Simple, {})).resolves.toEqual({ a: 2 })
    expect(sleep).toHaveBeenCalledWith(3000)
    expect(impl).toHaveBeenCalledTimes(2)
  })

  it('átmeneti szerverhibánál (500, 503) növekvő várakozással újrapróbál', async () => {
    const page500 = (): Response => new Response('<!DOCTYPE html><title>We are sorry (500)</title>', { status: 500, headers: { 'Content-Type': 'text/html' } })
    const { client, sleep, impl } = makeClient([page500(), new Response('', { status: 503 }), json({ data: { a: 3 } })])
    await expect(client.query(Simple, {})).resolves.toEqual({ a: 3 })
    expect(impl).toHaveBeenCalledTimes(3)
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000])
  })

  it('tartós szerverhibánál az újrapróbálások után érthető hibát ad', async () => {
    const { client, impl } = makeClient(Array.from({ length: 5 }, () => new Response('', { status: 500 })))
    const error = await client.query(Simple, {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FlightLoggerHttpError)
    expect((error as FlightLoggerHttpError).message).toBe('A FlightLogger 500 HTTP-státusszal válaszolt (Simple), 4 újrapróbálás után is. A FlightLogger szervere átmenetileg hibázik; próbáld újra néhány perc múlva.')
    expect(impl).toHaveBeenCalledTimes(5)
  })

  it('nem átmeneti HTTP-hibát (például 401) nem próbál újra', async () => {
    const { client, impl, sleep } = makeClient([new Response('', { status: 401 })])
    await expect(client.query(Simple, {})).rejects.toThrow('A FlightLogger 401 HTTP-státusszal válaszolt (Simple).')
    expect(impl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('túl hosszú Retry-After esetén nem vár, hanem hibát ad', async () => {
    const { client, sleep } = makeClient([new Response('', { status: 429, headers: { 'Retry-After': '3600' } })])
    await expect(client.query(Simple, {})).rejects.toThrow(FlightLoggerRateLimitError)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('a GraphQL-hibát továbbadja, a kulcsot kitakarja belőle', async () => {
    const { client } = makeClient([json({ errors: [{ message: `rossz kulcs: ${FAKE_KEY}`, extensions: { code: 'UNAUTHENTICATED' } }] })])
    const error = await client.query(Simple, {}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(FlightLoggerGraphQLError)
    expect((error as Error).message).not.toContain(FAKE_KEY)
    expect((error as FlightLoggerGraphQLError).codes).toEqual(['UNAUTHENTICATED'])
  })

  it('a kulcs nem jelenik meg a kliens szerializálásakor', () => {
    const { client } = makeClient([])
    expect(JSON.stringify(client)).not.toContain(FAKE_KEY)
    expect(String(client)).not.toContain(FAKE_KEY)
  })

  it('végiglapoz a kapcsolaton', async () => {
    const page = (ids: string[], hasNextPage: boolean, endCursor: string | null) =>
      json({ data: { aircraft: { pageInfo: { hasNextPage, endCursor }, nodes: ids.map((id) => ({ id })) } } })
    const { client, impl } = makeClient([page(['1', '2'], true, 'c1'), page(['3'], false, null)])
    const nodes = await client.fetchAll(AircraftQuery, { from: 'x', to: 'y' }, (d) => d.aircraft)
    expect(nodes.map((n) => n.id)).toEqual(['1', '2', '3'])
    const second = JSON.parse(impl.mock.calls[1]![1].body as string)
    expect(second.variables).toMatchObject({ first: 2, after: 'c1', from: 'x', to: 'y' })
  })
})

describe('FlightLoggerClient párhuzamossági korlát', () => {
  it('egyszerre legfeljebb maxConcurrent kérés fut', async () => {
    let running = 0
    let peak = 0
    const impl = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return json({ data: { user: { id: 'u1' } } })
    })
    const client = new FlightLoggerClient({ apiKey: FAKE_KEY, fetch: createAllowedFetch(impl), maxConcurrent: 2 })
    const query = defineQuery<{ user: { id: string } }, Record<string, never>>('Viewer', 'query Viewer { user { id } }')
    await Promise.all(Array.from({ length: 7 }, () => client.query(query, {})))
    expect(impl).toHaveBeenCalledTimes(7)
    expect(peak).toBe(2)
  })
})

describe('FlightLoggerClient kéréskorlát (429) párhuzamos kéréseknél', () => {
  it('429 után közösen vár, egyszer, és onnantól egyesével küld', async () => {
    let clock = 0
    let running = 0
    let peak = 0
    let limited = false
    const impl = vi.fn(async () => {
      running++
      peak = Math.max(peak, running)
      await Promise.resolve()
      running--
      if (!limited) {
        limited = true
        return new Response('{}', { status: 429, headers: { 'Retry-After': '10' } })
      }
      return json({ data: { user: { id: 'u1' } } })
    })
    const pauses: number[] = []
    const sleep = vi.fn(async (ms: number) => {
      clock += ms
    })
    const client = new FlightLoggerClient({ apiKey: FAKE_KEY, fetch: createAllowedFetch(impl), sleep, now: () => clock, maxConcurrent: 3, onPause: (ms) => pauses.push(ms) })
    const query = defineQuery<{ user: { id: string } }, Record<string, never>>('Viewer', 'query Viewer { user { id } }')
    await Promise.all(Array.from({ length: 6 }, () => client.query(query, {})))
    expect(pauses).toEqual([10_000])
    expect(impl).toHaveBeenCalledTimes(7)
    peak = 0
    await Promise.all(Array.from({ length: 4 }, () => client.query(query, {})))
    expect(peak).toBe(1)
  })

  it('túl összetett lapnál kisebb lapmérettel újrakéri az első lapot', async () => {
    const sizes: number[] = []
    const impl = vi.fn(async (_url: string, init: RequestInit) => {
      const first = (JSON.parse(init.body as string) as { variables: { first: number } }).variables.first
      sizes.push(first)
      if (first > 25) return json({ errors: [{ message: 'Query has complexity of 9000, which exceeds max complexity of 5000' }] })
      return json({ data: { aircraft: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'a1' }] } } })
    })
    const client = new FlightLoggerClient({ apiKey: FAKE_KEY, fetch: createAllowedFetch(impl) })
    const nodes = await client.fetchAll(AircraftQuery, {}, (d) => d.aircraft)
    expect(nodes).toHaveLength(1)
    expect(sizes).toEqual([100, 50, 25])
  })
})

describe('parseRetryAfter', () => {
  it('másodpercet és HTTP-dátumot is értelmez', () => {
    expect(parseRetryAfter('5', 0)).toBe(5)
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 0)).toBe(10)
    expect(parseRetryAfter(null, 0)).toBeUndefined()
    expect(parseRetryAfter('valami', 0)).toBeUndefined()
  })
})
