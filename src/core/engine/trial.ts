import type { BookingRequest, Dilemma, PlanResult, PlanWarning, Proposal, Slot } from '../model/planning'
import { plan, type PlanInput } from './plan'

/**
 * Próbaszámolás (KIT-04, KIT-08): a teljes tervezés egy módosított bemenettel, összevetve a mostani
 * tervvel. Megmondja, hová kerülne a vizsgált igény, tisztán-e, kit mozdít el és ki szorul ki
 * miatta, és milyen új dilemma keletkezik. A plusz igény felvétele és a halasztott igény
 * visszahozása (a hét közbeni figyelésben is) ugyanezzel dönt. Tiszta függvény: a tervet nem
 * változtatja, csak megmutatja, mi lenne.
 */

/** Jóváhagyást kérő figyelmeztetések: ilyen helyre a plusz igény nem „tisztán” kerül. */
const APPROVAL: ReadonlySet<PlanWarning['kind']> = new Set(['limitExceeded', 'doubleBooking', 'outsideAvailability'])

export interface TrialMove {
  readonly requestId: string
  readonly from: Slot
  readonly to: Slot
}

export interface TrialResult {
  /** A módosított bemenet terve. */
  readonly result: PlanResult
  /** A vizsgált igény javaslata, ha tisztán (dilemma és jóváhagyást kérő figyelmeztetés nélkül) került be. */
  readonly placed?: Proposal
  /** Más igények, amelyeknek a helye (gép vagy terem, a fő rész kezdete) megváltozik. */
  readonly moved: readonly TrialMove[]
  /** Más igények, amelyek eddig a tervben voltak, és kiszorulnak belőle. */
  readonly displaced: readonly string[]
  /** Új dilemmák a standby-ajánláson kívül (az az új repülés mellé ajánlott, elhagyható). */
  readonly newDilemmas: readonly Dilemma[]
  /** Mellékhatás nélkül felvehető: tisztán bekerül, senki nem szorul ki, nincs új dilemma. */
  readonly ok: boolean
}

/** A javaslat helye az összevetéshez: a fő rész (repülés, gépidő) kezdete és a gép, elméletnél a terem. */
const placeKey = (s: Slot): string => `${Date.parse(s.flightStart ?? s.start)}|${s.resourceId ?? ''}|${s.classroomId ?? ''}`

const placedSlots = (r: PlanResult): Map<string, Slot> => new Map(r.proposals.filter((p) => !p.standby).map((p) => [p.requestId, p.slot]))

export function trialPlan(base: { readonly input: PlanInput; readonly result: PlanResult }, next: PlanInput, requestId: string): TrialResult {
  const result = plan(next)
  const own = result.proposals.find((p) => p.requestId === requestId && !p.standby)
  const clean = own !== undefined && own.dilemmaId === undefined && !own.warnings.some((w) => APPROVAL.has(w.kind))
  const before = placedSlots(base.result)
  const after = placedSlots(result)
  const moved: TrialMove[] = []
  const displaced: string[] = []
  for (const [id, from] of [...before].sort(([a], [b]) => a.localeCompare(b))) {
    if (id === requestId) continue
    const to = after.get(id)
    if (!to) displaced.push(id)
    else if (placeKey(to) !== placeKey(from)) moved.push({ requestId: id, from, to })
  }
  const known = new Set(base.result.dilemmas.map((d) => d.id))
  const newDilemmas = result.dilemmas.filter((d) => d.type !== 'standby' && !known.has(d.id))
  return {
    result,
    ...(clean ? { placed: own } : {}),
    moved,
    displaced,
    newDilemmas,
    ok: clean && displaced.length === 0 && newDilemmas.length === 0,
  }
}

/** A terv bemenete egy új igénnyel; az igények és a feladatsorrend a felvétel utáni állapot szerint. */
export function withRequests(input: PlanInput, requests: readonly BookingRequest[], sequences: ReadonlyArray<readonly string[]>): PlanInput {
  const { sequences: _old, ...rest } = input
  return { ...rest, requests, ...(sequences.length > 0 ? { sequences } : {}) }
}

/** A terv bemenete a halasztás visszavonásával (TRV-12): az igény rendes, a motor által tervezett tétel lesz. */
export function withoutDeferral(input: PlanInput, requestId: string): PlanInput {
  return { ...input, decisions: input.decisions.filter((d) => !(d.kind === 'defer' && d.requestId === requestId)) }
}
