import { useEffect, useRef, useState } from 'react'
import { createTeam, newRequestId, removeFromTeam, requestTotals, setBriefingSource, setRequestTask, teamsOf, type RequestTotals, type WeekPlan } from '@core/draft/weekPlan'
import type { DataBundle } from '@core/model/dataBundle'
import type { BookingRequest, BriefingSource, Decision } from '@core/model/planning'
import { bookedLectureIds, newFlightRequest, takenLectureIds } from '@core/progress/autoAssign'
import { programLectures, type LectureInfo, type StudentProgress } from '@core/progress/lectures'
import { isRouteFlight, routeLabel } from '@core/route/timing'
import { daysBetween, localParts, localToMs, toMs } from '@core/time/zoned'
import { RouteEditor } from '../components/routeEditor'
import { TeamControl, TeamDialog, teamName } from '../components/teams'
import { TimingEditor } from '../components/timingEditor'
import { Badge, Button, Card, NumberInput, PageHeader, Segmented, TextInput } from '../components/ui'
import { FlField, FlOnlySection } from '../components/flOnly'
import { hoursMinutes, personName } from '../format'
import { studentProgress, syllabusLabel } from '../progress'
import { todayIn, useApp } from '../state'
import { WeekTag } from '../components/weekTag'
import { PrioritySelect } from '../components/priority'
import { OpeningsButton } from '../components/openings'

/**
 * Heti igények (6. fejezet 2. lépés, TRV-20, TRV-21, SZB-02, 7.5).
 *
 * Bal oldalt a növendékek: egy kattintás felveszi a növendéket a hétre, és rögtön kap egy
 * igényt a soron következő feladattal (automatikus módban a rendszer választ, a lefoglalt
 * jövőbeli feladatokat átugorva). Jobb oldalt az igények növendékenként csoportosítva; a
 * feladat, a fajta, az időtartam és az időpont igényenként átírható. Felül a heti repült idő
 * összesítése az igények alapján. Törlés után a művelet visszavonható.
 *
 * Az átláthatóságért a jobb oldalon egyszerre csak egy növendék csoportja van lenyitva; a
 * többi egy sorba csukva mutatja a nevet, az összesítést és az igények rövid listáját.
 */
export function WeeklyRequests() {
  const app = useApp()
  const { settings, bundle, weekPlan, timezone } = app
  const [undo, setUndo] = useState<UndoEntry | null>(null)
  // A lenyitott növendék; egyszerre legfeljebb egy.
  const [openId, setOpenId] = useState<string | null>(null)
  // A „Közös briefing szervezése” ablak (KBR-03) és a kézi csapatba szervezés visszajelzése (KBR-04).
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [teamNotice, setTeamNotice] = useState<{ readonly requestId: string; readonly teamId: string; readonly created: boolean } | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 10_000)
    return () => clearTimeout(timer)
  }, [undo])

  useEffect(() => {
    if (!teamNotice) return
    const timer = setTimeout(() => setTeamNotice(null), 10_000)
    return () => clearTimeout(timer)
  }, [teamNotice])

  if (!settings || !weekPlan) return null
  const today = todayIn(timezone)
  const requests = weekPlan.requests.filter((r) => r.kind !== 'theory')
  const defaultStart = new Date(localToMs(weekPlan.weekStart, 9 * 60, timezone)).toISOString()
  const catalog = bundle?.directory.lectures ?? {}
  const totals = requestTotals(requests)

  const activeAircraft = (bundle?.snapshot.fleet ?? []).filter((a) => !a.disabled && (settings.resources[a.id]?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')) === 'aircraft')
  const hasActiveAircraft = (st: (typeof settings.students)[number]): boolean => {
    if (!bundle) return true
    const refs = [...st.allowedResources, ...(st.preferredResources ?? [])]
    return activeAircraft.some((a) => refs.some((ref) => ('aircraftId' in ref ? ref.aircraftId === a.id : ref.aircraftType === a.model)))
  }
  const missingDataOf = (st: (typeof settings.students)[number]): string[] => {
    const out: string[] = []
    if (!hasActiveAircraft(st)) {
      out.push('Nincs engedélyezett aktív repülőgép: a repülései nem tervezhetők (Beállítások → Növendékek).')
    }
    if (bundle && bundle.source === 'live' && (bundle.snapshot.availabilities[st.userId] ?? []).length === 0) {
      out.push('Nincs megadva ráérés a hétre: a motor szabadnak veszi.')
    }
    return out
  }
  // A héten szereplő növendékek: a kijelöltek és akiknek igényük van, a beállítások sorrendjében.
  const withRequests = new Set(requests.flatMap((r) => r.studentIds))
  const included = new Set([...weekPlan.selectedStudentIds, ...withRequests])
  const knownIds = settings.students.map((s) => s.userId)
  const groupIds = [...knownIds.filter((id) => included.has(id)), ...[...included].filter((id) => !knownIds.includes(id))]

  // A pillanatkép ideje: a „jövőbeli” foglalás ehhez képest értendő (bundle nélkül nincs foglalás sem).
  const nowMs = bundle ? Date.parse(bundle.snapshot.generatedAt) : 0
  const booked = (studentId: string): Set<string> => bookedLectureIds(studentProgress(bundle, settings, studentId), catalog, bundle?.snapshot.bookings ?? [], studentId, nowMs)

  const update = (id: string, patch: Partial<BookingRequest>): void =>
    app.updatePlan((p) => ({ ...p, requests: p.requests.map((r) => (r.id === id ? stripUndefined({ ...r, ...patch }) : r)) }))

  const setTask = (id: string, value: string): void =>
    app.updatePlan((p) => ({
      ...p,
      requests: p.requests.map((r) => {
        if (r.id !== id) return r
        if (value === AUTO) return setRequestTask(settings, r, { mode: 'automatic' })
        const lecture = catalog[value]
        return value === NONE || !lecture ? setRequestTask(settings, r, { mode: 'none' }) : setRequestTask(settings, r, { mode: 'manual', lecture })
      }),
    }))

  const setSource = (id: string, source: BriefingSource): void =>
    app.updatePlan((p) => ({
      ...p,
      requests: p.requests.map((r) => (r.id === id ? setBriefingSource(settings, r, source, r.lectureId ? catalog[r.lectureId] : undefined) : r)),
    }))

  /**
   * Új igény. Automatikus módban a feladatot a központi kiosztás adja; kézi módban a soron
   * következővel töltjük ki (a héten már igényelt és a lefoglalt feladatokat átugorva).
   */
  const newRequestFor = (p: WeekPlan, studentId: string): BookingRequest => {
    const progress = studentProgress(bundle, settings, studentId)
    const taken = takenLectureIds({ studentId, requests: p.requests, progress, catalog, bookings: bundle?.snapshot.bookings ?? [], nowMs })
    return newFlightRequest({ settings, studentId, id: newRequestId('igeny'), taken, progress, catalog })
  }

  const select = (p: WeekPlan, studentId: string): WeekPlan =>
    p.selectedStudentIds.includes(studentId) ? p : { ...p, selectedStudentIds: [...p.selectedStudentIds, studentId] }

  const addFor = (studentId: string): void => {
    app.updatePlan((p) => select({ ...p, requests: [...p.requests, newRequestFor(p, studentId)] }, studentId))
    setOpenId(studentId)
  }

  /** Felvétel a hétre: ha még nincs igénye, rögtön kap egyet a soron következő feladattal. */
  const include = (p: WeekPlan, studentId: string): WeekPlan => {
    const has = p.requests.some((r) => r.kind !== 'theory' && r.studentIds.includes(studentId))
    return select(has ? p : { ...p, requests: [...p.requests, newRequestFor(p, studentId)] }, studentId)
  }

  const includeAll = (): void => app.updatePlan((p) => settings.students.reduce((acc, s) => include(acc, s.userId), p))

  /** Igények eltávolítása visszavonhatóan; a hozzájuk tartozó döntések is mennek. */
  const removeWithUndo = (message: string, pick: (r: BookingRequest) => boolean, deselect?: string): void => {
    const plan = weekPlan
    const removed = plan.requests.map((r, index) => ({ r, index })).filter(({ r }) => pick(r))
    const ids = new Set(removed.map(({ r }) => r.id))
    const decisions = plan.decisions.filter((d) => ids.has(d.requestId))
    app.updatePlan((p) => ({
      ...p,
      requests: p.requests.filter((r) => !ids.has(r.id)),
      decisions: p.decisions.filter((d) => !ids.has(d.requestId)),
      selectedStudentIds: deselect ? p.selectedStudentIds.filter((x) => x !== deselect) : p.selectedStudentIds,
    }))
    setUndo({ message, removed, decisions, ...(deselect && plan.selectedStudentIds.includes(deselect) ? { reselect: deselect } : {}) })
  }

  const excludeStudent = (studentId: string): void => {
    const count = requests.filter((r) => r.studentIds.includes(studentId)).length
    const name = personName(bundle, studentId)
    removeWithUndo(count > 0 ? `${name} kikerült a hétről (${count} igény törölve).` : `${name} kikerült a hétről.`, (r) => r.kind !== 'theory' && r.studentIds.includes(studentId), studentId)
  }

  const removeOne = (r: BookingRequest): void => removeWithUndo(`Igény törölve: ${personName(bundle, r.studentIds[0] ?? '')}.`, (x) => x.id === r.id)

  const restore = (entry: UndoEntry): void => {
    app.updatePlan((p) => {
      const next = [...p.requests]
      for (const { r, index } of entry.removed) if (!next.some((x) => x.id === r.id)) next.splice(Math.min(index, next.length), 0, r)
      const restored = { ...p, requests: next, decisions: [...p.decisions, ...entry.decisions] }
      return entry.reselect ? select(restored, entry.reselect) : restored
    })
    setUndo(null)
  }

  const daysSince = (id: string): string | undefined => {
    const last = bundle?.snapshot.lastFlightAt[id]
    if (last === undefined) return undefined
    if (last === null) return 'még nem repült'
    const days = daysBetween(localParts(toMs(last), timezone).date, today)
    return days === 0 ? 'ma repült' : `${days} napja repült`
  }

  const notIncluded = settings.students.filter((s) => !included.has(s.userId)).length

  return (
    <div className="page">
      <PageHeader
        title="Heti igények" week={<WeekTag />}
        lead="Kattints egy növendékre: felkerül a hétre a soron következő feladatával. A feladat, az idők és az időpont igényenként átírhatók. A halasztott igények maguktól bekerülnek. A kiemelt idők kellenek a tervezéshez; az „Egyéb” rész (komment) csak a FlightLogger-foglalásba kerül."
        actions={
          <>
            <OpeningsButton />
            <Button onClick={() => setTeamsOpen(true)} title="Feladatonként: kinek tartanád együtt a briefinget (közös kezdés, egymás utáni repülés, közös debriefing)">
              Közös briefing szervezése
            </Button>
            <Button variant="primary" onClick={() => app.navigate('theories')}>
              Tovább: elméletek →
            </Button>
          </>
        }
      />
      {teamsOpen && <TeamDialog onClose={() => setTeamsOpen(false)} />}

      <WeekTotals total={totals.total} students={groupIds.length} />

      <div className="req-layout">
        <Card
          className="req-roster"
          title="Növendékek"
          actions={
            notIncluded > 0 ? (
              <Button small onClick={includeAll} title="Mindenki felkerül a hétre, aki még nincs rajta, egy-egy igénnyel">
                Mindenki
              </Button>
            ) : undefined
          }
        >
          {settings.students.length === 0 ? (
            <p className="empty">Még nincs hozzárendelt növendék; a Beállításokban veheted fel.</p>
          ) : (
            <ul className="roster">
              {settings.students.map((s) => {
                const on = included.has(s.userId)
                const t = totals.byStudent.get(s.userId)
                const progress = studentProgress(bundle, settings, s.userId)
                const last = progress?.lastLectureId ? catalog[progress.lastLectureId] : undefined
                const missingRevision = bundle !== null && bundle.syllabi.length > 0 && !syllabusLabel(bundle, progress?.syllabusId)
                // Hiányzó adat, amelyet a motor szabadnak venne vagy amely miatt nem tervezhet (U11, A6, A10).
                const missing = missingDataOf(s)
                return (
                  <li key={s.userId}>
                    <label className={`roster-item${on ? ' on' : ''}`} title={on ? 'Levétel a hétről (visszavonható)' : 'Felvétel a hétre a soron következő feladattal'}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => {
                          if (!e.target.checked) return excludeStudent(s.userId)
                          app.updatePlan((p) => include(p, s.userId))
                          setOpenId(s.userId)
                        }}
                      />
                      <span className="roster-check" aria-hidden="true" />
                      <span className="roster-text">
                        <span className="roster-name">
                          {personName(bundle, s.userId)}
                          {missingRevision && (
                            <span className="dot-warn" title="Nincs feladatsor – válassz revíziót a Beállítások → Növendékek alatt">
                              !
                            </span>
                          )}
                          {missing.length > 0 && (
                            <span className="dot-warn" title={missing.join('\n')} aria-label={missing.join('. ')}>
                              ?
                            </span>
                          )}
                        </span>
                        <span className="roster-meta">{[daysSince(s.userId), last ? shortName(last.name, 22) : undefined].filter(Boolean).join(' · ') || ' '}</span>
                      </span>
                      {on && t && (t.flightCount > 0 || t.simulatorCount > 0) && (
                        <span className="roster-total" title="A növendék igényeinek gépideje a héten">
                          {hoursMinutes(t.flightMinutes + t.simulatorMinutes)}
                        </span>
                      )}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <div className="req-groups">
          {groupIds.length === 0 ? (
            <div className="req-empty">
              <strong>Még senki sincs a héten.</strong>
              <span className="muted">Kattints bal oldalt egy növendékre, vagy vedd fel mindenkit egyszerre; mindenki a soron következő feladatával kap igényt.</span>
              {settings.students.length > 0 && (
                <div>
                  <Button variant="primary" onClick={includeAll}>
                    Mindenki felvétele
                  </Button>
                </div>
              )}
            </div>
          ) : (
            groupIds.map((studentId) => (
              <StudentGroup
                key={studentId}
                bundle={bundle}
                studentId={studentId}
                progress={studentProgress(bundle, settings, studentId)}
                requests={requests.filter((r) => r.studentIds[0] === studentId)}
                totals={totals.byStudent.get(studentId)}
                daysSince={daysSince(studentId)}
                bookedNames={[...booked(studentId)].map((id) => catalog[id]?.name.split(' ')[0]).filter((x): x is string => Boolean(x))}
                revision={bundle && bundle.syllabi.length > 0 ? (syllabusLabel(bundle, studentProgress(bundle, settings, studentId)?.syllabusId) ?? null) : undefined}
                tz={timezone}
                defaultStart={defaultStart}
                open={openId === studentId}
                onToggle={() => setOpenId((cur) => (cur === studentId ? null : studentId))}
                onAdd={() => addFor(studentId)}
                onExclude={() => excludeStudent(studentId)}
                issues={[
                  ...(bundle && bundle.syllabi.length > 0 && !syllabusLabel(bundle, studentProgress(bundle, settings, studentId)?.syllabusId) ? ['Nincs feladatsor: válassz revíziót.'] : []),
                  ...(settings.students.find((s) => s.userId === studentId) && !hasActiveAircraft(settings.students.find((s) => s.userId === studentId)!) ? ['Nincs engedélyezett aktív repülőgép: a repülései nem tervezhetők.'] : []),
                ]}
                onOpenSettings={() => app.navigate('settings', { settingsTab: 'Növendékek' })}
                onRemove={removeOne}
                onUpdate={update}
                onTask={setTask}
                onBriefingSource={setSource}
                onManualTeam={(requestId, teamId, created) => setTeamNotice({ requestId, teamId, created })}
                teamLabels={new Map(teamsOf(weekPlan).map((t) => [t.id, teamName(t)]))}
                defaultBriefing={{ briefing: settings.defaults.briefingMinutes, debriefing: settings.defaults.debriefingMinutes }}
              />
            ))
          )}
        </div>
      </div>

      {teamNotice && (
        <div className="toast" role="status">
          <span>
            {personName(bundle, weekPlan.requests.find((r) => r.id === teamNotice.requestId)?.studentIds[0] ?? '')} →{' '}
            {(() => {
              const t = teamsOf(weekPlan).find((x) => x.id === teamNotice.teamId)
              return t ? `${teamName(t)}${teamNotice.created ? ' (új)' : ''}` : 'csapat'
            })()}
          </span>
          <button
            type="button"
            className="link"
            onClick={() => {
              app.updatePlan((p) => createTeam(p, [teamNotice.requestId], 'manual', new Date().toISOString(), newRequestId('csapat')))
              setTeamNotice(null)
            }}
            title="Inkább új kézi csapatot nyit vele"
          >
            Új csapat
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              app.updatePlan((p) => removeFromTeam(p, teamNotice.requestId))
              setTeamNotice(null)
            }}
          >
            Visszavonás
          </button>
          <button type="button" className="chip-x" aria-label="Bezárás" onClick={() => setTeamNotice(null)}>
            ×
          </button>
        </div>
      )}

      {undo && (
        <div className="toast" role="status">
          <span>{undo.message}</span>
          <button type="button" className="link" onClick={() => restore(undo)}>
            Visszavonás
          </button>
          <button type="button" className="chip-x" aria-label="Bezárás" onClick={() => setUndo(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}

interface UndoEntry {
  readonly message: string
  readonly removed: ReadonlyArray<{ readonly r: BookingRequest; readonly index: number }>
  readonly decisions: readonly Decision[]
  readonly reselect?: string
}

/** A heti repült idő és a többi összesítés az eddigi igények alapján. */
function WeekTotals(props: { total: RequestTotals; students: number }) {
  const t = props.total
  return (
    <div className="stats req-stats" aria-label="Heti összesítés az igények alapján">
      <div className="stat">
        <span className="stat-value">{hoursMinutes(t.flightMinutes)}</span>
        <span className="stat-label">heti repült idő · {t.flightCount} repülés</span>
      </div>
      <div className="stat">
        <span className="stat-value">{hoursMinutes(t.simulatorMinutes)}</span>
        <span className="stat-label">szimulátor · {t.simulatorCount} alkalom</span>
      </div>
      <div className="stat" title="Briefinggel és debriefinggel együtt; a napi első repülés motorpróbája nélkül">
        <span className="stat-value">{hoursMinutes(t.instructorMinutes)}</span>
        <span className="stat-label">oktatói idő összesen</span>
      </div>
      <div className="stat">
        <span className="stat-value">{props.students}</span>
        <span className="stat-label">növendék a héten</span>
      </div>
    </div>
  )
}

function StudentGroup(props: {
  bundle: DataBundle | null
  studentId: string
  progress: StudentProgress | undefined
  requests: readonly BookingRequest[]
  totals: RequestTotals | undefined
  daysSince: string | undefined
  bookedNames: readonly string[]
  /** undefined: nincs feladatsor-lista; null: a növendéknek nincs kiválasztva. */
  revision: string | null | undefined
  tz: string
  defaultStart: string
  /** Lenyitva: az igények szerkeszthetők; csukva csak az összefoglaló sor látszik. */
  open: boolean
  onToggle: () => void
  onAdd: () => void
  onExclude: () => void
  /** Javítandó beállítások (feladatsor, engedélyezett gép); mindegyik a Növendékek fülön állítható. */
  issues: readonly string[]
  onOpenSettings: () => void
  onRemove: (r: BookingRequest) => void
  onUpdate: (id: string, patch: Partial<BookingRequest>) => void
  onTask: (id: string, value: string) => void
  onBriefingSource: (id: string, source: BriefingSource) => void
  onManualTeam: (requestId: string, teamId: string, created: boolean) => void
  teamLabels: ReadonlyMap<string, string>
  defaultBriefing: { readonly briefing: number; readonly debriefing: number }
}) {
  const name = personName(props.bundle, props.studentId)
  const catalog = props.bundle?.directory.lectures ?? {}
  const last = props.progress?.lastLectureId ? catalog[props.progress.lastLectureId] : undefined
  const t = props.totals
  const meta = [
    props.daysSince,
    last ? `utolsó: ${shortName(last.name, 40)}${props.progress?.lastStatus === 'FAILED' ? ' (nem sikerült)' : ''}` : undefined,
    props.bookedNames.length > 0 ? `lefoglalva: ${props.bookedNames.join(', ')}` : undefined,
  ].filter(Boolean)
  const ref = useRef<HTMLElement>(null)
  // Lenyitáskor a csoport kerüljön látótérbe (a fölötte becsukódó csoport elmozdíthatja).
  useEffect(() => {
    if (props.open) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [props.open])
  const bodyId = `req-body-${props.studentId}`
  return (
    <section ref={ref} className={`req-group${props.open ? ' open' : ''}`} aria-label={name}>
      <header className="req-group-head">
        <button type="button" className="req-toggle" aria-expanded={props.open} aria-controls={bodyId} onClick={props.onToggle} title={props.open ? 'Becsukás' : 'Lenyitás: az igények szerkesztése'}>
          <span className="req-chevron" aria-hidden="true" />
          <span className="req-avatar" aria-hidden="true">
            {initials(name)}
          </span>
          <span className="req-who">
            <span className="req-name">
              {name}
              {props.requests.some((r) => r.origin === 'deferred') && <Badge tone="info">halasztott</Badge>}
            </span>
            {props.open ? (
              meta.length > 0 && <span className="muted small">{meta.join(' · ')}</span>
            ) : (
              <RequestSummary requests={props.requests} catalog={catalog} teamLabels={props.teamLabels} />
            )}
          </span>
        </button>
        <div className="req-group-total" title="A növendék igényeinek gépideje a héten">
          {t && t.flightCount === 0 && t.simulatorCount > 0 ? (
            <>
              <strong>{hoursMinutes(t.simulatorMinutes)}</strong>
              <span>szimulátor</span>
            </>
          ) : (
            <>
              <strong>{hoursMinutes(t?.flightMinutes ?? 0)}</strong>
              <span>repülés{t && t.simulatorCount > 0 ? ` · ${hoursMinutes(t.simulatorMinutes)} szim.` : ''}</span>
            </>
          )}
        </div>
        <div className="req-group-actions">
          <Button small onClick={props.onAdd} title="Még egy igény a rákövetkező feladattal">
            + Igény
          </Button>
          <Button small variant="ghost" onClick={props.onExclude} title="A növendék és az igényei lekerülnek a hétről (visszavonható)">
            Levétel
          </Button>
        </div>
      </header>
      {props.issues.length > 0 && (
        <div className="req-issues">
          {props.issues.map((issue) => (
            <span key={issue} className="warn-text small">
              {issue}
            </span>
          ))}
          <button type="button" className="link small" onClick={props.onOpenSettings}>
            Beállítások → Növendékek
          </button>
        </div>
      )}
      {props.open && (
        <div id={bodyId}>
          {props.requests.length === 0 ? (
            <p className="req-none muted small">
              Nincs igény a héten.{' '}
              <button type="button" className="link" onClick={props.onAdd}>
                Igény hozzáadása
              </button>
            </p>
          ) : (
            <ol className="req-list">
              {props.requests.map((r, i) => (
                <RequestRow key={r.id} index={i + 1} bundle={props.bundle} progress={props.progress} request={r} tz={props.tz} defaultStart={props.defaultStart} onRemove={() => props.onRemove(r)} onUpdate={(patch) => props.onUpdate(r.id, patch)} onTask={(v) => props.onTask(r.id, v)} onBriefingSource={(s) => props.onBriefingSource(r.id, s)} onManualTeam={props.onManualTeam} defaultBriefing={props.defaultBriefing} />
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  )
}

/** Csukott csoport összefoglalója: igényenként a fajta és a feladat rövid neve. */
function RequestSummary(props: { requests: readonly BookingRequest[]; catalog: DataBundle['directory']['lectures']; teamLabels: ReadonlyMap<string, string> }) {
  if (props.requests.length === 0) return <span className="muted small">Nincs igény a héten.</span>
  return (
    <span className="req-summary">
      {props.requests.map((r) => {
        const lecture = r.lectureId ? props.catalog[r.lectureId] : undefined
        const night = r.kind === 'flight' && !r.daylightOnly
        const route = isRouteFlight(r) ? routeLabel(r.route) : undefined
        const task = lecture ? shortName(lecture.name.split(' ')[0] ?? lecture.name, 16) : r.taskSelectionMode === 'automatic' ? 'auto' : 'feladat nélkül'
        const team = r.briefingTeamId ? props.teamLabels.get(r.briefingTeamId) : undefined
        return (
          <span key={r.id} className={`req-pill kind-${r.kind}`} title={[lecture?.name, night ? 'éjszakai repülés' : undefined, route ? `útvonal: ${route}` : undefined, team ? `közös briefing: ${team}` : undefined].filter(Boolean).join(' · ') || undefined}>
            {r.taskSelectionMode === 'automatic' ? '⟳ ' : ''}
            {task}
            {night ? ' ☾' : ''}
            {route ? ' ⇢' : ''}
            {team ? ' ⧉' : ''}
          </span>
        )
      })}
    </span>
  )
}

function RequestRow(props: {
  index: number
  bundle: DataBundle | null
  progress: StudentProgress | undefined
  request: BookingRequest
  tz: string
  defaultStart: string
  onRemove: () => void
  onUpdate: (patch: Partial<BookingRequest>) => void
  onTask: (value: string) => void
  onBriefingSource: (source: BriefingSource) => void
  onManualTeam: (requestId: string, teamId: string, created: boolean) => void
  defaultBriefing: { readonly briefing: number; readonly debriefing: number }
}) {
  const app = useApp()
  const r = props.request
  const d = r.durations
  const lecture = r.lectureId ? props.bundle?.directory.lectures[r.lectureId] : undefined
  const setDuration = (key: keyof BookingRequest['durations'], v: number | undefined): void => props.onUpdate({ durations: { ...d, [key]: v ?? 0 } })
  // A briefing vagy a debriefing átírása kézi forrásra vált, így a frissítés nem írja felül.
  const setBriefingDuration = (key: 'briefing' | 'debriefing', v: number | undefined): void =>
    props.onUpdate({ briefingSource: 'manual', durations: { ...d, [key]: v ?? 0 } })
  const lectureBriefing = lecture && (lecture.briefingMinutes > 0 || lecture.debriefingMinutes > 0) ? `${lecture.briefingMinutes || props.defaultBriefing.briefing} + ${lecture.debriefingMinutes || props.defaultBriefing.debriefing} perc` : undefined
  return (
    <li className={`req-row kind-${r.kind}`}>
      <div className="req-line">
        <span className="req-index" aria-hidden="true">
          {props.index}
        </span>
        <Segmented
          ariaLabel="Igény típusa"
          value={r.kind === 'simulator' ? 'simulator' : 'flight'}
          onChange={(v) => props.onUpdate({ kind: v, daylightOnly: v === 'flight' ? r.daylightOnly : false, ...(v === 'flight' ? {} : { route: undefined }) })}
          options={[
            { value: 'flight', label: 'Repülés' },
            { value: 'simulator', label: 'Szimulátor' },
          ]}
        />
        <LectureSelect bundle={props.bundle} progress={props.progress} request={r} onChange={props.onTask} />
        <button type="button" className="icon-btn" title="Igény törlése (visszavonható)" aria-label="Igény törlése" onClick={props.onRemove}>
          ×
        </button>
      </div>
      <div className="req-line req-details">
        <div className="durations plan-key" role="group" aria-label="Időtartamok percben" title="A tervezéshez szükséges: ennyi időt foglal a briefing, a repülés és a debriefing">
          <label className="dur">
            <span>Briefing</span>
            <NumberInput width={58} ariaLabel="Briefing (perc)" value={d.briefing} min={0} onChange={(v) => setBriefingDuration('briefing', v)} />
          </label>
          <label className="dur main">
            <span>{r.kind === 'simulator' ? 'Szimulátor' : 'Repülés'}</span>
            <NumberInput width={58} ariaLabel="Fő rész (perc)" value={d.main} min={15} onChange={(v) => setDuration('main', v)} />
          </label>
          <label className="dur">
            <span>Debriefing</span>
            <NumberInput width={58} ariaLabel="Debriefing (perc)" value={d.debriefing} min={0} onChange={(v) => setBriefingDuration('debriefing', v)} />
          </label>
          <span className="muted small">perc</span>
        </div>
        <div className="briefing-source">
          <span className="muted small">Briefing:</span>
          <Segmented
            ariaLabel="A briefing és a debriefing ideje"
            value={r.briefingSource ?? 'default'}
            onChange={props.onBriefingSource}
            options={[
              { value: 'default', label: 'Alap', title: `A beállítások alapértéke: ${props.defaultBriefing.briefing} + ${props.defaultBriefing.debriefing} perc` },
              {
                value: 'lecture',
                label: 'Feladat szerint',
                disabled: !lecture,
                title: !lecture ? 'Nincs feladat az igényen' : lectureBriefing ? `A feladat ideje: ${lectureBriefing}` : 'A feladatban nincs megadva; az alapérték marad',
              },
              { value: 'manual', label: 'Kézi', title: 'A beírt érték marad, a frissítés nem írja felül' },
            ]}
          />
        </div>
        {r.kind === 'flight' && (
          <div className="briefing-source">
            <span className="muted small">Napszak:</span>
            <Segmented
              ariaLabel="A repülés napszaka"
              value={r.daylightOnly ? 'day' : 'night'}
              onChange={(v) => props.onUpdate({ daylightOnly: v === 'day' })}
              options={[
                { value: 'day', label: 'Nappali', title: 'A repülés napkelte és napnyugta közé kerül' },
                { value: 'night', label: 'Éjszakai', title: 'A repülés az esti polgári szürkület vége után kezdődik; a briefing előtte is lehet' },
              ]}
            />
          </div>
        )}
        {r.kind === 'flight' && (
          <RouteEditor
            request={r}
            baseIcao={app.settings?.airport?.icaoCode}
            baseCoordinates={app.settings?.airport ?? undefined}
            routeWeather={app.routeWeather}
            onChange={(route) => props.onUpdate({ route })}
            onFlightMinutes={(main) => props.onUpdate({ durations: { ...d, main } })}
          />
        )}
        <TimingEditor request={r} tz={props.tz} weekStart={app.weekPlan?.weekStart ?? localParts(toMs(props.defaultStart), props.tz).date} defaultStart={props.defaultStart} onChange={(timing) => props.onUpdate({ timing })} />
        {app.settings && <PrioritySelect settings={app.settings} request={r} onChange={(priority) => props.onUpdate({ priority })} />}
        <TeamControl request={r} onManualAdd={props.onManualTeam} />
      </div>
      <div className="req-line req-details">
        <FlOnlySection summary={r.note ? `komment: „${shortName(r.note, 40)}”` : 'nincs komment'}>
          <FlField label="Komment">
            <TextInput ariaLabel="Komment a FlightLoggerbe" value={r.note ?? ''} placeholder="a foglalás megjegyzése (a növendék is látja)" width={380} maxLength={500} onChange={(v) => props.onUpdate({ note: v || undefined })} />
          </FlField>
        </FlOnlySection>
      </div>
    </li>
  )
}

const AUTO = '__auto__'
const NONE = '__none__'

/**
 * Feladatválasztó (7.5): „Automatikus” (a rendszer választ és igazít), „feladat nélkül”,
 * vagy kézzel a növendék programjának bármely feladata. A teljesítettek pipát kapnak, a
 * soron következő jelölést; kézzel választott, de már teljesített feladatnál figyelmeztet.
 */
function LectureSelect(props: { bundle: DataBundle | null; progress: StudentProgress | undefined; request: BookingRequest; onChange: (value: string) => void }) {
  const { progress, request } = props
  const catalog = props.bundle?.directory.lectures ?? {}
  const lectures: LectureInfo[] = programLectures(catalog, progress?.revisionId)
  const current = request.lectureId
  // A már kiválasztott, de a programlistában nem szereplő feladat is maradjon választható.
  if (current && !lectures.some((l) => l.id === current) && catalog[current]) lectures.push(catalog[current]!)
  const passed = new Set(progress?.passedLectureIds ?? [])
  const mode = request.taskSelectionMode
  const value = mode === 'automatic' ? AUTO : mode === 'none' || !current ? NONE : current
  const autoName = mode === 'automatic' && current ? catalog[current]?.name : undefined
  const label = (l: LectureInfo): string =>
    `${passed.has(l.id) ? '✓ ' : ''}${l.name}${l.id === progress?.nextLectureId ? ' ← következő' : ''} (${l.flightMinutes} p)`
  const note =
    mode === 'manual' && current && passed.has(current) ? (
      <span className="warn-text small">Ez a feladat már teljesítve van.</span>
    ) : mode === 'automatic' && !progress ? (
      <span className="muted small">A haladás még nem ismert (adatok betöltése).</span>
    ) : null
  return (
    <div className="lecture-pick">
      <select className="input" aria-label="Feladat" value={value} onChange={(e) => props.onChange(e.target.value)} title={autoName ?? (current ? catalog[current]?.name : undefined)}>
        <option value={AUTO}>⟳ Automatikus{autoName ? `: ${autoName}` : mode === 'automatic' ? ': nincs következő feladat' : ''}</option>
        <option value={NONE}>– feladat nélkül –</option>
        {lectures.length > 0 && (
          <optgroup label="Kézi választás">
            {lectures.map((l) => (
              <option key={l.id} value={l.id}>
                {label(l)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {note}
    </div>
  )
}

/** Hosszú feladatnév levágása a megadott hosszra. */
function shortName(name: string, max: number): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}
