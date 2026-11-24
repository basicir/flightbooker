import { z } from 'zod'
import type { Settings } from '../config/schema'
import { effectiveStudent } from '../config/operations'
import type { PlannedChange, RecordedEntry } from '../engine/bookingLink'
import { FL_SESSION_TYPES, type BookingRequest, type BriefingSource, type Decision, type Slot } from '../model/planning'
import type { LocalDate } from '../model/time'
import { requestShapeFromLecture, type LectureInfo } from '../progress/lectures'
import { addDays, daysBetween, weekdayIndex } from '../time/zoned'

/**
 * A heti tervezet (4. fejezet: Tervezet): az igények, az oktatói döntések és a rögzítés
 * állapota. Helyben tárolódik hetenként; név nem kerül bele, csak azonosító.
 * A javaslatokat nem tároljuk: azok mindig a motor újrafuttatásából jönnek.
 */

export const WEEK_PLAN_FORMAT_VERSION = 1

const id = z.string().min(1).max(200)
const iso = z.iso.datetime({ offset: true })
const minutes = z.int().min(0).max(24 * 60)

const slot = z.strictObject({
  start: iso,
  end: iso,
  flightStart: iso.optional(),
  flightEnd: iso.optional(),
  resourceId: id.optional(),
  classroomId: id.optional(),
})

const timeWindow = z.strictObject({ start: iso, end: iso }).refine((w) => Date.parse(w.end) >= Date.parse(w.start), { message: 'Az időablak vége nem lehet a kezdete előtt.' })

const timingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixed'), start: iso }),
  z.strictObject({ kind: z.literal('preferred'), windows: z.array(timeWindow).min(1).max(50), onlyWithin: z.boolean().optional() }),
])

/**
 * Korábbi tervezet: a preferált időpont egyetlen kezdés volt (`{ kind: 'preferred', start }`).
 * Ugyanazt jelenti egy nulla hosszú kezdési ablak (TRV-02).
 */
function upgradeLegacyTiming(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  const r = value as { timing?: unknown }
  const t = r.timing as { kind?: unknown; start?: unknown; windows?: unknown } | undefined
  if (!t || t.kind !== 'preferred' || typeof t.start !== 'string' || t.windows !== undefined) return value
  return { ...r, timing: { kind: 'preferred', windows: [{ start: t.start, end: t.start }] } }
}

const BookingRequestObject = z.strictObject({
  id,
  kind: z.enum(['flight', 'simulator', 'theory']),
  studentIds: z.array(id),
  classId: id.optional(),
  lectureId: id.optional(),
  theoryType: z.enum(['groundTraining', 'extraTheory', 'meeting']).optional(),
  flTheory: z
    .strictObject({
      programRevisionId: id.optional(),
      program: z.string().max(300).optional(),
      subjectId: id.optional(),
      subject: z.string().max(300).optional(),
      sessionType: z.enum(FL_SESSION_TYPES).optional(),
      session: z.string().max(300).optional(),
    })
    .optional(),
  taskSelectionMode: z.enum(['automatic', 'manual', 'none']),
  durations: z.strictObject({ briefing: minutes, main: minutes, debriefing: minutes }),
  briefingSource: z.enum(['default', 'lecture', 'manual']).optional(),
  timing: timingSchema.optional(),
  daylightOnly: z.boolean(),
  route: z
    .strictObject({
      departure: z.string().regex(/^[A-Z]{0,4}$/),
      stops: z.array(z.strictObject({ icao: z.string().regex(/^[A-Z]{0,4}$/), elapsedMinutes: z.int().min(1).max(24 * 60).optional() })).max(20),
    })
    .optional(),
  preferredClassroomId: id.optional(),
  briefingTeamId: id.optional(),
  /** Elsőbbség (ELS-01): 1 a legfontosabb; hiányában a beállítások alapértéke. */
  priority: z.int().min(1).max(5).optional(),
  origin: z.enum(['progress', 'manual', 'deferred']),
  deferredFromWeek: z.string().optional(),
  note: z.string().max(500).optional(),
})

export const BookingRequestSchema = z.preprocess(upgradeLegacyTiming, BookingRequestObject)

export const DecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('assign'),
    requestId: id,
    slot,
    acceptWarnings: z.boolean(),
    auto: z.boolean().optional(),
    /** A tervezeten végzett kézi mozgatás (nem dilemma-válasz); a döntésszámláló külön számolja. */
    fromDraft: z.boolean().optional(),
    comment: z.string().max(500).optional(),
    /** Közös briefing csapat elhelyezése (KBR-07): a `slot.start` a közös kezdés. */
    team: id.optional(),
  }),
  z.strictObject({ kind: z.literal('standby'), requestId: id, slot, pairedRequestId: id.optional(), auto: z.boolean().optional(), comment: z.string().max(500).optional() }),
  z.strictObject({ kind: z.literal('defer'), requestId: id, auto: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('noStandby'), requestId: id, auto: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('teamOff'), requestId: id, auto: z.boolean().optional() }),
  z.strictObject({ kind: z.literal('avoidSlot'), requestId: id, slot }),
  z.strictObject({ kind: z.literal('comment'), requestId: id, comment: z.string().max(500) }),
])

/** A rögzítési lista tételállapota (9.6). */
export const RecordingStatusSchema = z.enum(['planned', 'checked', 'recorded', 'different'])
export type RecordingStatus = z.infer<typeof RecordingStatusSchema>

export const WeekPlanSchema = z.strictObject({
  formatVersion: z.literal(WEEK_PLAN_FORMAT_VERSION),
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  selectedStudentIds: z.array(id),
  requests: z.array(BookingRequestSchema),
  decisions: z.array(DecisionSchema),
  recording: z.record(id, RecordingStatusSchema),
  /**
   * A hét közös briefing csapatai (KBR-03, KBR-04): a név a létrehozás sorrendjéből jön, a
   * `manual` a kézi csapatba szervezésé. A tagság az igényeken van (`briefingTeamId`).
   */
  briefingTeams: z.array(z.strictObject({ id, origin: z.enum(['auto', 'manual']), createdAt: iso })).max(1000).optional(),
  /** A legutóbb elfogadott terv helyei, újratervezéshez (TRV-18). */
  previousPlan: z.record(id, slot).optional(),
  /** Mikor fogadta el az oktató a tervet (a `previousPlan` ideje). */
  acceptedAt: iso.optional(),
  /** A „rögzítve” jelölt igények helye a rögzítés pillanatában (H02): addig le van zárva. */
  recordedSlots: z.record(id, slot).optional(),
  /** Mikor jelölte rögzítettnek vagy áthelyezettnek (a frissítésnél régebbi adat ehhez mérve, 9.6). */
  recordedAt: z.record(id, iso).optional(),
  /** A párosított FlightLogger-foglalás azonosítója (az áthelyezett foglalás így is megtalálható). */
  recordedBookings: z.record(id, id).optional(),
  /**
   * FlightLogger-jelölések (9.7): a tervezett igénynek már van FlightLogger-foglalása, amelyet a
   * terv szerinti helyre át kell írni, illetve (halasztásnál) le kell mondani. Nem rögzítés: az
   * igényt a motor ugyanúgy tervezi; a javasolt hely kézi döntésként kerül be.
   */
  flChanges: z
    .record(
      id,
      z.discriminatedUnion('kind', [
        // A `slot` egy korábbi változat maradványa; a hely a döntésekből jön.
        z.strictObject({ kind: z.literal('move'), bookingId: id, slot: slot.optional() }),
        z.strictObject({ kind: z.literal('cancel'), bookingId: id, doneAt: iso.optional() }),
      ]),
    )
    .optional(),
  /** A hét közbeni figyelés elutasított javaslatai („marad így”). */
  watchDismissals: z
    .array(z.strictObject({ requestId: id, kind: z.enum(['improve', 'problem', 'restore', 'missing', 'capacity']), from: iso.optional(), at: iso }))
    .max(1000)
    .optional(),
  /** Helyben gyűjtött mérőszámok a 2. fejezet sikerkritériumaihoz (U10, Q14). */
  metrics: z
    .strictObject({
      openedAt: iso,
      /** A legtöbb egyszerre nyitott dilemma. */
      maxDilemmas: z.int().min(0).max(10_000),
      /** Az első „rögzítve” jelölés ideje: itt ér véget a tervezés. */
      firstRecordedAt: iso.optional(),
    })
    .optional(),
  updatedAt: iso,
})

type WeekPlanData = z.infer<typeof WeekPlanSchema>

/** A tervezet a modell (csak olvasható) típusaival; a séma kimenete ide illeszkedik. */
export type WeekPlan = Omit<WeekPlanData, 'requests' | 'decisions' | 'selectedStudentIds'> & {
  readonly selectedStudentIds: readonly string[]
  readonly requests: readonly BookingRequest[]
  readonly decisions: readonly Decision[]
}

/** A hét hétfője. */
export function mondayOf(date: LocalDate): LocalDate {
  return addDays(date, -weekdayIndex(date))
}

/** Ettől a naptól (hétfő = 0) a következő hét nyílik meg alapból: péntek. */
export const NEXT_WEEK_FROM_WEEKDAY = 4

/**
 * Az alapértelmezett megnyitott hét: hétfőtől csütörtökig az aktuális (hét közben ennek a
 * foglalásai és a figyelés javaslatai a fontosak), péntektől vasárnapig a következő (K19 – a
 * tervezés a hét végén a következő hétre készül). A másik hét a hétválasztóval érhető el.
 */
export function defaultWeekStart(today: LocalDate): LocalDate {
  return addDays(mondayOf(today), weekdayIndex(today) >= NEXT_WEEK_FROM_WEEKDAY ? 7 : 0)
}

/**
 * A hét neve a mai naphoz képest: „ez a hét”, „jövő hét”, „jövő utáni hét”, „múlt hét”,
 * „múlt előtti hét”, távolabb „3 hét múlva” / „3 héttel ezelőtt”.
 */
export function relativeWeekLabel(weekStart: LocalDate, today: LocalDate): string {
  const diff = Math.round(daysBetween(mondayOf(today), mondayOf(weekStart)) / 7)
  if (diff === 0) return 'ez a hét'
  if (diff === 1) return 'jövő hét'
  if (diff === 2) return 'jövő utáni hét'
  if (diff === -1) return 'múlt hét'
  if (diff === -2) return 'múlt előtti hét'
  return diff > 0 ? `${diff} hét múlva` : `${-diff} héttel ezelőtt`
}

let counter = 0
/** Egyedi igény-azonosító; a tesztekben felülírható. */
export function newRequestId(prefix: string, now: number = Date.now()): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}-${now.toString(36)}-${counter.toString(36)}`
}

/**
 * Feladat nélküli repülés fő része percben. A repülési idő feladatfüggő (a Lecture adja),
 * ezért nincs rá globális beállítás; feladat nélkül ez a kiinduló érték, az igénynél átírható.
 */
export const TASKLESS_FLIGHT_MINUTES = 60

/** A feladat nélküli igény időtartamai. */
export function tasklessDurations(settings: Settings): BookingRequest['durations'] {
  return { briefing: settings.defaults.briefingMinutes, main: TASKLESS_FLIGHT_MINUTES, debriefing: settings.defaults.debriefingMinutes }
}

/**
 * A briefing és a debriefing ideje a forrás szerint: alapból a beállítások értéke, „feladat
 * szerint” a feladaté (ha a feladatban nincs megadva, vagy nincs feladat, az alapérték),
 * kézi forrásnál a jelenlegi érték marad.
 */
export function briefingTimes(
  settings: Settings,
  request: BookingRequest,
  lecture: LectureInfo | undefined,
): Pick<BookingRequest['durations'], 'briefing' | 'debriefing'> {
  const source = request.briefingSource ?? 'default'
  if (source === 'manual') return { briefing: request.durations.briefing, debriefing: request.durations.debriefing }
  const fallback = tasklessDurations(settings)
  if (source === 'lecture' && lecture) {
    const shape = requestShapeFromLecture(lecture, fallback)
    return { briefing: shape.durations.briefing, debriefing: shape.durations.debriefing }
  }
  return { briefing: fallback.briefing, debriefing: fallback.debriefing }
}

/**
 * Az igény átállítása egy feladatra: a repülés ideje, a fajta és a nappali jelleg a feladatból
 * (SZB-02); a briefing és a debriefing a választott forrás szerint (alapból a beállításból).
 * A választás módját nem változtatja; feladat nélkül csak a feladat kerül le.
 */
export function applyLecture(settings: Settings, request: BookingRequest, lecture: LectureInfo | undefined): BookingRequest {
  if (!lecture) {
    const { lectureId: _l, ...rest } = request
    return { ...rest, durations: { ...rest.durations, ...briefingTimes(settings, rest, undefined) } }
  }
  const shape = requestShapeFromLecture(lecture, tasklessDurations(settings))
  return {
    ...request,
    lectureId: lecture.id,
    kind: shape.kind,
    durations: { main: shape.durations.main, ...briefingTimes(settings, request, lecture) },
    daylightOnly: shape.daylightOnly,
  }
}

/** A briefing és a debriefing forrásának váltása; az idők a forrás szerint frissülnek. */
export function setBriefingSource(settings: Settings, request: BookingRequest, source: BriefingSource, lecture: LectureInfo | undefined): BookingRequest {
  const next: BookingRequest = { ...request, briefingSource: source }
  return { ...next, durations: { ...next.durations, ...briefingTimes(settings, next, lecture) } }
}

/**
 * A nem kézi forrású repülési és szimulátoros igények briefing- és debriefing-idejét a
 * beállításokhoz és a feladathoz igazítja (például ha az alapérték megváltozik).
 * Változatlan igény ugyanaz az objektum marad.
 */
export function syncBriefingTimes(settings: Settings, requests: readonly BookingRequest[], catalog: Readonly<Record<string, LectureInfo>>): BookingRequest[] {
  return requests.map((r) => {
    if (r.kind === 'theory' || r.briefingSource === 'manual') return r
    const times = briefingTimes(settings, r, r.lectureId ? catalog[r.lectureId] : undefined)
    return times.briefing === r.durations.briefing && times.debriefing === r.durations.debriefing ? r : { ...r, durations: { ...r.durations, ...times } }
  })
}

/**
 * Feladatválasztás egy igénynél (7.5, SZB-02: foglalásonként felülírható):
 * - automatikus: a feladatot a rendszer tartja karban a haladás szerint;
 * - kézi: az oktató által választott feladat marad akkor is, ha a haladás változik;
 * - feladat nélküli: nincs feladat, az időtartam az alapértékből jön.
 */
export function setRequestTask(
  settings: Settings,
  request: BookingRequest,
  choice: { readonly mode: 'automatic' } | { readonly mode: 'none' } | { readonly mode: 'manual'; readonly lecture: LectureInfo },
): BookingRequest {
  if (choice.mode === 'automatic') return { ...request, taskSelectionMode: 'automatic' }
  if (choice.mode === 'manual') return applyLecture(settings, { ...request, taskSelectionMode: 'manual' }, choice.lecture)
  const { lectureId: _l, ...rest } = request
  const durations = { ...tasklessDurations(settings), ...briefingTimes(settings, rest, undefined) }
  return { ...rest, taskSelectionMode: 'none', durations, daylightOnly: request.kind === 'flight' }
}

/**
 * Repülési igény (TRV-21). Ha van javasolt feladat, abból jön az időtartam, a fajta
 * (repülés vagy szimulátor) és a nappali jelleg; különben a feladat nélküli alapértékek.
 */
export function defaultFlightRequest(settings: Settings, studentId: string, id: string, lecture?: LectureInfo): BookingRequest {
  const st = settings.students.find((s) => s.userId === studentId)
  const mode = st ? effectiveStudent(settings, st).taskSelectionMode : settings.planning.taskSelectionMode
  const base: BookingRequest = {
    id,
    kind: 'flight',
    studentIds: [studentId],
    taskSelectionMode: mode,
    durations: tasklessDurations(settings),
    daylightOnly: true,
    origin: 'progress',
  }
  return mode === 'none' || !lecture ? base : applyLecture(settings, base, lecture)
}

/** A korábbi hét halasztott igényei (TRV-17) a következő heti azonosítóval. */
function carriedFrom(previous: WeekPlan | undefined): BookingRequest[] {
  if (!previous) return []
  const deferredIds = new Set(previous.decisions.filter((d) => d.kind === 'defer').map((d) => d.requestId))
  return previous.requests
    .filter((r) => deferredIds.has(r.id))
    .map((r) => {
      // A csapat a hété: a halasztott igény csapat nélkül megy át (KBR-05).
      const { timing: _timing, briefingTeamId: _team, ...rest } = r
      return { ...rest, id: `${r.id}-h`, origin: 'deferred' as const, deferredFromWeek: previous.weekStart }
    })
}

/**
 * Új heti tervezet. A korábbi hét halasztott igényei átkerülnek (TRV-17), új azonosítóval.
 */
export function createWeekPlan(weekStart: LocalDate, nowIso: string, previous?: WeekPlan): WeekPlan {
  const carried = carriedFrom(previous)
  return {
    formatVersion: WEEK_PLAN_FORMAT_VERSION,
    weekStart,
    selectedStudentIds: [...new Set(carried.flatMap((r) => r.studentIds))],
    requests: carried,
    decisions: [],
    recording: {},
    metrics: { openedAt: nowIso, maxDilemmas: 0 },
    updatedAt: nowIso,
  }
}

/**
 * A halasztások szinkronja a hét megnyitásakor (H07): a korábbi héten azóta hozott halasztás
 * is átkerül, a visszavont halasztás másolata pedig kikerül – de csak akkor, ha ezen a héten még
 * nem született róla döntés, és nem rögzítették (különben az oktató munkája veszne el; ilyenkor a
 * visszavonást a korábbi héten nem is engedjük, `lockedCarriedIds`). A növendék, akit csak a
 * kikerült másolat hozott a hétre, a kijelöltek közül is kikerül. Változás nélkül ugyanazt adja.
 */
export function syncDeferred(plan: WeekPlan, previous: WeekPlan | undefined): WeekPlan {
  if (!previous) return plan
  const carried = carriedFrom(previous)
  const carriedIds = new Set(carried.map((r) => r.id))
  const present = new Set(plan.requests.map((r) => r.id))
  // A rögzített másolat is döntésnek számít: az már a FlightLoggerben van.
  const decided = new Set([...plan.decisions.map((d) => d.requestId), ...Object.entries(plan.recording).filter(([, st]) => st === 'recorded').map(([rid]) => rid)])
  const withdrawn = plan.requests.filter((r) => r.origin === 'deferred' && r.deferredFromWeek === previous.weekStart && !carriedIds.has(r.id) && !decided.has(r.id))
  const added = carried.filter((r) => !present.has(r.id))
  if (withdrawn.length === 0 && added.length === 0) return plan
  const drop = new Set(withdrawn.map((r) => r.id))
  const requests = [...plan.requests.filter((r) => !drop.has(r.id)), ...added]
  // Akit csak a visszavont halasztás hozott a hétre, és más igénye nincs, az kikerül a kijelöltek közül.
  const remaining = new Set(requests.flatMap((r) => r.studentIds))
  const leaving = new Set(withdrawn.flatMap((r) => r.studentIds).filter((id) => !remaining.has(id)))
  return {
    ...plan,
    requests,
    selectedStudentIds: [...new Set([...plan.selectedStudentIds.filter((id) => !leaving.has(id)), ...added.flatMap((r) => r.studentIds)])],
  }
}

/**
 * Kézi mozgatás a tervezeten (TRV-10): az igény korábbi elhelyező döntése helyett. A mozgatás
 * a repülés kezdetét rögzíti; a foglalás kezdetét (briefing, motorpróba) a motor számolja (H12).
 */
export function moveRequest(plan: WeekPlan, requestId: string, slot: Slot): WeekPlan {
  const kept = plan.decisions.filter((d) => !(d.requestId === requestId && (d.kind === 'assign' || d.kind === 'defer')))
  return { ...plan, decisions: [...kept, { kind: 'assign', requestId, slot, acceptWarnings: true, fromDraft: true }] }
}

/** A terv elfogadása (TRV-18): a mostani helyek lesznek az újratervezés viszonyítási alapja. */
export function acceptPlan(plan: WeekPlan, proposals: ReadonlyArray<{ readonly requestId: string; readonly slot: Slot; readonly standby: boolean }>, nowIso: string): WeekPlan {
  const previousPlan: Record<string, Slot> = {}
  for (const p of proposals) if (!p.standby) previousPlan[p.requestId] = p.slot
  return { ...plan, previousPlan, acceptedAt: nowIso }
}

/**
 * A rögzítési állapot beállítása (9.6). A „rögzítve” állapot a helyet és az időpontját is
 * elmenti (H02): a motor ezután nem tervezi újra az igényt, a FlightLogger-foglalás
 * megjelenéséig a hely le van zárva. `bookingId`: a már ismert FlightLogger-foglalás (hét közbeni
 * áthelyezésnél a régi helyé, amíg a frissítés le nem hozza az újat). Az igény hét közbeni
 * javaslatainak elutasítása ilyenkor törlődik: új helyzet, új mérlegelés.
 */
export function setRecordingStatus(plan: WeekPlan, requestId: string, status: RecordingStatus, slot: Slot | undefined, nowIso: string, bookingId?: string): WeekPlan {
  const recordedSlots = { ...(plan.recordedSlots ?? {}) }
  const recordedAt = { ...(plan.recordedAt ?? {}) }
  const recordedBookings = { ...(plan.recordedBookings ?? {}) }
  if (status === 'recorded' && slot) {
    recordedSlots[requestId] = slot
    recordedAt[requestId] = nowIso
  } else {
    delete recordedSlots[requestId]
    delete recordedAt[requestId]
  }
  if (status === 'recorded' && slot && bookingId) recordedBookings[requestId] = bookingId
  else delete recordedBookings[requestId]
  const metrics = plan.metrics && status === 'recorded' && !plan.metrics.firstRecordedAt ? { ...plan.metrics, firstRecordedAt: nowIso } : plan.metrics
  const watchDismissals = plan.watchDismissals?.filter((d) => d.requestId !== requestId)
  // Az új rögzítési állapot a tervbe tett FlightLogger-változtatást is lezárja.
  const { [requestId]: _change, ...flChanges } = plan.flChanges ?? {}
  return {
    ...plan,
    ...(plan.flChanges ? { flChanges } : {}),
    recording: { ...plan.recording, [requestId]: status },
    recordedSlots,
    recordedAt,
    recordedBookings,
    ...(watchDismissals ? { watchDismissals } : {}),
    ...(metrics ? { metrics } : {}),
  }
}

/**
 * A motor által párosított FlightLogger-foglalások azonosítójának megjegyzése (csak a rögzített
 * igényeknél): ha a FlightLoggerben áthelyezik, az azonosító alapján is megtalálható. Változás
 * nélkül ugyanazt a tervezetet adja.
 */
export function rememberBookingIds(plan: WeekPlan, links: ReadonlyArray<{ readonly requestId: string; readonly bookingId: string }>): WeekPlan {
  let next: Record<string, string> | undefined
  for (const l of links) {
    if (plan.recording[l.requestId] !== 'recorded' || plan.recordedBookings?.[l.requestId] === l.bookingId) continue
    next ??= { ...(plan.recordedBookings ?? {}) }
    next[l.requestId] = l.bookingId
  }
  return next ? { ...plan, recordedBookings: next } : plan
}

/**
 * Hét közbeni áthelyezés (9. lépés): az oktató a FlightLoggerben áthelyezte a foglalást. Az új
 * hely rögzítettnek számít; amíg a frissítés le nem hozza, a régi hely nem foglal (`bookingId`).
 */
export function markMovedInFlightLogger(plan: WeekPlan, requestId: string, slot: Slot, bookingId: string | undefined, nowIso: string): WeekPlan {
  return setRecordingStatus(plan, requestId, 'recorded', slot, nowIso, bookingId)
}

/** A tervezet egy tervbe tett FlightLogger-változtatásának beállítása vagy törlése. */
function withChange(plan: WeekPlan, requestId: string, change: NonNullable<WeekPlan['flChanges']>[string] | undefined): WeekPlan {
  const { [requestId]: _old, ...rest } = plan.flChanges ?? {}
  const watchDismissals = plan.watchDismissals?.filter((d) => d.requestId !== requestId)
  return { ...plan, flChanges: change ? { ...rest, [requestId]: change } : rest, ...(watchDismissals ? { watchDismissals } : {}) }
}

/**
 * A FlightLoggerben lévő foglalás áthelyezése a foglalási tervbe (9.7): az igény rendes tervezett
 * tétel lesz a javasolt helyen (kézi döntés, amely a hely tisztaságáig áll, H08), és jelölést kap,
 * hogy a FlightLoggerben a meglévő foglalását kell átírni. A motor ezután ugyanúgy tervezi.
 */
export function planMove(plan: WeekPlan, requestId: string, bookingId: string, slot: Slot): WeekPlan {
  const marked = withChange(plan, requestId, { kind: 'move', bookingId })
  const kept = marked.decisions.filter((d) => !(d.requestId === requestId && (d.kind === 'assign' || d.kind === 'defer')))
  return { ...marked, decisions: [...kept, { kind: 'assign', requestId, slot, acceptWarnings: false }] }
}

/** Az igény helyére szóló döntések (elhelyezés, halasztás) törlése. */
const withoutPlacement = (plan: WeekPlan, requestId: string, kinds: ReadonlyArray<Decision['kind']>): WeekPlan => ({
  ...plan,
  decisions: plan.decisions.filter((d) => !(d.requestId === requestId && kinds.includes(d.kind))),
})

/**
 * A FlightLoggerben lévő foglalás lemondása és az igény halasztása a foglalási tervbe (9.7,
 * TRV-17): a halasztás rendes döntés (a következő hét így átveszi), a jelölés szerint a lemondás
 * a rögzítési listán teendő. Az áthelyezésre jelölt igény halasztása is ezt használja.
 */
export function planCancel(plan: WeekPlan, requestId: string, bookingId: string): WeekPlan {
  const changed = withChange(plan, requestId, { kind: 'cancel', bookingId })
  const kept = changed.decisions.filter((d) => !(d.requestId === requestId && (d.kind === 'assign' || d.kind === 'defer' || d.kind === 'standby')))
  return { ...changed, decisions: [...kept, { kind: 'defer', requestId }] }
}

/**
 * A rögzítettnek jelölt, de a FlightLoggerben nem található (lemondott vagy törölt) igény
 * újratervezése (9.6): a rögzítés és a korábbi helydöntések megszűnnek, így a motor a mostani
 * időponttól tervezi újra, nem a régi, esetleg már elmúlt helyére.
 */
export function replanRequest(plan: WeekPlan, requestId: string, nowIso: string): WeekPlan {
  return withoutPlacement(setRecordingStatus(plan, requestId, 'planned', undefined, nowIso), requestId, ['assign', 'defer', 'standby'])
}

/**
 * A foglalástervezőből származó, már a FlightLoggerben lévő (vagy rögzítettnek jelölt) igény
 * halasztása a tervezetről. Ismert FlightLogger-foglalásnál a lemondás a rögzítési listára kerül
 * teendőként ({@link planCancel}); ha a foglalás nem ismert (még nem jött le, vagy már nincs
 * meg), a rögzítés megszűnik és az igény halasztott lesz. Ha mégis foglalva marad, a hét közbeni
 * figyelés jelzi.
 */
export function deferBooked(plan: WeekPlan, requestId: string, bookingId: string | undefined, nowIso: string): WeekPlan {
  if (bookingId) return planCancel(plan, requestId, bookingId)
  const unrecorded = withoutPlacement(setRecordingStatus(plan, requestId, 'planned', undefined, nowIso), requestId, ['assign', 'defer', 'standby'])
  return { ...unrecorded, decisions: [...unrecorded.decisions, { kind: 'defer', requestId }] }
}

/**
 * A jelölés visszavonása: a foglalás marad, ahol a FlightLoggerben van (az áthelyezés kézi
 * döntése, illetve a halasztás is megszűnik).
 */
export function revertChange(plan: WeekPlan, requestId: string): WeekPlan {
  const change = plan.flChanges?.[requestId]
  const reverted = withChange(plan, requestId, undefined)
  if (!change) return reverted
  return withoutPlacement(reverted, requestId, change.kind === 'cancel' ? ['defer'] : ['assign'])
}

/**
 * Az áthelyezést a FlightLoggerben elvégezte: a terv szerinti hely rögzítettnek számít, a
 * jelölés és az elhelyező döntés megszűnik (a rögzítés zárja le a helyet).
 */
export function completeMove(plan: WeekPlan, requestId: string, slot: Slot, nowIso: string, bookingId?: string | null): WeekPlan {
  const change = plan.flChanges?.[requestId]
  if (change?.kind !== 'move') return plan
  // `bookingId`: az új hely foglalása, ha más, mint a régi (null: nem ismert, a frissítés párosítja).
  const id = bookingId === undefined ? change.bookingId : (bookingId ?? undefined)
  return withoutPlacement(markMovedInFlightLogger(plan, requestId, slot, id, nowIso), requestId, ['assign'])
}

/** A tervbe tett lemondást a FlightLoggerben elvégezte: a frissítésig nincs teendő. */
export function markCancelled(plan: WeekPlan, requestId: string, nowIso: string): WeekPlan {
  const change = plan.flChanges?.[requestId]
  if (change?.kind !== 'cancel') return plan
  return withChange(plan, requestId, { ...change, doneAt: nowIso })
}

/**
 * A már elvégzett jelölések lezárása: ahol a terv szerinti hely a FlightLogger-foglalásé (oda
 * írták át, vagy a terv oda tért vissza), az igény ott rögzített; a lemondott foglalás eltűnt, az
 * igény halasztott marad, rögzítés nélkül. Változás nélkül ugyanazt a tervezetet adja.
 */
export function applyCompletedChanges(
  plan: WeekPlan,
  completed: ReadonlyArray<{ readonly requestId: string; readonly kind: 'move' | 'cancel'; readonly bookingId: string; readonly slot?: Slot }>,
  nowIso: string,
): WeekPlan {
  let next = plan
  for (const c of completed) {
    const change = next.flChanges?.[c.requestId]
    if (!change || change.kind !== c.kind || change.bookingId !== c.bookingId) continue
    if (change.kind === 'move') {
      if (c.slot) next = completeMove(next, c.requestId, c.slot, nowIso)
    } else next = setRecordingStatus(next, c.requestId, 'planned', undefined, nowIso)
  }
  return next
}

/** A tervbe tett változtatások a motor bemenetéhez (9.7). */
export function changesInput(plan: WeekPlan): PlannedChange[] {
  return Object.entries(plan.flChanges ?? {}).map(([requestId, c]) =>
    c.kind === 'move' ? { kind: 'move', requestId, bookingId: c.bookingId } : { kind: 'cancel', requestId, bookingId: c.bookingId, ...(c.doneAt ? { doneAt: c.doneAt } : {}) },
  )
}

/**
 * Halasztott igény visszahozása a hétre (9. lépés): a halasztás megszűnik, és az igény a
 * javasolt helyre kerül, amíg az tiszta marad (H08). A következő heti másolat a hét
 * megnyitásakor kikerül (H07).
 */
export function restoreDeferred(plan: WeekPlan, requestId: string, slot: Slot): WeekPlan {
  const kept = plan.decisions.filter((d) => !(d.requestId === requestId && (d.kind === 'assign' || d.kind === 'defer')))
  const watchDismissals = plan.watchDismissals?.filter((d) => d.requestId !== requestId)
  return { ...plan, decisions: [...kept, { kind: 'assign', requestId, slot, acceptWarnings: false }], ...(watchDismissals ? { watchDismissals } : {}) }
}

/**
 * Plusz igény felvétele (KIT-05): rendes igény időpont nélkül, ahogy a Heti igényeken a felvétel;
 * a motor helyezi el. A növendék felkerül a hétre.
 */
export function addExtraRequest(plan: WeekPlan, request: BookingRequest): WeekPlan {
  const selected = request.studentIds.filter((id) => !plan.selectedStudentIds.includes(id))
  return { ...plan, requests: [...plan.requests, request], selectedStudentIds: [...plan.selectedStudentIds, ...selected] }
}

/** A plusz igény felvételének visszavonása: az igény, a döntései és a vele kijelölt növendék kikerül. */
export function removeExtraRequest(plan: WeekPlan, requestId: string, deselect: readonly string[]): WeekPlan {
  const others = new Set(plan.requests.filter((r) => r.id !== requestId && r.kind !== 'theory').flatMap((r) => r.studentIds))
  return {
    ...plan,
    requests: plan.requests.filter((r) => r.id !== requestId),
    decisions: plan.decisions.filter((d) => d.requestId !== requestId),
    selectedStudentIds: plan.selectedStudentIds.filter((id) => !deselect.includes(id) || others.has(id)),
  }
}

/**
 * Halasztott igény visszahozása elhelyező döntés nélkül (KIT-03, „Van még hely?”): csak a halasztás
 * szűnik meg, a motor a saját elsőbbségével tervezi, mint bármely igényt. A következő heti
 * másolat a hét megnyitásakor kikerül (H07). Visszavonáshoz a törölt halasztás is visszajön.
 */
export function undeferRequest(plan: WeekPlan, requestId: string): { readonly plan: WeekPlan; readonly removed: readonly Decision[] } {
  const removed = plan.decisions.filter((d) => d.requestId === requestId && d.kind === 'defer')
  const watchDismissals = plan.watchDismissals?.filter((d) => d.requestId !== requestId)
  return {
    plan: { ...plan, decisions: plan.decisions.filter((d) => !removed.includes(d)), ...(watchDismissals ? { watchDismissals } : {}) },
    removed,
  }
}

export type WatchDismissalKind = 'improve' | 'problem' | 'restore' | 'missing' | 'capacity'

/** A hét közbeni javaslat elutasítása („marad így”); `from`: az érintett foglalás kezdete. */
export function dismissWatch(plan: WeekPlan, requestId: string, kind: WatchDismissalKind, from: string | undefined, nowIso: string): WeekPlan {
  const kept = (plan.watchDismissals ?? []).filter((d) => !(d.requestId === requestId && d.kind === kind))
  return { ...plan, watchDismissals: [...kept, { requestId, kind, ...(from ? { from } : {}), at: nowIso }] }
}

/**
 * A következő hét azon halasztott másolatainak forrása, amelyekről ott már döntés született
 * (vagy rögzítették): ezek nem hozhatók vissza erre a hétre, mert kettőződnének (H07).
 */
export function lockedCarriedIds(next: WeekPlan | null | undefined, weekStart: LocalDate): string[] {
  if (!next) return []
  const decided = new Set([...next.decisions.map((d) => d.requestId), ...Object.entries(next.recording).filter(([, st]) => st === 'recorded').map(([rid]) => rid)])
  return next.requests
    .filter((r) => r.origin === 'deferred' && r.deferredFromWeek === weekStart && r.id.endsWith('-h') && decided.has(r.id))
    .map((r) => r.id.slice(0, -2))
    .sort()
}

/** Kézi mozgatások száma (U10): a tervezeten áthúzott foglalások. */
export function manualMoveCount(plan: WeekPlan): number {
  return plan.decisions.filter((d) => d.kind === 'assign' && d.fromDraft).length
}

/** A rögzített helyek a motor bemenetéhez (H02, 9.6). */
export function recordedInput(plan: WeekPlan): RecordedEntry[] {
  return Object.entries(plan.recordedSlots ?? {})
    .filter(([id]) => plan.recording[id] === 'recorded')
    .map(([requestId, slot]) => {
      const at = plan.recordedAt?.[requestId]
      const bookingId = plan.recordedBookings?.[requestId]
      return { requestId, slot, ...(at ? { at } : {}), ...(bookingId ? { bookingId } : {}) }
    })
}

/** Komment beállítása (TRV-07, TRV-09); üres szöveg törli. */
export function setComment(plan: WeekPlan, requestId: string, comment: string): WeekPlan {
  const kept = plan.decisions.filter((d) => !(d.kind === 'comment' && d.requestId === requestId))
  const trimmed = comment.trim()
  return { ...plan, decisions: trimmed ? [...kept, { kind: 'comment', requestId, comment: trimmed }] : kept }
}

/** A kézi mozgatás és a döntések visszavonása egy igényre. */
export function resetRequest(plan: WeekPlan, requestId: string): WeekPlan {
  return { ...plan, decisions: plan.decisions.filter((d) => d.requestId !== requestId || d.kind === 'comment') }
}

/** Igény törlése a listából (TRV-20) a hozzá tartozó döntésekkel együtt. */
export function removeRequest(plan: WeekPlan, requestId: string): WeekPlan {
  // A tagság az igénnyel megy; a tag nélkül maradt csapat eltűnik (KBR-05).
  return pruneTeams({
    ...plan,
    requests: plan.requests.filter((r) => r.id !== requestId),
    decisions: plan.decisions.filter((d) => d.requestId !== requestId),
  })
}

/** A heti igények összesítése (TRV-20): mennyi repülés és szimulátor jön ki belőlük. */
export interface RequestTotals {
  /** Repülési igények gépideje (fő rész) percben: a heti repült idő az igények alapján. */
  readonly flightMinutes: number
  readonly flightCount: number
  /** Szimulátoros igények gépideje percben. */
  readonly simulatorMinutes: number
  readonly simulatorCount: number
  /** Az oktató teljes ideje briefinggel és debriefinggel együtt (motorpróba nélkül), percben. */
  readonly instructorMinutes: number
}

const EMPTY_TOTALS: RequestTotals = { flightMinutes: 0, flightCount: 0, simulatorMinutes: 0, simulatorCount: 0, instructorMinutes: 0 }

function addRequest(t: RequestTotals, r: BookingRequest): RequestTotals {
  const all = r.durations.briefing + r.durations.main + r.durations.debriefing
  if (r.kind === 'flight') return { ...t, flightMinutes: t.flightMinutes + r.durations.main, flightCount: t.flightCount + 1, instructorMinutes: t.instructorMinutes + all }
  if (r.kind === 'simulator') return { ...t, simulatorMinutes: t.simulatorMinutes + r.durations.main, simulatorCount: t.simulatorCount + 1, instructorMinutes: t.instructorMinutes + all }
  return t
}

/**
 * Repülési és szimulátoros igények összesítése, összesen és növendékenként. Az elméleti
 * igények nem számítanak bele (azoknak külön oldaluk van).
 */
export function requestTotals(requests: readonly BookingRequest[]): { readonly total: RequestTotals; readonly byStudent: ReadonlyMap<string, RequestTotals> } {
  let total = EMPTY_TOTALS
  const byStudent = new Map<string, RequestTotals>()
  for (const r of requests) {
    if (r.kind === 'theory') continue
    total = addRequest(total, r)
    for (const id of r.studentIds) byStudent.set(id, addRequest(byStudent.get(id) ?? EMPTY_TOTALS, r))
  }
  return { total, byStudent }
}

// ---------- Közös briefing csapatok (KBR-03, KBR-04, KBR-05) ----------

export type BriefingTeamRecord = NonNullable<WeekPlan['briefingTeams']>[number]

/** A hét egy csapata a nevével és a tagjaival. */
export interface TeamInfo extends BriefingTeamRecord {
  /** „1. csapat”, „2. csapat” … a létrehozás sorrendjében. */
  readonly label: string
  readonly memberIds: readonly string[]
}

/** A hét csapatai a létrehozás sorrendjében, névvel és tagokkal (a tag nélküliek nélkül). */
export function teamsOf(plan: Pick<WeekPlan, 'briefingTeams' | 'requests'>): TeamInfo[] {
  const ordered = [...(plan.briefingTeams ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  return ordered
    .map((t, i) => ({ ...t, label: `${i + 1}. csapat`, memberIds: plan.requests.filter((r) => r.briefingTeamId === t.id).map((r) => r.id) }))
    .filter((t) => t.memberIds.length > 0)
}

/** Az igény elhelyező döntései, amelyek a csapattagság változásával érvényüket vesztik. */
const placementDecision = (d: Decision): boolean => d.kind === 'assign' || d.kind === 'avoidSlot' || d.kind === 'teamOff'

/**
 * Az igények csapatba tétele: a tagság változásakor az igények elhelyező döntései törlődnek (az
 * egyéni hely és a régi csapat kezdése már nem érvényes; a csapat többi tagjáé megmarad).
 */
function withTeam(plan: WeekPlan, requestIds: readonly string[], teamId: string | undefined): WeekPlan {
  const ids = new Set(requestIds)
  const requests = plan.requests.map((r) => {
    if (!ids.has(r.id) || r.briefingTeamId === teamId) return r
    const { briefingTeamId: _old, ...rest } = r
    return teamId ? { ...rest, briefingTeamId: teamId } : rest
  })
  const changed = new Set(requests.filter((r, i) => r !== plan.requests[i]).map((r) => r.id))
  if (changed.size === 0) return pruneTeams(plan)
  const decisions = plan.decisions.filter((d) => !(changed.has(d.requestId) && placementDecision(d)))
  return pruneTeams({ ...plan, requests, decisions })
}

/** A tag nélküli csapatok törlése (KBR-05): a csapat azokból áll, akik a címkéjét viselik. */
export function pruneTeams(plan: WeekPlan): WeekPlan {
  if (!plan.briefingTeams) return plan
  const used = new Set(plan.requests.map((r) => r.briefingTeamId).filter((id): id is string => id !== undefined))
  const kept = plan.briefingTeams.filter((t) => used.has(t.id))
  if (kept.length === plan.briefingTeams.length) return plan
  if (kept.length > 0) return { ...plan, briefingTeams: kept }
  const { briefingTeams: _t, ...rest } = plan
  return rest
}

/**
 * Az ismeretlen csapatra hivatkozó igényekhez kézi csapat (például kézzel szerkesztett fájlnál),
 * a tag nélküli csapatok törlése. Változatlan tervnél ugyanaz az objektum.
 */
export function normalizeTeams(plan: WeekPlan, nowIso: string): WeekPlan {
  const known = new Set((plan.briefingTeams ?? []).map((t) => t.id))
  const missing = [...new Set(plan.requests.map((r) => r.briefingTeamId).filter((id): id is string => id !== undefined && !known.has(id)))].sort()
  const withMissing = missing.length > 0 ? { ...plan, briefingTeams: [...(plan.briefingTeams ?? []), ...missing.map((id) => ({ id, origin: 'manual' as const, createdAt: nowIso }))] } : plan
  return pruneTeams(withMissing)
}

/** Új csapat a megadott igényekkel (a panel „+ Új csapat” sávja vagy a kézi „Új csapat”). */
export function createTeam(plan: WeekPlan, requestIds: readonly string[], origin: BriefingTeamRecord['origin'], nowIso: string, teamId: string = newRequestId('csapat')): WeekPlan {
  // Azonos időben létrehozott csapatoknál is az utóbb létrehozott legyen a későbbi.
  const latest = (plan.briefingTeams ?? []).reduce((m, t) => (t.createdAt > m ? t.createdAt : m), '')
  const createdAt = latest >= nowIso ? new Date(Date.parse(latest) + 1).toISOString() : nowIso
  const withRecord = { ...plan, briefingTeams: [...(plan.briefingTeams ?? []), { id: teamId, origin, createdAt }] }
  return withTeam(withRecord, requestIds, teamId)
}

/** Igény áttétele egy meglévő csapatba (KBR-04 „Áthelyezés”). */
export function moveToTeam(plan: WeekPlan, requestId: string, teamId: string): WeekPlan {
  if (!(plan.briefingTeams ?? []).some((t) => t.id === teamId)) return plan
  return withTeam(plan, [requestId], teamId)
}

/** Kivétel a csapatból (KBR-04): az igény egyéniként tervezett, a csapat a többiekkel marad. */
export function removeFromTeam(plan: WeekPlan, requestId: string): WeekPlan {
  return withTeam(plan, [requestId], undefined)
}

/**
 * Kézi csapatba szervezés az igénysorból (KBR-04): a legutóbb létrehozott kézi csapatba kerül; ha
 * még nincs kézi csapat, újat hoz létre. Az automatikus (a panelben létrehozott) csapatba magától
 * nem tesz.
 */
export function addToTeamManually(plan: WeekPlan, requestId: string, nowIso: string, newTeamId?: string): { readonly plan: WeekPlan; readonly teamId: string; readonly created: boolean } {
  const latest = teamsOf(plan)
    .filter((t) => t.origin === 'manual')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]
  if (latest) {
    if (plan.requests.find((r) => r.id === requestId)?.briefingTeamId === latest.id) return { plan, teamId: latest.id, created: false }
    return { plan: moveToTeam(plan, requestId, latest.id), teamId: latest.id, created: false }
  }
  const teamId = newTeamId ?? newRequestId('csapat')
  return { plan: createTeam(plan, [requestId], 'manual', nowIso, teamId), teamId, created: true }
}

/**
 * A csapat mozgatása a tervezeten (TRV-10, KBR-08): minden tag csapatdöntést kap az új közös
 * kezdéssel és a saját gépével; a tagok korábbi elhelyező döntései helyett.
 */
export function moveTeam(plan: WeekPlan, teamId: string, slots: ReadonlyArray<{ readonly requestId: string; readonly slot: Slot }>): WeekPlan {
  const ids = new Set(slots.map((s) => s.requestId))
  const kept = plan.decisions.filter((d) => !(ids.has(d.requestId) && (d.kind === 'assign' || d.kind === 'defer' || d.kind === 'teamOff')))
  const added: Decision[] = slots.map((s) => ({ kind: 'assign', requestId: s.requestId, slot: s.slot, acceptWarnings: true, fromDraft: true, team: teamId }))
  return { ...plan, decisions: [...kept, ...added] }
}

/** A „ezen a héten egyénileg” döntés visszavonása: a tag újra a csapattal tervezett (KBR-07). */
export function rejoinTeam(plan: WeekPlan, requestId: string): WeekPlan {
  return { ...plan, decisions: plan.decisions.filter((d) => !(d.kind === 'teamOff' && d.requestId === requestId)) }
}

/**
 * A hét közbeni figyelés csapatjavaslata a foglalási tervbe (KBR-11, 9.7): a FlightLoggerben lévő
 * tagok foglalása áthelyezendő jelölést kap, és minden tag csapatdöntést a javasolt közös
 * kezdéssel. Ha a tagok még nem csapat a tervben (a FlightLoggerben közös kezdéssel vették fel
 * őket), kézi csapat lesz belőlük.
 */
export function planTeamMove(
  plan: WeekPlan,
  teamId: string | undefined,
  moves: ReadonlyArray<{ readonly requestId: string; readonly bookingId?: string; readonly slot: Slot }>,
  nowIso: string,
  newTeamId: string = newRequestId('csapat'),
): WeekPlan {
  const ids = moves.map((m) => m.requestId)
  const id = teamId ?? newTeamId
  let next = teamId ? plan : createTeam(plan, ids, 'manual', nowIso, id)
  for (const m of moves) if (m.bookingId) next = withChange(next, m.requestId, { kind: 'move', bookingId: m.bookingId })
  const moving = new Set(ids)
  const kept = next.decisions.filter((d) => !(moving.has(d.requestId) && (d.kind === 'assign' || d.kind === 'defer' || d.kind === 'teamOff')))
  const added: Decision[] = moves.map((m) => ({ kind: 'assign', requestId: m.requestId, slot: m.slot, acceptWarnings: false, team: id }))
  return { ...next, decisions: [...kept, ...added] }
}
