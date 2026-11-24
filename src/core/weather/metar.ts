import { HOUR_MS } from '../time/zoned'

/**
 * METAR-megfigyelések a modellek pontosságának méréséhez (ADT-07). A nyers jelentés az
 * aviationweather.gov JSON-válaszából jön; itt csak értelmezzük, hálózat nincs.
 * Egységek: szél csomó, látás méter, felhőalap láb a repülőtér fölött.
 */

/** Egy óra megfigyelése (az órához legközelebbi jelentésből). */
export interface Observation {
  /** Az egész óra, UTC ISO. */
  readonly time: string
  readonly windKt: number | null
  readonly gustKt: number | null
  /** 10 000 m-nél levágva (a METAR 9999-e és a CAVOK „legalább 10 km”). */
  readonly visibilityM: number | null
  /** A legalacsonyabb BKN/OVC/VV réteg alja; `null`, ha nincs ilyen (nincs plafon). */
  readonly ceilingFt: number | null
  readonly temperatureC: number | null
  /** A nyers jelentés (a mérési naplóban megmutatjuk, mi alapján mértünk). */
  readonly raw?: string
}

/** Az aviationweather.gov METAR-rekordjából a használt mezők. */
export interface MetarRecord {
  readonly reportTime?: unknown
  readonly obsTime?: unknown
  readonly rawOb?: unknown
  readonly temp?: unknown
  readonly wspd?: unknown
  readonly wgst?: unknown
  readonly visib?: unknown
  readonly clouds?: unknown
}

export const MAX_OBSERVED_VISIBILITY_M = 10_000
const METERS_PER_SM = 1609.344
const CEILING_COVERS = new Set(['BKN', 'OVC', 'OVX', 'VV'])

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function reportMs(r: MetarRecord): number | null {
  if (typeof r.obsTime === 'number' && Number.isFinite(r.obsTime)) return r.obsTime * 1000
  if (typeof r.reportTime === 'string') {
    const ms = Date.parse(r.reportTime.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(r.reportTime) ? r.reportTime : `${r.reportTime}Z`)
    return Number.isFinite(ms) ? ms : null
  }
  return null
}

/** Látás a nyers jelentésből (méter, CAVOK); ha nem olvasható, a JSON mérföldes értékéből. */
export function metarVisibilityM(r: MetarRecord): number | null {
  const raw = typeof r.rawOb === 'string' ? r.rawOb : ''
  const tokens = raw.split(/\s+/)
  if (tokens.includes('CAVOK')) return MAX_OBSERVED_VISIBILITY_M
  // A szél utáni első négyjegyű csoport (a dátum és az állomás után).
  for (const t of tokens.slice(2)) {
    if (/^\d{4}$/.test(t)) return Math.min(MAX_OBSERVED_VISIBILITY_M, t === '9999' ? MAX_OBSERVED_VISIBILITY_M : Number(t))
    if (/^(RMK|TEMPO|BECMG|NOSIG)$/.test(t)) break
  }
  // A „6+” mérföld a szolgáltatás legnagyobb kategóriája (a 9999 és a CAVOK is ez).
  if (typeof r.visib === 'string' && /^\d+(\.\d+)?\+$/.test(r.visib)) return MAX_OBSERVED_VISIBILITY_M
  const sm = num(r.visib)
  return sm === null ? null : Math.min(MAX_OBSERVED_VISIBILITY_M, sm * METERS_PER_SM)
}

/** A legalacsonyabb BKN/OVC/VV réteg alja lábban; `null`, ha nincs plafon. */
export function metarCeilingFt(r: MetarRecord): number | null {
  if (!Array.isArray(r.clouds)) return null
  let lowest: number | null = null
  for (const c of r.clouds as unknown[]) {
    if (!c || typeof c !== 'object') continue
    const cover = (c as { cover?: unknown }).cover
    const base = num((c as { base?: unknown }).base)
    if (typeof cover !== 'string' || !CEILING_COVERS.has(cover) || base === null) continue
    lowest = lowest === null ? base : Math.min(lowest, base)
  }
  return lowest
}

/**
 * Órás megfigyelések: minden egész órához a legfeljebb 30 percre eső legközelebbi jelentés
 * (egyenlőségnél a korábbi). A széllökés hiánya azt jelenti, hogy nem volt jelentős lökés:
 * ekkor a lökés a szélsebesség.
 */
export function hourlyObservations(records: readonly MetarRecord[]): Observation[] {
  const best = new Map<number, { readonly dist: number; readonly ms: number; readonly r: MetarRecord }>()
  for (const r of records) {
    const ms = reportMs(r)
    if (ms === null) continue
    const hour = Math.round(ms / HOUR_MS) * HOUR_MS
    const dist = Math.abs(ms - hour)
    if (dist > HOUR_MS / 2) continue
    const prev = best.get(hour)
    if (!prev || dist < prev.dist || (dist === prev.dist && ms < prev.ms)) best.set(hour, { dist, ms, r })
  }
  return [...best.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hour, { r }]) => {
      const windKt = num(r.wspd)
      const gust = num(r.wgst)
      return {
        time: new Date(hour).toISOString(),
        windKt,
        gustKt: windKt === null ? gust : Math.max(windKt, gust ?? windKt),
        visibilityM: metarVisibilityM(r),
        ceilingFt: metarCeilingFt(r),
        temperatureC: num(r.temp),
        ...(typeof r.rawOb === 'string' && r.rawOb.trim() !== '' ? { raw: r.rawOb.trim().slice(0, 300) } : {}),
      }
    })
}
