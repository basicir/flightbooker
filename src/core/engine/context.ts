import { effectiveResource, effectiveStudent, matchesRef, requestPriorityOf, workWindowOn } from '../config/operations'
import type { Settings } from '../config/schema'
import { bookingStudentIds, flyingParticipantIds, isObserver, studentFlightSegment } from '../model/bookingStudents'
import type { LimitRule } from '../model/limits'
import type { EffectiveStudent } from '../model/people'
import { theoryHeadcount, type BookingRequest, type ExistingBooking, type HardCode, type PlanWarning, type Slot } from '../model/planning'
import type { EffectiveResource, ResourceKind } from '../model/resources'
import type { FlightRoute } from '../model/route'
import type { Snapshot } from '../model/snapshot'
import type { LocalDate } from '../model/time'
import { localTimeToMinutes, WEEKDAY_LABELS } from '../model/time'
import { LimitLedger, checkLimitsWith, type LimitActivity } from '../limits/evaluate'
import { phaseLimitRule } from '../config/trainingManual'
import { limitMessage } from '../limits/labels'
import { civilTwilight, sunEvents } from '../time/solar'
import { addDays, daysBetween, HOUR_MS, localParts, localToMs, MINUTE_MS, overlaps, toIso, toMs, weekdayIndex } from '../time/zoned'
import { isRouteFlight, routePointTimes } from '../route/timing'
import { assessHour, hourValues, type HourAssessment, type HourValues } from '../weather/rating'
import { maintenanceLimits, projectMaintenance, type MaintenanceLimits, type MaintenanceProjection, type UsageInterval } from './maintenance'
import {
  badWeatherFitScore,
  criteriaFor,
  dayOrderScore,
  instructorLoadScore,
  continuityScore,
  avoidFirstFlightScore,
  longNoFlyScore,
  preferredAircraftScore,
  preferredClassroomScore,
  classroomSizeScore,
  priorityScore,
  reserveScore,
  stabilityScore,
  weatherFlightScore,
  weigh,
  type Familiarity,
  type SubScores,
  type WeightedResult,
} from './scoring'

/**
 * A tervezés kontextusa: a pillanatképből és a beállításokból előre kiszámolt adatok,
 * valamint egy jelölt hely teljes kiértékelése (kizáró feltételek, figyelmeztetések,
 * részpontok). Minden számítás determinisztikus.
 */

export interface PlanOptions {
  /** A jelölt kezdési időpontok rácsa percben. */
  readonly stepMinutes?: number
  /**
   * A tervezés tényleges pillanata (H20). Ha későbbi a pillanatkép idejénél (például a
   * gyorsítótárból dolgozunk), ennél korábbra nem kerül javaslat.
   */
  readonly now?: string
}

/** Hosszú (12 óránál hosszabb) foglalás: kiesést jelez, kizáró (7.2, felderítés). */
const LONG_BOOKING_MS = 12 * HOUR_MS

/** Órák magyar tizedesvesszővel, egy tizedesre („1,5”, „2”); a gépórák így szerepelnek a beállításokban is. */
export function hoursText(hours: number): string {
  const rounded = Math.round(hours * 10) / 10
  return String(Object.is(rounded, -0) ? 0 : rounded).replace('.', ',')
}

/** „11.11.” alakú rövid dátum. */
export function shortDate(date: LocalDate): string {
  return `${date.slice(5).replace('-', '.')}.`
}

interface Interval {
  readonly start: number
  readonly end: number
  readonly hard: boolean
  readonly ref: string
  /** Repülésnél a foglalás kezdete motorpróba nélkül (a motorpróba a gépnap függvénye). */
  readonly core?: number
}

/** Egy elhelyezett (vagy standby) foglalás időpontjai. */
export interface Times {
  readonly startMs: number
  readonly endMs: number
  readonly flightStartMs: number
  readonly flightEndMs: number
  readonly resourceId: string | undefined
  readonly classroomId: string | undefined
}

export interface Placement {
  readonly request: BookingRequest
  readonly times: Times
  readonly standby: boolean
  /**
   * Mi rögzített a motorpróba-igazításnál (SZB-05): alapból a repülés kezdete (a foglalás
   * kezdete igazodik), fix időpontú igénynél a foglalás kezdete (a repülés tolódik, Q1).
   */
  readonly keep?: 'flight' | 'start'
  /** Standby elméletnél a párosított repülés igénye (H06). */
  readonly pairedRequestId?: string
}

export interface Evaluation {
  readonly request: BookingRequest
  readonly times: Times
  readonly date: LocalDate
  readonly leadDays: number
  /** Repülésnél a növendék szerinti nyers időjárás, máskor a „rossz idő” nyers értéke. */
  readonly weatherRaw: number
  /** Van-e előrejelzés a foglalás óráira (A7). */
  readonly weatherKnown: boolean
  /** Ütközik-e egy már tervezett (nem FlightLogger-beli) foglalással (H18). */
  readonly planClash: boolean
  /** Kizáró feltételek megsértése (csak kézi döntésnél maradhat bent). */
  readonly hardViolations: readonly string[]
  /** A kizáró feltételek fajtái (indokláshoz). */
  readonly hardCodes: readonly HardCode[]
  /** A megsértett kizáró feltételek fajtával együtt, a megsértés sorrendjében (hét közbeni figyelés). */
  readonly hardDetails: ReadonlyArray<{ readonly code: HardCode; readonly message: string }>
  /** Jóváhagyást igénylő figyelmeztetés van (limit-túllépés, kettős foglalás, ráérésen kívül). */
  readonly needsApproval: boolean
  readonly warnings: readonly PlanWarning[]
  readonly subScores: SubScores
  weighted: WeightedResult
}

export type EvaluationMode = 'normal' | 'forced' | 'standby'

export interface EvaluateOptions {
  /**
   * Standby elméletnél: ezek a tervezett foglalások nem számítanak ütközésnek (a párosított
   * repülés és maga az elmélet), H06.
   */
  readonly ignoreRefs?: ReadonlySet<string>
  /**
   * A többi tervezett repülés motorpróbája ideiglenes (kézi döntések alkalmazásakor): a mohó kör
   * egy korábbi repüléssel még elveheti, ezért ütközésnek csak a motorpróba nélküli idő számít.
   */
  readonly provisionalRunUp?: boolean
}

export type { HardCode }

export const HARD_CODE_LABELS: Readonly<Record<HardCode, string>> = {
  past: 'már elmúlt időpont',
  window: 'a nyitvatartáson vagy a munkaidőn kívül esik',
  blocked: 'tiltott időszakra esik',
  resource: 'a gép nem megfelelő vagy inaktív',
  roomSize: 'a terem kicsi',
  daylight: 'nappali feladat, de sötétben lenne',
  night: 'éjszakai feladat, de a repülés nem a polgári szürkület utánra esik',
  weather: 'az iskolai időjárási minimum alatt',
  instructorBusy: 'az oktató foglalt',
  studentBusy: 'a növendék foglalt',
  aircraftBusy: 'a gép foglalt (repülés vagy fordulóidő)',
  roomBusy: 'a terem foglalt',
  reserve: 'a gép kirepülhető kerete nem elég, vagy a várható karbantartására esne',
  timeWindow: 'a kezdése a megadott időablakokon kívül esik',
  order: 'megbontaná a növendék feladatainak sorrendjét',
}

/**
 * Mennyire súlyos egy kizáró feltétel felülbírálása. A „legközelebbi” hely és a kényszerítés
 * ajánlása a legkisebb összegűt választja: a munkaidőn kívüli kezdés enyhe, egy nappali
 * feladat sötétben vagy egy éjszakai nappal érdemben rossz, egy ütközés pedig nem is tartható.
 */
export const HARD_CODE_SEVERITY: Readonly<Record<HardCode, number>> = {
  past: 1000,
  resource: 100,
  roomSize: 100,
  instructorBusy: 40,
  studentBusy: 40,
  aircraftBusy: 40,
  roomBusy: 40,
  daylight: 25,
  night: 25,
  weather: 12,
  timeWindow: 30,
  order: 15,
  reserve: 8,
  blocked: 3,
  window: 2,
}

export const severityOf = (codes: readonly HardCode[]): number => codes.reduce((sum, c) => sum + HARD_CODE_SEVERITY[c], 0)

export class PlanningContext {
  readonly snapshot: Snapshot
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  readonly tz: string
  readonly nowMs: number
  readonly today: LocalDate
  readonly weekDays: readonly LocalDate[]
  readonly horizonEnd: LocalDate
  readonly stepMinutes: number
  readonly replanning: boolean
  readonly bookings: readonly ExistingBooking[]

  readonly #students = new Map<string, EffectiveStudent>()
  readonly #weather = new Map<number, HourValues>()
  /** Az útvonal-repülőterek órái ICAO-kód szerint (K27, SZB-19); a bázis a `#weather`. */
  readonly #routeWeather = new Map<string, { readonly hours: Map<number, HourValues>; readonly latitude: number; readonly longitude: number }>()
  readonly #baseIcao: string | undefined
  readonly #assessments = new Map<string, HourAssessment>()
  readonly #runways: readonly number[]
  readonly #existing = new Map<string, Interval[]>()
  /** A repülési igények növendékei az igény elsőbbségével (SZB-16, ELS-02). */
  readonly #consideredStudents: ReadonlyArray<{ readonly priority: number; readonly studentIds: readonly string[] }>
  readonly #consideredCache = new Map<number, readonly string[]>()
  #placements: Placement[] = []
  /** Lefoglalt, de még el nem helyezett idők (vállalt figyelmeztetéses döntések): csak ütközésként számítanak. */
  #reserved: Placement[] = []
  #occupancy = new Map<string, Interval[]>()
  #instructorLedger: LimitLedger
  #studentLedgers = new Map<string, LimitLedger>()
  readonly #instructorBase: LimitActivity[]
  readonly #studentBase = new Map<string, LimitActivity[]>()
  // Indexek a meglévő foglalásokra: a kiértékelés nem járja be minden jelöltnél az összeset.
  /** Gépenként és naponként a repülések kezdete. */
  readonly #flightStartsByResourceDay = new Map<string, number[]>()
  /** Gépenként a foglalt repülések és a rögzített karbantartások (gépóra-keret, SZB-06). */
  readonly #usageByResource = new Map<string, UsageInterval[]>()
  /** Növendékenként a jövőbeli repülések kezdete (sürgősség). */
  readonly #futureFlightsByStudent = new Map<string, number[]>()
  /** Az oktató saját repülései naponként (időbeli sorrend). */
  readonly #ownFlightsByDay = new Map<LocalDate, Array<{ studentId: string | undefined; start: number }>>()
  /** Közös briefing csapatok (KBR-01): igény → csapat, és a csapat tagjainak FlightLogger-foglalásai. */
  #teamOf: ReadonlyMap<string, string> = new Map()
  #teamBookings: ReadonlyMap<string, ReadonlySet<string>> = new Map()
  /** Feladatsorrend (ELS-05): igény → a növendék sora és benne a helye. */
  #sequenceOf: ReadonlyMap<string, { readonly members: readonly string[]; readonly index: number }> = new Map()
  #sequenceBooked: ReadonlyMap<string, { readonly startMs: number; readonly endMs: number }> = new Map()

  constructor(snapshot: Snapshot, settings: Settings, requests: readonly BookingRequest[], options: PlanOptions = {}) {
    this.snapshot = snapshot
    this.settings = settings
    this.requests = requests
    this.tz = snapshot.timezone
    this.nowMs = Math.max(toMs(snapshot.generatedAt), options.now ? toMs(options.now) : Number.NEGATIVE_INFINITY)
    this.today = localParts(this.nowMs, this.tz).date
    this.weekDays = Array.from({ length: 7 }, (_, i) => addDays(snapshot.weekStart, i))
    this.horizonEnd = this.weekDays[6]!
    this.stepMinutes = options.stepMinutes ?? 30
    this.replanning = snapshot.previousPlan !== undefined
    this.bookings = snapshot.bookings.filter((b) => b.status !== 'CANCELLED')
    this.#runways = settings.airport?.runways.map((r) => r.trueHeadingDeg) ?? []

    for (const s of settings.students) this.#students.set(s.userId, effectiveStudent(settings, s))
    for (const hour of snapshot.weather) this.#weather.set(Math.floor(toMs(hour.time) / HOUR_MS) * HOUR_MS, hourValues(hour, this.#runways))
    this.#baseIcao = settings.airport?.icaoCode
    for (const [icao, aw] of Object.entries(snapshot.routeWeather ?? {})) {
      if (icao === this.#baseIcao) continue
      const hours = new Map<number, HourValues>()
      for (const hour of aw.hours) hours.set(Math.floor(toMs(hour.time) / HOUR_MS) * HOUR_MS, hourValues(hour, aw.runwayHeadingsDeg))
      this.#routeWeather.set(icao, { hours, latitude: aw.latitude, longitude: aw.longitude })
    }
    this.#consideredStudents = requests.filter((r) => r.kind === 'flight').map((r) => ({ priority: requestPriorityOf(settings, r), studentIds: r.studentIds }))

    for (const b of this.bookings) this.#indexExisting(b)
    this.#buildIndexes()

    this.#instructorBase = this.#buildInstructorBase()
    // Növendék: a foglalás szolgálati idő (TM II.6.4); a múltbeli repült idő a repülésekből jön.
    const hasStudentFlights = snapshot.studentFlights !== undefined
    for (const b of this.bookings) {
      for (const id of b.participantIds) {
        const list = this.#studentBase.get(id) ?? []
        const a = this.#activityOfBooking(b, true, id)
        list.push(hasStudentFlights && a.startMs < this.nowMs ? { ...a, flightMinutes: 0 } : a)
        this.#studentBase.set(id, list)
      }
    }
    for (const [id, flights] of Object.entries(snapshot.studentFlights ?? {})) {
      const list = this.#studentBase.get(id) ?? []
      for (const f of flights) {
        const s = toMs(f.start)
        const e = toMs(f.end)
        if (s >= this.nowMs || !(e > s)) continue
        list.push({ date: localParts(s, this.tz).date, startMs: s, endMs: e, flightMinutes: (e - s) / MINUTE_MS, simulator: f.simulator, task: false, duty: false })
      }
      this.#studentBase.set(id, list)
    }
    this.#instructorLedger = new LimitLedger(this.#instructorBase)
    // A növendékek limitje az első elhelyezés előtt is a FlightLogger-foglalásokkal és a korábbi
    // repülésekkel számol (LIM-03, LIM-06); a `#rebuild` ugyanezt bővíti a tervezettekkel.
    this.#studentLedgers = new Map([...this.#studentBase].map(([id, list]) => [id, new LimitLedger(list)]))
  }

  // ---------- gépóra-keret (SZB-06) ----------

  /** A gép kerete; `undefined`, ha a kirepülhető idő nincs megadva. */
  maintenanceLimitsOf(resourceId: string): MaintenanceLimits | undefined {
    const entry = this.settings.aircraftHours[resourceId]
    return entry ? maintenanceLimits(this.settings, entry, this.resource(resourceId).minReserveHours) : undefined
  }

  /**
   * A gép repülései a kirepülhető idő megadásának napjától: meglévő foglalások és a tervezett
   * (nem tartalék) elhelyezések, a kizárt igény nélkül.
   */
  #usage(resourceId: string, excludeRequestId?: string): UsageInterval[] {
    const entry = this.settings.aircraftHours[resourceId]
    const from = entry ? localToMs(entry.date, 0, this.tz) : this.nowMs
    const list = (this.#usageByResource.get(resourceId) ?? []).filter((iv) => (iv.kind === 'flight' ? iv.start >= from : iv.end > from))
    for (const p of this.#placements) {
      if (p.standby || p.times.resourceId !== resourceId || p.request.id === excludeRequestId || p.request.kind !== 'flight') continue
      list.push({ start: p.times.flightStartMs, end: p.times.flightEndMs, kind: 'flight', ref: `p:${p.request.id}` })
    }
    return list
  }

  /** A gép várható karbantartása a jelenlegi terv szerint. */
  maintenanceOutlook(resourceId: string): { limits: MaintenanceLimits; projection: MaintenanceProjection } | undefined {
    const limits = this.maintenanceLimitsOf(resourceId)
    if (!limits) return undefined
    return { limits, projection: projectMaintenance(this.#usage(resourceId), limits, this.nowMs) }
  }

  /**
   * Belefér-e a repülés a gép keretébe. Kizáró, ha a repülés a várható karbantartásra esik,
   * vagy ha miatta a karbantartás előrébb kerülne, és egy eddig lerepülhető foglalás vagy
   * tervezett repülés esne rá.
   */
  #maintenanceCheck(request: BookingRequest, t: Times): { violation?: string; reserve: number } | undefined {
    const resourceId = t.resourceId!
    const limits = this.maintenanceLimitsOf(resourceId)
    if (!limits) return undefined
    const usage = this.#usage(resourceId, request.id)
    const baseline = projectMaintenance(usage, limits, this.nowMs)
    const ref = `p:${request.id}`
    const own = (t.flightEndMs - t.flightStartMs) / HOUR_MS
    const withOwn = projectMaintenance([...usage, { start: t.flightStartMs, end: t.flightEndMs, kind: 'flight', ref }], limits, this.nowMs)
    const entry = this.settings.aircraftHours[resourceId]!
    const typePart =
      limits.type === undefined ? '; a karbantartás fajtája nincs megadva, túlrepülés nélkül)' : `) + ${hoursText(limits.overflyHours)} óra túlrepülés (${limits.type} órás karbantartás előtt)`
    const before = withOwn.usedHours - (withOwn.blocked.has(ref) ? 0 : own)
    const breakdown = `keret: ${hoursText(limits.hoursUntilMaintenance)} óra (megadva: ${shortDate(entry.date)}${typePart}, puffer: ${hoursText(limits.bufferHours)} óra, előtte foglalt és tervezett: ${hoursText(before)} óra, ez a repülés: ${hoursText(own)} óra`
    const win = withOwn.window
    const windowText = win ? `${this.timeText(win.start)} – ${this.timeText(win.end)}` : ''
    if (win && withOwn.crossingRef === ref) {
      // Ez a repülés már nem fér bele: az oktató ebből dönti el, vállalja-e (SZB-06).
      const remaining = limits.limitHours - before - own
      const why =
        remaining < -1e-9
          ? `a gép ${hoursText(-remaining)} órával túllépné a karbantartási határt (a túlrepüléssel együtt)`
          : `a gépben ${hoursText(remaining)} óra maradna a karbantartásig, a biztonsági puffer ${hoursText(limits.bufferHours)} óra`
      return { violation: `${why}; várható karbantartás: ${windowText} – ${breakdown}`, reserve: 0 }
    }
    if (win && withOwn.blocked.has(ref)) {
      return { violation: `a gép várható karbantartására esne (${windowText}) – ${breakdown}`, reserve: 0 }
    }
    const pushed = [...withOwn.blocked].filter((r) => !baseline.blocked.has(r))
    if (win && pushed.length > 0) {
      return { violation: `a gép karbantartása előrébb kerülne (${windowText}), és ${pushed.length} már foglalt vagy tervezett repülés esne rá – ${breakdown}`, reserve: 0 }
    }
    // A karbantartás utáni repülésnél a keret újraindul.
    if (win && t.flightStartMs >= win.end) return { reserve: 1 }
    return { reserve: reserveScore(limits.limitHours - withOwn.usedHours, limits.bufferHours) }
  }

  timeText(ms: number): string {
    const p = localParts(ms, this.tz)
    return `${shortDate(p.date)} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
  }

  // ---------- alapadatok ----------

  student(id: string): EffectiveStudent | undefined {
    return this.#students.get(id)
  }

  /** Az erőforrás beállításai a géptípussal együtt (ERF-08, ERF-10). */
  readonly #resourceCache = new Map<string, EffectiveResource>()
  resource(id: string): EffectiveResource {
    let r = this.#resourceCache.get(id)
    if (!r) {
      r = effectiveResource(this.settings, id, this.resourceKind(id), this.#fleetEntry(id)?.model)
      this.#resourceCache.set(id, r)
    }
    return r
  }

  resourceKind(id: string): ResourceKind {
    const own = this.settings.resources[id]?.kind
    if (own) return own
    return this.#fleetEntry(id)?.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft'
  }

  #bookingIsSimulator(b: ExistingBooking): boolean {
    return b.resourceId !== undefined && this.resourceKind(b.resourceId) === 'simulator'
  }

  #indexExisting(b: ExistingBooking): void {
    const start = toMs(b.start)
    const end = toMs(b.end)
    const long = end - start > LONG_BOOKING_MS
    const add = (key: string, iv: Interval): void => {
      const list = this.#existing.get(key) ?? []
      list.push(iv)
      this.#existing.set(key, list)
    }
    if (b.resourceId) {
      const fs = b.flightStart ? toMs(b.flightStart) : start
      const fe = b.flightEnd ? toMs(b.flightEnd) : end
      const turnaround = this.resource(b.resourceId).turnaroundMinutes * MINUTE_MS
      const hard = long || b.type === 'maintenance' || b.type === 'operation'
      add(`res:${b.resourceId}`, { start: fs, end: fe + turnaround, hard, ref: b.id })
    }
    if (b.instructorId === this.snapshot.instructorId || b.participantIds.includes(this.snapshot.instructorId)) {
      add('instr', { start, end, hard: long, ref: b.id })
    }
    for (const id of b.participantIds) add(`stu:${id}`, { start, end, hard: long, ref: b.id })
    if (b.classroomId) add(`room:${b.classroomId}`, { start, end, hard: true, ref: b.id })
  }

  #buildIndexes(): void {
    const push = <K, V>(map: Map<K, V[]>, key: K, value: V): void => {
      const list = map.get(key)
      if (list) list.push(value)
      else map.set(key, [value])
    }
    for (const b of this.bookings) {
      // Csak a fajtás (50, 100, 200 órás) karbantartás indítja újra a keretet (Q8, A9); a javítás nem.
      if (b.resourceId && b.type === 'maintenance' && b.maintenanceLevel !== undefined) push(this.#usageByResource, b.resourceId, { start: toMs(b.start), end: toMs(b.end), kind: 'maintenance', ref: `b:${b.id}` })
      if (!b.flightStart) continue
      const fs = toMs(b.flightStart)
      const date = localParts(fs, this.tz).date
      if (b.resourceId) {
        push(this.#flightStartsByResourceDay, `${b.resourceId}|${date}`, fs)
        if (b.flightEnd && b.type !== 'maintenance') push(this.#usageByResource, b.resourceId, { start: fs, end: toMs(b.flightEnd), kind: 'flight', ref: `b:${b.id}` })
        if (fs >= this.nowMs && this.resourceKind(b.resourceId) === 'aircraft') {
          // A megfigyelő nem repül; a többnövendékes foglalásban mindenki a saját szakaszában (KBR-10).
          for (const id of flyingParticipantIds(b)) push(this.#futureFlightsByStudent, id, studentFlightSegment(b, id)?.start ?? fs)
        }
      }
      if (b.instructorId === this.snapshot.instructorId) {
        const students = bookingStudentIds(b) ?? []
        if (students.length === 0) push(this.#ownFlightsByDay, date, { studentId: flyingParticipantIds(b)[0], start: fs })
        for (const id of students) push(this.#ownFlightsByDay, date, { studentId: id, start: studentFlightSegment(b, id)?.start ?? fs })
      }
    }
  }

  /**
   * Egy FlightLogger-foglalás a limitekhez. Az oktatónál (`studentId` nélkül) a teljes repülési
   * ablak repült idő. A növendéknél a saját szakasza: a többnövendékes foglalásban a növendékek
   * egymás után repülnek (KBR-10), a megfigyelő pedig nem repül, neki csak szolgálati idő.
   */
  #activityOfBooking(b: ExistingBooking, duty: boolean, studentId?: string): LimitActivity {
    const start = toMs(b.start)
    const fs = b.flightStart ? toMs(b.flightStart) : undefined
    const fe = b.flightEnd ? toMs(b.flightEnd) : undefined
    const isFlight = fs !== undefined && fe !== undefined && b.resourceId !== undefined && (studentId === undefined || !isObserver(b, studentId))
    const segment = isFlight && studentId !== undefined && b.type === 'multiStudent' ? studentFlightSegment(b, studentId) : undefined
    return {
      date: localParts(start, this.tz).date,
      startMs: start,
      endMs: toMs(b.end),
      flightMinutes: isFlight ? ((segment?.end ?? fe) - (segment?.start ?? fs)) / MINUTE_MS : 0,
      simulator: this.#bookingIsSimulator(b),
      task: isFlight,
      duty,
    }
  }

  #buildInstructorBase(): LimitActivity[] {
    const me = this.snapshot.instructorId
    const list: LimitActivity[] = []
    // Múltbeli repült idő: a repülésekből (block time) és a kézi korrekciókból (8.3, K37).
    for (const f of this.snapshot.instructorFlights) {
      const s = toMs(f.start)
      const e = toMs(f.end)
      list.push({ date: localParts(s, this.tz).date, startMs: s, endMs: e, flightMinutes: (e - s) / MINUTE_MS, simulator: f.simulator, task: true, duty: false })
    }
    for (const m of this.settings.limits.manualFlightTime) {
      const s = localToMs(m.date, 12 * 60, this.tz)
      list.push({ date: m.date, startMs: s, endMs: s, flightMinutes: m.minutes, simulator: m.simulator, task: false, duty: false })
    }
    // Foglalások: szolgálati idő mindig; repült idő csak a jövőbelieknél (a múlt a repülésekből jön).
    for (const b of this.bookings) {
      if (b.instructorId !== me && !b.participantIds.includes(me)) continue
      const a = this.#activityOfBooking(b, true)
      list.push(a.startMs >= this.nowMs ? a : { ...a, flightMinutes: 0 })
    }
    return list
  }

  // ---------- közös briefing csapatok (KBR-01) ----------

  /**
   * A csapatok megadása a kiértékelések előtt. A csapat tagjai azonos időben kezdenek és végeznek,
   * ezért az oktató (és a gép a páron belül) egymás között nem ütközik; a tagok idejét a csapat
   * elrendezése adja, a motorpróba-igazítás nem mozdítja őket egyenként.
   */
  setTeams(teamOf: ReadonlyMap<string, string>, bookingsByTeam: ReadonlyMap<string, ReadonlySet<string>> = new Map()): void {
    this.#teamOf = teamOf
    this.#teamBookings = bookingsByTeam
    this.#candidateCache.clear()
    this.#rebuild()
  }

  /**
   * Feladatsorrend (ELS-05): növendékenként az automatikus feladatú igények sorban
   * (`lectureSequences`). A sorban későbbi igény nem kezdődhet a korábbi vége előtt. `booked`: a
   * FlightLoggerben már lefoglalt igények helye, ha a terv nem helyezi el őket.
   */
  setSequences(sequences: ReadonlyArray<readonly string[]>, booked: ReadonlyArray<{ readonly requestId: string; readonly slot: Slot }> = []): void {
    const position = new Map<string, { readonly members: readonly string[]; readonly index: number }>()
    for (const members of sequences) members.forEach((id, index) => position.set(id, { members, index }))
    this.#sequenceOf = position
    this.#sequenceBooked = new Map(booked.map((b) => [b.requestId, { startMs: toMs(b.slot.start), endMs: toMs(b.slot.end) }]))
    this.#candidateCache.clear()
  }

  /** Rövid időpont az indokláshoz: „csütörtök 10:45”. */
  #shortLabel(ms: number): string {
    const p = localParts(ms, this.tz)
    return `${WEEKDAY_LABELS[p.weekday]} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
  }

  /** A sorbeli társ ideje: a terv elhelyezése vagy lefoglalt ideje, különben a FlightLogger-foglalása. */
  #sequenceTimes(requestId: string): { readonly startMs: number; readonly endMs: number } | undefined {
    return this.timesOf(requestId) ?? this.#reserved.find((p) => p.request.id === requestId)?.times ?? this.#sequenceBooked.get(requestId)
  }

  /** Az igény csapata, ha egy közös briefing csapat tagja. */
  teamOf(requestId: string): string | undefined {
    return this.#teamOf.get(requestId)
  }

  // ---------- elhelyezések ----------

  get placements(): readonly Placement[] {
    return this.#placements
  }

  /** Az utolsó változtatás után mely elhelyezések ideje bővült a motorpróba miatt (H01). */
  #grown: ReadonlySet<string> = new Set()
  get lastGrown(): ReadonlySet<string> {
    return this.#grown
  }

  place(p: Placement): void {
    this.#placements.push(p)
    this.#bump(p)
    this.#grown = this.#normalizeRunUps()
    this.#rebuild()
  }

  /** A (nem standby) elhelyezés kivétele. */
  unplace(requestId: string): void {
    for (const p of this.#placements) if (p.request.id === requestId && !p.standby) this.#bump(p)
    this.#placements = this.#placements.filter((p) => p.request.id !== requestId || p.standby)
    this.#grown = this.#normalizeRunUps()
    this.#rebuild()
  }

  /** Az elhelyezés jelenlegi ideje (a motorpróba-igazítással együtt). */
  timesOf(requestId: string, standby = false): Times | undefined {
    return this.#placements.find((p) => p.request.id === requestId && p.standby === standby)?.times
  }

  /**
   * A motorpróba a gép napi első repülésére kerül (SZB-05, A3). Minden elhelyezésnél és
   * kivételnél újraszámoljuk, így az ütközésvizsgálat mindig a valós kezdettel dolgozik.
   * Visszaadja azokat az elhelyezéseket, amelyek ideje ettől bővült (ezeket újra kell nézni).
   */
  #normalizeRunUps(): Set<string> {
    const grown = new Set<string>()
    let changed = false
    const next = this.#placements.map((p) => {
      const t = this.#runUpTimes(p.request, p.times, p.keep ?? 'flight', p.standby)
      if (t === p.times) return p
      changed = true
      if (t.startMs < p.times.startMs || t.endMs > p.times.endMs) grown.add(p.request.id)
      this.#bump(p)
      return { ...p, times: t }
    })
    if (changed) this.#placements = next
    return grown
  }

  #runUpTimes(request: BookingRequest, t: Times, keep: 'flight' | 'start', standby: boolean): Times {
    // A csapattag idejét a csapat elrendezése adja (a motorpróba az első egységnél benne van).
    if (standby || request.kind !== 'flight' || !t.resourceId || this.#teamOf.has(request.id)) return t
    const d = request.durations
    const runUp = this.resource(t.resourceId).engineRunUpMinutes * MINUTE_MS
    if (keep === 'start') {
      const base = t.startMs + d.briefing * MINUTE_MS
      const fs = base + (this.isFirstFlightOfDay(t.resourceId, base, request.id) ? runUp : 0)
      if (fs === t.flightStartMs) return t
      const fe = fs + (t.flightEndMs - t.flightStartMs)
      return { ...t, flightStartMs: fs, flightEndMs: fe, endMs: fe + d.debriefing * MINUTE_MS }
    }
    const start = t.flightStartMs - d.briefing * MINUTE_MS - (this.isFirstFlightOfDay(t.resourceId, t.flightStartMs, request.id) ? runUp : 0)
    return start === t.startMs ? t : { ...t, startMs: start }
  }

  /** Egy leendő elhelyezés ideje a motorpróbával igazítva (kézi döntésnél, H12). */
  withRunUp(request: BookingRequest, t: Times, keep: 'flight' | 'start' = 'flight'): Times {
    return this.#runUpTimes(request, t, keep, false)
  }

  /**
   * Egy elhelyezés újraértékelése a jelenlegi idejével, önmaga nélkül: a motorpróba-igazítás
   * után ebből derül ki, ütközik-e valamivel (H01).
   */
  reevaluate(requestId: string): Evaluation | undefined {
    const saved = this.#placements
    const p = saved.find((x) => x.request.id === requestId && !x.standby)
    if (!p) return undefined
    this.#placements = saved.filter((x) => x !== p)
    this.#rebuild()
    try {
      return this.evaluate(p.request, p.times, 'forced')
    } finally {
      this.#placements = saved
      this.#rebuild()
    }
  }

  /** Az időpont lefoglalása a limitek érintése nélkül; a mohó elhelyezés ezt kerüli. */
  reserve(p: Placement): void {
    this.#reserved.push(p)
    this.#bump(p)
    this.#rebuild()
  }

  release(requestId: string): void {
    for (const p of this.#reserved) if (p.request.id === requestId) this.#bump(p)
    this.#reserved = this.#reserved.filter((p) => p.request.id !== requestId)
    this.#rebuild()
  }


  #rebuild(): void {
    this.#occupancy = new Map()
    const add = (key: string, iv: Interval): void => {
      const list = this.#occupancy.get(key) ?? []
      list.push(iv)
      this.#occupancy.set(key, list)
    }
    const instructorExtra: LimitActivity[] = []
    const studentExtra = new Map<string, LimitActivity[]>()
    const reservedIds = new Set(this.#reserved.map((p) => p.request.id))
    for (const p of [...this.#placements, ...this.#reserved]) {
      const t = p.times
      if (t.classroomId) add(`room:${t.classroomId}`, { start: t.startMs, end: t.endMs, hard: true, ref: p.standby ? `${p.request.id}#standby` : p.request.id })
      if (p.standby) {
        // A standby elmélet a párosított repülés növendékén kívüli résztvevőket is leköti (H06).
        const paired = this.#placements.find((x) => !x.standby && x.request.id === p.pairedRequestId)
        for (const id of p.request.studentIds) {
          if (!paired?.request.studentIds.includes(id)) add(`stu:${id}`, { start: t.startMs, end: t.endMs, hard: true, ref: `${p.request.id}#standby` })
        }
        continue
      }
      const core = p.request.kind === 'flight' && t.resourceId && !this.#teamOf.has(p.request.id) ? t.flightStartMs - p.request.durations.briefing * MINUTE_MS : undefined
      const iv = { start: t.startMs, end: t.endMs, hard: true, ref: p.request.id, ...(core !== undefined && core > t.startMs ? { core } : {}) }
      add('instr', iv)
      for (const id of p.request.studentIds) add(`stu:${id}`, iv)
      if (t.resourceId) {
        const turnaround = this.resource(t.resourceId).turnaroundMinutes * MINUTE_MS
        add(`res:${t.resourceId}`, { start: t.flightStartMs, end: t.flightEndMs + turnaround, hard: true, ref: p.request.id })
      }
      if (reservedIds.has(p.request.id)) continue
      const a = this.activityOf(p.request, t)
      instructorExtra.push({ ...a, duty: true })
      for (const id of p.request.studentIds) {
        const list = studentExtra.get(id) ?? []
        list.push(a)
        studentExtra.set(id, list)
      }
    }
    this.#instructorLedger = new LimitLedger([...this.#instructorBase, ...instructorExtra])
    this.#studentLedgers = new Map()
    const ids = new Set([...this.#studentBase.keys(), ...studentExtra.keys()])
    for (const id of ids) this.#studentLedgers.set(id, new LimitLedger([...(this.#studentBase.get(id) ?? []), ...(studentExtra.get(id) ?? [])]))
  }

  activityOf(request: BookingRequest, t: Times): LimitActivity {
    const isTask = request.kind !== 'theory'
    return {
      date: localParts(t.startMs, this.tz).date,
      startMs: t.startMs,
      endMs: t.endMs,
      flightMinutes: isTask ? (t.flightEndMs - t.flightStartMs) / MINUTE_MS : 0,
      simulator: request.kind === 'simulator',
      task: isTask,
      duty: true,
    }
  }

  // ---------- időablak, időjárás ----------

  /** Az operációs idő és a munkaidő-ablak metszete a napon (ERF-09, SZB-13), percben. */
  windowFor(date: LocalDate): { start: number; end: number } | undefined {
    return workWindowOn(this.settings, date)
  }

  /** Tiltott időszak (SZB-14, K35): a motor soha nem használja. */
  blockedPeriodHit(startMs: number, endMs: number): string | undefined {
    for (const p of this.settings.instructor.blockedPeriods) {
      if (p.kind === 'once') {
        if (overlaps(startMs, endMs, toMs(p.start), toMs(p.end))) return p.note ?? 'tiltott időszak'
        continue
      }
      for (const day of this.weekDays) {
        if ((['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const)[weekdayIndex(day)] !== p.weekday) continue
        if ((p.validFrom && day < p.validFrom) || (p.validTo && day > p.validTo)) continue
        const s = localToMs(day, localTimeToMinutes(p.start), this.tz)
        const e = localToMs(day, localTimeToMinutes(p.end), this.tz)
        if (overlaps(startMs, endMs, s, e)) return p.note ?? 'tiltott időszak'
      }
    }
    return undefined
  }

  #hoursOf(startMs: number, endMs: number): number[] {
    const hours: number[] = []
    for (let h = Math.floor(startMs / HOUR_MS) * HOUR_MS; h < endMs; h += HOUR_MS) hours.push(h)
    return hours
  }

  /** Egy repülőtér órái: a bázisé, vagy egy útvonal-repülőtéré (ismeretlennél `undefined`). */
  #hoursAt(icao: string | undefined): ReadonlyMap<number, HourValues> | undefined {
    if (icao === undefined || icao === this.#baseIcao) return this.#weather
    return this.#routeWeather.get(icao)?.hours
  }

  #coordinates = (icao: string): { latitude: number; longitude: number } | undefined => {
    if (icao === this.#baseIcao && this.settings.airport) return this.settings.airport
    return this.#routeWeather.get(icao)
  }

  /** `icao`: útvonal-repülőtér; hiányában a bázis. */
  assessment(studentId: string | undefined, hourMs: number, icao?: string): HourAssessment | undefined {
    const values = this.#hoursAt(icao)?.get(hourMs)
    if (!values) return undefined
    const key = `${icao === this.#baseIcao ? '' : (icao ?? '')}|${studentId ?? '-'}|${hourMs}`
    let a = this.#assessments.get(key)
    if (!a) {
      const limits = studentId ? (this.#students.get(studentId)?.weatherLimits ?? {}) : {}
      a = assessHour(values, this.settings.weather.schoolMinima, limits)
      this.#assessments.set(key, a)
    }
    return a
  }

  /**
   * Repülés: a legrosszabb óra a növendék limitjei szerint. Helyi repülésnél a bázis a teljes
   * repülés alatt; útvonalasnál (K27, SZB-19) minden érintett repülőtér abban az ablakban,
   * amikor a gép ott lehet. `missing`: a repülőterek, amelyekre az ablakban nincs előrejelzés;
   * `schoolViolatedAt` és `thunderAt`: ahol a minimum sérül, illetve zivatarveszély van.
   */
  flightWeather(
    studentId: string,
    startMs: number,
    endMs: number,
    route?: FlightRoute,
  ): { raw: number; schoolViolated: boolean; known: boolean; thunder: boolean; missing: string[]; schoolViolatedAt: string[]; thunderAt: string[] } {
    const windows: Array<{ icao: string | undefined; fromMs: number; toMs: number }> = route
      ? routePointTimes(route, startMs, endMs, this.#coordinates).map((p) => ({ icao: p.icao, fromMs: p.fromMs, toMs: p.toMs }))
      : [{ icao: undefined, fromMs: startMs, toMs: endMs }]
    let raw = 1
    let known = false
    const missing = new Set<string>()
    const violatedAt = new Set<string>()
    const thunderAt = new Set<string>()
    for (const w of windows) {
      const name = w.icao ?? this.#baseIcao ?? ''
      let any = false
      for (const h of this.#hoursOf(w.fromMs, w.toMs)) {
        const a = this.assessment(studentId, h, w.icao)
        if (!a) continue
        any = any || a.hasData
        known = known || a.hasData
        raw = Math.min(raw, a.raw)
        if (a.schoolViolated) violatedAt.add(name)
        if (a.thunderRisk) thunderAt.add(name)
      }
      if (!any && route) missing.add(name)
    }
    // Útvonalon az ismeretlen repülőtér is bizonytalanná teszi a repülést.
    if (known && missing.size > 0) raw = Math.min(raw, 0.5)
    return { raw: known ? raw : 0.5, schoolViolated: violatedAt.size > 0, known, thunder: thunderAt.size > 0, missing: [...missing], schoolViolatedAt: [...violatedAt], thunderAt: [...thunderAt] }
  }

  /**
   * A szóba jövő növendékek (SZB-16): a legfeljebb `priority` elsőbbségű (legalább ilyen fontos)
   * repülési igények növendékei. Így egy kevésbé fontos igény (például helykitöltő) növendéke nem
   * változtat a fontosabb elmélet vagy szimulátor rossz idejének megítélésén (ELS-02).
   */
  #consideredFor(priority: number): readonly string[] {
    let list = this.#consideredCache.get(priority)
    if (!list) {
      list = [...new Set(this.#consideredStudents.filter((s) => s.priority <= priority).flatMap((s) => s.studentIds))].sort()
      this.#consideredCache.set(priority, list)
    }
    return list
  }

  /**
   * Elmélet és szimulátor: mennyire repülhető az óra. Rossz idő az is, amikor a szóba jövő
   * növendékek limitjei alapján senki sem repülhet (SZB-16); órák átlaga. `priority`: a
   * kiértékelt igény elsőbbsége (hiányában minden repülési igény növendéke számít).
   */
  flyabilityRaw(startMs: number, endMs: number, priority: number = Number.POSITIVE_INFINITY): number {
    const values: number[] = []
    const considered = this.#consideredFor(priority)
    for (const h of this.#hoursOf(startMs, endMs)) {
      const students = considered.length > 0 ? considered : [undefined]
      let best: number | undefined
      for (const id of students) {
        const a = this.assessment(id, h)
        if (!a) continue
        const r = a.schoolViolated ? 0 : a.raw
        best = best === undefined ? r : Math.max(best, r)
      }
      if (best !== undefined) values.push(best)
    }
    return values.length === 0 ? 0.5 : values.reduce((a, b) => a + b, 0) / values.length
  }

  // ---------- ütközések ----------

  #conflicts(map: Map<string, Interval[]>, key: string, start: number, end: number): Interval[] {
    return (map.get(key) ?? []).filter((iv) => overlaps(start, end, iv.start, iv.end))
  }

  /** Az oktató foglalt ideje a napon órában (meglévő és tervezett foglalások). */
  instructorHoursOn(date: LocalDate): number {
    const dayStart = localToMs(date, 0, this.tz)
    const dayEnd = localToMs(addDays(date, 1), 0, this.tz)
    let total = 0
    // A közös briefing csapat tagjai ugyanazt az időt foglalják: egyszer számít (KBR-01).
    const teams = new Set<string>()
    for (const map of [this.#existing, this.#occupancy]) {
      for (const iv of map.get('instr') ?? []) {
        const team = map === this.#occupancy ? this.#teamOf.get(iv.ref) : undefined
        if (team !== undefined) {
          if (teams.has(team)) continue
          teams.add(team)
        }
        total += Math.max(0, Math.min(iv.end, dayEnd) - Math.max(iv.start, dayStart))
      }
    }
    return total / HOUR_MS
  }

  /**
   * Az oktató aznapi legközelebbi másik foglalása és a megadott idő közötti szünet percben
   * (meglévő és tervezett foglalások; átfedésnél 0). A 12 óránál hosszabb meglévő foglalás
   * (például szabadság) nem számít. `undefined`, ha aznap nincs más foglalása.
   */
  instructorGapMinutes(date: LocalDate, startMs: number, endMs: number, requestId: string): number | undefined {
    const dayStart = localToMs(date, 0, this.tz)
    const dayEnd = localToMs(addDays(date, 1), 0, this.tz)
    let gap: number | undefined
    for (const [map, skipLong] of [[this.#existing, true], [this.#occupancy, false]] as const) {
      for (const iv of map.get('instr') ?? []) {
        if (iv.ref === requestId || iv.end <= dayStart || iv.start >= dayEnd) continue
        if (skipLong && iv.hard) continue
        const g = Math.max(0, iv.start - endMs, startMs - iv.end)
        if (gap === undefined || g < gap) gap = g
      }
    }
    return gap === undefined ? undefined : gap / MINUTE_MS
  }

  /** Az első repülés-e a gépen aznap (SZB-05): meglévő és tervezett foglalásokkal. */
  isFirstFlightOfDay(resourceId: string, flightStartMs: number, excludeRequestId?: string): boolean {
    const date = localParts(flightStartMs, this.tz).date
    for (const fs of this.#flightStartsByResourceDay.get(`${resourceId}|${date}`) ?? []) {
      if (fs < flightStartMs) return false
    }
    for (const p of this.#placements) {
      if (p.standby || p.times.resourceId !== resourceId || p.request.id === excludeRequestId) continue
      if (p.times.flightStartMs < flightStartMs && localParts(p.times.flightStartMs, this.tz).date === date) return false
    }
    return true
  }

  /**
   * Repül-e már a gép aznap másik foglalással (meglévő vagy tervezett, standby nélkül). Ha
   * igen, a foglalás nem nyit új gépnapot, tehát nem kell miatta újabb motorpróba.
   */
  aircraftFliesOnDay(resourceId: string, flightStartMs: number, excludeRequestId?: string): boolean {
    const date = localParts(flightStartMs, this.tz).date
    if ((this.#flightStartsByResourceDay.get(`${resourceId}|${date}`) ?? []).length > 0) return true
    return this.#placements.some(
      (p) => !p.standby && p.times.resourceId === resourceId && p.request.id !== excludeRequestId && localParts(p.times.flightStartMs, this.tz).date === date,
    )
  }

  /** Időpontok egy kezdő (repülési vagy órakezdési) időpontból. */
  timesAt(request: BookingRequest, anchorMs: number, resourceId: string | undefined, classroomId: string | undefined): Times {
    const d = request.durations
    // Fix időpontnál a foglalás kezdete a megadott idő; a motorpróba a repülést tolja (Q1, H11).
    if (request.timing?.kind === 'fixed' && request.kind === 'flight' && resourceId && anchorMs === toMs(request.timing.start) + d.briefing * MINUTE_MS) {
      return this.withRunUp(request, { startMs: toMs(request.timing.start), endMs: anchorMs + (d.main + d.debriefing) * MINUTE_MS, flightStartMs: anchorMs, flightEndMs: anchorMs + d.main * MINUTE_MS, resourceId, classroomId }, 'start')
    }
    let briefing = d.briefing
    if (request.kind === 'flight' && resourceId && this.isFirstFlightOfDay(resourceId, anchorMs, request.id)) {
      briefing += this.resource(resourceId).engineRunUpMinutes
    }
    const flightEnd = anchorMs + d.main * MINUTE_MS
    return {
      startMs: anchorMs - briefing * MINUTE_MS,
      endMs: flightEnd + d.debriefing * MINUTE_MS,
      flightStartMs: anchorMs,
      flightEndMs: flightEnd,
      resourceId,
      classroomId,
    }
  }

  timesOfSlot(slot: Slot): Times {
    const start = toMs(slot.start)
    const end = toMs(slot.end)
    return {
      startMs: start,
      endMs: end,
      flightStartMs: slot.flightStart ? toMs(slot.flightStart) : start,
      flightEndMs: slot.flightEnd ? toMs(slot.flightEnd) : end,
      resourceId: slot.resourceId,
      classroomId: slot.classroomId,
    }
  }

  /**
   * Egy döntésben rögzített hely ideje az igény jelenlegi időtartamaival. A döntés a repülés
   * (elméletnél az óra) kezdetét rögzíti; ha azóta a feladat vagy az időtartam változott
   * (például 2 órásról másfél órásra), a foglalás vége és a briefing kezdete ehhez igazodik,
   * nem a döntéskori hosszt tartja meg. A motorpróbát a `withRunUp` teszi hozzá.
   */
  timesOfDecision(request: BookingRequest, slot: Slot): Times {
    const t = this.timesOfSlot(slot)
    const d = request.durations
    if (request.kind === 'theory') {
      const end = t.startMs + (d.briefing + d.main + d.debriefing) * MINUTE_MS
      return { ...t, endMs: end, flightStartMs: t.startMs, flightEndMs: end }
    }
    const flightEnd = t.flightStartMs + d.main * MINUTE_MS
    return { ...t, startMs: t.flightStartMs - d.briefing * MINUTE_MS, flightEndMs: flightEnd, endMs: flightEnd + d.debriefing * MINUTE_MS }
  }

  /**
   * Rögzítettnek jelölt, a FlightLoggerből még le nem hozott hely ideje (H02). Ha az igény
   * időtartama a rögzítés óta nem változott, a rögzített hely pontosan marad (a briefing a
   * motorpróbát is tartalmazhatja). Ha a feladat vagy az időtartam azóta változott (például 2
   * órásról másfél órásra), a repülés kezdete marad, a hossz az igény mostani időtartamát
   * követi, mint a döntéseknél (`timesOfDecision`).
   */
  timesOfRecorded(request: BookingRequest, slot: Slot): Times {
    const t = this.timesOfSlot(slot)
    // A csapattag helye a csapat elrendezéséből jött: pontosan marad (KBR-01).
    if (this.#teamOf.has(request.id)) return t
    const d = request.durations
    const minutes = (ms: number): number => Math.round(ms / MINUTE_MS)
    if (request.kind === 'theory') {
      return minutes(t.endMs - t.startMs) === d.briefing + d.main + d.debriefing ? t : this.timesOfDecision(request, slot)
    }
    const runUp = t.resourceId ? this.resource(t.resourceId).engineRunUpMinutes : 0
    const briefing = minutes(t.flightStartMs - t.startMs)
    const same =
      minutes(t.flightEndMs - t.flightStartMs) === d.main &&
      minutes(t.endMs - t.flightEndMs) === d.debriefing &&
      (briefing === d.briefing || briefing === d.briefing + runUp)
    return same ? t : this.withRunUp(request, this.timesOfDecision(request, slot))
  }

  slotOf(t: Times, request: BookingRequest): Slot {
    return {
      start: toIso(t.startMs),
      end: toIso(t.endMs),
      ...(request.kind === 'theory' ? {} : { flightStart: toIso(t.flightStartMs), flightEnd: toIso(t.flightEndMs) }),
      ...(t.resourceId ? { resourceId: t.resourceId } : {}),
      ...(t.classroomId ? { classroomId: t.classroomId } : {}),
    }
  }

  // ---------- kiértékelés ----------

  /**
   * NOV-04: preferált gép vagy típus. Ha a gép nem preferált, de egy preferált géppel azonos
   * típusú, az „azonos típus” (közel olyan jó, mint a preferált).
   */
  familiarity(student: EffectiveStudent | undefined, resourceId: string): Familiarity {
    const prefs = student?.preferredResources ?? []
    if (prefs.length === 0) return 'noPreference'
    const aircraft = this.snapshot.fleet.find((a) => a.id === resourceId)
    if (!aircraft) return 'other'
    if (prefs.some((ref) => matchesRef(ref, aircraft))) return 'preferred'
    const preferredTypes = new Set(
      prefs.map((ref) => ('aircraftType' in ref ? ref.aircraftType : this.snapshot.fleet.find((a) => a.id === ref.aircraftId)?.model)).filter((m): m is string => m !== undefined),
    )
    return preferredTypes.has(aircraft.model) ? 'sameType' : 'other'
  }

  #daysSinceLastFlight(studentId: string, date: LocalDate, beforeMs: number, requestId: string): number | undefined {
    // Ha a héten már van korábbi repülése, attól számítunk (a sürgősség megszűnik).
    let latest: number | undefined
    for (const fs of this.#futureFlightsByStudent.get(studentId) ?? []) {
      if (fs < beforeMs) latest = Math.max(latest ?? 0, fs)
    }
    for (const p of this.#placements) {
      if (p.standby || p.request.kind !== 'flight' || p.request.id === requestId || !p.request.studentIds.includes(studentId)) continue
      if (p.times.flightStartMs < beforeMs) latest = Math.max(latest ?? 0, p.times.flightStartMs)
    }
    if (latest !== undefined) return daysBetween(localParts(latest, this.tz).date, date)
    if (!Object.hasOwn(this.snapshot.lastFlightAt, studentId)) return undefined
    const last = this.snapshot.lastFlightAt[studentId]
    if (last === null || last === undefined) return Number.POSITIVE_INFINITY
    return daysBetween(localParts(toMs(last), this.tz).date, this.today)
  }

  #dayOrderOffset(student: EffectiveStudent | undefined, date: LocalDate, flightStartMs: number, requestId: string): number | undefined {
    if (student?.dayOrder === undefined) return undefined
    const others: Array<{ order: number | undefined; start: number }> = (this.#ownFlightsByDay.get(date) ?? []).map((o) => ({
      order: o.studentId ? this.#students.get(o.studentId)?.dayOrder : undefined,
      start: o.start,
    }))
    for (const p of this.#placements) {
      if (p.standby || p.request.kind === 'theory' || p.request.id === requestId) continue
      if (localParts(p.times.flightStartMs, this.tz).date !== date) continue
      const sid = p.request.studentIds[0]
      others.push({ order: sid ? this.#students.get(sid)?.dayOrder : undefined, start: p.times.flightStartMs })
    }
    const expected = others.filter((o) => o.order !== undefined && o.order < student.dayOrder!).length
    const actual = others.filter((o) => o.start < flightStartMs).length
    return actual - expected
  }

  #availabilityIssue(userId: string, startMs: number, endMs: number): string | undefined {
    const events = this.snapshot.availabilities[userId]
    if (!events || events.length === 0) return undefined
    for (const e of events) {
      if (e.unavailable && overlaps(startMs, endMs, toMs(e.start), toMs(e.end))) return 'nem elérhetőnek jelölt időszak'
    }
    const available = this.#availableSpans(userId)
    if (available.length === 0) return undefined
    const inside = available.some((e) => e.start <= startMs && endMs <= e.end)
    return inside ? undefined : 'a ráérésén kívül'
  }

  readonly #availableCache = new Map<string, ReadonlyArray<{ start: number; end: number }>>()

  /** A ráérési sávok összevonva: az érintkező és átfedő sávok egy sávnak számítanak (H10). */
  #availableSpans(userId: string): ReadonlyArray<{ start: number; end: number }> {
    let spans = this.#availableCache.get(userId)
    if (spans) return spans
    const sorted = (this.snapshot.availabilities[userId] ?? [])
      .filter((e) => !e.unavailable)
      .map((e) => ({ start: toMs(e.start), end: toMs(e.end) }))
      .sort((a, b) => a.start - b.start)
    const merged: Array<{ start: number; end: number }> = []
    for (const s of sorted) {
      const last = merged[merged.length - 1]
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end)
      else merged.push({ ...s })
    }
    spans = merged
    this.#availableCache.set(userId, spans)
    return spans
  }

  /**
   * Egy jelölt hely teljes kiértékelése. `normal` módban kizáró sértésnél `undefined`: ilyenkor
   * az olcsó vizsgálatok után azonnal kilép, a limiteket és a karbantartást nem számolja (H04).
   */
  evaluate(request: BookingRequest, times: Times, mode: EvaluationMode, options: EvaluateOptions = {}): Evaluation | undefined {
    return this.#evaluate(request, times, mode, options, true)
  }

  /** A limit-figyelmeztetések (LIM-01–06): túllépés csak jóváhagyással. */
  #limitWarnings(request: BookingRequest, t: Times): { warnings: PlanWarning[]; exceeded: boolean } {
    const warnings: PlanWarning[] = []
    let exceeded = false
    const activity = this.activityOf(request, t)
    const report = (rules: readonly LimitRule[], c: { ruleId: string; value: number; limit: number; status: 'ok' | 'approach' | 'exceeded' }): void => {
      const rule = rules.find((r) => r.id === c.ruleId)
      warnings.push({ kind: c.status === 'exceeded' ? 'limitExceeded' : 'limitApproach', message: limitMessage(rule, c.ruleId, c.value, c.limit, c.status), requestId: request.id, ruleId: c.ruleId })
      if (c.status === 'exceeded') exceeded = true
    }
    const instructorRules = this.settings.limits.rules
    for (const c of checkLimitsWith(instructorRules, 'instructor', this.#instructorLedger, activity, this.horizonEnd)) report(instructorRules, c)
    for (const id of request.studentIds) {
      const ledger = this.#studentLedgers.get(id) ?? new LimitLedger([])
      const rules = this.#studentRules(id)
      for (const c of checkLimitsWith(rules, 'student', ledger, activity, this.horizonEnd)) report(rules, c)
    }
    return { warnings, exceeded }
  }

  // ---------- jelöltek gyorsítótára (H04) ----------
  // A mohó kör minden elhelyezés után minden hátralévő igény minden jelöltjét újra megnézi.
  // Egy elhelyezés csak az azonos napra, gépre (teremre) vagy növendékre eső jelölteket
  // érinti; a többi eredménye megtartható. A limitek több napra nyúlnak, ezért azokat minden
  // körben frissen számoljuk. A változásokat verziószámok jelzik.
  readonly #versions = { date: new Map<string, number>(), place: new Map<string, number>(), student: new Map<string, number>() }
  #limitsVersion = 0
  readonly #limitCache = new Map<string, { warnings: PlanWarning[]; exceeded: boolean }>()
  #limitCacheVersion = -1
  /** Igényenként, géppenként (teremenként), a repülés kezdete szerint. */
  readonly #candidateCache = new Map<string, Map<string, Map<number, { readonly dv: number; readonly pv: number; readonly sv: number; readonly startMs: number; readonly endMs: number; readonly base: Evaluation | undefined; lv: number; full: Evaluation | undefined }>>>()

  #bump(p: Placement): void {
    const inc = (map: Map<string, number>, key: string): void => {
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    inc(this.#versions.date, localParts(p.times.startMs, this.tz).date)
    if (p.times.resourceId) inc(this.#versions.place, p.times.resourceId)
    if (p.times.classroomId) inc(this.#versions.place, p.times.classroomId)
    for (const id of p.request.studentIds) inc(this.#versions.student, id)
    this.#limitsVersion++
  }

  /**
   * Jelölt kiértékelése `normal` módban, gyorsítótárral. Ugyanazt adja, mint az
   * `evaluate(…, 'normal')`, csak a változatlan jelölteket nem számolja újra.
   */
  evaluateCandidate(request: BookingRequest, times: Times): Evaluation | undefined {
    let byPlace = this.#candidateCache.get(request.id)
    if (!byPlace) this.#candidateCache.set(request.id, (byPlace = new Map()))
    const placeKey = times.resourceId ?? times.classroomId ?? ''
    let byStart = byPlace.get(placeKey)
    if (!byStart) byPlace.set(placeKey, (byStart = new Map()))
    const v = this.#versions
    const dv = v.date.get(localParts(times.startMs, this.tz).date) ?? 0
    const pv = (times.resourceId ? (v.place.get(times.resourceId) ?? 0) : 0) + (times.classroomId ? (v.place.get(times.classroomId) ?? 0) : 0)
    let sv = 0
    for (const id of request.studentIds) sv += v.student.get(id) ?? 0
    let hit = byStart.get(times.flightStartMs)
    if (!hit || hit.dv !== dv || hit.pv !== pv || hit.sv !== sv || hit.startMs !== times.startMs || hit.endMs !== times.endMs) {
      hit = { dv, pv, sv, startMs: times.startMs, endMs: times.endMs, base: this.#evaluate(request, times, 'normal', {}, false), lv: -1, full: undefined }
      byStart.set(times.flightStartMs, hit)
    }
    if (!hit.base) return undefined
    if (hit.lv !== this.#limitsVersion) {
      // A limit csak az időponttól függ, a géptől nem: az azonos idejű jelöltek osztoznak rajta.
      if (this.#limitCacheVersion !== this.#limitsVersion) {
        this.#limitCache.clear()
        this.#limitCacheVersion = this.#limitsVersion
      }
      const limitKey = `${request.id}|${times.startMs}|${times.endMs}|${times.flightStartMs}|${times.flightEndMs}`
      let limits = this.#limitCache.get(limitKey)
      if (!limits) this.#limitCache.set(limitKey, (limits = this.#limitWarnings(request, times)))
      const base = hit.base
      hit.full = limits.warnings.length === 0 ? base : { ...base, subScores: { ...base.subScores }, warnings: [...base.warnings, ...limits.warnings], needsApproval: base.needsApproval || limits.exceeded }
      hit.lv = this.#limitsVersion
    }
    return hit.full
  }

  #evaluate(request: BookingRequest, times: Times, mode: EvaluationMode, options: EvaluateOptions, withLimits: boolean): Evaluation | undefined {
    const hard: string[] = []
    const hardCodes: HardCode[] = []
    const hardDetails: Array<{ code: HardCode; message: string }> = []
    const fail = (code: HardCode, message: string): void => {
      hard.push(message)
      hardDetails.push({ code, message })
      if (!hardCodes.includes(code)) hardCodes.push(code)
    }
    const warnings: PlanWarning[] = []
    let needsApproval = false
    let planClash = false
    const warn = (w: PlanWarning, approval: boolean): void => {
      warnings.push(w)
      if (approval) needsApproval = true
    }
    const quick = mode === 'normal'
    const t = times
    const local = localParts(t.startMs, this.tz)
    const date = local.date
    const leadDays = daysBetween(this.today, date)

    if (t.startMs < this.nowMs) fail('past', 'a tervezés pillanata előtti időpont')
    const window = this.windowFor(date)
    const endLocal = localParts(t.endMs, this.tz)
    if (!window) fail('window', 'aznap nincs operáció vagy munkaidő')
    else if (local.minutes < window.start || endLocal.date !== date || endLocal.minutes > window.end) {
      fail('window', 'az operációs időn vagy a munkaidő-ablakon kívül')
    }
    // TRV-02: „csak ezeken belül” – a foglalás kezdete egy megadott időablakba essen.
    if (request.timing?.kind === 'preferred' && request.timing.onlyWithin && !request.timing.windows.some((w) => t.startMs >= toMs(w.start) && t.startMs <= toMs(w.end))) {
      fail('timeWindow', 'a kezdése a megadott időablakokon kívül esik (csak azokon belül helyezhető el)')
    }
    if (quick && hard.length > 0) return undefined
    const blocked = this.blockedPeriodHit(t.startMs, t.endMs)
    if (blocked) fail('blocked', `tiltott időszakra esik (${blocked})`)

    const studentId = request.studentIds[0]
    const student = studentId ? this.#students.get(studentId) : undefined

    // Erőforrás és terem
    if (request.kind !== 'theory') {
      if (!t.resourceId) fail('resource', 'nincs gép megadva')
      else {
        const kind = this.resourceKind(t.resourceId)
        const fleet = this.#fleetEntry(t.resourceId)
        if (!fleet || fleet.disabled) fail('resource', 'a gép inaktív')
        if (request.kind === 'flight' && kind !== 'aircraft') fail('resource', 'repüléshez repülőgép kell')
        if (request.kind === 'simulator' && kind !== 'simulator') fail('resource', 'szimulátor kell')
      }
    } else if (t.classroomId) {
      const capacity = this.settings.classrooms[t.classroomId]?.capacity
      if (capacity !== undefined && capacity < theoryHeadcount(request)) fail('roomSize', 'a terem kicsi')
    }

    // Nappali feladat (SZB-12). Az Open-Meteo napkeltéje és napnyugtája hiányában a repülőtér
    // koordinátáiból számolunk; repülőtér nélkül nappali feladat nem tervezhető (H03).
    if (request.kind === 'flight' && request.daylightOnly) {
      const d = this.#daylight(date)
      if (!d) fail('daylight', 'nappali feladat, de a napkelte és a napnyugta nem ismert (nincs megadva a repülőtér)')
      else if (t.flightStartMs < d.sunrise || t.flightEndMs > d.sunset) fail('daylight', 'nappali feladat sötétben')
    }
    // Éjszakai feladat: maga a repülés az esti polgári szürkület után (vagy a hajnali előtt);
    // a briefing ennél korábban is kezdődhet.
    if (request.kind === 'flight' && !request.daylightOnly) {
      const n = this.#twilight(date)
      const afterDusk = n.dusk !== undefined && t.flightStartMs >= n.dusk
      const beforeDawn = n.dawn !== undefined && t.flightEndMs <= n.dawn
      if ((n.dusk !== undefined || n.dawn !== undefined) && !afterDusk && !beforeDawn) fail('night', 'éjszakai feladat a polgári szürkület előtt')
    }
    if (quick && hard.length > 0) return undefined

    // Ütközések: hosszú foglalás és karbantartás kizáró; más foglalás kettős foglalás (SZB-04).
    // Standby elméletnél a párosított repülés (és maga az elmélet) nem ütközés (H06).
    const ignore = options.ignoreRefs
    const provisional = options.provisionalRunUp === true
    // A csapattársak egymással nem ütköznek: azonos az idejük, és egymás után repülnek (KBR-01).
    const team = this.#teamOf.get(request.id)
    const mateBookings = team !== undefined ? this.#teamBookings.get(team) : undefined
    const mate = (ref: string): boolean => team !== undefined && this.#teamOf.get(ref) === team
    const planned = (key: string, start: number, end: number): boolean =>
      (this.#occupancy.get(key) ?? []).some((iv) => overlaps(start, end, provisional ? (iv.core ?? iv.start) : iv.start, iv.end) && iv.ref !== request.id && !ignore?.has(iv.ref) && !mate(iv.ref))
    const check = (key: string, label: string, code: HardCode, start: number, end: number): void => {
      if (planned(key, start, end)) {
        planClash = true
        fail(code, `ütközik a tervezett foglalással (${label})`)
      }
      for (const iv of this.#conflicts(this.#existing, key, start, end)) {
        if (mateBookings?.has(iv.ref)) continue
        if (iv.hard) fail(code, `${label}: kiesés vagy karbantartás`)
        else warn({ kind: 'doubleBooking', message: `Kettős foglalás: ${label}`, requestId: request.id }, true)
      }
    }
    check('instr', 'oktató', 'instructorBusy', t.startMs, t.endMs)
    for (const id of request.studentIds) check(`stu:${id}`, 'növendék', 'studentBusy', t.startMs, t.endMs)
    // Feladatsorrend (ELS-05): a növendék sorban korábbi feladata előtte, a későbbi utána legyen.
    const sequence = this.#sequenceOf.get(request.id)
    if (sequence) {
      sequence.members.forEach((other, index) => {
        if (index === sequence.index) return
        const o = this.#sequenceTimes(other)
        if (!o) return
        if (index < sequence.index && t.startMs < o.endMs) fail('order', `a növendék sorban korábbi feladata (${this.#shortLabel(o.startMs)}) után kell következnie`)
        if (index > sequence.index && t.endMs > o.startMs) fail('order', `a növendék sorban későbbi feladata (${this.#shortLabel(o.startMs)}) előtt kell lennie`)
      })
    }
    // A gép csak a repülés idejére (és utána a fordulóidőre) foglalt; a briefing és a
    // debriefing alatt más repülhet vele.
    if (t.resourceId) {
      const turnaround = this.resource(t.resourceId).turnaroundMinutes * MINUTE_MS
      check(`res:${t.resourceId}`, 'gép', 'aircraftBusy', t.flightStartMs, t.flightEndMs + turnaround)
    }
    if (t.classroomId) {
      if (planned(`room:${t.classroomId}`, t.startMs, t.endMs)) {
        planClash = true
        fail('roomBusy', 'a terem foglalt (terv)')
      }
      if (this.#conflicts(this.#existing, `room:${t.classroomId}`, t.startMs, t.endMs).length > 0) fail('roomBusy', 'a terem foglalt')
    }
    if (quick && hard.length > 0) return undefined

    // Időjárás (7.4): 0–2 napon belül az iskolai minimumon kívüli óra kizáró
    let weatherRaw: number
    let weatherKnown: boolean
    if (request.kind === 'flight' && studentId) {
      const route = isRouteFlight(request) ? request.route : undefined
      const w = this.flightWeather(studentId, t.flightStartMs, t.flightEndMs, route)
      weatherRaw = w.raw
      weatherKnown = w.known
      const where = (list: readonly string[]): string => (route && list.length > 0 ? ` (${list.join(', ')})` : '')
      if (w.schoolViolated && leadDays <= 2) fail('weather', `az iskolai időjárási minimumon kívül${where(w.schoolViolatedAt)}`)
      if (w.thunder) warn({ kind: 'weatherRisk', message: `Zivatarveszély az előrejelzés szerint (CAPE vagy zivatar-kód)${where(w.thunderAt)}.`, requestId: request.id }, false)
      if (w.missing.length > 0 && w.known) warn({ kind: 'missingData', message: `Nincs előrejelzés az útvonal repülőterére: ${w.missing.join(', ')}.`, requestId: request.id }, false)
    } else {
      weatherRaw = this.flyabilityRaw(t.flightStartMs, t.flightEndMs, requestPriorityOf(this.settings, request))
      weatherKnown = this.#hoursOf(t.flightStartMs, t.flightEndMs).some((h) => this.#weather.has(h))
    }
    if (quick && hard.length > 0) return undefined

    // Gépóra-keret és várható karbantartás (SZB-06): a karbantartásra eső repülés kizáró
    let reserve: number | undefined
    if (request.kind === 'flight' && t.resourceId) {
      const outlook = this.#maintenanceCheck(request, t)
      if (!outlook) {
        warn({ kind: 'staleData', message: 'Nincs megadva a gép kirepülhető ideje.', requestId: request.id }, false)
      } else {
        if (outlook.violation) fail('reserve', outlook.violation)
        reserve = outlook.reserve
      }
    }
    if (quick && hard.length > 0) return undefined

    // Ráérés (SZB-03): figyelmeztetéssel engedhető. Standbynál az oktató a repülés miatt ott van.
    for (const id of mode === 'standby' ? request.studentIds : [this.snapshot.instructorId, ...request.studentIds]) {
      const issue = this.#availabilityIssue(id, t.startMs, t.endMs)
      if (issue) warn({ kind: 'outsideAvailability', message: `Ráérésen kívül: ${id === this.snapshot.instructorId ? 'oktató' : 'növendék'}, ${issue}`, requestId: request.id }, true)
    }

    // Limitek (LIM-01–06): túllépés csak jóváhagyással. A standby a repülés idejét váltja ki.
    if (mode !== 'standby' && withLimits) {
      const limits = this.#limitWarnings(request, t)
      for (const w of limits.warnings) warn(w, w.kind === 'limitExceeded')
    }

    if (hard.length > 0 && mode === 'normal') return undefined
    if (hard.length > 0) {
      warnings.push({ kind: 'hardConstraintOverridden', message: `Kézi felülbírálás: ${hard.join('; ')}`, requestId: request.id })
    }

    // Részpontok
    const subScores: SubScores = {}
    const dayHours = this.instructorHoursOn(date) + (mode === 'standby' ? 0 : (t.endMs - t.startMs) / HOUR_MS)
    subScores.instructorLoad = instructorLoadScore(dayHours)
    // A standby elmélet nem az oktató saját ideje (a repülés helyett tartja), nem nyit szünetet.
    if (mode !== 'standby') subScores.instructorContinuity = continuityScore(this.instructorGapMinutes(date, t.startMs, t.endMs, request.id))
    if (request.kind === 'flight') {
      subScores.weatherFlight = weatherFlightScore(weatherRaw, leadDays)
      const fam = t.resourceId ? this.familiarity(student, t.resourceId) : 'noPreference'
      subScores.preferredAircraft = preferredAircraftScore(fam)
      if (t.resourceId && this.resourceKind(t.resourceId) === 'aircraft') {
        subScores.avoidFirstFlight = avoidFirstFlightScore(this.aircraftFliesOnDay(t.resourceId, t.flightStartMs, request.id))
      }
      if (studentId) {
        const days = this.#daysSinceLastFlight(studentId, date, t.flightStartMs, request.id)
        if (days !== undefined) {
          subScores.longNoFly = longNoFlyScore(days, student?.longNoFlyDays ?? this.settings.defaults.longNoFlyDays, weekdayIndex(date), fam)
        }
      }
      // Megadott óraszám nélkül a gép kevésbé ajánlott (A9): a kerete nem ismert.
      subScores.aircraftReserve = reserve ?? 0.2
    } else {
      subScores.badWeatherFit = badWeatherFitScore(weatherRaw, leadDays)
    }
    if (request.kind !== 'theory') {
      subScores.priority = priorityScore(student?.priority ?? this.settings.defaults.studentPriority)
      subScores.dayOrder = dayOrderScore(this.#dayOrderOffset(student, date, t.flightStartMs, request.id))
      subScores.scarcity = 0
    } else if (t.classroomId) {
      subScores.preferredClassroom = preferredClassroomScore(this.#isPreferredClassroom(request, t.classroomId))
      // Kézzel megadott terem esetén az oktató döntése számít, nem a méret.
      if (!request.preferredClassroomId) {
        subScores.classroomSize = classroomSizeScore(this.settings.classrooms[t.classroomId]?.capacity, this.#smallestFittingCapacity(request))
      }
    }
    const previous = this.snapshot.previousPlan?.[request.id]
    if (this.replanning && previous) {
      const prevStart = toMs(previous.start)
      const prevDate = localParts(prevStart, this.tz).date
      const change =
        prevStart === t.startMs && previous.resourceId === t.resourceId && previous.classroomId === t.classroomId
          ? 'unchanged'
          : prevDate !== date
            ? 'otherDay'
            : Math.abs(prevStart - t.startMs) <= 2 * HOUR_MS
              ? 'sameDayNear'
              : 'sameDayFar'
      subScores.planStability = stabilityScore(change)
    }

    return {
      request,
      times: t,
      date,
      leadDays,
      weatherRaw,
      weatherKnown,
      planClash,
      hardViolations: hard,
      hardCodes,
      hardDetails,
      needsApproval,
      warnings,
      subScores,
      weighted: weigh(subScores, criteriaFor(request.kind, this.replanning), this.settings.weights),
    }
  }

  readonly #fleetById = new Map<string, Snapshot['fleet'][number]>()
  #fleetEntry(id: string): Snapshot['fleet'][number] | undefined {
    if (this.#fleetById.size === 0) for (const a of this.snapshot.fleet) this.#fleetById.set(a.id, a)
    return this.#fleetById.get(id)
  }

  readonly #studentRulesCache = new Map<string, readonly LimitRule[]>()
  /** A növendékre vonatkozó szabályok: a közösek és a képzési fázis szabálya. */
  #studentRules(id: string): readonly LimitRule[] {
    let rules = this.#studentRulesCache.get(id)
    if (!rules) {
      const phaseRule = phaseLimitRule(this.settings.students.find((s) => s.userId === id)?.trainingPhase)
      rules = phaseRule ? [...this.settings.limits.rules, phaseRule] : this.settings.limits.rules
      this.#studentRulesCache.set(id, rules)
    }
    return rules
  }

  readonly #daylightCache = new Map<LocalDate, { readonly sunrise: number; readonly sunset: number } | null>()
  /**
   * Napkelte és napnyugta: az Open-Meteo adata, hiányában a repülőtér koordinátáiból számolva
   * (H03). Repülőtér nélkül `undefined`.
   */
  #daylight(date: LocalDate): { readonly sunrise: number; readonly sunset: number } | undefined {
    let d = this.#daylightCache.get(date)
    if (d === undefined) {
      const known = this.snapshot.daylight[date]
      const a = this.settings.airport
      if (known) d = { sunrise: toMs(known.sunrise), sunset: toMs(known.sunset) }
      else if (a) {
        const e = sunEvents(date, a.latitude, a.longitude, -0.833)
        d = e.rise !== undefined && e.set !== undefined ? { sunrise: e.rise, sunset: e.set } : null
      } else d = null
      this.#daylightCache.set(date, d)
    }
    return d ?? undefined
  }

  readonly #twilightCache = new Map<LocalDate, { readonly dawn?: number; readonly dusk?: number }>()

  /** Polgári szürkület a repülőtéren (a beállított koordinátákból); repülőtér nélkül üres. */
  #twilight(date: LocalDate): { readonly dawn?: number; readonly dusk?: number } {
    let t = this.#twilightCache.get(date)
    if (!t) {
      const a = this.settings.airport
      t = a ? civilTwilight(date, a.latitude, a.longitude) : {}
      this.#twilightCache.set(date, t)
    }
    return t
  }

  setScarcity(e: Evaluation, scarcity: number): void {
    if (e.request.kind === 'theory') return
    e.subScores.scarcity = scarcity
    e.weighted = weigh(e.subScores, criteriaFor(e.request.kind, this.replanning), this.settings.weights)
  }

  /** A legkisebb ismert férőhely, amelybe az elmélet résztvevői beférnek. */
  #smallestFittingCapacity(request: BookingRequest): number | undefined {
    const fitting = this.snapshot.classroomIds
      .map((id) => this.settings.classrooms[id]?.capacity)
      .filter((c): c is number => c !== undefined && c >= theoryHeadcount(request))
    return fitting.length > 0 ? Math.min(...fitting) : undefined
  }

  #isPreferredClassroom(request: BookingRequest, classroomId: string): boolean {
    if (request.preferredClassroomId) return request.preferredClassroomId === classroomId
    const ranks = Object.values(this.settings.classrooms).map((c) => c.preferenceRank)
    if (ranks.length === 0) return true
    return this.settings.classrooms[classroomId]?.preferenceRank === Math.min(...ranks)
  }

  /** A kérés lehetséges erőforrásai (NOV-03) vagy termei (ERF-07). */
  resourcesFor(request: BookingRequest): Array<{ resourceId?: string; classroomId?: string }> {
    if (request.kind === 'theory') {
      return [...this.snapshot.classroomIds]
        .filter((id) => {
          const c = this.settings.classrooms[id]
          return c === undefined || c.capacity >= theoryHeadcount(request)
        })
        .sort()
        .map((classroomId) => ({ classroomId }))
    }
    const wanted: ResourceKind = request.kind === 'flight' ? 'aircraft' : 'simulator'
    const ofKind = this.snapshot.fleet.filter((a) => !a.disabled && this.resourceKind(a.id) === wanted)
    const sid = request.studentIds[0]
    const settingsStudent = this.settings.students.find((s) => s.userId === sid)
    // A preferált gép egyben engedélyezett is (NOV-04).
    const refs = [...(settingsStudent?.allowedResources ?? []), ...(settingsStudent?.preferredResources ?? [])]
    const allowed = ofKind.filter((a) => refs.some((ref) => matchesRef(ref, a)))
    // Szimulátornál, ha a növendéknek nincs engedélyezett szimulátora, bármelyik használható.
    const list = request.kind === 'simulator' && allowed.length === 0 ? ofKind : allowed
    return list.map((a) => a.id).sort().map((resourceId) => ({ resourceId }))
  }

  /**
   * Résekhez igazított kezdőidők a rácson kívül (5 percre kerekítve). A gép csak a repülés
   * idejére és a fordulóidőre foglalt, ezért egy szűk lyukba úgy fér be a repülés, ha
   * közvetlenül egy gépfoglalás után kezdődik, vagy épp a következő előtt ér véget; az oktató
   * és a növendék foglalásainál ugyanez a briefinggel és a debriefinggel számolva.
   */
  gapAnchorsFor(request: BookingRequest, resourceId: string): number[] {
    if (request.kind === 'theory' || request.timing?.kind === 'fixed') return []
    const d = request.durations
    const step = 5 * MINUTE_MS
    const up = (ms: number): number => Math.ceil(ms / step) * step
    const down = (ms: number): number => Math.floor(ms / step) * step
    const weekStart = localToMs(this.weekDays[0]!, 0, this.tz)
    const weekEnd = localToMs(addDays(this.horizonEnd, 1), 0, this.tz)
    const intervals = (key: string): Interval[] => [...(this.#existing.get(key) ?? []), ...(this.#occupancy.get(key) ?? [])]
    const result = new Set<number>()
    // A nap első jelöltje a nyitás + briefing + motorpróba (A5): a rács nélkül akár 25
    // perccel később indulna a nap első repülése.
    if (request.kind === 'flight') {
      const runUp = this.resource(resourceId).engineRunUpMinutes
      for (const date of this.weekDays) {
        const w = date >= this.today ? this.windowFor(date) : undefined
        if (!w) continue
        const m = Math.ceil((w.start + d.briefing + runUp) / 5) * 5
        if (m + d.main + d.debriefing <= w.end) result.add(localToMs(date, m, this.tz))
      }
    }
    const turnaround = this.resource(resourceId).turnaroundMinutes * MINUTE_MS
    for (const iv of intervals(`res:${resourceId}`)) {
      result.add(up(iv.end))
      result.add(down(iv.start - turnaround - d.main * MINUTE_MS))
    }
    for (const key of ['instr', ...request.studentIds.map((id) => `stu:${id}`)]) {
      for (const iv of intervals(key)) {
        result.add(up(iv.end + d.briefing * MINUTE_MS))
        result.add(down(iv.start - (d.main + d.debriefing) * MINUTE_MS))
      }
    }
    return [...result]
      .filter((ms) => ms - d.briefing * MINUTE_MS >= Math.max(this.nowMs, weekStart) && ms < weekEnd)
      .sort((a, b) => a - b)
  }

  /**
   * Miért nincs hely (TRV-16): minden jelöltet kiértékel a kizáró feltételek gyűjtésével,
   * és megszámolja, melyik feltétel hányszor zárta ki a helyet. A legkevesebb akadállyal
   * járó jelöltet is visszaadja, mert az mutatja meg, mi hiányzik a legkevésbé.
   */
  diagnoseNoSlot(request: BookingRequest):
    | { readonly kind: 'noResource' }
    | { readonly kind: 'noTime' }
    | { readonly kind: 'blocked'; readonly checked: number; readonly counts: ReadonlyArray<readonly [HardCode, number]>; readonly closest?: { readonly times: Times; readonly codes: readonly HardCode[]; readonly details: readonly string[] } } {
    const resources = this.resourcesFor(request)
    if (resources.length === 0) return { kind: 'noResource' }
    const base = this.anchorsFor(request)
    if (base.length === 0) return { kind: 'noTime' }
    const counts = new Map<HardCode, number>()
    let checked = 0
    let closest: { times: Times; codes: readonly HardCode[]; details: readonly string[] } | undefined
    const consider = (times: Times, e: Evaluation): void => {
      const codes = e.hardCodes
      if (codes.length === 0 || codes.includes('past')) return
      const better = !closest || severityOf(codes) < severityOf(closest.codes) || (severityOf(codes) === severityOf(closest.codes) && codes.length < closest.codes.length)
      if (better) closest = { times, codes, details: [...new Set(e.hardViolations)] }
    }
    // Éjszakai feladatnál a szürkület vége a munkaidőn kívül is jelölt a kényszerítéshez:
    // inkább túlóra, mint éjszakai feladat nappal.
    const duskAnchors: number[] = []
    if (request.kind === 'flight' && !request.daylightOnly && request.timing?.kind !== 'fixed') {
      for (const date of this.weekDays) {
        const dusk = date >= this.today ? this.#twilight(date).dusk : undefined
        if (dusk === undefined) continue
        const anchor = Math.ceil(dusk / (5 * MINUTE_MS)) * 5 * MINUTE_MS
        if (anchor - request.durations.briefing * MINUTE_MS >= this.nowMs) duskAnchors.push(anchor)
      }
    }
    for (const r of resources) {
      const anchors = r.resourceId ? [...new Set([...base, ...this.gapAnchorsFor(request, r.resourceId)])].sort((a, b) => a - b) : base
      for (const anchor of anchors) {
        const times = this.timesAt(request, anchor, r.resourceId, r.classroomId)
        const e = this.evaluate(request, times, 'forced')
        if (!e) continue
        checked++
        for (const c of e.hardCodes) counts.set(c, (counts.get(c) ?? 0) + 1)
        consider(times, e)
      }
      for (const anchor of duskAnchors) {
        if (anchors.includes(anchor)) continue
        const times = this.timesAt(request, anchor, r.resourceId, r.classroomId)
        const e = this.evaluate(request, times, 'forced')
        if (e) consider(times, e)
      }
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return { kind: 'blocked', checked, counts: sorted, ...(closest ? { closest } : {}) }
  }

  /** Az esti polgári szürkület vége a napon (éjszakai repülés legkorábbi kezdete), ha ismert. */
  duskOf(date: LocalDate): number | undefined {
    return this.#twilight(date).dusk
  }

  /** Jelölt kezdő időpontok a héten: a rács pontjai az operációs időn belül. */
  anchorsFor(request: BookingRequest): number[] {
    const d = request.durations
    if (request.timing?.kind === 'fixed') {
      return [toMs(request.timing.start) + d.briefing * MINUTE_MS]
    }
    const anchors: number[] = []
    for (const date of this.weekDays) {
      if (date < this.today) continue
      const window = this.windowFor(date)
      if (!window) continue
      const first = Math.ceil((window.start + d.briefing) / this.stepMinutes) * this.stepMinutes
      const minutes: number[] = []
      for (let m = first; m + d.main + d.debriefing <= window.end; m += this.stepMinutes) minutes.push(m)
      // Éjszakai repülésnél a szürkület vége (5 percre felkerekítve) is jelölt: a rács nélkül
      // akár fél órát is várna utána.
      const dusk = request.kind === 'flight' && !request.daylightOnly ? this.#twilight(date).dusk : undefined
      if (dusk !== undefined) {
        const local = localParts(dusk, this.tz)
        const m = Math.ceil(local.minutes / 5) * 5
        if (local.date === date && m - d.briefing >= window.start && m + d.main + d.debriefing <= window.end && !minutes.includes(m)) minutes.push(m)
      }
      for (const m of minutes.sort((a, b) => a - b)) {
        const ms = localToMs(date, m, this.tz)
        if (ms - d.briefing * MINUTE_MS >= this.nowMs) anchors.push(ms)
      }
    }
    return anchors
  }
}
