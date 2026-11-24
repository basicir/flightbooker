import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { HourRating, WeatherLimits } from '@core/model/weather'
import { sunEvents } from '@core/time/solar'
import { addDays, HOUR_MS, localParts, localToMs } from '@core/time/zoned'
import type { DayConsensus, ForecastPlace, HourPoint } from '@core/weather/forecastCheck'
import { NO_CEILING_FT } from '@core/weather/rating'
import { dayLabel, timeOf } from '../format'

/**
 * Meteogram (ADT-07, 7.4): közös időtengelyen óránként a minősítés és a repülést korlátozó
 * mennyiségek, minden forrás saját vonallal. Minden panelnek saját tengelye van; a
 * vonalak színe a forráshoz tartozik (nem a sorrendhez), elrejtéskor sem változik.
 */

export interface MeteogramSeries {
  readonly id: string
  readonly label: string
  /** A kategóriás szín sorszáma (1–8), a forráshoz rögzítve. */
  readonly colorSlot: number
  /** A tervezés forrása: vastagabb vonal, legfelül. */
  readonly emphasis: boolean
  readonly points: readonly HourPoint[]
}

interface Panel {
  readonly key: string
  readonly title: string
  readonly unit: string
  readonly get: (p: HourPoint) => number | null
  readonly limit: number | undefined
  readonly limitKind: 'max' | 'min'
  readonly domain: (values: readonly number[], limit: number | undefined) => readonly [number, number]
  readonly digits: number
  /** Az azonos csoportú panelek közös skálát kapnak (a szél és a lökés így összevethető). */
  readonly scaleGroup?: string
  /** Szélirány-nyilak a panel fölött. */
  readonly arrows?: boolean
}

const RATING_COLOR: Record<HourRating, string> = {
  flyable: 'var(--ok)',
  marginal: 'var(--warn)',
  unflyable: 'var(--danger)',
}
const RATING_LABEL: Record<HourRating, string> = {
  flyable: 'repülhető',
  marginal: 'bizonytalan',
  unflyable: 'nem repülhető',
}
const VERDICT_LABEL = { good: 'jó', mixed: 'vegyes', poor: 'rossz' } as const

const GUTTER = 136
const RIGHT = 12
const HEADER = 54
const RATING_ROW = 10
const RATING_GAP = 5
const PANEL_HEIGHT = 64
/** A panelek közötti hely: itt a cím és a választóvonal. */
const PANEL_GAP = 30
/** A szélirány-nyilak sávja a szélpanel fölött. */
const ARROW_STRIP = 20
/** Egy napnak legalább ennyi hely kell a felirathoz; keskenyebb ablakban a grafikon görgethető. */
const MIN_DAY_WIDTH = 120

const niceMax = (v: number): number => {
  const step = v <= 10 ? 2 : v <= 50 ? 10 : v <= 200 ? 20 : v <= 1000 ? 100 : 1000
  return Math.ceil(v / step) * step
}
const maxDomain =
  (floor: number, limitFactor: number) =>
  (values: readonly number[], limit: number | undefined): readonly [number, number] => [0, niceMax(Math.max(floor, limit !== undefined ? limit * limitFactor : 0, ...values))]

function panels(minima: WeatherLimits): Panel[] {
  return [
    {
      key: 'wind',
      title: 'Szél (állandó)',
      unit: 'kt',
      get: (p) => p.windKt,
      limit: minima.maxWindKt,
      limitKind: 'max',
      domain: maxDomain(20, 1.25),
      digits: 0,
      scaleGroup: 'wind',
      arrows: true,
    },
    {
      key: 'gust',
      title: 'Széllökés',
      unit: 'kt',
      get: (p) => p.gustKt,
      limit: minima.maxGustKt,
      limitKind: 'max',
      domain: maxDomain(20, 1.25),
      digits: 0,
      scaleGroup: 'wind',
    },
    {
      key: 'crosswind',
      title: 'Oldalszél',
      unit: 'kt',
      get: (p) => p.crosswindKt,
      limit: minima.maxCrosswindKt,
      limitKind: 'max',
      domain: maxDomain(10, 1.3),
      digits: 0,
    },
    {
      key: 'cloudBase',
      title: 'Felhőalap (plafon)',
      unit: 'ft',
      get: (p) => (p.cloudBaseFt === null ? null : Math.min(5000, p.cloudBaseFt)),
      limit: minima.minCloudBaseFt,
      limitKind: 'min',
      domain: () => [0, 5000],
      digits: 0,
    },
    {
      key: 'visibility',
      title: 'Látás',
      unit: 'km',
      get: (p) => (p.visibilityM === null ? null : Math.min(20, p.visibilityM / 1000)),
      limit: minima.minVisibilityM === undefined ? undefined : minima.minVisibilityM / 1000,
      limitKind: 'min',
      domain: () => [0, 20],
      digits: 1,
    },
    {
      key: 'precip',
      title: 'Csapadék',
      unit: 'mm/h',
      get: (p) => p.precipitationMm,
      limit: minima.maxPrecipitationMmPerH,
      limitKind: 'max',
      domain: maxDomain(1, 1.5),
      digits: 1,
    },
    {
      key: 'temp',
      title: 'Hőmérséklet',
      unit: '°C',
      get: (p) => p.temperatureC,
      limit: undefined,
      limitKind: 'max',
      domain: (values) => (values.length === 0 ? [0, 10] : [Math.floor(Math.min(...values) / 5) * 5, Math.ceil((Math.max(...values) + 0.1) / 5) * 5]),
      digits: 0,
    },
  ]
}

const fmt = (v: number | null, digits: number): string =>
  v === null
    ? '–'
    : v.toLocaleString('hu-HU', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })

function useWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWidth(Math.round(w))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function Meteogram(props: { series: readonly MeteogramSeries[]; days: readonly string[]; place: ForecastPlace; minima: WeatherLimits; consensus: readonly DayConsensus[] }) {
  const { series, days, place, minima, consensus } = props
  const [boxRef, boxWidth] = useWidth()
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [hoverMs, setHoverMs] = useState<number | null>(null)

  const tz = place.timeZone
  const fromMs = localToMs(days[0]!, 0, tz)
  const toMs = localToMs(addDays(days[days.length - 1]!, 1), 0, tz)
  const width = Math.max(GUTTER + RIGHT + days.length * MIN_DAY_WIDTH, boxWidth)
  const plotW = width - GUTTER - RIGHT
  const x = (ms: number): number => GUTTER + ((ms - fromMs) / (toMs - fromMs)) * plotW

  const visible = series.filter((s) => !hidden.has(s.id))
  // A kiemelt (tervezés) vonal legfelül.
  const drawOrder = [...visible].sort((a, b) => Number(a.emphasis) - Number(b.emphasis))
  const panelList = useMemo(() => panels(minima), [minima])

  const ratingTop = HEADER + PANEL_GAP
  const ratingHeight = Math.max(1, visible.length) * (RATING_ROW + RATING_GAP) - RATING_GAP
  // A panelek teteje (a nyílsáv a panel része, a rajzterület alatta kezdődik).
  const layout: { readonly panel: Panel; readonly top: number; readonly plotTop: number }[] = []
  let cursor = ratingTop + ratingHeight + PANEL_GAP
  for (const panel of panelList) {
    const plotTop = cursor + (panel.arrows ? ARROW_STRIP : 0)
    layout.push({ panel, top: cursor, plotTop })
    cursor = plotTop + PANEL_HEIGHT + PANEL_GAP
  }
  const height = cursor - PANEL_GAP + 8
  // Közös skála csoportonként (szél és lökés).
  const groupValues = new Map<string, number[]>()
  for (const panel of panelList) {
    if (!panel.scaleGroup) continue
    const list = groupValues.get(panel.scaleGroup) ?? []
    for (const s of visible)
      for (const p of s.points) {
        const v = panel.get(p)
        if (v !== null) list.push(v)
      }
    groupValues.set(panel.scaleGroup, list)
  }
  const groupLimit = (group: string): number | undefined => {
    const limits = panelList.filter((p) => p.scaleGroup === group && p.limit !== undefined).map((p) => p.limit!)
    return limits.length > 0 ? Math.max(...limits) : undefined
  }
  // A szélirány-nyilak forrása: a kiemelt (tervezés), ha látszik, különben az első látható.
  const arrowSeries = visible.find((s) => s.emphasis) ?? visible[0]

  const nights = days.flatMap((d) => {
    const start = localToMs(d, 0, tz)
    const end = localToMs(addDays(d, 1), 0, tz)
    const sun = sunEvents(d, place.latitude, place.longitude, -0.833)
    if (sun.rise === undefined || sun.set === undefined) return []
    return [
      { key: `${d}a`, from: start, to: sun.rise },
      { key: `${d}b`, from: sun.set, to: end },
    ]
  })

  const onMove = (e: MouseEvent<SVGRectElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ms = fromMs + ((e.clientX - rect.left) / rect.width) * (toMs - fromMs)
    setHoverMs(Math.max(fromMs, Math.min(toMs - HOUR_MS, Math.floor(ms / HOUR_MS) * HOUR_MS)))
  }

  const toggle = (id: string): void => {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hoverX = hoverMs === null ? null : x(hoverMs + HOUR_MS / 2)
  const hoverRows = hoverMs === null ? [] : visible.map((s) => ({ s, p: s.points.find((p) => p.ms === hoverMs) }))

  return (
    <div className="mg">
      <div className="mg-legend" role="group" aria-label="Források megjelenítése">
        {series.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`mg-chip${hidden.has(s.id) ? ' off' : ''}`}
            aria-pressed={!hidden.has(s.id)}
            onClick={() => toggle(s.id)}
            title={hidden.has(s.id) ? 'Megjelenítés' : 'Elrejtés'}
          >
            <span className={`mg-swatch${s.emphasis ? ' strong' : ''}`} style={{ background: `var(--series-${s.colorSlot})` }} />
            {s.label}
            {s.points.length === 0 && <span className="muted"> (nincs adat)</span>}
          </button>
        ))}
        <span className="mg-key small muted">
          <span className="mg-box" style={{ background: 'var(--ok)' }} /> repülhető <span className="mg-box" style={{ background: 'var(--warn)' }} /> bizonytalan{' '}
          <span className="mg-box" style={{ background: 'var(--danger)' }} /> nem repülhető <span className="mg-box mg-night" /> éjszaka <span className="mg-dash" /> iskolai
          minimum
        </span>
      </div>

      <div className="mg-scroll" ref={boxRef}>
        <div className="mg-plot" style={{ width }}>
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Meteogram: óránkénti minősítés, szél és szélirány, széllökés, oldalszél, felhőalap, látás, csapadék és hőmérséklet forrásonként"
          >
            {/* sávok: minden második sor halvány háttérrel, köztük választóvonal */}
            {[{ key: 'rating', top: ratingTop, bottom: ratingTop + ratingHeight }, ...layout.map((l) => ({ key: l.panel.key, top: l.top, bottom: l.plotTop + PANEL_HEIGHT }))].map(
              (band, i) => (
                <g key={`band-${band.key}`}>
                  {i % 2 === 1 && <rect x={0} y={band.top - PANEL_GAP + 2} width={width} height={band.bottom - band.top + PANEL_GAP - 4} fill="var(--surface-2)" />}
                  <line x1={0} x2={width} y1={band.top - PANEL_GAP + 1} y2={band.top - PANEL_GAP + 1} stroke="var(--border)" strokeWidth={1.5} />
                </g>
              ),
            )}
            {/* éjszaka és napválasztó */}
            {nights.map((n) => (
              <rect key={n.key} x={x(n.from)} y={HEADER} width={Math.max(0, x(n.to) - x(n.from))} height={height - HEADER} fill="var(--night)" />
            ))}
            {days.map((d, i) => {
              const x0 = x(localToMs(d, 0, tz))
              const x1 = x(localToMs(addDays(d, 1), 0, tz))
              const c = consensus[i]
              return (
                <g key={d}>
                  {i > 0 && <line x1={x0} x2={x0} y1={0} y2={height} stroke="var(--border)" />}
                  <text x={(x0 + x1) / 2} y={15} textAnchor="middle" className="mg-day">
                    {dayLabel(d)}
                  </text>
                  {c && c.models > 0 && (
                    <text x={(x0 + x1) / 2} y={32} textAnchor="middle" className={`mg-verdict ${c.majority ?? 'split'}`}>
                      {c.majority ? `${VERDICT_LABEL[c.majority]} ${c[c.majority]}/${c.models}` : `megosztott (${c.models})`}
                    </text>
                  )}
                  {c?.engineDisagrees && (
                    <text x={(x0 + x1) / 2} y={47} textAnchor="middle" className="mg-verdict split">
                      a tervezés eltér
                    </text>
                  )}
                </g>
              )
            })}

            {/* minősítés forrásonként */}
            <text x={8} y={ratingTop - 9} className="mg-title">
              Minősítés <tspan className="mg-unit">iskolai minimum szerint</tspan>
            </text>
            {visible.map((s, row) => {
              const y = ratingTop + row * (RATING_ROW + RATING_GAP)
              return (
                <g key={s.id}>
                  {row > 0 && <line x1={8} x2={GUTTER + plotW} y1={y - RATING_GAP / 2} y2={y - RATING_GAP / 2} stroke="var(--border)" strokeOpacity={0.7} />}
                  <text x={GUTTER - 8} y={y + RATING_ROW - 1} textAnchor="end" className="mg-row-label">
                    {s.label}
                  </text>
                  <rect x={GUTTER - 6} y={y + 1} width={3} height={RATING_ROW - 2} rx={1} fill={`var(--series-${s.colorSlot})`} />
                  {s.points.map((p) => (
                    <rect key={p.ms} x={x(p.ms)} y={y} width={Math.max(1, x(p.ms + HOUR_MS) - x(p.ms))} height={RATING_ROW} fill={RATING_COLOR[p.rating]} />
                  ))}
                </g>
              )
            })}

            {/* vonalas panelek */}
            {layout.map(({ panel, top: bandTop, plotTop: top }) => {
              const values = panel.scaleGroup ? (groupValues.get(panel.scaleGroup) ?? []) : visible.flatMap((s) => s.points.map(panel.get)).filter((v): v is number => v !== null)
              const [lo, hi] = panel.domain(values, panel.scaleGroup ? groupLimit(panel.scaleGroup) : panel.limit)
              const y = (v: number): number => top + PANEL_HEIGHT - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * PANEL_HEIGHT
              const limitY = panel.limit === undefined ? null : y(panel.limit)
              return (
                <g key={panel.key}>
                  <text x={8} y={bandTop - 9} className="mg-title">
                    {panel.title} <tspan className="mg-unit">{panel.unit}</tspan>
                  </text>
                  {panel.arrows && arrowSeries && (
                    <g>
                      <text x={GUTTER - 8} y={bandTop + ARROW_STRIP / 2 + 3} textAnchor="end" className="mg-tick">
                        irány
                      </text>
                      {arrowSeries.points
                        .filter((p) => p.windDirectionDeg !== null && localParts(p.ms, tz).minutes % 180 === 0)
                        .map((p) => (
                          <path
                            key={p.ms}
                            d="M0,6 L0,-6 M-3.5,-2.5 L0,-6 L3.5,-2.5"
                            transform={`translate(${x(p.ms + HOUR_MS / 2).toFixed(1)},${bandTop + ARROW_STRIP / 2}) rotate(${(p.windDirectionDeg! + 180) % 360})`}
                            fill="none"
                            stroke="var(--fg)"
                            strokeOpacity={0.7}
                            strokeWidth={1.3}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <title>{`${timeOf(new Date(p.ms).toISOString(), tz)}: ${Math.round(p.windDirectionDeg!)}° felől, ${fmt(p.windKt, 0)} kt`}</title>
                          </path>
                        ))}
                    </g>
                  )}
                  <rect x={GUTTER} y={top} width={plotW} height={PANEL_HEIGHT} fill="none" stroke="var(--border)" />
                  {/* a minimumon kívüli sáv */}
                  {limitY !== null &&
                    (panel.limitKind === 'max' ? (
                      <rect x={GUTTER} y={top} width={plotW} height={Math.max(0, limitY - top)} fill="var(--danger-soft)" opacity={0.6} />
                    ) : (
                      <rect x={GUTTER} y={limitY} width={plotW} height={Math.max(0, top + PANEL_HEIGHT - limitY)} fill="var(--danger-soft)" opacity={0.6} />
                    ))}
                  <line x1={GUTTER} x2={GUTTER + plotW} y1={top + PANEL_HEIGHT} y2={top + PANEL_HEIGHT} stroke="var(--border)" />
                  {[lo, (lo + hi) / 2, hi].map((t) => (
                    <g key={t}>
                      <line x1={GUTTER} x2={GUTTER + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeOpacity={0.5} />
                      <text x={GUTTER - 8} y={y(t) + 4} textAnchor="end" className="mg-tick">
                        {fmt(t, 0)}
                      </text>
                    </g>
                  ))}
                  {limitY !== null && <line x1={GUTTER} x2={GUTTER + plotW} y1={limitY} y2={limitY} stroke="var(--danger)" strokeDasharray="4 3" strokeWidth={1} />}
                  {drawOrder.map((s) => (
                    <path
                      key={s.id}
                      d={linePath(s.points, panel.get, (ms) => x(ms + HOUR_MS / 2), y)}
                      fill="none"
                      stroke={`var(--series-${s.colorSlot})`}
                      strokeWidth={s.emphasis ? 2.5 : 1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  ))}
                </g>
              )
            })}

            {hoverX !== null && <line x1={hoverX} x2={hoverX} y1={HEADER} y2={height} stroke="var(--fg)" strokeOpacity={0.45} />}
            <rect x={GUTTER} y={HEADER} width={plotW} height={height - HEADER} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHoverMs(null)} />
          </svg>

          {hoverMs !== null && hoverX !== null && (
            <div className="mg-tip" style={hoverX > width - 460 ? { right: width - hoverX + 12 } : { left: hoverX + 12 }}>
              <div className="mg-tip-title">
                {dayLabel(localParts(hoverMs, tz).date)} {timeOf(new Date(hoverMs).toISOString(), tz)}
              </div>
              <table>
                <thead>
                  <tr>
                    <th />
                    <th>Minősítés</th>
                    <th className="num">Szél</th>
                    <th className="num">Lökés</th>
                    <th className="num">Oldal</th>
                    <th className="num">Alap ft</th>
                    <th className="num">Látás km</th>
                    <th className="num">mm/h</th>
                    <th className="num">°C</th>
                  </tr>
                </thead>
                <tbody>
                  {hoverRows.map(({ s, p }) => (
                    <tr key={s.id}>
                      <td>
                        <span className="mg-swatch" style={{ background: `var(--series-${s.colorSlot})` }} /> {s.label}
                      </td>
                      {p ? (
                        <>
                          <td>
                            <span className="mg-box" style={{ background: RATING_COLOR[p.rating] }} /> {RATING_LABEL[p.rating]}
                            {p.thunder ? ', zivatar' : ''}
                          </td>
                          <td className={`num${p.windKt !== null && minima.maxWindKt !== undefined && p.windKt > minima.maxWindKt ? ' error-text' : ''}`}>
                            {p.windDirectionDeg === null ? '' : `${String(Math.round(p.windDirectionDeg)).padStart(3, '0')}°/`}
                            {fmt(p.windKt, 0)}
                          </td>
                          <Val v={p.gustKt} limit={minima.maxGustKt} kind="max" />
                          <Val v={p.crosswindKt} limit={minima.maxCrosswindKt} kind="max" />
                          <Val v={p.cloudBaseFt === null ? null : Math.round(p.cloudBaseFt / 100) * 100} limit={minima.minCloudBaseFt} kind="min" text={p.cloudBaseFt !== null && p.cloudBaseFt >= NO_CEILING_FT ? 'nincs' : undefined} />
                          <Val
                            v={p.visibilityM === null ? null : p.visibilityM / 1000}
                            limit={minima.minVisibilityM === undefined ? undefined : minima.minVisibilityM / 1000}
                            kind="min"
                            digits={1}
                          />
                          <Val v={p.precipitationMm} limit={minima.maxPrecipitationMmPerH} kind="max" digits={1} />
                          <Val v={p.temperatureC} kind="max" />
                        </>
                      ) : (
                        <td colSpan={8} className="muted">
                          nincs adat
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Val(props: { v: number | null; limit?: number | undefined; kind: 'max' | 'min'; digits?: number; text?: string | undefined }) {
  const { v, limit, kind } = props
  const over = v !== null && limit !== undefined && (kind === 'max' ? v > limit : v < limit)
  return <td className={`num${over ? ' error-text' : ''}`}>{props.text ?? fmt(v, props.digits ?? 0)}</td>
}

/** Vonal az órákon át; ahol egy óra hiányzik, a vonal megszakad. */
function linePath(points: readonly HourPoint[], get: (p: HourPoint) => number | null, x: (ms: number) => number, y: (v: number) => number): string {
  let d = ''
  let prev: number | null = null
  for (const p of points) {
    const v = get(p)
    if (v === null) {
      prev = null
      continue
    }
    const cmd = prev !== null && p.ms - prev <= HOUR_MS ? 'L' : 'M'
    d += `${cmd}${x(p.ms).toFixed(1)},${y(v).toFixed(1)}`
    prev = p.ms
  }
  return d
}
