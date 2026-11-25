import { acceptPlan, completeMove, deferBooked, dismissWatch, markCancelled, planCancel, planMove, planTeamMove, removeFromTeam, replanRequest, restoreDeferred, revertChange, setRecordingStatus, teamsOf, type RecordingStatus } from '@core/draft/weekPlan'
import { dismissalOf, watchWeatherText, WATCH_NOTICE_MINUTES, type WatchItem } from '@core/engine/weekWatch'
import { CapacityNotice } from '../components/openings'
import type { BookedInFlightLogger, PlannedTeam, PlanResult, Proposal, TeamUnit } from '@core/model/planning'
import { localParts, toMs } from '@core/time/zoned'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { applyReceipt, importBookingsFor, importPackageText, openImportEntries, parseReceipt, type ImportEntry } from '@core/flImport/importBookings'
import { importContext } from '../flImport'
import { api } from '../bridge'
import { Badge, Button, Card, Empty, PageHeader } from '../components/ui'
import { MoveDates, RESTORE_LOCKED_NOTE, slotLine, watchBadge, watchSummary, weatherLine } from '../components/weekWatch'
import { BOOKING_STATUS_LABELS, dateTimeFull, dateTimeShort, dayLabel, personName, requestKindLabel, requestLabel, resolveText, resourceLabel, timeOf } from '../format'
import { studentProgress, syllabusLabel } from '../progress'
import { useApp } from '../state'
import { WeekTag } from '../components/weekTag'
import { teamName } from '../components/teams'
import { recordingStateOf, type RecordingState } from '../recordingState'

/**
 * Rögzítési lista (9.6, TRV-14): napokra bontva, időrendben. Foglalásonként egy kártya, a
 * mezők a FlightLogger űrlapjának sorrendjében, mindegyik mellett másolás gombbal. A
 * „rögzített” állapot a helyet is lezárja (H02): a motor az igényt nem tervezi újra, és ha a
 * frissítés lehozza a FlightLogger-foglalást, a tétel onnan látszik. A rögzített kártya
 * összecsukódik, így a még elvégzendő tételek látszanak.
 *
 * A lap tetején a hét közbeni figyelés javaslatai (TRV-15): a FlightLoggerben lévő foglalás
 * áthelyezése, a kockázatos foglalás lemondása, a halasztott igény visszahozása és az
 * eltérések. Mindegyik a FlightLoggerben végzendő; az elfogadás után a terv ehhez igazodik.
 */

const keyOf = (p: Proposal): string => (p.standby ? `${p.requestId}#standby` : p.requestId)

/**
 * Másolt-e már az oktató ebben a munkamenetben FlightLogger-importcsomagot (FLI-08): csak ekkor
 * nézzük meg magától a vágólapot, amikor az ablakba visszatér.
 */
let importCopiedThisSession = false
const markImportCopied = (): void => {
  importCopiedThisSession = true
}

/** A rögzített, de a FlightLoggerben azóta lemondott tétel (9.6): nincs mit átírni vagy újra felvinni. */
const LAPSED_NOTE =
  'Rögzítettnek jelölted, de a FlightLoggerben azóta lemondták, így nincs meglévő foglalás, amit át kellene írni. Fent, a „Javasolt változtatások” között döntsd el: újratervezés vagy halasztás.'

/** A (még) hatás nélküli köztes állapotok jelzése (a párosítás az M5-ben jön). */
const OTHER_STATUS: Partial<Record<RecordingStatus, string>> = { checked: 'ellenőrzött', different: 'eltérő' }

export function RecordingList() {
  const app = useApp()
  const { result, weekPlan, bundle, settings, timezone } = app
  const [copied, setCopied] = useState<{ readonly key: string; readonly ok: boolean } | null>(null)
  /** A kinyitott FlightLogger-tételek (részletek) foglalás-azonosító szerint. */
  const [openBooked, setOpenBooked] = useState<ReadonlySet<string>>(new Set())
  /** A FlightLogger-import visszajelzése (másolás, visszaigazolás). */
  const [importNotice, setImportNotice] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)

  /** A visszaigazolás beolvasása a vágólapról (FLI-08); magától (`auto`) csak siker esetén szól. */
  const readReceipt = async (auto: boolean): Promise<void> => {
    if (!result || !weekPlan) return
    let clip: string
    try {
      clip = await api.readText()
    } catch {
      if (!auto) setImportNotice({ ok: false, text: 'A vágólap nem olvasható.' })
      return
    }
    const receipt = parseReceipt(clip)
    if (!receipt) {
      if (!auto) setImportNotice({ ok: false, text: 'A vágólapon nincs FlightLogger-visszaigazolás. A FlightLogger Import paneljén a „Visszaigazolás másolása” gombbal teheted oda.' })
      return
    }
    const now = new Date().toISOString()
    const outcome = applyReceipt(weekPlan, receipt, result.proposals, now)
    if (outcome.recorded.length > 0 || outcome.cancelled.length > 0) app.updatePlan((plan) => applyReceipt(plan, receipt, result.proposals, now).plan)
    if (auto && outcome.recorded.length === 0 && outcome.cancelled.length === 0) return
    const created = outcome.recorded.length - outcome.moved.length
    const parts = [
      created > 0 ? `${created} tétel rögzítettnek jelölve` : '',
      outcome.moved.length > 0 ? `${outcome.moved.length} áthelyezés a FlightLoggerben átírva` : '',
      outcome.cancelled.length > 0 ? `${outcome.cancelled.length} foglalás lemondva` : '',
      outcome.recorded.length === 0 && outcome.cancelled.length === 0 ? 'nincs új rögzítendő tétel' : '',
      outcome.skipped.length > 0 ? `${outcome.skipped.length} kihagyva a FlightLoggerben` : '',
      outcome.pending.length > 0 ? `${outcome.pending.length} még nem teljes vagy már nincs a tervben` : '',
    ].filter(Boolean)
    setImportNotice({ ok: outcome.recorded.length > 0 || outcome.cancelled.length > 0 || outcome.already.length > 0, text: `FlightLogger-visszaigazolás: ${parts.join(', ')}.` })
  }
  // Az ablakba visszatérve magától is beolvassa, ha ebben a munkamenetben már másolt importcsomagot.
  const readReceiptRef = useRef(readReceipt)
  useEffect(() => {
    readReceiptRef.current = readReceipt
  })
  useEffect(() => {
    const onFocus = (): void => {
      if (importCopiedThisSession) void readReceiptRef.current(true)
    }
    onFocus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  if (!result || !weekPlan || !bundle) return null
  const flContext = importContext(bundle, settings, timezone)
  const importEntries = openImportEntries(result, weekPlan, bundle.snapshot.bookings)
  const importCount = importEntries.reduce((n, e) => n + importBookingsFor(flContext, e).length, 0)

  /** Importcsomag a vágólapra (FLI-03): a FlightLogger oldalán az Import panelbe illeszthető. */
  const copyForImport = async (key: string, entries: readonly ImportEntry[]): Promise<void> => {
    const bookings = entries.flatMap((e) => importBookingsFor(flContext, e))
    if (bookings.length === 0) return
    if (!(await copy(key, importPackageText(bookings, timezone, new Date().toISOString())))) {
      setImportNotice({ ok: false, text: 'A vágólapra másolás nem sikerült. Próbáld újra; ha továbbra sem megy, indítsd újra az alkalmazást.' })
      return
    }
    markImportCopied()
    const updates = bookings.filter((b) => b.update).length
    const cancels = bookings.filter((b) => b.cancel).length
    const extra = [updates > 0 ? `${updates} meglévő foglalás átírása` : '', cancels > 0 ? `${cancels} lemondás` : ''].filter(Boolean).join(', ')
    setImportNotice({
      ok: true,
      text: `${bookings.length} tétel a vágólapon${extra ? ` (ebből ${extra})` : ''}. A FlightLogger foglalási oldalán nyisd meg az Import panelt, és illeszd be; mentés után ide visszatérve a tételek magától rögzítettek lesznek.`,
    })
  }

  /**
   * Az igényekhez tartozó importtételek (új foglalás, átírás, lemondás): a sor gombja ezeket
   * másolja, így a csapat átírásával járó lemondás is vele megy.
   */
  const importEntriesOf = (requestIds: readonly string[]): ImportEntry[] =>
    importEntries.filter((e) => (e.kind === 'single' ? [e.proposal.requestId] : e.kind === 'unit' ? e.unit.requestIds : e.requestIds).some((id) => requestIds.includes(id)))

  /** Egy tétel importcsomagja (FLI-03) gombként; ha nincs mit vinni, semmi. */
  const importButton = (key: string, entries: readonly ImportEntry[]) =>
    entries.length > 0 ? (
      <Button small variant="ghost" onClick={() => void copyForImport(`fli:${key}`, entries)} title="A foglalás a FlightLogger-import szkriptjének (Beállítások → FlightLogger-import): a FlightLogger oldalán beilleszthető">
        {copied?.key === `fli:${key}` ? (copied.ok ? 'másolva' : 'nem sikerült') : 'FlightLoggerbe'}
      </Button>
    ) : null
  const instructor = personName(bundle, bundle.snapshot.instructorId)
  // A tervezett tételek és a FlightLoggerben már meglévők egy időrendben (9.6).
  // A foglalási tervbe tett lemondások (9.7) a FlightLogger-foglalás napján teendők.
  // A közös briefing csapat tagjai FlightLogger-foglalásonként (pár vagy egyéni) egy tételben,
  // a repülés sorrendjében (KBR-09).
  const unitOf = new Map<string, { readonly team: PlannedTeam; readonly unit: TeamUnit }>()
  for (const t of result.teams) if (t.state === 'placed') for (const u of t.units) for (const id of u.requestIds) unitOf.set(id, { team: t, unit: u })
  const seenUnits = new Set<string>()
  const proposalRows: Row[] = []
  for (const p of result.proposals) {
    const tu = !p.standby ? unitOf.get(p.requestId) : undefined
    const unitMembers = tu ? tu.unit.requestIds.map((id) => result.proposals.find((x) => x.requestId === id && !x.standby)).filter((x): x is Proposal => x !== undefined) : []
    // Az áthelyezendő csapatfoglalás egy tételben, ha minden tagja a FlightLoggerben átírandó (KBR-11).
    const allChanged = unitMembers.length > 0 && unitMembers.every((x) => x.change)
    if (!tu || (p.change && !allChanged)) {
      proposalRows.push({ kind: 'proposal', p, start: p.slot.start })
      continue
    }
    const key = tu.unit.requestIds.join('+')
    if (seenUnits.has(key)) continue
    seenUnits.add(key)
    if (allChanged) proposalRows.push({ kind: 'unitChange', team: tu.team, unit: tu.unit, members: unitMembers, start: tu.unit.flightStart })
    else proposalRows.push({ kind: 'unit', team: tu.team, unit: tu.unit, members: unitMembers.filter((x) => !x.change), start: tu.unit.flightStart })
  }
  const rows: Row[] = [
    ...proposalRows,
    ...result.recordedInFlightLogger.map((b): Row => ({ kind: 'booked', b, start: b.slot.start })),
    ...result.plannedCancels.map((c): Row => ({ kind: 'cancel', c, start: c.slot.start })),
  ].sort((a, b) => toMs(a.start) - toMs(b.start))
  const proposals = result.proposals
  const warningCount = result.proposals.reduce((n, p) => n + p.warnings.length, 0) + result.warnings.length
  // A tervbe tett áthelyezés a FlightLoggerben még elvégzendő, akkor is, ha az igény rögzített volt.
  const statusOf = (p: Proposal): RecordingStatus => (p.standby || p.change ? 'planned' : (weekPlan.recording[p.requestId] ?? 'planned'))
  const recordable = proposals.filter((p) => !p.standby)
  const cancelsOpen = result.plannedCancels.filter((c) => !c.done).length
  const total = recordable.length + result.recordedInFlightLogger.length + result.plannedCancels.length
  // A rögzített, de a FlightLoggerben azóta lemondott tétel nem átírandó, hanem döntésre vár.
  const cancelledInFl = new Set(result.cancelledInFlightLogger)
  const stateOf = (p: Proposal): RecordingState => recordingStateOf(p, weekPlan, cancelledInFl)
  const recordedCount = recordable.filter((p) => stateOf(p) === 'done').length + result.recordedInFlightLogger.length + (result.plannedCancels.length - cancelsOpen)
  const watchItems = app.watch?.items ?? []

  const copy = async (key: string, value: string): Promise<boolean> => {
    let ok = true
    try {
      await api.copyText(value)
    } catch {
      ok = false
    }
    const state = { key, ok }
    setCopied(state)
    setTimeout(() => setCopied((c) => (c === state ? null : c)), 1500)
    return ok
  }

  /** Egy másolható érték (lásd `CopyChip`); a kulcs a „másolva” visszajelzéshez kell. */
  const chip = (k: string, value: string) => <CopyChip value={value} state={copied?.key === k ? (copied.ok ? 'copied' : 'failed') : undefined} onCopy={() => void copy(k, value)} />

  /** Dátum és idő külön is másolható (U8): a FlightLogger űrlapja mezőnként kérheti. */
  const dateTime = (k: string, iso: string | undefined) => {
    if (!iso) return <span className="muted">–</span>
    const [date = '', time = ''] = dateTimeFull(iso, timezone).split(' ')
    return (
      <>
        {chip(`${k}-d`, date)}
        {chip(`${k}-t`, time)}
      </>
    )
  }

  /** A program a növendék haladásából (H21). */
  const programOf = (studentId: string | undefined): string => {
    if (!studentId) return ''
    const progress = studentProgress(bundle, settings, studentId)
    return syllabusLabel(bundle, progress?.syllabusId) ?? [progress?.programName, progress?.revisionName].filter(Boolean).join(' – ')
  }

  const setStatus = (p: Proposal, status: RecordingStatus): void =>
    app.updatePlan((plan) => setRecordingStatus(plan, p.requestId, status, status === 'recorded' ? p.slot : undefined, new Date().toISOString()))

  const days = [...new Set(rows.map((r) => localParts(toMs(r.start), timezone).date))]
  const reqOf = (id: string) => weekPlan.requests.find((r) => r.id === id)
  const teams = teamsOf(weekPlan)

  const nowIso = (): string => new Date().toISOString()
  const who = (requestId: string): { students: string; detail: string; kind: string | undefined } => {
    const req = reqOf(requestId)
    const task = req?.lectureId ? (bundle.directory.lectures[req.lectureId]?.name ?? '') : ''
    const type = req ? (req.kind === 'flight' ? 'Egynövendékes repülés' : requestKindLabel(req)) : ''
    return { students: req?.studentIds.map((id) => personName(bundle, id)).join(', ') ?? '', detail: task || type, kind: req?.kind }
  }

  /**
   * Tervbe tett áthelyezés (9.7): a FlightLoggerben a meglévő foglalást kell átírni az új helyre.
   * Az új hely mezői másolhatók; a gomb jelzi, hogy megtörtént.
   */
  const changeRow = (p: Proposal, change: NonNullable<Proposal['change']>) => {
    const w = who(p.requestId)
    const k = `chg:${p.requestId}`
    return (
      <article key={k} className="rec-item fl-change">
        <header className="rec-head">
          <span className="rec-time">
            {timeOf(p.slot.start, timezone)}–{timeOf(p.slot.end, timezone)}
          </span>
          <span className="rec-title">
            <strong>{w.students || '–'}</strong>
            <span className="small muted">{[w.detail, resourceLabel(bundle, p.slot.resourceId ?? p.slot.classroomId)].filter(Boolean).join(' · ')}</span>
            {change.from ? (
              <>
                <MoveDates from={change.from} to={p.slot} bundle={bundle} tz={timezone} />
                <span className="small muted">A FlightLoggerben a meglévő foglalást írd át az új helyre, ne vegyél fel újat.</span>
              </>
            ) : (
              <span className="small">A FlightLogger-foglalás a legutóbbi frissítés szerint már nincs meg: vedd fel újként ide.</span>
            )}
          </span>
          <span className="rec-actions">
            <Badge tone="warn">áthelyezendő a FlightLoggerben</Badge>
            {importButton(k, importEntriesOf([p.requestId]))}
            <Button small variant="primary" onClick={() => app.updatePlan((plan) => completeMove(plan, p.requestId, p.slot, nowIso()))} title="A FlightLoggerben átírtam a foglalást erre a helyre">
              Áthelyeztem a FlightLoggerben
            </Button>
            <Button small variant="ghost" onClick={() => app.updatePlan((plan) => revertChange(plan, p.requestId))} title="A foglalás marad, ahol a FlightLoggerben van">
              Mégsem
            </Button>
          </span>
        </header>
        <div className="rec-fields">
          <RecField label="Új kezdés">{dateTime(`${k}-1`, p.slot.start)}</RecField>
          {p.slot.flightStart && <RecField label="Repülés kezdete">{dateTime(`${k}-2`, p.slot.flightStart)}</RecField>}
          {p.slot.flightEnd && <RecField label="Repülés vége">{dateTime(`${k}-3`, p.slot.flightEnd)}</RecField>}
          <RecField label="Vége">{dateTime(`${k}-4`, p.slot.end)}</RecField>
          <RecField label={w.kind === 'theory' ? 'Terem' : 'Gép'}>{chip(`${k}-r`, resourceLabel(bundle, p.slot.resourceId ?? p.slot.classroomId))}</RecField>
        </div>
      </article>
    )
  }

  /** Tervbe tett lemondás (9.7): a FlightLogger-foglalást le kell mondani; az igény halasztott. */
  const cancelRow = (c: PlanResult['plannedCancels'][number]) => {
    const w = who(c.requestId)
    return (
      <article key={`cnc:${c.requestId}`} className={`rec-item${c.done ? ' done' : ' fl-change'}`}>
        <header className="rec-head">
          <span className="rec-time">
            {timeOf(c.slot.start, timezone)}–{timeOf(c.slot.end, timezone)}
          </span>
          <span className="rec-title">
            <strong>{w.students || '–'}</strong>
            <span className="small muted">{[w.detail, resourceLabel(bundle, c.slot.resourceId ?? c.slot.classroomId)].filter(Boolean).join(' · ')}</span>
            <span className="small">
              {c.done ? 'Lemondtad; a következő frissítés megerősíti.' : 'A következő hétre halasztva a tervben: a FlightLoggerben ezt a foglalást mondd le.'}
            </span>
          </span>
          <span className="rec-actions">
            {c.done ? (
              <Badge tone="ok">✓ lemondva</Badge>
            ) : (
              <>
                <Badge tone="warn">lemondandó a FlightLoggerben</Badge>
                {importButton(`cnc:${c.requestId}`, importEntriesOf([c.requestId]).filter((e) => e.kind === 'cancel'))}
                <Button small variant="primary" onClick={() => app.updatePlan((plan) => markCancelled(plan, c.requestId, nowIso()))} title="A FlightLoggerben lemondtam a foglalást">
                  Lemondtam a FlightLoggerben
                </Button>
              </>
            )}
            {app.restoreLocked.includes(c.requestId) ? (
              <span className="small muted" title={RESTORE_LOCKED_NOTE}>
                a következő héten már döntöttél róla
              </span>
            ) : (
              <Button small variant="ghost" onClick={() => app.updatePlan((plan) => revertChange(plan, c.requestId))} title="Kiveszem a tervből: a foglalás marad, a halasztás megszűnik">
                Mégsem
              </Button>
            )}
          </span>
        </header>
      </article>
    )
  }

  /**
   * A közös briefing csapat egy FlightLogger-foglalása (KBR-09): pár (többnövendékes, Student 1 és
   * Student 2 a programjukkal és a feladatukkal) vagy egyéni foglalás. A kezdés és a vég a csapaté,
   * a repülés az egységé. A rögzítés a foglalás minden igényére szól.
   */
  const unitRow = (team: PlannedTeam, unit: TeamUnit, members: readonly Proposal[]) => {
    const k = `unit:${unit.requestIds.join('+')}`
    const first = members[0]
    if (!first) return null
    const multi = unit.bookingType === 'multiStudent'
    const type = multi ? 'Többnövendékes repülés' : 'Egynövendékes repülés'
    const lapsed = members.some((m) => stateOf(m) === 'cancelled')
    const resized = !lapsed && members.some((m) => stateOf(m) === 'resized')
    const done = members.every((m) => stateOf(m) === 'done')
    const warnings = members.flatMap((m) => m.warnings)
    const severe = warnings.some((w) => w.kind === 'limitExceeded' || w.kind === 'doubleBooking')
    const index = team.units.indexOf(unit) + 1
    const label = teams.find((t) => t.id === team.teamId)
    const resource = resourceLabel(bundle, unit.resourceId)
    const people = members.map((m) => ({ m, req: reqOf(m.requestId) }))
    const setAll = (status: RecordingStatus): void =>
      app.updatePlan((plan) => members.reduce((acc, m) => setRecordingStatus(acc, m.requestId, status, status === 'recorded' ? m.slot : undefined, nowIso()), plan))
    return (
      <article key={k} className={`rec-item rec-team${done ? ' done' : ''}${severe ? ' warn' : ''}`}>
        <header className="rec-head">
          <span className="rec-time">
            {timeOf(unit.flightStart, timezone)}–{timeOf(unit.flightEnd, timezone)}
          </span>
          <span className="rec-title">
            <strong>{people.map(({ req }) => req?.studentIds.map((id) => personName(bundle, id)).join(', ') ?? '–').join(' + ')}</strong>
            <span className="small muted">
              {[`Közös briefing: ${label ? teamName(label) : 'csapat'}, ${index}/${team.units.length}. foglalás`, `kezdés ${timeOf(first.slot.start, timezone)}, vége ${timeOf(first.slot.end, timezone)}`, resource].join(' · ')}
            </span>
          </span>
          <span className="rec-actions">
            {warnings.length > 0 && (
              <span title={warnings.map((w) => resolveText(w.message, bundle, weekPlan.requests)).join('\n')}>
                <Badge tone={severe ? 'danger' : 'warn'}>figyelmeztetés</Badge>
              </span>
            )}
            {lapsed ? (
              <Badge tone="danger">a FlightLoggerben lemondták</Badge>
            ) : resized ? (
              <>
                <Badge tone="warn">a FlightLoggerben átírandó</Badge>
                <Button small variant="primary" onClick={() => setAll('recorded')} title="A FlightLoggerben a foglalást átírtam a terv szerinti időkre">
                  Átírtam a FlightLoggerben
                </Button>
              </>
            ) : done ? (
              <>
                <Badge tone="ok">✓ rögzítve</Badge>
                <Button small variant="ghost" onClick={() => setAll('planned')} title="Mégsem rögzítettem: a tétel újra tervezhető">
                  Visszavonás
                </Button>
              </>
            ) : (
              <>
                {importButton(k, importEntriesOf(unit.requestIds))}
                <Button small variant="primary" onClick={() => setAll('recorded')} title="Felvittem a FlightLoggerbe">
                  Rögzítettnek jelölöm
                </Button>
              </>
            )}
          </span>
        </header>
        {resized && (
          <p className="small rec-note">A csapat ideje a rögzítés óta megváltozott: a FlightLoggerben a meglévő foglalást írd át (ne vegyél fel újat), a mezők lent másolhatók.</p>
        )}
        {lapsed && <p className="small rec-note">{LAPSED_NOTE}</p>}
        {!done && !lapsed && (
          <div className="rec-fields">
            <RecField label="Foglalástípus">{chip(`${k}-t`, type)}</RecField>
            {people.map(({ m, req }, i) => {
              const n = multi ? ` ${i + 1}` : ''
              return (
                <div key={m.requestId} className="rec-student">
                  <RecField label={multi ? `Student${n}` : 'Növendék'}>{chip(`${k}-s${i}`, req?.studentIds.map((id) => personName(bundle, id)).join(', ') ?? '')}</RecField>
                  <RecField label={`Program${n}`}>{chip(`${k}-p${i}`, programOf(req?.studentIds[0]))}</RecField>
                  <RecField label={`Feladat${n}`}>{chip(`${k}-l${i}`, req?.lectureId ? (bundle.directory.lectures[req.lectureId]?.name ?? '') : '')}</RecField>
                </div>
              )
            })}
            <RecField label="Kezdés">{dateTime(`${k}-1`, first.slot.start)}</RecField>
            <RecField label="Repülés kezdete">{dateTime(`${k}-2`, unit.flightStart)}</RecField>
            <RecField label="Repülés vége">{dateTime(`${k}-3`, unit.flightEnd)}</RecField>
            <RecField label="Vége">{dateTime(`${k}-4`, first.slot.end)}</RecField>
            <RecField label="Gép">{chip(`${k}-r`, resource)}</RecField>
          </div>
        )}
      </article>
    )
  }

  /**
   * Áthelyezendő csapatfoglalás (KBR-11, 9.7): a FlightLoggerben a meglévő foglalást kell átírni a
   * csapat új idejére; párnál a repülési ablak a két tag repülése a cserével együtt.
   */
  const unitChangeRow = (team: PlannedTeam, unit: TeamUnit, members: readonly Proposal[]) => {
    const k = `uchg:${unit.requestIds.join('+')}`
    const first = members[0]
    const change = first?.change
    if (!first || !change) return null
    const label = teams.find((t) => t.id === team.teamId)
    const names = members.map((m) => who(m.requestId).students || '–').join(' + ')
    const to = { ...first.slot, flightStart: unit.flightStart, flightEnd: unit.flightEnd }
    return (
      <article key={k} className="rec-item rec-team fl-change">
        <header className="rec-head">
          <span className="rec-time">
            {timeOf(unit.flightStart, timezone)}–{timeOf(unit.flightEnd, timezone)}
          </span>
          <span className="rec-title">
            <strong>{names}</strong>
            <span className="small muted">
              {[`Közös briefing: ${label ? teamName(label) : 'csapat'}, ${team.units.indexOf(unit) + 1}/${team.units.length}. foglalás`, unit.bookingType === 'multiStudent' ? 'Többnövendékes repülés' : 'Egynövendékes repülés', resourceLabel(bundle, unit.resourceId)].join(' · ')}
            </span>
            {change.from ? (
              <>
                <MoveDates from={change.from} to={to} bundle={bundle} tz={timezone} />
                <span className="small muted">A FlightLoggerben a meglévő foglalást írd át a csapat új idejére, ne vegyél fel újat.</span>
              </>
            ) : (
              <span className="small">A FlightLogger-foglalás a legutóbbi frissítés szerint már nincs meg: vedd fel újként ide.</span>
            )}
          </span>
          <span className="rec-actions">
            <Badge tone="warn">áthelyezendő a FlightLoggerben</Badge>
            {importButton(k, importEntriesOf(unit.requestIds))}
            <Button small variant="primary" onClick={() => app.updatePlan((plan) => members.reduce((acc, m) => completeMove(acc, m.requestId, m.slot, nowIso()), plan))} title="A FlightLoggerben átírtam a foglalást erre a helyre">
              Áthelyeztem a FlightLoggerben
            </Button>
            <Button small variant="ghost" onClick={() => app.updatePlan((plan) => members.reduce((acc, m) => revertChange(acc, m.requestId), plan))} title="A foglalás marad, ahol a FlightLoggerben van">
              Mégsem
            </Button>
          </span>
        </header>
        <div className="rec-fields">
          <RecField label="Új kezdés">{dateTime(`${k}-1`, first.slot.start)}</RecField>
          <RecField label="Repülés kezdete">{dateTime(`${k}-2`, unit.flightStart)}</RecField>
          <RecField label="Repülés vége">{dateTime(`${k}-3`, unit.flightEnd)}</RecField>
          <RecField label="Vége">{dateTime(`${k}-4`, first.slot.end)}</RecField>
          <RecField label="Gép">{chip(`${k}-r`, resourceLabel(bundle, unit.resourceId))}</RecField>
        </div>
      </article>
    )
  }

  /** A FlightLoggerben lévő foglalás összecsukott sora (9.6). */
  const bookedRow = (b: BookedInFlightLogger) => {
    const req = reqOf(b.requestId)
    const students = req?.studentIds.map((id) => personName(bundle, id)).join(', ') ?? ''
    const task = req?.lectureId ? (bundle.directory.lectures[req.lectureId]?.name ?? '') : ''
    // A többnövendékes foglalás növendékenként egy igényé (KBR-10): mindegyiknek saját sora van.
    const multi = bundle.snapshot.bookings.find((x) => x.id === b.bookingId)?.type === 'multiStudent'
    const type = req ? (req.kind === 'flight' ? (multi ? 'Többnövendékes repülés' : 'Egynövendékes repülés') : requestKindLabel(req)) : ''
    const k = `fl:${b.bookingId}:${b.requestId}`
    const isOpen = openBooked.has(b.bookingId)
    const toggle = (): void =>
      setOpenBooked((all) => {
        const next = new Set(all)
        if (!next.delete(b.bookingId)) next.add(b.bookingId)
        return next
      })
    const watchItem = app.watch?.items.find((i) => i.requestId === b.requestId)
    const wx = b.slot.flightStart && b.slot.resourceId ? weatherLine(bundle, settings, b.slot) : undefined
    const status = bundle.snapshot.bookings.find((x) => x.id === b.bookingId)?.status
    // A FlightLogger-foglalás repült ideje eltér az igény mostani feladatáétól (például azóta váltott feladatot).
    const flMinutes = b.slot.flightStart && b.slot.flightEnd ? Math.round((toMs(b.slot.flightEnd) - toMs(b.slot.flightStart)) / 60_000) : undefined
    const lengthDiffers = req !== undefined && req.kind !== 'theory' && flMinutes !== undefined && flMinutes !== req.durations.main
    return (
      <article key={k} className={`rec-item done${isOpen ? ' open' : ''}`}>
        <header className="rec-head">
          <span className="rec-time">
            {timeOf(b.slot.start, timezone)}–{timeOf(b.slot.end, timezone)}
          </span>
          <span className="rec-title">
            <strong>{students || '–'}</strong>
            <span className="small muted">{[task || type, resourceLabel(bundle, b.slot.resourceId ?? b.slot.classroomId)].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="rec-actions">
            <span title={b.detected ? 'Nem jelölted rögzítettnek, de a FlightLoggerben megtaláltam (növendék és feladat szerint): a terv nem tervezi újra.' : b.moved ? 'A FlightLoggerben máshol van, mint ahová rögzítetted; a terv a FlightLogger szerinti helyet veszi.' : 'A terv ezt a helyet a FlightLoggerből veszi.'}>
              <Badge tone="ok">✓ a FlightLoggerben{b.detected ? ' (felismerve)' : b.moved ? ' (ott áthelyezve)' : ''}</Badge>
            </span>
            {lengthDiffers && (
              <span title={`A FlightLoggerben ${flMinutes} perc repülés van, az igény feladata ${req.durations.main} perc. Ha a feladatot váltottad, ott is írd át a foglalást; a terv a FlightLogger szerinti hosszal számol.`}>
                <Badge tone="warn">
                  {flMinutes} p a FlightLoggerben, az igényen {req.durations.main} p
                </Badge>
              </span>
            )}
            {watchItem && watchBadge(watchItem)}
            <Button small variant="ghost" onClick={toggle} title={isOpen ? 'A részletek bezárása' : 'A FlightLogger-foglalás adatai'}>
              {isOpen ? 'Bezárás' : 'Részletek'}
            </Button>
          </span>
        </header>
        {isOpen && (
          <div className="rec-fields">
            <RecField label="Növendék">{chip(`${k}-s`, students)}</RecField>
            <RecField label="Program">{chip(`${k}-p`, req && req.kind !== 'theory' ? programOf(req.studentIds[0]) : '')}</RecField>
            <RecField label="Foglalástípus">{chip(`${k}-t`, type)}</RecField>
            <RecField label="Feladat">{chip(`${k}-l`, task)}</RecField>
            <RecField label="Kezdés">{dateTime(`${k}-1`, b.slot.start)}</RecField>
            {b.slot.flightStart && <RecField label="Repülés kezdete">{dateTime(`${k}-2`, b.slot.flightStart)}</RecField>}
            {b.slot.flightEnd && <RecField label="Repülés vége">{dateTime(`${k}-3`, b.slot.flightEnd)}</RecField>}
            <RecField label="Vége">{dateTime(`${k}-4`, b.slot.end)}</RecField>
            <RecField label={req?.kind === 'theory' ? 'Terem' : 'Gép'}>{chip(`${k}-r`, resourceLabel(bundle, b.slot.resourceId ?? b.slot.classroomId))}</RecField>
            {status && (
              <RecField label="Állapot">
                <span>{BOOKING_STATUS_LABELS[status]}</span>
              </RecField>
            )}
            {wx && (
              <RecField label="Időjárás a repülés kezdetén" wide>
                <span className="small">{wx}</span>
              </RecField>
            )}
            {watchItem && (
              <RecField label="Hét közbeni figyelés" wide>
                <span className="small">
                  {watchSummary(watchItem, timezone)} – a javaslat a lap tetején van.
                </span>
              </RecField>
            )}
          </div>
        )}
      </article>
    )
  }

  return (
    <div className="page">
      <PageHeader
        title="Rögzítési lista"
        week={<WeekTag />}
        actions={
          <>
            {importCount > 0 && (
              <Button variant="primary" onClick={() => void copyForImport('fli:all', importEntries)} title="Az összes még fel nem vitt foglalás a FlightLogger-import szkriptjének (FLI-03)">
                {copied?.key === 'fli:all' ? (copied.ok ? 'Vágólapon' : 'Nem sikerült') : `Mind a FlightLoggerbe (${importCount})`}
              </Button>
            )}
            <Button variant="ghost" onClick={() => void readReceiptRef.current(false)} title="A FlightLogger-import visszaigazolása a vágólapról: a létrehozott foglalások rögzítettek lesznek">
              Visszaigazolás beolvasása
            </Button>
            {warningCount > 0 && (
              <Button variant="ghost" onClick={() => app.navigate('warnings')} title="Ellenőrizd rögzítés előtt">
                <Badge tone="warn">{warningCount}</Badge> figyelmeztetés
              </Button>
            )}
            {/* A terv elfogadása (TRV-18) innen is: ugyanaz, mint a Tervezetben. */}
            <Button
              variant={weekPlan.acceptedAt ? 'ghost' : 'primary'}
              title="A mostani helyek lesznek az újratervezés alapja: hét közbeni változásnál a motor a lehető legkevesebbet mozdít (terv stabilitása)."
              onClick={() => app.updatePlan((plan) => acceptPlan(plan, result.proposals, nowIso()))}
            >
              {weekPlan.acceptedAt ? `Elfogadva: ${dateTimeShort(weekPlan.acceptedAt, timezone)} – újra elfogadom` : 'Terv elfogadása'}
            </Button>
          </>
        }
        lead="Vidd fel a foglalásokat a FlightLoggerbe: a mezők az űrlap sorrendjében vannak, a gombbal vágólapra másolhatók. Felvitel után jelöld rögzítettnek; a terv ezt a helyet megtartja. Ha az iskola tiltja a figyelmeztetéses foglalást, az ilyen tételt a FlightLogger elutasíthatja."
      />

      {importNotice && (
        <div className={`banner ${importNotice.ok ? 'info' : 'error'} row wrap`} role="status">
          <span>{importNotice.text}</span>
          <Button small variant="ghost" onClick={() => setImportNotice(null)}>
            Bezárás
          </Button>
        </div>
      )}
      {app.watch?.capacity && <CapacityNotice capacity={app.watch.capacity} />}
      {watchItems.length > 0 && <WatchSection items={watchItems} />}

      {rows.length === 0 ? (
        <Card>
          <Empty>Nincs rögzítendő foglalás.</Empty>
        </Card>
      ) : (
        <>
          <div className="rec-summary">
            <div className="rec-field">
              <span className="rec-label">Oktató (minden foglalásnál)</span>
              <div className="rec-values">
                {chip('instructor', instructor)}
              </div>
            </div>
            <div className="rec-progress" aria-label="Rögzítés állása">
              <strong>
                {recordedCount}/{total}
              </strong>{' '}
              rögzítve
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${total ? (recordedCount / total) * 100 : 0}%` }} />
              </div>
            </div>
          </div>

          {days.map((day) => {
            const dayRows = rows.filter((r) => localParts(toMs(r.start), timezone).date === day)
            const items = dayRows.flatMap((r) => (r.kind === 'proposal' ? [r.p] : r.kind === 'unit' || r.kind === 'unitChange' ? [...r.members] : []))
            const open = items.filter((p) => !p.standby && stateOf(p) !== 'done').length + dayRows.filter((r) => r.kind === 'cancel' && !r.c.done).length
            return (
              <section key={day} className="rec-day" aria-label={dayLabel(day)}>
                <div className="rec-day-head">
                  <h2>{dayLabel(day)}</h2>
                  <span className="small muted">{open === 0 ? 'minden rögzítve' : `${open} rögzítendő`}</span>
                </div>
                {dayRows.map((row) => {
                  if (row.kind === 'booked') return bookedRow(row.b)
                  if (row.kind === 'cancel') return cancelRow(row.c)
                  if (row.kind === 'unit') return unitRow(row.team, row.unit, row.members)
                  if (row.kind === 'unitChange') return unitChangeRow(row.team, row.unit, row.members)
                  if (row.p.change) return changeRow(row.p, row.p.change)
                  const p = row.p
                  const req = reqOf(p.requestId)
                  const k = keyOf(p)
                  const status = statusOf(p)
                  const state = stateOf(p)
                  // A rögzítés óta a feladat (időtartam) változott: a FlightLoggerben is át kell írni (H02).
                  const savedSlot = weekPlan.recordedSlots?.[p.requestId]
                  const resized = state === 'resized'
                  const done = state === 'done'
                  // A FlightLoggerben lemondták: nincs mit átírni, a döntés a javasolt változtatások között van.
                  const lapsed = state === 'cancelled'
                  const students = req?.studentIds.map((id) => personName(bundle, id)).join(', ') ?? ''
                  const task = req?.lectureId ? (bundle.directory.lectures[req.lectureId]?.name ?? '') : ''
                  const type = req ? (req.kind === 'flight' ? 'Egynövendékes repülés' : requestKindLabel(req)) : ''
                  const resource = resourceLabel(bundle, p.slot.resourceId ?? p.slot.classroomId)
                  const severe = p.warnings.some((w) => w.kind === 'limitExceeded' || w.kind === 'doubleBooking')
                  return (
                    <article key={k} className={`rec-item${done ? ' done' : ''}${severe ? ' warn' : ''}`}>
                      <header className="rec-head">
                        <span className="rec-time">
                          {timeOf(p.slot.start, timezone)}–{timeOf(p.slot.end, timezone)}
                        </span>
                        <span className="rec-title">
                          <strong>{students || '–'}</strong>
                          <span className="small muted">{[task || type, resource].filter(Boolean).join(' · ')}</span>
                        </span>
                        <span className="rec-actions">
                          {p.warnings.length > 0 && (
                            <span title={p.warnings.map((w) => resolveText(w.message, bundle, weekPlan.requests)).join('\n')}>
                              <Badge tone={severe ? 'danger' : 'warn'}>figyelmeztetés</Badge>
                            </span>
                          )}
                          {OTHER_STATUS[status] && <Badge tone="info">{OTHER_STATUS[status]}</Badge>}
                          {p.standby ? (
                            <Badge tone="info">standby – nem kell rögzíteni</Badge>
                          ) : lapsed ? (
                            <Badge tone="danger">a FlightLoggerben lemondták</Badge>
                          ) : resized ? (
                            <>
                              <Badge tone="warn">a FlightLoggerben átírandó</Badge>
                              <Button small variant="primary" onClick={() => setStatus(p, 'recorded')} title="A FlightLoggerben a foglalást átírtam az új időtartamra">
                                Átírtam a FlightLoggerben
                              </Button>
                              <Button small variant="ghost" onClick={() => setStatus(p, 'planned')} title="Mégsem rögzítettem: a tétel újra tervezhető">
                                Visszavonás
                              </Button>
                            </>
                          ) : done ? (
                            <>
                              <Badge tone="ok">✓ rögzítve</Badge>
                              <Button small variant="ghost" onClick={() => setStatus(p, 'planned')} title="Mégsem rögzítettem: a tétel újra tervezhető">
                                Visszavonás
                              </Button>
                            </>
                          ) : (
                            <>
                              {req && importButton(k, importEntriesOf([p.requestId]))}
                              <Button small variant="primary" onClick={() => setStatus(p, 'recorded')} title="Felvittem a FlightLoggerbe">
                                Rögzítettnek jelölöm
                              </Button>
                            </>
                          )}
                        </span>
                      </header>
                      {resized && savedSlot && (
                        <p className="small rec-note">
                          A rögzítés óta megváltozott a feladat vagy az időtartam: a FlightLoggerben {timeOf(savedSlot.start, timezone)}–{timeOf(savedSlot.end, timezone)} van, a terv szerint{' '}
                          {timeOf(p.slot.start, timezone)}–{timeOf(p.slot.end, timezone)}. Írd át a meglévő foglalást (ne vegyél fel újat), a mezők lent másolhatók.
                        </p>
                      )}
                      {lapsed && <p className="small rec-note">{LAPSED_NOTE}</p>}
                      {!done && !lapsed && !p.standby && (
                        <div className="rec-fields">
                          <RecField label="Növendék">
                            {chip(`${k}-s`, students)}
                          </RecField>
                          <RecField label="Program">
                            {chip(`${k}-p`, req && req.kind !== 'theory' ? programOf(req.studentIds[0]) : '')}
                          </RecField>
                          <RecField label="Foglalástípus">
                            {chip(`${k}-t`, type)}
                          </RecField>
                          <RecField label="Feladat">
                            {chip(`${k}-l`, task)}
                          </RecField>
                          <RecField label="Kezdés">
                            {dateTime(`${k}-1`, p.slot.start)}
                          </RecField>
                          {p.slot.flightStart && (
                            <RecField label="Repülés kezdete">
                              {dateTime(`${k}-2`, p.slot.flightStart)}
                            </RecField>
                          )}
                          {p.slot.flightEnd && (
                            <RecField label="Repülés vége">
                              {dateTime(`${k}-3`, p.slot.flightEnd)}
                            </RecField>
                          )}
                          <RecField label="Vége">
                            {dateTime(`${k}-4`, p.slot.end)}
                          </RecField>
                          <RecField label={req?.kind === 'theory' ? 'Terem' : 'Gép'}>
                            {chip(`${k}-r`, resource)}
                          </RecField>
                          {p.comment && (
                            <RecField label="Komment" wide>
                              {chip(`${k}-c`, p.comment)}
                            </RecField>
                          )}
                        </div>
                      )}
                    </article>
                  )
                })}
              </section>
            )
          })}

          {result.recordedInFlightLogger.length > 0 && (
            <p className="small muted">
              A „✓ a FlightLoggerben” tételeket a terv a FlightLoggerből veszi, nem tervezi újra. Ha ott áthelyezed vagy lemondod, a következő frissítés után a terv is
              követi; a hét közbeni változásokra a lap tetején kapsz javaslatot.
            </p>
          )}
        </>
      )}
    </div>
  )
}

type Row =
  | { readonly kind: 'proposal'; readonly p: Proposal; readonly start: string }
  | { readonly kind: 'unit'; readonly team: PlannedTeam; readonly unit: TeamUnit; readonly members: readonly Proposal[]; readonly start: string }
  | { readonly kind: 'unitChange'; readonly team: PlannedTeam; readonly unit: TeamUnit; readonly members: readonly Proposal[]; readonly start: string }
  | { readonly kind: 'booked'; readonly b: BookedInFlightLogger; readonly start: string }
  | { readonly kind: 'cancel'; readonly c: PlanResult['plannedCancels'][number]; readonly start: string }

/**
 * A hét közbeni figyelés javaslatai (TRV-15), egyenként elfogadhatóan. Az elfogadás csak a
 * foglalási tervbe teszi a változtatást; a FlightLoggerben a lenti listából kell elvégezni (ott az
 * áthelyezés új mezői másolhatók, és a meglévő foglalást kell átírni, nem újat felvinni).
 */
function WatchSection(props: { items: readonly WatchItem[] }) {
  const app = useApp()
  const { bundle, weekPlan, settings, timezone } = app
  if (!bundle || !weekPlan) return null
  const nowIso = (): string => new Date().toISOString()
  const reqOf = (id: string) => weekPlan.requests.find((r) => r.id === id)
  const keep = (item: WatchItem): void => {
    const d = dismissalOf(item)
    if (d) app.updatePlan((p) => dismissWatch(p, item.requestId, d.kind, d.from, nowIso()))
  }
  return (
    <section className="watch-section" aria-label="Javasolt változtatások">
      <div className="rec-day-head">
        <h2>Javasolt változtatások ({props.items.length})</h2>
        <span className="small muted">
          a friss adat szerint; legkorábban {WATCH_NOTICE_MINUTES / 60} óra múlva kezdődő helyre. Az elfogadott javaslat a foglalási tervbe kerül; a FlightLoggerben a lenti
          listából viszed át.
        </span>
      </div>
      {props.items.map((item) => {
        const req = reqOf(item.requestId)
        const k = `w:${item.kind}:${item.requestId}`
        const title = <strong>{requestLabel(bundle, req)}</strong>
        if (item.kind === 'move') {
          const fromWx = weatherLine(bundle, settings, item.from)
          const toWx = weatherLine(bundle, settings, item.to)
          return (
            <article key={k} className={`rec-item watch-item${item.urgent ? ' warn' : ''}`}>
              <header className="rec-head">
                <span className="rec-title">
                  <span>
                    {watchBadge(item)} {item.team ? <strong>Közös briefing csapat ({item.team.members.length} fő)</strong> : title}
                    {item.leavesTeam && <Badge tone="warn">kiválva a csapatból</Badge>}
                  </span>
                  {item.team && (
                    <ul className="plain small">
                      {item.team.members.map((m) => (
                        <li key={m.requestId}>
                          {requestLabel(bundle, reqOf(m.requestId))}: {timeOf(m.from.flightStart ?? m.from.start, timezone)} → {dayLabel(localParts(toMs(m.to.start), timezone).date)}{' '}
                          {timeOf(m.to.flightStart ?? m.to.start, timezone)}
                          {m.bookingId ? '' : ' (még csak a tervben)'}
                        </li>
                      ))}
                    </ul>
                  )}
                  <MoveDates
                    from={item.from}
                    to={item.to}
                    bundle={bundle}
                    tz={timezone}
                    fromNote={item.weather || fromWx ? [item.weather ? `${watchWeatherText(item.weather.from)} idő` : '', fromWx ?? ''].filter(Boolean).join(' · ') : undefined}
                    toNote={item.weather || toWx ? [item.weather ? `${watchWeatherText(item.weather.to)} idő` : '', toWx ?? ''].filter(Boolean).join(' · ') : undefined}
                  />
                </span>
                <span className="rec-actions">
                  <Button
                    small
                    variant="primary"
                    onClick={() =>
                      app.updatePlan((p) => {
                        const team = item.team
                        // A csapat együtt mozog (KBR-11); a kiváló tag a terv csapatából is kikerül.
                        if (team) return planTeamMove(p, team.teamId, team.members.map((m) => ({ requestId: m.requestId, ...(m.bookingId ? { bookingId: m.bookingId } : {}), slot: m.to })), nowIso())
                        if (item.leavesTeam) return planMove(removeFromTeam(p, item.requestId), item.requestId, item.bookingId, item.to)
                        return planMove(p, item.requestId, item.bookingId, item.to)
                      })
                    }
                    title="A terv az új helyet követi; a FlightLoggerben a lenti listából írod át"
                  >
                    Foglalási tervbe teszem
                  </Button>
                  <Button small variant="ghost" onClick={() => keep(item)} title={item.urgent ? 'A foglalás marad; amíg itt van, erről nem szólok újra' : 'A foglalás marad; amíg itt van, csak új akadály esetén szólok újra'}>
                    Marad így
                  </Button>
                </span>
              </header>
              <div className="watch-why">
                <ul className="plain small">
                  {item.reasons.map((r) => (
                    <li key={r}>⚠ {resolveText(r, bundle, weekPlan.requests)}</li>
                  ))}
                  {item.pros.map((r) => (
                    <li key={`p${r}`} className="pro">
                      + {r}
                    </li>
                  ))}
                  {item.cons.map((r) => (
                    <li key={`c${r}`} className="con">
                      − {r}
                    </li>
                  ))}
                </ul>
              </div>
            </article>
          )
        }
        if (item.kind === 'atRisk') {
          return (
            <article key={k} className="rec-item watch-item warn">
              <header className="rec-head">
                <span className="rec-title">
                  <span>
                    {watchBadge(item)} {title}
                  </span>
                  <span className="small">
                    {slotLine(item.from, bundle, timezone)} – a héten nincs tiszta hely, ahová áttehetném{item.weather === 'unflyable' || item.weather === 'marginal' ? ' repülhető idővel' : ''}.
                  </span>
                </span>
                <span className="rec-actions">
                  <Button variant="defer" small onClick={() => app.updatePlan((p) => planCancel(p, item.requestId, item.bookingId))} title="Az igény a következő hétre kerül; a FlightLoggerben a lenti listából mondod le">
                    Halasztás a foglalási tervbe
                  </Button>
                  <Button small variant="ghost" onClick={() => keep(item)}>
                    Marad így
                  </Button>
                </span>
              </header>
              <div className="watch-why">
                <ul className="plain small">
                  {item.reasons.map((r) => (
                    <li key={r}>⚠ {resolveText(r, bundle, weekPlan.requests)}</li>
                  ))}
                </ul>
              </div>
            </article>
          )
        }
        if (item.kind === 'restore') {
          const wx = weatherLine(bundle, settings, item.to)
          return (
            <article key={k} className="rec-item watch-item">
              <header className="rec-head">
                <span className="rec-title">
                  <span>
                    {watchBadge(item)} {title}
                  </span>
                  <span className="small">
                    A következő hétre halasztottad; most van helye: <strong>{slotLine(item.to, bundle, timezone)}</strong>
                    {item.weather ? ` – ${watchWeatherText(item.weather)} idő` : ''}
                    {wx ? <span className="muted"> ({wx})</span> : null}
                  </span>
                  {item.displaced.length > 0 && (
                    <span className="small con-text">Ezzel kiszorul a tervből: {item.displaced.map((id) => requestLabel(bundle, reqOf(id))).join(', ')}.</span>
                  )}
                  {item.moved.length > 0 && <span className="small muted">Ezzel máshová kerül a tervben: {item.moved.map((id) => requestLabel(bundle, reqOf(id))).join(', ')}.</span>}
                </span>
                <span className="rec-actions">
                  <Button small variant="primary" onClick={() => app.updatePlan((p) => restoreDeferred(p, item.requestId, item.to))} title="Visszakerül erre a hétre a javasolt helyre; a FlightLoggerbe a lenti listából viszed fel">
                    Foglalási tervbe teszem
                  </Button>
                  <Button small variant="ghost" onClick={() => keep(item)}>
                    Marad halasztva
                  </Button>
                </span>
              </header>
            </article>
          )
        }
        if (item.kind === 'missing') {
          return (
            <article key={k} className="rec-item watch-item">
              <header className="rec-head">
                <span className="rec-title">
                  <span>
                    {watchBadge(item)} {title}
                  </span>
                  <span className="small">
                    {item.cancelled
                      ? `Rögzítettnek jelölted (${slotLine(item.slot, bundle, timezone)}), de a FlightLoggerben lemondták. Újratervezésnél a motor a mostani időponttól keres új helyet; halasztásnál a következő hétre kerül.`
                      : `Rögzítettnek jelölted (${slotLine(item.slot, bundle, timezone)}), de a legutóbbi frissítés szerint nincs ilyen foglalás a FlightLoggerben (törölték, vagy még nem vitted fel). Ha most viszed fel, a következő frissítés után ez a jelzés eltűnik.`}
                  </span>
                </span>
                <span className="rec-actions">
                  <Button small onClick={() => app.updatePlan((p) => replanRequest(p, item.requestId, nowIso()))} title="A motor a mostani időponttól keres új helyet; a régi hely és a korábbi kézi döntés megszűnik">
                    {item.cancelled ? 'Újratervezés' : 'Nincs meg – újratervezés'}
                  </Button>
                  <Button small variant="defer" onClick={() => app.updatePlan((p) => deferBooked(p, item.requestId, undefined, nowIso()))} title="A következő hétre kerül">
                    Halasztás
                  </Button>
                  {!item.cancelled && (
                    <Button small variant="ghost" onClick={() => keep(item)} title="A hely továbbra is le van zárva">
                      Megvan, marad
                    </Button>
                  )}
                </span>
              </header>
            </article>
          )
        }
        return (
          <article key={k} className="rec-item watch-item">
            <header className="rec-head">
              <span className="rec-title">
                <span>
                  {watchBadge(item)} {title}
                </span>
                <span className="small">
                  A következő hétre halasztottad, de a legutóbbi frissítés szerint a FlightLoggerben még foglalva van: {slotLine(item.slot, bundle, timezone)}. Ha már lemondtad, a
                  következő frissítés után ez eltűnik.
                </span>
              </span>
              <span className="rec-actions">
                {app.restoreLocked.includes(item.requestId) ? (
                  <span className="small muted" title={RESTORE_LOCKED_NOTE}>
                    a következő héten már döntöttél róla
                  </span>
                ) : (
                  <Button small variant="ghost" onClick={() => app.updatePlan((p) => ({ ...p, decisions: p.decisions.filter((d) => !(d.kind === 'defer' && d.requestId === item.requestId)) }))} title="A FlightLogger-foglalás marad, a halasztás megszűnik">
                    Mégsem halasztom
                  </Button>
                )}
              </span>
            </header>
          </article>
        )
      })}
    </section>
  )
}

/** Másolható érték: a gomb maga az érték, a másolás ikonja mindig látszik, kattintás után „másolva”. */
function CopyChip(props: { value: string; state: 'copied' | 'failed' | undefined; onCopy: () => void }) {
  if (!props.value) return <span className="muted">–</span>
  return (
    <button type="button" className={props.state ? `copy-chip ${props.state}` : 'copy-chip'} onClick={props.onCopy} title="Másolás a vágólapra" aria-label={`${props.value} másolása`}>
      <span className="copy-chip-text">{props.value}</span>
      <span className="copy-chip-state" aria-live="polite">
        {props.state === 'copied' ? 'másolva' : props.state === 'failed' ? 'nem sikerült' : <CopyIcon />}
      </span>
    </button>
  )
}

/** Egy űrlapmező: címke és egy vagy több másolható érték. */
function RecField(props: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={props.wide ? 'rec-field wide' : 'rec-field'}>
      <span className="rec-label">{props.label}</span>
      <div className="rec-values">{props.children}</div>
    </div>
  )
}

/** Másolás ikon (két egymásra tett lap), a szöveg színét követi. */
function CopyIcon() {
  return (
    <svg className="copy-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="5" y="5" width="9" height="9" rx="1.5" />
      <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
    </svg>
  )
}
