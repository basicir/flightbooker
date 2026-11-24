import { createDefaultSettings } from '@core/config/defaults'
import { pruneBlockedPeriods } from '@core/config/blockedPeriods'
import type { PlanInput } from '@core/engine/plan'
import type { Settings } from '@core/config/schema'
import { applyCompletedChanges, changesInput, createWeekPlan, defaultWeekStart, lockedCarriedIds, mondayOf, normalizeTeams, recordedInput, rememberBookingIds, syncDeferred, type WeekPlan } from '@core/draft/weekPlan'
import type { WeekWatch } from '@core/engine/weekWatch'
import type { DataBundle } from '@core/model/dataBundle'
import type { BookingRequest, Decision, DecisionIssue, PlanResult } from '@core/model/planning'
import type { AirportWeather } from '@core/model/route'
import { routeAirports } from '@core/route/timing'
import { addDays, localParts, toIso } from '@core/time/zoned'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { RefreshProgress } from '../../shared/api'
import { api } from './bridge'
import { buildPlanInput, hasWatchable, prepareRequests } from './planInput'
import { createPlanner, type Planner } from './planner'
import type { OpeningsList, TrialView } from './openingsSession'
import { progressMap } from './progress'

/**
 * Az alkalmazás állapota. A tervet (javaslatok, dilemmák) nem tároljuk: mindig a motor
 * újrafuttatása adja a pillanatképből, a beállításokból és a döntésekből (TRV-08).
 */

export type ScreenId = 'dashboard' | 'requests' | 'theories' | 'dilemmas' | 'draft' | 'recording' | 'warnings' | 'settings'

type Phase = { kind: 'loading' } | { kind: 'setup'; draft: Settings } | { kind: 'ready' } | { kind: 'error'; errors: readonly string[] }

interface AppContextValue {
  readonly phase: Phase
  readonly settings: Settings | null
  readonly bundle: DataBundle | null
  readonly dataLoading: boolean
  /**
   * A frissítés a háttérben fut: a hét korábbi (gyorsítótárbeli) adatával addig is lehet
   * dolgozni, ezért a felület nem blokkol.
   */
  readonly dataBackground: boolean
  /** A folyamatban lévő betöltés aktuális része (a felület kiírja). */
  readonly dataProgress: RefreshProgress | null
  readonly dataError: string | null
  /**
   * Az útvonal-repülőterek előrejelzése (K27, SZB-19): a betöltött repülőterek és a hibák
   * ICAO-kód szerint, valamint a még töltődők.
   */
  readonly routeWeather: RouteWeatherState
  readonly weekStart: string
  readonly weekPlan: WeekPlan | null
  readonly result: PlanResult | null
  /**
   * Hét közbeni figyelés a nyitott hétre (TRV-15): a FlightLoggerben lévő és a halasztott
   * igények javasolt változtatásai. `null`, amíg számol, vagy nincs terv.
   */
  readonly watch: WeekWatch | null
  /**
   * A háttérben figyelt másik hét (az aktuális vagy a következő naptári hét, ha nem az van nyitva)
   * friss adattal számolt javaslatai; `null`, ha nincs ilyen hét vagy még nem készült el.
   */
  readonly sideWatch: SideWatch | null
  /** A háttérben figyelt hét megnyitása a rögzítési listán (a letöltött adatával). */
  readonly openSideWatch: () => Promise<void>
  /**
   * Halasztott igények, amelyeknek a halasztása nem vonható vissza: a következő héten már
   * döntöttek a másolatukról vagy rögzítették (kettőződnének, H07).
   */
  readonly restoreLocked: readonly string[]
  /** A terv számolása folyamatban (háttérszálon); addig az előző terv látszik. */
  readonly planning: boolean
  readonly planError: string | null
  /** A tervezet mentése nem sikerült (H14). */
  readonly saveError: string | null
  /** A gépek és termek listájának változása a legutóbb látotthoz képest (ADT-06). */
  readonly inventoryChange: { readonly missing: readonly string[]; readonly added: readonly string[] } | null
  readonly acknowledgeInventory: () => Promise<void>
  /** „A többit döntse el a rendszer” (H13): az összes automatikusan eldönthető dilemma. */
  readonly autoResolve: () => Promise<void>
  /** A döntések egy változatával mely döntések dőlnének meg (visszavonás előtti jelzés, 9.3). */
  readonly previewIssues: (decisions: readonly Decision[]) => Promise<readonly DecisionIssue[]>
  /** Képernyőváltás előtti kérdés (például mentetlen beállításoknál, H16); `null` törli. */
  readonly setLeaveGuard: (guard: (() => boolean) | null) => void
  /** A tervezés pillanata (ötpercenként frissülő tényleges idő, H20). */
  readonly planNow: string
  /**
   * A motor bemenete (a feladatkiosztás utáni igények, feladatsorrend): a dilemma-térkép is ezzel
   * számol, hogy ugyanazt lássa, mint a terv.
   */
  readonly planInput: PlanInput | null
  /**
   * „Van még hely?” (KIT-01–03): a kiszámolt terv mellett beférő plusz igények és visszahozások.
   * `null`, ha a terv még nem készült el a mostani bemenettel (a hívó a következő tervnél újrakér).
   */
  readonly findOpenings: (options?: { readonly days?: number }) => Promise<OpeningsList | null>
  /** A legutóbbi keresés egy lehetőségének próbaszámolása a háttérszálon (KIT-04). */
  readonly trialOpening: (token: number, studentId: string, key: string) => Promise<TrialView>
  readonly screen: ScreenId
  readonly timezone: string
  /** Képernyőváltás; a Beállításoknál a megnyitandó fül is megadható (például „Növendékek”). */
  readonly navigate: (screen: ScreenId, options?: { readonly settingsTab?: string }) => void
  /** A Beállítások képernyő kért fülje (a legutóbbi `navigate` szerint). */
  readonly settingsTab: string | null
  readonly saveSettings: (settings: Settings) => Promise<void>
  readonly finishSetup: (settings: Settings) => Promise<void>
  readonly refresh: () => Promise<void>
  readonly setWeek: (weekStart: string) => Promise<void>
  readonly updatePlan: (change: (plan: WeekPlan) => WeekPlan) => void
  readonly resetApp: (options?: { clearApiKey?: boolean }) => Promise<void>
}

export interface SideWatch {
  readonly weekStart: string
  readonly watch: WeekWatch
  /** A figyelt hét adatának letöltési ideje. */
  readonly fetchedAt: string
  readonly bundle: DataBundle
  /** A hét igényei (a nevek és feladatok kiírásához). */
  readonly requests: readonly BookingRequest[]
  /** Mikor készült (ms), a gyorsítótár elévüléséhez. */
  readonly checkedMs: number
}

const EMPTY_WATCH: WeekWatch = { items: [], watched: { booked: 0, deferred: 0 } }
/** Van-e a tervben mit figyelni: FlightLoggerben lévő, hiányzó vagy halasztott igény. */
const watchable = (r: PlanResult): boolean =>
  r.recordedInFlightLogger.length > 0 || r.deferred.length > 0 || r.missingInFlightLogger.length > 0 || r.deferredStillBooked.length > 0 || r.plannedCancels.length > 0

/** A figyelt adat ennyi idő után frissül a háttérben (hét közbeni figyelés). */
const WATCH_REFRESH_MS = 60 * 60_000
/** A háttérben letöltött hét adata ennyi ideig használható megnyitáskor újratöltés nélkül. */
const SIDE_BUNDLE_FRESH_MS = 10 * 60_000

export interface RouteWeatherState {
  readonly weather: Readonly<Record<string, AirportWeather>>
  readonly errors: Readonly<Record<string, string>>
  readonly loading: readonly string[]
}

const EMPTY_ROUTE_WEATHER: RouteWeatherState = { weather: {}, errors: {}, loading: [] }

const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp csak az AppProvideren belül használható.')
  return ctx
}

const DEFAULT_TZ = 'Europe/Budapest'

/** Percenként frissülő „most” a relatív időkhöz (renderelés közben nem hívunk órát). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function todayIn(tz: string): string {
  return localParts(Date.now(), tz).date
}

export function AppProvider(props: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [settings, setSettings] = useState<Settings | null>(null)
  /** A legutóbbi beállítás a háttérben futó műveletekhez (ne írjunk felül közben mentett módosítást). */
  const settingsRef = useRef<Settings | null>(null)
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  const [bundle, setBundle] = useState<DataBundle | null>(null)
  const [dataLoading, setDataLoading] = useState(false)
  const [dataBackground, setDataBackground] = useState(false)
  /** A legutóbb indított frissítés sorszáma: a korábbi (például másik hétre szóló) eredmény elvész. */
  const refreshToken = useRef(0)
  /** A megjelenített adat hete (a háttérfrissítés eldöntéséhez). */
  const bundleWeek = useRef<string | null>(null)
  /** Fut-e a nyitott hét letöltése (a háttérfigyelés ilyenkor nem indul, hogy ne szakítsa meg). */
  const loadingRef = useRef(false)
  const [dataProgress, setDataProgress] = useState<RefreshProgress | null>(null)
  const [dataError, setDataError] = useState<string | null>(null)
  const [weekStart, setWeekStart] = useState(() => defaultWeekStart(todayIn(DEFAULT_TZ)))
  const [weekPlan, setWeekPlan] = useState<WeekPlan | null>(null)
  /** A következő hét már eldöntött halasztott másolatainak forrása (nem hozható vissza, H07). */
  const [nextLocks, setNextLocks] = useState<readonly string[]>([])
  /** A háttérben figyelt hetek eredménye hetenként (hét közbeni figyelés). */
  const [sideWatches, setSideWatches] = useState<Readonly<Record<string, SideWatch>>>({})
  const [screen, setScreen] = useState<ScreenId>('dashboard')
  const [settingsTab, setSettingsTab] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | null>(null)
  const leaveGuard = useRef<(() => boolean) | null>(null)
  /** Az utolsó kiszámolt terv, a hete és a bemenete (más hét terve nem látszik). */
  const [planned, setPlanned] = useState<{ readonly week: string; readonly result: PlanResult; readonly input: PlanInput } | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<string | null>(null)
  // A tervező szál lustán jön létre; leváláskor leáll (StrictMode-ban a React egyszer le- és
  // visszacsatol, ezért a következő használat újra létrehozza).
  const plannerRef = useRef<Planner | null>(null)
  const planner = useCallback((): Planner => (plannerRef.current ??= createPlanner()), [])
  useEffect(
    () => () => {
      plannerRef.current?.dispose()
      plannerRef.current = null
    },
    [],
  )
  // A tervezés pillanata a tényleges idő (H20), ötpercenként frissítve.
  const now = useNow(5 * 60_000)

  const timezone = settings?.airport?.timezone ?? DEFAULT_TZ

  const showBundle = useCallback((b: DataBundle) => {
    bundleWeek.current = b.snapshot.weekStart
    setBundle(b)
  }, [])

  /**
   * Friss adat letöltése. Ha a hétre már van megjelenített adat (például a gyorsítótárból),
   * a letöltés a háttérben fut, és a felület közben használható; egyébként blokkol.
   */
  const loadData = useCallback(
    async (ws: string, s: Settings) => {
      const token = ++refreshToken.current
      loadingRef.current = true
      setDataLoading(true)
      setDataBackground(bundleWeek.current === ws)
      setDataError(null)
      setDataProgress(null)
      const unsubscribe = api.onRefreshProgress((p) => {
        if (token === refreshToken.current) setDataProgress(p)
      })
      try {
        const fresh = await api.refreshData(ws, s)
        if (token === refreshToken.current) showBundle(fresh)
        // Az első élő letöltés után a gépek és termek listája lesz a viszonyítási alap (ADT-06).
        const latest = settingsRef.current ?? s
        if (fresh.source === 'live' && latest.lastSeen === null && fresh.snapshot.fleet.length > 0) {
          const next: Settings = { ...latest, lastSeen: { at: new Date().toISOString(), aircraftIds: fresh.snapshot.fleet.filter((a) => !a.disabled).map((a) => a.id), classroomIds: [...fresh.snapshot.classroomIds] } }
          await api.saveSettings(next)
          setSettings(next)
        }
      } catch (error) {
        if (token === refreshToken.current) setDataError(error instanceof Error ? error.message : String(error))
      } finally {
        unsubscribe()
        if (token === refreshToken.current) {
          loadingRef.current = false
          setDataLoading(false)
          setDataBackground(false)
          setDataProgress(null)
        }
      }
    },
    [showBundle],
  )

  const persist = useCallback((plan: WeekPlan) => {
    api.saveWeekPlan(plan).then(
      () => setSaveError(null),
      (error: unknown) => setSaveError(`A tervezet mentése nem sikerült: ${error instanceof Error ? error.message : String(error)}`),
    )
  }, [])

  const loadWeek = useCallback(
    async (ws: string, s: Settings, prefetched?: DataBundle) => {
      setWeekStart(ws)
      // A nyitott hét figyelése élőben megy; a háttéreredménye elavulna.
      setSideWatches((all) => {
        if (!(ws in all)) return all
        const { [ws]: _drop, ...rest } = all
        return rest
      })
      const existing = await api.loadWeekPlan(ws)
      const previous = (await api.loadWeekPlan(addDays(ws, -7))) ?? undefined
      // A következő héten már eldöntött halasztott másolat nem hozható vissza (H07).
      setNextLocks(lockedCarriedIds(await api.loadWeekPlan(addDays(ws, 7)).catch(() => null), ws))
      // A halasztások a hét minden megnyitásakor szinkronizálódnak az előző héttel (H07).
      const next = existing ? syncDeferred(existing, previous) : createWeekPlan(ws, new Date().toISOString(), previous)
      setWeekPlan(next)
      if (next !== existing) persist(next)
      // A háttérben épp letöltött adat újratöltés nélkül használható.
      if (prefetched && prefetched.snapshot.weekStart === ws && Date.now() - Date.parse(prefetched.fetchedAt) < SIDE_BUNDLE_FRESH_MS) {
        // A még futó (másik heti) letöltés eredménye már nem kell: leáll, és a betöltés állapota is.
        if (loadingRef.current) void api.cancelRefresh()
        refreshToken.current++
        loadingRef.current = false
        setDataLoading(false)
        setDataBackground(false)
        setDataProgress(null)
        setDataError(null)
        showBundle(prefetched)
        return
      }
      // Az utoljára letöltött adat azonnal megjelenik; a friss a háttérben jön.
      if (s.dataSource === 'live') {
        const cached = await api.loadCachedData(ws).catch(() => null)
        if (cached) showBundle(cached)
      }
      await loadData(ws, s)
    },
    [loadData, showBundle, persist],
  )

  useEffect(() => {
    void (async () => {
      const loaded = await api.loadSettings()
      if (loaded.status === 'invalid') {
        setPhase({ kind: 'error', errors: [`A beállítási fájl hibás, a másolata: ${loaded.backupPath}`, ...loaded.errors] })
        return
      }
      if (loaded.status === 'missing') {
        setPhase({ kind: 'setup', draft: loaded.settings })
        return
      }
      // Az elmúlt tiltott időszakok nem foglalnak helyet: betöltéskor törlődnek (SZB-14).
      const settings = pruneBlockedPeriods(loaded.settings, Date.now())
      if (settings !== loaded.settings) await api.saveSettings(settings).catch(() => undefined)
      setSettings(settings)
      setPhase({ kind: 'ready' })
      const tz = settings.airport?.timezone ?? DEFAULT_TZ
      await loadWeek(defaultWeekStart(todayIn(tz)), settings)
    })()
  }, [loadWeek])

  const saveSettings = useCallback(
    async (s: Settings) => {
      await api.saveSettings(s)
      const before = settings
      setSettings(s)
      // Adatot érintő változásnál (növendékek, adatforrás, repülőtér, feladatsorok) a hét
      // adata újratöltődik (H16); a motor különben a hiányzó ráérést szabadnak venné.
      if (before && dataAffecting(before) !== dataAffecting(s)) await loadData(weekStart, s)
    },
    [settings, loadData, weekStart],
  )

  const finishSetup = useCallback(
    async (s: Settings) => {
      await api.saveSettings(s)
      setSettings(s)
      setPhase({ kind: 'ready' })
      await loadWeek(defaultWeekStart(todayIn(s.airport?.timezone ?? DEFAULT_TZ)), s)
    },
    [loadWeek],
  )

  const refresh = useCallback(async () => {
    if (settings) await loadData(weekStart, settings)
  }, [loadData, settings, weekStart])

  const setWeek = useCallback(
    async (ws: string) => {
      if (settings) await loadWeek(ws, settings)
    },
    [loadWeek, settings],
  )

  const updatePlan = useCallback(
    (change: (plan: WeekPlan) => WeekPlan) => {
      setWeekPlan((current) => {
        if (!current) return current
        // A tag nélkül maradt csapat eltűnik, az ismeretlen csapatra hivatkozó igény kézi csapatot kap (KBR-05).
        const now = new Date().toISOString()
        const next = { ...normalizeTeams(change(current), now), updatedAt: now }
        clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(() => persist(next), 300)
        return next
      })
    },
    [persist],
  )

  const resetApp = useCallback(async (options?: { clearApiKey?: boolean }) => {
    clearTimeout(saveTimer.current)
    await api.resetAll(options)
    setSettings(null)
    bundleWeek.current = null
    setBundle(null)
    setWeekPlan(null)
    setScreen('dashboard')
    const fresh = createDefaultSettings()
    setPhase({ kind: 'setup', draft: fresh })
  }, [])

  // Útvonal-időjárás (K27, SZB-19): az útvonalas igények repülőtereire külön kérés megy, a
  // bázisé a hét adatában van. Új adatletöltés (más `fetchedAt`) vagy hét után minden újra jön.
  const [routeWeather, setRouteWeather] = useState<RouteWeatherState & { readonly key: string }>({ ...EMPTY_ROUTE_WEATHER, key: '' })
  const routeKey = bundle ? `${bundle.snapshot.weekStart}|${bundle.fetchedAt}` : ''
  const neededAirports = weekPlan && bundle?.snapshot.weekStart === weekPlan.weekStart ? routeAirports(weekPlan.requests, settings?.airport?.icaoCode).join(',') : ''
  useEffect(() => {
    if (!settings || !bundle || neededAirports === '') return
    const current = routeWeather.key === routeKey ? routeWeather : { ...EMPTY_ROUTE_WEATHER, key: routeKey }
    const missing = neededAirports.split(',').filter((c) => !(c in current.weather) && !(c in current.errors) && !current.loading.includes(c))
    if (missing.length === 0) return
    // Gépelés közben ne menjen kérés minden betűre.
    const timer = setTimeout(() => {
      setRouteWeather({ ...current, loading: [...current.loading, ...missing] })
      api.fetchRouteWeather(bundle.snapshot.weekStart, missing, settings).then(
        (r) =>
          setRouteWeather((prev) =>
            prev.key !== routeKey && prev.key !== ''
              ? prev
              : { key: routeKey, weather: { ...prev.weather, ...r.weather }, errors: { ...prev.errors, ...r.errors }, loading: prev.loading.filter((c) => !missing.includes(c)) },
          ),
        (error: unknown) =>
          setRouteWeather((prev) => ({
            key: routeKey,
            weather: prev.weather,
            errors: { ...prev.errors, ...Object.fromEntries(missing.map((c) => [c, error instanceof Error ? error.message : String(error)])) },
            loading: prev.loading.filter((c) => !missing.includes(c)),
          })),
      )
    }, 500)
    return () => clearTimeout(timer)
  }, [settings, bundle, neededAirports, routeKey, routeWeather])
  const routeWeatherNow: RouteWeatherState = routeWeather.key === routeKey ? routeWeather : EMPTY_ROUTE_WEATHER
  const routeSnapshotWeather = routeWeather.key === routeKey ? routeWeather.weather : EMPTY_ROUTE_WEATHER.weather

  // A motor bemenete csak a tervet érintő részekből áll (H04): a rögzítési állapot vagy a
  // mentés ideje nem indít újratervezést, a rögzítve jelölt helyek viszont igen (H02).
  const requests = weekPlan?.requests
  const decisions = weekPlan?.decisions
  const previousPlan = weekPlan?.previousPlan
  const recordedKey = weekPlan ? JSON.stringify(recordedInput(weekPlan)) : ''
  // A foglalási tervbe tett FlightLogger-változtatások (9.7) is a terv bemenetei.
  const changesKey = weekPlan ? JSON.stringify(changesInput(weekPlan)) : ''
  const planWeek = weekPlan?.weekStart
  const nowIso = toIso(Math.floor(now / 300_000) * 300_000)
  const planInput = useMemo((): PlanInput | null => {
    if (!bundle || !settings || !requests || !decisions || bundle.snapshot.weekStart !== planWeek) return null
    const recorded = JSON.parse(recordedKey || '[]') as NonNullable<PlanInput['recorded']>
    const changes = JSON.parse(changesKey || '[]') as NonNullable<PlanInput['changes']>
    return buildPlanInput(bundle, settings, { requests, decisions, previousPlan, recorded, changes }, nowIso, routeSnapshotWeather)
  }, [bundle, settings, requests, decisions, previousPlan, recordedKey, changesKey, planWeek, nowIso, routeSnapshotWeather])

  // Késleltetett újratervezés: gépelés közben (időtartam, megjegyzés) nem indul minden betűnél.
  useEffect(() => {
    if (!planInput) return
    let cancelled = false
    const timer = setTimeout(() => {
      setPlanning(true)
      planner()
        .plan(planInput)
        .then(
          (r) => {
            if (cancelled) return
            setPlanned({ week: planInput.snapshot.weekStart, result: r, input: planInput })
            setPlanError(null)
          },
          (error: unknown) => {
            if (!cancelled) setPlanError(error instanceof Error ? error.message : String(error))
          },
        )
        .finally(() => {
          if (!cancelled) setPlanning(false)
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [planInput, planner])

  const result = planInput && planned?.week === planInput.snapshot.weekStart ? planned.result : null

  // Hét közbeni figyelés (TRV-15): a kiszámolt terv mellett, ugyanazzal a bemenettel.
  const [watched, setWatched] = useState<{ readonly result: PlanResult; readonly watch: WeekWatch } | null>(null)
  const dismissKey = JSON.stringify(weekPlan?.watchDismissals ?? [])
  useEffect(() => {
    if (!planned || !watchable(planned.result)) return
    const r = planned.result
    let cancelled = false
    const dismissals = JSON.parse(dismissKey) as NonNullable<WeekPlan['watchDismissals']>
    // „Van még hely” a következő 2 napra (KIT-07): a haladás a hét adatából.
    const capacity = bundle && bundle.snapshot.weekStart === planned.week ? { catalog: bundle.directory.lectures, progress: progressMap(bundle, planned.input.settings) } : undefined
    planner()
      .watch(planned.input, r, { dismissals, noRestore: nextLocks, ...(capacity ? { capacity } : {}) })
      .then(
        (w) => {
          if (!cancelled) setWatched({ result: r, watch: w })
        },
        () => undefined,
      )
    return () => {
      cancelled = true
    }
  }, [planned, dismissKey, nextLocks, planner, bundle])
  const watch = !result ? null : !watchable(result) ? EMPTY_WATCH : watched?.result === result ? watched.watch : null

  // A párosított FlightLogger-foglalás azonosítója a rögzített igényhez (9.6): ha ott
  // áthelyezik, így is megtalálható.
  useEffect(() => {
    if (!result || !weekPlan || planned?.week !== weekPlan.weekStart) return
    const links = result.recordedInFlightLogger.filter((l) => !l.detected)
    if (rememberBookingIds(weekPlan, links) !== weekPlan) updatePlan((p) => rememberBookingIds(p, links))
    // A FlightLoggerben (a frissítés szerint) már elvégzett tervbe tett változtatások lezárása.
    if (result.completedChanges.length > 0 && applyCompletedChanges(weekPlan, result.completedChanges, new Date().toISOString()) !== weekPlan) {
      updatePlan((p) => applyCompletedChanges(p, result.completedChanges, new Date().toISOString()))
    }
  }, [result, weekPlan, planned?.week, updatePlan])

  // Mérőszám (U10): a legtöbb egyszerre nyitott dilemma.
  const dilemmaCount = result?.dilemmas.length ?? 0
  useEffect(() => {
    if (weekPlan?.metrics && dilemmaCount > weekPlan.metrics.maxDilemmas) {
      updatePlan((p) => (p.metrics && dilemmaCount > p.metrics.maxDilemmas ? { ...p, metrics: { ...p.metrics, maxDilemmas: dilemmaCount } } : p))
    }
  }, [dilemmaCount, weekPlan?.metrics, updatePlan])

  const autoResolve = useCallback(async () => {
    if (!planInput) return
    const added = await planner().autoResolve(planInput)
    if (added.length > 0) updatePlan((p) => ({ ...p, decisions: [...p.decisions, ...added] }))
  }, [planInput, updatePlan, planner])

  const previewIssues = useCallback(
    async (next: readonly Decision[]): Promise<readonly DecisionIssue[]> => (planInput ? planner().issues({ ...planInput, decisions: next }) : []),
    [planInput, planner],
  )

  // „Van még hely?” (KIT-01–04): csak a mostani bemenet kész tervéhez keres, hogy a lista és a próba
  // ugyanazt a tervet lássa. Akinek a visszahozását elutasították, az kimarad (KIT-03).
  const findOpenings = useCallback(
    async (options?: { readonly days?: number }): Promise<OpeningsList | null> => {
      if (!planned || !planInput || planned.input !== planInput || !bundle || !weekPlan) return null
      const s = planned.input.settings
      const dismissed = new Set((weekPlan.watchDismissals ?? []).filter((d) => d.kind === 'restore').map((d) => d.requestId))
      const excludeStudents = [...new Set(planned.input.requests.filter((r) => dismissed.has(r.id)).flatMap((r) => r.studentIds))]
      return planner().openings({
        input: planned.input,
        result: planned.result,
        catalog: bundle.directory.lectures,
        progress: progressMap(bundle, s),
        ...(options?.days !== undefined ? { days: options.days } : {}),
        ...(excludeStudents.length > 0 ? { excludeStudents } : {}),
        ...(nextLocks.length > 0 ? { restoreLocked: nextLocks } : {}),
      })
    },
    [planned, planInput, bundle, weekPlan, nextLocks, planner],
  )
  const trialOpening = useCallback((token: number, studentId: string, key: string) => planner().trial(token, studentId, key), [planner])

  // A gépek és termek listájának változása (ADT-06): az eltűnt vagy új gép jelzést kap.
  const inventoryChange = useMemo(() => {
    if (!bundle || !settings?.lastSeen || bundle.source !== 'live') return null
    const fleet = bundle.snapshot.fleet.filter((a) => !a.disabled).map((a) => a.id)
    const rooms = bundle.snapshot.classroomIds
    const seen = new Set([...settings.lastSeen.aircraftIds, ...settings.lastSeen.classroomIds])
    const now = new Set([...fleet, ...rooms])
    const missing = [...seen].filter((id) => !now.has(id))
    const added = [...now].filter((id) => !seen.has(id))
    return missing.length > 0 || added.length > 0 ? { missing, added } : null
  }, [bundle, settings])

  const rememberInventory = useCallback(
    async (b: DataBundle, s: Settings) => {
      const next: Settings = {
        ...s,
        lastSeen: { at: new Date().toISOString(), aircraftIds: b.snapshot.fleet.filter((a) => !a.disabled).map((a) => a.id), classroomIds: [...b.snapshot.classroomIds] },
      }
      await api.saveSettings(next)
      setSettings(next)
    },
    [],
  )
  const acknowledgeInventory = useCallback(async () => {
    if (bundle && settings) await rememberInventory(bundle, settings)
  }, [bundle, settings, rememberInventory])

  const navigate = useCallback((next: ScreenId, options?: { readonly settingsTab?: string }) => {
    if (leaveGuard.current && !leaveGuard.current()) return
    leaveGuard.current = null
    setSettingsTab(options?.settingsTab ?? null)
    setScreen(next)
    // Új képernyő: a tetejéről indul (a görgetés ne öröklődjön az előzőből).
    window.scrollTo({ top: 0 })
  }, [])
  const setLeaveGuard = useCallback((guard: (() => boolean) | null) => {
    leaveGuard.current = guard
  }, [])

  // Automatikus feladatválasztás (7.5, SZB-02): az automatikus módú igények feladata a
  // haladáshoz igazodik (adatfrissítés, revízióváltás, igény felvétele vagy törlése után).
  // A nem kézi briefing- és debriefing-idők a beállításokat és a feladatot követik.
  // A FlightLoggerben már lefoglalt igény a foglalás feladatát tartja (9.6).
  useEffect(() => {
    if (!bundle || !settings || !weekPlan || bundle.snapshot.weekStart !== weekPlan.weekStart) return
    const next = prepareRequests(bundle, settings, weekPlan)
    if (next.some((r, i) => r !== weekPlan.requests[i])) updatePlan((p) => ({ ...p, requests: prepareRequests(bundle, settings, p) }))
  }, [bundle, settings, weekPlan, updatePlan])

  // ---------- Hét közbeni figyelés a háttérben (6. fejezet 9. lépés) ----------
  // Az aktuális és a következő naptári hét közül a nem nyitottat friss adattal a háttérben is
  // végigszámolja, hogy megnyitáskor az indítópult szólhasson. A nyitott hét adata óránként
  // frissül, ha az oktató épp nem szerkeszt (indítópult vagy rögzítési lista, vagy a háttérben).
  const sideRunning = useRef(false)
  const sideWatchesRef = useRef(sideWatches)
  useEffect(() => {
    sideWatchesRef.current = sideWatches
  }, [sideWatches])
  const weekStartRef = useRef(weekStart)
  useEffect(() => {
    weekStartRef.current = weekStart
  }, [weekStart])
  const bundleFetchedAt = bundle?.fetchedAt
  const bundleFetchedAtRef = useRef(bundleFetchedAt)
  useEffect(() => {
    bundleFetchedAtRef.current = bundleFetchedAt
  }, [bundleFetchedAt])
  const weekPlanRef = useRef(weekPlan)
  useEffect(() => {
    weekPlanRef.current = weekPlan
  }, [weekPlan])
  const screenRef = useRef(screen)
  useEffect(() => {
    screenRef.current = screen
  }, [screen])
  const checkOtherWeeks = useCallback(
    async (openWeek: string) => {
      const s = settingsRef.current
      if (!s || sideRunning.current || loadingRef.current) return
      sideRunning.current = true
      try {
        const monday = mondayOf(todayIn(s.airport?.timezone ?? DEFAULT_TZ))
        for (const ws of [monday, addDays(monday, 7)]) {
          if (ws === openWeek || loadingRef.current) continue
          const known = sideWatchesRef.current[ws]
          if (known && Date.now() - known.checkedMs < WATCH_REFRESH_MS) continue
          const saved = await api.loadWeekPlan(ws).catch(() => null)
          if (!saved || !hasWatchable(saved)) continue
          const previous = (await api.loadWeekPlan(addDays(ws, -7)).catch(() => null)) ?? undefined
          const locks = lockedCarriedIds(await api.loadWeekPlan(addDays(ws, 7)).catch(() => null), ws)
          // A nyitott hét letöltését nem szakítja meg (a főfolyamat egyszerre egy letöltést futtat).
          if (loadingRef.current) break
          const fresh = await api.refreshData(ws, s)
          if (weekStartRef.current === ws) continue
          const synced = syncDeferred(saved, previous)
          const wp: WeekPlan = { ...synced, requests: prepareRequests(fresh, s, synced) }
          const input = buildPlanInput(fresh, s, { requests: wp.requests, decisions: wp.decisions, previousPlan: wp.previousPlan, recorded: recordedInput(wp), changes: changesInput(wp) }, toIso(Date.now()))
          const base = await planner().plan(input)
          const w = await planner().watch(input, base, { dismissals: wp.watchDismissals ?? [], noRestore: locks, capacity: { catalog: fresh.directory.lectures, progress: progressMap(fresh, s) } })
          setSideWatches((all) => (weekStartRef.current === ws ? all : { ...all, [ws]: { weekStart: ws, watch: w, fetchedAt: fresh.fetchedAt, bundle: fresh, requests: wp.requests, checkedMs: Date.now() } }))
        }
      } catch {
        // A háttérfigyelés hibája (például megszakított letöltés) nem zavarja a munkát; a következő körben újra próbálja.
      } finally {
        sideRunning.current = false
      }
    },
    [planner],
  )

  // A nyitott hét betöltése után a többi figyelt hét is sorra kerül.
  useEffect(() => {
    if (phase.kind !== 'ready' || dataLoading || !bundleFetchedAt) return
    void checkOtherWeeks(weekStart)
  }, [phase.kind, dataLoading, bundleFetchedAt, weekStart, checkOtherWeeks])

  // Óránkénti frissítés, ha az oktató épp nem szerkeszt; az ablak előtérbe kerülésekor is.
  const watchTick = useCallback(() => {
    const s = settingsRef.current
    const fetched = bundleWeek.current === weekStartRef.current ? bundleFetchedAtRef.current : undefined
    if (!s || loadingRef.current || !fetched) return
    const idle = document.hidden || screenRef.current === 'dashboard' || screenRef.current === 'recording'
    if (idle && Date.now() - Date.parse(fetched) >= WATCH_REFRESH_MS && weekPlanRef.current && hasWatchable(weekPlanRef.current)) {
      void loadData(weekStartRef.current, s)
      return
    }
    void checkOtherWeeks(weekStartRef.current)
  }, [loadData, checkOtherWeeks])
  useEffect(() => {
    if (phase.kind !== 'ready') return
    const id = setInterval(watchTick, 5 * 60_000)
    window.addEventListener('focus', watchTick)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', watchTick)
    }
  }, [phase.kind, watchTick])

  const sideWatch = useMemo((): SideWatch | null => {
    const monday = mondayOf(todayIn(timezone))
    for (const ws of [monday, addDays(monday, 7)]) {
      const w = ws === weekStart ? undefined : sideWatches[ws]
      if (w && (w.watch.items.length > 0 || w.watch.watched.booked > 0)) return w
    }
    return null
  }, [sideWatches, weekStart, timezone])

  const openSideWatch = useCallback(async () => {
    const s = settingsRef.current
    if (!sideWatch || !s) return
    if (leaveGuard.current && !leaveGuard.current()) return
    leaveGuard.current = null
    await loadWeek(sideWatch.weekStart, s, sideWatch.bundle)
    setSettingsTab(null)
    setScreen('recording')
    window.scrollTo({ top: 0 })
  }, [sideWatch, loadWeek])

  const value: AppContextValue = {
    phase,
    settings,
    bundle,
    dataLoading,
    dataBackground,
    dataProgress,
    dataError,
    routeWeather: routeWeatherNow,
    weekStart,
    weekPlan,
    result,
    watch,
    sideWatch,
    openSideWatch,
    restoreLocked: nextLocks,
    planning,
    planError,
    saveError,
    inventoryChange,
    acknowledgeInventory,
    autoResolve,
    previewIssues,
    setLeaveGuard,
    planNow: nowIso,
    planInput,
    findOpenings,
    trialOpening,
    screen,
    settingsTab,
    timezone,
    navigate,
    saveSettings,
    finishSetup,
    refresh,
    setWeek,
    updatePlan,
    resetApp,
  }
  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

/** A beállítások azon része, amelynek változása új adatletöltést kíván (H16). */
function dataAffecting(s: Settings): string {
  return JSON.stringify([s.dataSource, s.airport, s.students.map((st) => [st.userId, st.syllabusId ?? null]).sort(), s.resources])
}
