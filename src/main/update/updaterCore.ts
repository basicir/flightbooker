import { MAX_MANIFEST_BYTES, manifestProblems, selectInstallAsset, type Manifest, type ManifestAsset } from '../../core/update/manifest'
import { pickLatestRelease, ReleaseListSchema } from '../../core/update/releases'
import type { UpdateChannel } from '../../core/update/version'
import type { UpdateState } from '../../shared/api'

/**
 * A frissítő vezérlése (FRS-01–FRS-08), Electron nélkül, hogy tesztelhető legyen.
 *
 * Indításkor: ellenőrzés → ha van újabb kiadás és az automatikus frissítés be van kapcsolva,
 * letöltés → az aláírt leírás szerinti méret és SHA-512 ellenőrzése → telepítés és újraindulás.
 * Ha nincs újabb, nincs hálózat, vagy bármi hibázik, a program a mostani verzióval indul.
 */

export class UpdateError extends Error {
  override readonly name = 'UpdateError'
}

export interface DownloadOptions {
  readonly signal: AbortSignal
  /** Ennél több bájt nem fogadható el (a leírás szerinti méret). */
  readonly maxBytes: number
  readonly onProgress?: (received: number) => void
}

/** A kiadások forrása (GitHub), az engedélyezési listán át. */
export interface ReleaseSource {
  listReleases(signal: AbortSignal): Promise<unknown>
  download(url: string, options: DownloadOptions): Promise<Uint8Array>
}

export interface Installer {
  /** `null`, ha ezen a gépen a program maga telepítheti a frissítést; különben az ok. */
  blocker(): Promise<string | null>
  /** Telepít, és kilépteti (újraindítja) a programot. */
  install(asset: ManifestAsset, data: Uint8Array): Promise<void>
}

export interface UpdatePrefs {
  readonly autoUpdate: boolean
}

export interface UpdatePrefsStore {
  load(): Promise<UpdatePrefs>
  save(prefs: UpdatePrefs): Promise<void>
}

export interface UpdaterDeps {
  readonly channel: UpdateChannel | null
  readonly currentVersion: string
  readonly platform: string
  readonly arch: string
  readonly source: ReleaseSource
  /** Ellenőrzi az aláírást, és visszaadja a leírást; hibánál kivételt dob. */
  readonly verifyManifest: (text: string) => Manifest
  readonly sha512: (data: Uint8Array) => string
  readonly installer: Installer
  readonly prefs: UpdatePrefsStore
  readonly now: () => Date
  /** Az ellenőrzés (lista és leírás) időkorlátja; alapból 10 másodperc. */
  readonly checkTimeoutMs?: number
  /** A letöltés időkorlátja; alapból 30 perc. */
  readonly downloadTimeoutMs?: number
}

export interface Updater {
  getState(): UpdateState
  subscribe(listener: (state: UpdateState) => void): () => void
  /** Az indítási ellenőrzés; automatikus frissítésnél telepít is. */
  runStartupCheck(): Promise<void>
  /** Kézi ellenőrzés: nem telepít magától. */
  checkNow(): Promise<UpdateState>
  /** A talált frissítés letöltése és telepítése. */
  installAvailable(): Promise<void>
  /** Az indítási ellenőrzés vagy a letöltés kihagyása. */
  skip(): void
  setAutoUpdate(enabled: boolean): Promise<UpdateState>
}

interface PendingUpdate {
  readonly version: string
  readonly releaseUrl: string | undefined
  readonly asset: ManifestAsset | null
  readonly assetUrl: string | undefined
}

const NO_ASSET = 'Ebben a kiadásban nincs telepítő ehhez a géphez; a kiadás oldaláról töltsd le kézzel.'
const BUSY: ReadonlySet<UpdateState['phase']> = new Set(['checking', 'downloading', 'installing'])

/** A felhasználónak szóló, személyes adatot nem tartalmazó hibaszöveg. */
export function describeUpdateError(error: unknown): string {
  if (error instanceof UpdateError) return error.message
  if (error instanceof Error) {
    if (error.name === 'TimeoutError') return 'A GitHub nem válaszolt időben; a program a mostani verzióval indult.'
    if (error.name === 'AbortError') return 'A frissítés megszakítva.'
    if (error.name === 'NetworkPolicyError') return `A kérés nem felel meg az engedélyezési listának: ${error.message}`
    if (error.name === 'ZodError') return 'A GitHub válasza nem a várt formátumú.'
    if (error.name === 'TypeError' && /fetch failed/i.test(error.message)) return 'Nincs kapcsolat a GitHubbal (nincs internet?).'
    return `A frissítés nem sikerült: ${error.message}`
  }
  return 'A frissítés nem sikerült.'
}

const isHttpsGithub = (url: string): boolean => url.startsWith('https://github.com/')

export function createUpdater(deps: UpdaterDeps): Updater {
  const { channel } = deps
  let state: UpdateState = {
    channel,
    currentVersion: deps.currentVersion,
    autoUpdate: true,
    phase: channel ? 'idle' : 'disabled',
    startup: channel !== null,
    canInstall: false,
  }
  let pending: PendingUpdate | null = null
  let controller: AbortController | null = null
  let skipped = false
  const listeners = new Set<(s: UpdateState) => void>()

  const set = (patch: Partial<UpdateState>): void => {
    state = { ...state, ...patch }
    for (const listener of listeners) listener(state)
  }

  async function findUpdate(signal: AbortSignal): Promise<PendingUpdate | null> {
    if (!channel) return null
    const releases = ReleaseListSchema.parse(await deps.source.listReleases(signal))
    const candidate = pickLatestRelease(releases, channel, deps.currentVersion)
    if (!candidate) return null
    const manifestBytes = await deps.source.download(candidate.manifestAsset.browser_download_url, { signal, maxBytes: MAX_MANIFEST_BYTES })
    const manifest = deps.verifyManifest(new TextDecoder().decode(manifestBytes))
    const problems = manifestProblems(manifest, { channel, version: candidate.version })
    if (problems.length > 0) throw new UpdateError(problems.join(' '))
    const asset = selectInstallAsset(manifest, deps.platform, deps.arch)
    const releaseAsset = asset ? candidate.release.assets.find((a) => a.name === asset.name && a.size === asset.size) : undefined
    return {
      version: candidate.version,
      releaseUrl: isHttpsGithub(candidate.release.html_url) ? candidate.release.html_url : undefined,
      asset: releaseAsset ? asset : null,
      assetUrl: releaseAsset?.browser_download_url,
    }
  }

  /** Egy ellenőrzés; az állapotot beállítja, és visszaadja a talált frissítést. */
  async function check(): Promise<PendingUpdate | null> {
    const own = new AbortController()
    controller = own
    set({ phase: 'checking', message: undefined, progress: undefined })
    try {
      const signal = AbortSignal.any([own.signal, AbortSignal.timeout(deps.checkTimeoutMs ?? 10_000)])
      pending = await findUpdate(signal)
      const blocker = pending ? (pending.asset ? await deps.installer.blocker() : NO_ASSET) : null
      set({
        phase: pending ? 'available' : 'up-to-date',
        latestVersion: pending?.version,
        releaseUrl: pending?.releaseUrl,
        checkedAt: deps.now().toISOString(),
        canInstall: pending !== null && blocker === null,
        installBlocker: blocker ?? undefined,
      })
      return pending
    } catch (error) {
      if (own.signal.aborted) set({ phase: 'idle' })
      else set({ phase: 'error', message: describeUpdateError(error), checkedAt: deps.now().toISOString() })
      return null
    } finally {
      if (controller === own) controller = null
    }
  }

  async function downloadAndInstall(update: PendingUpdate): Promise<void> {
    const { asset, assetUrl } = update
    if (!asset || !assetUrl) {
      set({ phase: 'error', message: NO_ASSET })
      return
    }
    const own = new AbortController()
    controller = own
    set({ phase: 'downloading', progress: { received: 0, total: asset.size }, message: undefined })
    try {
      let lastReported = 0
      const step = Math.max(256 * 1024, Math.floor(asset.size / 100))
      const data = await deps.source.download(assetUrl, {
        signal: AbortSignal.any([own.signal, AbortSignal.timeout(deps.downloadTimeoutMs ?? 30 * 60_000)]),
        maxBytes: asset.size,
        onProgress: (received) => {
          if (received - lastReported < step && received < asset.size) return
          lastReported = received
          set({ progress: { received, total: asset.size } })
        },
      })
      if (data.byteLength !== asset.size || deps.sha512(data) !== asset.sha512) {
        throw new UpdateError('A letöltött fájl nem egyezik az aláírt leírással, ezért nem telepítem.')
      }
      set({ phase: 'installing', progress: undefined })
      await deps.installer.install(asset, data)
    } catch (error) {
      if (own.signal.aborted) set({ phase: 'available', progress: undefined })
      else set({ phase: 'error', progress: undefined, message: describeUpdateError(error) })
    } finally {
      if (controller === own) controller = null
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    async runStartupCheck() {
      if (!channel) return
      const prefs = await deps.prefs.load().catch((): UpdatePrefs => ({ autoUpdate: true }))
      set({ autoUpdate: prefs.autoUpdate })
      const update = await check()
      if (update && !skipped && state.autoUpdate && state.canInstall) await downloadAndInstall(update)
      if (state.phase !== 'installing') set({ startup: false })
    },

    async checkNow() {
      if (!channel || BUSY.has(state.phase)) return state
      await check()
      return state
    },

    async installAvailable() {
      if (!pending || !state.canInstall || BUSY.has(state.phase)) return
      await downloadAndInstall(pending)
    },

    skip() {
      if (state.phase === 'installing') return
      skipped = true
      controller?.abort()
      set({ startup: false })
    },

    async setAutoUpdate(enabled) {
      await deps.prefs.save({ autoUpdate: enabled })
      set({ autoUpdate: enabled })
      return state
    },
  }
}
