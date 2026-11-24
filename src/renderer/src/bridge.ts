import { createBrowserDemoApi } from '@browser-demo'
import type { FlightbookerApi } from '../../shared/api'

/**
 * A felület egyetlen kapcsolata a külvilággal. Electronban a preload adja. A böngészős fejlesztői
 * előnézetben (`npm run dev:web`) a `@browser-demo` memóriabeli megvalósítás ad szintetikus adatot;
 * az Electron-buildben ez az alias egy üres modulra mutat, így a szintetikus adat a programba nem
 * kerül (a bemutató mód megszűnt).
 */
export const api: FlightbookerApi = window.flightbooker ?? createBrowserDemoApi()
export const isBrowserDemo = window.flightbooker === undefined
