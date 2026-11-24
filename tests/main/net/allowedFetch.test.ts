import { describe, expect, it, vi } from 'vitest'
import { createAllowedDownload, createAllowedFetch, NetworkPolicyError } from '../../../src/main/net/allowedFetch'
import { RELEASE_REPO } from '../../../src/main/net/releaseRepo'
import { ReadOnlyViolationError } from '../../../src/main/net/readOnlyGuard'

function setup() {
  const impl = vi.fn(async (_input: string, _init: RequestInit) => new Response('{}', { status: 200 }))
  return { impl, fetch: createAllowedFetch(impl) }
}

const QUERY_BODY = JSON.stringify({ query: 'query A { aircraft { nodes { id } } }' })
const MUTATION_BODY = JSON.stringify({ query: 'mutation { deleteBookings(ids: ["1"]) }' })

describe('allowedFetch (ALP-02, ALP-03)', () => {
  it('engedi a FlightLogger GraphQL query-t, átirányítás és süti nélkül', async () => {
    const { impl, fetch } = setup()
    await fetch('https://api.flightlogger.net/graphql', { method: 'POST', body: QUERY_BODY })
    expect(impl).toHaveBeenCalledOnce()
    const init = impl.mock.calls[0]![1]
    expect(init.redirect).toBe('error')
    expect(init.credentials).toBe('omit')
  })

  it('engedi az Open-Meteo GET kérést', async () => {
    const { impl, fetch } = setup()
    await fetch('https://api.open-meteo.com/v1/forecast?latitude=1&longitude=2', { method: 'GET' })
    expect(impl).toHaveBeenCalledOnce()
  })

  it('a METAR-kérés csak GET, csak a /api/data/metar útvonal, és csak ICAO-kód meg időablak mehet ki', async () => {
    const { impl, fetch } = setup()
    await fetch('https://aviationweather.gov/api/data/metar?ids=XXXX&format=json&hours=168&date=20261108_0000', { method: 'GET' })
    expect(impl).toHaveBeenCalledOnce()
    const rejected = [
      'https://aviationweather.gov/api/data/taf?ids=XXXX&format=json',
      'https://aviationweather.gov/api/data/metar?ids=XXXX,YYYY&format=json',
      'https://aviationweather.gov/api/data/metar?ids=XXXX&format=json&name=valaki',
      'https://aviationweather.gov/api/data/metar?ids=xxxx&format=json',
      'https://aviationweather.gov/api/data/metar?ids=XXXX&format=raw',
      'https://www.aviationweather.gov/api/data/metar?ids=XXXX&format=json',
    ]
    for (const url of rejected) await expect(fetch(url, { method: 'GET' })).rejects.toBeInstanceOf(NetworkPolicyError)
    await expect(fetch('https://aviationweather.gov/api/data/metar?ids=XXXX&format=json', { method: 'POST', body: '{}' })).rejects.toBeInstanceOf(NetworkPolicyError)
    expect(impl).toHaveBeenCalledOnce()
  })

  it('a mutation-t a hálózat elérése előtt elutasítja', async () => {
    const { impl, fetch } = setup()
    await expect(fetch('https://api.flightlogger.net/graphql', { method: 'POST', body: MUTATION_BODY })).rejects.toThrow(
      ReadOnlyViolationError,
    )
    expect(impl).not.toHaveBeenCalled()
  })

  it.each([
    ['idegen hoszt', 'https://example.com/graphql', 'POST'],
    ['hasonló nevű hoszt', 'https://api.flightlogger.net.example.com/graphql', 'POST'],
    ['FlightLogger aldomain', 'https://evil.api.flightlogger.net/graphql', 'POST'],
    ['FlightLogger súgó', 'https://help.flightlogger.net/graphql', 'POST'],
    ['titkosítatlan http', 'http://api.flightlogger.net/graphql', 'POST'],
    ['hitelesítő adat az URL-ben', 'https://user:pw@api.flightlogger.net/graphql', 'POST'],
    ['nem szabványos port', 'https://api.flightlogger.net:8443/graphql', 'POST'],
    ['FlightLogger GET (lekérdezés az URL-ben)', 'https://api.flightlogger.net/graphql', 'GET'],
    ['FlightLogger más útvonal', 'https://api.flightlogger.net/playground', 'POST'],
    ['FlightLogger query string', 'https://api.flightlogger.net/graphql?query=x', 'POST'],
    ['Open-Meteo POST', 'https://api.open-meteo.com/v1/forecast', 'POST'],
    ['Open-Meteo más útvonal', 'https://api.open-meteo.com/v1/archive', 'GET'],
    ['Open-Meteo fizetős hoszt', 'https://customer-api.open-meteo.com/v1/forecast', 'GET'],
    ['érvénytelen URL', 'nem url', 'GET'],
  ] as const)('elutasítja: %s', async (_label, url, method) => {
    const { impl, fetch } = setup()
    const body = method === 'POST' && url.includes('flightlogger') ? QUERY_BODY : undefined
    await expect(fetch(url, { method, body })).rejects.toThrow(NetworkPolicyError)
    expect(impl).not.toHaveBeenCalled()
  })

  it('az Open-Meteo felé nem enged kéréstörzset', async () => {
    const { impl, fetch } = setup()
    await expect(fetch('https://api.open-meteo.com/v1/forecast', { method: 'GET', body: 'x' })).rejects.toThrow(
      NetworkPolicyError,
    )
    expect(impl).not.toHaveBeenCalled()
  })

  describe('GitHub-kiadások (FRS-02, FRS-03)', () => {
    const repo = `${RELEASE_REPO.owner}/${RELEASE_REPO.name}`
    const download = `https://github.com/${repo}/releases/download/v0.1.3-dev.4/FoglalastervezoDev-0.1.3-dev.4-mac-arm64.zip`

    it('engedi a saját repó kiadáslistáját, csak GET és csak per_page paraméterrel', async () => {
      const { impl, fetch } = setup()
      await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, { method: 'GET' })
      expect(impl).toHaveBeenCalledOnce()
      expect(impl.mock.calls[0]![1].redirect).toBe('error')
    })

    it.each([
      ['más repó kiadásai', 'https://api.github.com/repos/valaki/mas/releases'],
      ['más API-útvonal', `https://api.github.com/repos/${repo}/issues`],
      ['egy kiadás részletei', `https://api.github.com/repos/${repo}/releases/latest`],
      ['idegen paraméter', `https://api.github.com/repos/${repo}/releases?q=valami`],
      ['felhasználói adat', 'https://api.github.com/user'],
      ['más repó letöltése', 'https://github.com/valaki/mas/releases/download/v0.1.0/x.zip'],
      ['letöltés paraméterrel', `${download}?token=x`],
      ['letöltés idegen címkével', `https://github.com/${repo}/releases/download/latest/x.zip`],
      ['letöltés útvonal-kiugrással', `https://github.com/${repo}/releases/download/v0.1.0/../../x`],
      ['github.com más oldala', `https://github.com/${repo}`],
      ['fájltárhely közvetlenül', 'https://release-assets.githubusercontent.com/github-production-release-asset/1/x'],
      ['raw tartalom', `https://raw.githubusercontent.com/${repo}/main/package.json`],
    ] as const)('elutasítja: %s', async (_label, url) => {
      const { impl, fetch } = setup()
      await expect(fetch(url, { method: 'GET' })).rejects.toThrow(NetworkPolicyError)
      expect(impl).not.toHaveBeenCalled()
    })

    it('a kiadáslistához nem enged POST-ot és kéréstörzset', async () => {
      const { impl, fetch } = setup()
      await expect(fetch(`https://api.github.com/repos/${repo}/releases`, { method: 'POST', body: '{}' })).rejects.toThrow(NetworkPolicyError)
      await expect(fetch(`https://api.github.com/repos/${repo}/releases`, { method: 'GET', body: '{}' })).rejects.toThrow(NetworkPolicyError)
      expect(impl).not.toHaveBeenCalled()
    })

    it('a letöltés egyetlen átirányítást követ, csak a GitHub fájltárhelyére', async () => {
      const target = 'https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sp=r&sig=x'
      const impl = vi.fn(async (input: string, _init: RequestInit) =>
        input.startsWith('https://github.com/') ? new Response(null, { status: 302, headers: { location: target } }) : new Response('adat', { status: 200 }),
      )
      const response = await createAllowedDownload(impl)(download)
      expect(await response.text()).toBe('adat')
      expect(impl.mock.calls.map((c) => c[0])).toEqual([download, target])
      expect(impl.mock.calls[0]![1].redirect).toBe('manual')
      expect(impl.mock.calls[1]![1].redirect).toBe('error')
      expect(impl.mock.calls.every((c) => c[1].credentials === 'omit')).toBe(true)
    })

    it.each([
      ['idegen hoszt', 'https://example.com/x.zip'],
      ['http', 'http://release-assets.githubusercontent.com/x'],
      ['hasonló nevű hoszt', 'https://release-assets.githubusercontent.com.example.com/x'],
      ['hitelesítő adat', 'https://a:b@objects.githubusercontent.com/x'],
    ] as const)('az átirányítást elutasítja: %s', async (_label, location) => {
      const impl = vi.fn(async (_input: string, _init: RequestInit) => new Response(null, { status: 302, headers: { location } }))
      await expect(createAllowedDownload(impl)(download)).rejects.toThrow(NetworkPolicyError)
      expect(impl).toHaveBeenCalledOnce()
    })

    it('letöltés csak a github.com kiadási címéről indulhat', async () => {
      const impl = vi.fn(async (_input: string, _init: RequestInit) => new Response('{}'))
      await expect(createAllowedDownload(impl)(`https://api.github.com/repos/${repo}/releases`)).rejects.toThrow(NetworkPolicyError)
      expect(impl).not.toHaveBeenCalled()
    })
  })
})
