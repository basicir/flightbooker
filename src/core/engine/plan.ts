import type { Settings } from '../config/schema'
import { CRITERION_LABELS, type Criterion } from '../model/criteria'
import type {
  BookedInFlightLogger,
  BookingRequest,
  Decision,
  DecisionIssue,
  Dilemma,
  DilemmaOption,
  HardCode,
  PlannedTeam,
  PlanResult,
  PlanWarning,
  Proposal,
  Slot,
  UnplacedRequest,
} from '../model/planning'
import { theoryHeadcount } from '../model/planning'
import type { Snapshot } from '../model/snapshot'
import { WEEKDAY_LABELS } from '../model/time'
import { addDays, localParts, localToMs, MINUTE_MS, overlaps, toIso, toMs } from '../time/zoned'
import { linkBookings, withoutSuperseded, type PlannedChange, type RecordedEntry } from './bookingLink'
import { HARD_CODE_LABELS, hoursText, PlanningContext, type Evaluation, type PlanOptions, type Times } from './context'
import { advantage, criteriaFor, topFactors } from './scoring'
import { requestPriorityOf } from '../config/operations'
import { activeTeams, betterTeamCandidate, layoutTeam, resourceVariants, teamCandidates, teamUnits, type ActiveTeam, type TeamCandidate, type TeamLayout } from './teams'

/**
 * A foglalási motor (7. és 9. fejezet). Egyetlen determinisztikus, tiszta függvény:
 * a dilemmák élő frissítése (TRV-08), a döntés visszavonása (TRV-12) és a hét közbeni
 * újratervezés (TRV-18) mind ugyanennek a függvénynek az újrafuttatása más döntéslistával.
 *
 * Mohó elhelyezés: mindig a legnehezebben elhelyezhető igény kerül sorra (7.1), a
 * legjobb helyére. Ha egy másik igény ugyanazt a helyet akarja, és a súlyozott előny a
 * dilemma-küszöb alatt van, dilemma keletkezik (9.1); az ajánlás ideiglenesen elhelyeződik,
 * hogy a további tervezés következetes maradjon.
 *
 * A szövegekben a `«req:ID»` jelölőt a felület cseréli a növendék nevére és a feladatra.
 */

export interface PlanInput {
  readonly snapshot: Snapshot
  readonly settings: Settings
  readonly requests: readonly BookingRequest[]
  readonly decisions: readonly Decision[]
  /**
   * A rögzítési listán „rögzítve” jelölt igények a rögzítéskori helyükkel (H02). Ha a
   * FlightLoggerben már megvan a foglalás, az igény kimarad a tervezésből; ha még nincs
   * (a frissítés előtt), a hely le van zárva. A párosítás szabályai: `linkBookings`.
   */
  readonly recorded?: readonly RecordedEntry[]
  /**
   * FlightLogger-jelölések (9.7): az igénynek már van FlightLogger-foglalása, amelyet a terv
   * szerinti helyre át kell írni, vagy (halasztott igénynél) le kell mondani. Az igény rendes
   * tervezett tétel; a régi FlightLogger-hely nem foglal.
   */
  readonly changes?: readonly PlannedChange[]
  /**
   * Feladatsorrend (ELS-05): növendékenként az automatikus feladatú igények sorban
   * (`lectureSequences`). A motor időben is ezt a sorrendet tartja.
   */
  readonly sequences?: ReadonlyArray<readonly string[]>
  readonly options?: PlanOptions
}

interface Placed {
  readonly evaluation: Evaluation
  readonly decidedBy: Proposal['decidedBy']
  readonly standby: boolean
  dilemmaId?: string
  readonly recorded?: boolean
  readonly pairedRequestId?: string
}

const req = (id: string): string => `«req:${id}»`

/** A jóváhagyást igénylő figyelmeztetések súlya (H22): a legenyhébbet ajánljuk. */
function warningSeverity(e: Evaluation): number {
  let total = 0
  for (const w of e.warnings) {
    if (w.kind === 'limitExceeded') total += 3
    else if (w.kind === 'doubleBooking') total += 2
    else if (w.kind === 'outsideAvailability') total += w.message.includes('nem elérhető') ? 2 : 1
  }
  return total
}

/** A halasztott igények a döntések szerint (a rögzítettekre a döntés nem hat). */
export function deferredRequestIds(input: Pick<PlanInput, 'decisions' | 'recorded'>): Set<string> {
  const recorded = new Set((input.recorded ?? []).map((r) => r.requestId))
  return new Set(input.decisions.filter((d) => d.kind === 'defer' && !recorded.has(d.requestId)).map((d) => d.requestId))
}

/**
 * Az érvényes FlightLogger-jelölések: a lemondás csak halasztott igénynél áll (ha a halasztást
 * visszavonták, a foglalás marad, ahol van).
 */
export function effectiveChanges(input: Pick<PlanInput, 'changes' | 'decisions'>): PlannedChange[] {
  const deferredIds = new Set(input.decisions.filter((d) => d.kind === 'defer').map((d) => d.requestId))
  return (input.changes ?? []).filter((c) => c.kind !== 'cancel' || deferredIds.has(c.requestId))
}

/**
 * A terv szerinti hely ugyanaz-e, mint a FlightLogger-foglalásé: azonos gép (terem), és a kezdés
 * legfeljebb fél órával tér el. Ilyenkor nincs mit átírni a FlightLoggerben.
 */
const SAME_PLACE_TOLERANCE_MS = 30 * MINUTE_MS
function samePlaceAs(a: Slot, b: Slot): boolean {
  return a.resourceId === b.resourceId && a.classroomId === b.classroomId && Math.abs(toMs(a.start) - toMs(b.start)) <= SAME_PLACE_TOLERANCE_MS
}

/**
 * Az oktató napjának összetételétől függő feltételek: ha két igény ugyanarra a helyre pályázik,
 * ezek a sorrendtől függetlenül ugyanúgy alakulnak (akárki kerül másodiknak, az oktató napja
 * ugyanannyira hosszabb, ugyanúgy folyamatos), ezért a verseny veszteségébe nem számítanak.
 */
const ORDER_INDEPENDENT: ReadonlySet<Criterion> = new Set<Criterion>(['instructorLoad', 'instructorContinuity', 'avoidFirstFlight'])

export function plan(input: PlanInput): PlanResult {
  // A FlightLogger-foglalások párosítása (9.6): a már lefoglalt igény nem kerül újra tervbe.
  const deferredIds = deferredRequestIds(input)
  const linked = linkBookings({ snapshot: input.snapshot, requests: input.requests, recorded: input.recorded ?? [], deferred: deferredIds, changes: effectiveChanges(input) })
  const ctx = new PlanningContext(withoutSuperseded(input.snapshot, linked.superseded), input.settings, input.requests, input.options)
  const requests = [...input.requests].sort((a, b) => a.id.localeCompare(b.id))
  const byId = new Map(requests.map((r) => [r.id, r]))

  // Közös briefing csapatok (KBR-01, KBR-05): a halasztott és az ezen a héten egyénileg tervezett
  // tag kimarad; a FlightLoggerben lévő (vagy rögzített) tag a csapat kezdését adja.
  const teamOff = new Set(input.decisions.filter((d) => d.kind === 'teamOff').map((d) => d.requestId))
  const recordedPlaces = new Map<string, { slot: Slot; bookingId?: string }>()
  for (const l of linked.links) recordedPlaces.set(l.requestId, { slot: l.slot, bookingId: l.bookingId })
  for (const r of [...linked.pending, ...linked.missing]) recordedPlaces.set(r.requestId, { slot: r.slot })
  const teamSetup = activeTeams({ requests, settings: input.settings, excluded: new Set([...deferredIds, ...teamOff]), recorded: recordedPlaces })
  const teamsById = new Map(teamSetup.teams.map((t) => [t.id, t]))
  const teamOf = new Map<string, string>()
  const teamBookings = new Map<string, Set<string>>()
  for (const t of teamSetup.teams) {
    for (const m of t.members) teamOf.set(m.id, t.id)
    for (const r of t.recorded) {
      teamOf.set(r.request.id, t.id)
      if (r.bookingId) teamBookings.set(t.id, new Set([...(teamBookings.get(t.id) ?? []), r.bookingId]))
    }
  }
  ctx.setTeams(teamOf, teamBookings)
  ctx.setSequences(input.sequences ?? [], linked.links)
  const swapMinutes = input.settings.defaults.teamSwapMinutes
  /** Az elhelyezett csapatok elrendezése (a rögzítési listához, KBR-09). */
  const teamLayouts = new Map<string, TeamLayout>()
  /** Csapatdöntések tagonként, a döntés sorszámával (KBR-07). */
  const teamDecisions = new Map<string, Map<string, { index: number; decision: Extract<Decision, { kind: 'assign' }> }>>()

  // A dilemma-küszöb repülésre értendő; a többi tevékenységé a súlyösszegével arányos (A4, Q10).
  const weightSum = (kind: BookingRequest['kind']): number => criteriaFor(kind, ctx.replanning).reduce((sum, c) => sum + input.settings.weights[c], 0)
  const flightWeights = weightSum('flight')
  const thresholdFor = (kind: BookingRequest['kind']): number => {
    const base = input.settings.planning.dilemmaThreshold
    return flightWeights > 0 ? (base * weightSum(kind)) / flightWeights : base
  }

  const placed = new Map<string, Placed>()
  const deferred = new Set<string>()
  const comments = new Map<string, string>()
  const avoided = new Map<string, Times[]>()
  const noStandby = new Set<string>()
  const dilemmas: Dilemma[] = []
  const unplaced: UnplacedRequest[] = []
  const issues: DecisionIssue[] = []
  const blockedFromLoop = new Set<string>()
  const recordedInFlightLogger: BookedInFlightLogger[] = []

  const label = (ms: number): string => {
    const p = localParts(ms, ctx.tz)
    const hh = String(Math.floor(p.minutes / 60)).padStart(2, '0')
    const mm = String(p.minutes % 60).padStart(2, '0')
    return `${WEEKDAY_LABELS[p.weekday]} ${p.date.slice(5).replace('-', '.')}. ${hh}:${mm}`
  }

  const callSign = (resourceId: string): string => ctx.snapshot.fleet.find((a) => a.id === resourceId)?.callSign ?? resourceId

  /**
   * Emberi nyelvű indoklás, miért nem kapott helyet az igény (TRV-16), és a legkevesebb
   * akadállyal járó hely, amelyre az oktató kézzel ráerőltetheti a foglalást.
   */
  const explainNoSlot = (
    request: BookingRequest,
  ): { text: string; closest?: { times: Times; codes: readonly HardCode[]; details: readonly string[] }; blockers?: ReadonlyArray<{ code: HardCode; count: number }>; closestText?: string } => {
    const d = ctx.diagnoseNoSlot(request)
    if (d.kind === 'noResource') {
      if (request.kind === 'theory') return { text: `Nincs olyan terem, amelybe ${theoryHeadcount(request)} fő (a növendékek és az oktató) befér.` }
      if (request.kind === 'simulator') return { text: 'Nincs aktív szimulátor a flottában.' }
      return { text: 'A növendékhez nincs engedélyezett aktív repülőgép (Beállítások → Növendékek).' }
    }
    const total = request.durations.briefing + request.durations.main + request.durations.debriefing
    if (d.kind === 'noTime') {
      return { text: `A héten egyik napon sem fér be a ${total} perces foglalás (briefing + fő rész + debriefing) a nyitvatartás és a munkaidő metszetébe, vagy a hét már elmúlt.` }
    }
    if (d.checked === 0) return { text: 'A héten nem helyezhető el.' }
    const parts = d.counts.map(([code, n]) => `${HARD_CODE_LABELS[code]} (${n}×)`)
    const blockers = d.counts.map(([code, count]) => ({ code, count }))
    let text = `${d.checked} lehetséges időpontot vizsgált meg${request.kind === 'theory' ? ' teremmel' : ' géppel'} együtt, egyik sem szabad. Akadályok: ${parts.join('; ')}.`
    let closestText: string | undefined
    if (d.closest) {
      const where = d.closest.times.resourceId ? `, ${callSign(d.closest.times.resourceId)}` : ''
      closestText = `Legközelebb ez állt: ${label(d.closest.times.startMs)}${where} – itt csak ez akadályozott: ${d.closest.details.join('; ')}.`
      text += ` ${closestText}`
    }
    return { text, blockers, ...(d.closest ? { closest: d.closest } : {}), ...(closestText ? { closestText } : {}) }
  }

  /** Fix időpontú igénynél a motor a foglalás kezdetét tartja (Q1); máskor a repülését. */
  const keepFor = (request: BookingRequest, decidedBy: Proposal['decidedBy']): 'flight' | 'start' =>
    decidedBy === 'engine' && request.timing?.kind === 'fixed' ? 'start' : 'flight'

  const commit = (e: Evaluation, decidedBy: Proposal['decidedBy'], standby: boolean, dilemmaId?: string, extra: { recorded?: boolean } = {}): void => {
    ctx.place({ request: e.request, times: e.times, standby, keep: keepFor(e.request, decidedBy) })
    placed.set(e.request.id, { evaluation: e, decidedBy, standby, ...(dilemmaId ? { dilemmaId } : {}), ...(extra.recorded ? { recorded: true } : {}) })
  }

  /**
   * A csapat a héten nem fér be együtt tisztán (KBR-07): dilemma. Lehetőségek: a legenyhébb
   * figyelmeztetéses hely vállalása, a tagok egyéni tervezése ezen a héten, vagy halasztás.
   */
  const teamDilemma = (team: ActiveTeam, candidates: readonly TeamCandidate[]): void => {
    const ids = team.members.map((m) => m.id)
    const names = ids.map(req).join(', ')
    const dId = `csapat:${team.id}`
    const severity = (c: TeamCandidate): number => Math.max(0, ...c.evaluations.map(warningSeverity))
    const warn = candidates
      .filter((c) => !c.clean)
      .reduce<TeamCandidate | undefined>((x, c) => (!x || severity(c) < severity(x) || (severity(c) === severity(x) && betterTeamCandidate(c, x)) ? c : x), undefined)
    const approvalKinds = new Set(['limitExceeded', 'doubleBooking', 'outsideAvailability'])
    const reasons = warn ? [...new Set(warn.evaluations.flatMap((e) => e.warnings.filter((w) => approvalKinds.has(w.kind)).map((w) => w.message)))] : []
    const where = warn ? `${label(warn.layout.startMs)}${warn.resources[0] ? `, ${callSign(warn.resources[0])}` : ''}` : ''
    const why = warn
      ? `Együtt csak figyelmeztetéssel fér be (${where}): ${reasons.join('; ') || 'figyelmeztetés'}.`
      : 'Egyik napon sem fér el együtt: a közös briefing, az egymás utáni repülések és a közös debriefing nem fér a munkaidőbe, vagy valamelyik tag minden időpontban akadályba ütközik.'
    for (const id of ids) unplaced.push({ requestId: id, reason: `A közös briefing csapat a héten nem fér be együtt. ${why}` })
    const each = (make: (id: string) => Decision): { decision: Decision; also: Decision[] } => ({ decision: make(ids[0]!), also: ids.slice(1).map(make) })
    const options: DilemmaOption[] = []
    if (warn) {
      const accept = each((id) => ({ kind: 'assign', requestId: id, slot: ctx.slotOf(warn.layout.times.get(id)!, byId.get(id)!), acceptWarnings: true, team: team.id }))
      options.push({ ...option(`${dId}:accept`, `Együtt, ${where}, a figyelmeztetés vállalásával`, ['A csapat együtt marad, a közös briefing megvan.'], reasons, 'A csapat a figyelmeztetéssel együtt kerül a tervezetbe.', accept.decision), also: accept.also })
    }
    const solo = each((id) => ({ kind: 'teamOff', requestId: id }))
    options.push({
      ...option(`${dId}:solo`, 'Ezen a héten egyénileg', ['Mindenki a saját legjobb helyére kerül.'], ['Nincs közös briefing: több oktatói idő.'], 'A tagok ezen a héten egyénileg kerülnek a tervbe; a csapat megmarad.', solo.decision),
      also: solo.also,
    })
    const later = each((id) => ({ kind: 'defer', requestId: id }))
    options.push({
      ...option(`${dId}:defer`, 'Halasztás mindenkinek a következő hétre', ['A többi foglalás változatlan marad.'], ['A csapat egy héttel később repül.'], 'A tagok igényei a következő heti listába kerülnek.', later.decision),
      also: later.also,
    })
    dilemmas.push({
      id: dId,
      type: 'team',
      requestIds: ids,
      question: 'Mi legyen a közös briefing csapattal?',
      summary: `A közös briefing csapat (${names}) a héten nem fér be együtt. ${why}`,
      headline: `A közös briefing csapat (${names}) a héten nem fér be együtt.`,
      recommendedOptionId: warn && severity(warn) <= 1 ? `${dId}:accept` : `${dId}:solo`,
      options,
      impact: 250,
    })
  }

  // ---------- 0. A FlightLoggerben már meglévő igények (H02, 9.6) ----------
  // Amit az oktató már felvitt a FlightLoggerbe (rögzítettnek jelölte, vagy a növendék és a
  // feladat alapján felismerhető), azt a motor nem tervezi újra: a FlightLogger-foglalás foglalja
  // a helyét. A rögzített, de még le nem hozott (vagy hiányzó) igény helye le van zárva.
  const recordedIds = new Set<string>()
  for (const l of linked.links) {
    if (!byId.has(l.requestId)) continue
    recordedIds.add(l.requestId)
    recordedInFlightLogger.push({ requestId: l.requestId, bookingId: l.bookingId, slot: l.slot, ...(l.recorded ? {} : { detected: true }), ...(l.moved ? { moved: true } : {}) })
  }
  for (const r of [...linked.pending, ...linked.missing].sort((a, b) => a.requestId.localeCompare(b.requestId))) {
    const request = byId.get(r.requestId)
    if (!request) continue
    recordedIds.add(request.id)
    // A rögzítés óta váltott feladat (időtartam) a lezárt hely hosszát is igazítja.
    const e = ctx.evaluate(request, ctx.timesOfRecorded(request, r.slot), 'forced')!
    commit(e, 'instructor', false, undefined, { recorded: true })
  }
  // A FlightLogger-jelölt igények (9.7) rendes tervezett tételek: a döntéseik (a javasolt hely,
  // illetve a halasztás) érvényesek, és a motor ugyanúgy tervezi őket; a régi hely nem foglal.

  // ---------- 1. Oktatói döntések (TRV-06, TRV-12) ----------
  // A vállalt figyelmeztetéses helyek a mohó kör után kerülnek a tervbe, hogy ne vegyék el
  // más igények tiszta helyét; addig az időpontjuk le van foglalva. A standby döntések a
  // párosított repülés végső helyéhez igazodnak, ezért a 4. lépésben kerülnek a tervbe.
  const acceptedLater: Array<{ index: number; decision: Extract<Decision, { kind: 'assign' }>; request: BookingRequest }> = []
  const standbyDecisions: Array<{ index: number; decision: Extract<Decision, { kind: 'standby' }>; request: BookingRequest }> = []
  input.decisions.forEach((d, index) => {
    const request = byId.get(d.requestId)
    if (!request) {
      issues.push({ decisionIndex: index, message: 'A döntés olyan igényre hivatkozik, amely már nincs a listában.' })
      return
    }
    if (recordedIds.has(request.id) && d.kind !== 'comment') return
    switch (d.kind) {
      case 'defer': {
        // A későbbi halasztás visszavonja a korábbi elhelyezést (H17).
        if (placed.has(request.id)) {
          const later = acceptedLater.findIndex((x) => x.request.id === request.id)
          if (later >= 0) {
            ctx.release(request.id)
            acceptedLater.splice(later, 1)
          } else ctx.unplace(request.id)
          placed.delete(request.id)
        }
        deferred.add(request.id)
        return
      }
      case 'comment':
        comments.set(request.id, d.comment)
        return
      case 'noStandby':
        noStandby.add(request.id)
        return
      case 'teamOff':
        return
      case 'avoidSlot': {
        if (teamOf.has(request.id)) return
        const list = avoided.get(request.id) ?? []
        list.push(ctx.timesOfSlot(d.slot))
        avoided.set(request.id, list)
        return
      }
      case 'standby':
        if (!deferred.has(request.id)) standbyDecisions.push({ index, decision: d, request })
        return
      case 'assign': {
        const team = teamOf.get(request.id)
        if (team !== undefined) {
          // A csapattag a csapattal együtt kerül helyre (KBR-07): a csapatdöntések a kör után.
          if (d.team !== team) {
            issues.push({ decisionIndex: index, message: `${req(request.id)} közös briefing csapat tagja: az egyéni döntés nem alkalmazható, a csapattal együtt kerül helyre.` })
            return
          }
          const list = teamDecisions.get(team) ?? new Map()
          list.set(request.id, { index, decision: d })
          teamDecisions.set(team, list)
          return
        }
        if (placed.has(request.id) || deferred.has(request.id)) {
          issues.push({ decisionIndex: index, message: `${req(request.id)} már el van helyezve vagy halasztva; ez a döntés nem alkalmazható.` })
          return
        }
        // A kézi döntés a repülés kezdetét rögzíti; a foglalás kezdete a motorpróbával igazodik (H12).
        const times = ctx.withRunUp(request, ctx.timesOfDecision(request, d.slot))
        // Elmúlt helyre a vállalt figyelmeztetés sem tesz: ami nem került a FlightLoggerbe, az
        // nem történt meg, a motor újra sorra veszi.
        if (times.startMs < ctx.nowMs) return
        const e = ctx.evaluate(request, times, 'forced', { provisionalRunUp: true })!
        if (e.planClash) {
          const clash = e.hardViolations.find((v) => v.startsWith('ütközik') || v.includes('(terv)')) ?? 'ütközik egy tervezett foglalással'
          issues.push({ decisionIndex: index, message: `${req(request.id)}: egy korábbi döntés miatt ${clash}. A döntés megdőlt.` })
          return
        }
        if (d.acceptWarnings) {
          ctx.reserve({ request, times, standby: false })
          acceptedLater.push({ index, decision: d, request })
          placed.set(request.id, { evaluation: e, decidedBy: 'instructor', standby: false })
          return
        }
        // Figyelmeztetés vállalása nélküli döntés csak tiszta helyen áll meg (H08): ha a helyre
        // azóta karbantartás vagy más foglalás került, a döntés megdől, és az igény újra sorra kerül.
        if (e.hardViolations.length > 0 || e.needsApproval) {
          const why = [...e.hardViolations, ...e.warnings.filter((w) => w.kind === 'limitExceeded' || w.kind === 'doubleBooking' || w.kind === 'outsideAvailability').map((w) => w.message)]
          issues.push({ decisionIndex: index, message: `${req(request.id)}: a választott hely már nem szabad (${[...new Set(why)].join('; ')}). A döntés megdőlt, az igény újra sorra kerül.` })
          return
        }
        commit(e, d.auto ? 'autoResolved' : 'instructor', false)
        if (d.comment) comments.set(request.id, d.comment)
        return
      }
    }
  })

  // ---------- 1b. Csapatdöntések (KBR-07) ----------
  // A csapat tagjait egyszerre teszi a helyükre, majd együtt értékeli újra: így a limitekben a
  // csapattársak repülése is benne van. A legutóbbi döntés adja a közös kezdést, a tagok
  // döntése a gépüket. Tiszta helyen, vagy vállalt figyelmeztetéssel áll meg (H08).
  const placeTeam = (team: ActiveTeam, layout: TeamLayout): { evaluations: Evaluation[]; planClash: boolean; hard: boolean; approval: boolean } => {
    for (const m of team.members) ctx.place({ request: m, times: layout.times.get(m.id)!, standby: false })
    const evaluations = team.members.map((m) => ctx.reevaluate(m.id)!)
    return {
      evaluations,
      planClash: evaluations.some((e) => e.planClash),
      hard: evaluations.some((e) => e.hardViolations.length > 0),
      approval: evaluations.some((e) => e.needsApproval),
    }
  }
  const unplaceTeam = (team: ActiveTeam): void => {
    for (const m of team.members) ctx.unplace(m.id)
  }
  const keepTeam = (team: ActiveTeam, layout: TeamLayout, evaluations: readonly Evaluation[], decidedBy: Proposal['decidedBy']): void => {
    team.members.forEach((m, i) => placed.set(m.id, { evaluation: evaluations[i]!, decidedBy, standby: false }))
    teamLayouts.set(team.id, layout)
  }
  for (const [teamId, byMember] of [...teamDecisions].sort(([a], [b]) => a.localeCompare(b))) {
    const team = teamsById.get(teamId)!
    const list = [...byMember.values()].sort((a, b) => a.index - b.index)
    const latest = list[list.length - 1]!
    const chosen = team.members.map((m) => byMember.get(m.id)?.decision.slot.resourceId)
    const resources = resourceVariants(ctx, team, chosen)[0]!
    // Elmúlt kezdésű csapatdöntés nem érvényes: a csapat újra sorra kerül.
    if (toMs(latest.decision.slot.start) < ctx.nowMs) continue
    const layout = layoutTeam(ctx, team, toMs(latest.decision.slot.start), resources, swapMinutes)
    const v = placeTeam(team, layout)
    const accepted = list.some((x) => x.decision.acceptWarnings)
    if (v.planClash || ((v.hard || v.approval) && !accepted)) {
      unplaceTeam(team)
      const why = [...new Set(v.evaluations.flatMap((e) => [...e.hardViolations, ...e.warnings.filter((w) => w.kind === 'limitExceeded' || w.kind === 'doubleBooking' || w.kind === 'outsideAvailability').map((w) => w.message)]))]
      issues.push({
        decisionIndex: latest.index,
        message: v.planClash
          ? `A közös briefing csapat (${team.members.map((m) => req(m.id)).join(', ')}) egy korábbi döntés miatt nem fér a választott helyre (${why.join('; ')}). A döntés megdőlt.`
          : `A közös briefing csapat (${team.members.map((m) => req(m.id)).join(', ')}) választott helye már nem szabad (${why.join('; ')}). A döntés megdőlt, a csapat újra sorra kerül.`,
      })
      continue
    }
    keepTeam(team, layout, v.evaluations, latest.decision.auto ? 'autoResolved' : 'instructor')
    for (const { decision } of list) if (decision.comment) comments.set(decision.requestId, decision.comment)
  }

  // ---------- 2. Fix időpontok ütközése (9.1) ----------
  const fixed = requests.filter((r) => r.timing?.kind === 'fixed' && !placed.has(r.id) && !deferred.has(r.id) && !recordedIds.has(r.id))
  /** A fix foglalás ideje; repülésnél a motorpróbával, ha a gép aznap még nem repül (H11). */
  const fixedSpan = (r: BookingRequest): [number, number] => {
    const s = r.timing?.kind === 'fixed' ? toMs(r.timing.start) : Number.NaN
    let dur = r.durations.briefing + r.durations.main + r.durations.debriefing
    if (r.kind === 'flight') {
      const flightStart = s + r.durations.briefing * MINUTE_MS
      const runUps = ctx.resourcesFor(r).map((x) => (x.resourceId && ctx.isFirstFlightOfDay(x.resourceId, flightStart, r.id) ? ctx.resource(x.resourceId).engineRunUpMinutes : 0))
      if (runUps.length > 0) dur += Math.min(...runUps)
    }
    return [s, s + dur * MINUTE_MS]
  }
  for (let i = 0; i < fixed.length; i++) {
    for (let j = i + 1; j < fixed.length; j++) {
      const a = fixed[i]!
      const b = fixed[j]!
      if (blockedFromLoop.has(a.id) || blockedFromLoop.has(b.id)) continue
      const [as, ae] = fixedSpan(a)
      const [bs, be] = fixedSpan(b)
      if (!overlaps(as, ae, bs, be)) continue
      const id = `fix:${a.id}:${b.id}`
      blockedFromLoop.add(b.id)
      unplaced.push({ requestId: b.id, reason: 'Fix időpontja ütközik egy másik fix időponttal.' })
      // Érvek a két igény saját fix helyén (9.2): melyik a jobb hely, és miért.
      const atFixed = (r: BookingRequest): Evaluation | undefined => {
        const resource = ctx.resourcesFor(r)[0]
        if (!resource) return undefined
        return ctx.evaluate(r, ctx.timesAt(r, ctx.anchorsFor(r)[0]!, resource.resourceId, resource.classroomId), 'forced')
      }
      const ea = atFixed(a)
      const eb = atFixed(b)
      const keepB = ea && eb && a.kind === b.kind ? eb.weighted.weightedSum > ea.weighted.weightedSum : false
      const prosA = ea && eb && a.kind === b.kind ? differences(ea, eb, criteriaFor(a.kind, ctx.replanning), input.settings.weights) : { pros: [], cons: [] }
      const prosB = ea && eb && a.kind === b.kind ? differences(eb, ea, criteriaFor(b.kind, ctx.replanning), input.settings.weights) : { pros: [], cons: [] }
      dilemmas.push({
        id,
        type: 'fixedConflict',
        requestIds: [a.id, b.id],
        question: 'Melyik mozduljon?',
        summary: `${req(a.id)} és ${req(b.id)} fix időpontja ütközik (${label(as)}).`,
        recommendedOptionId: keepB ? `${id}:b` : `${id}:a`,
        options: [
          option(`${id}:a`, `${req(a.id)} marad, ${req(b.id)} halasztódik`, prosA.pros, prosA.cons, `${req(b.id)} a következő heti listába kerül; másik időpontra a térképről teheted.`, { kind: 'defer', requestId: b.id }),
          option(`${id}:b`, `${req(b.id)} marad, ${req(a.id)} halasztódik`, prosB.pros, prosB.cons, `${req(a.id)} a következő heti listába kerül; másik időpontra a térképről teheted.`, { kind: 'defer', requestId: a.id }),
        ],
        impact: 300,
      })
    }
  }

  // Elsőbbség (ELS-01, ELS-02): 1 a legfontosabb. A rétegek a legfontosabbal kezdve sorra kerülnek;
  // ha minden igény azonos elsőbbségű (alapeset), egyetlen réteg van, és a terv a korábbival azonos.
  const priorityOf = (r: BookingRequest): number => requestPriorityOf(input.settings, r)
  const requestTiers = [...new Set(requests.map(priorityOf))].sort((a, b) => a - b)
  /** A csapat elsőbbsége a legfontosabb tagjáé (ELS-04). */
  const teamTier = (team: ActiveTeam): number => (team.members.length > 0 ? Math.min(...team.members.map(priorityOf)) : (requestTiers[0] ?? input.settings.defaults.requestPriority))
  const tiers = [...new Set([...requestTiers, ...teamSetup.teams.map(teamTier)])].sort((a, b) => a - b)

  // ---------- 2b. Közös briefing csapatok (KBR-07) ----------
  // A csapat a legnagyobb tétel, ezért a fix időpontok után, a réteg többi igénye előtt kerül helyre. A
  // fix időpontú igények ideje addig le van foglalva (az oktató és a növendék), hogy a csapat ne
  // vegye el. Jelöltek: közös kezdés × gépkiosztás; a legjobb tiszta jelöltek közül az első,
  // amely a csapattársakkal együtt (limitek) is tiszta marad.
  const fixedReserved = requests.filter((r) => r.timing?.kind === 'fixed' && !placed.has(r.id) && !deferred.has(r.id) && !recordedIds.has(r.id) && !blockedFromLoop.has(r.id) && !teamOf.has(r.id))
  /**
   * A réteg közös briefing csapatai (ELS-04: a csapat elsőbbsége a legfontosabb tagjáé). Az első
   * rétegnél a fix időpontú igények ideje addig le van foglalva, amíg a csapatok helyet kapnak.
   */
  const placeTeamsOf = (tier: number, first: boolean): void => {
    if (first) {
      for (const r of fixedReserved) {
        const [s, e] = fixedSpan(r)
        ctx.reserve({ request: r, times: { startMs: s, endMs: e, flightStartMs: s, flightEndMs: e, resourceId: undefined, classroomId: undefined }, standby: false })
      }
    }
    const teamOrder = teamSetup.teams.filter((t) => teamTier(t) === tier).sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id))
    for (const team of teamOrder) {
      if (team.members.length > 0 && team.members.every((m) => placed.has(m.id))) continue
      const candidates = teamCandidates(ctx, team, swapMinutes)
      const clean = candidates.filter((c) => c.clean).sort((a, b) => (betterTeamCandidate(a, b) ? -1 : betterTeamCandidate(b, a) ? 1 : 0))
      let done = false
      // Ami tagonként tiszta, de a csapattársakkal együtt figyelmeztetéses (például az oktató napi
      // repült ideje), az a dilemmában vállalható helyként jön szóba.
      const together: TeamCandidate[] = []
      for (const c of clean.slice(0, 5)) {
        const v = placeTeam(team, c.layout)
        if (!v.hard && !v.approval) {
          keepTeam(team, c.layout, v.evaluations, 'engine')
          done = true
          break
        }
        if (!v.hard) together.push({ ...c, evaluations: v.evaluations, clean: false })
        unplaceTeam(team)
      }
      if (done) continue
      for (const m of team.members) blockedFromLoop.add(m.id)
      teamDilemma(team, [...candidates.filter((c) => !c.clean), ...together])
    }
    if (first) for (const r of fixedReserved) ctx.release(r.id)
  }

  // ---------- 3. Mohó elhelyezés dilemma-felismeréssel (7.1, 9.1) ----------
  const anchorCache = new Map<string, number[]>()
  const resourceCache = new Map<string, Array<{ resourceId?: string; classroomId?: string }>>()

  const evaluateAll = (request: BookingRequest): Evaluation[] => {
    let anchors = anchorCache.get(request.id)
    if (!anchors) anchorCache.set(request.id, (anchors = ctx.anchorsFor(request)))
    let resources = resourceCache.get(request.id)
    if (!resources) resourceCache.set(request.id, (resources = ctx.resourcesFor(request)))
    const avoid = avoided.get(request.id) ?? []
    const result: Evaluation[] = []
    for (const r of resources) {
      const extra = r.resourceId ? ctx.gapAnchorsFor(request, r.resourceId) : []
      const list = extra.length > 0 ? [...new Set([...anchors, ...extra])].sort((a, b) => a - b) : anchors
      for (const anchor of list) {
        const times = ctx.timesAt(request, anchor, r.resourceId, r.classroomId)
        if (avoid.some((a) => a.startMs === times.startMs && a.resourceId === times.resourceId && a.classroomId === times.classroomId)) continue
        const e = ctx.evaluateCandidate(request, times)
        if (e) result.push(e)
      }
    }
    return result
  }

  /** A héten maradó, egymást nem átfedő elfogadható helyek száma, a jelöltön kívül (szűkösség). */
  const alternativesCount = (evaluations: readonly Evaluation[]): number => {
    const acceptable = evaluations
      .filter((e) => !e.needsApproval && (e.request.kind !== 'flight' || e.weatherRaw > 0))
      .map((e) => [e.times.startMs, e.times.endMs] as const)
      .sort((a, b) => a[1] - b[1] || a[0] - b[0])
    let count = 0
    let lastEnd = Number.NEGATIVE_INFINITY
    for (const [s, e] of acceptable) {
      if (s >= lastEnd) {
        count++
        lastEnd = e
      }
    }
    return Math.max(0, count - 1)
  }

  const better = (a: Evaluation, b: Evaluation): boolean =>
    a.weighted.score !== b.weighted.score
      ? a.weighted.score > b.weighted.score
      : a.times.startMs !== b.times.startMs
        ? a.times.startMs < b.times.startMs
        : (a.times.resourceId ?? a.times.classroomId ?? '') < (b.times.resourceId ?? b.times.classroomId ?? '')

  const bestOf = (request: BookingRequest, list: readonly Evaluation[]): Evaluation | undefined => {
    // Időablakok (TRV-02): az ablakban kezdődő elfogadható helyek elsőbbséget kapnak; a többi
    // csak ezek híján jön szóba (kizáró ablaknál a többi már eleve nem tiszta hely).
    if (request.timing?.kind === 'preferred') {
      const windows = request.timing.windows.map((w) => [toMs(w.start), toMs(w.end)] as const)
      const starting = list.filter((e) => windows.some(([s, end]) => e.times.startMs >= s && e.times.startMs <= end))
      if (starting.length > 0) return starting.reduce((x, y) => (better(x, y) ? x : y))
    }
    return list.length === 0 ? undefined : list.reduce((x, y) => (better(x, y) ? x : y))
  }

  /** Figyelmeztetéses helyek közül előbb a legenyhébb figyelmeztetés, utána a pont (H22). */
  const mildestOf = (request: BookingRequest, list: readonly Evaluation[]): Evaluation | undefined => {
    if (list.length === 0) return undefined
    const least = Math.min(...list.map(warningSeverity))
    return bestOf(request, list.filter((e) => warningSeverity(e) === least))
  }

  const sameGroup = (a: BookingRequest, b: BookingRequest): boolean => a.kind === b.kind
  const instructorOverlap = (a: Times, b: Times): boolean => overlaps(a.startMs, a.endMs, b.startMs, b.endMs)

  /** Figyelmeztetéses vagy „nincs hely” dilemma egy tiszta hely nélküli igényhez. */
  const noCleanSlot = (id: string, warningList: readonly Evaluation[]): void => {
    const request = byId.get(id)!
    const warn = mildestOf(request, warningList)
    if (warn) {
      const dId = `warn:${id}`
      const reasons = [...new Set(warn.warnings.filter((w) => w.kind === 'limitExceeded' || w.kind === 'doubleBooking' || w.kind === 'outsideAvailability').map((w) => w.message))]
      // Enyhe figyelmeztetésnél (csak a ráérésen kívül) a vállalás az ajánlás, máskor a halasztás.
      const mild = warningSeverity(warn) <= 1
      unplaced.push({
        requestId: id,
        reason: `Szabad hely nincs, csak figyelmeztetéssel fér be (${label(warn.times.startMs)}${warn.times.resourceId ? `, ${callSign(warn.times.resourceId)}` : ''}): ${reasons.join('; ') || 'figyelmeztetés'}.`,
        suggestion: ctx.slotOf(warn.times, request),
      })
      dilemmas.push({
        id: dId,
        type: 'warningSlot',
        requestIds: [id],
        question: 'Vállalod a figyelmeztetést?',
        summary: `${req(id)} a héten csak figyelmeztetéssel fér be: ${label(warn.times.startMs)}.`,
        recommendedOptionId: mild ? `${dId}:accept` : `${dId}:defer`,
        options: [
          option(`${dId}:accept`, `Foglalás ${label(warn.times.startMs)}, a figyelmeztetés vállalásával`, ['A heti terv teljes marad.'], reasons, 'A foglalás a figyelmeztetéssel együtt kerül a tervezetbe.', {
            kind: 'assign',
            requestId: id,
            slot: ctx.slotOf(warn.times, request),
            acceptWarnings: true,
          }),
          option(`${dId}:defer`, 'Halasztás a következő hétre', ['Nincs limit-túllépés vagy ütközés.'], ['Az igény egy héttel később teljesül.'], 'Az igény a következő heti listába kerül.', {
            kind: 'defer',
            requestId: id,
          }),
        ],
        impact: 200,
      })
      return
    }
    const dId = `none:${id}`
    // Csere-lehetőség (9.2): átveheti egy már elhelyezett, azonos fajta igény helyét,
    // amely ezután újratervezésre kerül. A legkisebb pontú két helyet ajánljuk. Fontosabb
    // (kisebb elsőbbségi számú) igény helyét nem ajánlja (ELS-03).
    const swaps: Array<{ own: Evaluation; other: Placed }> = []
    for (const other of [...placed.values()]) {
      const o = other.evaluation
      if (other.decidedBy !== 'engine' || other.standby || other.dilemmaId || o.request.kind !== request.kind || teamOf.has(o.request.id)) continue
      if (priorityOf(o.request) < priorityOf(request)) continue
      const oTimes = ctx.timesOf(o.request.id) ?? o.times
      ctx.unplace(o.request.id)
      const own = ctx.evaluate(request, ctx.timesAt(request, oTimes.flightStartMs, oTimes.resourceId, oTimes.classroomId), 'normal')
      ctx.place({ request: o.request, times: oTimes, standby: false, keep: keepFor(o.request, 'engine') })
      if (own && !own.needsApproval) swaps.push({ own, other })
    }
    swaps.sort((a, b) => a.other.evaluation.weighted.weightedSum - b.other.evaluation.weighted.weightedSum || a.other.evaluation.request.id.localeCompare(b.other.evaluation.request.id))
    const swapOptions = swaps.slice(0, 2).map(({ own, other }) => {
      const otherId = other.evaluation.request.id
      const diff = differences(own, other.evaluation, criteriaFor(request.kind, ctx.replanning), input.settings.weights)
      return {
        gain: own.weighted.weightedSum - other.evaluation.weighted.weightedSum,
        option: option(
          `${dId}:csere:${otherId}`,
          `${req(id)} kapja ${req(otherId)} helyét: ${label(own.times.startMs)}`,
          diff.pros,
          diff.cons,
          `${req(otherId)} újratervezésre kerül; ha nincs más helye, ő kerül dilemmába.`,
          { kind: 'assign', requestId: id, slot: ctx.slotOf(own.times, request), acceptWarnings: false },
        ),
      }
    })
    const best = swapOptions.reduce<(typeof swapOptions)[number] | undefined>((x, y) => (!x || y.gain > x.gain ? y : x), undefined)
    const { text: why, closest, blockers, closestText } = explainNoSlot(request)
    // Kényszerítés (9.2): a legközelebbi helyre kézi felülbírálással, a sértett feltételek vállalásával.
    const forceOption = closest
      ? option(
          `${dId}:force`,
          `Foglalás erőltetése: ${label(closest.times.startMs)}${closest.times.resourceId ? `, ${callSign(closest.times.resourceId)}` : ''}`,
          ['Az igény a héten teljesül.'],
          closest.details.map((x) => `Felülbírálod: ${x}.`),
          'A foglalás kézi felülbírálással kerül a tervezetbe; a tervezet figyelmeztetésként jelzi a sértett feltételt.',
          { kind: 'assign', requestId: id, slot: ctx.slotOf(closest.times, request), acceptWarnings: true },
        )
      : undefined
    unplaced.push({ requestId: id, reason: why, ...(closest ? { suggestion: ctx.slotOf(closest.times, request) } : {}) })
    dilemmas.push({
      id: dId,
      type: 'noSlot',
      requestIds: [id],
      question: 'Mi történjen vele?',
      summary: `${req(id)} a héten nem helyezhető el. ${why}`,
      headline: `${req(id)} a héten nem helyezhető el.${closestText ? ` ${closestText}` : ''}`,
      ...(blockers ? { blockers } : {}),
      recommendedOptionId: best && best.gain >= thresholdFor(request.kind) ? best.option.id : `${dId}:defer`,
      options: [
        option(`${dId}:defer`, 'Halasztás a következő hétre', ['A többi foglalás változatlan marad.'], ['Az igény egy héttel később teljesül.'], 'Az igény a következő heti listába kerül.', { kind: 'defer', requestId: id }),
        ...swapOptions.map((s) => s.option),
        ...(forceOption ? [forceOption] : []),
      ],
      impact: 150,
    })
  }

  /** A helyi javítás után: a bővült szomszédos elhelyezések tiszták maradnak-e (H01). */
  const stillClean = (ids: ReadonlySet<string>, except: string): boolean => {
    for (const other of ids) {
      if (other === except) continue
      const e = ctx.reevaluate(other)
      if (!e) continue
      const before = placed.get(other)?.evaluation
      const newIssue = e.hardViolations.length > (before?.hardViolations.length ?? 0) || (e.needsApproval && !before?.needsApproval)
      if (newIssue) return false
    }
    return true
  }

  // ---------- Elsőbbségi rétegek (ELS-02) ----------
  // Rétegenként, a legfontosabbal kezdve: a réteg csapatai, mohó elhelyezése, helyi javítása és
  // ismétlő köre. Egy kevésbé fontos réteg így nem veheti el egy fontosabb igény helyét, és a
  // helyén sem változtat (a helyi javítás és az ismétlő kör is csak a saját rétegét mozgatja).
  // Az első réteg a fix időpontú igényeket is elhelyezi, elsőbbségtől függetlenül.
  for (const [pass, tier] of tiers.entries()) {
    placeTeamsOf(tier, pass === 0)
    const remaining = new Set(
      requests
        .filter((r) => !placed.has(r.id) && !deferred.has(r.id) && !blockedFromLoop.has(r.id) && !recordedIds.has(r.id) && !teamOf.has(r.id))
        .filter((r) => (r.timing?.kind === 'fixed' ? pass === 0 : priorityOf(r) === tier))
        .map((r) => r.id),
    )
    /** A réteg igényei: a helyi javítás és az ismétlő kör csak ezeket mozgatja. */
    const members = new Set(remaining)

    let guard = requests.length * 4 + 10
    while (remaining.size > 0 && guard-- > 0) {
      const state = new Map<string, { clean: Evaluation[]; warning: Evaluation[]; alternatives: number; best?: Evaluation }>()
      for (const id of [...remaining].sort()) {
        const request = byId.get(id)!
        const all = evaluateAll(request)
        const clean = all.filter((e) => !e.needsApproval)
        const warning = all.filter((e) => e.needsApproval)
        const alternatives = alternativesCount(clean)
        for (const e of all) ctx.setScarcity(e, scarcityOf(alternatives))
        const best = bestOf(request, clean)
        state.set(id, { clean, warning, alternatives, ...(best ? { best } : {}) })
      }

      // Nincs tiszta hely: figyelmeztetéses hely vagy „nincs hely” dilemma
      for (const [id, s] of state) {
        if (s.best) continue
        remaining.delete(id)
        noCleanSlot(id, s.warning)
      }
      if (remaining.size === 0) break

      // A legnehezebben elhelyezhető igény: fix időpont, majd kevés hely, majd magas pont
      const candidates = [...remaining].map((id) => ({ id, s: state.get(id)! })).filter((x) => x.s.best)
      candidates.sort((x, y) => {
        const fx = byId.get(x.id)!.timing?.kind === 'fixed' ? 0 : 1
        const fy = byId.get(y.id)!.timing?.kind === 'fixed' ? 0 : 1
        return fx - fy || x.s.alternatives - y.s.alternatives || y.s.best!.weighted.score - x.s.best!.weighted.score || x.id.localeCompare(y.id)
      })
      const chosen = candidates[0]!
      const R = byId.get(chosen.id)!
      const S = chosen.s.best!
      const threshold = thresholdFor(R.kind)

      // Verseny: más igény is ezt a helyet akarja (legjobb helye átfed)
      let rival: { request: BookingRequest; at: Evaluation } | undefined
      for (const other of candidates.slice(1)) {
        const Q = byId.get(other.id)!
        if (!sameGroup(R, Q) || Q.timing?.kind === 'fixed' || R.timing?.kind === 'fixed') continue
        if (!other.s.best || !instructorOverlap(other.s.best.times, S.times)) continue
        const atS = bestOf(Q, other.s.clean.filter((e) => instructorOverlap(e.times, S.times)))
        if (!atS) continue
        if (!rival || atS.weighted.weightedSum > rival.at.weighted.weightedSum) rival = { request: Q, at: atS }
      }

      if (!rival) {
        commit(S, 'engine', false)
        remaining.delete(R.id)
        continue
      }

      // Valódi verseny csak akkor van, ha mindkettő legalább a küszöbnyit veszít, ha nem kapja
      // meg a helyet; különben a kisebb veszteségű dilemma nélkül a következő helyére kerül.
      // A veszteségbe csak a versenyzőt érintő feltételek számítanak: az oktató napjának összetétele
      // (terhelés, folyamatos program, motorpróba) ugyanúgy alakul, akárki kapja a helyet – a
      // vesztes a győztes mellé is kerülhet –, ezért az nem verseny.
      const ownSide = (e: Evaluation): number =>
        criteriaFor(e.request.kind, ctx.replanning).reduce((sum, c) => (ORDER_INDEPENDENT.has(c) ? sum : sum + input.settings.weights[c] * (e.subScores[c] ?? 0)), 0)
      const regret = (own: Evaluation, list: readonly Evaluation[]): number => {
        const alternatives = list.filter((e) => !instructorOverlap(e.times, S.times) && !instructorOverlap(e.times, rival!.at.times))
        if (alternatives.length === 0) return Number.POSITIVE_INFINITY
        const bestAlt = alternatives.reduce((x, y) => (x.weighted.weightedSum >= y.weighted.weightedSum ? x : y))
        return ownSide(own) - ownSide(bestAlt)
      }
      const regretR = regret(S, chosen.s.clean)
      const regretQ = regret(rival.at, state.get(rival.request.id)!.clean)
      if (regretQ < threshold || regretR < threshold) {
        const winner = regretR >= regretQ ? S : rival.at
        commit(winner, 'engine', false)
        remaining.delete(winner.request.id)
        continue
      }

      const criteria = criteriaFor(R.kind, ctx.replanning)
      const adv = advantage(S.subScores, rival.at.subScores, criteria, input.settings.weights)
      if (adv <= -threshold) {
        commit(rival.at, 'engine', false)
        remaining.delete(rival.request.id)
        continue
      }
      if (adv >= threshold) {
        commit(S, 'engine', false)
        remaining.delete(R.id)
        continue
      }

      // Dilemma: a súlyozott előny a küszöb alatt
      const dId = `verseny:${R.id}:${rival.request.id}:${S.times.startMs}`
      const winnerIsR = adv >= 0
      const win = winnerIsR ? S : rival.at
      const prosCons = (a: Evaluation, b: Evaluation): { pros: string[]; cons: string[] } => differences(a, b, criteria, input.settings.weights)
      const optR = prosCons(S, rival.at)
      const optQ = prosCons(rival.at, S)
      dilemmas.push({
        id: dId,
        type: 'competition',
        requestIds: [R.id, rival.request.id],
        question: 'Melyik kapja a helyet?',
        summary: `${req(R.id)} és ${req(rival.request.id)} ugyanarra a helyre pályázik: ${label(S.times.startMs)}. Ajánlás: ${req(win.request.id)} (előny ${(Math.abs(adv) / Math.max(1, weightSum(R.kind)) * 100).toFixed(1)} pont).`,
        recommendedOptionId: `${dId}:${win.request.id}`,
        options: [
          option(`${dId}:${R.id}`, `${req(R.id)} kapja: ${label(S.times.startMs)}`, optR.pros, optR.cons, `${req(rival.request.id)} a következő legjobb helyre kerül.`, {
            kind: 'assign',
            requestId: R.id,
            slot: ctx.slotOf(S.times, R),
            acceptWarnings: false,
          }),
          option(`${dId}:${rival.request.id}`, `${req(rival.request.id)} kapja: ${label(rival.at.times.startMs)}`, optQ.pros, optQ.cons, `${req(R.id)} a következő legjobb helyre kerül.`, {
            kind: 'assign',
            requestId: rival.request.id,
            slot: ctx.slotOf(rival.at.times, rival.request),
            acceptWarnings: false,
          }),
        ],
        // A verseny a figyelmeztetéses és a „nincs hely” dilemma után jön, de a standby előtt (9.3).
        impact: 100 + Math.min(49, Math.max(S.weighted.score, rival.at.weighted.score) / 2),
      })
      commit(win, 'engine', false, dId)
      remaining.delete(win.request.id)
    }

    // ---------- Helyi javítás (7.1) ----------
    // A motor által egyértelműen elhelyezett foglalásokat egyenként újra kipróbálja a többi
    // mellett; ha van legalább 1 súlyozott egységgel jobb tiszta hely, oda teszi át. Ha az
    // áthelyezés miatt egy másik repülés a gép napi első repülésévé válik, és a motorpróbával
    // bővülő ideje ütközne, az áthelyezés elmarad (H01).
    for (const id of [...placed.keys()].sort()) {
      const p = placed.get(id)!
      if (!members.has(id)) continue
      if (p.decidedBy !== 'engine' || p.dilemmaId || p.standby || teamOf.has(id)) continue
      const request = p.evaluation.request
      const original = ctx.timesOf(id) ?? p.evaluation.times
      const before = new Map(ctx.placements.filter((x) => !x.standby).map((x) => [x.request.id, x.times]))
      ctx.unplace(id)
      const options = evaluateAll(request).filter((e) => !e.needsApproval)
      const scarcity = scarcityOf(alternativesCount(options))
      for (const e of options) ctx.setScarcity(e, scarcity)
      const same = (e: Evaluation): boolean =>
        e.times.flightStartMs === original.flightStartMs && e.times.resourceId === original.resourceId && e.times.classroomId === original.classroomId
      const current = options.find(same)
      const best = bestOf(request, options)
      const next = best && (!current || best.weighted.weightedSum > current.weighted.weightedSum + 1) ? best : current
      if (!next || same(next)) {
        ctx.place({ request, times: original, standby: false, keep: keepFor(request, 'engine') })
        continue
      }
      ctx.place({ request, times: next.times, standby: false, keep: keepFor(request, 'engine') })
      // Az áthelyezés előtti állapothoz képest bővült elhelyezések (a kivételnél és a
      // visszatételnél is bővülhet egy szomszéd motorpróbája).
      const grown = new Set(
        ctx.placements
          .filter((x) => !x.standby && x.request.id !== id)
          .filter((x) => {
            const b = before.get(x.request.id)
            return b !== undefined && (x.times.startMs < b.startMs || x.times.endMs > b.endMs)
          })
          .map((x) => x.request.id),
      )
      if (!stillClean(grown, id)) {
        ctx.unplace(id)
        ctx.place({ request, times: original, standby: false, keep: keepFor(request, 'engine') })
        continue
      }
      placed.set(id, { ...p, evaluation: next })
    }

    // Ismétlő kör (A1): a javítás felszabadíthatott helyet egy korábban „nincs hely” vagy
    // figyelmeztetéses igénynek; ha most van tiszta helye, dilemma nélkül bekerül.
    for (const d of [...dilemmas]) {
      if (d.type !== 'noSlot' && d.type !== 'warningSlot') continue
      const id = d.requestIds[0]!
      if (!members.has(id)) continue
      if (placed.has(id) || deferred.has(id)) continue
      const request = byId.get(id)!
      const clean = evaluateAll(request).filter((e) => !e.needsApproval)
      const best = bestOf(request, clean)
      if (!best) continue
      commit(best, 'engine', false)
      dilemmas.splice(dilemmas.indexOf(d), 1)
      const u = unplaced.findIndex((x) => x.requestId === id)
      if (u >= 0) unplaced.splice(u, 1)
    }
  }

  // A vállalt figyelmeztetéses döntések elhelyezése (LIM-02, 8.4)
  for (const { decision, request } of acceptedLater) {
    ctx.release(request.id)
    const e = ctx.evaluate(request, ctx.withRunUp(request, ctx.timesOfDecision(request, decision.slot)), 'forced')!
    commit(e, decision.auto ? 'autoResolved' : 'instructor', false)
    if (decision.comment) comments.set(request.id, decision.comment)
  }

  // ---------- 4. Standby elmélet bizonytalan napra (SZB-15, súlyozási dok. E16) ----------
  // A standby elmélet a saját idejével a párosított repülés kezdetéhez kerül, és mellette az
  // elméletnek a saját helye is megmarad (Q4): jó időben ott tartják meg. Ütközésből csak a
  // párosított repülés (oktató, növendék) kap felmentést (H06).
  const standbys: Array<{ evaluation: Evaluation; decidedBy: Proposal['decidedBy']; pairedRequestId: string; comment?: string }> = []
  const standbyTimes = (theory: BookingRequest, flight: Times, classroomId: string): Times => {
    const total = (theory.durations.briefing + theory.durations.main + theory.durations.debriefing) * MINUTE_MS
    return { startMs: flight.startMs, endMs: flight.startMs + total, flightStartMs: flight.startMs, flightEndMs: flight.startMs + total, resourceId: undefined, classroomId }
  }
  const tryStandby = (theory: BookingRequest, flightId: string, preferredRoom: string | undefined): Evaluation | undefined => {
    const flightTimes = ctx.timesOf(flightId)
    if (!flightTimes) return undefined
    const rooms = ctx.resourcesFor(theory).map((r) => r.classroomId!)
    const ordered = preferredRoom && rooms.includes(preferredRoom) ? [preferredRoom, ...rooms.filter((r) => r !== preferredRoom)] : rooms
    const ignoreRefs = new Set([flightId, theory.id])
    for (const room of ordered) {
      const times = standbyTimes(theory, flightTimes, room)
      if ((avoided.get(theory.id) ?? []).some((a) => a.startMs === times.startMs && a.classroomId === room)) continue
      const ev = ctx.evaluate(theory, times, 'standby', { ignoreRefs })
      if (ev && ev.hardViolations.length === 0 && !ev.needsApproval) return ev
    }
    return undefined
  }
  const pairedFlightOf = (d: Extract<Decision, { kind: 'standby' }>, theory: BookingRequest): string | undefined => {
    if (d.pairedRequestId) return placed.has(d.pairedRequestId) ? d.pairedRequestId : undefined
    // Régi döntés párosítás nélkül: a döntés idejére eső repülés a növendékek közül.
    const t = ctx.timesOfSlot(d.slot)
    for (const [id, p] of placed) {
      const times = ctx.timesOf(id)
      if (!times || p.standby || p.evaluation.request.kind !== 'flight') continue
      if (theory.studentIds.includes(p.evaluation.request.studentIds[0]!) && overlaps(times.startMs, times.endMs, t.startMs, t.endMs)) return id
    }
    return undefined
  }
  for (const { index, decision, request } of standbyDecisions) {
    const pairedId = pairedFlightOf(decision, request)
    const ev = pairedId ? tryStandby(request, pairedId, decision.slot.classroomId) : undefined
    if (!pairedId || !ev) {
      issues.push({
        decisionIndex: index,
        message: pairedId
          ? `${req(request.id)}: a standby elmélet a repülés új idejében nem fér el (terem vagy résztvevő foglalt). A döntés megdőlt.`
          : `${req(request.id)}: a standby mellé párosított repülés már nincs a terven. A döntés megdőlt.`,
      })
      continue
    }
    ctx.place({ request, times: ev.times, standby: true, pairedRequestId: pairedId })
    standbys.push({ evaluation: ev, decidedBy: decision.auto ? 'autoResolved' : 'instructor', pairedRequestId: pairedId, ...(decision.comment ? { comment: decision.comment } : {}) })
  }

  const standbyDecided = new Set(standbyDecisions.map((d) => d.request.id))
  // Elméletenként legfeljebb egy standby-ajánlás: a legkorábbi bizonytalan repüléshez.
  const standbyOffered = new Set<string>()
  const byStart = [...placed].map(([id, p]) => ({ id, p, times: ctx.timesOf(id) ?? p.evaluation.times }))
  byStart.sort((a, b) => a.times.startMs - b.times.startMs || a.id.localeCompare(b.id))
  for (const { id, p, times } of byStart) {
    const e = p.evaluation
    if (p.standby || p.recorded || e.request.kind !== 'flight' || e.leadDays < 3 || e.weatherRaw < 0.3 || e.weatherRaw > 0.7) continue
    const studentId = e.request.studentIds[0]!
    const theory = requests.find(
      (r) =>
        r.kind === 'theory' &&
        r.timing?.kind !== 'fixed' &&
        r.studentIds.includes(studentId) &&
        !deferred.has(r.id) &&
        !recordedIds.has(r.id) &&
        !standbyDecided.has(r.id) &&
        !standbyOffered.has(r.id) &&
        !noStandby.has(r.id),
    )
    if (!theory) continue
    const ev = tryStandby(theory, id, undefined)
    if (!ev) continue
    const slot = ctx.slotOf(ev.times, theory)
    standbyOffered.add(theory.id)
    const dId = `standby:${id}:${theory.id}`
    // Előrejelzés nélküli napon nem „bizonytalan” az idő, csak még nem ismert (A7).
    const why = e.weatherKnown ? `bizonytalan időjárású napra esik (${label(times.flightStartMs)})` : `olyan napra esik, amelyre még nincs előrejelzés (${label(times.flightStartMs)})`
    dilemmas.push({
      id: dId,
      type: 'standby',
      requestIds: [id, theory.id],
      question: 'Kerüljön mellé standby elmélet?',
      summary: `${req(id)} ${why}. A repülés marad az elsődleges, mellé ${req(theory.id)} ajánlható standbyként; az elmélet saját helye is megmarad.`,
      recommendedOptionId: e.weatherKnown ? `${dId}:igen` : `${dId}:nem`,
      options: [
        option(`${dId}:igen`, 'Standby elmélet a repülés idejére', ['Rossz idő esetén sem vész el az óra.'], ['A terem foglalt marad akkor is, ha repülnek.'], 'Az elmélet standbyként, kommenttel kerül a tervezetbe, és a repüléssel együtt mozog; a saját helye is megmarad.', {
          kind: 'standby',
          requestId: theory.id,
          slot,
          pairedRequestId: id,
          comment: 'STANDBY – rossz idő esetén elmélet',
        }),
        option(`${dId}:nem`, 'Nem kell standby ehhez az elmélethez', ['A terem szabad marad.'], ['Rossz időnél az óra elmarad.'], 'Az elmélet a saját helyén marad; a héten nem ajánlok mellé standbyt.', {
          kind: 'noStandby',
          requestId: theory.id,
        }),
      ],
      impact: 50,
    })
  }

  // ---------- 5. Javaslatok ----------
  // A motorpróba-igazítás közben folyamatos (a kontextus minden változásnál újraszámolja);
  // ahol egy elhelyezés ideje emiatt eltér a kiértékelttől, újraértékeljük, hogy a
  // figyelmeztetések a valós időre szóljanak.
  // A kézi döntéseket mindig a végleges terv mellett nézzük újra (a motorpróbájuk közben dőlt el).
  const finalEvaluation = (id: string, p: Placed): Evaluation => {
    const times = ctx.timesOf(id)
    if (!times || (p.decidedBy === 'engine' && sameTimes(times, p.evaluation.times))) return p.evaluation
    return ctx.reevaluate(id) ?? p.evaluation
  }
  const placedList = [...placed].map(([id, p]) => ({ ...p, evaluation: finalEvaluation(id, p) }))
  const evaluations = placedList.map((x) => x.evaluation)

  // Áthelyezendőnek jelölt igény: ha a terv szerinti helye ugyanaz, mint a FlightLogger-foglalásé,
  // nincs mit átírni (a jelölés kész); különben a javaslat jelzi, honnan kell átírni.
  const moveMarks = new Map(linked.plannedMoves.map((m) => [m.requestId, m]))
  const completedMoves: Array<PlanResult['completedChanges'][number]> = []
  const proposals: Proposal[] = placedList.map((p) => {
    const e = p.evaluation
    const comment = comments.get(e.request.id)
    const mark = moveMarks.get(e.request.id)
    const slot = ctx.slotOf(e.times, e.request)
    let change: Proposal['change']
    if (mark && !p.standby) {
      if (mark.from && samePlaceAs(slot, mark.from)) completedMoves.push({ requestId: mark.requestId, kind: 'move', bookingId: mark.bookingId, slot: mark.from })
      else change = { kind: 'move', bookingId: mark.bookingId, ...(mark.from ? { from: mark.from } : {}) }
    }
    return {
      requestId: e.request.id,
      slot,
      score: Math.round(e.weighted.score * 10) / 10,
      factors: topFactors(e.weighted.factors, e.weighted.factors.length),
      warnings: dedupe(e.warnings),
      standby: false,
      decidedBy: p.decidedBy,
      ...(p.dilemmaId ? { dilemmaId: p.dilemmaId } : {}),
      assumptions: assumptionsFor(e.request, evaluations),
      ...(comment ? { comment } : {}),
      ...(p.recorded ? { recorded: true } : {}),
      ...(change ? { change } : {}),
      ...(teamOf.has(e.request.id) && !p.standby ? { teamId: teamOf.get(e.request.id)! } : {}),
    }
  })
  for (const s of standbys) {
    const e = s.evaluation
    proposals.push({
      requestId: e.request.id,
      slot: ctx.slotOf(e.times, e.request),
      score: Math.round(e.weighted.score * 10) / 10,
      factors: topFactors(e.weighted.factors, e.weighted.factors.length),
      warnings: dedupe(e.warnings),
      standby: true,
      decidedBy: s.decidedBy,
      assumptions: [],
      pairedRequestId: s.pairedRequestId,
      ...(s.comment ? { comment: s.comment } : {}),
    })
  }
  proposals.sort((a, b) => a.slot.start.localeCompare(b.slot.start) || a.requestId.localeCompare(b.requestId) || Number(a.standby) - Number(b.standby))

  // Általános figyelmeztetések: régen repült növendék (NOV-08), hiányzó óraszám (ERF-05),
  // hiányzó ráérés és engedélyezett gép (A6, A10)
  const horizonEndMs = localToMs(addDays(ctx.horizonEnd, 1), 0, ctx.tz)
  const warnings: PlanWarning[] = []
  for (const s of input.settings.students) {
    if (!Object.hasOwn(input.snapshot.lastFlightAt, s.userId)) continue
    const last = input.snapshot.lastFlightAt[s.userId]
    const threshold = s.longNoFlyDays ?? input.settings.defaults.longNoFlyDays
    const days = last ? (ctx.nowMs - toMs(last)) / 86_400_000 : Number.POSITIVE_INFINITY
    // A héten a FlightLoggerben már lefoglalt (akár más oktatóval) repülés is számít.
    const flyingThisWeek =
      proposals.some((p) => p.slot.flightStart && byId.get(p.requestId)?.kind === 'flight' && byId.get(p.requestId)?.studentIds.includes(s.userId)) ||
      ctx.bookings.some((b) => b.participantIds.includes(s.userId) && b.resourceId !== undefined && ctx.resourceKind(b.resourceId) === 'aircraft' && toMs(b.end) > ctx.nowMs && toMs(b.start) < horizonEndMs)
    if (days >= threshold && !flyingThisWeek) {
      warnings.push({ kind: 'longNoFly', message: `Régen repült növendék: ${Number.isFinite(days) ? `${Math.floor(days)} napja` : 'még nem'} repült, és a héten nincs repülése.`, requestId: s.userId })
    }
  }
  const plannedStudents = [...new Set(requests.flatMap((r) => r.studentIds))].sort()
  for (const id of plannedStudents) {
    if ((input.snapshot.availabilities[id] ?? []).length === 0) {
      warnings.push({ kind: 'missingData', message: 'Nincs megadva ráérés a hétre: a motor szabadnak veszi.', requestId: id })
    }
  }
  for (const r of requests) {
    if (r.kind !== 'flight' || ctx.resourcesFor(r).length > 0) continue
    const sid = r.studentIds[0]!
    if (!warnings.some((w) => w.kind === 'missingData' && w.requestId === sid && w.message.startsWith('Nincs engedélyezett'))) {
      warnings.push({ kind: 'missingData', message: 'Nincs engedélyezett aktív repülőgép: a repülései nem tervezhetők (Beállítások → Növendékek).', requestId: sid })
    }
  }
  for (const a of input.snapshot.fleet) {
    if (a.disabled || ctx.resourceKind(a.id) !== 'aircraft') continue
    const entry = input.settings.aircraftHours[a.id]
    if (!entry || entry.date !== ctx.today) {
      warnings.push({ kind: 'staleData', message: `${a.callSign}: a mai kirepülhető idő még nincs megadva.` })
    }
    const outlook = ctx.maintenanceOutlook(a.id)
    const win = outlook?.projection.window
    if (outlook && win && win.start < horizonEndMs) {
      const { limits, projection } = outlook
      const kind = limits.type === undefined ? 'karbantartás (a fajtája nincs megadva, túlrepüléssel nem számoltam)' : `${limits.type} órás karbantartás`
      const existing = [...projection.blocked].filter((ref) => ref.startsWith('b:')).length
      warnings.push({
        kind: 'maintenanceDue',
        message:
          `${a.callSign}: a kirepülhető keret (${hoursText(limits.hoursUntilMaintenance)} + ${hoursText(limits.overflyHours)} óra túlrepülés, ${hoursText(limits.bufferHours)} óra pufferrel) a ${ctx.timeText(win.start)}-kor kezdődő repülésnél elfogy; ` +
          `${kind} miatt ${ctx.timeText(win.end)}-ig nem tervezek rá.` +
          (existing > 0 ? ` A FlightLoggerben ${existing} foglalás esik erre az időre.` : ''),
      })
    }
  }

  warnings.push(...teamSetup.warnings)
  const teams: PlannedTeam[] = teamSetup.teams.map((t) => {
    const layout = teamLayouts.get(t.id)
    if (!layout) return { teamId: t.id, requestIds: [...t.recorded.map((r) => r.request.id), ...t.members.map((m) => m.id)], state: 'unplaced', units: [] }
    const units = teamUnits(layout)
    return { teamId: t.id, requestIds: units.flatMap((u) => u.requestIds), state: 'placed', start: toIso(layout.startMs), end: toIso(layout.endMs), units }
  })

  unplaced.sort((a, b) => a.requestId.localeCompare(b.requestId))
  return {
    proposals,
    dilemmas: orderDilemmas(dilemmas),
    unplaced,
    deferred: [...deferred].sort(),
    warnings,
    decisionIssues: issues,
    teams,
    recordedInFlightLogger,
    missingInFlightLogger: linked.missing.map((m) => m.requestId).filter((id) => byId.has(id)).sort(),
    cancelledInFlightLogger: linked.cancelled.filter((id) => byId.has(id)),
    supersededBookings: linked.superseded,
    plannedMoves: linked.plannedMoves.filter((m) => byId.has(m.requestId)),
    plannedCancels: linked.plannedCancels.filter((c) => byId.has(c.requestId)),
    completedChanges: [...linked.completedChanges.filter((c) => byId.has(c.requestId)), ...completedMoves],
    deferredStillBooked: linked.deferredStillBooked.filter((l) => byId.has(l.requestId)).map((l) => ({ requestId: l.requestId, bookingId: l.bookingId, slot: l.slot })),
  }
}

const sameTimes = (a: Times, b: Times): boolean =>
  a.startMs === b.startMs && a.endMs === b.endMs && a.flightStartMs === b.flightStartMs && a.flightEndMs === b.flightEndMs && a.resourceId === b.resourceId && a.classroomId === b.classroomId

/**
 * A dilemmák sorrendje (9.3): hatás szerint, de az összefüggők (közös igényt érintők)
 * egymás után jönnek, hogy az oktató egy helyzetet egyben láthasson.
 */
export function orderDilemmas(list: readonly Dilemma[]): Dilemma[] {
  const sorted = [...list].sort((a, b) => b.impact - a.impact || a.id.localeCompare(b.id))
  const result: Dilemma[] = []
  const used = new Set<string>()
  for (const d of sorted) {
    if (used.has(d.id)) continue
    const group = [d]
    used.add(d.id)
    const ids = new Set(d.requestIds)
    for (let grew = true; grew; ) {
      grew = false
      for (const o of sorted) {
        if (used.has(o.id) || !o.requestIds.some((id) => ids.has(id))) continue
        group.push(o)
        used.add(o.id)
        for (const id of o.requestIds) ids.add(id)
        grew = true
      }
    }
    result.push(...group)
  }
  return result
}

function scarcityOf(alternatives: number): number {
  return Math.min(1, Math.max(0, 1 - alternatives / 5))
}

function option(id: string, label: string, pros: string[], cons: string[], consequence: string, decision: Decision): DilemmaOption {
  return { id, label, pros, cons, consequence, decision }
}

/**
 * Pro és kontra érvek: a két lehetőség részpontjainak legnagyobb súlyozott eltérései (9.2),
 * pontban kifejezve (a súlyozott eltérés a súlyösszeghez mérve, 0–100 skálán).
 */
export function differences(a: Evaluation, b: Evaluation, criteria: readonly Criterion[], weights: Settings['weights']): { pros: string[]; cons: string[] } {
  const total = criteria.reduce((sum, c) => sum + weights[c], 0) || 1
  const diffs = criteria
    .map((c) => ({ c, d: weights[c] * ((a.subScores[c] ?? 0) - (b.subScores[c] ?? 0)) }))
    .filter((x) => Math.abs(x.d) >= 0.5)
    .sort((x, y) => Math.abs(y.d) - Math.abs(x.d) || x.c.localeCompare(y.c))
  const text = (x: { c: Criterion; d: number }): string => {
    const points = (100 * x.d) / total
    return `${CRITERION_LABELS[x.c]}: ${points > 0 ? 'jobb' : 'rosszabb'} (${points > 0 ? '+' : '−'}${Math.abs(points).toFixed(1).replace('.', ',')} pont)`
  }
  return { pros: diffs.filter((x) => x.d > 0).slice(0, 3).map(text), cons: diffs.filter((x) => x.d < 0).slice(0, 3).map(text) }
}

function dedupe(warnings: readonly PlanWarning[]): PlanWarning[] {
  const seen = new Set<string>()
  return warnings.filter((w) => {
    const key = `${w.kind}|${w.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** Egymást követő feladatoknál a későbbi a korábbi sikerétől függ (7.5). */
function assumptionsFor(request: BookingRequest, all: readonly Evaluation[]): string[] {
  if (request.kind === 'theory' || !request.lectureId) return []
  const sid = request.studentIds[0]
  const own = all.find((e) => e.request.id === request.id)
  if (!own) return []
  const earlier = all.filter(
    (e) => e.request.id !== request.id && e.request.kind !== 'theory' && e.request.lectureId && e.request.studentIds[0] === sid && e.times.startMs < own.times.startMs,
  )
  return earlier.length > 0 ? ['Feltételezi, hogy a növendék korábbi feladata ezen a héten sikeres lesz.'] : []
}
