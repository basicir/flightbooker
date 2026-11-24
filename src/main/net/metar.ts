import type { MetarRecord } from '../../core/weather/metar'
import { allowedFetch as defaultFetch, type AllowedFetch } from './allowedFetch'

/**
 * METAR-letöltés az aviationweather.gov Data API-ból (ADT-07: a modellek pontosságának
 * mérése). Csak a bázis ICAO-kódja és az időablak megy ki (ALP-02); kulcs nem kell.
 * Forrás: https://aviationweather.gov/data/api/
 */
export const METAR_URL = 'https://aviationweather.gov/api/data/metar'

/** Egy kérés legfeljebb ennyi órát kér vissza (a szolgáltatás 400 jelentésnél vág). */
export const MAX_METAR_HOURS = 168
export const METAR_TIMEOUT_MS = 20_000

export class MetarError extends Error {
  override readonly name = 'MetarError'
}

export interface MetarRequest {
  readonly icao: string
  readonly hours: number
  /** Az időablak vége (UTC); üresen most. */
  readonly endAt?: Date
}

export function buildMetarUrl(request: MetarRequest): string {
  if (!/^[A-Z]{4}$/.test(request.icao)) throw new MetarError('Érvénytelen ICAO-kód.')
  if (!Number.isInteger(request.hours) || request.hours < 1 || request.hours > MAX_METAR_HOURS) throw new MetarError(`Az órák száma 1 és ${MAX_METAR_HOURS} közötti egész.`)
  const params = new URLSearchParams({ ids: request.icao, format: 'json', hours: String(request.hours) })
  if (request.endAt) {
    const d = request.endAt.toISOString()
    params.set('date', `${d.slice(0, 4)}${d.slice(5, 7)}${d.slice(8, 10)}_${d.slice(11, 13)}${d.slice(14, 16)}`)
  }
  return `${METAR_URL}?${params.toString()}`
}

export async function fetchMetars(request: MetarRequest, fetchImpl: AllowedFetch = defaultFetch, timeoutMs = METAR_TIMEOUT_MS): Promise<MetarRecord[]> {
  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(buildMetarUrl(request), { method: 'GET', headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    if (signal.aborted) throw new MetarError(`Az aviationweather.gov ${Math.round(timeoutMs / 1000)} másodperc alatt nem válaszolt.`)
    throw error
  }
  if (response.status === 204) return []
  if (!response.ok) throw new MetarError(`METAR-letöltési hiba (${response.status}).`)
  const text = await response.text()
  if (text.trim() === '') return []
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new MetarError('Az aviationweather.gov válasza nem JSON.')
  }
  if (!Array.isArray(payload)) throw new MetarError('Váratlan METAR-válasz.')
  return payload.filter((r): r is MetarRecord => r !== null && typeof r === 'object')
}
