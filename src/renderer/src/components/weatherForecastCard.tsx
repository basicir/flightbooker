import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Settings } from '@core/config/schema'
import type { DataBundle } from '@core/model/dataBundle'
import type { WeatherHour } from '@core/model/snapshot'
import type { WeatherLimits } from '@core/model/weather'
import { addDays, localToMs } from '@core/time/zoned'
import { NO_CEILING_FT } from '@core/weather/rating'
import { bucketShares, hitRates, HIT_TOLERANCE, isHit, LEAD_BUCKET_LABELS, LOG_DAYS, SKILL_GROUPS, type LoggedForecast, type ModelSkillSummary, type SkillGroup, type VerificationLogHour } from '@core/weather/skill'
import type { Observation } from '@core/weather/metar'
import {
  dayConsensus,
  dayVerdict,
  forecastHorizon,
  hourPoints,
  summarizeDay,
  WEATHER_CHECK_MODELS,
  type DayConsensus,
  type DayForecast,
  type DayVerdict,
  type ForecastPlace,
  type ModelForecast,
} from '@core/weather/forecastCheck'
import type { WeatherCheckResult } from '../../../shared/api'
import { api } from '../bridge'
import { dateTimeShort, dayLabel, timeOf } from '../format'
import { Meteogram, type MeteogramSeries } from './meteogram'
import { Badge, Button, Card, Empty } from './ui'

/**
 * Időjárás-előrejelzés az indítópulton (ADT-07, 7.4): meteogram, amelyen a tervezés
 * előrejelzése (Open-Meteo best_match, a heti adatfrissítéskor letöltve) és az Open-Meteo
 * többi modellje közös időtengelyen látszik, az iskolai minimum szerinti minősítéssel.
 * A napi összesítés táblázatban is elérhető. Az ellenőrzést szolgálja, a terv nem ebből számol.
 */

/** Ennyi ideig nem kérjük le újra ugyanazt (képernyőváltáskor se menjen ki új kérés). */
const CACHE_MS = 30 * 60_000
const cache = new Map<string, { at: number; result: WeatherCheckResult }>()

const ENGINE_ID = 'engine'

interface Row {
  readonly id: string
  readonly label: string
  readonly title: string
  readonly days: readonly DayForecast[]
  readonly hours: readonly WeatherHour[]
  /** A kategóriás szín sorszáma: a tervezésé az 1., a modelleké a lista sorrendjében. */
  readonly colorSlot: number
  readonly error?: string
}

const VERDICT_LABEL: Record<DayVerdict, string> = {
  good: 'jó',
  mixed: 'vegyes',
  poor: 'rossz',
  nodata: 'nincs adat',
}
const VERDICT_TONE: Record<DayVerdict, 'ok' | 'warn' | 'danger' | 'neutral'> = {
  good: 'ok',
  mixed: 'warn',
  poor: 'danger',
  nodata: 'neutral',
}

const fmt = (v: number | null, digits = 0): string =>
  v === null
    ? '–'
    : v.toLocaleString('hu-HU', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      })

export function WeatherForecastCard(props: { settings: Settings; bundle: DataBundle | null; weekStart: string; today: string }) {
  const { settings, bundle, weekStart, today } = props
  const airport = settings.airport
  const [state, setState] = useState<{
    readonly key: string
    readonly result?: WeatherCheckResult
    readonly error?: string
  } | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  const weekEnd = addDays(weekStart, 6)
  const firstDay = weekStart > today ? weekStart : today
  const days = useMemo(() => {
    const result: string[] = []
    for (let d = firstDay; d <= weekEnd; d = addDays(d, 1)) result.push(d)
    return result
  }, [firstDay, weekEnd])

  const key = airport ? `${airport.latitude},${airport.longitude}|${weekStart}` : ''
  const active = airport !== null && days.length > 0
  const fetchCheck = useCallback(
    (): Promise<void> =>
      api.fetchWeatherCheck(weekStart, settings).then(
        (result) => {
          cache.set(key, { at: Date.now(), result })
          setState({ key, result })
        },
        (e: unknown) => setState({ key, error: e instanceof Error ? e.message : String(e) }),
      ),
    // A beállítások többi része (például a limitek) nem változtat a letöltésen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  )
  useEffect(() => {
    if (!active) return
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < CACHE_MS) return
    void fetchCheck()
  }, [active, key, fetchCheck])

  // A régebbi gyorsítótárbeli adat is látszik, amíg a hatás az újat letölti.
  const own = state?.key === key ? state : null
  const check = own?.result ?? cache.get(key)?.result ?? null
  const error = own?.error ?? null
  const loading = refreshing || (active && check === null && error === null)
  const refresh = (): void => {
    setRefreshing(true)
    void fetchCheck().finally(() => setRefreshing(false))
  }

  if (!airport) {
    return (
      <Card title="Időjárás-előrejelzés" className="card-wide">
        <Empty>Nincs megadva a repülőtér; a beállításokban adható meg.</Empty>
      </Card>
    )
  }

  const place: ForecastPlace = {
    timeZone: airport.timezone,
    latitude: airport.latitude,
    longitude: airport.longitude,
    runwayHeadingsDeg: airport.runways.map((r) => r.trueHeadingDeg),
  }
  const minima = settings.weather.schoolMinima
  const summarize = (hours: readonly WeatherHour[]): DayForecast[] => days.map((d) => summarizeDay(hours, d, place, minima))
  const horizonText = (hours: readonly WeatherHour[]): string => {
    const last = forecastHorizon(hours)
    return last ? `adat eddig: ${dateTimeShort(last, airport.timezone)}` : 'nincs adat'
  }

  const engineHours = bundle?.snapshot.weather ?? []
  // A tervezés a modellek pontosság szerint súlyozott együttese (ADT-07); a régi
  // gyorsítótárban még best_match.
  const engineSource = bundle?.snapshot.weatherSource
  const engineRow: Row | undefined = bundle
    ? {
        id: ENGINE_ID,
        label: engineSource ? `Tervezés (súlyozott, ${engineSource.models.length} modell)` : 'Tervezés (best_match)',
        title: `Ebből számol a terv. Letöltve: ${dateTimeShort(bundle.fetchedAt, airport.timezone)}, ${horizonText(engineHours)}${
          engineSource?.staleModels?.length ? `. Most nem jött le, a legutóbbi (6 órán belüli) letöltése pótolta: ${engineSource.staleModels.map((id) => WEATHER_CHECK_MODELS.find((x) => x.id === id)?.label ?? id).join(', ')}` : ''
        }`,
        days: summarize(engineHours),
        hours: engineHours,
        colorSlot: 1,
      }
    : undefined
  const modelRows: Row[] = (check?.models ?? []).map((m) => {
    const meta = WEATHER_CHECK_MODELS.find((x) => x.id === m.model)
    return {
      id: m.model,
      label: meta?.label ?? m.model,
      title: `${meta?.detail ?? m.model}; ${horizonText(m.hours)}`,
      days: summarize(m.hours),
      hours: m.hours,
      colorSlot: WEATHER_CHECK_MODELS.findIndex((x) => x.id === m.model) + 2,
      ...(m.error ? { error: m.error } : {}),
    }
  })
  const rows = [...(engineRow ? [engineRow] : []), ...modelRows]
  // A nap teljes nappali óraszáma: a legtöbbet lefedő modellé. Az ennél jóval kevesebbet
  // lefedő modellnap (az előrejelzés vége) részleges, és nem számít az összképbe.
  const fullHours = days.map((_, i) => Math.max(0, ...rows.filter((r) => !r.error).map((r) => r.days[i]!.hours)))
  const consensus = days.map((d, i) =>
    dayConsensus(
      d,
      engineRow?.days[i],
      modelRows.filter((r) => !r.error).map((r) => r.days[i]!),
      Math.ceil(fullHours[i]! * 0.75),
    ),
  )
  const fromMs = days.length > 0 ? localToMs(days[0]!, 0, airport.timezone) : 0
  const toMs = days.length > 0 ? localToMs(addDays(days[days.length - 1]!, 1), 0, airport.timezone) : 0
  const series: MeteogramSeries[] = rows
    .filter((r) => !r.error)
    .map((r) => ({
      id: r.id,
      label: r.label,
      colorSlot: r.colorSlot,
      emphasis: r.id === ENGINE_ID,
      points: hourPoints(r.hours, fromMs, toMs, place, minima),
    }))
  const missing = rows.filter((r) => r.error)
  const selectedDay = selected && days.includes(selected) ? selected : days[0]
  const selectedIndex = selectedDay ? days.indexOf(selectedDay) : -1

  return (
    <Card
      title={`Időjárás-előrejelzés – ${airport.icaoCode}`}
      className="card-wide"
      actions={
        <Button small onClick={refresh} disabled={loading || days.length === 0}>
          {loading ? 'Letöltés…' : 'Modellek frissítése'}
        </Button>
      }
    >
      {days.length === 0 ? (
        <Empty>A hét már elmúlt; az előrejelzés a mai naptól látszik.</Empty>
      ) : (
        <div className="stack">
          <p className="small muted">
            Óránként, forrásonként: felül a minősítés az iskolai minimum szerint, alatta a korlátozó mennyiségek. A halvány piros sáv a minimumon kívüli tartomány. A forrásokra
            kattintva elrejthetők, az egérrel az óra összes értéke látszik. A napok fölött a nappali órák összképe (hány forrás szerint jó, vegyes vagy rossz).
          </p>
          {error && <p className="error-text small">A modellek letöltése nem sikerült: {error}</p>}
          {loading && !check && <p className="small muted">A modellek letöltése folyamatban…</p>}
          <Meteogram series={series} days={days} place={place} minima={minima} consensus={consensus} />
          {missing.length > 0 && <p className="small muted">Adat nélkül: {missing.map((r) => `${r.label} (${r.error})`).join(', ')}</p>}

          <details className="wx-details">
            <summary>Napi összesítés táblázatban</summary>
            <p className="small muted">
              A nappali órák (napkeltétől napnyugtáig) aránya modellenként: <span className="ok-text">repülhető</span>, <span className="warn-text">bizonytalan</span>,{' '}
              <span className="error-text">nem repülhető</span>. Napra kattintva a részletek látszanak.
            </p>
            <div className="table-scroll">
              <table className="table compact wx-table">
                <thead>
                  <tr>
                    <th>Forrás</th>
                    {days.map((d) => (
                      <th key={d}>
                        <button type="button" className={`wx-day${d === selectedDay ? ' selected' : ''}`} onClick={() => setSelected(d)} aria-pressed={d === selectedDay}>
                          {dayLabel(d)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="wx-consensus">
                    <td>Összkép</td>
                    {consensus.map((c) => (
                      <td key={c.date}>
                        <ConsensusCell c={c} />
                      </td>
                    ))}
                  </tr>
                  {rows.map((r) => (
                    <tr key={r.id} className={r.id === ENGINE_ID ? 'wx-engine' : undefined}>
                      <td title={r.title}>{r.label}</td>
                      {r.error ? (
                        <td colSpan={days.length} className="muted small">
                          {r.error}
                        </td>
                      ) : (
                        r.days.map((d, i) => (
                          <td key={d.date}>
                            <DayCell d={d} minima={minima} fullHours={fullHours[i]!} />
                          </td>
                        ))
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {selectedDay && selectedIndex >= 0 && (
              <>
                <h4 className="wx-detail-title">{dayLabel(selectedDay)} – részletek (nappali órák)</h4>
                <div className="table-scroll">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Forrás</th>
                        <th>Nap</th>
                        <th className="num">Repülhető óra</th>
                        <th className="num">Hőm. °C</th>
                        <th className="num">Szél / lökés kt</th>
                        <th className="num">Oldalszél kt</th>
                        <th className="num">Látás km</th>
                        <th className="num" title="A legalacsonyabb 50% fölötti felhőréteg alja a modell nyomási szintjei alapján (plafon)">
                          Felhőalap ft*
                        </th>
                        <th className="num">Alacsony felhő %</th>
                        <th className="num">Csapadék mm</th>
                        <th className="num">Valószínűség %</th>
                        <th>Zivatar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .filter((r) => !r.error)
                        .map((r) => {
                          const d = r.days[selectedIndex]!
                          const v = dayVerdict(d)
                          if (v === 'nodata') {
                            return (
                              <tr key={r.id} className="muted">
                                <td>{r.label}</td>
                                <td colSpan={11}>A modell erre a napra nem ad előrejelzést.</td>
                              </tr>
                            )
                          }
                          return (
                            <tr key={r.id} className={r.id === ENGINE_ID ? 'wx-engine' : undefined}>
                              <td>{r.label}</td>
                              <td>
                                <Badge tone={VERDICT_TONE[v]}>{VERDICT_LABEL[v]}</Badge>
                              </td>
                              <td className="num">
                                {d.flyable}/{d.hours}
                              </td>
                              <td className="num">
                                {fmt(d.tempMinC)}…{fmt(d.tempMaxC)}
                              </td>
                              <td className="num">
                                <Limited value={d.windMaxKt} max={minima.maxWindKt} /> / <Limited value={d.gustMaxKt} max={minima.maxGustKt} />
                              </td>
                              <td className="num">
                                <Limited value={d.crosswindMaxKt} max={minima.maxCrosswindKt} />
                              </td>
                              <td className="num">
                                <Limited value={d.visibilityMinM} min={minima.minVisibilityM} scale={1000} digits={1} />
                              </td>
                              <td className="num">
                                <Limited value={d.cloudBaseMinFt === null ? null : Math.round(d.cloudBaseMinFt / 100) * 100} min={minima.minCloudBaseFt} text={d.cloudBaseMinFt !== null && d.cloudBaseMinFt >= NO_CEILING_FT ? 'nincs' : undefined} />
                              </td>
                              <td className="num">
                                <Limited value={d.lowCloudMaxPct} max={minima.maxLowCloudCoverPct} />
                              </td>
                              <td className="num">{fmt(d.precipitationMm, 1)}</td>
                              <td className="num">
                                <Limited value={d.precipitationProbabilityMaxPct} max={minima.maxPrecipitationProbabilityPct} />
                              </td>
                              <td>{d.thunder ? <Badge tone="danger">veszély</Badge> : <span className="muted">–</span>}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </details>

          {check?.skill && <ModelWeights skill={check.skill} models={check.models} tz={airport.timezone} icao={airport.icaoCode} />}

          <p className="small muted">
            Forrás: Open-Meteo (CC BY 4.0), a bázis koordinátájára. A „Tervezés” sor a heti adatfrissítéskor letöltött modellek súlyozott együttese, a terv ebből számol
            (szél, hőmérséklet, csapadék: súlyozott átlag; látás, felhőalap: súlyozott medián). A súly a modell {airport.icaoCode} METAR-jához mért pontossága; a modellsorok
            az összevetéshez vannak
            {check ? `, letöltve: ${dateTimeShort(check.fetchedAt, airport.timezone)}` : ''}. Pirossal az iskolai minimumon kívüli érték. A felhőalap a modell plafonja: a legalacsonyabb 50% fölötti
            felhőréteg alja a nyomási szintenkénti felhőzetből (az ECMWF kevesebb szintet ad, ott durvább); „nincs”, ha kb. 10 000 ft alatt nincs ilyen réteg, 5000 ft
            fölött a grafikon tetején. Profil nélkül (régi letöltés) a hőmérséklet–harmatpont becslés marad. A látástávolságot nem minden modell adja. A METAR (aviationweather.gov)
            csak a mérésre szolgál; TAF nincs benne (SZB-17).
          </p>
        </div>
      )}
    </Card>
  )
}

/**
 * A modellek súlya a tervezésben előrejelzési távolság szerint, és a METAR-ral mért hiba
 * (ADT-07). Kevés mérésnél az induló súly dominál.
 */
function ModelWeights(props: { skill: ModelSkillSummary; models: readonly ModelForecast[]; tz: string; icao: string }) {
  const { skill, models } = props
  const available = models.filter((m) => !m.error && m.hours.length > 0).map((m) => m.model)
  const shares = LEAD_BUCKET_LABELS.map((_, b) => bucketShares(skill.weights, b, available))
  const rmse = (model: string, group: 'wind' | 'visibility' | 'ceiling'): number | null => {
    // Az összes sáv mért hibája, a mérések számával súlyozva.
    let n = 0
    let sse = 0
    for (const w of skill.weights[model] ?? []) {
      const r = w.rmse[group]
      if (r === null) continue
      n += w.n[group]
      sse += r * r * w.n[group]
    }
    return n > 0 ? Math.sqrt(sse / n) : null
  }
  const hours = (model: string): number => (skill.weights[model] ?? []).reduce((s, w) => s + w.n.wind, 0)
  return (
    <details className="wx-details">
      <summary>Modellsúlyok a tervezésben (METAR-mérés)</summary>
      <p className="small muted">
        {skill.measuredHours === 0
          ? 'Még nincs mérés: az induló súlyok számítanak (a nagy felbontású modellek az első két napon, az ECMWF később kap többet). A letöltött előrejelzéseket az alkalmazás eltárolja, és az elmúlt órákat a METAR-ral veti össze; a mérés néhány nap alatt fokozatosan átveszi a súlyozást.'
          : `Az elmúlt 30 napban ${skill.measuredHours} modellóra mérve. A súly a négyzetes hiba fordítottja; kb. 72 mért óráig az induló súly is számít.`}
        {skill.error ? ` Figyelem: ${skill.error}` : ''}
      </p>
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Modell</th>
              {LEAD_BUCKET_LABELS.map((l) => (
                <th key={l} className="num">
                  {l}
                </th>
              ))}
              <th className="num">Mért óra</th>
              <th className="num" title="Négyzetes középhiba a METAR-hoz, az összes távolságon">
                Hiba: szél kt / látás km / plafon ft
              </th>
            </tr>
          </thead>
          <tbody>
            {available.map((m) => {
              const meta = WEATHER_CHECK_MODELS.find((x) => x.id === m)
              const wind = rmse(m, 'wind')
              const vis = rmse(m, 'visibility')
              const ceil = rmse(m, 'ceiling')
              return (
                <tr key={m}>
                  <td>{meta?.label ?? m}</td>
                  {shares.map((s, b) => (
                    <td key={b} className="num">
                      {Math.round((s[m] ?? 0) * 100)}%
                    </td>
                  ))}
                  <td className="num">{hours(m)}</td>
                  <td className="num">
                    {fmt(wind, 1)} / {fmt(vis, 1)} / {ceil === null ? '–' : Math.round((ceil * 1000) / 100) * 100}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {skill.log && skill.log.length > 0 ? (
        <VerificationLog log={skill.log} tz={props.tz} icao={props.icao} />
      ) : (
        <p className="small muted">A mérés METAR-jai itt jelennek meg, amint egy letöltött előrejelzés órája elmúlik, és a METAR megérkezik hozzá.</p>
      )}
    </details>
  )
}

const GROUP_HEADS: Readonly<Record<SkillGroup, string>> = {
  wind: `Szél ±${HIT_TOLERANCE.wind} kt`,
  gust: `Lökés ±${HIT_TOLERANCE.gust} kt`,
  visibility: `Látás ±${HIT_TOLERANCE.visibility} km`,
  ceiling: `Plafon ±${HIT_TOLERANCE.ceiling * 1000} ft`,
  temperature: `Hő ±${HIT_TOLERANCE.temperature} °C`,
}

const modelLabel = (id: string): string => WEATHER_CHECK_MODELS.find((x) => x.id === id)?.label ?? id
const modelOrder = (id: string): number => {
  const i = WEATHER_CHECK_MODELS.findIndex((x) => x.id === id)
  return i < 0 ? Number.MAX_SAFE_INTEGER : i
}

/** Egy óra értékei a naplóban (a METAR és az előrejelzés ugyanígy). */
type HourValues = Pick<Observation, 'windKt' | 'gustKt' | 'visibilityM' | 'ceilingFt' | 'temperatureC'>
const CELL: Readonly<Record<SkillGroup, (v: HourValues) => string>> = {
  wind: (v) => (v.windKt === null ? '–' : `${Math.round(v.windKt)} kt`),
  gust: (v) => (v.gustKt === null ? '–' : `${Math.round(v.gustKt)} kt`),
  visibility: (v) => (v.visibilityM === null ? '–' : v.visibilityM >= 10_000 ? '10+ km' : `${(v.visibilityM / 1000).toFixed(1)} km`),
  ceiling: (v) => (v.ceilingFt === null ? 'nincs' : `${Math.round(v.ceilingFt / 100) * 100} ft`),
  temperature: (v) => (v.temperatureC === null ? '–' : `${fmt(v.temperatureC, 1)} °C`),
}

/**
 * A mérési napló (ADT-07): modellenként a találati arány az utolsó napok METAR-jaihoz, és
 * óránként a METAR a modellek előrejelzésével. Modellenként a legfrissebb (legrövidebb távú)
 * előrejelzés számít; a súlyozás ennél részletesebb (távolság-sávonként), ez az áttekintés.
 */
function VerificationLog(props: { log: readonly VerificationLogHour[]; tz: string; icao: string }) {
  const { log, tz } = props
  const rates = hitRates(log)
  const models = Object.keys(rates).sort((a, b) => modelOrder(a) - modelOrder(b))
  const pct = (h: { hits: number; n: number }): string => (h.n === 0 ? '–' : `${Math.round((h.hits / h.n) * 100)}%`)
  const newest = [...log].reverse()
  const leadH = (f: LoggedForecast, time: string): number => Math.round((Date.parse(time) - Date.parse(f.issuedAt)) / 3_600_000)
  return (
    <div className="stack-tight">
      <h4 className="wx-subhead">Találati arány az utolsó {LOG_DAYS} nap METAR-jaihoz</h4>
      <p className="small muted">
        Óránként a modell legfrissebb előrejelzése a {props.icao} METAR-jához: a tűrésen belüli órák aránya. A látás 10 km, a plafon 5000 ft fölött nem számít eltérésnek.
      </p>
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Modell</th>
              <th className="num">Mért óra</th>
              {SKILL_GROUPS.map((g) => (
                <th key={g} className="num">
                  {GROUP_HEADS[g]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr key={m}>
                <td>{modelLabel(m)}</td>
                <td className="num">{Math.max(...SKILL_GROUPS.map((g) => rates[m]![g].n))}</td>
                {SKILL_GROUPS.map((g) => (
                  <td key={g} className="num" title={`${rates[m]![g].hits} / ${rates[m]![g].n} óra a tűrésen belül`}>
                    {pct(rates[m]![g])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="wx-details">
        <summary>A mérés METAR-jai ({log.length} óra)</summary>
        <p className="small muted">Kattints egy órára: a METAR értelmezett értékei és a modellek előrejelzése rá. Pirossal a tűrésen kívüli érték.</p>
        <div className="metar-log">
          {newest.map((h) => {
            const date = new Date(h.time)
            const day = dayLabel(new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(date))
            const forecasts = [...h.forecasts].sort((a, b) => modelOrder(a.model) - modelOrder(b.model))
            return (
              <details key={h.time} className="metar-hour">
                <summary>
                  <span className="metar-time">
                    {day} {timeOf(h.time, tz)}
                  </span>
                  <code className="metar-raw">{h.observation.raw ?? 'nyers jelentés nélkül'}</code>
                </summary>
                <div className="table-scroll">
                  <table className="table compact">
                    <thead>
                      <tr>
                        <th>Forrás</th>
                        <th className="num" title="Hány órával az adott időpont előtt készült az előrejelzés">
                          Előre
                        </th>
                        {SKILL_GROUPS.map((g) => (
                          <th key={g} className="num">
                            {GROUP_HEADS[g].split(' ')[0]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="top">
                        <td>METAR (mért)</td>
                        <td className="num muted">–</td>
                        {SKILL_GROUPS.map((g) => (
                          <td key={g} className="num">
                            {CELL[g](h.observation)}
                          </td>
                        ))}
                      </tr>
                      {forecasts.map((f) => (
                        <tr key={f.model}>
                          <td>{modelLabel(f.model)}</td>
                          <td className="num">{leadH(f, h.time)} ó</td>
                          {SKILL_GROUPS.map((g) => {
                            const hit = isHit(g, f, h.observation)
                            return (
                              <td key={g} className={hit === false ? 'num error-text' : 'num'} title={hit === false ? 'a tűrésen kívül' : undefined}>
                                {CELL[g](f)}
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )
          })}
        </div>
      </details>
    </div>
  )
}

/** Egy modell egy napja a táblázatban: a nappali órák aránya és a legfontosabb szélsőérték. */
function DayCell(props: { d: DayForecast; minima: WeatherLimits; fullHours: number }) {
  const { d, minima, fullHours } = props
  if (d.hours === 0) return <span className="muted small">nincs adat</span>
  const pct = (n: number): string => `${(n / d.hours) * 100}%`
  const gustOver = d.gustMaxKt !== null && minima.maxGustKt !== undefined && d.gustMaxKt > minima.maxGustKt
  return (
    <div className="wx-cell" title={`${d.flyable} repülhető, ${d.marginal} bizonytalan, ${d.unflyable} nem repülhető nappali óra`}>
      <div className="wx-bar" aria-hidden="true">
        <span className="wx-ok" style={{ width: pct(d.flyable) }} />
        <span className="wx-warn" style={{ width: pct(d.marginal) }} />
        <span className="wx-bad" style={{ width: pct(d.unflyable) }} />
      </div>
      <span className="small">
        <span className={gustOver ? 'error-text' : undefined}>{fmt(d.gustMaxKt)} kt</span>
        {d.precipitationMm !== null && d.precipitationMm > 0 && ` · ${fmt(d.precipitationMm, 1)} mm`}
        {d.thunder && ' · zivatar'}
      </span>
      {d.hours < fullHours && <span className="small muted">részleges ({d.hours} óra)</span>}
    </div>
  )
}

function ConsensusCell(props: { c: DayConsensus }) {
  const { c } = props
  if (c.models === 0) return <span className="muted small">nincs adat</span>
  const tone = c.majority ? VERDICT_TONE[c.majority] : 'warn'
  const label = c.majority ? VERDICT_LABEL[c.majority] : 'megosztott'
  const agree = c.majority ? c[c.majority] : Math.max(c.good, c.mixed, c.poor)
  return (
    <div className="wx-cell">
      <span>
        <Badge tone={tone}>
          {label} {agree}/{c.models}
        </Badge>
      </span>
      {c.engineDisagrees && (
        <span className="small warn-text" title="A tervezés előrejelzése más képet ad, mint a többi modell többsége: érdemes a napot fenntartással kezelni.">
          a tervezés eltér
        </span>
      )}
      {c.gustSpreadKt !== null && c.gustSpreadKt >= 10 && <span className="small muted">lökés szórása {c.gustSpreadKt} kt</span>}
    </div>
  )
}

/** Szám, pirossal, ha az iskolai minimumon kívül esik. */
function Limited(props: { value: number | null; max?: number | undefined; min?: number | undefined; scale?: number; digits?: number; text?: string | undefined }) {
  const { value, max, min } = props
  if (value === null) return <span className="muted">–</span>
  const over = (max !== undefined && value > max) || (min !== undefined && value < min)
  const shown = props.text ?? fmt(value / (props.scale ?? 1), props.digits ?? 0)
  return <span className={over ? 'error-text' : undefined}>{shown}</span>
}
