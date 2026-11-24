import { paidTime, type PaidItem, type SkippedItem } from '@core/draft/paidTime'
import { relativeWeekLabel } from '@core/draft/weekPlan'
import { flyingParticipantIds } from '@core/model/bookingStudents'
import { addDays, localParts, toMs } from '@core/time/zoned'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BOOKING_TYPE_LABELS, dateLabel, dayLabel, hoursMinutes, personName, requestLabel, resourceLabel, timeOf } from '../format'
import { todayIn, useApp, useNow } from '../state'

/**
 * A tervezett hét a fejlécben: „‹ 11.16.–11.22. (jövő hét) ›”. A hét minden képernyőről
 * váltható (U7). Mellette az oktató fizetett ideje a héten (repült idő az egyedül/SPIC-kel,
 * szimulátor és elmélet, briefing nélkül; `paidTime`); kattintásra tételes részletezés.
 */
export function WeekTag() {
  const app = useApp()
  useNow() // éjfél után a „ez a hét / jövő hét” is frissüljön
  const relative = relativeWeekLabel(app.weekStart, todayIn(app.timezone))
  const busy = app.dataLoading && !app.dataBackground
  return (
    <span className="week-tag header-week">
      <button type="button" className="link week-switch" disabled={busy} onClick={() => void app.setWeek(addDays(app.weekStart, -7))} aria-label="Előző hét" title="Előző hét">
        ‹
      </button>
      <span title="A tervezett hét">
        {dateLabel(app.weekStart)}–{dateLabel(addDays(app.weekStart, 6))} <span className="week-rel">({relative})</span>
      </span>
      <button type="button" className="link week-switch" disabled={busy} onClick={() => void app.setWeek(addDays(app.weekStart, 7))} aria-label="Következő hét" title="Következő hét">
        ›
      </button>
      <PaidTime />
    </span>
  )
}

const CATEGORY_LABELS: Readonly<Record<PaidItem['category'], string>> = { flight: 'Repülés', simulator: 'Szimulátor', theory: 'Elmélet' }

/** Az oktató fizetett ideje a nyitott héten; kattintásra a beszámított és a kihagyott tételek. */
function PaidTime() {
  const { result, bundle, settings, weekPlan, timezone } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement | null>(null)
  const paid = useMemo(() => {
    if (!result || !bundle || !settings || !weekPlan || bundle.snapshot.weekStart !== weekPlan.weekStart) return null
    return paidTime({ snapshot: bundle.snapshot, settings, requests: weekPlan.requests, result, catalog: bundle.directory.lectures })
  }, [result, bundle, settings, weekPlan])

  // Kívülre kattintva vagy Escape-re bezárul.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!paid || !bundle || !weekPlan || !result) return null
  const reqOf = (id: string) => weekPlan.requests.find((r) => r.id === id)
  const bookings = new Map(bundle.snapshot.bookings.map((b) => [b.id, b]))
  // A többnövendékes foglalás több igényé is lehet, növendékenként egyé (KBR-10).
  const linkedRequests = new Map<string, string[]>()
  for (const l of result.recordedInFlightLogger) linkedRequests.set(l.bookingId, [...(linkedRequests.get(l.bookingId) ?? []), l.requestId])
  /** A tétel neve: a terv igényéé név és feladat szerint, a más FlightLogger-foglalásé a fajtája és az ismert résztvevők. */
  const labelOf = (x: { readonly requestId?: string; readonly bookingId?: string }): string => {
    const requestIds = x.requestId ? [x.requestId] : x.bookingId ? (linkedRequests.get(x.bookingId) ?? []) : []
    if (requestIds.length > 0) return requestIds.map((id) => requestLabel(bundle, reqOf(id))).join(' · ')
    const b = x.bookingId ? bookings.get(x.bookingId) : undefined
    if (!b) return '–'
    const people = flyingParticipantIds(b)
      .filter((id) => id !== b.instructorId && bundle.directory.people[id])
      .map((id) => personName(bundle, id))
    const lectures = b.lessons?.map((l) => l.lectureName).filter(Boolean).join(' · ') || b.plannedLectureName
    return [BOOKING_TYPE_LABELS[b.type], lectures, people.join(', ')].filter(Boolean).join(' – ')
  }
  const dayOf = (iso: string): string => localParts(toMs(iso), timezone).date
  const days = [...new Set(paid.items.map((i) => dayOf(i.start)))]
  const breakdown = [
    `repülés ${hoursMinutes(paid.flightMinutes)}${paid.soloMinutes > 0 ? ` (ebből egyedül/SPIC ${hoursMinutes(paid.soloMinutes)})` : ''}`,
    `szimulátor ${hoursMinutes(paid.simulatorMinutes)}`,
    `elmélet ${hoursMinutes(paid.theoryMinutes)}`,
  ].join(' · ')

  return (
    <span className="paid-wrap" ref={ref}>
      <button type="button" className="paid-time" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`Fizetett idő a héten: ${breakdown}. Kattintásra tételesen.`}>
        fizetett: <strong>{hoursMinutes(paid.paidMinutes)}</strong> ó
      </button>
      {open && (
        <div className="paid-pop" role="dialog" aria-label="Fizetett idő részletezése">
          <div className="paid-pop-head">
            <strong>Fizetett idő a héten: {hoursMinutes(paid.paidMinutes)}</strong>
            <span className="small">{breakdown}</span>
            <span className="small muted">
              FlightLoggerben: {hoursMinutes(paid.bookedMinutes)} · a terv még nem rögzített része: {hoursMinutes(paid.paidMinutes - paid.bookedMinutes)}. Csak a repülési (gép)idő és az
              elméleti óra számít; a briefing, a debriefing, a motorpróba és a standby elmélet nem.
            </span>
          </div>
          {paid.items.length === 0 ? (
            <p className="small muted">A héten nincs beszámítható tétel.</p>
          ) : (
            <table className="table compact paid-table">
              <tbody>
                {days.map((day) => (
                  <PaidDay key={day} day={day} items={paid.items.filter((i) => dayOf(i.start) === day)} label={labelOf} place={(i) => resourceLabel(bundle, i.resourceId ?? i.classroomId)} tz={timezone} />
                ))}
              </tbody>
            </table>
          )}
          {paid.skipped.length > 0 && (
            <>
              <h4 className="paid-sub">Nem számít bele</h4>
              <ul className="plain small">
                {paid.skipped.map((s) => (
                  <SkippedRow key={`${s.bookingId ?? ''}|${s.requestId ?? ''}|${s.start}`} item={s} label={labelOf(s)} tz={timezone} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </span>
  )
}

function PaidDay(props: { day: string; items: readonly PaidItem[]; label: (i: PaidItem) => string; place: (i: PaidItem) => string; tz: string }) {
  const total = props.items.reduce((n, i) => n + i.minutes, 0)
  return (
    <>
      <tr className="paid-day">
        <th colSpan={4}>{dayLabel(props.day)}</th>
        <th className="num">{hoursMinutes(total)}</th>
      </tr>
      {props.items.map((i) => (
        <tr key={`${i.bookingId ?? ''}|${i.requestId ?? ''}|${i.start}`}>
          <td className="nowrap">
            {timeOf(i.start, props.tz)}–{timeOf(i.end, props.tz)}
          </td>
          <td>{CATEGORY_LABELS[i.category]}</td>
          <td className="wrap">
            {props.label(i)}
            {i.soloMinutes > 0 && <span className="muted"> (egyedül/SPIC {hoursMinutes(i.soloMinutes)})</span>}
          </td>
          <td className="muted small place">
            {props.place(i)}
            <br />
            {i.source === 'flightLogger' ? 'FlightLogger' : 'terv'}
          </td>
          <td className="num">{hoursMinutes(i.minutes)}</td>
        </tr>
      ))}
    </>
  )
}

function SkippedRow(props: { item: SkippedItem; label: string; tz: string }) {
  const { item } = props
  return (
    <li>
      {dayLabel(localParts(toMs(item.start), props.tz).date)} {timeOf(item.start, props.tz)} – {props.label}: <span className="muted">{item.reason}</span>
    </li>
  )
}
