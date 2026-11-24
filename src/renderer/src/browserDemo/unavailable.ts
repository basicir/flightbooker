import type { FlightbookerApi } from '../../../shared/api'

/**
 * Az Electron-buildben a böngészős előnézet helyén áll (electron.vite.config.ts, `@browser-demo`):
 * a programban a kapcsolatot mindig a preload adja, szintetikus adat nem kerül a csomagba.
 */
export function createBrowserDemoApi(): FlightbookerApi {
  throw new Error('A felület kapcsolata (preload) hiányzik.')
}
