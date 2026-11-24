import type { FlightbookerApi } from '../shared/api'

declare global {
  interface Window {
    /** Electronban a preload adja; böngészős bemutatóban hiányzik. */
    flightbooker?: FlightbookerApi
  }
}

export {}
