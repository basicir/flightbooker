import { orderFleet, requestPriorityOf } from '@core/config/operations'
import { acceptPlan, deferBooked, moveRequest, moveTeam, planCancel, removeFromTeam, resetRequest, revertChange, setComment, teamsOf } from '@core/draft/weekPlan'
import { flyingParticipantIds } from '@core/model/bookingStudents'
import { CRITERION_LABELS } from '@core/model/criteria'
import type { BookedInFlightLogger, BookingRequest, ExistingBooking, Proposal, Slot } from '@core/model/planning'
import { civilTwilight } from '@core/time/solar'
import { addDays, localParts, localToMs, toMs } from '@core/time/zoned'
import { assessHour, hourCloudBase, hourValues, NO_CEILING_FT } from '@core/weather/rating'
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Badge, Button, Card, Empty, PageHeader } from '../components/ui'
import { BOOKING_STATUS_LABELS, BOOKING_TYPE_LABELS, dateTimeShort, dayLabel, hhmm, personName, requestKindLabel, requestKindShort, requestLabel, resolveText, resourceLabel, timeOf } from '../format'
import { useApp, useNow } from '../state'
import { WeekTag } from '../components/weekTag'
import { RESTORE_LOCKED_NOTE, watchBadge, watchSummary, weatherLine } from '../components/weekWatch'
import { PriorityBadge } from '../components/priority'
import { OpeningsButton } from '../components/openings'
import { bookingSlot } from '@core/engine/bookingLink'
import { SlotPicker } from './DilemmaWizard'
import { teamName } from '../components/teams'
import { instructorOwnBookings } from '@core/draft/instructorTrack'

/**
 * Tervezet-nézet (9.5, TRV-09–11): idővonal gépek, szimulátorok és termek szerint.
 * A meglévő FlightLogger-foglalások halványan, a tervezettek húzhatóan; a mozgatás sosem
 * tiltott, minden mozgatás után a motor azonnal újraellenőriz.
 */

const DAY_START = 6 * 60
const DAY_END = 23 * 60
const RANGE = DAY_END - DAY_START
const SNAP = 15
/** Az óránkénti rácsvonalak száma a sávokban (CSS `--hours`). */
const HOUR_GRID = { '--hours': RANGE / 60 } as CSSProperties
/** Vékony függőleges vonal minden egész óránál; a szürkület fölött, a foglalások alatt. */
const hourGrid = <span className="hour-grid" aria-hidden="true" />

interface Row {
  readonly id: string
  readonly label: string
  readonly group: 'aircraft' | 'simulator' | 'classroom'
}

/** A javaslat kulcsa: a standby elmélet ugyanannak az igénynek a második helye. */
const keyOf = (p: Proposal): string => (p.standby ? `${p.requestId}#standby` : p.requestId)

interface Drag {
  readonly requestId: string
  readonly startX: number
  readonly group: Row['group']
  readonly trackWidth: number
  deltaMin: number
  rowId: string
  moved: boolean
}

export function DraftView() {
  const app = useApp()
  const { result, weekPlan, bundle, settings, timezone } = app
  const [day, setDay] = useState(app.weekStart)
  const [selected, setSelected] = useState<string | null>(null)
  const now = useNow()
  const [view, setView] = useState<'day' | 'week'>('day')
  const [moving, setMoving] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const days = Array.from({ length: 7 }, (_, i) => addDays(app.weekStart, i))
  const activeDay = days.includes(day) ? day : days[0]!

  const rows = useMemo((): Row[] => {
    if (!bundle || !settings) return []
    const kindOf = (id: string, cls: string): 'aircraft' | 'simulator' => settings.resources[id]?.kind ?? (cls === 'SIMULATOR' ? 'simulator' : 'aircraft')
    const fleet = orderFleet(bundle.snapshot.fleet, settings.aircraftOrder).filter((a) => !a.disabled)
    return [
      ...fleet.filter((a) => kindOf(a.id, a.aircraftClass) === 'aircraft').map((a) => ({ id: a.id, label: a.callSign, group: 'aircraft' as const })),
      ...fleet.filter((a) => kindOf(a.id, a.aircraftClass) === 'simulator').map((a) => ({ id: a.id, label: a.callSign, group: 'simulator' as const })),
      ...bundle.snapshot.classroomIds.map((id) => ({ id, label: bundle.directory.classrooms[id] ?? id, group: 'classroom' as const })),
    ]
  }, [bundle, settings])

  if (!result || !weekPlan || !bundle || !settings) return null
  const requests = weekPlan.requests
  const reqOf = (id: string) => requests.find((r) => r.id === id)
  /** Az alapértéktől eltérő elsőbbség a buborékban (ELS-01). */
  const priorityNote = (r: BookingRequest | undefined): string => {
    const p = r ? requestPriorityOf(settings, r) : settings.defaults.requestPriority
    return p === settings.defaults.requestPriority ? '' : ` – ${p}. elsőbbség`
  }
  /** Mozgatás kézi döntéssel (TRV-10); a FlightLogger-jelölt igény is rendes tervezett tétel (9.7). */
  const moveTo = (requestId: string, slot: Slot): void => app.updatePlan((plan) => moveRequest(plan, requestId, slot))
  // Közös briefing csapatok (KBR-08): a csapat egyben mozog; a gépsoron a tag csak a saját repülésével látszik.
  const teamLabels = new Map(teamsOf(weekPlan).map((t) => [t.id, teamName(t)]))
  const teamMembers = (teamId: string): Proposal[] => result.proposals.filter((x) => !x.standby && x.teamId === teamId)
  const bookedRequests = new Set(result.recordedInFlightLogger.map((l) => l.requestId))
  /** A csapat kezdése kötött, ha egy tagja már rögzítve van (vagy a FlightLoggerben). */
  const teamLocked = (teamId: string): boolean =>
    teamMembers(teamId).some((x) => x.recorded) || (result.teams.find((t) => t.teamId === teamId)?.requestIds.some((id) => bookedRequests.has(id)) ?? false)
  const cancelPlanned = new Set(result.plannedCancels.map((c) => c.requestId))
  // A következő héten már eldöntött vagy rögzített másolat miatt nem vonható vissza (H07).
  const locked = new Set(app.restoreLocked)
  const lockedNote = RESTORE_LOCKED_NOTE
  const moveMarked = new Map(result.plannedMoves.map((m) => [m.requestId, m]))
  // A FlightLoggerben már meglévő igények (9.6): a foglalásuk a saját nevükkel látszik. A
  // többnövendékes foglalás több igényé is lehet, növendékenként egyé (KBR-10).
  const bookedById = new Map<string, BookedInFlightLogger[]>()
  for (const b of result.recordedInFlightLogger) bookedById.set(b.bookingId, [...(bookedById.get(b.bookingId) ?? []), b])
  /** A foglaláshoz tartozó igények neve és a növendékek vezetékneve a blokkon. */
  const bookedLabel = (links: readonly BookedInFlightLogger[]): string => links.map((l) => requestLabel(bundle, reqOf(l.requestId))).join(' · ')
  const bookedNames = (links: readonly BookedInFlightLogger[]): string =>
    links.flatMap((l) => reqOf(l.requestId)?.studentIds ?? []).map((id) => personName(bundle, id).split(' ').slice(-1)[0]).join(', ')
  const onDayOf = (date: string) => (b: BookedInFlightLogger): boolean => localParts(toMs(b.slot.start), timezone).date === date
  const watchCount = app.watch?.items.length ?? 0

  const dayStartMs = localToMs(activeDay, 0, timezone)
  const pos = (iso: string): number => ((toMs(iso) - dayStartMs) / 60_000 - DAY_START) / RANGE
  const onDay = (iso: string): boolean => localParts(toMs(iso), timezone).date === activeDay

  const proposals = result.proposals.filter((p) => onDay(p.slot.start))
  const me = bundle.snapshot.instructorId
  // Az áthelyezettnek jelölt foglalás régi helye a frissítésig sem látszik (a terv sem számol vele).
  const superseded = new Set(result.supersededBookings)
  // Az oktató minden FlightLogger-foglalása az oktatói sávon (U2), akkor is, ha nem a
  // foglalástervezővel került fel; a terv igényeihez kötötteket a sáv külön, a nevükkel mutatja.
  const instructorExisting = instructorOwnBookings(bundle.snapshot.bookings, me, new Set(bookedById.keys()), superseded)
  const existing = bundle.snapshot.bookings.filter(
    (b) => b.status !== 'CANCELLED' && !superseded.has(b.id) && (onDay(b.start) || onDay(b.end) || (toMs(b.start) < dayStartMs && toMs(b.end) > dayStartMs + 86_400_000)),
  )
  /**
   * A nap foglalásainak száma a fülön: a tervezettek, a terv FlightLoggerben lévő igényei és a
   * FlightLoggeren (nem a tervezővel) foglalt saját órák, ahogy az oktatói sáv is mutatja.
   */
  const dayCount = (date: string): number =>
    result.proposals.filter((p) => localParts(toMs(p.slot.start), timezone).date === date).length +
    result.recordedInFlightLogger.filter(onDayOf(date)).length +
    instructorExisting.filter((b) => localParts(toMs(b.start), timezone).date === date).length
  const rowOfProposal = (p: Proposal): string | undefined => p.slot.resourceId ?? p.slot.classroomId
  const groupOf = (id: string | undefined): Row['group'] | undefined => rows.find((r) => r.id === id)?.group

  // Időjárási jelzés óránként az iskolai minimum szerint (9.5)
  const runways = settings.airport?.runways.map((r) => r.trueHeadingDeg) ?? []
  const weatherStrip = Array.from({ length: RANGE / 60 }, (_, i) => {
    const hourMs = localToMs(activeDay, DAY_START + i * 60, timezone)
    const hour = bundle.snapshot.weather.find((w) => toMs(w.time) === hourMs)
    if (!hour) return 'unknown'
    return assessHour(hourValues(hour, runways), settings.weather.schoolMinima, {}).rating
  })
  const daylight = bundle.snapshot.daylight[activeDay]
  // Polgári szürkület a bázisrepülőtéren: napnyugta és a szürkület vége között halványabb,
  // utána (éjszaka) sötétebb sáv.
  const twilight = settings.airport ? civilTwilight(activeDay, settings.airport.latitude, settings.airport.longitude) : {}
  const frac = (ms: number): number => Math.min(1, Math.max(0, ((ms - dayStartMs) / 60_000 - DAY_START) / RANGE))

  const shifted = (slot: Slot, deltaMin: number, rowId: string, group: Row['group']): Slot => {
    const move = (iso: string | undefined): string | undefined => (iso ? new Date(toMs(iso) + deltaMin * 60_000).toISOString() : undefined)
    const next: Slot = { start: move(slot.start)!, end: move(slot.end)! }
    return {
      ...next,
      ...(slot.flightStart ? { flightStart: move(slot.flightStart)!, flightEnd: move(slot.flightEnd)! } : {}),
      ...(group === 'classroom' ? { classroomId: rowId } : { resourceId: rowId }),
    }
  }

  const onPointerDown = (e: ReactPointerEvent, p: Proposal): void => {
    // A standby elmélet a párosított repüléssel együtt mozog, külön nem húzható; a részben
    // rögzített csapat kezdése kötött.
    if (p.standby || p.recorded || (p.teamId !== undefined && teamLocked(p.teamId))) {
      setSelected(keyOf(p))
      return
    }
    const track = trackRef.current
    const rowId = rowOfProposal(p)
    const group = groupOf(rowId)
    if (!track || !rowId || !group) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ requestId: p.requestId, startX: e.clientX, group, trackWidth: track.getBoundingClientRect().width, deltaMin: 0, rowId, moved: false })
  }
  const onPointerMove = (e: ReactPointerEvent): void => {
    if (!drag) return
    const deltaMin = Math.round(((e.clientX - drag.startX) / drag.trackWidth) * RANGE / SNAP) * SNAP
    const under = document.elementsFromPoint(e.clientX, e.clientY).find((el) => (el as HTMLElement).dataset['rowId'])
    const rowId = (under as HTMLElement | undefined)?.dataset['rowId']
    const rowGroup = rows.find((r) => r.id === rowId)?.group
    setDrag({ ...drag, deltaMin, rowId: rowId && rowGroup === drag.group ? rowId : drag.rowId, moved: drag.moved || Math.abs(e.clientX - drag.startX) > 4 || rowId !== drag.rowId })
  }
  const onPointerUp = (): void => {
    if (!drag) return
    const p = result.proposals.find((x) => x.requestId === drag.requestId && !x.standby)
    if (p && drag.moved && (drag.deltaMin !== 0 || drag.rowId !== rowOfProposal(p))) {
      if (p.teamId !== undefined) moveTeamTo(p, drag.deltaMin, drag.rowId, drag.group)
      else moveTo(drag.requestId, shifted(p.slot, drag.deltaMin, drag.rowId, drag.group))
    }
    setSelected(drag.requestId)
    setDrag(null)
  }

  /** Billentyűzetes mozgatás (U9): ←/→ 15 perc, ↑/↓ másik hasonló erőforrás. */
  const onBlockKey = (e: ReactKeyboardEvent, p: Proposal): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      setSelected(keyOf(p))
      e.preventDefault()
      return
    }
    if (p.standby || p.recorded || (p.teamId !== undefined && teamLocked(p.teamId))) return
    const rowId = rowOfProposal(p)
    const group = groupOf(rowId)
    if (!rowId || !group) return
    const same = rows.filter((r) => r.group === group)
    const i = same.findIndex((r) => r.id === rowId)
    let delta = 0
    let target = rowId
    if (e.key === 'ArrowLeft') delta = -SNAP
    else if (e.key === 'ArrowRight') delta = SNAP
    else if (e.key === 'ArrowUp' && i > 0) target = same[i - 1]!.id
    else if (e.key === 'ArrowDown' && i < same.length - 1) target = same[i + 1]!.id
    else return
    e.preventDefault()
    if (p.teamId !== undefined) moveTeamTo(p, delta, target, group)
    else moveTo(p.requestId, shifted(p.slot, delta, target, group))
    setSelected(keyOf(p))
  }

  /**
   * A csapat mozgatása (KBR-08): minden tag ugyanannyival tolódik; a húzott tag gépe a célsor
   * gépe, a többieké marad. A párok a motorban újraképződnek.
   */
  function moveTeamTo(p: Proposal, deltaMin: number, rowId: string, group: Row['group']): void {
    const slots = teamMembers(p.teamId!).map((m) => {
      const own = rowOfProposal(m)
      return { requestId: m.requestId, slot: m.requestId === p.requestId ? shifted(m.slot, deltaMin, rowId, group) : shifted(m.slot, deltaMin, own ?? rowId, groupOf(own) ?? group) }
    })
    app.updatePlan((plan) => moveTeam(plan, p.teamId!, slots))
  }

  const selectedProposal = result.proposals.find((p) => keyOf(p) === selected)
  const selectedRequest = selectedProposal ? reqOf(selectedProposal.requestId) : undefined
  // A kijelölt FlightLogger-foglalás (a „fl:” előtagú kulcs): a részletei a jobb oldali panelen.
  const flKey = (bookingId: string): string => `fl:${bookingId}`
  const selectedFl = selected?.startsWith('fl:') ? bundle.snapshot.bookings.find((b) => flKey(b.id) === selected) : undefined
  const relatedStudents = new Set(selectedRequest?.studentIds ?? (selectedFl ? selectedFl.participantIds.filter((id) => id !== selectedFl.instructorId) : []))
  /** A FlightLogger-foglalás kijelölhető (kattintás, Enter, szóköz); a megadott napra is vált. */
  const selectFl = (b: ExistingBooking, date?: string) => ({
    role: 'button' as const,
    tabIndex: 0,
    onClick: () => {
      setSelected(flKey(b.id))
      if (date) setDay(date)
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      setSelected(flKey(b.id))
      if (date) setDay(date)
    },
  })
  const bookingById = new Map(bundle.snapshot.bookings.map((b) => [b.id, b]))
  const warningCount = result.proposals.reduce((n, p) => n + p.warnings.length, 0) + result.warnings.length

  const dragTeam = drag ? result.proposals.find((x) => x.requestId === drag.requestId && !x.standby)?.teamId : undefined
  const block = (p: Proposal) => {
    const rowId = rowOfProposal(p)
    const isDragging = !p.standby && drag?.requestId === p.requestId
    // A csapattárs a húzott taggal együtt mozog (a saját gépsorán).
    const withTeam = !isDragging && !p.standby && drag && dragTeam !== undefined && p.teamId === dragTeam && rowId
    const slot = isDragging && drag ? shifted(p.slot, drag.deltaMin, drag.rowId, drag.group) : withTeam ? shifted(p.slot, drag.deltaMin, rowId, groupOf(rowId) ?? drag.group) : p.slot
    // Csapattagnál a gépsoron csak a saját repülés: a közös briefing és a várakozás az oktatói sávon látszik.
    const team = p.teamId !== undefined && !p.standby && slot.flightStart !== undefined && slot.flightEnd !== undefined
    const left = pos(team ? slot.flightStart! : slot.start)
    const width = pos(team ? slot.flightEnd! : slot.end) - left
    const flightLeft = team ? 0 : slot.flightStart ? (pos(slot.flightStart) - left) / width : 0
    const flightWidth = team ? 1 : slot.flightStart && slot.flightEnd ? (pos(slot.flightEnd) - pos(slot.flightStart)) / width : 1
    const teamText = team ? `\nKözös briefing: ${teamLabels.get(p.teamId!) ?? 'csapat'}, ${timeOf(slot.start, timezone)}–${timeOf(slot.end, timezone)}` : ''
    const severe = p.warnings.some((w) => ['limitExceeded', 'doubleBooking', 'outsideAvailability', 'hardConstraintOverridden'].includes(w.kind))
    const mild = p.warnings.some((w) => w.kind === 'limitApproach' || w.kind === 'staleData')
    const req = reqOf(p.requestId)
    const classes = ['block', `kind-${req?.kind ?? 'flight'}`, team ? 'team' : '', severe ? 'severe' : mild ? 'mild' : '', p.standby ? 'standby' : '', p.recorded ? 'recorded' : '', p.change ? 'change' : '', p.dilemmaId ? 'tentative' : '', selected === keyOf(p) ? 'selected' : '', isDragging || withTeam ? 'dragging' : '']
    const state = severe ? ', jóváhagyott figyelmeztetéssel' : mild ? ', enyhe figyelmeztetéssel' : ''
    return (
      <div
        key={keyOf(p)}
        className={classes.join(' ')}
        data-row={isDragging && drag ? drag.rowId : rowId}
        style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
        onPointerDown={(e) => onPointerDown(e, p)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="button"
        tabIndex={0}
        aria-label={`${requestLabel(bundle, req)}${p.standby ? ' (standby)' : ''} ${timeOf(slot.start, timezone)}–${timeOf(slot.end, timezone)}${team ? `, közös briefing csapat, repülés ${timeOf(slot.flightStart!, timezone)}–${timeOf(slot.flightEnd!, timezone)}` : ''}${state}. Nyilakkal mozgatható${team ? ' (a csapattal együtt)' : ''}.`}
        onKeyDown={(e) => onBlockKey(e, p)}
        title={`${requestLabel(bundle, req)}${p.standby ? ' – standby' : ''}${p.recorded ? ' – rögzítve' : ''}${priorityNote(req)}\n${team ? `repülés ${timeOf(slot.flightStart!, timezone)}–${timeOf(slot.flightEnd!, timezone)}` : `${timeOf(slot.start, timezone)}–${timeOf(slot.end, timezone)}`}${teamText}`}
      >
        {req?.kind !== 'theory' && <span className="flight-part" style={{ left: `${flightLeft * 100}%`, width: `${flightWidth * 100}%` }} />}
        <span className="block-text">
          {team ? '⧉ ' : ''}
          {req?.studentIds.map((id) => personName(bundle, id).split(' ').slice(-1)[0]).join(', ')} {timeOf(team ? slot.flightStart! : slot.start, timezone)}
        </span>
      </div>
    )
  }

  const existingBlock = (b: ExistingBooking, rowId: string) => {
    const start = rowId === b.classroomId ? b.start : (b.flightStart ?? b.start)
    const end = rowId === b.classroomId ? b.end : (b.flightEnd ?? b.end)
    const left = Math.max(0, pos(start))
    const right = Math.min(1, pos(end))
    if (right <= 0 || left >= 1) return null
    const related = b.participantIds.some((id) => relatedStudents.has(id))
    const own = bookedById.get(b.id)
    if (own) {
      const req = reqOf(own[0]!.requestId)
      return (
        <div
          key={b.id}
          className={`block booked kind-${req?.kind ?? 'flight'}${related ? ' related' : ''}${selected === flKey(b.id) ? ' selected' : ''}`}
          style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
          {...selectFl(b)}
          aria-label={`A FlightLoggerben: ${bookedLabel(own)} ${timeOf(b.start, timezone)}–${timeOf(b.end, timezone)}. Kattintásra a részletek.`}
          title={`A FlightLoggerben: ${bookedLabel(own)}\n${timeOf(b.start, timezone)}–${timeOf(b.end, timezone)}${own.some((l) => l.detected) ? '\nRögzítettnek nem jelölted, de felismertem.' : ''}\nKattintásra a részletek.`}
        >
          <span className="block-text">
            {bookedNames(own)} {timeOf(b.start, timezone)}
          </span>
        </div>
      )
    }
    return (
      <div
        key={b.id}
        className={`block existing${related ? ' related' : ''}${selected === flKey(b.id) ? ' selected' : ''}`}
        style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%`, background: b.color ?? undefined }}
        {...selectFl(b)}
        aria-label={`FlightLogger-foglalás ${timeOf(b.start, timezone)}–${timeOf(b.end, timezone)}. Kattintásra a részletek.`}
        title={`FlightLogger-foglalás ${timeOf(b.start, timezone)}–${timeOf(b.end, timezone)}${related ? ' – a kijelölt növendék foglalása' : ''}\nKattintásra a részletek.`}
      />
    )
  }

  /** Egy nap oktatói sávja (U2): a saját foglalások és a tervezettek. */
  const instructorTrack = (date: string) => {
    const startMs = localToMs(date, 0, timezone)
    const at = (iso: string): number => ((toMs(iso) - startMs) / 60_000 - DAY_START) / RANGE
    const own = instructorExisting.filter((b) => localParts(toMs(b.start), timezone).date === date)
    const planned = result.proposals.filter((p) => !p.standby && localParts(toMs(p.slot.start), timezone).date === date)
    // Foglalásonként egy blokk: a többnövendékes foglalás több igényé is lehet (KBR-10).
    const booked = [...new Set(result.recordedInFlightLogger.filter(onDayOf(date)).map((b) => b.bookingId))].map((id) => bookedById.get(id)!)
    return (
      <>
        {booked.map((links) => {
          const b = links[0]!
          const left = Math.max(0, at(b.slot.start))
          const right = Math.min(1, at(b.slot.end))
          const req = reqOf(b.requestId)
          return right > left ? (
            <div
              key={`fl:${b.bookingId}`}
              className={`block instr booked kind-${req?.kind ?? 'flight'}${selected === flKey(b.bookingId) ? ' selected' : ''}`}
              style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
              {...(bookingById.get(b.bookingId) ? selectFl(bookingById.get(b.bookingId)!, date) : {})}
              aria-label={`A FlightLoggerben: ${bookedLabel(links)} ${timeOf(b.slot.start, timezone)}–${timeOf(b.slot.end, timezone)}`}
              title={`A FlightLoggerben: ${bookedLabel(links)}\n${timeOf(b.slot.start, timezone)}–${timeOf(b.slot.end, timezone)}\nKattintásra a részletek.`}
            >
              <span className="block-text">{bookedNames(links)}</span>
            </div>
          ) : null
        })}
        {own.map((b) => {
          const left = Math.max(0, at(b.start))
          const right = Math.min(1, at(b.end))
          // A FlightLoggeren (nem a tervezővel) foglalt saját óra: fajta, gép vagy terem, növendékek.
          const where = b.resourceId ?? b.classroomId
          const students = flyingParticipantIds(b)
            .filter((id) => id !== me && id !== b.instructorId)
            .map((id) => personName(bundle, id).split(' ').slice(-1)[0])
            .join(', ')
          const what = [BOOKING_TYPE_LABELS[b.type], where ? resourceLabel(bundle, where) : '', students].filter((x) => x).join(' · ')
          const time = `${timeOf(b.start, timezone)}–${timeOf(b.end, timezone)}`
          return right > left ? (
            <div
              key={b.id}
              className={`block instr existing${selected === flKey(b.id) ? ' selected' : ''}`}
              style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}
              {...selectFl(b, date)}
              aria-label={`Saját FlightLogger-foglalás: ${what} ${time}. Kattintásra a részletek.`}
              title={`Saját FlightLogger-foglalás (nem a tervezőből): ${what}\n${time}\nKattintásra a részletek.`}
            >
              <span className="block-text">{students || (where ? resourceLabel(bundle, where) : BOOKING_TYPE_LABELS[b.type])}</span>
            </div>
          ) : null
        })}
        {planned
          // A közös briefing csapat az oktató sávján egy blokk (KBR-01): a kezdéstől a közös debriefing végéig.
          .filter((p, i, all) => p.teamId === undefined || all.findIndex((x) => x.teamId === p.teamId) === i)
          .map((p) => {
            const left = at(p.slot.start)
            const width = at(p.slot.end) - left
            const req = reqOf(p.requestId)
            const members = p.teamId !== undefined ? planned.filter((x) => x.teamId === p.teamId) : [p]
            const label = p.teamId !== undefined ? `Közös briefing: ${teamLabels.get(p.teamId) ?? 'csapat'} – ${members.map((m) => requestLabel(bundle, reqOf(m.requestId))).join(', ')}` : `${requestLabel(bundle, req)}${priorityNote(req)}`
            const names = members.flatMap((m) => reqOf(m.requestId)?.studentIds ?? []).map((id) => personName(bundle, id).split(' ').slice(-1)[0]).join(', ')
            return (
              <div
                key={p.teamId !== undefined ? `team:${p.teamId}` : keyOf(p)}
                className={`block instr kind-${req?.kind ?? 'flight'}${p.teamId !== undefined ? ' team' : ''}${members.some((m) => selected === keyOf(m)) ? ' selected' : ''}`}
                style={{ left: `${left * 100}%`, width: `${width * 100}%` }}
                role="button"
                tabIndex={0}
                aria-label={`${label} ${timeOf(p.slot.start, timezone)}–${timeOf(p.slot.end, timezone)}`}
                onClick={() => {
                  setSelected(keyOf(p))
                  setDay(date)
                }}
                onKeyDown={(e) => e.key === 'Enter' && setSelected(keyOf(p))}
                title={`${label}\n${timeOf(p.slot.start, timezone)}–${timeOf(p.slot.end, timezone)}`}
              >
                <span className="block-text">
                  {p.teamId !== undefined ? '⧉ ' : ''}
                  {names}
                </span>
              </div>
            )
          })}
      </>
    )
  }

  // A terven kívül maradt igények (U3): foglalatlanok és halasztottak.
  const placedIds = new Set(result.proposals.map((p) => p.requestId))
  const recordedIds = new Set(result.recordedInFlightLogger.map((r) => r.requestId))
  const dilemmaIds = new Set(result.dilemmas.flatMap((d) => d.requestIds))
  const notPlanned = requests.filter((r) => !placedIds.has(r.id) && !recordedIds.has(r.id))

  /**
   * Egy FlightLogger-foglalás részletei (9.6): a terv igényéé név és feladat szerint, a máséé csak
   * a fajta, az időpont, a gép és az ismert résztvevők (a névjegyzék a hozzárendelt növendékeké).
   */
  const flDetails = (b: ExistingBooking) => {
    const links = bookedById.get(b.id) ?? []
    const linked = links[0]
    const req = linked ? reqOf(linked.requestId) : undefined
    const multi = b.type === 'multiStudent'
    // A többnövendékes foglalás feladatai növendékenként (KBR-10).
    const lessonNames = [...new Set((b.lessons ?? []).map((l) => l.lectureName).filter((n): n is string => !!n))]
    const lecture = req?.lectureId && !multi ? bundle.directory.lectures[req.lectureId]?.name : multi ? lessonNames.join(' · ') || undefined : b.plannedLectureName
    const known = (ids: readonly string[]): string[] => ids.filter((id) => bundle.directory.people[id]).map((id) => personName(bundle, id))
    const observers = known(b.observerIds ?? [])
    const students = links.length > 0 ? links.flatMap((l) => reqOf(l.requestId)?.studentIds ?? []).map((id) => personName(bundle, id)) : known(flyingParticipantIds(b).filter((id) => id !== b.instructorId))
    const instructor = b.instructorId === undefined ? undefined : b.instructorId === me ? 'te' : (bundle.directory.people[b.instructorId]?.name ?? 'másik oktató')
    const slot = bookingSlot(b)
    const wx = b.flightStart && b.resourceId ? weatherLine(bundle, settings, slot) : undefined
    const watchItem = app.watch?.items.find((i) => links.some((l) => l.requestId === i.requestId))
    return (
      <Card title="FlightLogger-foglalás">
        <p>
          <strong>{req ? bookedLabel(links) : [BOOKING_TYPE_LABELS[b.type], lecture].filter(Boolean).join(' – ')}</strong>
          <br />
          {dayLabel(localParts(toMs(b.start), timezone).date)} {timeOf(b.start, timezone)}–{timeOf(b.end, timezone)}
          {b.flightStart && b.flightEnd && b.resourceId && (
            <>
              <br />
              {req ? requestKindShort(req) : 'Gépidő'}: {timeOf(b.flightStart, timezone)}–{timeOf(b.flightEnd, timezone)}
            </>
          )}
          <br />
          {resourceLabel(bundle, b.resourceId ?? b.classroomId)}
          <br />
          {linked ? (
            <Badge tone="ok">✓ a FlightLoggerben{links.some((l) => l.detected) ? ' (felismerve)' : links.some((l) => l.moved) ? ' (ott áthelyezve)' : ''}</Badge>
          ) : (
            <Badge tone="neutral">{b.instructorId === me ? 'saját foglalás, nem a terv igénye' : 'más foglalása'}</Badge>
          )}
        </p>
        <ul className="plain small">
          {req && <li>Foglalástípus: {multi ? BOOKING_TYPE_LABELS.multiStudent : req.kind === 'flight' ? BOOKING_TYPE_LABELS.singleStudent : requestKindLabel(req)}</li>}
          {req && lecture && <li>Feladat: {lecture}</li>}
          {students.length > 0 && <li>{students.length > 1 ? 'Növendékek' : 'Növendék'}: {students.join(', ')}</li>}
          {observers.length > 0 && <li>Megfigyelő: {observers.join(', ')}</li>}
          {instructor && <li>Oktató: {instructor}</li>}
          <li>Állapot: {BOOKING_STATUS_LABELS[b.status]}</li>
          {wx && <li>Időjárás a repülés kezdetén: {wx}</li>}
        </ul>
        {watchItem ? (
          <div className="stack-tight">
            <p className="small">
              {watchBadge(watchItem)} {watchSummary(watchItem, timezone)}
            </p>
            <Button small onClick={() => app.navigate('recording')}>
              Javaslat a rögzítési listán →
            </Button>
          </div>
        ) : linked ? (
          <p className="small muted">A terv ezt a helyet a FlightLoggerből veszi. Ha változtatnál rajta, a FlightLoggerben teheted; a hét közbeni javaslatok a rögzítési listán vannak.</p>
        ) : null}
        {linked && toMs(b.start) > now && (
          <div className="row wrap">
            {links.map((l) => (
              <Button
                key={l.requestId}
                small
                variant="defer"
                title="A következő hétre halasztom; a FlightLogger-foglalás lemondása a rögzítési listára kerül teendőként"
                onClick={() => {
                  app.updatePlan((p) => deferBooked(p, l.requestId, l.bookingId, new Date().toISOString()))
                  setSelected(null)
                }}
              >
                {links.length > 1 ? `Halasztás: ${requestLabel(bundle, reqOf(l.requestId))}` : 'Halasztás'}
              </Button>
            ))}
          </div>
        )}
      </Card>
    )
  }

  // Felhőalap a „Miért ide?” panelen (A8): a pont erre is támaszkodik.
  const cloudBase = (() => {
    const s = selectedProposal?.slot
    if (!s || !s.flightStart) return undefined
    const hourMs = Math.floor(toMs(s.flightStart) / 3_600_000) * 3_600_000
    const hour = bundle.snapshot.weather.find((w) => toMs(w.time) === hourMs)
    if (!hour) return undefined
    const base = hourCloudBase(hour)
    if (base.ft === null) return undefined
    return { ft: Math.round(base.ft / 100) * 100, none: base.ft >= NO_CEILING_FT, modelled: base.modelled }
  })()

  return (
    <div className="page">
      <PageHeader
        title="Tervezet" week={<WeekTag />}
        lead="Húzással mozgathatod a foglalást időben és a hasonló erőforrások között; a motor azonnal újraellenőriz. Kattintásra látszik, miért került oda."
        actions={
          <>
            {app.planning && <Badge tone="info">számolás…</Badge>}
            {warningCount > 0 ? (
              <Button variant="ghost" onClick={() => app.navigate('warnings')} title="A figyelmeztetések csoportosítva">
                <Badge tone="warn">{warningCount}</Badge> figyelmeztetés
              </Button>
            ) : (
              <Badge tone="ok">nincs figyelmeztetés</Badge>
            )}
            <OpeningsButton />
            <Button
              title="A mostani helyek lesznek az újratervezés alapja: hét közbeni változásnál a motor a lehető legkevesebbet mozdít (terv stabilitása)."
              onClick={() => app.updatePlan((p) => acceptPlan(p, result.proposals, new Date().toISOString()))}
            >
              {weekPlan.acceptedAt ? `Elfogadva: ${dateTimeShort(weekPlan.acceptedAt, timezone)} – újra elfogadom` : 'Terv elfogadása'}
            </Button>
            <Button variant="primary" onClick={() => app.navigate('recording')}>
              Tovább: rögzítési lista →
            </Button>
          </>
        }
      />
      {watchCount > 0 && (
        <div className="banner info row wrap" role="status">
          <span>
            Hét közbeni figyelés: <strong>{watchCount} javasolt változtatás</strong> a friss adat szerint (FlightLoggerben lévő vagy halasztott igény).
          </span>
          <Button small onClick={() => app.navigate('recording')}>
            Megnézem →
          </Button>
        </div>
      )}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={view === 'week'} className={view === 'week' ? 'tab active' : 'tab'} onClick={() => setView('week')}>
          Heti áttekintés
        </button>
        {days.map((d) => (
          <button
            key={d}
            role="tab"
            aria-selected={view === 'day' && d === activeDay}
            className={view === 'day' && d === activeDay ? 'tab active' : 'tab'}
            onClick={() => {
              setDay(d)
              setView('day')
            }}
          >
            {dayLabel(d)} <span className="tab-count">{dayCount(d)}</span>
          </button>
        ))}
      </div>
      <div className="draft-layout">
        {view === 'week' ? (
          <div className="timeline" style={HOUR_GRID}>
            <div className="timeline-row axis">
              <div className="row-label" />
              <div className="track">
                {Array.from({ length: RANGE / 60 + 1 }, (_, i) => (
                  <span key={i} className="tick" style={{ left: `${((i * 60) / RANGE) * 100}%` }}>
                    {hhmm(DAY_START + i * 60).slice(0, 2)}
                  </span>
                ))}
              </div>
            </div>
            {days.map((d) => (
              <div key={d} className="timeline-row instructor">
                <div className="row-label">{dayLabel(d)}</div>
                <div className="track">
                  {hourGrid}
                  {instructorTrack(d)}
                </div>
              </div>
            ))}
            <p className="legend small muted">Az oktató napjai egymás alatt. Kattintásra kijelöl; másik napra az „Áthelyezés…” gombbal teheted.</p>
          </div>
        ) : (
        <div className="timeline" style={HOUR_GRID} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <div className="timeline-row axis">
            <div className="row-label" />
            <div className="track" ref={trackRef}>
              {Array.from({ length: RANGE / 60 + 1 }, (_, i) => (
                <span key={i} className="tick" style={{ left: `${((i * 60) / RANGE) * 100}%` }}>
                  {hhmm(DAY_START + i * 60).slice(0, 2)}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-row instructor">
            <div className="row-label small">Oktató</div>
            <div className="track">
              {hourGrid}
              {instructorTrack(activeDay)}
            </div>
          </div>
          <div className="timeline-row weather">
            <div className="row-label small muted">Időjárás</div>
            <div className="track">
              {weatherStrip.map((r, i) => (
                <span key={i} className={`wx wx-${r}`} style={{ left: `${((i * 60) / RANGE) * 100}%`, width: `${(60 / RANGE) * 100}%` }} title={{ flyable: 'repülhető', marginal: 'bizonytalan', unflyable: 'nem repülhető', unknown: 'nincs adat' }[r]} />
              ))}
              {hourGrid}
            </div>
          </div>
          {(['aircraft', 'simulator', 'classroom'] as const).map((group) => (
            <div key={group}>
              <div className="group-label">{{ aircraft: 'Repülőgépek', simulator: 'Szimulátorok', classroom: 'Termek' }[group]}</div>
              {rows
                .filter((r) => r.group === group)
                .map((row) => (
                  <div key={row.id} className="timeline-row" data-row-id={row.id}>
                    <div className="row-label">{row.label}</div>
                    <div className="track" data-row-id={row.id}>
                      {daylight && group === 'aircraft' && (
                        <>
                          {twilight.dawn !== undefined ? (
                            <>
                              <span className="night" style={{ left: 0, width: `${frac(twilight.dawn) * 100}%` }} title="éjszaka" />
                              <span className="twilight" style={{ left: `${frac(twilight.dawn) * 100}%`, width: `${Math.max(0, frac(toMs(daylight.sunrise)) - frac(twilight.dawn)) * 100}%` }} title="polgári szürkület" />
                            </>
                          ) : (
                            <span className="night" style={{ left: 0, width: `${frac(toMs(daylight.sunrise)) * 100}%` }} />
                          )}
                          {twilight.dusk !== undefined ? (
                            <>
                              <span className="twilight" style={{ left: `${frac(toMs(daylight.sunset)) * 100}%`, width: `${Math.max(0, frac(twilight.dusk) - frac(toMs(daylight.sunset))) * 100}%` }} title="polgári szürkület" />
                              <span className="night" style={{ left: `${frac(twilight.dusk) * 100}%`, right: 0 }} title="éjszaka (a polgári szürkület után)" />
                            </>
                          ) : (
                            <span className="night" style={{ left: `${frac(toMs(daylight.sunset)) * 100}%`, right: 0 }} />
                          )}
                        </>
                      )}
                      {hourGrid}
                      {existing.filter((b) => b.resourceId === row.id || b.classroomId === row.id).map((b) => existingBlock(b, row.id))}
                      {proposals.filter((p) => (drag?.requestId === p.requestId ? drag.rowId : rowOfProposal(p)) === row.id).map(block)}
                    </div>
                  </div>
                ))}
            </div>
          ))}
          <p className="legend small muted">
            <span className="swatch existing" /> FlightLogger-foglalás <span className="swatch booked" /> a terv igénye a FlightLoggerben <span className="swatch kind-flight" /> repülés <span className="swatch kind-simulator" /> szimulátor <span className="swatch kind-theory" /> elmélet <span className="swatch tentative" /> dilemma
            ajánlása <span className="swatch severe" /> jóváhagyott figyelmeztetés <span className="swatch twilight" /> polgári szürkület{' '}
            <span className="swatch night" /> éjszaka · ! enyhe, !! jóváhagyott figyelmeztetés · nyilakkal is mozgatható
          </p>
        </div>
        )}

        <aside className="why">
          {selectedProposal && selectedRequest ? (
            <Card title="Miért ide?">
              <p>
                <strong>{requestLabel(bundle, selectedRequest)}</strong>
                <br />
                {dayLabel(localParts(toMs(selectedProposal.slot.start), timezone).date)} {timeOf(selectedProposal.slot.start, timezone)}–{timeOf(selectedProposal.slot.end, timezone)}
                {selectedProposal.slot.flightStart && (
                  <>
                    <br />
                    {requestKindShort(selectedRequest)}: {timeOf(selectedProposal.slot.flightStart, timezone)}–{timeOf(selectedProposal.slot.flightEnd!, timezone)}
                  </>
                )}
                <br />
                {resourceLabel(bundle, selectedProposal.slot.resourceId ?? selectedProposal.slot.classroomId)} · pont: {selectedProposal.score}
                {selectedProposal.decidedBy !== 'engine' && (
                  <>
                    {' '}
                    <Badge tone="info">{selectedProposal.decidedBy === 'autoResolved' ? 'a rendszer döntötte el' : 'kézi döntés'}</Badge>
                  </>
                )}
                {selectedProposal.standby && <Badge tone="info">standby</Badge>}
                {selectedProposal.recorded && <Badge tone="ok">rögzítve – a hely le van zárva</Badge>}
                {selectedProposal.change && <Badge tone="warn">a FlightLoggerben áthelyezendő</Badge>}
                <PriorityBadge settings={app.settings} request={selectedRequest} />
              </p>
              {selectedProposal.standby && selectedProposal.pairedRequestId && (
                <p className="small muted">Rossz idő esetén {requestLabel(bundle, reqOf(selectedProposal.pairedRequestId))} helyett; a repüléssel együtt mozog, az elmélet saját helye is megmarad.</p>
              )}
              {cloudBase !== undefined && (
              <p className="small muted">
                {cloudBase.none
                  ? 'Felhőalap a repülés kezdetén: kb. 10 000 láb alatt nincs plafon (a modell felhőprofilja szerint).'
                  : `Felhőalap a repülés kezdetén: kb. ${cloudBase.ft} láb (${cloudBase.modelled ? 'a modell felhőprofiljából számolt plafon' : 'becslés a hőmérséklet és a harmatpont különbségéből'}).`}
              </p>
            )}
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Feltétel</th>
                    <th className="num">Súly</th>
                    <th className="num">Részpont</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedProposal.factors.map((f, i) => (
                    <tr key={f.criterion} className={i < 3 ? 'top' : undefined}>
                      <td>{CRITERION_LABELS[f.criterion]}</td>
                      <td className="num">{f.weight}%</td>
                      <td className="num">{f.subScore.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {selectedProposal.warnings.length > 0 && (
                <ul className="warnings">
                  {selectedProposal.warnings.map((w) => (
                    <li key={w.message} className={`w-${w.kind}`}>
                      {resolveText(w.message, bundle, requests)}
                    </li>
                  ))}
                </ul>
              )}
              {selectedProposal.assumptions.map((a) => (
                <p key={a} className="small muted">
                  {a}
                </p>
              ))}
              {selectedProposal.teamId !== undefined && (
                <div className="team-why">
                  <p className="small">
                    <strong>Közös briefing: {teamLabels.get(selectedProposal.teamId) ?? 'csapat'}</strong> · {timeOf(selectedProposal.slot.start, timezone)}–{timeOf(selectedProposal.slot.end, timezone)}
                    <br />
                    <span className="muted">A csapat egyszerre kezd, egymás után repül, a végén közös a debriefing; húzáskor együtt mozog.</span>
                  </p>
                  <ol className="plain small">
                    {(result.teams.find((t) => t.teamId === selectedProposal.teamId)?.units ?? []).map((u) => (
                      <li key={u.requestIds.join('+')}>
                        {timeOf(u.flightStart, timezone)}–{timeOf(u.flightEnd, timezone)} {resourceLabel(bundle, u.resourceId)}: {u.requestIds.map((id) => requestLabel(bundle, reqOf(id))).join(' + ')}
                        {u.bookingType === 'multiStudent' ? ' (többnövendékes)' : ''}
                      </li>
                    ))}
                  </ol>
                  {!selectedProposal.recorded && (
                    <Button small variant="ghost" onClick={() => app.updatePlan((p) => removeFromTeam(p, selectedProposal.requestId))} title="Egyénileg tervezett lesz, a csapat a többiekkel marad">
                      Kivétel a csapatból
                    </Button>
                  )}
                </div>
              )}
              <label className="field">
                <span className="field-label">Komment</span>
                <textarea
                  className="input"
                  rows={3}
                  maxLength={500}
                  defaultValue={selectedProposal.comment ?? ''}
                  key={`${selectedProposal.requestId}-${selectedProposal.comment ?? ''}`}
                  onBlur={(e) => app.updatePlan((p) => setComment(p, selectedProposal.requestId, e.target.value))}
                />
                <span className="field-hint">A növendék is látja a kommentet a FlightLoggerben; mást ne nevezz meg benne.</span>
              </label>
              <div className="row wrap">
                {!selectedProposal.standby && !selectedProposal.recorded && !(selectedProposal.teamId !== undefined && teamLocked(selectedProposal.teamId)) && (
                  <Button small onClick={() => setMoving(!moving)}>
                    {moving ? 'Áthelyezés bezárása' : 'Áthelyezés…'}
                  </Button>
                )}
                {selectedProposal.recorded ? (
                  <>
                    <span className="small muted">Rögzítettnek jelölted: a helye le van zárva. A rögzítési listán vonhatod vissza.</span>
                    {toMs(selectedProposal.slot.start) > now && (
                      <Button
                        small
                        variant="defer"
                        title="A következő hétre halasztom; ha a FlightLoggerben is foglalva van, a lemondása a rögzítési listára kerül"
                        onClick={() => {
                          const id = selectedProposal.requestId
                          app.updatePlan((p) => deferBooked(p, id, p.recordedBookings?.[id], new Date().toISOString()))
                          setSelected(null)
                        }}
                      >
                        Halasztás
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button
                      small
                      onClick={() =>
                        app.updatePlan((p) =>
                          selectedProposal.teamId !== undefined ? teamMembers(selectedProposal.teamId).reduce((acc, m) => resetRequest(acc, m.requestId), p) : resetRequest(p, selectedProposal.requestId),
                        )
                      }
                    >
                      Vissza a javaslatra
                    </Button>
                    <Button
                      small
                      variant="defer"
                      title={selectedProposal.change ? 'A következő hétre halasztom; a FlightLogger-foglalást a rögzítési listáról mondod le' : undefined}
                      onClick={() => {
                        const change = selectedProposal.change
                        if (change) app.updatePlan((p) => planCancel(p, selectedProposal.requestId, change.bookingId))
                        else app.updatePlan((p) => ({ ...resetRequest(p, selectedProposal.requestId), decisions: [...resetRequest(p, selectedProposal.requestId).decisions, { kind: 'defer', requestId: selectedProposal.requestId }] }))
                      }}
                    >
                      Halasztás
                    </Button>
                    {selectedProposal.change && (
                      <Button small variant="ghost" onClick={() => app.updatePlan((p) => revertChange(p, selectedProposal.requestId))} title="A foglalás marad, ahol a FlightLoggerben van">
                        Mégsem (marad a FlightLogger szerint)
                      </Button>
                    )}
                  </>
                )}
              </div>
              {moving && selectedRequest && !selectedProposal.standby && (
                <div className="picker-wrap">
                  <h3>Áthelyezés bármelyik napra</h3>
                  <SlotPicker
                    key={selectedRequest.id}
                    request={selectedRequest}
                    onDecide={(d) => {
                      if (d.kind === 'assign') {
                        // Csapattagnál az egész csapat tolódik ugyanannyival (KBR-08).
                        const own = selectedProposal.slot.flightStart ?? selectedProposal.slot.start
                        const target = d.slot.flightStart ?? d.slot.start
                        const row = d.slot.resourceId ?? d.slot.classroomId
                        const group = groupOf(row)
                        if (selectedProposal.teamId !== undefined && row && group) moveTeamTo(selectedProposal, Math.round((toMs(target) - toMs(own)) / 60_000), row, group)
                        else moveTo(d.requestId, d.slot)
                      }
                      setMoving(false)
                    }}
                  />
                </div>
              )}
            </Card>
          ) : selectedFl ? (
            flDetails(selectedFl)
          ) : (
            <Card title="Miért ide?">
              <Empty>Kattints egy tervezett vagy FlightLogger-foglalásra.</Empty>
            </Card>
          )}
        </aside>
      </div>

      {notPlanned.length > 0 && (
        <Card title={`Nincs a terven (${notPlanned.length})`} className="not-planned">
          <ul>
            {notPlanned.map((r) => {
              const isDeferred = result.deferred.includes(r.id)
              const reason = result.unplaced.find((u) => u.requestId === r.id)?.reason
              return (
                <li key={r.id}>
                  <strong>{requestLabel(bundle, r)}</strong>
                  <span className="small muted">
                    {cancelPlanned.has(r.id) ? 'halasztva a következő hétre – a FlightLoggerben lemondandó' : isDeferred ? 'halasztva a következő hétre' : (reason ?? 'nincs elhelyezve')}
                    {moveMarked.get(r.id)?.from && ` – a FlightLoggerben még itt van: ${dateTimeShort(moveMarked.get(r.id)!.from!.start, timezone)}`}
                  </span>
                  {moveMarked.has(r.id) && (
                    <Button small variant="ghost" onClick={() => app.updatePlan((p) => revertChange(p, r.id))} title="A foglalás marad, ahol a FlightLoggerben van">
                      Mégsem (marad a FlightLogger szerint)
                    </Button>
                  )}
                  {(cancelPlanned.has(r.id) || isDeferred) && locked.has(r.id) ? (
                    <span className="small muted" title={lockedNote}>
                      a következő héten már döntöttél róla
                    </span>
                  ) : cancelPlanned.has(r.id) ? (
                    <Button small variant="ghost" onClick={() => app.updatePlan((p) => revertChange(p, r.id))} title="A foglalás marad, ahol a FlightLoggerben van">
                      Lemondás visszavonása
                    </Button>
                  ) : isDeferred ? (
                    <Button small variant="ghost" onClick={() => app.updatePlan((p) => ({ ...p, decisions: p.decisions.filter((d) => !(d.kind === 'defer' && d.requestId === r.id)) }))}>
                      Halasztás visszavonása
                    </Button>
                  ) : (
                    <>
                      {dilemmaIds.has(r.id) && (
                        <Button small variant="ghost" onClick={() => app.navigate('dilemmas')}>
                          Dilemma megnyitása
                        </Button>
                      )}
                      <Button small variant="defer" onClick={() => app.updatePlan((p) => ({ ...p, decisions: [...p.decisions, { kind: 'defer', requestId: r.id }] }))}>
                        Halasztás
                      </Button>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </Card>
      )}
    </div>
  )
}
