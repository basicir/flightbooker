import type { ResourceRef, EffectiveStudent, StudentSettings } from '../model/people'
import type { EffectiveResource, FleetEntry, MaintenanceType, ResourceKind } from '../model/resources'
import { localTimeToMinutes, WEEKDAYS, type LocalDate } from '../model/time'
import { weekdayIndex } from '../time/zoned'
import type { Settings } from './schema'

/** A beállításokon végzett, mellékhatás nélküli műveletek. */

export interface UnclassifiedResource {
  readonly aircraftId: string
  readonly callSign: string
  readonly model: string
  /** A FlightLogger `aircraftClass`-ából előtöltött javaslat (ERF-02). */
  readonly suggestedKind: ResourceKind
}

/**
 * ERF-02, ERF-03: azok az aktív erőforrások, amelyeknek még nincs helyi besorolása.
 * A szimulátort a `SIMULATOR` osztályból ismerjük fel, a többi javaslata repülőgép.
 */
export function findUnclassifiedResources(settings: Settings, fleet: readonly FleetEntry[]): UnclassifiedResource[] {
  return fleet
    .filter((a) => !a.disabled && !Object.hasOwn(settings.resources, a.id))
    .map((a) => ({
      aircraftId: a.id,
      callSign: a.callSign,
      model: a.model,
      suggestedKind: a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft',
    }))
}

/** ERF-02: a javasolt besorolások alkalmazása (az oktató megerősítése után). */
export function classifyResources(
  settings: Settings,
  choices: ReadonlyArray<{ aircraftId: string; kind: ResourceKind }>,
): Settings {
  const resources = { ...settings.resources }
  for (const choice of choices) {
    const previous = resources[choice.aircraftId]
    resources[choice.aircraftId] = { ...previous, kind: choice.kind }
  }
  return { ...settings, resources }
}

/**
 * ERF-04: a repülőgépek, amelyeknél a kirepülhető időt vezetjük (szimulátor és letiltott gép
 * nem). A karbantartási táblázat fotójának lajstromait is ezekhez illesztjük.
 */
export function aircraftWithHoursEntry(settings: Settings, fleet: readonly FleetEntry[]): FleetEntry[] {
  return fleet.filter((a) => {
    if (a.disabled) return false
    const kind = settings.resources[a.id]?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')
    return kind === 'aircraft'
  })
}

/**
 * ERF-05: azok a repülőgépek, amelyeknél aznap még nincs megadva a kirepülhető idő.
 * Szimulátorra és letiltott gépre nem kérdezünk.
 */
export function aircraftNeedingHoursEntry(settings: Settings, fleet: readonly FleetEntry[], today: LocalDate): FleetEntry[] {
  return aircraftWithHoursEntry(settings, fleet).filter((a) => settings.aircraftHours[a.id]?.date !== today)
}

/**
 * ERF-04: a kirepülhető idő rögzítése. `date`: a nap, amelyre az érték vonatkozik (kézi
 * megadásnál a mai nap, fotóból a táblázat dátuma). `maintenanceType`: a következő
 * karbantartás fajtája (SZB-06: túlrepülés és karbantartási hossz).
 */
export function recordAircraftHours(
  settings: Settings,
  aircraftId: string,
  hoursUntilMaintenance: number,
  date: LocalDate,
  enteredAt: string,
  maintenanceType?: MaintenanceType,
): Settings {
  const entry = maintenanceType === undefined ? { date, hoursUntilMaintenance, enteredAt } : { date, hoursUntilMaintenance, maintenanceType, enteredAt }
  return { ...settings, aircraftHours: { ...settings.aircraftHours, [aircraftId]: entry } }
}

/**
 * ERF-04: melyik napra vonatkozzon a fotóból beolvasott érték. A táblázat dátuma, ha az
 * olvasható és legfeljebb 30 nappal korábbi a mainál; jövőbeli vagy olvashatatlan dátumnál a
 * mai nap (az utóbbit a felület jelzi).
 */
export function sheetEntryDate(sheetDate: LocalDate | null, today: LocalDate): LocalDate {
  if (sheetDate === null || sheetDate > today) return today
  const [y, m, d] = today.split('-').map(Number) as [number, number, number]
  const limit = new Date(Date.UTC(y, m - 1, d - 30)).toISOString().slice(0, 10)
  return sheetDate >= limit ? sheetDate : today
}

/**
 * ERF-08, ERF-10, SZB-06: gép > géptípus > globális alapérték. A típus a FlightLogger
 * `model` mezője; ha nem ismert, a típusszintű érték kimarad.
 */
export function effectiveResource(settings: Settings, aircraftId: string, fallbackKind: ResourceKind = 'aircraft', aircraftType?: string): EffectiveResource {
  const own = settings.resources[aircraftId]
  const type = aircraftType !== undefined ? settings.aircraftTypes[aircraftType] : undefined
  return {
    id: aircraftId,
    kind: own?.kind ?? fallbackKind,
    aircraftType,
    engineRunUpMinutes: own?.engineRunUpMinutes ?? type?.engineRunUpMinutes ?? settings.defaults.engineRunUpMinutes,
    turnaroundMinutes: own?.turnaroundMinutes ?? settings.defaults.turnaroundMinutes,
    minReserveHours: own?.minReserveHours ?? settings.defaults.minReserveHours,
  }
}

/**
 * Az igény elsőbbsége (ELS-01): a megadott érték, hiányában a beállítások alapértéke. 1 a
 * legfontosabb. Ellentétes irányú, mint a növendék foglalási prioritása (NOV-12, 5 a
 * legfontosabb), ezért a felület mindkettőnél kiírja, melyik vég a fontos.
 */
export function requestPriorityOf(settings: Settings, request: { readonly priority?: number | undefined }): number {
  return request.priority ?? settings.defaults.requestPriority
}

/** NOV-06/07/08/12: növendék beállításai az alapértékekkel feloldva. */
export function effectiveStudent(settings: Settings, student: StudentSettings): EffectiveStudent {
  return {
    userId: student.userId,
    allowedResources: student.allowedResources,
    preferredResources: student.preferredResources ?? [],
    dayOrder: student.dayOrder,
    priority: student.priority ?? settings.defaults.studentPriority,
    longNoFlyDays: student.longNoFlyDays ?? settings.defaults.longNoFlyDays,
    weatherLimits: student.weatherLimits ?? {},
    taskSelectionMode: student.taskSelectionMode ?? settings.planning.taskSelectionMode,
  }
}

/** Egy gép megfelel-e a hivatkozásnak (egyedi gép vagy géptípus). */
export function matchesRef(ref: ResourceRef, aircraft: Pick<FleetEntry, 'id' | 'model'>): boolean {
  if ('aircraftId' in ref) return ref.aircraftId === aircraft.id
  return ref.aircraftType === aircraft.model
}

/** NOV-03: a növendék által használható erőforrások azonosítói a flottából. */
export function allowedResourceIds(student: StudentSettings, fleet: readonly FleetEntry[]): string[] {
  return fleet.filter((a) => !a.disabled && aircraftChoice(student, a) !== 'none').map((a) => a.id)
}

/** NOV-04: a gép a növendék egyik preferált gépe vagy géptípusa-e. */
export function isPreferredResource(student: StudentSettings, aircraft: Pick<FleetEntry, 'id' | 'model'>): boolean {
  return (student.preferredResources ?? []).some((ref) => matchesRef(ref, aircraft))
}

/** A flotta géptípusai ábécérendben (ERF-01). */
export function aircraftTypesOf(fleet: readonly FleetEntry[]): string[] {
  return [...new Set(fleet.map((a) => a.model).filter((m) => m.trim() !== ''))].sort((a, b) => a.localeCompare(b, 'hu'))
}

/**
 * ERF-07: férőhely a terem nevéből. A FlightLoggerben a legtöbb terem neve a férőhelyével
 * kezdődik („18 Classroom I.” → 18); ha a név nem számmal kezdődik, 1.
 */
export function capacityFromName(name: string): number {
  const match = /^\s*(\d{1,4})(?!\d)/.exec(name)
  const n = match ? Number(match[1]) : Number.NaN
  return Number.isInteger(n) && n >= 1 && n <= 1000 ? n : 1
}

/** Első beállítás: a még be nem állított termek férőhelye a névből (ERF-07). */
export function prefillClassrooms(settings: Settings, ids: readonly string[], names: Readonly<Record<string, string>>): Settings {
  const missing = ids.filter((id) => !Object.hasOwn(settings.classrooms, id))
  if (missing.length === 0) return settings
  const classrooms = { ...settings.classrooms }
  for (const id of missing) classrooms[id] = { capacity: capacityFromName(names[id] ?? ''), preferenceRank: 1 }
  return { ...settings, classrooms }
}

/** Egy gép jelölése a növendéknél (NOV-03, NOV-04): a preferált gép egyben engedélyezett is. */
export type AircraftChoice = 'none' | 'allowed' | 'preferred'

export function aircraftChoice(student: StudentSettings, aircraft: Pick<FleetEntry, 'id' | 'model'>): AircraftChoice {
  if (isPreferredResource(student, aircraft)) return 'preferred'
  return student.allowedResources.some((ref) => matchesRef(ref, aircraft)) ? 'allowed' : 'none'
}

/**
 * A megadott gépek jelölésének átállítása. A flotta gépeire szóló hivatkozások egyedi
 * lajstromokká alakulnak (egy típus kijelölése a típus összes lajstromát jelöli); a flottában
 * nem szereplő gépekre és típusokra szóló hivatkozások változatlanok maradnak.
 */
export function setAircraftChoice(student: StudentSettings, fleet: readonly FleetEntry[], aircraftIds: readonly string[], choice: AircraftChoice): StudentSettings {
  const target = new Set(aircraftIds)
  const fleetIds = new Set(fleet.map((a) => a.id))
  const fleetTypes = new Set(fleet.map((a) => a.model))
  const known = (ref: ResourceRef): boolean => ('aircraftId' in ref ? fleetIds.has(ref.aircraftId) : fleetTypes.has(ref.aircraftType))
  const allowed: ResourceRef[] = student.allowedResources.filter((r) => !known(r))
  const preferred: ResourceRef[] = (student.preferredResources ?? []).filter((r) => !known(r))
  for (const a of fleet) {
    const c = target.has(a.id) ? choice : aircraftChoice(student, a)
    if (c !== 'none') allowed.push({ aircraftId: a.id })
    if (c === 'preferred') preferred.push({ aircraftId: a.id })
  }
  const { preferredResources: _previous, ...rest } = student
  return { ...rest, allowedResources: allowed, ...(preferred.length > 0 ? { preferredResources: preferred } : {}) }
}

/**
 * A flotta megjelenítési sorrendje (ERF-01). A beállított sorrendben lévő gépek elöl, a többi
 * (például új gép) utánuk típus, majd lajstrom szerint. A FlightLogger API nem adja ki a
 * foglalási oldal kézi sorrendjét, ezért ezt a felhasználó állítja be.
 */
export function orderFleet<T extends Pick<FleetEntry, 'id' | 'callSign' | 'model'>>(fleet: readonly T[], order: readonly string[] | undefined): T[] {
  const rank = new Map((order ?? []).map((id, i) => [id, i]))
  const fallback = (a: T, b: T): number => a.model.localeCompare(b.model, 'hu') || a.callSign.localeCompare(b.callSign, 'hu')
  return [...fleet].sort((a, b) => {
    const ra = rank.get(a.id)
    const rb = rank.get(b.id)
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return fallback(a, b)
  })
}

/** Egy gép mozgatása a sorrendben (`delta` = -1 fel, +1 le); a teljes sorrendet menti. */
export function moveAircraft(settings: Settings, fleet: readonly FleetEntry[], aircraftId: string, delta: number): Settings {
  const from = orderFleet(fleet, settings.aircraftOrder).findIndex((a) => a.id === aircraftId)
  return from < 0 ? settings : placeAircraft(settings, fleet, aircraftId, from + delta)
}

/**
 * Egy gép áthelyezése a sorrend adott helyére (húzással, ERF-01): `index` a gép új helye a
 * kivétele utáni listában. Változatlan helynél vagy ismeretlen gépnél ugyanazt adja.
 */
export function placeAircraft(settings: Settings, fleet: readonly FleetEntry[], aircraftId: string, index: number): Settings {
  const ids = orderFleet(fleet, settings.aircraftOrder).map((a) => a.id)
  const from = ids.indexOf(aircraftId)
  if (from < 0 || index < 0 || index >= ids.length || index === from) return settings
  ids.splice(from, 1)
  ids.splice(index, 0, aircraftId)
  return { ...settings, aircraftOrder: ids }
}

/** Visszaállás az alapsorrendre (típus, majd lajstrom). */
export function resetAircraftOrder(settings: Settings): Settings {
  const { aircraftOrder: _removed, ...rest } = settings
  return rest
}

export interface AircraftOrderImport {
  readonly settings: Settings
  /** A szövegben megtalált gépek száma. */
  readonly found: number
  /** A flotta szövegben nem talált gépei (ezek a sor végére kerülnek). */
  readonly missing: readonly string[]
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Sorrend beillesztett szövegből: a FlightLogger foglalási oldaláról kimásolt géplistában
 * („HA-BAF CESSNA A152 …”) minden lajstrom első előfordulása adja a helyét. Ami nem
 * szerepel a szövegben, a meglévő sorrendjében a végére kerül.
 */
export function importAircraftOrder(settings: Settings, fleet: readonly FleetEntry[], text: string): AircraftOrderImport {
  const haystack = text.toUpperCase()
  const positions = new Map<string, number>()
  for (const a of fleet) {
    const sign = a.callSign.trim().toUpperCase()
    if (sign === '') continue
    const match = new RegExp(`(^|[^A-Z0-9-])${escapeRegExp(sign)}(?![A-Z0-9-])`).exec(haystack)
    if (match) positions.set(a.id, match.index + match[1]!.length)
  }
  const current = orderFleet(fleet, settings.aircraftOrder)
  const found = current.filter((a) => positions.has(a.id)).sort((a, b) => positions.get(a.id)! - positions.get(b.id)!)
  const rest = current.filter((a) => !positions.has(a.id))
  return {
    settings: found.length > 0 ? { ...settings, aircraftOrder: [...found, ...rest].map((a) => a.id) } : settings,
    found: found.length,
    missing: rest.map((a) => a.callSign),
  }
}

/** NOV-01, NOV-02: növendék hozzárendelése, ha még nincs; az alapértékek nem íródnak bele. */
export function assignStudent(settings: Settings, userId: string, allowedResources: StudentSettings['allowedResources'] = []): Settings {
  if (settings.students.some((s) => s.userId === userId)) return settings
  return { ...settings, students: [...settings.students, { userId, allowedResources: [...allowedResources] }] }
}

export function unassignStudent(settings: Settings, userId: string): Settings {
  return { ...settings, students: settings.students.filter((s) => s.userId !== userId) }
}

/**
 * Az oktató aznapi munkaideje a repülőtér nyitvatartásával metszve, helyi percben; `undefined`,
 * ha aznap nincs munka vagy operáció. A motor jelölt időpontjai ebbe esnek.
 */
export function workWindowOn(settings: Settings, date: LocalDate): { start: number; end: number } | undefined {
  const wd = WEEKDAYS[weekdayIndex(date)]!
  const work = settings.instructor.workWindows[wd]
  if (!work) return undefined
  let start = localTimeToMinutes(work.start)
  let end = localTimeToMinutes(work.end)
  const airport = settings.airport
  if (airport) {
    const open = airport.openingHours[wd]
    if (!open) return undefined
    start = Math.max(start, localTimeToMinutes(open.start))
    end = Math.min(end, localTimeToMinutes(open.end))
  }
  return end > start ? { start, end } : undefined
}
