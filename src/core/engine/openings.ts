import { effectiveStudent } from '../config/operations'
import { defaultFlightRequest, setRequestTask } from '../draft/weekPlan'
import type { BookingRequest, PlanResult, Slot } from '../model/planning'
import { assignAutomaticLectures, lectureSequences, newFlightRequest, takenLectureIds } from '../progress/autoAssign'
import { suggestNextLecture, type LectureInfo, type StudentProgress } from '../progress/lectures'
import { addDays, localParts, localToMs, MINUTE_MS, toIso, toMs } from '../time/zoned'
import { withoutSuperseded } from './bookingLink'
import { PlanningContext, type Evaluation } from './context'
import { deferredRequestIds, plan, type PlanInput } from './plan'
import { trialPlan, withoutDeferral, withRequests, type TrialResult } from './trial'
import { WATCH_NOTICE_MINUTES, WATCH_RESTORE_DAYS, watchWeek, weatherOf, type WatchCapacity, type WatchOptions, type WatchWeather, type WeekWatch } from './weekWatch'

/**
 * Helykeresés (KIT-01–03): a kiszámolt terv mellett melyik növendék melyik feladata fér még be a
 * héten. A lista gyors: egyetlen tervezési kontextus a terv helyeivel (mint a dilemma-térképnél),
 * és igényenként azt nézi, van-e tiszta hely – kizáró feltétel és jóváhagyást kérő figyelmeztetés
 * nélkül, repülésnél nem repülhetetlen időben, legalább `WATCH_NOTICE_MINUTES` múlva. A növendéki
 * és az oktatói limitek a szokásos módon számítanak. Hogy a felvétel ténylegesen mit tenne a
 * tervvel, azt a kiválasztott lehetőségre a próbaszámolás mondja meg (`trialPlan`, KIT-04).
 *
 * A plusz igény a beállított kitöltő elsőbbséggel kerül be (ELS-01), így csak a nála nem
 * fontosabb igényekkel versenyez: a kézi igények helyéhez képest a gyors lista pontos.
 *
 * Lehetőségek növendékenként:
 * - halasztott igénynél csak annak visszahozása (KIT-03; a H07 szerint zárolt halasztásnál a
 *   növendék kimarad). A visszahozott igény a saját elsőbbségével kerül vissza, ezért erről a
 *   teljes próbaszámolás dönt;
 * - különben az, amit a Heti igényeken a növendékre kattintás felvenne (alapból „Automatikus”, a
 *   feladatkiosztás szerinti feladattal, ELS-05), aztán a következő néhány feladat kézzel
 *   választva, amelyet nem tart más igény, nem teljesített és nincs lefoglalva, végül a „feladat
 *   nélkül”.
 * Elmélet nincs a listán. Tiszta függvény.
 */

export type OpeningKind = 'restore' | 'default' | 'lecture' | 'none'

export interface Opening {
  /** Növendéken belül egyedi kulcs. */
  readonly key: string
  readonly kind: OpeningKind
  /** A felveendő (vagy visszahozandó) igény a feladatkiosztás után, ahogy a tervbe kerülne. */
  readonly request: BookingRequest
  /** Tájékoztatásul a legjobb tiszta hely (a motor máshová is teheti). */
  readonly best: Slot
  /** Repülésnél a legjobb hely ideje: repülhető, bizonytalan, vagy még nincs előrejelzés. */
  readonly weather?: WatchWeather
  /** A terv bemenete ezzel a lehetőséggel: a próbaszámoláshoz (`trialPlan`) és a felvételhez. */
  readonly next: PlanInput
  /**
   * Visszahozásnál a teljes próbaszámolás (mint a hét közbeni figyelésben): a halasztott igény a
   * saját elsőbbségével kerül vissza, ezért átrendezheti a tervet; a lista ezt is megtalálja.
   */
  readonly trial?: TrialResult
}

export interface StudentOpenings {
  readonly studentId: string
  /** Nincs megadott ráérés: a motor szabadnak veszi, ezért mindenhová „befér” (A6). */
  readonly missingAvailability: boolean
  readonly options: readonly Opening[]
}

export interface OpeningsInput {
  /** A terv bemenete (a feladatkiosztás utáni igényekkel és a feladatsorrenddel). */
  readonly input: PlanInput
  /** A bemenet kiszámolt terve. */
  readonly result: PlanResult
  readonly catalog: Readonly<Record<string, LectureInfo>>
  readonly progressFor: (studentId: string) => StudentProgress | undefined
  /** Hány napra előre (a hét közbeni figyelésben 2); alapból a hét végéig. */
  readonly days?: number
  /** Kimaradó növendékek (például akinek a visszahozását elutasították). */
  readonly excludeStudents?: ReadonlySet<string>
  /** Nem visszahozható halasztások (H07): a növendékük kimarad. */
  readonly restoreLocked?: ReadonlySet<string>
  /** Legfeljebb ennyi kézzel választható feladat növendékenként (alapból 5). */
  readonly maxLectures?: number
  /** Az új igény azonosítója; a felvétel ugyanezzel történik, így a próba és a terv egyezik. */
  readonly newId?: (studentId: string, key: string) => string
}

/** Időjárás rangsora a legjobb hely választásához: a repülhető előbb. */
const WEATHER_RANK: Readonly<Record<WatchWeather, number>> = { flyable: 0, marginal: 1, unknown: 1, unflyable: 9 }

/** Az igény alakja: az azonos alakú (és a sorrendhez egyformán tartozó) igényeknek ugyanott van helyük. */
const shapeOf = (r: BookingRequest, inSequence: boolean): string =>
  JSON.stringify([r.studentIds, r.kind, r.durations, r.daylightOnly, r.route ?? null, inSequence ? r.id : null])

export function findOpenings(o: OpeningsInput): StudentOpenings[] {
  const { input, result } = o
  const settings = input.settings
  const snapshot = withoutSuperseded(input.snapshot, result.supersededBookings)
  const fillPriority = settings.defaults.fillRequestPriority
  // Az új igény azonosítója nem eshet egybe meglévővel (például egy korábban felvett plusz igényével).
  const used = new Set(input.requests.map((r) => r.id))
  const proposeId = o.newId ?? ((studentId: string, key: string) => `plusz-${studentId}-${key}`)
  const newId = (studentId: string, key: string): string => {
    const base = proposeId(studentId, key)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
  const nowMs = Date.parse(input.snapshot.generatedAt)

  // A FlightLoggerben lefoglalt igények a foglalásuk feladatát tartják (mint a feladatkiosztásban).
  const byId = new Map(input.requests.map((r) => [r.id, r]))
  const linked = new Map<string, string | undefined>()
  for (const l of [...result.recordedInFlightLogger, ...result.plannedMoves, ...result.plannedCancels]) linked.set(l.requestId, byId.get(l.requestId)?.lectureId)
  // Csak a feladatkiosztás fut újra (a meglévő igényeket csak az elsőbbség miatti feladatcsere
  // érinti); az új igény a beállításokból és a feladatból kapja az idejét, mint a kézi felvételnél.
  const prepare = (requests: readonly BookingRequest[]): BookingRequest[] =>
    assignAutomaticLectures({ settings, requests, catalog: o.catalog, progressFor: o.progressFor, bookings: input.snapshot.bookings, nowMs, linked })
  const sequencesOf = (requests: readonly BookingRequest[]): string[][] => lectureSequences({ settings, requests, catalog: o.catalog, progressFor: o.progressFor })

  // A lehetőségek: növendékenként a felvétel (vagy visszahozás) utáni bemenettel.
  const deferred = deferredRequestIds(input)
  const candidates: Array<{ studentId: string; option: Omit<Opening, 'best' | 'weather'> }> = []
  for (const st of settings.students) {
    const studentId = st.userId
    if (o.excludeStudents?.has(studentId)) continue
    const own = input.requests.filter((r) => r.kind !== 'theory' && r.studentIds.includes(studentId))
    const waiting = own.filter((r) => deferred.has(r.id))
    if (waiting.length > 0) {
      // KIT-03: új igény helyett a halasztott visszahozása; zárolt halasztásnál semmi.
      if (waiting.some((r) => o.restoreLocked?.has(r.id))) continue
      for (const r of waiting) candidates.push({ studentId, option: { key: `restore:${r.id}`, kind: 'restore', request: r, next: withoutDeferral(input, r.id) } })
      continue
    }
    const progress = o.progressFor(studentId)
    const taken = takenLectureIds({ studentId, requests: input.requests, progress, catalog: o.catalog, bookings: input.snapshot.bookings, nowMs })
    const add = (key: string, kind: OpeningKind, raw: BookingRequest): BookingRequest => {
      const requests = prepare([...input.requests, { ...raw, priority: fillPriority }])
      const request = requests[requests.length - 1]!
      candidates.push({ studentId, option: { key, kind, request, next: withRequests(input, requests, sequencesOf(requests)) } })
      return request
    }
    // Amit a növendékre kattintás felvenne (a Heti igények „+ Igény” gombja), a kitöltő elsőbbséggel.
    const first = add('default', 'default', newFlightRequest({ settings, studentId, id: newId(studentId, 'default'), taken, progress, catalog: o.catalog }))
    if (first.lectureId) taken.add(first.lectureId)
    for (let i = 0; i < (o.maxLectures ?? 5); i++) {
      const lecture = suggestNextLecture(progress, o.catalog, taken)
      if (!lecture) break
      taken.add(lecture.id)
      const base = defaultFlightRequest(settings, studentId, newId(studentId, `lecture-${lecture.id}`))
      add(`lecture:${lecture.id}`, 'lecture', setRequestTask(settings, base, { mode: 'manual', lecture }))
    }
    if (first.lectureId) {
      const base = defaultFlightRequest(settings, studentId, newId(studentId, 'none'))
      add('none', 'none', setRequestTask(settings, base, { mode: 'none' }))
    }
  }

  // Egyetlen kontextus a terv helyeivel; a sorrend a lehetőségekkel bővítve (ugyanaz a növendék
  // egyszerre csak egy automatikus lehetőséget kaphat, ezért a sorok nem zavarják egymást).
  const all = [...input.requests, ...candidates.map((c) => c.option.request).filter((r) => !byId.has(r.id))]
  const ctx = new PlanningContext(snapshot, settings, input.requests, input.options ?? {})
  const sequences = sequencesOf(prepare(all))
  ctx.setSequences(sequences, result.recordedInFlightLogger)
  for (const p of result.proposals) {
    const r = byId.get(p.requestId)
    if (r) ctx.place({ request: r, times: ctx.timesOfSlot(p.slot), standby: p.standby, ...(p.pairedRequestId ? { pairedRequestId: p.pairedRequestId } : {}) })
  }
  const inSequence = new Set(sequences.flat())

  const fromMs = ctx.nowMs + WATCH_NOTICE_MINUTES * MINUTE_MS
  const weekEndMs = localToMs(addDays(input.snapshot.weekStart, 7), 0, ctx.tz)
  const untilMs = o.days !== undefined ? Math.min(weekEndMs, ctx.nowMs + o.days * 24 * 60 * MINUTE_MS) : weekEndMs

  /** Az igény legjobb tiszta helye az időtávon belül (repülésnél a repülhető idő előbb). */
  const cache = new Map<string, { evaluation: Evaluation; weather?: WatchWeather } | null>()
  const bestOf = (request: BookingRequest): { evaluation: Evaluation; weather?: WatchWeather } | undefined => {
    const key = shapeOf(request, inSequence.has(request.id))
    const known = cache.get(key)
    if (known !== undefined) return known ?? undefined
    let best: { evaluation: Evaluation; weather?: WatchWeather } | undefined
    const anchors = ctx.anchorsFor(request)
    for (const r of ctx.resourcesFor(request)) {
      const list = r.resourceId ? [...new Set([...anchors, ...ctx.gapAnchorsFor(request, r.resourceId)])] : anchors
      for (const anchor of list) {
        const times = ctx.timesAt(request, anchor, r.resourceId, r.classroomId)
        if (times.startMs < fromMs || times.startMs >= untilMs) continue
        const e = ctx.evaluateCandidate(request, times)
        if (!e || e.needsApproval) continue
        const weather = weatherOf(e)
        if (weather === 'unflyable') continue
        const rank = WEATHER_RANK[weather ?? 'flyable']
        const bestRank = best ? WEATHER_RANK[best.weather ?? 'flyable'] : Number.POSITIVE_INFINITY
        if (!best || rank < bestRank || (rank === bestRank && (e.weighted.score > best.evaluation.weighted.score || (e.weighted.score === best.evaluation.weighted.score && e.times.startMs < best.evaluation.times.startMs)))) {
          best = { evaluation: e, ...(weather ? { weather } : {}) }
        }
      }
    }
    cache.set(key, best ?? null)
    return best
  }

  const byStudent = new Map<string, Opening[]>()
  const push = (studentId: string, opening: Opening): void => {
    byStudent.set(studentId, [...(byStudent.get(studentId) ?? []), opening])
  }
  for (const { studentId, option } of candidates) {
    if (option.kind === 'restore') {
      // A visszahozott igény a saját elsőbbségével versenyez: a gyors lista nem elég, a teljes
      // próba dönt (ugyanúgy, mint a hét közbeni figyelés visszahozásánál, KIT-08).
      const trial = trialPlan({ input, result }, option.next, option.request.id)
      const placed = trial.placed
      if (!placed || toMs(placed.slot.start) < fromMs || toMs(placed.slot.start) >= untilMs) continue
      const e = ctx.evaluate(option.request, ctx.timesOfSlot(placed.slot), 'forced')
      const weather = e ? weatherOf(e) : undefined
      if (weather === 'unflyable') continue
      push(studentId, { ...option, best: placed.slot, trial, ...(weather ? { weather } : {}) })
      continue
    }
    const found = bestOf(option.request)
    if (!found) continue
    push(studentId, { ...option, best: ctx.slotOf(found.evaluation.times, option.request), ...(found.weather ? { weather: found.weather } : {}) })
  }

  // Sorrend: aki régebben repült (vagy még soha), aztán a magasabb foglalási prioritás (NOV-12);
  // a ráérés nélküliek a végén.
  const sinceLast = (id: string): number => {
    const last = input.snapshot.lastFlightAt[id]
    return last === null ? Number.POSITIVE_INFINITY : last === undefined ? -1 : nowMs - toMs(last)
  }
  const priority = (id: string): number => {
    const st = settings.students.find((s) => s.userId === id)
    return st ? effectiveStudent(settings, st).priority : settings.defaults.studentPriority
  }
  const missing = (id: string): boolean => (input.snapshot.availabilities[id] ?? []).length === 0
  return [...byStudent]
    .map(([studentId, options]) => ({ studentId, missingAvailability: missing(studentId), options }))
    .sort((a, b) => Number(a.missingAvailability) - Number(b.missingAvailability) || sinceLast(b.studentId) - sinceLast(a.studentId) || priority(b.studentId) - priority(a.studentId) || a.studentId.localeCompare(b.studentId))
}


/** A „van még hely” jelzés napi elutasításának azonosítója a figyelés elutasításai között (KIT-07). */
export const CAPACITY_DISMISSAL_ID = 'van-meg-hely'

/**
 * Hét közbeni figyelés a „van még hely” kereséssel (KIT-07). Előbb a megszokott figyelés készül
 * (a visszahozási javaslatok egymástól függetlenül), utána egy tervezés, amelyben minden
 * visszahozható halasztott igény a javasolt helyén van, és erre fut a helykeresés a következő
 * `WATCH_RESTORE_DAYS` napra. Csak a gyors keresés fut; próbaszámolás csak kattintásra.
 */
export function watchWithCapacity(input: PlanInput, base: PlanResult, options: WatchOptions = {}): WeekWatch {
  const watch = watchWeek(input, base, options)
  if (!options.capacity) return watch
  const capacity = watchCapacity(input, base, watch, options)
  return capacity ? { ...watch, capacity } : watch
}

export function watchCapacity(input: PlanInput, base: PlanResult, watch: WeekWatch, options: WatchOptions): WatchCapacity | undefined {
  const data = options.capacity
  if (!data) return undefined
  const tz = input.snapshot.timezone
  const nowMs = Date.parse(input.options?.now ?? input.snapshot.generatedAt)
  const dismissFrom = toIso(localToMs(localParts(nowMs, tz).date, 0, tz))
  // „Most nem”: aznapra nem szól újra.
  if ((options.dismissals ?? []).some((d) => d.kind === 'capacity' && d.from !== undefined && toMs(d.from) === toMs(dismissFrom))) return undefined

  // A visszahozható halasztott igények a javasolt helyükön (mintha elfogadták volna őket).
  const restores = watch.items.filter((i) => i.kind === 'restore')
  const restored = new Set(restores.map((r) => r.requestId))
  const adjusted: PlanInput =
    restores.length === 0
      ? input
      : {
          ...input,
          decisions: [
            ...input.decisions.filter((d) => !(restored.has(d.requestId) && (d.kind === 'defer' || d.kind === 'assign'))),
            ...restores.map((r) => ({ kind: 'assign' as const, requestId: r.requestId, slot: r.to, acceptWarnings: false })),
          ],
        }
  const result = restores.length === 0 ? base : plan(adjusted)
  // Akinek továbbra is halasztott igénye van, annál a visszahozás a kérdés, nem a plusz igény
  // (KIT-03); a teljes próbát a figyelés nem futtatja.
  const stillDeferred = deferredRequestIds(adjusted)
  const excludeStudents = new Set(adjusted.requests.filter((r) => stillDeferred.has(r.id)).flatMap((r) => r.studentIds))
  const found = findOpenings({
    input: adjusted,
    result,
    catalog: data.catalog,
    progressFor: (id) => data.progress[id],
    days: WATCH_RESTORE_DAYS,
    excludeStudents,
    ...(options.noRestore ? { restoreLocked: new Set(options.noRestore) } : {}),
  })
  // A megadott ráérés nélküli növendék mindig „beférne” (a motor szabadnak veszi): jelzést nem ad,
  // a gombbal megnyitott listán jelölve szerepel.
  const students = found
    .filter((s) => !s.missingAvailability && s.options.length > 0)
    .map((s) => ({
      studentId: s.studentId,
      options: s.options.length,
      first: [...s.options].sort((a, b) => toMs(a.best.start) - toMs(b.best.start))[0]!.best,
    }))
  return students.length > 0 ? { students, days: WATCH_RESTORE_DAYS, dismissFrom } : undefined
}
