import { AUTO_RESOLVABLE, compareCandidates, createSlotExplorer, HARD_CODE_LABELS, type SlotCandidate } from '@core/engine'
import type { BookingRequest, Decision, Dilemma, DilemmaOption, DilemmaType, HardCode } from '@core/model/planning'
import { localToMs, toMs } from '@core/time/zoned'
import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, Card, Empty, PageHeader, TextInput } from '../components/ui'
import { dateTimeShort, dayLabel, hhmm, requestLabel, resolveText, resourceLabel, timeOf } from '../format'
import { useApp } from '../state'
import { WeekTag } from '../components/weekTag'
import { RESTORE_LOCKED_NOTE } from '../components/weekWatch'

/**
 * Dilemmák (9.2, 9.3, TRV-04–08, TRV-12, TRV-16). Bal oldalt a nyitott dilemmák sora és a
 * döntések (visszavonhatók), jobb oldalt a kiválasztott dilemma: akadályok javítási
 * tippekkel, számozott lehetőségek, és egy heti időpont-térkép, amelyen bármelyik hely egy
 * kattintással kiválasztható, percre finomhangolható és lefoglalható.
 * Billentyűk: 1–9 lehetőség, Enter ajánlott, H halasztás, ↑/↓ másik dilemma.
 */

/** A felülbírálás (kényszerítés) megerősítést kér, mert egyetlen billentyű is rögzítené. */
const needsConfirm = (o: DilemmaOption): boolean => o.id.endsWith(':force')

/** A döntésszámláló csak a dilemmákra adott válaszokat számolja (megjegyzés és kézi mozgatás külön). */
export function decisionCounts(decisions: readonly Decision[]): { answers: number; moves: number; comments: number } {
  let answers = 0
  let moves = 0
  let comments = 0
  for (const d of decisions) {
    if (d.kind === 'comment') comments++
    else if (d.kind === 'assign' && d.fromDraft) moves++
    else if (d.kind !== 'avoidSlot') answers++
  }
  return { answers, moves, comments }
}

const TYPE_LABELS: Readonly<Record<DilemmaType, { label: string; tone: 'neutral' | 'info' | 'warn' | 'danger' }>> = {
  noSlot: { label: 'Nincs hely', tone: 'danger' },
  warningSlot: { label: 'Csak figyelmeztetéssel', tone: 'warn' },
  team: { label: 'Közös briefing csapat', tone: 'warn' },
  competition: { label: 'Verseny', tone: 'info' },
  fixedConflict: { label: 'Fix ütközés', tone: 'danger' },
  lowAttendance: { label: 'Kevés résztvevő', tone: 'warn' },
  standby: { label: 'Standby', tone: 'neutral' },
}

/** Mit tehet az oktató az akadály ellen; `settings`: a Beállításokban javítható. */
const BLOCKER_HINTS: Readonly<Record<HardCode, { hint: string; settings?: string }>> = {
  past: { hint: 'Ezek az időpontok már elmúltak.' },
  window: { hint: 'Bővítsd a munkaidőt vagy a nyitvatartást, vagy válassz kézzel időpontot a térképen.', settings: 'Munkaidő' },
  blocked: { hint: 'Tiltott időszak – a munkaidő-beállításokban módosítható.', settings: 'Munkaidő' },
  resource: { hint: 'Ellenőrizd a növendék engedélyezett gépeit.', settings: 'Növendékek' },
  roomSize: { hint: 'Nagyobb terem kell, vagy kevesebb résztvevő.', settings: 'Termek' },
  daylight: { hint: 'Nappali feladat: a repülésnek napkelte és napnyugta közé kell esnie.' },
  night: { hint: 'Éjszakai feladat: a repülés az esti polgári szürkület vége után kezdődhet. Nézd meg, eddig tart-e a munkaidő.', settings: 'Munkaidő' },
  weather: { hint: 'A következő két napban az iskolai minimum alatti óra kizáró.' },
  instructorBusy: { hint: 'Az oktatónak ekkor más foglalása van.' },
  studentBusy: { hint: 'A növendéknek ekkor más foglalása van.' },
  aircraftBusy: { hint: 'A gép foglalt – válassz másik gépet vagy időpontot.' },
  roomBusy: { hint: 'A terem foglalt – válassz másik termet vagy időpontot.' },
  reserve: { hint: 'Frissítsd a gép karbantartásig kirepülhető óráit, ha közben változott.', settings: 'Gépek' },
  timeWindow: { hint: 'Az igény csak a megadott időablakokban helyezhető el: bővítsd az ablakokat, vagy vedd ki a „csak ezeken belül” pipát.' },
  order: {
    hint: 'A növendék automatikus feladatai időben is sorban követik egymást: a későbbi nem kerülhet a korábbi elé. Tedd előbbre a korábbi feladatot, vagy válassz ennél az igénynél kézzel feladatot (a kézi feladatra a sorrend nem vonatkozik).',
  },
}

const STATUS_TEXT: Readonly<Record<SlotCandidate['status'], { label: string; tone: 'ok' | 'warn' | 'danger' }>> = {
  free: { label: 'szabad', tone: 'ok' },
  warning: { label: 'figyelmeztetéssel', tone: 'warn' },
  blocked: { label: 'felülbírálással', tone: 'danger' },
}

/** Ennyi súlyig a felülbírálás enyhe: csak a munkaidőn, nyitvatartáson vagy tiltott időszakon múlik. */
const MILD_SEVERITY = 3

const inHelp = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.help-panel') !== null
const isTyping = (target: EventTarget | null): boolean => target instanceof HTMLElement && (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)

export function DilemmaWizard() {
  const app = useApp()
  const { result, weekPlan, bundle, timezone } = app
  const [comment, setComment] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const dilemmas = result?.dilemmas ?? []
  const current = dilemmas.find((d) => d.id === selectedId) ?? dilemmas[0]
  const requests = useMemo(() => weekPlan?.requests ?? [], [weekPlan])
  const text = (s: string): string => resolveText(s, bundle, requests)

  const choose = (o: DilemmaOption): void => {
    if (needsConfirm(o) && !window.confirm(`${text(o.label)}\n\nA foglalás kézi felülbírálással kerül a tervbe:\n${o.cons.join('\n')}\n\nFolytatod?`)) return
    decide(o.decision, o.also)
  }

  const decide = (decision: Decision, also: readonly Decision[] = []): void => {
    const extra: Decision[] = []
    let d = decision
    if (comment.trim()) {
      if (d.kind === 'assign' || d.kind === 'standby') d = { ...d, comment: comment.trim() }
      else extra.push({ kind: 'comment', requestId: d.requestId, comment: comment.trim() })
    }
    // A csapatdilemma lehetősége a többi tag döntését is rögzíti (KBR-07).
    app.updatePlan((p) => ({ ...p, decisions: [...p.decisions, d, ...also, ...extra] }))
    setComment('')
    setSelectedId(null)
  }

  // Billentyűzet: 1–9 lehetőség, Enter ajánlott, H halasztás, ↑/↓ másik dilemma.
  useEffect(() => {
    if (!current) return
    const onKey = (e: KeyboardEvent): void => {
      // A súgó panelen lenyomott billentyű ne döntsön el dilemmát.
      if (isTyping(e.target) || inHelp(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      const index = dilemmas.indexOf(current)
      if (/^[1-9]$/.test(e.key)) {
        const option = current.options[Number(e.key) - 1]
        if (option) choose(option)
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        const option = current.options.find((o) => o.id === current.recommendedOptionId)
        if (option) choose(option)
      } else if ((e.key === 'h' || e.key === 'H') && current.requestIds.length === 1) {
        decide({ kind: 'defer', requestId: current.requestIds[0]! })
      } else if (e.key === 'ArrowDown' && index < dilemmas.length - 1) {
        setSelectedId(dilemmas[index + 1]!.id)
      } else if (e.key === 'ArrowUp' && index > 0) {
        setSelectedId(dilemmas[index - 1]!.id)
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!result || !weekPlan) return null

  const autoResolve = (): void => {
    void app.autoResolve()
  }

  const decisionLabel = (d: Decision): string => {
    const r = requestLabel(bundle, requests.find((x) => x.id === d.requestId))
    const auto = 'auto' in d && d.auto ? ' – a rendszer döntötte el' : ''
    switch (d.kind) {
      case 'assign':
        return `${r}: ${d.team ? 'közös briefing csapattal, ' : ''}${dateTimeShort(d.slot.start, timezone)}, ${resourceLabel(bundle, d.slot.resourceId ?? d.slot.classroomId)}${d.fromDraft ? ' (kézi mozgatás)' : d.acceptWarnings ? ' (figyelmeztetés vállalásával)' : ''}${auto}`
      case 'teamOff':
        return `${r}: ezen a héten egyénileg, a közös briefing csapat nélkül${auto}`
      case 'standby':
        return `${r}: standby ${dateTimeShort(d.slot.start, timezone)}${auto}`
      case 'defer':
        return `${r}: halasztva a következő hétre${auto}`
      case 'noStandby':
        return `${r}: nem kér standbyt${auto}`
      case 'avoidSlot':
        return `${r}: ${dateTimeShort(d.slot.start, timezone)} elvetve`
      case 'comment':
        return `${r}: komment – „${d.comment}”`
    }
  }

  /** Visszavonás (TRV-12): előbb megnézi, mely későbbi döntések dőlnének meg miatta (9.3). */
  const undo = async (index: number): Promise<void> => {
    const d = weekPlan.decisions[index]
    // A halasztás nem vonható vissza, ha a következő héten már döntöttek a másolatáról (H07).
    if (d?.kind === 'defer' && app.restoreLocked.includes(d.requestId)) {
      window.alert(RESTORE_LOCKED_NOTE)
      return
    }
    const next = weekPlan.decisions.filter((_, j) => j !== index)
    const before = new Set(result.decisionIssues.map((i) => i.decisionIndex))
    const after = await app.previewIssues(next)
    // Az új lista indexei a törölt döntés után eggyel kisebbek.
    const broken = after.filter((i) => !before.has(i.decisionIndex >= index ? i.decisionIndex + 1 : i.decisionIndex))
    if (broken.length > 0) {
      const lines = broken.map((i) => `• ${decisionLabel(next[i.decisionIndex]!)}`).join('\n')
      if (!window.confirm(`A visszavonás után ezek a döntések megdőlnek:\n${lines}\n\nVisszavonod?`)) return
    }
    app.updatePlan((p) => ({ ...p, decisions: p.decisions.filter((_, j) => j !== index) }))
  }

  const dropBroken = (): void => {
    const broken = new Set(result.decisionIssues.map((i) => i.decisionIndex))
    app.updatePlan((p) => ({ ...p, decisions: p.decisions.filter((_, j) => !broken.has(j)) }))
  }

  const covered = new Set(dilemmas.flatMap((d) => d.requestIds))
  const orphanUnplaced = result.unplaced.filter((u) => !covered.has(u.requestId))
  const counts = decisionCounts(weekPlan.decisions)
  const decided = weekPlan.decisions.length
  const countText = `${counts.answers} döntés${counts.moves ? `, ${counts.moves} kézi mozgatás` : ''}${counts.comments ? `, ${counts.comments} megjegyzés` : ''}`

  return (
    <div className="page">
      <PageHeader
        title="Dilemmák" week={<WeekTag />}
        lead={
          dilemmas.length > 0
            ? `${dilemmas.length} nyitott dilemma, ${countText}. A legnagyobb hatásúak jönnek előre, az összefüggők egymás után; minden döntés után a terv újraszámolódik.`
            : 'Nincs nyitott dilemma.'
        }
        actions={
          <>
            <Button onClick={autoResolve} disabled={!dilemmas.some((d) => AUTO_RESOLVABLE.has(d.type))} title="A versenyeknél és a standby-nál az ajánlást alkalmazza, addig ismételve, amíg ilyen dilemma van; a fix ütközést, a figyelmeztetéses és a „nincs hely” dilemmát neked hagyja">
              A többit döntse el a rendszer
            </Button>
            <Button variant="primary" onClick={() => app.navigate('draft')}>
              Tovább: tervezet →
            </Button>
          </>
        }
      />

      <div className="dilemma-layout">
        <aside className="dilemma-side">
          <Card title={`Nyitott (${dilemmas.length})`}>
            {dilemmas.length === 0 ? (
              <Empty>Minden dilemma eldőlt.</Empty>
            ) : (
              <ol className="queue">
                {dilemmas.map((d) => (
                  <li key={d.id}>
                    <button type="button" className={d === current ? 'queue-item active' : 'queue-item'} onClick={() => setSelectedId(d.id)} aria-current={d === current}>
                      <Badge tone={TYPE_LABELS[d.type].tone}>{TYPE_LABELS[d.type].label}</Badge>
                      <span className="queue-title">{d.requestIds.map((id) => requestLabel(bundle, requests.find((r) => r.id === id))).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <Card title={`Döntések (${countText})`}>
            {result.decisionIssues.length > 0 && (
              <>
                <ul className="error-list">
                  {result.decisionIssues.map((i) => {
                    const d = weekPlan.decisions[i.decisionIndex]
                    return (
                      <li key={i.decisionIndex}>
                        <strong>{d ? decisionLabel(d) : `${i.decisionIndex + 1}. döntés`}</strong>: {text(i.message)}
                      </li>
                    )
                  })}
                </ul>
                <Button small variant="ghost" onClick={dropBroken}>
                  Megdőlt döntések törlése ({result.decisionIssues.length})
                </Button>
              </>
            )}
            {decided === 0 ? (
              <Empty>Még nincs döntés.</Empty>
            ) : (
              <ol className="decisions">
                {weekPlan.decisions.map((d, i) => (
                  <li key={i}>
                    <span>{decisionLabel(d)}</span>{' '}
                    <button type="button" className="link small" onClick={() => void undo(i)}>
                      visszavonás
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <p className="small muted kbd-help">
            <kbd>1</kbd>–<kbd>9</kbd> lehetőség · <kbd>Enter</kbd> ajánlott · <kbd>H</kbd> halasztás · <kbd>↑</kbd>
            <kbd>↓</kbd> másik dilemma
          </p>
        </aside>

        <section className="dilemma-main">
          {current ? (
            <DilemmaDetail key={current.id} dilemma={current} requests={requests} comment={comment} setComment={setComment} onDecide={decide} onChoose={choose} />
          ) : (
            <Card>
              <Empty>Minden dilemma eldőlt. A tervezeten szabadon mozgathatod a foglalásokat.</Empty>
            </Card>
          )}

          {orphanUnplaced.length > 0 && (
            <Card title={`Foglalatlan igények (${orphanUnplaced.length})`}>
              <table className="table">
                <tbody>
                  {orphanUnplaced.map((u) => (
                    <tr key={u.requestId}>
                      <td>{requestLabel(bundle, requests.find((r) => r.id === u.requestId))}</td>
                      <td className="muted">{u.reason}</td>
                      <td>
                        <Button small variant="defer" onClick={() => decide({ kind: 'defer', requestId: u.requestId })}>
                          Halasztás
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </section>
      </div>
    </div>
  )
}

function DilemmaDetail(props: { dilemma: Dilemma; requests: readonly BookingRequest[]; comment: string; setComment: (v: string) => void; onDecide: (d: Decision) => void; onChoose: (o: DilemmaOption) => void }) {
  const app = useApp()
  const { bundle } = app
  const { dilemma, requests, onDecide } = props
  const text = (s: string): string => resolveText(s, bundle, requests)
  const [showDetails, setShowDetails] = useState(false)
  // Az elmúlt időpontok nem akadályok, csak zaj.
  const blockers = (dilemma.blockers ?? []).filter((b) => b.code !== 'past')
  // Az időpont-térkép melyik igényre vonatkozik (versenynél kettő közül választható). A közös
  // briefing csapatnál a lehetőségek az egész csapatra szólnak; egy tagra nincs térkép (KBR-07).
  const pickable = dilemma.type === 'team' ? [] : dilemma.requestIds.map((id) => requests.find((r) => r.id === id)).filter((r): r is BookingRequest => r !== undefined)
  const [pickFor, setPickFor] = useState(pickable[0]?.id)
  const pickRequest = pickable.find((r) => r.id === pickFor) ?? pickable[0]

  return (
    <Card className="dilemma">
      <div className="dilemma-head">
        <Badge tone={TYPE_LABELS[dilemma.type].tone}>{TYPE_LABELS[dilemma.type].label}</Badge>
        <h2>{dilemma.question}</h2>
      </div>
      <p className="dilemma-summary">{text(dilemma.headline ?? dilemma.summary)}</p>
      {dilemma.headline && (
        <button type="button" className="link small" onClick={() => setShowDetails(!showDetails)}>
          {showDetails ? 'Részletek elrejtése' : 'Részletek'}
        </button>
      )}
      {showDetails && <p className="small muted">{text(dilemma.summary)}</p>}
      {dilemma.type === 'team' && (
        <p className="small muted">
          A csapat tagjai: {dilemma.requestIds.map((id) => requestLabel(bundle, requests.find((r) => r.id === id))).join(', ')}. A csapatot a Heti igényeken módosíthatod (például két csapatra bontva, más napra).
        </p>
      )}

      {blockers.length > 0 && (
        <div className="blockers">
          <span className="small muted">Mi akadályozza</span>
          <ul>
            {blockers.map((b) => (
              <li key={b.code}>
                <strong>{HARD_CODE_LABELS[b.code]}</strong> <span className="muted small">({b.count} helyen)</span>
                <div className="small muted">
                  {BLOCKER_HINTS[b.code].hint}{' '}
                  {BLOCKER_HINTS[b.code].settings && (
                    <button type="button" className="link" onClick={() => app.navigate('settings', { settingsTab: BLOCKER_HINTS[b.code].settings })}>
                      Beállítások → {BLOCKER_HINTS[b.code].settings}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="options">
        {dilemma.options.map((o, i) => {
          const recommended = o.id === dilemma.recommendedOptionId
          return (
            <button key={o.id} type="button" className={recommended ? 'option recommended' : 'option'} onClick={() => props.onChoose(o)}>
              <span className="option-head">
                <kbd>{i + 1}</kbd>
                <strong>{text(o.label)}</strong>
                {recommended && <Badge tone="info">ajánlott · Enter</Badge>}
              </span>
              {(o.pros.length > 0 || o.cons.length > 0) && (
                <span className="option-args">
                  {o.pros.map((p) => (
                    <span key={`p${p}`} className="pro">
                      {p}
                    </span>
                  ))}
                  {o.cons.map((c) => (
                    <span key={`c${c}`} className="con">
                      {c}
                    </span>
                  ))}
                </span>
              )}
              <span className="small muted">{text(o.consequence)}</span>
            </button>
          )
        })}
      </div>

      {pickRequest && (
        <div className="picker-wrap">
          <div className="row between wrap">
            <h3>Időpont választása a térképen</h3>
            {pickable.length > 1 && (
              <div className="row" role="tablist">
                {pickable.map((r) => (
                  <button key={r.id} type="button" role="tab" aria-selected={r.id === pickRequest.id} className={r.id === pickRequest.id ? 'tab active' : 'tab'} onClick={() => setPickFor(r.id)}>
                    {requestLabel(bundle, r)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <SlotPicker key={pickRequest.id} request={pickRequest} onDecide={onDecide} />
        </div>
      )}

      <div className="row wrap dilemma-foot">
        <TextInput value={props.comment} onChange={props.setComment} placeholder="megjegyzés a döntéshez (opcionális)" ariaLabel="Megjegyzés" maxLength={500} />
        {pickable.map((r) => (
          <Button key={r.id} small variant="defer" onClick={() => onDecide({ kind: 'defer', requestId: r.id })}>
            Halasztás: {requestLabel(bundle, r)}
            {pickable.length === 1 ? ' (H)' : ''}
          </Button>
        ))}
      </div>
    </Card>
  )
}

interface Pick {
  readonly date: string
  readonly minutes: number
  readonly placeId: string
}

/**
 * Heti időpont-térkép: sorok a napok, oszlopok a félórák (a fő rész kezdete), a cella
 * színe a legjobb gépen (vagy a kiválasztotton) elérhető állapot. A sötét sáv az esti
 * polgári szürkület utáni (éjszakai) idő, a halványabb a szürkület.
 */
export function SlotPicker(props: { request: BookingRequest; onDecide: (d: Decision) => void }) {
  const { result, bundle, settings, weekPlan, timezone, planNow, planInput, navigate } = useApp()
  const { request } = props
  const [placeFilter, setPlaceFilter] = useState<string>('')
  const [chosen, setPick] = useState<Pick | null>(null)

  // A terv bemenetével számol (a feladatkiosztás utáni igények és a feladatsorrend, ELS-05), hogy
  // a térkép ugyanazt lássa, mint a motor.
  const explorer = useMemo(() => {
    if (!result || !bundle || !settings || !weekPlan) return undefined
    return createSlotExplorer(
      {
        snapshot: bundle.snapshot,
        settings,
        requests: planInput?.requests ?? weekPlan.requests,
        proposals: result.proposals,
        now: planNow,
        ...(planInput?.sequences ? { sequences: planInput.sequences } : {}),
        booked: result.recordedInFlightLogger,
      },
      request.id,
    )
  }, [result, bundle, settings, weekPlan, request.id, planNow, planInput])
  const grid = useMemo(() => explorer?.grid({ fromMinutes: 6 * 60, toMinutes: 23 * 60, stepMinutes: 30 }), [explorer])

  const cells = useMemo(() => {
    const map = new Map<string, SlotCandidate>()
    for (const c of grid?.candidates ?? []) {
      if (placeFilter && c.placeId !== placeFilter) continue
      const key = `${c.date}|${c.minutes}`
      const prev = map.get(key)
      if (!prev || compareCandidates(c, prev) < 0) map.set(key, c)
    }
    return map
  }, [grid, placeFilter])

  // Kiinduló kijelölés: a legjobb hely, amíg az oktató mást nem választ.
  const first = grid?.best[0]
  const pick: Pick | null = chosen ?? (first ? { date: first.date, minutes: first.minutes, placeId: first.placeId } : null)

  if (!explorer || !grid) return null
  if (explorer.places.length === 0) {
    return (
      <p className="muted">
        {request.kind === 'theory' ? 'Nincs megfelelő méretű terem.' : 'A növendékhez nincs engedélyezett aktív gép.'}{' '}
        <button type="button" className="link" onClick={() => navigate('settings', { settingsTab: request.kind === 'theory' ? 'Termek' : 'Növendékek' })}>
          Beállítások → {request.kind === 'theory' ? 'Termek' : 'Növendékek'}
        </button>
      </p>
    )
  }

  const selected = pick ? explorer.at(pick.date, pick.minutes, pick.placeId) : undefined
  const alternatives = pick ? explorer.places.map((id) => (id === pick.placeId ? selected! : explorer.at(pick.date, pick.minutes, id))) : []
  const columns = Array.from({ length: (grid.toMinutes - grid.fromMinutes) / grid.stepMinutes }, (_, i) => grid.fromMinutes + i * grid.stepMinutes)
  const place = (id: string): string => resourceLabel(bundle, id)
  const mainLabel = request.kind === 'theory' ? 'óra' : request.kind === 'simulator' ? 'gépidő' : 'repülés'

  const lightOf = (date: string, minutes: number): '' | 'dark' | 'dusk' => {
    const t = localToMs(date, minutes, timezone)
    const tw = grid.twilight[date]
    const sun = bundle?.snapshot.daylight[date]
    if ((tw?.dusk !== undefined && t >= tw.dusk) || (tw?.dawn !== undefined && t < tw.dawn)) return 'dark'
    if (sun && (t >= toMs(sun.sunset) || t < toMs(sun.sunrise))) return 'dusk'
    return ''
  }

  const book = (c: SlotCandidate): void => props.onDecide({ kind: 'assign', requestId: request.id, slot: c.slot, acceptWarnings: c.status !== 'free' })
  const selectCandidate = (c: SlotCandidate): void => setPick({ date: c.date, minutes: c.minutes, placeId: c.placeId })

  return (
    <div className="picker">
      <div className="row wrap">
        <span className="small muted">{request.kind === 'theory' ? 'Terem' : 'Gép'}:</span>
        <button type="button" className={placeFilter === '' ? 'tab active' : 'tab'} onClick={() => setPlaceFilter('')}>
          bármelyik
        </button>
        {explorer.places.map((id) => (
          <button key={id} type="button" className={placeFilter === id ? 'tab active' : 'tab'} onClick={() => setPlaceFilter(id)}>
            {place(id)}
          </button>
        ))}
      </div>

      {grid.best.length > 0 && (
        <div className="row wrap best-row">
          <span className="small muted">Legjobb helyek:</span>
          {grid.best.map((c) => (
            <button
              key={`${c.date}|${c.minutes}|${c.placeId}`}
              type="button"
              className={`best-chip st-${c.status}${pick && pick.date === c.date && pick.minutes === c.minutes && pick.placeId === c.placeId ? ' selected' : ''}`}
              onClick={() => selectCandidate(c)}
              title={[...c.overrides, ...c.approvals].join('\n') || 'szabad'}
            >
              {dayLabel(c.date)} {hhmm(c.minutes)} · {place(c.placeId)}
            </button>
          ))}
        </div>
      )}

      <div className="slot-grid" style={{ gridTemplateColumns: `104px repeat(${columns.length}, minmax(12px, 1fr))` }} role="grid" aria-label="Időpont-térkép">
        <span />
        {columns.map((m) => (
          <span key={m} className="sg-hour">
            {m % 60 === 0 && m % 120 === 0 ? hhmm(m).slice(0, 2) : ''}
          </span>
        ))}
        {grid.days.map((date) => (
          <div key={date} className="sg-row" role="row">
            <span className="sg-day">{dayLabel(date)}</span>
            {columns.map((m) => {
              const c = cells.get(`${date}|${m}`)
              if (!c) return <span key={m} className="sg-cell none" />
              const past = c.hardCodes.includes('past')
              const isPick = pick?.date === date && pick.minutes === m && (placeFilter === '' || pick.placeId === c.placeId)
              const light = lightOf(date, m)
              return (
                <button
                  key={m}
                  type="button"
                  role="gridcell"
                  className={`sg-cell st-${past ? 'past' : c.status === 'blocked' && c.severity <= MILD_SEVERITY ? 'soft' : c.status} ${light}${isPick ? ' selected' : ''}`}
                  style={c.status === 'free' ? { opacity: 0.45 + (c.score / 100) * 0.55 } : undefined}
                  disabled={past}
                  title={`${dayLabel(date)} ${hhmm(m)} · ${place(c.placeId)} – ${STATUS_TEXT[c.status].label}${c.status === 'free' ? `, pont ${c.score}` : ''}${c.overrides.length + c.approvals.length ? `\n${[...c.overrides, ...c.approvals].join('\n')}` : ''}`}
                  aria-label={`${dayLabel(date)} ${hhmm(m)}, ${place(c.placeId)}: ${past ? 'elmúlt' : STATUS_TEXT[c.status].label}${c.status === 'free' ? `, pont ${c.score}` : ''}`}
                  onClick={() => selectCandidate(c)}
                  onDoubleClick={() => book(c)}
                />
              )
            })}
          </div>
        ))}
      </div>
      <p className="legend small muted">
        <span className="swatch st-free" /> szabad (minél erősebb, annál jobb) <span className="swatch st-warning" /> figyelmeztetéssel <span className="swatch st-soft" /> csak munkaidőn kívül{' '}
        <span className="swatch st-blocked" /> szabályt sért vagy ütközik <span className="swatch dusk" /> szürkület <span className="swatch dark" /> éjszaka · dupla kattintás: azonnali foglalás
      </p>

      {selected && pick && (
        <div className={`pick-detail st-${selected.status}`}>
          <div className="row between wrap">
            <strong>
              {dayLabel(selected.date)} · {mainLabel} {timeOf(selected.slot.flightStart ?? selected.slot.start, timezone)}–
              {timeOf(selected.slot.flightEnd ?? selected.slot.end, timezone)}
            </strong>
            <Badge tone={STATUS_TEXT[selected.status].tone}>{STATUS_TEXT[selected.status].label}</Badge>
          </div>
          <div className="small muted">
            Teljes foglalás {timeOf(selected.slot.start, timezone)}–{timeOf(selected.slot.end, timezone)} (briefinggel, debriefinggel) · pont: {selected.score}
          </div>
          <div className="row wrap">
            <label className="row small">
              Kezdés
              <input
                type="time"
                className="input"
                step={300}
                value={hhmm(pick.minutes)}
                aria-label="A fő rész kezdete"
                onChange={(e) => {
                  const m = /^(\d{2}):(\d{2})$/.exec(e.target.value)
                  if (m) setPick({ ...pick, minutes: Number(m[1]) * 60 + Number(m[2]) })
                }}
              />
            </label>
            <label className="row small">
              {request.kind === 'theory' ? 'Terem' : 'Gép'}
              <select className="input" value={pick.placeId} aria-label={request.kind === 'theory' ? 'Terem' : 'Gép'} onChange={(e) => setPick({ ...pick, placeId: e.target.value })}>
                {alternatives.map((a) => (
                  <option key={a.placeId} value={a.placeId}>
                    {place(a.placeId)} – {STATUS_TEXT[a.status].label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selected.overrides.length + selected.approvals.length > 0 && (
            <ul className="cons">
              {selected.overrides.map((r) => (
                <li key={`o${r}`}>Felülbírálod: {r}</li>
              ))}
              {selected.approvals.map((r) => (
                <li key={`a${r}`}>Vállalod: {r}</li>
              ))}
            </ul>
          )}
          <div className="row">
            <Button variant={selected.status === 'free' ? 'primary' : selected.status === 'warning' ? 'secondary' : 'danger'} disabled={selected.hardCodes.includes('past')} onClick={() => book(selected)}>
              {selected.status === 'free' ? 'Foglalás ide' : selected.status === 'warning' ? 'Foglalás a figyelmeztetés vállalásával' : 'Foglalás felülbírálással'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
