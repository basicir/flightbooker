import type { Settings } from '../core/config/schema'
import type { WeekPlan } from '../core/draft/weekPlan'
import type { SheetReading } from '../core/maintenanceSheet/read'
import type { FleetAircraft } from '../core/maintenanceSheet/registration'
import type { DataBundle } from '../core/model/dataBundle'
import type { AirportWeather } from '../core/model/route'
import type { TheoryCatalog } from '../core/model/theoryCatalog'
import type { ModelForecast } from '../core/weather/forecastCheck'
import type { ModelSkillSummary } from '../core/weather/skill'

/**
 * A főfolyamat és a felület közötti szerződés. A felület csak ezeket a hívásokat éri el
 * (contextBridge); hálózatot, fájlt és titkot közvetlenül nem.
 */

export type SettingsLoad =
  | { readonly status: 'ok'; readonly settings: Settings; readonly migratedFrom?: number }
  | { readonly status: 'missing'; readonly settings: Settings }
  | { readonly status: 'invalid'; readonly errors: readonly string[]; readonly backupPath: string }

/** Az adatfrissítés állása a felületnek. */
export interface RefreshProgress {
  /** A még futó részek (például „Foglalások, Feladatlista”). */
  readonly stage: string
  readonly done: number
  readonly total: number
  readonly requests: number
  /** A FlightLogger kéréskorlátja miatti tényleges várakozás eddig, másodpercben. */
  readonly waitedSeconds: number
}

/** Az útvonal-repülőterek előrejelzése (K27, SZB-19). */
export interface RouteWeatherResult {
  readonly weather: Readonly<Record<string, AirportWeather>>
  /** Repülőterenként a hiba (ismeretlen kód, sikertelen letöltés). */
  readonly errors: Readonly<Record<string, string>>
}

/** Az indítópult időjárás-ellenőrzése: a bázis előrejelzése modellenként (ADT-07). */
export interface WeatherCheckResult {
  readonly fetchedAt: string
  readonly models: readonly ModelForecast[]
  /** A modellek METAR-ral mért pontossága és a tervezés súlyai (ADT-07). */
  readonly skill?: ModelSkillSummary
}

export interface ConnectionTest {
  readonly ok: boolean
  readonly message: string
}

/**
 * A program frissítésének állapota (FRS-01–FRS-08).
 * - disabled: helyi vagy fejlesztői build, nincs frissítési csatorna;
 * - checking → up-to-date | available | error;
 * - available → downloading → installing (a program ezután újraindul).
 */
export type UpdatePhase = 'disabled' | 'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'installing' | 'error'

export interface UpdateState {
  /** `stable`: fő kiadás (main), `dev`: fejlesztői kiadás; `null`: nincs frissítés (helyi build). */
  readonly channel: 'stable' | 'dev' | null
  readonly currentVersion: string
  /** Indításkor magától telepítsen-e (alapból igen, FRS-06). */
  readonly autoUpdate: boolean
  readonly phase: UpdatePhase
  /** Az indítási ellenőrzés még tart: a felület addig nem tölt be adatot. */
  readonly startup: boolean
  readonly latestVersion?: string
  /** A kiadás GitHub-oldala (kiadási jegyzet, kézi letöltés). */
  readonly releaseUrl?: string
  readonly progress?: { readonly received: number; readonly total: number }
  /** Hiba vagy tájékoztatás a felhasználónak (személyes adat nélkül). */
  readonly message?: string
  readonly checkedAt?: string
  /** Ezen a gépen a program maga tudja-e telepíteni a frissítést. */
  readonly canInstall: boolean
  /** Ha nem: miért nem (pl. nem az Alkalmazások mappából fut). */
  readonly installBlocker?: string
}

export interface FlightbookerApi {
  readonly appVersion: string
  loadSettings(): Promise<SettingsLoad>
  saveSettings(settings: Settings): Promise<void>
  /** Van-e tárolt API-kulcs (a kulcs maga soha nem jön vissza). */
  hasApiKey(): Promise<boolean>
  /** Elmenti a kulcsot a rendszer titoktárolójába, és kipróbálja (ALP-06). */
  saveApiKey(key: string): Promise<ConnectionTest>
  clearApiKey(): Promise<void>
  /**
   * Adatfrissítés a megadott hétre, a megadott (akár még nem mentett) beállításokkal.
   * `directory`: csak névjegyzék (első beállítás), sokkal gyorsabb.
   */
  refreshData(weekStart: string, settings: Settings, options?: { readonly scope?: 'full' | 'directory' }): Promise<DataBundle>
  /**
   * A hét utoljára letöltött adata a törölhető gyorsítótárból (élő adatforrásnál), ha van:
   * ezzel azonnal lehet dolgozni, amíg a friss adat a háttérben letöltődik.
   */
  loadCachedData(weekStart: string): Promise<DataBundle | null>
  /**
   * Az útvonalas igények repülőtereinek előrejelzése a hétre (K27, SZB-19). Csak a
   * koordináta és az időablak megy ki.
   */
  fetchRouteWeather(weekStart: string, icaos: readonly string[], settings: Settings): Promise<RouteWeatherResult>
  /**
   * A bázis előrejelzése az Open-Meteo összes összevetett modelljéből (indítópult,
   * időjárás-ellenőrzés). Csak koordináta, időablak és modellnév megy ki.
   */
  fetchWeatherCheck(weekStart: string, settings: Settings): Promise<WeatherCheckResult>
  /** A folyamatban lévő frissítés megszakítása (H24). */
  cancelRefresh(): Promise<void>
  /** A törölhető gyorsítótár (heti adat, haladás, feladatlista) törlése (B1). */
  clearCache(): Promise<void>
  /** Feliratkozás a betöltés előrehaladására; a visszaadott függvény leiratkozik. */
  onRefreshProgress(listener: (progress: RefreshProgress) => void): () => void
  loadWeekPlan(weekStart: string): Promise<WeekPlan | null>
  saveWeekPlan(plan: WeekPlan): Promise<void>
  copyText(text: string): Promise<void>
  /**
   * A FlightLogger programlistája az elméleti foglaláshoz (FLI-11): programok, revíziók, tárgyak,
   * csak olvasó lekérdezéssel. Gyorsítótárból jön, amíg friss; `force`: újratöltés.
   */
  loadTheoryCatalog(settings: Settings, options?: { readonly force?: boolean }): Promise<TheoryCatalog>
  /**
   * A vágólap szövege (FLI-08: a FlightLogger-import visszaigazolásához). Csak szöveget ad, a
   * felület maga dönti el, hogy a saját formátuma-e; más tartalommal nem kezd semmit.
   */
  readText(): Promise<string>
  /**
   * A beállítások exportja fájlba a rendszer mentési ablakával (növendékekkel vagy nélkülük).
   * A mentett fájl neve, vagy `null`, ha a felhasználó mégsem mentett.
   */
  exportSettings(settings: Settings, options: { readonly includeStudents: boolean }): Promise<string | null>
  /** Beállítás- vagy exportfájl kiválasztása a rendszer megnyitási ablakával: a tartalma, vagy `null`. */
  openSettingsFile(): Promise<{ readonly name: string; readonly text: string } | null>
  /** Megnyitja a saját feladatsor-mappát (ide tehetők új exportok); visszaadja az útvonalát. */
  openSyllabusFolder(): Promise<string>
  /** Teljes visszaállítás: törli a beállításokat, a mentett terveket, a gyorsítótárat és opcionálisan a kulcsot. */
  resetAll(options?: { clearApiKey?: boolean }): Promise<void>
  /**
   * A karbantartási táblázat fotójának beolvasása (ERF-04): helyi OCR, a kép nem hagyja el a
   * gépet és nem kerül mentésre. `fleet`: a gépek, amelyekhez a lajstromokat illesztjük.
   */
  readMaintenanceSheet(image: Uint8Array, fleet: readonly FleetAircraft[]): Promise<SheetReading>
  /** A frissítés állapota (FRS-01). */
  getUpdateState(): Promise<UpdateState>
  /** Feliratkozás a frissítés állapotára; a visszaadott függvény leiratkozik. */
  onUpdateState(listener: (state: UpdateState) => void): () => void
  /** Kézi ellenőrzés: magától nem telepít, csak jelzi az új verziót. */
  checkForUpdates(): Promise<UpdateState>
  /** A talált frissítés letöltése és telepítése; sikerkor a program újraindul. */
  installUpdate(): Promise<void>
  /** Az indítási ellenőrzés vagy letöltés kihagyása: a program a mostani verzióval indul. */
  skipUpdate(): Promise<void>
  /** Az automatikus frissítés be- és kikapcsolása (FRS-06). */
  setAutoUpdate(enabled: boolean): Promise<UpdateState>
  /**
   * A fejlesztői (DEV) változat eszközei (FRS-09, FRS-10). A fő változatban a főfolyamat ezeket
   * nem regisztrálja, így ott minden hívásuk hibával tér vissza; a felület meg sem jeleníti őket.
   */
  readonly dev: DevApi
}

/** Mi jött át a fő változatból (FRS-10). Az API-kulcs nem: azt a DEV-ben külön kell megadni (ALP-06). */
export interface StableImportSummary {
  /** A mentett heti tervek száma. */
  readonly plans: number
  /** A saját feladatsor-fájlok száma. */
  readonly syllabi: number
  /** A modellpontosság mérése (időjárás-ellenőrzés) is átjött-e. */
  readonly weatherLog: boolean
  readonly students: number
}

/** A „Kiadás: dev → main” munkafolyamat egy futása a GitHubon (FRS-09). */
export interface PromotionRun {
  /** queued, in_progress, completed … (a GitHub értéke). */
  readonly status: string
  /** success, failure, cancelled … (befejezett futásnál). */
  readonly conclusion: string | null
  readonly url: string
  readonly createdAt: string
}

export interface PromotionState {
  /** Van-e mentett GitHub-token (a token maga sosem jut a felületre). */
  readonly tokenSaved: boolean
  readonly buildVersion: string
  /** A futó DEV-csomag commitja; ezt adja ki a gomb. Helyi buildnél nincs. */
  readonly buildCommit: string | null
  readonly lastRun: PromotionRun | null
  /** Ha a legutóbbi futás nem kérdezhető le (nincs hálózat, rossz token). */
  readonly error?: string
}

export interface DevApi {
  /** A fő változat beállításainak, terveinek és feladatsorainak átvétele (felülírja a DEV-éit). */
  importFromStable(): Promise<StableImportSummary>
  /** Ha a DEV első indításkor magától átvette a fő változat adatait: mit (a felület egyszer jelzi). */
  startupImport(): Promise<StableImportSummary | null>
  /** A program újraindítása (az átvétel után). */
  relaunch(): Promise<void>
  getPromotionState(): Promise<PromotionState>
  /** A GitHub-token mentése a rendszer titoktárolójába, kipróbálás után. */
  saveGithubToken(token: string): Promise<ConnectionTest>
  clearGithubToken(): Promise<void>
  /** A futó DEV-verzió kiadása fő kiadásként (dev → main). */
  startPromotion(): Promise<PromotionState>
}

export const IPC = {
  loadSettings: 'settings:load',
  saveSettings: 'settings:save',
  hasApiKey: 'apikey:has',
  saveApiKey: 'apikey:save',
  clearApiKey: 'apikey:clear',
  refreshData: 'data:refresh',
  refreshProgress: 'data:refresh-progress',
  loadCachedData: 'data:load-cached',
  fetchRouteWeather: 'data:route-weather',
  fetchWeatherCheck: 'data:weather-check',
  cancelRefresh: 'data:cancel-refresh',
  clearCache: 'data:clear-cache',
  loadWeekPlan: 'plan:load',
  saveWeekPlan: 'plan:save',
  copyText: 'clipboard:write',
  readText: 'clipboard:read',
  loadTheoryCatalog: 'data:theory-catalog',
  exportSettings: 'settings:export',
  openSettingsFile: 'settings:open-file',
  openSyllabusFolder: 'syllabus:open-folder',
  resetAll: 'app:reset',
  readMaintenanceSheet: 'maintenance:read-sheet',
  getUpdateState: 'update:get-state',
  updateState: 'update:state-changed',
  checkForUpdates: 'update:check',
  installUpdate: 'update:install',
  skipUpdate: 'update:skip',
  setAutoUpdate: 'update:set-auto',
  devImportFromStable: 'dev:import-from-stable',
  devStartupImport: 'dev:startup-import',
  devRelaunch: 'dev:relaunch',
  devPromotionState: 'dev:promotion-state',
  devSaveGithubToken: 'dev:github-token-save',
  devClearGithubToken: 'dev:github-token-clear',
  devStartPromotion: 'dev:promotion-start',
} as const
