import { useEffect, useRef, useState } from 'react'
import { lookupAirport } from '@core/airports/lookup'
import type { BookingRequest } from '@core/model/planning'
import type { FlightRoute, RouteStop } from '@core/model/route'
import { DEFAULT_ROUTE_SPEED_KT, ICAO_PATTERN, routeLegs, usableStops, type RouteLeg } from '@core/route/timing'
import type { RouteWeatherState } from '../state'
import { Button, NumberInput, Segmented } from './ui'

/**
 * Helyi vagy útvonalas repülés (K27, SZB-19). Útvonalnál megadható az indulás (alapból a
 * bázis), az érintett repülőterek sorrendben, és a pontok közötti repült idő. Alapból a
 * két repülőtér légvonalbeli távolságából számolja, 90 csomóval, és ezt írja be; az
 * oktató felülírhatja saját számolt értékkel, és visszaállíthatja.
 */

/** Egy igényen legfeljebb ennyi érintett repülőtér (a tervezet sémája szerint). */
const MAX_STOPS = 20

type Coordinate = { readonly latitude: number; readonly longitude: number }

export function RouteEditor(props: {
  request: BookingRequest
  baseIcao: string | undefined
  baseCoordinates: Coordinate | undefined
  routeWeather: RouteWeatherState
  onChange: (route: FlightRoute | undefined) => void
  /** A repülés hosszának átírása (az útvonal teljes idejére). */
  onFlightMinutes: (minutes: number) => void
}) {
  const { request, baseIcao } = props
  const route = request.route
  // Helyire váltás után a beírt útvonal visszahozható (a munkamenet alatt).
  const remembered = useRef<FlightRoute | undefined>(undefined)

  const setMode = (mode: 'local' | 'route'): void => {
    if (mode === 'local') {
      remembered.current = route
      return props.onChange(undefined)
    }
    const base = baseIcao ?? ''
    props.onChange(remembered.current ?? { departure: base, stops: [{ icao: '' }, ...(base ? [{ icao: base }] : [])] })
  }

  const mode = route ? 'route' : 'local'
  return (
    <div className="route-editor">
      <div className="briefing-source">
        <span className="muted small">Feladat:</span>
        <Segmented
          ariaLabel="Helyi vagy útvonalas repülés"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'local', label: 'Helyi', title: 'Csak a bázis időjárása számít, a teljes repülés alatt' },
            { value: 'route', label: 'Útvonal', title: 'Az érintett repülőterek időjárása is számít, abban az időben, amikor a gép ott lehet' },
          ]}
        />
      </div>
      {route && <RouteStops {...props} route={route} />}
    </div>
  )
}

/**
 * A repülőterek koordinátája a programmal szállított listából (hálózat nélkül, ALP-02).
 * `null`: a kód nincs a listában.
 */
function useAirportCoordinates(codes: readonly string[]): Readonly<Record<string, Coordinate | null>> {
  const [found, setFound] = useState<Record<string, Coordinate | null>>({})
  const key = [...new Set(codes.filter((c) => ICAO_PATTERN.test(c)))].sort().join(',')
  useEffect(() => {
    const missing = key.split(',').filter((c) => c !== '' && !(c in found))
    if (missing.length === 0) return
    let cancelled = false
    void Promise.all(missing.map(async (c) => [c, await lookupAirport(c)] as const)).then((list) => {
      if (cancelled) return
      setFound((prev) => ({ ...prev, ...Object.fromEntries(list.map(([c, a]) => [c, a ? { latitude: a.latitude, longitude: a.longitude } : null])) }))
    })
    return () => {
      cancelled = true
    }
  }, [key, found])
  return found
}

function RouteStops(props: {
  request: BookingRequest
  route: FlightRoute
  baseIcao: string | undefined
  baseCoordinates: Coordinate | undefined
  routeWeather: RouteWeatherState
  onChange: (route: FlightRoute | undefined) => void
  onFlightMinutes: (minutes: number) => void
}) {
  const { route, request, baseIcao, routeWeather } = props
  const flightMinutes = request.durations.main
  const set = (patch: Partial<FlightRoute>): void => props.onChange({ ...route, ...patch })
  const setStop = (index: number, patch: Partial<RouteStop>): void =>
    set({ stops: route.stops.map((s, i) => (i === index ? withoutUndefined({ ...s, ...patch }) : s)) })
  const removeStop = (index: number): void => set({ stops: route.stops.filter((_, i) => i !== index) })
  const addStop = (icao = ''): void => set({ stops: [...route.stops, { icao }] })

  // Szakaszidők: kézi, vagy a távolságból 90 csomóval; ugyanúgy, ahogy a motor számol.
  const found = useAirportCoordinates([route.departure, ...route.stops.map((s) => s.icao)])
  const coordinates = (icao: string): Coordinate | undefined => (icao === baseIcao ? props.baseCoordinates : (found[icao] ?? routeWeather.weather[icao]))
  const legs = routeLegs(route, flightMinutes, coordinates)
  const legOf = new Map<number, { leg: RouteLeg; arrival: number }>()
  let k = 0
  let elapsed = 0
  route.stops.forEach((s, i) => {
    if (!ICAO_PATTERN.test(s.icao)) return
    const leg = legs[k++]
    if (!leg) return
    elapsed += leg.minutes
    legOf.set(i, { leg, arrival: Math.round(elapsed) })
  })
  const total = Math.round(legs.reduce((sum, l) => sum + l.minutes, 0))
  const anyShare = legs.some((l) => l.source === 'share')
  const filled = usableStops(route).length
  const last = route.stops[route.stops.length - 1]
  const returnsHome = last !== undefined && last.icao === route.departure

  return (
    <div className="route-stops" role="group" aria-label="Útvonal">
      <div className="route-row">
        <span className="route-label">Indulás</span>
        <IcaoInput value={route.departure} ariaLabel="Indulási repülőtér" onChange={(departure) => set({ departure })} />
        <WeatherState icao={route.departure} baseIcao={baseIcao} state={routeWeather} />
        {baseIcao && route.departure !== baseIcao && (
          <button type="button" className="link small" onClick={() => set({ departure: baseIcao })}>
            vissza a bázisra ({baseIcao})
          </button>
        )}
      </div>
      {route.stops.map((s, i) => {
        const info = legOf.get(i)
        const leg = info?.leg
        const computed = leg && leg.source === 'distance' ? leg.minutes : undefined
        const nm = leg?.distanceNm !== undefined ? `${Math.round(leg.distanceNm)} NM` : undefined
        const manual = s.elapsedMinutes !== undefined
        const title = manual
          ? `Saját érték.${nm ? ` Légvonal: ${nm}.` : ''}`
          : computed !== undefined
            ? `Számolt: ${nm} légvonalban, ${DEFAULT_ROUTE_SPEED_KT} csomóval. Átírható saját értékre.`
            : 'A repülőtér koordinátája nem ismert: a repülés hátralévő idejéből kap részt. Megadhatod kézzel.'
        return (
          <div className="route-row" key={i}>
            <span className="route-label">{i === route.stops.length - 1 ? 'Cél' : `${i + 1}. pont`}</span>
            <IcaoInput value={s.icao} ariaLabel={`${i + 1}. érintett repülőtér`} onChange={(icao) => setStop(i, { icao })} />
            <label className={`route-elapsed${manual ? ' manual' : ' computed'}`} title={title}>
              <NumberInput
                width={64}
                ariaLabel={`Szakaszidő a(z) ${i + 1}. pontig (perc)`}
                min={1}
                max={24 * 60}
                value={s.elapsedMinutes ?? computed}
                placeholder="auto"
                onChange={(v) => setStop(i, { elapsedMinutes: v === undefined || v < 1 ? undefined : Math.min(24 * 60, Math.round(v)) })}
              />
              <span className="muted small">perc</span>
            </label>
            {manual ? (
              <button
                type="button"
                className="icon-btn route-reset"
                title={leg?.distanceNm !== undefined ? `Vissza a számolt értékre (${DEFAULT_ROUTE_SPEED_KT} csomóval)` : 'Kézi érték törlése'}
                aria-label={`A(z) ${i + 1}. szakaszidő visszaállítása`}
                onClick={() => setStop(i, { elapsedMinutes: undefined })}
              >
                ↺
              </button>
            ) : (
              <span className="route-source muted small" title={title}>
                {computed !== undefined ? `${DEFAULT_ROUTE_SPEED_KT} kt` : info ? 'becsült' : ''}
              </span>
            )}
            {info && (
              <span className={`muted small route-eta${manual ? '' : ' estimated'}`} title="Érkezés a repülés kezdetétől">
                +{info.arrival} p
              </span>
            )}
            <WeatherState icao={s.icao} baseIcao={baseIcao} state={routeWeather} />
            <button type="button" className="icon-btn" title="Repülőtér törlése" aria-label={`A(z) ${i + 1}. repülőtér törlése`} onClick={() => removeStop(i)}>
              ×
            </button>
          </div>
        )
      })}
      <div className="route-row route-actions">
        <Button small onClick={() => addStop()} disabled={route.stops.length >= MAX_STOPS}>
          + Repülőtér
        </Button>
        {!returnsHome && ICAO_PATTERN.test(route.departure) && (
          <Button small variant="ghost" onClick={() => addStop(route.departure)} disabled={route.stops.length >= MAX_STOPS}>
            + Vissza: {route.departure}
          </Button>
        )}
        {filled === 0 ? (
          <span className="small muted">Adj meg legalább egy érintett repülőteret; addig helyi repülésként számol.</span>
        ) : (
          <>
            <span className={`small ${total > flightMinutes ? 'warn-text' : 'muted'}`}>
              {total > flightMinutes
                ? `Az útvonal ${total} perc, a repülés csak ${flightMinutes}; az érkezések a repülés végére esnek.`
                : `Útvonal: ${total} perc, repülés: ${flightMinutes} perc.`}
              {anyShare ? ' Ismeretlen repülőtérnél a maradék időből oszt.' : ''}
            </span>
            {!anyShare && total !== flightMinutes && total > 0 && (
              <Button small variant="ghost" onClick={() => props.onFlightMinutes(total)} title="A repülés hossza (gépidő) legyen az útvonal teljes ideje">
                Repülés: {total} perc
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/** Négybetűs ICAO-kód: csak betű, nagybetűvel. */
function IcaoInput(props: { value: string; onChange: (v: string) => void; ariaLabel: string }) {
  const invalid = props.value !== '' && !ICAO_PATTERN.test(props.value)
  return (
    <input
      type="text"
      className={`input icao-input${invalid ? ' invalid' : ''}`}
      value={props.value}
      maxLength={4}
      placeholder="LHXX"
      aria-label={props.ariaLabel}
      aria-invalid={invalid || undefined}
      spellCheck={false}
      onChange={(e) => props.onChange(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
    />
  )
}

/** Az előrejelzés állapota egy repülőtérre: a bázisé a hét adatával jön. */
function WeatherState(props: { icao: string; baseIcao: string | undefined; state: RouteWeatherState }) {
  const { icao, state } = props
  if (!ICAO_PATTERN.test(icao)) return null
  if (icao === props.baseIcao) return <span className="route-wx muted small" title="A bázis előrejelzése a hét adatával jön">bázis</span>
  if (state.loading.includes(icao)) return <span className="route-wx muted small">előrejelzés…</span>
  const error = state.errors[icao]
  if (error) return <span className="route-wx warn-text small" title={error}>{error === 'Ismeretlen ICAO-kód.' ? 'ismeretlen kód' : 'nincs előrejelzés'}</span>
  if (state.weather[icao]) return <span className="route-wx ok-text small" title="Az előrejelzés betöltve; a motor ezt is nézi">✓ előrejelzés</span>
  return null
}

function withoutUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}
