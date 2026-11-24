import type { LocalDate } from '../model/time'

/**
 * Napállás-számítás (a „sunrise equation”, NOAA-közelítés, ~1 perc pontosság) külső adat
 * nélkül. Az Open-Meteo csak napkeltét és napnyugtát ad, a polgári szürkületet (a Nap
 * 6°-kal a horizont alatt) innen számoljuk – az éjszakai repülés ettől kezdődhet.
 */

const RAD = Math.PI / 180
const J2000 = 2451545
const UNIX_EPOCH_JD = 2440587.5
const DAY_MS = 86_400_000

/** A nap eseményei UTC ezredmásodpercben; `undefined`, ha a Nap aznap nem éri el a magasságot. */
export interface SunEvents {
  readonly rise?: number
  readonly set?: number
}

/** Mikor halad át a Nap a megadott magasságon (fok; a napkelte -0,833, a polgári szürkület -6). */
export function sunEvents(date: LocalDate, latitude: number, longitude: number, altitudeDeg: number): SunEvents {
  const noonUtcMs = Date.parse(`${date}T12:00:00Z`)
  const jd = noonUtcMs / DAY_MS + UNIX_EPOCH_JD
  const n = Math.round(jd - J2000 - 0.0009 + longitude / 360)
  const jStar = n - longitude / 360
  const m = (((357.5291 + 0.98560028 * jStar) % 360) + 360) % 360
  const c = 1.9148 * Math.sin(m * RAD) + 0.02 * Math.sin(2 * m * RAD) + 0.0003 * Math.sin(3 * m * RAD)
  const lambda = (m + c + 180 + 102.9372) % 360
  const transit = J2000 + jStar + 0.0053 * Math.sin(m * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD)
  const cosDecl = Math.cos(Math.asin(sinDecl))
  const cosOmega = (Math.sin(altitudeDeg * RAD) - Math.sin(latitude * RAD) * sinDecl) / (Math.cos(latitude * RAD) * cosDecl)
  if (cosOmega < -1 || cosOmega > 1) return {}
  const omega = Math.acos(cosOmega) / RAD
  const toMs = (j: number): number => Math.round((j - UNIX_EPOCH_JD) * DAY_MS)
  return { rise: toMs(transit - omega / 360), set: toMs(transit + omega / 360) }
}

/** Polgári szürkület: hajnalban ettől, este eddig van „nappal” a légijogi értelemben. */
export function civilTwilight(date: LocalDate, latitude: number, longitude: number): { readonly dawn?: number; readonly dusk?: number } {
  const e = sunEvents(date, latitude, longitude, -6)
  return { ...(e.rise !== undefined ? { dawn: e.rise } : {}), ...(e.set !== undefined ? { dusk: e.set } : {}) }
}
