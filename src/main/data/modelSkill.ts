import { hourlyObservations, type MetarRecord, type Observation } from '../../core/weather/metar'
import {
  addToArchive,
  mergeLog,
  skillWeights,
  toArchived,
  verifyArchive,
  VERIFY_GRACE_MS,
  type ArchivedForecast,
  type ModelSkillSummary,
  type SkillDay,
  type VerificationLogHour,
} from '../../core/weather/skill'
import type { WeatherHour } from '../../core/model/snapshot'
import { DAY_MS, HOUR_MS } from '../../core/time/zoned'
import { MAX_METAR_HOURS, type MetarRequest } from '../net/metar'

export type { ModelSkillSummary }

/**
 * A modellpontosság frissítése (ADT-07): a most letöltött modell-előrejelzések archiválása,
 * a már elmúlt archivált órákhoz a bázis METAR-jainak letöltése, a mérés és a súlyok.
 * Az állapotban csak időjárási érték és modellnév van, személyes adat nincs.
 */

export interface SkillState {
  readonly archive: readonly ArchivedForecast[]
  readonly stats: readonly SkillDay[]
  /** A mérési napló (a felületen látható METAR-ok); régebbi fájlban hiányzik. */
  readonly log?: readonly VerificationLogHour[]
}

export interface SkillStore {
  load(): Promise<SkillState | undefined>
  save(state: SkillState): Promise<void>
}

export interface SkillDeps {
  readonly fetchMetars: (request: MetarRequest) => Promise<MetarRecord[]>
  readonly store: SkillStore
  readonly now: Date
}


/** A METAR-szolgáltatás kb. ennyi napra visszamenőleg ad adatot. */
const METAR_HISTORY_MS = 15 * DAY_MS

const locks = new WeakMap<SkillStore, Promise<unknown>>()

/** Egyszerre egy frissítés fut tárolónként (a tervezés és az összevetés párhuzamosan is kérhet). */
function serialized<T>(store: SkillStore, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(store) ?? Promise.resolve()
  const next = previous.catch(() => undefined).then(task)
  locks.set(store, next)
  return next
}

/** A még mérendő, már elmúlt órák legkorábbija. */
function earliestPastHour(archive: readonly ArchivedForecast[], nowMs: number): number | null {
  let earliest: number | null = null
  for (const f of archive) {
    for (const h of f.hours) {
      const ms = Date.parse(h.time)
      if (ms <= nowMs && (earliest === null || ms < earliest)) earliest = ms
    }
  }
  return earliest
}

async function observationsFor(deps: SkillDeps, icao: string, fromMs: number): Promise<Observation[]> {
  const nowMs = deps.now.getTime()
  const start = Math.max(fromMs - HOUR_MS, nowMs - METAR_HISTORY_MS)
  const records: MetarRecord[] = []
  // Visszafelé lapozva, egy kérés legfeljebb MAX_METAR_HOURS órát fed le.
  for (let end = nowMs; end > start; end -= MAX_METAR_HOURS * HOUR_MS) {
    const hours = Math.min(MAX_METAR_HOURS, Math.ceil((end - start) / HOUR_MS))
    records.push(...(await deps.fetchMetars({ icao, hours, ...(end === nowMs ? {} : { endAt: new Date(end) }) })))
  }
  return hourlyObservations(records)
}

export function updateModelSkill(
  deps: SkillDeps,
  icao: string | undefined,
  forecasts: readonly { readonly model: string; readonly hours: readonly WeatherHour[] }[],
  models: readonly string[],
): Promise<ModelSkillSummary> {
  return serialized(deps.store, async () => {
    const nowMs = deps.now.getTime()
    const issuedAt = deps.now.toISOString()
    let error: string | undefined
    const state = (await deps.store.load().catch(() => undefined)) ?? { archive: [], stats: [] }
    let archive = addToArchive(
      state.archive,
      forecasts.map((f) => toArchived(f.model, issuedAt, f.hours)),
    )
    let stats: readonly SkillDay[] = state.stats
    let log: readonly VerificationLogHour[] = mergeLog(state.log ?? [], [], nowMs)
    const from = earliestPastHour(archive, nowMs)
    if (icao && from !== null) {
      try {
        const observations = await observationsFor(deps, icao, from)
        const verified = verifyArchive(archive, observations, stats, nowMs, log)
        archive = verified.archive
        stats = verified.stats
        log = verified.log
      } catch (e) {
        error = `METAR: ${e instanceof Error ? e.message : String(e)}`
      }
    }
    // A mérés nélkül túl régen elmúlt órák akkor is kikerülnek, ha a METAR nem jött le.
    archive = archive.map((f) => ({ ...f, hours: f.hours.filter((h) => Date.parse(h.time) > nowMs - VERIFY_GRACE_MS) })).filter((f) => f.hours.length > 0)
    try {
      await deps.store.save({ archive, stats, log })
    } catch (e) {
      error ??= `A mérés mentése nem sikerült: ${e instanceof Error ? e.message : String(e)}`
    }
    const weights = skillWeights(stats, models, nowMs)
    const measuredHours = Object.values(weights).reduce((sum, buckets) => sum + buckets.reduce((s, b) => s + b.n.wind, 0), 0)
    return { weights, measuredHours, log, ...(error ? { error } : {}) }
  })
}
