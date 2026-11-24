import { readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { SettingsSchema, type Settings } from '../core/config/schema'
import { formatIssues } from '../core/config/settings'
import { buildSettingsExport, settingsExportFileName } from '../core/config/transfer'
import { localParts } from '../core/time/zoned'
import { WeekPlanSchema } from '../core/draft/weekPlan'
import type { DataBundle } from '../core/model/dataBundle'
import type { TheoryCatalog } from '../core/model/theoryCatalog'
import { IPC, type ConnectionTest, type RefreshProgress, type RouteWeatherResult, type SettingsLoad, type UpdateState, type WeatherCheckResult } from '../shared/api'
import type { ConfigStore } from './configStoreCore'
import { createCatalogCacheStore } from './catalogCache'
import { CACHE_DIR_NAME, createBundleCacheStore, createHistoryCacheStore, type CacheCipher } from './dataCache'
import { refreshLive, type UserDirectoryCache } from './data/refresh'
import { createTheoryCatalogCacheStore, loadTheoryCatalog } from './data/theoryCatalog'
import { fetchRouteWeather, MAX_ROUTE_AIRPORTS } from './data/routeWeather'
import { fetchWeatherCheck } from './data/weatherCheck'
import { MAX_IMAGE_BYTES } from './maintenanceSheet/decode'
import type { TesseractPaths } from './maintenanceSheet/ocrEngine'
import { readSheetImage } from './maintenanceSheet/readSheet'
import { FlightLoggerAbortedError, FlightLoggerClient } from './net/flightLogger/client'
import { ViewerQuery } from './net/flightLogger/queries'
import { fetchForecast } from './net/openMeteo'
import { fetchMetars } from './net/metar'
import { createSkillStore, SKILL_FILE_NAME } from './skillStore'
import type { SkillSource } from './data/blendedWeather'
import type { PlanStore } from './planStoreCore'
import type { SecretStore } from './secretStore'
import { loadSyllabi } from './syllabusStore'
import type { Updater } from './update/updaterCore'
import { registerDevIpc, type DevTools } from './dev/devTools'

/** A programmal szállított feladatsorok: fejlesztéskor a projektben, telepítve az erőforrások között. */
function bundledSyllabusDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'feladatsorok') : join(app.getAppPath(), 'feladatsorok')
}

/** A felhasználó saját feladatsor-mappája. */
function userSyllabusDir(): string {
  return join(app.getPath('userData'), 'feladatsorok')
}

/**
 * A helyi OCR fájljai (ERF-04): a Tesseract worker szkriptje és az angol nyelvi modell.
 * Csomagolt alkalmazásban az app.asar.unpacked alól, mert a worker szál nem olvas az
 * asar-archívumból.
 */
function tesseractPaths(): TesseractPaths {
  const base = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath()
  return {
    langPath: join(base, 'node_modules', '@tesseract.js-data', 'eng', '4.0.0_best_int'),
    workerPath: join(base, 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
  }
}

const fleetSchema = z.array(z.object({ id: z.string().min(1).max(200), callSign: z.string().min(1).max(40) })).max(500)

/**
 * IPC-kezelők. A felületről érkező minden adatot ellenőrzünk, mielőtt fájlba, titoktárba
 * vagy hálózatra kerülne. Hibaüzenetben a kulcs soha nem szerepel.
 */

export interface IpcDeps {
  readonly configStore: ConfigStore
  readonly secretStore: SecretStore
  readonly planStore: PlanStore
  /** A hívó keret URL-je a saját felületünké-e (B3); hiányában minden hívó elfogadott. */
  readonly isTrustedSender?: (url: string) => boolean
  /** A program frissítője (FRS-01); hiányában a frissítés ki van kapcsolva. */
  readonly updater?: Updater
  /** Csak a fejlesztői (DEV) változatban: beállítás-átvétel és kiadás gomb (FRS-09, FRS-10). */
  readonly devTools?: DevTools
}

/**
 * A gyorsítótár titkosítása a rendszer titoktárolójával (B1). A gyenge Linux-háttér
 * (basic_text) nem titkosít valójában, ilyenkor nincs titkosítás, és a nevet tartalmazó heti
 * adat nem kerül lemezre.
 */
function cacheCipher(): CacheCipher | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  if (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text') return undefined
  return { encrypt: (plain) => safeStorage.encryptString(plain), decrypt: (data) => safeStorage.decryptString(data) }
}

/** A folyamatban lévő frissítés: az újabb (például gyors hétváltásnál) leállítja a régit (H24). */
let currentRefresh: AbortController | undefined

const weekStartSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const apiKeySchema = z.string().trim().min(8).max(500)
/** Az importálható beállításfájl felső mérethatára (a valódi fájl néhány tíz kB). */
const MAX_SETTINGS_FILE_BYTES = 5 * 1024 * 1024

function parseSettings(value: unknown): Settings {
  const parsed = SettingsSchema.safeParse(value)
  if (!parsed.success) throw new Error(`Érvénytelen beállítás:\n${formatIssues(parsed.error.issues).join('\n')}`)
  return parsed.data
}

/**
 * A névjegyzék a főfolyamat memóriájában, az alkalmazás futásáig. A következő frissítés csak a
 * változásokat kéri le. (A hét megjelenített adata – benne a nevekkel – a törölhető
 * gyorsítótárba is kerül, hogy indításkor azonnal legyen mivel dolgozni.)
 */
const userCache: UserDirectoryCache = {}

/** A törölhető gyorsítótár mappája a felhasználói adatmappában. */
const cacheDir = (): string => join(app.getPath('userData'), CACHE_DIR_NAME)
/** A modellpontosság mérése (ADT-07): nem gyorsítótár, hetek alatt gyűlik. */
const SKILL_FILE = SKILL_FILE_NAME
let sharedSkillSource: SkillSource | undefined
/** Egyetlen példány: a tároló zárja csak így választja szét a párhuzamos frissítéseket. */
const skillSource = (): SkillSource =>
  (sharedSkillSource ??= { fetchMetars: (r) => fetchMetars(r), store: createSkillStore(join(app.getPath('userData'), SKILL_FILE)) })

export function registerIpc(deps: IpcDeps): void {
  // Minden kezelő előtt: csak a saját ablakunk keretéből jöhet hívás (B3).
  const handle = (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args) => {
      const url = event.senderFrame?.url ?? ''
      if (deps.isTrustedSender && !deps.isTrustedSender(url)) throw new Error('Ismeretlen hívó.')
      return fn(event, ...args)
    })
  }

  handle(IPC.loadSettings, async (): Promise<SettingsLoad> => deps.configStore.load())

  handle(IPC.saveSettings, async (_e, value: unknown) => deps.configStore.save(parseSettings(value)))

  handle(IPC.hasApiKey, async () => deps.secretStore.hasApiKey())

  // A kulcs kipróbálása (csak olvasó lekérdezés) és mentése; a DEV kulcsátvétele is ezt használja.
  const testAndSaveApiKey = async (value: unknown): Promise<ConnectionTest> => {
    const key = apiKeySchema.safeParse(value)
    if (!key.success) return { ok: false, message: 'A kulcs formátuma nem megfelelő.' }
    try {
      const client = new FlightLoggerClient({ apiKey: key.data })
      await client.query(ViewerQuery, {})
    } catch (error) {
      return { ok: false, message: `A FlightLogger nem fogadta el a kulcsot: ${(error as Error).message}` }
    }
    await deps.secretStore.saveApiKey(key.data)
    return { ok: true, message: 'A kulcs működik, és a rendszer titoktárolójába került.' }
  }

  handle(IPC.saveApiKey, async (_e, value: unknown): Promise<ConnectionTest> => testAndSaveApiKey(value))

  handle(IPC.clearApiKey, async () => deps.secretStore.clearApiKey())

  handle(IPC.cancelRefresh, async () => {
    currentRefresh?.abort()
  })

  handle(IPC.clearCache, async () => {
    userCache.value = undefined
    await rm(cacheDir(), { recursive: true, force: true })
  })

  handle(IPC.refreshData, async (event, week: unknown, value: unknown, opts: unknown): Promise<DataBundle> => {
    const weekStart = weekStartSchema.parse(week)
    const settings = parseSettings(value)
    const scope = z.object({ scope: z.enum(['full', 'directory']).optional() }).optional().parse(opts)?.scope ?? 'full'
    const now = new Date()
    const apiKey = await deps.secretStore.loadApiKey()
    if (!apiKey) throw new Error('Nincs megadva API-kulcs. Add meg a Beállítások oldalon.')
    // Előrehaladás a felületnek: a rész neve, a kérések száma és a korlát miatti várakozás.
    let progress = { stage: '', done: 0, total: 0 }
    let requests = 0
    let waited = 0
    const send = (): void => {
      if (event.sender.isDestroyed()) return
      const payload: RefreshProgress = { ...progress, requests, waitedSeconds: Math.round(waited / 1000) }
      event.sender.send(IPC.refreshProgress, payload)
    }
    // Az előző, még futó frissítés leáll: a gyors hétváltás nem indít párhuzamos teljes letöltéseket.
    currentRefresh?.abort()
    const controller = new AbortController()
    currentRefresh = controller
    const client = new FlightLoggerClient({
      apiKey,
      signal: controller.signal,
      onRequest: () => {
        requests++
        send()
      },
      // A tényleges kiesés: a párhuzamos kérések közös várakozása csak egyszer számít.
      onPause: (ms) => {
        waited += ms
        send()
      },
    })
    const syllabi = await loadSyllabi(bundledSyllabusDir(), userSyllabusDir())
    const onProgress = (p: { stage: string; done: number; total: number }): void => {
      progress = p
      send()
    }
    // A feladatkatalógus gyorsítótára: a következő frissítésnél csak a változások jönnek le.
    const catalogCache = createCatalogCacheStore(join(cacheDir(), 'feladatkatalogus.json'))
    // A haladás és a saját repülések: a következő frissítésnél csak a változások jönnek le.
    const cipher = cacheCipher()
    const historyCache = createHistoryCacheStore(join(cacheDir(), 'elozmenyek.bin'), cipher)
    try {
      const bundle = await refreshLive({ client, fetchForecast: (r) => fetchForecast(r), skill: skillSource(), now, syllabi, scope, onProgress, catalogCache, userCache, historyCache }, settings, weekStart)
      if (controller.signal.aborted) throw new FlightLoggerAbortedError()
      // A hét adata a következő indításhoz: azonnal betölthető, amíg a friss letöltődik.
      // Titkosítva, és a névjegyzékből csak a hozzárendelt növendékek neve kerül lemezre (B1).
      if (scope === 'full') {
        await createBundleCacheStore(join(cacheDir(), 'hetek'), cipher)
          .saveNarrowed(bundle, settings.students.map((s) => s.userId))
          .catch(() => undefined)
      }
      return bundle
    } finally {
      if (currentRefresh === controller) currentRefresh = undefined
    }
  })

  handle(IPC.loadCachedData, async (_e, week: unknown): Promise<DataBundle | null> => {
    const weekStart = weekStartSchema.parse(week)
    return (await createBundleCacheStore(join(cacheDir(), 'hetek'), cacheCipher()).load(weekStart).catch(() => undefined)) ?? null
  })

  handle(IPC.fetchRouteWeather, async (_e, week: unknown, codes: unknown, value: unknown): Promise<RouteWeatherResult> => {
    const weekStart = weekStartSchema.parse(week)
    const icaos = z.array(z.string().regex(/^[A-Z]{4}$/)).max(MAX_ROUTE_AIRPORTS).parse(codes)
    const settings = parseSettings(value)
    return fetchRouteWeather({ fetchForecast: (r) => fetchForecast(r), now: new Date() }, settings, weekStart, icaos)
  })

  handle(IPC.fetchWeatherCheck, async (_e, week: unknown, value: unknown): Promise<WeatherCheckResult> => {
    const weekStart = weekStartSchema.parse(week)
    const settings = parseSettings(value)
    return fetchWeatherCheck({ fetchForecast: (r) => fetchForecast(r), now: new Date(), skill: skillSource() }, settings, weekStart)
  })

  handle(IPC.openSyllabusFolder, async () => {
    const dir = userSyllabusDir()
    await loadSyllabi(bundledSyllabusDir(), dir)
    await shell.openPath(dir)
    return dir
  })

  handle(IPC.loadWeekPlan, async (_e, week: unknown) => deps.planStore.load(weekStartSchema.parse(week)))

  handle(IPC.saveWeekPlan, async (_e, value: unknown) => {
    const parsed = WeekPlanSchema.safeParse(value)
    if (!parsed.success) throw new Error('Érvénytelen tervezet.')
    await deps.planStore.save(parsed.data)
  })

  // A FlightLogger-importcsomag és a Tampermonkey-szkript is ide megy (FLI-03, FLI-09): ezért a nagyobb korlát.
  handle(IPC.copyText, async (_e, value: unknown) => {
    clipboard.writeText(z.string().max(2_000_000).parse(value))
  })
  // A FlightLogger programlistája az elméleti foglaláshoz (FLI-11): csak olvasó lekérdezések, az
  // oktató kulcsával; programnevek a gyorsítótárban (személyes adat nincs bennük).
  handle(IPC.loadTheoryCatalog, async (_e, value: unknown, opts: unknown): Promise<TheoryCatalog> => {
    parseSettings(value)
    const force = z.object({ force: z.boolean().optional() }).optional().parse(opts)?.force ?? false
    const now = new Date()
    const apiKey = await deps.secretStore.loadApiKey()
    if (!apiKey) throw new Error('Nincs megadva API-kulcs. Add meg a Beállítások oldalon.')
    const client = new FlightLoggerClient({ apiKey })
    return loadTheoryCatalog({ client, now, force, cache: createTheoryCatalogCacheStore(join(cacheDir(), 'elmeletkatalogus.json')) })
  })

  // Csak szöveg, méretkorláttal: a felület a FlightLogger-import visszaigazolását keresi benne (FLI-08).
  handle(IPC.readText, async (): Promise<string> => (await clipboard.readText()).slice(0, 1_000_000))

  // Beállítások exportja és importja: a fájlt mindig a felhasználó választja a rendszer
  // ablakában; a felület fájlrendszert közvetlenül nem ér el.
  handle(IPC.exportSettings, async (event, value: unknown, opts: unknown): Promise<string | null> => {
    const settings = parseSettings(value)
    const { includeStudents } = z.strictObject({ includeStudents: z.boolean() }).parse(opts)
    const today = localParts(Date.now(), settings.airport?.timezone ?? 'Europe/Budapest').date
    const text = buildSettingsExport(settings, { includeStudents, exportedAt: new Date().toISOString(), appVersion: app.getVersion() })
    const options = {
      title: 'Beállítások exportálása',
      defaultPath: join(app.getPath('documents'), settingsExportFileName(today, includeStudents)),
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, text, 'utf8')
    return basename(result.filePath)
  })

  handle(IPC.openSettingsFile, async (event): Promise<{ name: string; text: string } | null> => {
    const options = { title: 'Beállítások importálása', properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] }
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
    const path = result.filePaths[0]
    if (result.canceled || !path) return null
    if ((await stat(path)).size > MAX_SETTINGS_FILE_BYTES) throw new Error('A fájl túl nagy ahhoz, hogy beállítás legyen.')
    return { name: basename(path), text: await readFile(path, 'utf8') }
  })

  handle(IPC.readMaintenanceSheet, async (_e, image: unknown, fleet: unknown) => {
    if (!(image instanceof Uint8Array) || image.byteLength === 0) throw new Error('Érvénytelen kép.')
    if (image.byteLength > MAX_IMAGE_BYTES) throw new Error('A kép túl nagy (legfeljebb 40 MB lehet).')
    return readSheetImage(image, fleetSchema.parse(fleet), tesseractPaths())
  })

  // Frissítés (FRS-01–FRS-08). A felület csak állapotot kér és szándékot jelez; hogy honnan és
  // mit tölt le a program, azt kizárólag a főfolyamat dönti el.
  const updater = deps.updater
  const disabledUpdate: UpdateState = { channel: null, currentVersion: app.getVersion(), autoUpdate: false, phase: 'disabled', startup: false, canInstall: false }
  handle(IPC.getUpdateState, async (): Promise<UpdateState> => updater?.getState() ?? disabledUpdate)
  handle(IPC.checkForUpdates, async (): Promise<UpdateState> => (updater ? updater.checkNow() : disabledUpdate))
  handle(IPC.installUpdate, async () => updater?.installAvailable())
  handle(IPC.skipUpdate, async () => updater?.skip())
  handle(IPC.setAutoUpdate, async (_e, value: unknown): Promise<UpdateState> => {
    const enabled = z.boolean().parse(value)
    return updater ? updater.setAutoUpdate(enabled) : disabledUpdate
  })

  // A fő változatban nincs devTools, így ezek a csatornák ott nem is léteznek.
  if (deps.devTools) registerDevIpc(handle, deps.devTools, deps.configStore, testAndSaveApiKey)

  handle(IPC.resetAll, async (_e, value: unknown) => {
    const options = z.strictObject({ clearApiKey: z.boolean().optional() }).optional().parse(value)
    const userData = app.getPath('userData')
    await rm(join(userData, 'beallitasok.json'), { force: true })
    await rm(join(userData, 'tervek'), { recursive: true, force: true })
    await rm(join(userData, SKILL_FILE), { force: true })
    await rm(cacheDir(), { recursive: true, force: true })
    if (options?.clearApiKey) {
      await deps.secretStore.clearApiKey()
    }
  })
}
