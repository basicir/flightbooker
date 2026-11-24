import { useState, type DragEvent } from 'react'
import { TEAM_BLOCK_LABELS, teamBlockReason, teamLessonCodes, teamPanelData } from '@core/draft/teamPanel'
import { addToTeamManually, createTeam, moveToTeam, newRequestId, rejoinTeam, removeFromTeam, teamsOf, type TeamInfo, type WeekPlan } from '@core/draft/weekPlan'
import type { BookingRequest, PlannedTeam } from '@core/model/planning'
import { localParts, toMs } from '@core/time/zoned'
import { Button, Dialog, Empty } from './ui'
import { dayLabel, personName, timeOf } from '../format'
import { useApp } from '../state'

/**
 * Közös briefing csapatok a Heti igényeken (KBR-03, KBR-04, KBR-06): a „Közös briefing
 * szervezése” ablak feladatonként, és az igénysor csapatválasztója.
 */

const NEW = '__new__'
const NONE = '__none__'

/** A csapat neve a felületen („2. csapat”, kézinél „2. csapat (kézi)”). */
export function teamName(team: Pick<TeamInfo, 'label' | 'origin'>): string {
  return team.origin === 'manual' ? `${team.label} (kézi)` : team.label
}

/** A csapat helye a tervben röviden („kedd 08:00”, „nem fér be”), ha van terv. */
function teamWhen(planned: PlannedTeam | undefined, tz: string): string | undefined {
  if (!planned) return undefined
  if (planned.state !== 'placed' || !planned.start) return 'egyben nem fér be'
  return `${dayLabel(localParts(toMs(planned.start), tz).date)} ${timeOf(planned.start, tz)}`
}

/** Az igény áthelyezése: új csapatba, meglévőbe vagy ki a csapatból. */
function moveRequestTo(plan: WeekPlan, requestId: string, target: string, origin: 'auto' | 'manual'): WeekPlan {
  if (target === NEW) return createTeam(plan, [requestId], origin, new Date().toISOString(), newRequestId('csapat'))
  if (target === NONE) return removeFromTeam(plan, requestId)
  return moveToTeam(plan, requestId, target)
}

/**
 * „Közös briefing szervezése” (KBR-03): feladatonként a növendékek, akiknek ugyanaz a feladata.
 * Húzással (vagy a növendék melletti választóval) kerülnek csapatba; feladatonként több csapat is
 * lehet. Magától senkit nem tesz csapatba.
 */
export function TeamDialog(props: { onClose: () => void }) {
  const app = useApp()
  const { weekPlan, bundle, result, timezone } = app
  const [over, setOver] = useState<string | null>(null)
  if (!weekPlan) return null
  const catalog = bundle?.directory.lectures ?? {}
  const booked = new Set(result?.recordedInFlightLogger.map((l) => l.requestId) ?? [])
  const data = teamPanelData(weekPlan.requests, weekPlan.decisions, catalog, booked)
  const teams = teamsOf(weekPlan)
  const byId = new Map(weekPlan.requests.map((r) => [r.id, r]))
  const move = (requestId: string, target: string): void => app.updatePlan((p) => moveRequestTo(p, requestId, target, 'auto'))

  const drop = (e: DragEvent, target: string): void => {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('text/plain')
    if (id && byId.has(id)) move(id, target)
  }
  const lane = (key: string, target: string, title: string, note: string | undefined, members: readonly BookingRequest[], hint: string) => (
    <div
      key={key}
      className={`team-lane${over === key ? ' over' : ''}${target === NONE ? ' solo' : target === NEW ? ' new' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (over !== key) setOver(key)
      }}
      onDragLeave={() => setOver((cur) => (cur === key ? null : cur))}
      onDrop={(e) => drop(e, target)}
    >
      <div className="team-lane-head">
        <strong>{title}</strong>
        {note && <span className="small muted">{note}</span>}
      </div>
      <div className="team-chips">
        {members.length === 0 ? <span className="small muted">{hint}</span> : members.map((r) => chip(r))}
      </div>
    </div>
  )
  const chip = (r: BookingRequest) => {
    const reason = data.blocked.get(r.id)
    const name = personName(bundle, r.studentIds[0] ?? '')
    return (
      <span
        key={r.id}
        className={`team-chip${reason ? ' blocked' : ''}`}
        draggable={!reason}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', r.id)
          e.dataTransfer.effectAllowed = 'move'
        }}
        title={reason ? `Nem tehető csapatba: ${TEAM_BLOCK_LABELS[reason]}` : 'Húzd a csapatba, vagy válassz a listából'}
      >
        <span className="team-chip-name">{name}</span>
        {reason ? (
          <span className="small muted">{TEAM_BLOCK_LABELS[reason]}</span>
        ) : (
          <span className="team-chip-move">
            <span aria-hidden="true">▾</span>
            <select aria-label={`${name}: csapat`} value={r.briefingTeamId ?? NONE} onChange={(e) => move(r.id, e.target.value)}>
              <option value={NONE}>Egyénileg</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {teamName(t)}
                </option>
              ))}
              <option value={NEW}>+ Új csapat</option>
            </select>
          </span>
        )}
      </span>
    )
  }

  return (
    <Dialog
      focusSelf
      title="Közös briefing szervezése"
      className="dialog-wide"
      onClose={props.onClose}
      actions={
        <Button variant="primary" onClick={props.onClose}>
          Kész
        </Button>
      }
    >
      <p className="small muted">
        Feladatonként látod, kinek ugyanaz a feladata. Húzd a növendéket abba a csapatba, amelyikkel együtt tartanád a briefinget; feladatonként több csapat is lehet (például az egyik
        kedden, a másik szerdán). Akit nem teszel csapatba, egyénileg repül. A csapat egyszerre kezd, egymás után repül (azonos gépen párban), a végén közös a debriefing.
      </p>
      {data.groups.length === 0 ? (
        <Empty>Nincs olyan feladat, amely a héten legalább két növendéknél szerepel.</Empty>
      ) : (
        <div className="team-groups">
          {data.groups.map((g) => {
            const members = g.requestIds.map((id) => byId.get(id)!).filter(Boolean)
            const groupTeams = teams.filter((t) => members.some((r) => r.briefingTeamId === t.id))
            const solo = members.filter((r) => !r.briefingTeamId)
            return (
              <section key={g.code} className="team-group" aria-label={g.label}>
                <h3>{g.label}</h3>
                <div className="team-lanes">
                  {groupTeams.map((t) => {
                    const inGroup = members.filter((r) => r.briefingTeamId === t.id)
                    const others = t.memberIds.length - inGroup.length
                    const when = teamWhen(result?.teams.find((x) => x.teamId === t.id), timezone)
                    const note = [when, others > 0 ? `+${others} más feladattal` : undefined].filter(Boolean).join(' · ') || undefined
                    return lane(`${g.code}|${t.id}`, t.id, teamName(t), note, inGroup, '')
                  })}
                  {lane(`${g.code}|${NEW}`, NEW, '+ Új csapat', undefined, [], 'Húzd ide: új csapat')}
                  {lane(`${g.code}|${NONE}`, NONE, 'Egyénileg', undefined, solo, 'Mindenki csapatban van.')}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </Dialog>
  )
}

/**
 * Az igénysor csapatválasztója (KBR-04, KBR-06): csapat nélkül „Csapatba” (a legutóbb
 * létrehozott kézi csapatba, ha nincs, újba), csapattal a csapat neve, áthelyezés, új csapat és
 * kivétel. Alatta a csapat jelzései.
 */
export function TeamControl(props: { request: BookingRequest; onManualAdd: (requestId: string, teamId: string, created: boolean) => void }) {
  const app = useApp()
  const { weekPlan, bundle, result } = app
  if (!weekPlan) return null
  const r = props.request
  const teams = teamsOf(weekPlan)
  const team = teams.find((t) => t.id === r.briefingTeamId)
  const booked = new Set(result?.recordedInFlightLogger.map((l) => l.requestId) ?? [])
  const reason = teamBlockReason(r, weekPlan.decisions, booked)
  // Kézzel feladat nélküli igény is csapatba tehető (egyéni foglalásként repül a csapattal).
  const blocked = reason !== undefined && reason !== 'noLesson'
  const catalog = bundle?.directory.lectures ?? {}

  const addManually = (): void => {
    const newId = newRequestId('csapat')
    const preview = addToTeamManually(weekPlan, r.id, new Date().toISOString(), newId)
    app.updatePlan((p) => addToTeamManually(p, r.id, new Date().toISOString(), newId).plan)
    props.onManualAdd(r.id, preview.teamId, preview.created)
  }

  const mates = team ? team.memberIds.filter((id) => id !== r.id).map((id) => weekPlan.requests.find((x) => x.id === id)?.studentIds[0]) : []
  const notes: string[] = []
  if (team) {
    if (teamLessonCodes(weekPlan.requests, team.id, catalog).length > 1) notes.push('Más feladat is van a csapatban: a közös briefing vegyes feladatú.')
    if (r.timing?.kind === 'preferred') notes.push('Csapatban a kezdés közös; az időablaka a csapat helyének választásába beleszámít.')
  }
  for (const w of result?.warnings ?? []) if (w.kind === 'team' && w.requestId === r.id) notes.push(w.message.replace(/^Közös briefing: /, ''))
  const off = weekPlan.decisions.some((d) => d.kind === 'teamOff' && d.requestId === r.id)

  return (
    <div className="team-control">
      <span className="muted small">Közös briefing:</span>
      {team ? (
        <select
          className="input team-select"
          aria-label="Közös briefing csapat"
          value={team.id}
          onChange={(e) => app.updatePlan((p) => moveRequestTo(p, r.id, e.target.value, 'manual'))}
        >
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.id === team.id ? teamName(t) : `Áthelyezés: ${teamName(t)}`} · {t.memberIds.length} fő
            </option>
          ))}
          <option value={NEW}>+ Új csapat</option>
          <option value={NONE}>Kivétel a csapatból</option>
        </select>
      ) : (
        <Button small onClick={addManually} disabled={blocked} title={blocked ? `Nem tehető csapatba: ${TEAM_BLOCK_LABELS[reason!]}` : 'A legutóbb létrehozott kézi csapatba kerül; ha még nincs kézi csapat, újat nyit'}>
          Csapatba
        </Button>
      )}
      {mates.length > 0 && <span className="muted small">együtt: {mates.map((id) => personName(bundle, id ?? '')).join(', ')}</span>}
      {off && (
        <span className="warn-text small">
          Ezen a héten egyénileg (dilemma-döntés).{' '}
          <button type="button" className="link" onClick={() => app.updatePlan((p) => rejoinTeam(p, r.id))}>
            Vissza a csapatba
          </button>
        </span>
      )}
      {notes.map((n) => (
        <span key={n} className="warn-text small team-note">
          {n}
        </span>
      ))}
    </div>
  )
}
