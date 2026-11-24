import { allowedFetch as defaultFetch, type AllowedFetch } from './allowedFetch'

/**
 * Open-Meteo Forecast API kliens (ADT-07). Csak koordináta, időablak és a kért
 * változók mennek ki; személyes vagy foglalási adat soha (ALP-02).
 * Források: https://open-meteo.com/en/docs, https://open-meteo.com/en/docs/dwd-api
 */
export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/**
 * A felhőalaphoz használt nyomási szintek (hPa), kb. 300–10 000 láb a repülőtér fölött.
 * Az Open-Meteo közvetlen `cloud_base` változója csak a svájci ICON-CH tartományban ad adatot,
 * ezért a plafont a modell szintenkénti felhőzetéből és geopotenciális magasságából számoljuk.
 * Nem minden modell adja mind a nyolc szintet (az ECMWF például csak 1000/925/850/700-at);
 * a hiányzó szint kimarad.
 */
export const CLOUD_PROFILE_LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700] as const
export type CloudProfileLevel = (typeof CLOUD_PROFILE_LEVELS_HPA)[number]
export type CloudProfileVariable = `cloud_cover_${CloudProfileLevel}hPa` | `geopotential_height_${CloudProfileLevel}hPa`

const CLOUD_PROFILE_VARIABLES: readonly CloudProfileVariable[] = CLOUD_PROFILE_LEVELS_HPA.flatMap(
  (p) => [`cloud_cover_${p}hPa`, `geopotential_height_${p}hPa`] as const,
)

const SURFACE_VARIABLES = [
  'temperature_2m',
  'dew_point_2m',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'cloud_cover_low',
  'visibility',
  'precipitation',
  'precipitation_probability',
  'weather_code',
  'cape',
] as const

export type HourlyVariable = (typeof SURFACE_VARIABLES)[number] | CloudProfileVariable

/**
 * A koncepció 3.2 fejezetének változói és a felhőprofil. A fagyszintet a minősítés nem
 * használja, ezért nem kérjük le (H19); a zivatarveszélyt a CAPE és az időjárás-kód adja.
 */
export const HOURLY_VARIABLES: readonly HourlyVariable[] = [...SURFACE_VARIABLES, ...CLOUD_PROFILE_VARIABLES]

export const DAILY_VARIABLES = ['sunrise', 'sunset'] as const

export type DailyVariable = (typeof DAILY_VARIABLES)[number]

export interface ForecastRequest {
  readonly latitude: number
  readonly longitude: number
  /** Például `icon_d2`, `icon_eu`, `icon_seamless`; üresen az Open-Meteo választ (best match). */
  readonly model?: string
  readonly forecastDays?: number
  readonly timezone?: string
  readonly hourly?: readonly HourlyVariable[]
  readonly daily?: readonly DailyVariable[]
}

export interface ForecastResponse {
  readonly latitude: number
  readonly longitude: number
  readonly elevation?: number
  readonly timezone?: string
  readonly utc_offset_seconds?: number
  readonly hourly_units?: Readonly<Record<string, string>>
  readonly hourly?: Readonly<Record<string, ReadonlyArray<number | string | null>>> & { readonly time?: readonly string[] }
  readonly daily_units?: Readonly<Record<string, string>>
  readonly daily?: Readonly<Record<string, ReadonlyArray<number | string | null>>> & { readonly time?: readonly string[] }
}

export class OpenMeteoError extends Error {
  override readonly name = 'OpenMeteoError'
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

export function buildForecastUrl(request: ForecastRequest): string {
  const { latitude, longitude } = request
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new OpenMeteoError('Érvénytelen szélesség.')
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new OpenMeteoError('Érvénytelen hosszúság.')
  const days = request.forecastDays ?? 7
  if (!Number.isInteger(days) || days < 1 || days > 16) throw new OpenMeteoError('Az előrejelzési napok száma 1 és 16 közötti egész.')
  if (request.model !== undefined && !/^[a-z0-9_]+$/.test(request.model)) throw new OpenMeteoError('Érvénytelen modellnév.')

  const params = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: (request.hourly ?? HOURLY_VARIABLES).join(','),
    daily: (request.daily ?? DAILY_VARIABLES).join(','),
    wind_speed_unit: 'kn',
    timezone: request.timezone ?? 'auto',
    forecast_days: String(days),
  })
  if (request.model) params.set('models', request.model)
  return `${OPEN_METEO_FORECAST_URL}?${params.toString()}`
}

/** Az Open-Meteo-kérés időkorlátja: beragadt kapcsolatnál se várjon a teljes frissítés. */
export const OPEN_METEO_TIMEOUT_MS = 30_000

export async function fetchForecast(request: ForecastRequest, fetchImpl: AllowedFetch = defaultFetch, timeoutMs = OPEN_METEO_TIMEOUT_MS): Promise<ForecastResponse> {
  const signal = AbortSignal.timeout(timeoutMs)
  let response: Response
  try {
    response = await fetchImpl(buildForecastUrl(request), { method: 'GET', headers: { Accept: 'application/json' }, signal })
  } catch (error) {
    if (signal.aborted) throw new OpenMeteoError(`Az Open-Meteo ${Math.round(timeoutMs / 1000)} másodperc alatt nem válaszolt.`)
    throw error
  }
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new OpenMeteoError('Az Open-Meteo válasza nem JSON.', response.status)
  }
  if (!response.ok) {
    const reason = (payload as { reason?: unknown } | null)?.reason
    throw new OpenMeteoError(`Open-Meteo hiba (${response.status}): ${typeof reason === 'string' ? reason : 'ismeretlen'}`, response.status)
  }
  return payload as ForecastResponse
}
