import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { Manifest } from '../../../src/core/update/manifest'
import type { UpdateState } from '../../../src/shared/api'
import { createGithubReleaseSource } from '../../../src/main/update/githubSource'
import { createUpdater, type Installer, type ReleaseSource, type UpdatePrefs } from '../../../src/main/update/updaterCore'
import { createManifestVerifier, sha512Base64 } from '../../../src/main/update/verify'

/** Szintetikus kiadások és kulcsok; hálózat nincs. */

const keys = generateKeyPairSync('ed25519')
const publicPem = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
const otherKeys = generateKeyPairSync('ed25519')

const PAYLOAD = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
const sha512 = (data: Uint8Array) => createHash('sha512').update(data).digest('base64')

function manifest(version: string, channel: 'stable' | 'dev', data: Uint8Array = PAYLOAD): Manifest {
  return {
    app: 'flightbooker',
    channel,
    version,
    createdAt: '2026-11-24T10:00:00Z',
    assets: [
      { platform: 'darwin', arch: 'arm64', kind: 'zip', name: `app-${version}-mac-arm64.zip`, size: data.byteLength, sha512: sha512(data) },
      { platform: 'win32', arch: 'x64', kind: 'nsis', name: `app-${version}-win-x64-setup.exe`, size: data.byteLength, sha512: sha512(data) },
    ],
  }
}

function envelope(m: Manifest, privateKey = keys.privateKey): string {
  const payload = JSON.stringify(m)
  return JSON.stringify({ format: 1, payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') })
}

interface FakeRelease {
  readonly version: string
  readonly manifestText: string
  readonly data?: Uint8Array
}

function fakeSource(releases: readonly FakeRelease[]): ReleaseSource & { downloads: string[] } {
  const downloads: string[] = []
  const files = new Map<string, Uint8Array>()
  const list = releases.map((r) => {
    const tag = `v${r.version}`
    const base = `https://github.com/o/r/releases/download/${tag}`
    const parsed = JSON.parse(JSON.parse(r.manifestText).payload) as Manifest
    files.set(`${base}/update-manifest.json`, new TextEncoder().encode(r.manifestText))
    for (const a of parsed.assets) files.set(`${base}/${a.name}`, r.data ?? PAYLOAD)
    return {
      tag_name: tag,
      draft: false,
      prerelease: r.version.includes('-dev.'),
      html_url: `https://github.com/o/r/releases/tag/${tag}`,
      assets: [
        { name: 'update-manifest.json', size: r.manifestText.length, browser_download_url: `${base}/update-manifest.json` },
        ...parsed.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: `${base}/${a.name}` })),
      ],
    }
  })
  return {
    downloads,
    async listReleases() {
      return list
    },
    async download(url, options) {
      downloads.push(url)
      const data = files.get(url)
      if (!data) throw new Error(`nincs ilyen: ${url}`)
      options.onProgress?.(data.byteLength)
      return data
    },
  }
}

function setup(options: {
  channel?: 'stable' | 'dev' | null
  current?: string
  releases?: readonly FakeRelease[]
  source?: ReleaseSource
  prefs?: UpdatePrefs
  blocker?: string | null
  platform?: string
}) {
  const installed: string[] = []
  const installer: Installer = {
    blocker: async () => options.blocker ?? null,
    install: vi.fn(async (asset) => {
      installed.push(asset.name)
    }),
  }
  let prefs: UpdatePrefs = options.prefs ?? { autoUpdate: true }
  const source = options.source ?? fakeSource(options.releases ?? [])
  const updater = createUpdater({
    channel: options.channel === undefined ? 'stable' : options.channel,
    currentVersion: options.current ?? '0.1.0',
    platform: options.platform ?? 'darwin',
    arch: 'arm64',
    source,
    verifyManifest: createManifestVerifier([publicPem]),
    sha512: sha512Base64,
    installer,
    prefs: {
      load: async () => prefs,
      save: async (p) => {
        prefs = p
      },
    },
    now: () => new Date('2026-11-24T12:00:00Z'),
  })
  const states: UpdateState[] = []
  updater.subscribe((s) => states.push(s))
  return { updater, installer, installed, states, source, getPrefs: () => prefs }
}

const stable = (version: string, data?: Uint8Array): FakeRelease => ({ version, manifestText: envelope(manifest(version, 'stable', data)), ...(data ? { data } : {}) })

describe('frissítő (FRS-01–FRS-08)', () => {
  it('ha nincs újabb kiadás, a program simán indul', async () => {
    const { updater, installed } = setup({ current: '0.1.3', releases: [stable('0.1.3'), stable('0.1.2')] })
    expect(updater.getState().startup).toBe(true)
    await updater.runStartupCheck()
    expect(updater.getState()).toMatchObject({ phase: 'up-to-date', startup: false })
    expect(installed).toEqual([])
  })

  it('újabb kiadásnál automatikusan letölti, ellenőrzi és telepíti a géphez illő fájlt', async () => {
    const { updater, installed, states } = setup({ current: '0.1.2', releases: [stable('0.1.3'), stable('0.1.2')] })
    await updater.runStartupCheck()
    expect(installed).toEqual(['app-0.1.3-mac-arm64.zip'])
    expect(states.map((s) => s.phase)).toEqual(expect.arrayContaining(['checking', 'available', 'downloading', 'installing']))
    // A telepítő kilépteti a programot; addig a felület nem tölt be adatot.
    expect(updater.getState()).toMatchObject({ phase: 'installing', startup: true })
  })

  it('kikapcsolt automatikus frissítésnél csak jelez, a telepítést a felhasználó indítja', async () => {
    const { updater, installed } = setup({ current: '0.1.2', releases: [stable('0.1.3')], prefs: { autoUpdate: false } })
    await updater.runStartupCheck()
    expect(updater.getState()).toMatchObject({ phase: 'available', latestVersion: '0.1.3', startup: false, canInstall: true, autoUpdate: false })
    expect(installed).toEqual([])
    await updater.installAvailable()
    expect(installed).toEqual(['app-0.1.3-mac-arm64.zip'])
  })

  it('a beállítás menthető, és a kézi ellenőrzés nem telepít', async () => {
    const { updater, installed, getPrefs } = setup({ current: '0.1.2', releases: [stable('0.1.3')] })
    await updater.setAutoUpdate(false)
    expect(getPrefs()).toEqual({ autoUpdate: false })
    const state = await updater.checkNow()
    expect(state).toMatchObject({ phase: 'available', latestVersion: '0.1.3' })
    expect(installed).toEqual([])
  })

  it('a fejlesztői változat csak a dev-kiadásokat követi', async () => {
    const dev = (v: string): FakeRelease => ({ version: v, manifestText: envelope(manifest(v, 'dev')) })
    const { updater, installed } = setup({ channel: 'dev', current: '0.1.3-dev.4', releases: [stable('0.2.0'), dev('0.1.3-dev.5'), dev('0.1.3-dev.3')] })
    await updater.runStartupCheck()
    expect(installed).toEqual(['app-0.1.3-dev.5-mac-arm64.zip'])
  })

  it('hamis aláírásnál nem telepít, és a program indul', async () => {
    const forged: FakeRelease = { version: '0.1.3', manifestText: envelope(manifest('0.1.3', 'stable'), otherKeys.privateKey) }
    const { updater, installed } = setup({ current: '0.1.2', releases: [forged] })
    await updater.runStartupCheck()
    expect(installed).toEqual([])
    expect(updater.getState()).toMatchObject({ phase: 'error', startup: false })
    expect(updater.getState().message).toMatch(/aláírás/)
  })

  it('a más csatornára vagy verzióra szóló leírást elutasítja', async () => {
    const wrong: FakeRelease = { version: '0.1.3', manifestText: envelope(manifest('0.1.3-dev.9', 'dev')) }
    const { updater, installed } = setup({ current: '0.1.2', releases: [wrong] })
    await updater.runStartupCheck()
    expect(installed).toEqual([])
    expect(updater.getState().phase).toBe('error')
  })

  it('ha a letöltött fájl lenyomata nem egyezik, nem telepít', async () => {
    const release = stable('0.1.3')
    const tampered: FakeRelease = { ...release, data: new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]) }
    const { updater, installed } = setup({ current: '0.1.2', releases: [tampered] })
    await updater.runStartupCheck()
    expect(installed).toEqual([])
    expect(updater.getState()).toMatchObject({ phase: 'error', startup: false })
  })

  it('ha a gépen nem telepíthető (pl. nem az Alkalmazások mappából fut), jelzi, de nem telepít', async () => {
    const { updater, installed } = setup({ current: '0.1.2', releases: [stable('0.1.3')], blocker: 'Nem az Alkalmazások mappából fut.' })
    await updater.runStartupCheck()
    expect(installed).toEqual([])
    expect(updater.getState()).toMatchObject({ phase: 'available', canInstall: false, installBlocker: 'Nem az Alkalmazások mappából fut.', startup: false })
  })

  it('hálózati hibánál a program a mostani verzióval indul', async () => {
    const source: ReleaseSource = {
      listReleases: async () => {
        throw new TypeError('fetch failed')
      },
      download: async () => new Uint8Array(),
    }
    const { updater } = setup({ current: '0.1.2', source })
    await updater.runStartupCheck()
    expect(updater.getState()).toMatchObject({ phase: 'error', startup: false, message: 'Nincs kapcsolat a GitHubbal (nincs internet?).' })
  })

  it('a kihagyás megszakítja az indítási ellenőrzést', async () => {
    let release: () => void = () => undefined
    const source: ReleaseSource = {
      listReleases: (signal) =>
        new Promise((_resolve, reject) => {
          release = () => reject(new Error('nem kellett volna'))
          signal.addEventListener('abort', () => reject(signal.reason))
        }),
      download: async () => new Uint8Array(),
    }
    const { updater, installed } = setup({ current: '0.1.2', source })
    const running = updater.runStartupCheck()
    await vi.waitFor(() => expect(updater.getState().phase).toBe('checking'))
    updater.skip()
    await running
    release()
    expect(updater.getState()).toMatchObject({ phase: 'idle', startup: false })
    expect(installed).toEqual([])
  })

  it('csatorna nélkül (helyi build) nincs ellenőrzés', async () => {
    const source = fakeSource([stable('9.9.9')])
    const { updater } = setup({ channel: null, source })
    await updater.runStartupCheck()
    expect(updater.getState()).toMatchObject({ phase: 'disabled', startup: false })
    expect(source.downloads).toEqual([])
  })
})

describe('GitHub-forrás letöltése', () => {
  const okResponse = (bytes: number) => new Response(new Uint8Array(bytes), { status: 200 })

  it('a vártnál nagyobb fájlt nem fogad el', async () => {
    const source = createGithubReleaseSource(vi.fn(), vi.fn(async () => okResponse(100)))
    await expect(source.download('https://github.com/x', { signal: new AbortController().signal, maxBytes: 50 })).rejects.toThrow(/nagyobb/)
  })

  it('a letöltés előrehaladását jelzi, és az egész fájlt adja vissza', async () => {
    const progress: number[] = []
    const source = createGithubReleaseSource(vi.fn(), vi.fn(async () => okResponse(64)))
    const data = await source.download('https://github.com/x', { signal: new AbortController().signal, maxBytes: 64, onProgress: (n) => progress.push(n) })
    expect(data.byteLength).toBe(64)
    expect(progress.at(-1)).toBe(64)
  })

  it('a kéréskorlátot érthetően jelzi', async () => {
    const source = createGithubReleaseSource(vi.fn(async () => new Response('{}', { status: 403 })), vi.fn())
    await expect(source.listReleases(new AbortController().signal)).rejects.toThrow(/kéréskorlát/)
  })
})
