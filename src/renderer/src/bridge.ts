import { createDefaultSettings } from '@core/config/defaults'
import type { Settings } from '@core/config/schema'
import { buildSettingsExport, settingsExportFileName } from '@core/config/transfer'
import { lookupAirport } from '@core/airports/lookup'
import { createDemoBundle, demoModelForecasts, demoRouteWeather, demoTheoryCatalog, demoVerificationLog } from '@core/demo/demoData'
import { WEATHER_CHECK_MODELS } from '@core/weather/forecastCheck'
import { skillWeights } from '@core/weather/skill'
import type { AirportWeather } from '@core/model/route'
import type { WeekPlan } from '@core/draft/weekPlan'
import { syllabusLectures, parseSyllabusFile, type Syllabus } from '@core/progress/syllabus'
import type { FlightbookerApi, SettingsLoad, UpdateState } from '../../shared/api'

/**
 * A felület egyetlen kapcsolata a külvilággal. Electronban a preload adja; böngészőben
 * (fejlesztői bemutató) egy memóriabeli megvalósítás, amely csak szintetikus adatot ad,
 * és semmilyen hálózatot nem használ.
 */
/**
 * A bemutatóban is látszanak a projekt `feladatsorok/` mappájának fájljai, hogy a
 * revízióválasztás kipróbálható legyen. Lusta betöltés: Electronban nem kerül a csomagba.
 */
const SYLLABUS_FILES = import.meta.glob('../../../feladatsorok/*.json', { import: 'default' })

async function demoSyllabi(): Promise<Syllabus[]> {
  const result: Syllabus[] = []
  for (const [path, load] of Object.entries(SYLLABUS_FILES)) {
    result.push(...parseSyllabusFile(await load(), `beépített/${path.split('/').pop()}`).syllabi)
  }
  return result
}

function createBrowserDemoApi(): FlightbookerApi {
  let settings: Settings | null = null
  const plans = new Map<string, WeekPlan>()
  return {
    appVersion: 'böngészős bemutató',
    async loadSettings(): Promise<SettingsLoad> {
      return settings ? { status: 'ok', settings } : { status: 'missing', settings: { ...createDefaultSettings(), dataSource: 'demo' } }
    },
    async saveSettings(s) {
      settings = structuredClone(s)
    },
    async hasApiKey() {
      return false
    },
    async saveApiKey() {
      return { ok: false, message: 'A böngészős bemutatóban élő kapcsolat nincs; használd a bemutató módot.' }
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
      const blob = new Blob([buildSettingsExport(s, { ...options, exportedAt: new Date().toISOString(), appVersion: 'böngészős bemutató' })], { type: 'application/json' })
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
  }
}

const DEMO_UPDATE_STATE: UpdateState = {
  channel: null,
  currentVersion: 'böngészős bemutató',
  autoUpdate: false,
  phase: 'disabled',
  startup: false,
  canInstall: false,
}

export const api: FlightbookerApi = window.flightbooker ?? createBrowserDemoApi()
export const isBrowserDemo = window.flightbooker === undefined
