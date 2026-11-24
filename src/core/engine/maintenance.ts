import type { Settings } from '../config/schema'
import { MAINTENANCE_TYPES, type AircraftHoursEntry, type MaintenanceType } from '../model/resources'
import { HOUR_MS } from '../time/zoned'

/**
 * Várható karbantartás (SZB-06, ERF-04): a gép repülései időrendben fogyasztják a
 * kirepülhető keretet. A keret a megadott kirepülhető idő és a következő karbantartás előtti
 * túlrepülés összege; ebből a biztonsági puffer már nem tervezhető.
 *
 * Az első repülés, amely már nem fér bele a keretbe, jelöli a karbantartás kezdetét: onnan a
 * karbantartás hosszáig a gép nem foglalható. (Nem tételezzük fel, hogy a gépet a keret
 * elfogyásakor rögtön karbantartják; a foglalások döntik el, mikor lesz rá szükség.) Utána a
 * számláló újraindul; a következő karbantartásig tartó keret nem ismert, ezért a karbantartás
 * utáni repüléseket nem korlátozzuk. A FlightLoggerben rögzített karbantartási foglalás
 * ugyanígy lezárja a számlálást.
 */

export interface UsageInterval {
  readonly start: number
  readonly end: number
  /** `flight`: repült idő (a repülés ideje); `maintenance`: rögzített karbantartás. */
  readonly kind: 'flight' | 'maintenance'
  readonly ref: string
}

export interface MaintenanceLimits {
  readonly type: MaintenanceType | undefined
  readonly hoursUntilMaintenance: number
  readonly overflyHours: number
  readonly bufferHours: number
  /** Kirepülhető idő a túlrepüléssel együtt. */
  readonly limitHours: number
  /** Tervezhető órák: keret − puffer. */
  readonly usableHours: number
  readonly durationHours: number
}

/**
 * A gép kerete. Ismeretlen karbantartás-fajtánál nincs túlrepülés, a karbantartás hossza
 * pedig a leghosszabb beállított érték (óvatos becslés).
 */
export function maintenanceLimits(settings: Settings, entry: AircraftHoursEntry, bufferHours: number): MaintenanceLimits {
  const type = entry.maintenanceType
  const byType = type === undefined ? undefined : settings.maintenance[type]
  const overflyHours = byType?.overflyHours ?? 0
  const durationHours = byType?.durationHours ?? Math.max(...MAINTENANCE_TYPES.map((t) => settings.maintenance[t].durationHours))
  const limitHours = entry.hoursUntilMaintenance + overflyHours
  return { type, hoursUntilMaintenance: entry.hoursUntilMaintenance, overflyHours, bufferHours, limitHours, usableHours: limitHours - bufferHours, durationHours }
}

export interface MaintenanceProjection {
  /** A karbantartás (vagy a vizsgált időszak vége) előtt repült órák. */
  readonly usedHours: number
  /** Várható karbantartás, ha a keret a foglalások alapján elfogy. */
  readonly window?: { readonly start: number; readonly end: number }
  /** A várható karbantartásra eső repülések (nem repülhetők le). */
  readonly blocked: ReadonlySet<string>
  /** Az első repülés, amely már nem fér bele a keretbe. */
  readonly crossingRef?: string
  /** A keret elfogyása előtti, FlightLoggerben rögzített karbantartás. */
  readonly scheduledRef?: string
}

const EPS = 1e-9

/**
 * `floorMs`: a karbantartás legkorábban ekkor kezdődhet (a mostani időpont) – ha a keret
 * már egy múltbeli repülésnél elfogyott, a karbantartást mostantól számítjuk.
 */
export function projectMaintenance(intervals: readonly UsageInterval[], limits: MaintenanceLimits, floorMs: number): MaintenanceProjection {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end || (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0))
  let used = 0
  for (let i = 0; i < sorted.length; i++) {
    const iv = sorted[i]!
    if (iv.kind === 'maintenance') return { usedHours: used, blocked: new Set(), scheduledRef: iv.ref }
    const hours = (iv.end - iv.start) / HOUR_MS
    if (used + hours <= limits.usableHours + EPS) {
      used += hours
      continue
    }
    const start = Math.max(iv.start, floorMs)
    const end = start + limits.durationHours * HOUR_MS
    const blocked = new Set<string>()
    for (let j = i; j < sorted.length && sorted[j]!.start < end; j++) if (sorted[j]!.kind === 'flight') blocked.add(sorted[j]!.ref)
    return { usedHours: used, window: { start, end }, blocked, crossingRef: iv.ref }
  }
  return { usedHours: used, blocked: new Set() }
}
