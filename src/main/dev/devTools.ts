import { join } from 'node:path'
import { app, type IpcMainInvokeEvent } from 'electron'
import { APP_DISPLAY_NAME } from '../../core/update/appNames'
import { IPC, type ConnectionTest, type PromotionState, type StableImportSummary } from '../../shared/api'
import type { ConfigStore } from '../configStoreCore'
import { createDevPromoteFetch } from '../net/allowedFetch'
import { createElectronSecretStore } from '../secrets'
import type { SecretStore } from '../secretStore'
import { readBuildCommit } from '../update/buildInfo'
import { copyStableData, readStableSettings } from './importFromStable'
import { GithubTokenSchema, promotionState, startPromotion, verifyGithubToken, type PromotionDeps } from './promotion'

/**
 * A fejlesztői (DEV) változat eszközei: a fő változat beállításainak átvétele (FRS-10) és a
 * „Kiadás: dev → main” gomb (FRS-09). Csak a DEV-csatornán jönnek létre (index.ts), és csak
 * ekkor regisztrálódnak az IPC-kezelőik; a fő változatban sem a gomb, sem a funkciója nincs meg.
 */
export interface DevTools {
  /** A fő változat felhasználói adatmappája (csak olvassuk). */
  readonly stableDir: string
  /** A kiadás GitHub-tokenje a rendszer titoktárolójában, külön fájlban. */
  readonly tokenStore: SecretStore
  readonly promotion: PromotionDeps
}

export function createDevTools(channel: string | null): DevTools {
  if (channel !== 'dev') throw new Error('A fejlesztői eszközök csak a Foglalástervező DEV-ben érhetők el.')
  const tokenStore = createElectronSecretStore('github-kiado-token.secret')
  return {
    stableDir: join(app.getPath('appData'), APP_DISPLAY_NAME.stable),
    tokenStore,
    promotion: {
      fetch: createDevPromoteFetch(channel),
      loadToken: () => tokenStore.loadApiKey(),
      buildVersion: app.getVersion(),
      buildCommit: readBuildCommit(),
    },
  }
}

type Handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void

export function registerDevIpc(handle: Handle, dev: DevTools, configStore: ConfigStore): void {
  handle(IPC.devImportFromStable, async (): Promise<StableImportSummary> => {
    // Előbb a beállítás: ha a fő változaté hiányzik vagy hibás, semmi nem íródik felül.
    const settings = await readStableSettings(dev.stableDir)
    const copied = await copyStableData(dev.stableDir, app.getPath('userData'))
    await configStore.save(settings)
    return { ...copied, students: settings.students.length }
  })

  handle(IPC.devRelaunch, async () => {
    app.relaunch()
    app.exit(0)
  })

  handle(IPC.devPromotionState, async (): Promise<PromotionState> => promotionState(dev.promotion))

  handle(IPC.devSaveGithubToken, async (_e, value: unknown): Promise<ConnectionTest> => {
    const token = GithubTokenSchema.safeParse(value)
    if (!token.success) return { ok: false, message: 'Ez nem GitHub-token: github_pat_… (vagy ghp_…) kezdetű kell.' }
    let test: ConnectionTest
    try {
      test = await verifyGithubToken(dev.promotion.fetch, token.data)
    } catch {
      return { ok: false, message: 'A GitHub nem érhető el (nincs internet?).' }
    }
    if (test.ok) await dev.tokenStore.saveApiKey(token.data)
    return test
  })

  handle(IPC.devClearGithubToken, async () => dev.tokenStore.clearApiKey())

  handle(IPC.devStartPromotion, async (): Promise<PromotionState> => startPromotion(dev.promotion))
}
