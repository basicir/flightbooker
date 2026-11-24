import type { Settings } from '@core/config/schema'
import { changesInput, recordedInput, syncBriefingTimes, type WeekPlan } from '@core/draft/weekPlan'
import { linkBookings, type PlannedChange, type RecordedEntry } from '@core/engine/bookingLink'
import { deferredRequestIds, type PlanInput } from '@core/engine/plan'
import { bookingLessonOf } from '@core/model/bookingStudents'
import type { DataBundle } from '@core/model/dataBundle'
import type { BookingRequest, Decision, Slot } from '@core/model/planning'
import type { AirportWeather } from '@core/model/route'
import { assignAutomaticLectures, lectureSequences } from '@core/progress/autoAssign'
import { studentProgress } from './progress'

/**
 * A motor bemenetének összeállítása a hét adatából és a tervezetből. A nyitott hét és a
 * háttérben figyelt hét (hét közbeni figyelés) ugyanígy készül, hogy ugyanazt lássák.
 */

/** A FlightLoggerben már lefoglalt igények a foglalás feladatával (9.6): az automatikus választás ezt tartja. */
export function linkedLectures(
  bundle: DataBundle,
  plan: Pick<WeekPlan, 'requests' | 'decisions'>,
  recorded: readonly RecordedEntry[],
  changes: readonly PlannedChange[] = [],
): Map<string, string | undefined> {
  const links = linkBookings({ snapshot: bundle.snapshot, requests: plan.requests, recorded, deferred: deferredRequestIds({ decisions: plan.decisions, recorded }), changes })
  const byId = new Map(bundle.snapshot.bookings.map((b) => [b.id, b]))
  const requests = new Map(plan.requests.map((r) => [r.id, r]))
  // A tervbe tett változtatás alatt álló igény is a FlightLogger-foglalása feladatát tartja; a
  // többnövendékes foglalásnál a növendék saját feladatát (KBR-10).
  const booked = [...links.links, ...links.plannedMoves, ...links.plannedCancels]
  const lectureOf = (requestId: string, bookingId: string): string | undefined => {
    const b = byId.get(bookingId)
    const studentId = requests.get(requestId)?.studentIds[0]
    if (!b) return undefined
    return studentId ? (bookingLessonOf(b, studentId)?.lectureId ?? (b.type === 'multiStudent' ? undefined : b.lectureId)) : b.lectureId
  }
  return new Map(booked.map((l) => [l.requestId, lectureOf(l.requestId, l.bookingId)]))
}

/**
 * Az igények a haladás szerinti automatikus feladattal (7.5, SZB-02) és a beállítások szerinti
 * briefing-idővel. Változatlan igény ugyanaz az objektum marad.
 */
export function prepareRequests(bundle: DataBundle, settings: Settings, plan: WeekPlan): BookingRequest[] {
  return syncBriefingTimes(
    settings,
    assignAutomaticLectures({
      settings,
      requests: plan.requests,
      catalog: bundle.directory.lectures,
      progressFor: (id) => studentProgress(bundle, settings, id),
      bookings: bundle.snapshot.bookings,
      nowMs: Date.parse(bundle.snapshot.generatedAt),
      linked: linkedLectures(bundle, plan, recordedInput(plan), changesInput(plan)),
    }),
    bundle.directory.lectures,
  )
}

export interface PlanParts {
  readonly requests: readonly BookingRequest[]
  readonly decisions: readonly Decision[]
  readonly previousPlan?: Readonly<Record<string, Slot>> | undefined
  readonly recorded: readonly RecordedEntry[]
  readonly changes: readonly PlannedChange[]
}

export function buildPlanInput(bundle: DataBundle, settings: Settings, parts: PlanParts, nowIso: string, routeWeather?: Readonly<Record<string, AirportWeather>>): PlanInput {
  const hasRoute = routeWeather !== undefined && Object.keys(routeWeather).length > 0
  const snapshot =
    parts.previousPlan || hasRoute
      ? { ...bundle.snapshot, ...(parts.previousPlan ? { previousPlan: parts.previousPlan } : {}), ...(hasRoute ? { routeWeather } : {}) }
      : bundle.snapshot
  // Feladatsorrend (ELS-05): a haladás szerint, a feladatkiosztással azonos módon.
  const sequences = lectureSequences({ settings, requests: parts.requests, catalog: bundle.directory.lectures, progressFor: (id) => studentProgress(bundle, settings, id) })
  return {
    snapshot,
    settings,
    requests: parts.requests,
    decisions: parts.decisions,
    ...(parts.recorded.length > 0 ? { recorded: parts.recorded } : {}),
    ...(parts.changes.length > 0 ? { changes: parts.changes } : {}),
    ...(sequences.length > 0 ? { sequences } : {}),
    options: { now: nowIso },
  }
}

/** Van-e a héten mit figyelni: igény, amelyet lefoglalhattak, rögzítettek vagy halasztottak. */
export function hasWatchable(plan: WeekPlan): boolean {
  return (
    plan.requests.length > 0 &&
    (Object.values(plan.recording).includes('recorded') ||
      Object.keys(plan.flChanges ?? {}).length > 0 ||
      plan.decisions.some((d) => d.kind === 'defer') ||
      plan.acceptedAt !== undefined ||
      plan.requests.some((r) => r.lectureId !== undefined))
  )
}
