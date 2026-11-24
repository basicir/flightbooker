import { z } from 'zod'
import type { WeekPlan } from '../draft/weekPlan'
import { completeMove, markCancelled, setRecordingStatus } from '../draft/weekPlan'
import { theoryTypeOf, type BookingRequest, type ExistingBooking, type PlannedTeam, type PlanResult, type Proposal, type Slot, type TeamUnit } from '../model/planning'
import { localParts, toMs } from '../time/zoned'

/**
 * FlightLogger-import (5.10, FLI-02, FLI-03, FLI-08): a rögzítési lista tételei a FlightLogger
 * foglalási ablakának szerkezetében, vágólapra másolható csomagként. A csomagot a Tampermonkey-
 * szkript (`tools/tampermonkey/flightlogger-import.user.js`) tölti be a FlightLogger saját
 * ablakába; a mentést mindig az oktató nyomja meg. Visszafelé a szkript visszaigazolást ad, amely
 * alapján az app a létrehozott tételeket rögzítettnek jelöli.
 *
 * Tiszta függvények: a neveket és címkéket a hívó adja (`ImportContext`), így a csomag csak a
 * vágólapra kerül, tárolva nem lesz.
 */

export const FL_IMPORT_FORMAT = 'flightbooker-fl-import'
export const FL_RECEIPT_FORMAT = 'flightbooker-fl-receipt'
/**
 * 2: a csapat tételei mellett a FlightLoggerben átírandó (áthelyezendő) foglalások is (`update`).
 * A régebbi szkript az ilyen csomagot nem fogadja el, így nem vesz fel újat a meglévő helyett.
 */
export const FL_IMPORT_VERSION = 2

/** A FlightLogger foglalási ablakának típusa (`select#bookingFormTypeSelector` értéke). */
export type FlBookingType = 'Single student' | 'Multi student' | 'Ground lesson' | 'Extra theory' | 'Meeting'

/** A „Create booking” utáni típusválasztó csempéjének felirata. */
export const FL_TILE: Readonly<Record<FlBookingType, string>> = {
  'Single student': 'Single student',
  'Multi student': 'Multi student',
  'Ground lesson': 'Ground training',
  'Extra theory': 'Extra theory',
  Meeting: 'Meeting',
}

const text = z.string().max(300)
const person = z.object({ callSign: z.string().max(40).optional(), name: text })
const student = person.extend({
  /** A program felirata (a FlightLogger magától választja a növendékéét; ezzel ellenőrizhető). */
  program: text.optional(),
  /** A feladat (Session) neve, ahogy a FlightLogger listája mutatja. */
  lesson: text.optional(),
})
const dateTime = z.object({ date: z.string().regex(/^\d{2}\.\d{2}\.\d{4}$/), time: z.string().regex(/^\d{2}:\d{2}$/) })
const minuteOfDay = z.int().min(0).max(48 * 60)

/** Egy meglévő foglalás helye: a nap (ide lapoz a szkript) és az ideje. */
const oldPlace = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: z.string().regex(/^\d{2}:\d{2}$/), end: z.string().regex(/^\d{2}:\d{2}$/) })

export const FlImportBookingSchema = z.object({
  /** Stabil kulcs: az igények azonosítói (+ jellel), extra elméletnél a növendékkel (#). */
  id: z.string().min(1).max(1000),
  requestIds: z.array(z.string().min(1).max(200)).min(1).max(20),
  /** Hány tételből áll az igény (extra elméletnél növendékenként egy); a rögzítéshez mind kell. */
  partOf: z.int().min(1).max(50),
  flType: z.enum(['Single student', 'Multi student', 'Ground lesson', 'Extra theory', 'Meeting']),
  tile: text,
  /** Egysoros összefoglaló a listához. */
  label: text,
  /** A kezdés helyi napja (ÉÉÉÉ-HH-NN), a naptár ezt a napot mutatva rajzolja. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  instructor: person.optional(),
  students: z.array(student).max(50),
  /** Meetingnél a résztvevők (növendékek és az oktató). */
  participants: z.array(person).max(60),
  aircraft: z.object({ id: z.string().max(200), callSign: z.string().max(40), model: text.optional() }).optional(),
  classroom: z.object({ id: z.string().max(200), name: text }).optional(),
  times: z.object({ briefing: dateTime.optional(), start: dateTime, end: dateTime, debriefing: dateTime.optional() }),
  /** Percek a `date` napjának helyi éjfelétől (a naptár szellemképéhez). */
  minutes: z.object({ start: minuteOfDay, end: minuteOfDay, flightStart: minuteOfDay.optional(), flightEnd: minuteOfDay.optional() }),
  comment: z.string().max(2000).optional(),
  /** A foglalás kitöltőszíne (FLI-12): a beállításokból, típusonként; hiányában nincs szín. */
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  /**
   * Elméletnél a további FlightLogger-mezők (FLI-11): Ground trainingnél osztály, program, tárgy,
   * Session type és Session; Extra theorynál program. A feliratok a FlightLogger listáinak szövegei.
   */
  theory: z
    .object({
      className: text.optional(),
      program: text.optional(),
      subject: text.optional(),
      sessionType: text.optional(),
      session: text.optional(),
    })
    .optional(),
  /**
   * Áthelyezés (9.7): a FlightLoggerben a meglévő foglalást kell átírni erre a helyre, nem újat
   * felvenni. A szkript a régi napra lapoz, megnyitja a foglalást (Update booking), átírja az időt,
   * a gépet vagy a termet; a mentést (Update) az oktató nyomja meg.
   */
  update: z
    .object({
      bookingId: z.string().min(1).max(200),
      from: oldPlace,
      /** A foglalás összetétele is változik (típus, növendékek): a szkript a résztvevőket is átírja. */
      full: z.boolean().optional(),
    })
    .optional(),
  /**
   * Lemondás (9.7): a meglévő foglalást le kell mondani. A szkript a napjára lapoz, megnyitja,
   * és kiemeli a Cancel gombot; a lemondást (és amit a FlightLogger még kér) az oktató végzi.
   */
  cancel: z.object({ bookingId: z.string().min(1).max(200), from: oldPlace }).optional(),
})
export type FlImportBooking = z.infer<typeof FlImportBookingSchema>

export const FlImportPackageSchema = z.object({
  format: z.literal(FL_IMPORT_FORMAT),
  version: z.literal(FL_IMPORT_VERSION),
  createdAt: z.string().max(40),
  timezone: z.string().max(80),
  bookings: z.array(FlImportBookingSchema).max(500),
})
export type FlImportPackage = z.infer<typeof FlImportPackageSchema>

export const FlReceiptSchema = z.object({
  format: z.literal(FL_RECEIPT_FORMAT),
  // Az 1.x szkriptek 1-es visszaigazolása is beolvasható.
  version: z.union([z.literal(1), z.literal(2)]),
  createdAt: z.string().max(40),
  items: z
    .array(
      z.object({
        id: z.string().min(1).max(1000),
        requestIds: z.array(z.string().min(1).max(200)).min(1).max(20),
        partOf: z.int().min(1).max(50).optional(),
        status: z.enum(['created', 'skipped']),
        /** A szkript egy meglévő foglalást írt át (áthelyezés), nem újat vett fel. */
        update: z.boolean().optional(),
        /** A szkript egy meglévő foglalás lemondását kísérte végig. */
        cancel: z.boolean().optional(),
        /** Az eredmény FlightLogger-foglalása (átírásnál a meglévő, új foglalásnál, ha látta). */
        bookingId: z.string().min(1).max(200).optional(),
        at: z.string().max(40),
      }),
    )
    .max(1000),
})
export type FlReceipt = z.infer<typeof FlReceiptSchema>

/** Nevek és címkék a csomaghoz (a felület adja a névjegyzékből). */
export interface ImportContext {
  readonly timezone: string
  /** A tervező oktató (minden foglalás oktatója). */
  readonly instructor?: { readonly callSign?: string; readonly name: string }
  readonly person: (id: string) => { readonly callSign?: string; readonly name: string }
  readonly program: (studentId: string) => string | undefined
  readonly lesson: (lectureId: string) => string | undefined
  readonly aircraft: (resourceId: string) => { readonly id: string; readonly callSign: string; readonly model?: string } | undefined
  readonly classroom: (classroomId: string) => { readonly id: string; readonly name: string } | undefined
  /** Az osztály neve (Ground training „Class” mezője). */
  readonly className?: (classId: string) => string | undefined
  /** A foglalástípus kitöltőszíne a beállításokból (FLI-12); `undefined`: nincs szín. */
  readonly color?: (type: FlBookingType) => string | undefined
}

/** A FlightLogger-típus a beállítások színkulcsán (FLI-12). */
export const FL_COLOR_KEY: Readonly<Record<FlBookingType, 'singleStudent' | 'multiStudent' | 'groundTraining' | 'extraTheory' | 'meeting'>> = {
  'Single student': 'singleStudent',
  'Multi student': 'multiStudent',
  'Ground lesson': 'groundTraining',
  'Extra theory': 'extraTheory',
  Meeting: 'meeting',
}

/** Átírandó FlightLogger-foglalás (9.7): az azonosítója és a mostani helye. */
export interface ImportUpdate {
  readonly bookingId: string
  readonly from: Slot
  /** Az összetétel is változik (vegyes vagy szétvált csapat): típus és növendékek is. */
  readonly full?: boolean
}

/**
 * A rögzítési lista egy importálható tétele: önálló javaslat vagy a közös briefing egy foglalása.
 * `update`: nem új foglalás, hanem a meglévő átírása erre a helyre.
 */
export type ImportEntry =
  | {
      readonly kind: 'single'
      readonly request: BookingRequest
      readonly proposal: Proposal
      readonly update?: ImportUpdate
      /** Több növendékes extra elméletnél növendékenként a meglévő foglalás (növendék → átírás). */
      readonly perStudent?: Readonly<Record<string, ImportUpdate>>
    }
  | {
      readonly kind: 'unit'
      readonly team: PlannedTeam
      readonly unit: TeamUnit
      readonly members: ReadonlyArray<{ readonly request: BookingRequest; readonly proposal: Proposal }>
      readonly update?: ImportUpdate
    }
  | {
      /** Meglévő foglalás lemondása: tervbe tett lemondás, vagy a csapat átírása miatt fölösleges foglalás. */
      readonly kind: 'cancel'
      readonly request: BookingRequest
      readonly requestIds: readonly string[]
      readonly bookingId: string
      readonly slot: Slot
      /** Igaz, ha tervbe tett lemondás (a visszaigazolás lezárja); hamis, ha csak a csapat átírását kíséri. */
      readonly planned: boolean
    }

const pad = (n: number): string => String(n).padStart(2, '0')

function flDateTime(iso: string, tz: string): { readonly date: string; readonly time: string; readonly localDate: string; readonly minutes: number } {
  const p = localParts(toMs(iso), tz)
  const [y, m, d] = p.date.split('-')
  return { date: `${d}.${m}.${y}`, time: `${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`, localDate: p.date, minutes: p.minutes }
}

/** A `date` napjához mért perc (éjfél utáni vég esetén 24 óránál több). */
function minutesFrom(baseDate: string, iso: string, tz: string): number {
  const p = localParts(toMs(iso), tz)
  const days = Math.round((Date.parse(`${p.date}T00:00:00Z`) - Date.parse(`${baseDate}T00:00:00Z`)) / 86_400_000)
  return Math.max(0, Math.min(48 * 60, days * 24 * 60 + p.minutes))
}

const dt = (iso: string, tz: string) => {
  const v = flDateTime(iso, tz)
  return { date: v.date, time: v.time }
}

function studentOf(ctx: ImportContext, request: BookingRequest, studentId: string, withTask: boolean) {
  const p = ctx.person(studentId)
  const program = withTask ? ctx.program(studentId) : undefined
  const lesson = withTask && request.lectureId ? ctx.lesson(request.lectureId) : undefined
  return { ...p, ...(program ? { program } : {}), ...(lesson ? { lesson } : {}) }
}

const labelOf = (who: string, what: string | undefined, where: string | undefined): string => [who || '–', what, where].filter(Boolean).join(' · ').slice(0, 300)

/** Repülés vagy szimulátor egy javaslatból: Single student, Briefing/Start/End/Debriefing. */
function flightBooking(ctx: ImportContext, request: BookingRequest, proposal: Proposal): FlImportBooking {
  const slot = proposal.slot
  const tz = ctx.timezone
  const base = flDateTime(slot.start, tz)
  const flightStart = slot.flightStart ?? slot.start
  const flightEnd = slot.flightEnd ?? slot.end
  const students = request.studentIds.slice(0, 1).map((id) => studentOf(ctx, request, id, true))
  const aircraft = slot.resourceId ? ctx.aircraft(slot.resourceId) : undefined
  return {
    id: request.id,
    requestIds: [request.id],
    partOf: 1,
    flType: 'Single student',
    tile: FL_TILE['Single student'],
    label: labelOf(students.map((s) => s.name).join(', '), students[0]?.lesson ?? (request.kind === 'simulator' ? 'szimulátor' : 'repülés'), aircraft?.callSign),
    date: base.localDate,
    ...(ctx.instructor ? { instructor: ctx.instructor } : {}),
    students,
    participants: [],
    ...(aircraft ? { aircraft } : {}),
    times: { briefing: dt(slot.start, tz), start: dt(flightStart, tz), end: dt(flightEnd, tz), debriefing: dt(slot.end, tz) },
    minutes: { start: base.minutes, end: minutesFrom(base.localDate, slot.end, tz), flightStart: minutesFrom(base.localDate, flightStart, tz), flightEnd: minutesFrom(base.localDate, flightEnd, tz) },
    ...commentOf(request, proposal),
  }
}

/** A FlightLogger-komment: a tervezeten adott komment, hiányában az igény FlightLogger-kommentje. */
function commentOf(request: BookingRequest, proposal: Proposal): { readonly comment?: string } {
  const c = proposal.comment ?? request.note
  return c && c.trim() ? { comment: c.trim().slice(0, 2000) } : {}
}

/** Elmélet a típusa szerint (FLI-01); extra elméletnél növendékenként egy tétel. */
function theoryBookings(ctx: ImportContext, request: BookingRequest, proposal: Proposal): FlImportBooking[] {
  const slot = proposal.slot
  const tz = ctx.timezone
  const base = flDateTime(slot.start, tz)
  const classroom = slot.classroomId ? ctx.classroom(slot.classroomId) : undefined
  const common = {
    date: base.localDate,
    ...(classroom ? { classroom } : {}),
    times: { start: dt(slot.start, tz), end: dt(slot.end, tz) },
    minutes: { start: base.minutes, end: minutesFrom(base.localDate, slot.end, tz) },
    ...commentOf(request, proposal),
  }
  const type = theoryTypeOf(request)
  const names = request.studentIds.map((id) => ctx.person(id).name).join(', ')
  const fl = request.flTheory ?? {}
  const pick = (o: Record<string, string | undefined>) => {
    const kept = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v.trim() !== '')) as Record<string, string>
    return Object.keys(kept).length > 0 ? { theory: kept } : {}
  }
  if (type === 'meeting') {
    const participants = [...request.studentIds.map((id) => ctx.person(id)), ...(ctx.instructor ? [ctx.instructor] : [])]
    return [{ id: request.id, requestIds: [request.id], partOf: 1, flType: 'Meeting', tile: FL_TILE.Meeting, label: labelOf(names, 'megbeszélés', classroom?.name), students: [], participants, ...common }]
  }
  if (type === 'extraTheory') {
    const ids = request.studentIds.length > 0 ? request.studentIds : []
    const partOf = Math.max(1, ids.length)
    if (ids.length === 0) {
      return [{ id: request.id, requestIds: [request.id], partOf, flType: 'Extra theory', tile: FL_TILE['Extra theory'], label: labelOf('', 'extra elmélet', classroom?.name), ...(ctx.instructor ? { instructor: ctx.instructor } : {}), students: [], participants: [], ...common, ...pick({ program: fl.program }) }]
    }
    return ids.map((sid) => {
      const s = studentOf(ctx, request, sid, false)
      return {
        id: ids.length > 1 ? `${request.id}#${sid}` : request.id,
        requestIds: [request.id],
        partOf,
        flType: 'Extra theory' as const,
        tile: FL_TILE['Extra theory'],
        label: labelOf(s.name, 'extra elmélet', classroom?.name),
        ...(ctx.instructor ? { instructor: ctx.instructor } : {}),
        students: [s],
        participants: [],
        ...common,
        ...pick({ program: fl.program }),
      }
    })
  }
  const students = request.studentIds.map((id) => studentOf(ctx, request, id, false))
  return [
    {
      id: request.id,
      requestIds: [request.id],
      partOf: 1,
      flType: 'Ground lesson',
      tile: FL_TILE['Ground lesson'],
      label: labelOf(names, fl.subject ? `csoportos elmélet: ${fl.subject}` : 'csoportos elmélet', classroom?.name),
      ...(ctx.instructor ? { instructor: ctx.instructor } : {}),
      students,
      participants: [],
      ...common,
      ...pick({
        className: request.classId ? ctx.className?.(request.classId) : undefined,
        program: fl.program,
        subject: fl.subject,
        sessionType: fl.sessionType,
        session: fl.session,
      }),
    },
  ]
}

/**
 * A közös briefing csapat egy foglalása (KBR-09): pár (Multi student, Student 1 és 2 a saját
 * programjával és feladatával) vagy egyéni. A Briefing és a Debriefing a csapaté, a Start és az
 * End az egység repülése.
 */
function unitBooking(ctx: ImportContext, entry: Extract<ImportEntry, { kind: 'unit' }>): FlImportBooking | undefined {
  const first = entry.members[0]
  if (!first) return undefined
  const tz = ctx.timezone
  const teamSlot: Slot = first.proposal.slot
  const base = flDateTime(teamSlot.start, tz)
  const multi = entry.unit.bookingType === 'multiStudent'
  const type: FlBookingType = multi ? 'Multi student' : 'Single student'
  const students = entry.members.map((m) => studentOf(ctx, m.request, m.request.studentIds[0] ?? '', true)).filter((s) => s.name)
  const aircraft = entry.unit.resourceId ? ctx.aircraft(entry.unit.resourceId) : undefined
  const comment = entry.members.map((m) => m.proposal.comment ?? m.request.note).filter((c) => c && c.trim()).join(' / ')
  return {
    id: entry.unit.requestIds.join('+'),
    requestIds: [...entry.unit.requestIds],
    partOf: 1,
    flType: type,
    tile: FL_TILE[type],
    label: labelOf(students.map((s) => s.name).join(' + '), students.map((s) => s.lesson).filter(Boolean).join(' + ') || 'közös briefing', aircraft?.callSign),
    date: base.localDate,
    ...(ctx.instructor ? { instructor: ctx.instructor } : {}),
    students,
    participants: [],
    ...(aircraft ? { aircraft } : {}),
    times: { briefing: dt(teamSlot.start, tz), start: dt(entry.unit.flightStart, tz), end: dt(entry.unit.flightEnd, tz), debriefing: dt(teamSlot.end, tz) },
    minutes: {
      start: base.minutes,
      end: minutesFrom(base.localDate, teamSlot.end, tz),
      flightStart: minutesFrom(base.localDate, entry.unit.flightStart, tz),
      flightEnd: minutesFrom(base.localDate, entry.unit.flightEnd, tz),
    },
    ...(comment ? { comment: comment.slice(0, 2000) } : {}),
  }
}

/** Egy meglévő foglalás helye a csomagban: a nap, ahová lapozni kell, és az ideje. */
function placeOf(slot: Slot, tz: string): z.infer<typeof oldPlace> {
  const from = flDateTime(slot.start, tz)
  return { date: from.localDate, start: from.time, end: flDateTime(slot.end, tz).time }
}
function updateOf(update: ImportUpdate, tz: string): NonNullable<FlImportBooking['update']> {
  return { bookingId: update.bookingId, from: placeOf(update.from, tz), ...(update.full ? { full: true } : {}) }
}
const withColor = (ctx: ImportContext, b: FlImportBooking): FlImportBooking => {
  const color = ctx.color?.(b.flType)
  return color ? { ...b, color } : b
}

/**
 * Egy tétel FlightLogger-foglalásai (extra elméletnél több is lehet). Átírásnál a meglévő
 * foglalás színéhez nem nyúlunk, és a csomag megjelöli, hogy nem új foglalás; lemondásnál a
 * tétel a meglévő foglalás helyét mutatja.
 */
export function importBookingsFor(ctx: ImportContext, entry: ImportEntry): FlImportBooking[] {
  if (entry.kind === 'cancel') {
    const proposal: Proposal = { requestId: entry.request.id, slot: entry.slot, score: 0, factors: [], warnings: [], standby: false, decidedBy: 'engine', assumptions: [] }
    const base = entry.request.kind === 'theory' ? theoryBookings(ctx, entry.request, proposal)[0] : flightBooking(ctx, entry.request, proposal)
    if (!base) return []
    const { comment: _comment, color: _color, ...rest } = base
    return [{ ...rest, id: `cancel:${entry.bookingId}`, requestIds: [...entry.requestIds], partOf: 1, label: `lemondás: ${base.label}`.slice(0, 300), cancel: { bookingId: entry.bookingId, from: placeOf(entry.slot, ctx.timezone) } }]
  }
  const list = entry.kind === 'unit' ? [unitBooking(ctx, entry)].filter((b): b is FlImportBooking => b !== undefined) : entry.request.kind === 'theory' ? theoryBookings(ctx, entry.request, entry.proposal) : [flightBooking(ctx, entry.request, entry.proposal)]
  if (entry.kind === 'single' && entry.perStudent) {
    // Növendékenként: akinek van meglévő foglalása, annak átírása; akinek nincs, új foglalás.
    const per = entry.perStudent
    return list.map((b) => {
      const sid = entry.request.studentIds.find((id) => b.id === `${entry.request.id}#${id}` || (entry.request.studentIds.length === 1 && b.id === entry.request.id))
      const u = sid ? per[sid] : undefined
      return u ? { ...b, update: updateOf(u, ctx.timezone) } : withColor(ctx, b)
    })
  }
  if (entry.update) {
    const update = updateOf(entry.update, ctx.timezone)
    return list.slice(0, 1).map((b) => ({ ...b, update }))
  }
  return list.map((b) => withColor(ctx, b))
}

/** A több növendékes extra elmélet meglévő foglalásai növendékenként (ugyanott, ugyanakkor). */
function extraTheorySiblings(request: BookingRequest, known: string, from: Slot, bookings: readonly ExistingBooking[]): Map<string, string> {
  const out = new Map<string, string>()
  const same = (b: ExistingBooking): boolean =>
    b.status !== 'CANCELLED' && toMs(b.start) === toMs(from.start) && toMs(b.end) === toMs(from.end) && (!from.classroomId || b.classroomId === from.classroomId)
  const knownBooking = bookings.find((b) => b.id === known)
  for (const sid of request.studentIds) {
    if (knownBooking && knownBooking.participantIds.includes(sid)) {
      out.set(sid, known)
      continue
    }
    const b = bookings.find((x) => x.id !== known && same(x) && x.participantIds.includes(sid) && ![...out.values()].includes(x.id) && (x.type === 'theory' || x.type === 'classTheory' || x.type === 'other'))
    if (b) out.set(sid, b.id)
  }
  if (out.size === 0) out.set(request.studentIds[0] ?? '', known)
  return out
}

/**
 * A FlightLoggerbe viendő tételek a rögzítési lista sorrendjében (5.10, 9.7):
 * - új foglalás: a még fel nem vitt tételek;
 * - átírás: az áthelyezendő tétel meglévő foglalása (`update`). Ha a foglalás összetétele is
 *   változik (vegyes vagy szétvált közös briefinges pár), a típus és a növendékek is (`full`).
 *   Egy foglalást csak egy tétel írhat át (időrendben az első); a többi újat kap. Ha a foglalás
 *   a frissítés szerint már nincs meg, új foglalás;
 * - lemondás: a tervbe tett lemondás, és az átírás miatt fölöslegessé vált foglalás (amelynek
 *   minden igénye máshová került).
 * Több növendékes extra elméletnél a növendékenkénti foglalásokat a pillanatképből keresi.
 */
export function openImportEntries(
  result: Pick<PlanResult, 'proposals' | 'teams'> & Partial<Pick<PlanResult, 'plannedCancels'>>,
  plan: Pick<WeekPlan, 'requests' | 'recording'>,
  bookings: readonly ExistingBooking[] = [],
): ImportEntry[] {
  const reqOf = new Map(plan.requests.map((r) => [r.id, r]))
  const isMove = (p: Proposal): boolean => p.change?.kind === 'move'
  const open = (p: Proposal): boolean => !p.standby && (isMove(p) || (!p.change && (plan.recording[p.requestId] ?? 'planned') !== 'recorded'))
  const moveOf = (p: Proposal): ImportUpdate | undefined => (p.change?.kind === 'move' && p.change.from ? { bookingId: p.change.bookingId, from: p.change.from } : undefined)
  const unitOf = new Map<string, { readonly team: PlannedTeam; readonly unit: TeamUnit }>()
  for (const t of result.teams) if (t.state === 'placed') for (const u of t.units) for (const id of u.requestIds) unitOf.set(id, { team: t, unit: u })

  // Melyik meglévő foglalásra hivatkozik melyik áthelyezendő igény.
  const refs = new Map<string, Set<string>>()
  const fromOf = new Map<string, { readonly slot: Slot; readonly requestId: string }>()
  for (const p of result.proposals) {
    const m = !p.standby ? moveOf(p) : undefined
    if (!m) continue
    refs.set(m.bookingId, (refs.get(m.bookingId) ?? new Set()).add(p.requestId))
    if (!fromOf.has(m.bookingId)) fromOf.set(m.bookingId, { slot: m.from, requestId: p.requestId })
  }
  const claimed = new Set<string>()
  const handled = new Set<string>()
  const entries: Array<{ readonly entry: ImportEntry; readonly start: number }> = []
  const seen = new Set<string>()
  const ordered = [...result.proposals].sort((a, b) => toMs(a.slot.start) - toMs(b.slot.start))
  for (const p of ordered) {
    const request = reqOf.get(p.requestId)
    if (!request || !open(p)) continue
    const tu = unitOf.get(p.requestId)
    if (!tu) {
      handled.add(p.requestId)
      const m = moveOf(p)
      if (m && request.kind === 'theory' && theoryTypeOf(request) === 'extraTheory' && request.studentIds.length > 1) {
        const perStudent: Record<string, ImportUpdate> = {}
        for (const [sid, id] of extraTheorySiblings(request, m.bookingId, m.from, bookings)) {
          if (claimed.has(id) || !sid) continue
          claimed.add(id)
          perStudent[sid] = { bookingId: id, from: m.from }
        }
        entries.push({ entry: { kind: 'single', request, proposal: p, ...(Object.keys(perStudent).length > 0 ? { perStudent } : {}) }, start: toMs(p.slot.start) })
        continue
      }
      let update: ImportUpdate | undefined
      if (m && !claimed.has(m.bookingId)) {
        claimed.add(m.bookingId)
        // Ha a foglaláson más is van (szétvált pár), a növendékeket is át kell írni.
        update = (refs.get(m.bookingId)?.size ?? 1) > 1 ? { ...m, full: true } : m
      }
      entries.push({ entry: { kind: 'single', request, proposal: p, ...(update ? { update } : {}) }, start: toMs(p.slot.start) })
      continue
    }
    const key = tu.unit.requestIds.join('+')
    if (seen.has(key)) continue
    seen.add(key)
    const members = tu.unit.requestIds
      .map((id) => ({ request: reqOf.get(id), proposal: result.proposals.find((x) => x.requestId === id && !x.standby) }))
      .filter((m): m is { request: BookingRequest; proposal: Proposal } => m.request !== undefined && m.proposal !== undefined)
    if (members.length !== tu.unit.requestIds.length || !members.every((m) => open(m.proposal))) continue
    for (const m of members) handled.add(m.request.id)
    // Az egység egy FlightLogger-foglalás: a tagok meglévő foglalásai közül az első szabadot írjuk át.
    const own = members.map((m) => moveOf(m.proposal)).filter((u): u is ImportUpdate => u !== undefined)
    const primary = own.find((u) => !claimed.has(u.bookingId))
    let update: ImportUpdate | undefined
    if (primary) {
      claimed.add(primary.bookingId)
      const memberIds = new Set(members.map((m) => m.request.id))
      const holders = refs.get(primary.bookingId) ?? new Set<string>()
      const same = members.every((m) => moveOf(m.proposal)?.bookingId === primary.bookingId) && [...holders].every((id) => memberIds.has(id))
      update = same ? primary : { ...primary, full: true }
    }
    entries.push({ entry: { kind: 'unit', team: tu.team, unit: tu.unit, members, ...(update ? { update } : {}) }, start: toMs(tu.unit.flightStart) })
  }

  // Fölöslegessé vált foglalások: minden igényük máshová került (új vagy másik foglalásba).
  for (const [bookingId, holders] of refs) {
    if (claimed.has(bookingId) || ![...holders].every((id) => handled.has(id))) continue
    const from = fromOf.get(bookingId)
    const request = from ? reqOf.get(from.requestId) : undefined
    if (!from || !request) continue
    claimed.add(bookingId)
    entries.push({ entry: { kind: 'cancel', request, requestIds: [...holders], bookingId, slot: from.slot, planned: false }, start: toMs(from.slot.start) })
  }
  // Tervbe tett lemondások (még el nem végzettek); extra elméletnél növendékenként.
  for (const c of result.plannedCancels ?? []) {
    const request = reqOf.get(c.requestId)
    if (c.done || !request || claimed.has(c.bookingId)) continue
    const ids =
      request.kind === 'theory' && theoryTypeOf(request) === 'extraTheory' && request.studentIds.length > 1
        ? [...new Set(extraTheorySiblings(request, c.bookingId, c.slot, bookings).values())]
        : [c.bookingId]
    for (const bookingId of ids) {
      if (claimed.has(bookingId)) continue
      claimed.add(bookingId)
      entries.push({ entry: { kind: 'cancel', request, requestIds: [c.requestId], bookingId, slot: c.slot, planned: true }, start: toMs(c.slot.start) })
    }
  }
  return entries.sort((a, b) => a.start - b.start).map((e) => e.entry)
}

/** Az importcsomag szövege (a vágólapra). */
export function importPackageText(bookings: readonly FlImportBooking[], timezone: string, createdAt: string): string {
  const pkg: FlImportPackage = { format: FL_IMPORT_FORMAT, version: FL_IMPORT_VERSION, createdAt, timezone, bookings: [...bookings] }
  return JSON.stringify(pkg)
}

/** Visszaigazolás felismerése egy (vágólapról olvasott) szövegben; más tartalomra `null`. */
export function parseReceipt(textValue: string): FlReceipt | null {
  const trimmed = textValue.trim()
  if (!trimmed.startsWith('{') || !trimmed.includes(FL_RECEIPT_FORMAT)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  const result = FlReceiptSchema.safeParse(parsed)
  return result.success ? result.data : null
}

export interface ReceiptOutcome {
  readonly plan: WeekPlan
  /** Most rögzítettnek jelölt igények (az áthelyezettek is). */
  readonly recorded: readonly string[]
  /** Ezek közül a FlightLoggerben átírt (áthelyezett) igények. */
  readonly moved: readonly string[]
  /** A FlightLoggerben lemondott (tervbe tett lemondású) igények. */
  readonly cancelled: readonly string[]
  /** Már korábban rögzítettek (nincs teendő). */
  readonly already: readonly string[]
  /** Részben létrehozott (extra elméletnél nem minden növendéké) vagy a tervben nem található igények. */
  readonly pending: readonly string[]
  /** A FlightLoggerben kihagyott tételek igényei. */
  readonly skipped: readonly string[]
}

/**
 * A visszaigazolás alkalmazása (FLI-08): a létrehozott tételek igényei rögzítettek lesznek a terv
 * szerinti helyükkel (H02). Csak a tervben ma is meglévő, még nem rögzített igényekre hat; az
 * extra elmélet akkor rögzített, ha minden növendékének foglalása létrejött.
 */
export function applyReceipt(plan: WeekPlan, receipt: FlReceipt, proposals: readonly Proposal[], nowIso: string): ReceiptOutcome {
  const createdParts = new Map<string, Set<string>>()
  const needed = new Map<string, number>()
  const skipped = new Set<string>()
  const cancelDone = new Set<string>()
  /** Igényenként az eredmény foglalása (egy foglalásnál; több részesnél nem egyértelmű). */
  const bookingOf = new Map<string, string | null>()
  /** A szkript a meglévő foglalást írta át (az azonosító marad, ha a visszaigazolás nem adja meg). */
  const updated = new Set<string>()
  for (const item of receipt.items) {
    for (const rid of item.requestIds) {
      if (item.status === 'skipped') {
        if (!item.cancel) skipped.add(rid)
        continue
      }
      if (item.cancel) {
        cancelDone.add(rid)
        continue
      }
      bookingOf.set(rid, bookingOf.has(rid) ? null : (item.bookingId ?? null))
      if (item.update) updated.add(rid)
      const parts = createdParts.get(rid) ?? new Set<string>()
      parts.add(item.id)
      createdParts.set(rid, parts)
      needed.set(rid, Math.max(needed.get(rid) ?? 1, item.partOf ?? 1))
    }
  }
  let next = plan
  const recorded: string[] = []
  const moved: string[] = []
  const cancelled: string[] = []
  const already: string[] = []
  for (const rid of cancelDone) {
    // Csak a tervbe tett lemondás zárul le; az átírást kísérő lemondás (csapat) a saját tétele szerint.
    if (next.flChanges?.[rid]?.kind !== 'cancel' || next.flChanges[rid]?.doneAt) continue
    next = markCancelled(next, rid, nowIso)
    cancelled.push(rid)
  }
  const pending: string[] = []
  for (const [rid, parts] of createdParts) {
    const proposal = proposals.find((p) => p.requestId === rid && !p.standby)
    if (!proposal || !plan.requests.some((r) => r.id === rid)) {
      pending.push(rid)
      continue
    }
    // Áthelyezés (9.7): a FlightLoggerben átírták (vagy a már nem létező helyett újat vettek fel)
    // erre a helyre: a jelölés lezárul, az igény itt rögzített.
    if (proposal.change?.kind === 'move' && next.flChanges?.[rid]?.kind === 'move') {
      if (parts.size < (needed.get(rid) ?? 1)) {
        pending.push(rid)
        continue
      }
      const id = bookingOf.get(rid)
      next = completeMove(next, rid, proposal.slot, nowIso, id ? id : updated.has(rid) ? undefined : null)
      recorded.push(rid)
      moved.push(rid)
      continue
    }
    if (next.recording[rid] === 'recorded') {
      already.push(rid)
      continue
    }
    if (parts.size < (needed.get(rid) ?? 1)) {
      pending.push(rid)
      continue
    }
    next = setRecordingStatus(next, rid, 'recorded', proposal.slot, nowIso, bookingOf.get(rid) ?? undefined)
    recorded.push(rid)
  }
  return { plan: next, recorded, moved, cancelled, already, pending, skipped: [...skipped].filter((rid) => !createdParts.has(rid)) }
}
