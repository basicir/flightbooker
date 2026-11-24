import type { BookingRequest, HardCode, PlanResult, PlanWarning, Proposal, Slot } from '../model/planning'
import type { LectureInfo, StudentProgress } from '../progress/lectures'
import type { IsoDateTime } from '../model/time'
import { MINUTE_MS, toMs } from '../time/zoned'
import { MARGINAL_RAW } from '../weather/rating'
import { linkBookings, withoutSuperseded } from './bookingLink'
import { PlanningContext, type Evaluation, type Times } from './context'
import { deferredRequestIds, differences, effectiveChanges, type PlanInput } from './plan'
import { criteriaFor } from './scoring'
import { trialPlan, withoutDeferral } from './trial'
import { betterTeamCandidate, flightLoggerTeams, teamCandidates, type ActiveTeam, type TeamCandidate } from './teams'

/**
 * Hét közbeni figyelés (6. fejezet 9. lépés, TRV-15): a FlightLoggerben már lefoglalt és a
 * halasztott igények újraértékelése a friss adattal. A rendszer a tervet magától nem
 * módosítja (a FlightLoggert csak olvassa, ALP-03), hanem egyenként, a lehető legkevesebb
 * módosítással javasol változtatást:
 *
 * - **Áthelyezés, sürgős:** a foglalás helyén azóta új akadály van (az iskolai minimum alatti
 *   idő 0–2 napon belül, a gép, az oktató vagy a növendék foglalt, karbantartás, tiltott
 *   időszak, kirepülhető keret), vagy jóváhagyást igénylő figyelmeztetés (limit-túllépés,
 *   kettős foglalás, ráérésen kívül). A legjobb tiszta hely kerül ajánlásra; repülésnél előbb
 *   a repülhető idejűek, aztán a bizonytalanok.
 * - **Áthelyezés, javasolt:** repülésnél a foglalás idejére bizonytalan vagy rossz idő várható,
 *   máshol pedig repülhető, és az időjárás részpontja (a távolság szerinti megbízhatósággal) legalább
 *   `WATCH_MIN_WEATHER_GAIN`-nel jobb. A „sokkal jobb lett az idő” így csak akkor mozdít, ha a
 *   mostani hely kockázatos; jó helyen lévő foglalást nem mozgat.
 * - **Kockázat:** a sürgős esetben nincs tiszta hely a héten: lemondás és halasztás, vagy marad.
 * - **Visszahozás:** ha a halasztás nélkül a motor a következő `WATCH_RESTORE_DAYS` napban (a
 *   megbízható előrejelzés távján, 7.4) tiszta helyre tenné a halasztott igényt (TRV-17),
 *   repülésnél repülhető időre. A még nem rögzített tervezett igények ehhez a motor szabályai
 *   szerint igazodnak; akit ez kiszorít, azt a javaslat megnevezi. A távolabbi napokra a
 *   hétvégi tervezés dönt, ott a halasztás szándékos.
 * - **Eltérés (9.6):** rögzítettnek jelölt igény, amelynek a foglalása nincs a FlightLoggerben,
 *   illetve halasztott igény, amelynek a foglalása még megvan.
 *
 * Minden javaslat a mostani állapothoz képest önálló (egy foglalás egy változtatása), így
 * egyenként elfogadható; az elfogadás csak a foglalási tervbe teszi: az igény rendes tervezett
 * tétel lesz FlightLogger-jelöléssel (`PlannedChange`), a FlightLoggerben a rögzítési listáról kell
 * elvégezni. Elfogadás után a figyelés újraszámol. A javaslat legalább
 * `WATCH_NOTICE_MINUTES` múlva kezdődő helyre szól, és csak a még el nem kezdődött foglalást
 * mozdítja. Ha ugyanarra a helyre több javaslat is szól, az elsőt elfogadva a többi frissül.
 * A „marad így” elutasítás a foglalás helyéhez kötődik: ha a foglalás mozdul, megszűnik.
 */

/** Ennyi idővel előre szólhat legkorábban a javaslat (a növendéknek ide kell érnie). */
export const WATCH_NOTICE_MINUTES = 120
/** A halasztott igény visszahozása legfeljebb ennyi nappal előre (a megbízható előrejelzés távja). */
export const WATCH_RESTORE_DAYS = 2
/** A javasolt áthelyezéshez ennyivel jobb időjárási részpont kell (0–1 skálán). */
export const WATCH_MIN_WEATHER_GAIN = 0.3

/** Repülésnél az időjárás a foglalás idejére, az indítópult jelöléseivel. */
export type WatchWeather = 'flyable' | 'marginal' | 'unflyable' | 'unknown'

export type WatchItem =
  | {
      readonly kind: 'move'
      readonly requestId: string
      readonly bookingId: string
      readonly from: Slot
      readonly to: Slot
      /** Új akadály a mostani helyen (nem csak jobb idő máshol). */
      readonly urgent: boolean
      /** Mi a baj a mostani hellyel. */
      readonly reasons: readonly string[]
      /** Az új hely előnyei és hátrányai a feltételek szerint (9.2). */
      readonly pros: readonly string[]
      readonly cons: readonly string[]
      readonly weather?: { readonly from: WatchWeather; readonly to: WatchWeather }
      /**
       * Közös briefing csapat áthelyezése (KBR-11): a csapat minden tagja együtt mozog (a
       * `requestId`, a `from` és a `to` az első tagé). A FlightLoggerben lévő tag foglalását át kell
       * írni; a csak tervben lévő tag a csapattal megy. `teamId`: a terv csapata; ha nincs, a
       * FlightLoggerben közös kezdéssel felvett foglalásokból elfogadáskor csapat lesz.
       */
      readonly team?: {
        readonly key: string
        readonly teamId?: string
        readonly members: ReadonlyArray<{ readonly requestId: string; readonly bookingId?: string; readonly from: Slot; readonly to: Slot }>
      }
      /** A tag a csapatból kiválva kerül át (a csapat egyben sehol nem fér be): a terv csapata. */
      readonly leavesTeam?: string
    }
  | {
      readonly kind: 'atRisk'
      readonly requestId: string
      readonly bookingId: string
      readonly from: Slot
      readonly reasons: readonly string[]
      readonly weather?: WatchWeather
    }
  | {
      readonly kind: 'restore'
      readonly requestId: string
      readonly to: Slot
      readonly weather?: WatchWeather
      readonly score: number
      /** A még nem rögzített tervezett igények, amelyek a visszahozás miatt kiszorulnának a tervből. */
      readonly displaced: readonly string[]
      /** A tervezett igények, amelyek a visszahozás miatt máshová kerülnének. */
      readonly moved: readonly string[]
    }
  /** `cancelled`: a foglalást a FlightLoggerben lemondták (nem csak nem található). */
  | { readonly kind: 'missing'; readonly requestId: string; readonly slot: Slot; readonly cancelled?: true }
  | { readonly kind: 'stillBooked'; readonly requestId: string; readonly bookingId: string; readonly slot: Slot }

export interface WatchDismissal {
  readonly requestId: string
  /** `capacity`: a „van még hely” jelzés elutasítása a napra (`from`: a nap kezdete, KIT-07). */
  readonly kind: 'improve' | 'problem' | 'restore' | 'missing' | 'capacity'
  /** Az érintett foglalás (vagy rögzített hely) kezdete az elutasításkor. */
  readonly from?: IsoDateTime
}

export interface WatchOptions {
  readonly dismissals?: readonly WatchDismissal[]
  /** Halasztott igények, amelyek nem hozhatók vissza (a következő héten már döntöttek róluk). */
  readonly noRestore?: readonly string[]
  /**
   * A „van még hely” kereséshez (KIT-07) a feladatlista és a növendékek haladása; nélküle a
   * figyelés nem keres helyet (lásd `watchWithCapacity`).
   */
  readonly capacity?: {
    readonly catalog: Readonly<Record<string, LectureInfo>>
    readonly progress: Readonly<Record<string, StudentProgress | undefined>>
  }
}

/** A következő napokban beférő plusz igények összefoglalója (KIT-07). */
export interface WatchCapacity {
  /** A beférő növendékek a helykereső sorrendjében, a lehetőségeik számával és a legkorábbi hellyel. */
  readonly students: ReadonlyArray<{ readonly studentId: string; readonly options: number; readonly first: Slot }>
  /** Ennyi napra előre keresett. */
  readonly days: number
  /** A mai nap kezdete: a „Most nem” elutasítás erre szól. */
  readonly dismissFrom: IsoDateTime
}

export interface WeekWatch {
  readonly items: readonly WatchItem[]
  /** Hány még el nem kezdődött FlightLogger-foglalást és halasztott igényt nézett meg. */
  readonly watched: { readonly booked: number; readonly deferred: number }
  /** Van még hely a következő napokban (a visszahozható halasztott igényeket visszahozottnak véve). */
  readonly capacity?: WatchCapacity
}

/**
 * Új akadályok: ezek a foglalás óta változhattak. A nyitvatartás, a munkaidő, az időablak, a
 * napszak és a teremméret a foglaláskor is ugyanilyen volt, azt az oktató tudatosan vállalta.
 */
const CHANGING: ReadonlySet<HardCode> = new Set(['weather', 'instructorBusy', 'studentBusy', 'aircraftBusy', 'roomBusy', 'resource', 'reserve', 'blocked'])
const APPROVAL: ReadonlySet<PlanWarning['kind']> = new Set(['limitExceeded', 'doubleBooking', 'outsideAvailability'])

const WEATHER_TEXT: Readonly<Record<WatchWeather, string>> = {
  flyable: 'repülhető',
  marginal: 'bizonytalan',
  unflyable: 'nem repülhető',
  unknown: 'még nincs előrejelzés',
}

export function watchWeatherText(w: WatchWeather): string {
  return WEATHER_TEXT[w]
}

/** Repülésnél az időjárás a foglalás idejére (a figyelés és a helykeresés besorolása). */
export function weatherOf(e: Evaluation): WatchWeather | undefined {
  if (e.request.kind !== 'flight') return undefined
  if (e.hardCodes.includes('weather')) return 'unflyable'
  if (!e.weatherKnown) return 'unknown'
  if (e.weatherRaw <= 0) return 'unflyable'
  return e.weatherRaw < MARGINAL_RAW ? 'marginal' : 'flyable'
}

const weatherSub = (e: Evaluation): number => e.subScores.weatherFlight ?? 0.5

const better = (a: Evaluation, b: Evaluation): boolean =>
  a.weighted.score !== b.weighted.score
    ? a.weighted.score > b.weighted.score
    : a.times.startMs !== b.times.startMs
      ? a.times.startMs < b.times.startMs
      : (a.times.resourceId ?? a.times.classroomId ?? '') < (b.times.resourceId ?? b.times.classroomId ?? '')

const bestOf = (list: readonly Evaluation[]): Evaluation | undefined => (list.length === 0 ? undefined : list.reduce((x, y) => (better(x, y) ? x : y)))

const samePlace = (a: Times, b: Times): boolean => a.flightStartMs === b.flightStartMs && a.resourceId === b.resourceId && a.classroomId === b.classroomId

const ORDER: Readonly<Record<WatchItem['kind'], number>> = { move: 0, atRisk: 0, missing: 1, stillBooked: 2, restore: 4 }
const rank = (i: WatchItem): number => (i.kind === 'move' && !i.urgent ? 3 : ORDER[i.kind])
const startOf = (i: WatchItem): string => (i.kind === 'move' || i.kind === 'atRisk' ? i.from.start : i.kind === 'restore' ? i.to.start : i.slot.start)

export function watchWeek(input: PlanInput, base: PlanResult, options: WatchOptions = {}): WeekWatch {
  const items: WatchItem[] = []
  const byId = new Map(input.requests.map((r) => [r.id, r]))
  const dismissed = (requestId: string, kind: WatchDismissal['kind'], from?: string): boolean =>
    (options.dismissals ?? []).some((d) => d.requestId === requestId && d.kind === kind && (kind === 'restore' || (d.from !== undefined && from !== undefined && toMs(d.from) === toMs(from))))

  // Eltérések (9.6): rögzített, de nincs meg; halasztott, de még foglalt.
  const recordedSlot = new Map((input.recorded ?? []).map((r) => [r.requestId, r.slot]))
  const cancelled = new Set(base.cancelledInFlightLogger)
  for (const id of base.missingInFlightLogger) {
    const slot = recordedSlot.get(id)
    if (slot && !dismissed(id, 'missing', slot.start)) items.push({ kind: 'missing', requestId: id, slot, ...(cancelled.has(id) ? { cancelled: true as const } : {}) })
  }
  for (const s of base.deferredStillBooked) items.push({ kind: 'stillBooked', requestId: s.requestId, bookingId: s.bookingId, slot: s.slot })

  const linked = linkBookings({ snapshot: input.snapshot, requests: input.requests, recorded: input.recorded ?? [], deferred: deferredRequestIds(input), changes: effectiveChanges(input) })
  const nowMs = Math.max(toMs(input.snapshot.generatedAt), input.options?.now ? toMs(input.options.now) : Number.NEGATIVE_INFINITY)
  const noticeMs = nowMs + WATCH_NOTICE_MINUTES * MINUTE_MS
  const booked = base.recordedInFlightLogger.filter((b) => byId.has(b.requestId) && toMs(b.slot.start) >= noticeMs)
  // A tervbe tett lemondás „mégsem”-mel vonható vissza, nem visszahozással.
  const stillBooked = new Set([...base.deferredStillBooked.map((s) => s.requestId), ...base.plannedCancels.map((c) => c.requestId)])
  const noRestore = new Set(options.noRestore ?? [])
  const deferred = base.deferred.filter((id) => byId.has(id) && !stillBooked.has(id) && !noRestore.has(id))
  const watched = { booked: booked.length, deferred: deferred.length }
  if (booked.length === 0 && deferred.length === 0) return { items: sortItems(items), watched }

  // A figyelt foglalások a terv elhelyezései közé kerülnek (a saját FlightLogger-foglalásuk
  // helyett), így a motor ugyanazokkal a szabályokkal mérheti a mostani és a többi helyet.
  // A mostani hely a viszonyítási alap a terv stabilitásához (TRV-18).
  const reviewed = new Set(booked.map((b) => b.bookingId))
  const planningSnapshot = withoutSuperseded(input.snapshot, linked.superseded)
  const snapshot = {
    ...planningSnapshot,
    bookings: planningSnapshot.bookings.filter((b) => !reviewed.has(b.id)),
    previousPlan: { ...(input.snapshot.previousPlan ?? {}), ...Object.fromEntries(booked.map((b) => [b.requestId, b.slot])) },
  }
  const ctx = new PlanningContext(snapshot, input.settings, input.requests, input.options)
  // Közös briefing csapatok (KBR-10, KBR-11): a terv csapatainak és a FlightLoggerben közös
  // kezdéssel felvett foglalásoknak a tagjai egymással nem ütköznek, és együtt mozognak.
  const flTeams = flightLoggerTeams(input.snapshot.bookings)
  const planTeamOf = new Map<string, string>()
  for (const t of base.teams) for (const id of t.requestIds) planTeamOf.set(id, t.teamId)
  const watchTeamOf = new Map<string, string>()
  for (const [id, t] of planTeamOf) watchTeamOf.set(id, `plan:${t}`)
  for (const b of booked) {
    const g = flTeams.get(b.bookingId)
    if (g !== undefined && !watchTeamOf.has(b.requestId)) watchTeamOf.set(b.requestId, g)
  }
  ctx.setTeams(watchTeamOf)
  // Feladatsorrend (ELS-05): az áthelyezés sem bonthatja meg; a figyelt foglalások a terv
  // elhelyezései, a többi FlightLogger-foglalás a saját helyén áll.
  ctx.setSequences(input.sequences ?? [], base.recordedInFlightLogger)
  // A terv helyei a motorpróbával együtt már a végleges időt mutatják; a FlightLogger-foglalás
  // kezdete marad (így a terv stabilitása „változatlan” a saját helyén).
  for (const p of base.proposals) {
    const request = byId.get(p.requestId)
    if (!request || p.standby) continue
    ctx.place({ request, times: ctx.timesOfSlot(p.slot), standby: false, keep: request.timing?.kind === 'fixed' ? 'start' : 'flight' })
  }
  for (const b of booked) ctx.place({ request: byId.get(b.requestId)!, times: ctx.timesOfSlot(b.slot), standby: false, keep: 'start' })
  for (const p of base.proposals) {
    const request = byId.get(p.requestId)
    if (!request || !p.standby) continue
    ctx.place({ request, times: ctx.timesOfSlot(p.slot), standby: true, ...(p.pairedRequestId ? { pairedRequestId: p.pairedRequestId } : {}) })
  }

  /** Az igény tiszta helyei a héten, legkorábban a figyelmeztetési idő után. */
  const cleanSlots = (request: BookingRequest): Evaluation[] => {
    const anchors = ctx.anchorsFor(request)
    const result: Evaluation[] = []
    for (const r of ctx.resourcesFor(request)) {
      const extra = r.resourceId ? ctx.gapAnchorsFor(request, r.resourceId) : []
      const list = extra.length > 0 ? [...new Set([...anchors, ...extra])].sort((a, b) => a - b) : anchors
      for (const anchor of list) {
        const times = ctx.timesAt(request, anchor, r.resourceId, r.classroomId)
        if (times.startMs < noticeMs) continue
        const e = ctx.evaluateCandidate(request, times)
        if (e && !e.needsApproval) result.push(e)
      }
    }
    return result
  }
  const criteria = (r: BookingRequest) => criteriaFor(r.kind, true)

  // ---------- A lefoglalt igények ----------
  type Booked = (typeof booked)[number]
  const problemsOf = (e: Evaluation): string[] => [
    ...new Set([...e.hardDetails.filter((h) => CHANGING.has(h.code)).map((h) => h.message), ...e.warnings.filter((w) => APPROVAL.has(w.kind)).map((w) => w.message)]),
  ]

  /**
   * Egy lefoglalt igény figyelése. `detach`: a csapatból kiválva (a csapat egyben sehol nem fér
   * be); ilyenkor az okok a csapaté, és az elfogadás a terv csapatából is kiveszi.
   */
  const watchOne = (b: Booked, detach?: { readonly reasons: readonly string[]; readonly teamId?: string }): void => {
    const request = byId.get(b.requestId)!
    const current = ctx.reevaluate(request.id)
    const currentTimes = ctx.timesOf(request.id)
    if (!current || !currentTimes) return
    const problems = detach ? [...detach.reasons] : problemsOf(current)
    const weatherNow = weatherOf(current)
    const risky = weatherNow === 'marginal' || weatherNow === 'unflyable'
    if (problems.length === 0 && !risky) return
    const urgent = problems.length > 0
    if (!detach && dismissed(request.id, urgent ? 'problem' : 'improve', b.slot.start)) return

    ctx.unplace(request.id)
    const options = cleanSlots(request).filter((e) => !samePlace(e.times, currentTimes))
    ctx.place({ request, times: currentTimes, standby: false, keep: 'start' })

    let target: Evaluation | undefined
    if (urgent) {
      // Repülésnél előbb a repülhető, aztán a bizonytalan idejű helyek; a többi fajtánál bármelyik tiszta.
      const tiers =
        request.kind === 'flight'
          ? [options.filter((e) => weatherOf(e) === 'flyable'), options.filter((e) => weatherOf(e) !== 'unflyable')]
          : [options]
      for (const tier of tiers) {
        target = bestOf(tier)
        if (target) break
      }
    } else {
      target = bestOf(options.filter((e) => weatherOf(e) === 'flyable' && weatherSub(e) - weatherSub(current) >= WATCH_MIN_WEATHER_GAIN))
    }

    const reasons = urgent ? problems : [`A foglalás idejére ${WEATHER_TEXT[weatherNow!]} az idő az előrejelzés szerint.`]
    if (!target) {
      if (urgent) items.push({ kind: 'atRisk', requestId: request.id, bookingId: b.bookingId, from: b.slot, reasons, ...(weatherNow ? { weather: weatherNow } : {}) })
      return
    }
    const diff = differences(target, current, criteria(request), input.settings.weights)
    const weatherTo = weatherOf(target)
    items.push({
      kind: 'move',
      requestId: request.id,
      bookingId: b.bookingId,
      from: b.slot,
      to: ctx.slotOf(target.times, request),
      urgent,
      reasons: detach ? [...reasons, 'A csapat egyben a héten sehol nem fér be: a tag kiválva, egyénileg kerül át.'] : reasons,
      pros: diff.pros,
      cons: diff.cons,
      ...(weatherNow && weatherTo ? { weather: { from: weatherNow, to: weatherTo } } : {}),
      ...(detach?.teamId ? { leavesTeam: detach.teamId } : {}),
    })
  }

  const WEATHER_RANK: Readonly<Record<WatchWeather, number>> = { flyable: 0, unknown: 1, marginal: 2, unflyable: 3 }
  const worst = (list: ReadonlyArray<WatchWeather | undefined>): WatchWeather | undefined =>
    list.reduce<WatchWeather | undefined>((w, x) => (x === undefined ? w : w === undefined || WEATHER_RANK[x] > WEATHER_RANK[w] ? x : w), undefined)

  /**
   * Egy közös briefing csapat együttes figyelése (KBR-11): ha egy tag helyén új akadály van (vagy
   * kockázatos az idő), a javaslat a csapat áthelyezése, egy javaslatként. Ha a csapat egyben
   * sehol nem fér be, a gondban lévő tagok kiválva, egyenként kapnak javaslatot.
   */
  const watchTeam = (key: string, members: ReadonlyArray<{ readonly requestId: string; readonly bookingId?: string; readonly slot: Slot }>): void => {
    const sorted = [...members].sort((a, b) => toMs(a.slot.flightStart ?? a.slot.start) - toMs(b.slot.flightStart ?? b.slot.start) || a.requestId.localeCompare(b.requestId))
    const state = sorted.map((m) => {
      const current = ctx.reevaluate(m.requestId)
      return { m, request: byId.get(m.requestId)!, current, times: ctx.timesOf(m.requestId), problems: current ? problemsOf(current) : [], weather: current ? weatherOf(current) : undefined }
    })
    if (state.some((x) => !x.current || !x.times)) return
    const inFlightLogger = state.filter((x) => x.m.bookingId !== undefined)
    const urgent = state.some((x) => x.problems.length > 0)
    const weatherNow = worst(state.map((x) => x.weather))
    const risky = weatherNow === 'marginal' || weatherNow === 'unflyable'
    if (!urgent && !risky) return
    const first = inFlightLogger[0] ?? state[0]!
    if (dismissed(first.m.requestId, urgent ? 'problem' : 'improve', first.m.slot.start)) return
    const teamId = planTeamOf.get(first.m.requestId)
    const reasons = urgent
      ? [...new Set(state.flatMap((x) => x.problems.map((p) => `«req:${x.request.id}»: ${p}`)))]
      : [`A csapat foglalásainak idejére ${WEATHER_TEXT[weatherNow!]} az idő az előrejelzés szerint.`]

    const team: ActiveTeam = {
      id: key,
      members: state.map((x) => x.request),
      recorded: [],
      briefing: Math.max(...state.map((x) => x.request.durations.briefing)),
      debriefing: Math.max(...state.map((x) => x.request.durations.debriefing)),
    }
    const startNow = Math.min(...state.map((x) => x.times!.startMs))
    for (const x of state) ctx.unplace(x.request.id)
    const all = teamCandidates(ctx, team, input.settings.defaults.teamSwapMinutes, state.map((x) => x.times!.resourceId)).filter(
      (c) => c.clean && c.layout.startMs >= noticeMs && c.layout.startMs !== startNow,
    )
    const flights = (c: TeamCandidate, ok: (w: WatchWeather | undefined) => boolean): boolean => c.evaluations.every((e) => e.request.kind !== 'flight' || ok(weatherOf(e)))
    const gain = (c: TeamCandidate): number => c.evaluations.reduce((sum, e, i) => sum + weatherSub(e) - weatherSub(state[i]!.current!), 0) / Math.max(1, c.evaluations.length)
    const tiers = urgent
      ? [all.filter((c) => flights(c, (w) => w === 'flyable')), all.filter((c) => flights(c, (w) => w !== 'unflyable'))]
      : [all.filter((c) => flights(c, (w) => w === 'flyable') && gain(c) >= WATCH_MIN_WEATHER_GAIN)]
    let target: { readonly c: TeamCandidate; readonly evaluations: readonly Evaluation[] } | undefined
    for (const tier of tiers) {
      const ordered = [...tier].sort((a, b) => (betterTeamCandidate(a, b) ? -1 : betterTeamCandidate(b, a) ? 1 : 0))
      // A legjobbak közül az első, amely a csapattársakkal együtt (limitek) is tiszta.
      for (const c of ordered.slice(0, 5)) {
        for (const x of state) ctx.place({ request: x.request, times: c.layout.times.get(x.request.id)!, standby: false })
        const evaluations = state.map((x) => ctx.reevaluate(x.request.id)!)
        for (const x of state) ctx.unplace(x.request.id)
        if (evaluations.every((e) => e.hardViolations.length === 0 && !e.needsApproval)) {
          target = { c, evaluations }
          break
        }
      }
      if (target) break
    }
    for (const x of state) ctx.place({ request: x.request, times: x.times!, standby: false, keep: 'start' })

    if (target) {
      const i = state.indexOf(first)
      const diff = differences(target.evaluations[i]!, first.current!, criteria(first.request), input.settings.weights)
      const weatherTo = worst(target.evaluations.map(weatherOf))
      items.push({
        kind: 'move',
        requestId: first.m.requestId,
        bookingId: first.m.bookingId!,
        from: first.m.slot,
        to: ctx.slotOf(target.c.layout.times.get(first.m.requestId)!, first.request),
        urgent,
        reasons,
        pros: diff.pros,
        cons: diff.cons,
        ...(weatherNow && weatherTo ? { weather: { from: weatherNow, to: weatherTo } } : {}),
        team: {
          key,
          ...(teamId !== undefined ? { teamId } : {}),
          members: state.map((x) => ({ requestId: x.request.id, ...(x.m.bookingId !== undefined ? { bookingId: x.m.bookingId } : {}), from: x.m.slot, to: ctx.slotOf(target.c.layout.times.get(x.request.id)!, x.request) })),
        },
      })
      return
    }
    if (!urgent) return
    // A csapat egyben nem fér be: a FlightLoggerben lévő, gondban lévő tagok kiválva, egyenként.
    for (const x of inFlightLogger.filter((y) => y.problems.length > 0)) {
      const b = booked.find((y) => y.requestId === x.request.id)
      if (!b) continue
      const without = new Map(watchTeamOf)
      without.delete(x.request.id)
      ctx.setTeams(without)
      watchOne(b, { reasons: x.problems, ...(teamId !== undefined ? { teamId } : {}) })
      ctx.setTeams(watchTeamOf)
    }
  }

  // A csapatok tagjai együtt: a FlightLoggerben lévők és a terv csapatának még csak tervben lévő tagjai.
  const groups = new Map<string, Array<{ readonly requestId: string; readonly bookingId?: string; readonly slot: Slot }>>()
  for (const b of booked) {
    const key = watchTeamOf.get(b.requestId)
    if (key !== undefined) groups.set(key, [...(groups.get(key) ?? []), b])
  }
  const bookedIds = new Set(booked.map((b) => b.requestId))
  const plannedMembers = (key: string): Proposal[] => base.proposals.filter((p) => !p.standby && p.teamId !== undefined && `plan:${p.teamId}` === key && !bookedIds.has(p.requestId))
  const inTeams = new Set<string>()
  for (const [key, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const planned = plannedMembers(key)
    // A rögzített, de még le nem hozott tag helye le van zárva: a csapat nem mozdítható egyben.
    if (planned.some((p) => p.recorded) || list.length + planned.length < 2) continue
    for (const m of list) inTeams.add(m.requestId)
    watchTeam(key, [...list, ...planned.map((p) => ({ requestId: p.requestId, slot: p.slot }))])
  }
  for (const b of [...booked].sort((x, y) => x.slot.start.localeCompare(y.slot.start) || x.requestId.localeCompare(y.requestId))) {
    if (!inTeams.has(b.requestId)) watchOne(b)
  }

  // ---------- A halasztott igények visszahozása ----------
  // Ugyanaz a motor dönt, mintha nem halasztották volna: a még nem rögzített tervezett igények
  // nem foglalják el előle a helyet, de ha kiszorulnak vagy elmozdulnak, a javaslat megnevezi
  // őket. A próba ugyanaz, mint a plusz igény felvételénél (`trialPlan`, KIT-08).
  for (const id of deferred) {
    if (dismissed(id, 'restore')) continue
    const request = byId.get(id)!
    const trial = trialPlan({ input, result: base }, withoutDeferral(input, id), id)
    const p = trial.placed
    if (!p || toMs(p.slot.start) < noticeMs) continue
    const e = ctx.evaluate(request, ctx.timesOfSlot(p.slot), 'forced')
    if (!e || e.leadDays > WATCH_RESTORE_DAYS) continue
    const w = weatherOf(e)
    if (request.kind === 'flight' && w !== 'flyable') continue
    items.push({ kind: 'restore', requestId: id, to: p.slot, score: p.score, displaced: trial.displaced, moved: trial.moved.map((m) => m.requestId), ...(w ? { weather: w } : {}) })
  }

  return { items: sortItems(items), watched }
}

function sortItems(items: readonly WatchItem[]): WatchItem[] {
  return [...items].sort((a, b) => rank(a) - rank(b) || startOf(a).localeCompare(startOf(b)) || a.requestId.localeCompare(b.requestId))
}

/** A figyelés elutasítási fajtája egy javaslathoz, és a foglalás kezdete, amelyhez kötődik. */
export function dismissalOf(item: WatchItem): { readonly kind: WatchDismissal['kind']; readonly from?: string } | undefined {
  switch (item.kind) {
    case 'move':
      return { kind: item.urgent ? 'problem' : 'improve', from: item.from.start }
    case 'atRisk':
      return { kind: 'problem', from: item.from.start }
    case 'restore':
      return { kind: 'restore' }
    case 'missing':
      return { kind: 'missing', from: item.slot.start }
    case 'stillBooked':
      return undefined
  }
}
