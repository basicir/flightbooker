import type { BookingRequest } from '../model/planning'
import type { FlightRoute } from '../model/route'

/**
 * Útvonalas repülés időzítése (K27, SZB-19): mikor lehet a gép az egyes repülőtereken.
 *
 * Az indulás a repülés kezdete. Az érintett repülőterekre érkezés az előző pontok
 * szakaszidejének összege. A meg nem adott szakaszidőt a két repülőtér légvonalbeli
 * távolságából számolja, 90 csomós sebességgel; ismeretlen koordinátánál a repülés
 * hátralévő idejéből kap egyenlő részt. Ha a szakaszidők összege hosszabb a repülésnél, az
 * érkezés a repülés végére esik.
 */

export const ICAO_PATTERN = /^[A-Z]{4}$/

/** A szakaszidő alapértékének sebessége (csomó), ha az oktató nem ad meg saját időt. */
export const DEFAULT_ROUTE_SPEED_KT = 90

/** Egy pont körül ennyi idő számít az időjárásnál (érkezés előtt és után), percben. */
export const ROUTE_POINT_MARGIN_MINUTES = 30

const MINUTE_MS = 60_000
const KM_PER_NM = 1.852

export type RoutePointRole = 'departure' | 'stop' | 'destination'

/** Honnan jön egy szakasz ideje: kézzel megadva, a távolságból, vagy a maradékból. */
export type LegSource = 'manual' | 'distance' | 'share'

export interface RouteLeg {
  readonly minutes: number
  readonly source: LegSource
  /** A szakasz légvonalbeli hossza tengeri mérföldben, ha a végpontok ismertek. */
  readonly distanceNm?: number
}

export interface RoutePointTime {
  readonly icao: string
  readonly role: RoutePointRole
  /** A becsült érkezés (indulásnál az indulás) ideje. */
  readonly atMs: number
  /** Az időjárás vizsgált ablaka. */
  readonly fromMs: number
  readonly toMs: number
  /** Az érkezést legalább egy nem kézzel megadott szakaszidő adja. */
  readonly estimated: boolean
}

export type Coordinates = (icao: string) => { readonly latitude: number; readonly longitude: number } | undefined

/** Légvonalbeli távolság kilométerben (haversine). */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.latitude - a.latitude) * rad
  const dLon = (b.longitude - a.longitude) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** A szakaszidő percben a távolságból, a megadott sebességgel; legalább 1 perc. */
export function legMinutesAt(distanceNm: number, speedKt = DEFAULT_ROUTE_SPEED_KT): number {
  return Math.max(1, Math.round((distanceNm / speedKt) * 60))
}

/** Az útvonal érvényes pontjai: a hiányos (még nem kitöltött) repülőterek kimaradnak. */
export function usableStops(route: FlightRoute): FlightRoute['stops'] {
  return route.stops.filter((s) => ICAO_PATTERN.test(s.icao))
}

/** Útvonalas-e az igény: repülés, érvényes indulással és legalább egy érintett repülőtérrel. */
export function isRouteFlight(request: BookingRequest): request is BookingRequest & { readonly route: FlightRoute } {
  return request.kind === 'flight' && request.route !== undefined && ICAO_PATTERN.test(request.route.departure) && usableStops(request.route).length > 0
}

/** A megadott szakaszidők összege percben. */
export function knownElapsedMinutes(route: FlightRoute): number {
  return usableStops(route).reduce((sum, s) => sum + (s.elapsedMinutes ?? 0), 0)
}

/**
 * A szakaszok ideje az érvényes pontokra, sorrendben: a kézzel megadott, különben a
 * távolságból 90 csomóval számolt; ismeretlen koordinátánál a repülés (`flightMinutes`)
 * hátralévő idejének egyenlő része.
 */
export function routeLegs(route: FlightRoute, flightMinutes: number, coordinates: Coordinates): RouteLeg[] {
  const stops = usableStops(route)
  const legs: Array<RouteLeg | undefined> = stops.map((s, i) => {
    const from = coordinates(i === 0 ? route.departure : stops[i - 1]!.icao)
    const to = coordinates(s.icao)
    const distanceNm = from && to ? distanceKm(from, to) / KM_PER_NM : undefined
    const nm = distanceNm === undefined ? {} : { distanceNm }
    if (s.elapsedMinutes !== undefined) return { minutes: s.elapsedMinutes, source: 'manual', ...nm }
    return distanceNm === undefined ? undefined : { minutes: legMinutesAt(distanceNm), source: 'distance', distanceNm }
  })
  const open = legs.filter((l) => l === undefined).length
  const used = legs.reduce((sum, l) => sum + (l?.minutes ?? 0), 0)
  const share = open > 0 ? Math.max(0, flightMinutes - used) / open : 0
  return legs.map((l) => l ?? { minutes: share, source: 'share' })
}

/** Az útvonal teljes ideje percben (a kézi és a számolt szakaszidőkből). */
export function routeTotalMinutes(route: FlightRoute, flightMinutes: number, coordinates: Coordinates): number {
  return Math.round(routeLegs(route, flightMinutes, coordinates).reduce((sum, l) => sum + l.minutes, 0))
}

/** Az útvonal pontjainak ideje és időjárási ablaka. */
export function routePointTimes(route: FlightRoute, flightStartMs: number, flightEndMs: number, coordinates: Coordinates): RoutePointTime[] {
  const stops = usableStops(route)
  const totalMinutes = Math.max(0, (flightEndMs - flightStartMs) / MINUTE_MS)
  const legs = routeLegs(route, totalMinutes, coordinates)

  const margin = ROUTE_POINT_MARGIN_MINUTES * MINUTE_MS
  const window = (atMs: number, before: boolean, after: boolean): { fromMs: number; toMs: number } => {
    const fromMs = Math.max(flightStartMs, before ? atMs - margin : atMs)
    const toMs = Math.min(flightEndMs, after ? atMs + margin : atMs)
    return toMs > fromMs ? { fromMs, toMs } : { fromMs: Math.min(fromMs, toMs), toMs: Math.min(fromMs, toMs) + MINUTE_MS }
  }

  const points: RoutePointTime[] = [{ icao: route.departure, role: 'departure', atMs: flightStartMs, ...window(flightStartMs, false, true), estimated: false }]
  let elapsed = 0
  let estimated = false
  stops.forEach((s, i) => {
    const leg = legs[i]!
    estimated = estimated || leg.source !== 'manual'
    elapsed += leg.minutes
    // Egész percre kerekítve: a becslés lebegőpontos maradéka ne tolja át az órahatárt.
    const atMs = Math.min(flightEndMs, flightStartMs + Math.round(elapsed) * MINUTE_MS)
    const last = i === stops.length - 1
    points.push({ icao: s.icao, role: last ? 'destination' : 'stop', atMs, ...window(atMs, true, !last), estimated })
  })
  return points
}

/** A tervhez szükséges útvonal-repülőterek (a bázison kívül), ábécérendben. */
export function routeAirports(requests: readonly BookingRequest[], baseIcao: string | undefined): string[] {
  const set = new Set<string>()
  for (const r of requests) {
    if (!isRouteFlight(r)) continue
    for (const icao of [r.route.departure, ...usableStops(r.route).map((s) => s.icao)]) if (icao !== baseIcao) set.add(icao)
  }
  return [...set].sort()
}

/** Rövid szöveges leírás: „LHBS → LHKV → LHBS”. */
export function routeLabel(route: FlightRoute): string {
  return [route.departure, ...usableStops(route).map((s) => s.icao)].join(' → ')
}
