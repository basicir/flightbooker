import type { FlightbookerApi } from '../shared/api'

declare global {
  interface Window {
    /** Electronban a preload adja; a böngészős fejlesztői előnézetben hiányzik. */
    flightbooker?: FlightbookerApi
  }
}

export {}
