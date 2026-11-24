import { contextBridge, ipcRenderer } from 'electron'
import pkg from '../../package.json'
import { IPC, type FlightbookerApi, type UpdateState } from '../shared/api'

/**
 * A preload szűk, rögzített felületet ad a rendernek: csak a megnevezett IPC-hívásokat.
 * Hálózatot, fájlt és titkot a felület közvetlenül nem ér el.
 */
const api: FlightbookerApi = {
  appVersion: process.env['npm_package_version'] ?? pkg.version ?? 'fejlesztői',
  loadSettings: () => ipcRenderer.invoke(IPC.loadSettings),
  saveSettings: (settings) => ipcRenderer.invoke(IPC.saveSettings, settings),
  hasApiKey: () => ipcRenderer.invoke(IPC.hasApiKey),
  saveApiKey: (key) => ipcRenderer.invoke(IPC.saveApiKey, key),
  clearApiKey: () => ipcRenderer.invoke(IPC.clearApiKey),
  refreshData: (weekStart, settings, options) => ipcRenderer.invoke(IPC.refreshData, weekStart, settings, options),
  loadCachedData: (weekStart) => ipcRenderer.invoke(IPC.loadCachedData, weekStart),
  fetchRouteWeather: (weekStart, icaos, settings) => ipcRenderer.invoke(IPC.fetchRouteWeather, weekStart, icaos, settings),
  fetchWeatherCheck: (weekStart, settings) => ipcRenderer.invoke(IPC.fetchWeatherCheck, weekStart, settings),
  cancelRefresh: () => ipcRenderer.invoke(IPC.cancelRefresh),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  onRefreshProgress: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, value: unknown): void => {
      if (!value || typeof value !== 'object') return
      const p = value as Record<string, unknown>
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      listener({ stage: typeof p['stage'] === 'string' ? p['stage'] : '', done: num(p['done']), total: num(p['total']), requests: num(p['requests']), waitedSeconds: num(p['waitedSeconds']) })
    }
    ipcRenderer.on(IPC.refreshProgress, handler)
    return () => {
      ipcRenderer.removeListener(IPC.refreshProgress, handler)
    }
  },
  openSyllabusFolder: () => ipcRenderer.invoke(IPC.openSyllabusFolder),
  loadWeekPlan: (weekStart) => ipcRenderer.invoke(IPC.loadWeekPlan, weekStart),
  saveWeekPlan: (plan) => ipcRenderer.invoke(IPC.saveWeekPlan, plan),
  copyText: (text) => ipcRenderer.invoke(IPC.copyText, text),
  readText: () => ipcRenderer.invoke(IPC.readText),
  loadTheoryCatalog: (settings, options) => ipcRenderer.invoke(IPC.loadTheoryCatalog, settings, options),
  exportSettings: (settings, options) => ipcRenderer.invoke(IPC.exportSettings, settings, options),
  openSettingsFile: () => ipcRenderer.invoke(IPC.openSettingsFile),
  resetAll: (options) => ipcRenderer.invoke(IPC.resetAll, options),
  readMaintenanceSheet: (image, fleet) => ipcRenderer.invoke(IPC.readMaintenanceSheet, image, fleet),
  getUpdateState: () => ipcRenderer.invoke(IPC.getUpdateState),
  onUpdateState: (listener) => {
    const handler = (_e: Electron.IpcRendererEvent, value: unknown): void => {
      if (value && typeof value === 'object' && 'phase' in value) listener(value as UpdateState)
    }
    ipcRenderer.on(IPC.updateState, handler)
    return () => {
      ipcRenderer.removeListener(IPC.updateState, handler)
    }
  },
  checkForUpdates: () => ipcRenderer.invoke(IPC.checkForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.installUpdate),
  skipUpdate: () => ipcRenderer.invoke(IPC.skipUpdate),
  setAutoUpdate: (enabled) => ipcRenderer.invoke(IPC.setAutoUpdate, enabled),
  // A fő változatban a főfolyamat ezeket nem kezeli: a hívás ott hibával tér vissza.
  dev: {
    importFromStable: () => ipcRenderer.invoke(IPC.devImportFromStable),
    startupImport: () => ipcRenderer.invoke(IPC.devStartupImport),
    relaunch: () => ipcRenderer.invoke(IPC.devRelaunch),
    getPromotionState: () => ipcRenderer.invoke(IPC.devPromotionState),
    saveGithubToken: (token) => ipcRenderer.invoke(IPC.devSaveGithubToken, token),
    clearGithubToken: () => ipcRenderer.invoke(IPC.devClearGithubToken),
    startPromotion: () => ipcRenderer.invoke(IPC.devStartPromotion),
  },
}

contextBridge.exposeInMainWorld('flightbooker', api)
