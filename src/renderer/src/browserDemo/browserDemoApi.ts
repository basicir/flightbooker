import type { Settings } from '@core/config/schema'
import { buildSettingsExport, settingsExportFileName } from '@core/config/transfer'
import { lookupAirport } from '@core/airports/lookup'
import { createDemoBundle, createDemoSettings, demoModelForecasts, demoRouteWeather, demoTheoryCatalog, demoVerificationLog } from '@core/demo/demoData'
import { WEATHER_CHECK_MODELS } from '@core/weather/forecastCheck'
import { skillWeights } from '@core/weather/skill'
import type { AirportWeather } from '@core/model/route'
import type { WeekPlan } from '@core/draft/weekPlan'
import { syllabusLectures, parseSyllabusFile, type Syllabus } from '@core/progress/syllabus'
import type { FlightbookerApi, SettingsLoad, UpdateState } from '../../../shared/api'

/**
 * A böngészős fejlesztői előnézet (`npm run dev:web`) memóriabeli hídja: csak szintetikus adatot
 * ad, és semmilyen hálózatot nem használ. Csak a vite.web.config.mts `@browser-demo` aliasán át
 * töltődik be; az Electron-buildben az alias az `unavailable.ts`-re mutat, így ez a modul és a
 * szintetikus adat a programba nem kerül.
 */
/** Az előnézetben is látszanak a projekt `feladatsorok/` mappájának fájljai (revízióválasztás). */
const SYLLABUS_FILES = import.meta.glob('../../../../feladatsorok/*.json', { import: 'default' })

async function demoSyllabi(): Promise<Syllabus[]> {
  const result: Syllabus[] = []
  for (const [path, load] of Object.entries(SYLLABUS_FILES)) {
    result.push(...parseSyllabusFile(await load(), `beépített/${path.split('/').pop()}`).syllabi)
  }
  return result
}

export function createBrowserDemoApi(): FlightbookerApi {
  let settings: Settings | null = null
  const plans = new Map<string, WeekPlan>()
  return {
    appVersion: 'böngészős előnézet',
    // Az előnézet kitöltött szintetikus beállítással indul (első beállítás nélkül).
    async loadSettings(): Promise<SettingsLoad> {
      return { status: 'ok', settings: settings ?? createDemoSettings(new Date().toISOString().slice(0, 10), new Date().toISOString()) }
    },
    async saveSettings(s) {
      settings = structuredClone(s)
    },
    async hasApiKey() {
      return false
    },
    async saveApiKey() {
      return { ok: false, message: 'A böngészős előnézetben élő kapcsolat nincs.' }
    },
    async clearApiKey() {},
    async refreshData(weekStart) {
      const bundle = createDemoBundle(new Date(), weekStart)
      const syllabi = await demoSyllabi()
      const fallback = { briefing: 45, debriefing: 30 }
      const extra = Object.fromEntries(syllabi.flatMap((s) => syllabusLectures(s, () => fallback)).map((l) => [l.id, l]))
      return { ...bundle, syllabi, directory: { ...bundle.directory, lectures: { ...bundle.directory.lectures, ...extra } } }
    },
    async loadCachedData() {
      return null
    },
    async fetchRouteWeather(weekStart, icaos) {
      const weather: Record<string, AirportWeather> = {}
      const errors: Record<string, string> = {}
      for (const icao of icaos) {
        const a = await lookupAirport(icao)
        if (!a) errors[icao] = 'Ismeretlen ICAO-kód.'
        else weather[icao] = { icao, latitude: a.latitude, longitude: a.longitude, runwayHeadingsDeg: a.runways.map((r) => r.trueHeadingDeg), hours: demoRouteWeather(weekStart) }
      }
      return { weather, errors }
    },
    async fetchWeatherCheck(weekStart) {
      const now = new Date()
      // Az induló súlyok és a szintetikus mérési napló (a METAR-lenyíló bemutatásához).
      const skill = { weights: skillWeights([], WEATHER_CHECK_MODELS.map((m) => m.id), now.getTime()), measuredHours: 0, log: demoVerificationLog(now) }
      return { fetchedAt: now.toISOString(), models: demoModelForecasts(now, weekStart), skill }
    },
    async cancelRefresh() {},
    async clearCache() {},
    onRefreshProgress() {
      return () => undefined
    },
    async openSyllabusFolder() {
      return 'A böngészős bemutatóban nincs saját mappa; a projekt feladatsorok/ mappáját olvassa.'
    },
    async loadWeekPlan(weekStart) {
      return plans.get(weekStart) ?? null
    },
    async saveWeekPlan(plan) {
      plans.set(plan.weekStart, structuredClone(plan))
    },
    async copyText(text) {
      await navigator.clipboard?.writeText(text)
    },
    async readText() {
      return (await navigator.clipboard?.readText()) ?? ''
    },
    async loadTheoryCatalog() {
      return demoTheoryCatalog(new Date())
    },
    // A bemutatóban a böngésző letöltése és fájlválasztója helyettesíti a rendszer ablakát.
    async exportSettings(s, options) {
      const name = settingsExportFileName(new Date().toISOString().slice(0, 10), options.includeStudents)
      const blob = new Blob([buildSettingsExport(s, { ...options, exportedAt: new Date().toISOString(), appVersion: 'böngészős előnézet' })], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = Object.assign(document.createElement('a'), { href: url, download: name })
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      return name
    },
    async openSettingsFile() {
      return new Promise((resolve) => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' })
        input.addEventListener('change', () => {
          const file = input.files?.[0]
          if (!file) return resolve(null)
          void file.text().then((text) => resolve({ name: file.name, text }))
        })
        input.addEventListener('cancel', () => resolve(null))
        input.click()
      })
    },
    async resetAll() {
      settings = null
      plans.clear()
    },
    async readMaintenanceSheet() {
      throw new Error('A fotó beolvasása csak az asztali alkalmazásban érhető el (a böngészős bemutatóban nincs helyi OCR).')
    },
    // A böngészős bemutató nem frissül (és hálózatot sem használ).
    async getUpdateState() {
      return DEMO_UPDATE_STATE
    },
    onUpdateState() {
      return () => undefined
    },
    async checkForUpdates() {
      return DEMO_UPDATE_STATE
    },
    async installUpdate() {},
    async skipUpdate() {},
    async setAutoUpdate() {
      return DEMO_UPDATE_STATE
    },
    // A fejlesztői eszközök csak a DEV-programban vannak.
    dev: {
      async importFromStable() {
        throw new Error('Csak a Foglalástervező DEV-ben érhető el.')
      },
      async startupImport() {
        return null
      },
      async relaunch() {},
      async getPromotionState() {
        throw new Error('Csak a Foglalástervező DEV-ben érhető el.')
      },
      async saveGithubToken() {
        return { ok: false, message: 'Csak a Foglalástervező DEV-ben érhető el.' }
      },
      async clearGithubToken() {},
      async startPromotion() {
        throw new Error('Csak a Foglalástervező DEV-ben érhető el.')
      },
    },
  }
}

const DEMO_UPDATE_STATE: UpdateState = {
  channel: null,
  currentVersion: 'böngészős előnézet',
  autoUpdate: false,
  phase: 'disabled',
  startup: false,
  canInstall: false,
}

