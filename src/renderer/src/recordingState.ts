import type { WeekPlan } from '@core/draft/weekPlan'
import type { Proposal } from '@core/model/planning'
import { toMs } from '@core/time/zoned'

/**
 * A rögzítési lista tételének állapota (9.6, TRV-14, H02):
 * - `open`: még fel kell vinni a FlightLoggerbe (vagy áthelyezés, standby, köztes állapot);
 * - `done`: rögzített, és a terv szerinti hely a rögzítéskori;
 * - `resized`: rögzített, de azóta más az ideje: a FlightLoggerben a meglévő foglalást kell átírni;
 * - `cancelled`: rögzített, de a FlightLoggerben azóta lemondták: nincs meglévő foglalás, amit át
 *   lehetne írni. A motor a helyet a döntésig lezárva tartja (és a mostani időtartamra igazítja), ezért
 *   az időeltérés itt nem átírási feladat; a döntés (újratervezés vagy halasztás) a hét közbeni
 *   figyelés javaslata (TRV-15).
 */
export type RecordingState = 'open' | 'done' | 'resized' | 'cancelled'

export function recordingStateOf(p: Proposal, plan: Pick<WeekPlan, 'recording' | 'recordedSlots'>, cancelledInFlightLogger: ReadonlySet<string>): RecordingState {
  if (p.standby || p.change || (plan.recording[p.requestId] ?? 'planned') !== 'recorded') return 'open'
  if (cancelledInFlightLogger.has(p.requestId)) return 'cancelled'
  const saved = plan.recordedSlots?.[p.requestId]
  return saved && (toMs(saved.start) !== toMs(p.slot.start) || toMs(saved.end) !== toMs(p.slot.end)) ? 'resized' : 'done'
}
