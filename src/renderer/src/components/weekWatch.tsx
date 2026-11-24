import type { Settings } from '@core/config/schema'
import { relativeWeekLabel } from '@core/draft/weekPlan'
import { watchWeatherText, type WatchCapacity, type WatchItem, type WeekWatch } from '@core/engine/weekWatch'
import type { DataBundle } from '@core/model/dataBundle'
import type { BookingRequest, Slot } from '@core/model/planning'
import { addDays, HOUR_MS, localParts, toMs } from '@core/time/zoned'
import { hourValues, NO_CEILING_FT } from '@core/weather/rating'
import { dateLabel, dayLabel, personName, relativeAge, requestLabel, resourceLabel, timeOf } from '../format'
import { todayIn, useApp, useNow } from '../state'
import type { ReactNode } from 'react'
import { Badge, Button, Card } from './ui'

/**
 * Hét közbeni figyelés a felületen (6. fejezet 9. lépés, TRV-15): az indítópult kártyája a
 * nyitott és a háttérben figyelt hét javaslataival, valamint a javaslatok közös szövegei.
 * A teendők a rögzítési listán vannak, mert mindegyik a FlightLoggerben végzendő.
 */

/**
 * Miért nem vonható vissza egy halasztás (H07): a következő héten a másolatáról már döntöttek vagy
 * rögzítették, így két hétre is bekerülne.
 */
export const RESTORE_LOCKED_NOTE =
  'A következő héten már döntöttél a másolatáról vagy rögzítetted: ha itt visszavonnád, két hétre is bekerülne. Ha ezen a héten kell, előbb a következő héten töröld vagy halaszd el onnan.'

/**
 * Áthelyezésnél a régi és az új hely egymás mellett, kiemelve: a régi áthúzva, az új zölden; a
 * ténylegesen változó rész (nap, idő, gép vagy terem) aláhúzva. A megjegyzések (például az
 * időjárás) a dobozok alján.
 */
export function MoveDates(props: { from: Slot; to: Slot; bundle: DataBundle | null; tz: string; fromNote?: ReactNode; toNote?: ReactNode }) {
  const parts = (slot: Slot) => ({
    day: dayLabel(localParts(toMs(slot.start), props.tz).date),
    time: `${timeOf(slot.start, props.tz)}–${timeOf(slot.end, props.tz)}`,
    place: resourceLabel(props.bundle, slot.resourceId ?? slot.classroomId),
  })
  const a = parts(props.from)
  const b = parts(props.to)
  const mark = (changed: boolean): string | undefined => (changed ? 'changed' : undefined)
  const box = (kind: 'from' | 'to', p: typeof a, note: ReactNode) => (
    <span className={`move-date ${kind}`}>
      <span className="move-label">{kind === 'from' ? 'régi' : 'új'}</span>
      <span className="move-when">
        <strong className={mark(a.day !== b.day)}>{p.day}</strong> <strong className={mark(a.time !== b.time)}>{p.time}</strong> ·{' '}
        <span className={mark(a.place !== b.place)}>{p.place}</span>
      </span>
      {note ? <span className="move-note">{note}</span> : null}
    </span>
  )
  return (
    <span className="move-dates" aria-label={`Áthelyezés: ${a.day} ${a.time} ${a.place} helyett ${b.day} ${b.time} ${b.place}`}>
      {box('from', a, props.fromNote)}
      <span className="move-arrow" aria-hidden="true">
        →
      </span>
      {box('to', b, props.toNote)}
    </span>
  )
}

/** „K 11.17. 09:00–11:15 · HA-XPA” */
export function slotLine(slot: Slot, bundle: DataBundle | null, tz: string): string {
  const day = dayLabel(localParts(toMs(slot.start), tz).date)
  return `${day} ${timeOf(slot.start, tz)}–${timeOf(slot.end, tz)} · ${resourceLabel(bundle, slot.resourceId ?? slot.classroomId)}`
}

/** „K 09:00” (rövid, a listákhoz) */
export function slotShort(slot: Slot, tz: string): string {
  return `${dayLabel(localParts(toMs(slot.start), tz).date)} ${timeOf(slot.flightStart ?? slot.start, tz)}`
}

/** Az előrejelzés a repülés kezdetének órájára: szél, oldalszél, látás, felhőalap. */
export function weatherLine(bundle: DataBundle | null, settings: Settings | null, slot: Slot): string | undefined {
  if (!bundle || !slot.flightStart) return undefined
  const hourMs = Math.floor(toMs(slot.flightStart) / HOUR_MS) * HOUR_MS
  const hour = bundle.snapshot.weather.find((w) => toMs(w.time) === hourMs)
  if (!hour) return undefined
  const v = hourValues(hour, settings?.airport?.runways.map((r) => r.trueHeadingDeg) ?? [])
  const parts: string[] = []
  if (v.windKt !== null) parts.push(`szél ${Math.round(v.windKt)}${v.gustKt !== null && v.gustKt > v.windKt + 2 ? `, lökés ${Math.round(v.gustKt)}` : ''} kt`)
  if (v.crosswindKt !== null && v.crosswindKt >= 5) parts.push(`oldalszél ${Math.round(v.crosswindKt)} kt`)
  if (v.visibilityM !== null) parts.push(`látás ${v.visibilityM >= 10_000 ? '10+ km' : `${(v.visibilityM / 1000).toFixed(1).replace('.', ',')} km`}`)
  if (v.cloudBaseFt !== null) parts.push(v.cloudBaseFt >= NO_CEILING_FT ? 'nincs alacsony plafon' : `felhőalap ${Math.round(v.cloudBaseFt / 100) * 100} láb`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** A javaslat fajtája egy címkében. */
export function watchBadge(item: WatchItem) {
  switch (item.kind) {
    case 'move':
      return item.urgent ? <Badge tone="danger">áthelyezés kell</Badge> : <Badge tone="warn">áthelyezés javasolt</Badge>
    case 'atRisk':
      return <Badge tone="danger">kockázatos</Badge>
    case 'restore':
      return <Badge tone="info">visszahozható</Badge>
    case 'missing':
      return <Badge tone="warn">nincs a FlightLoggerben</Badge>
    case 'stillBooked':
      return <Badge tone="warn">még foglalva</Badge>
  }
}

/** Egysoros összefoglaló az indítópultra. */
export function watchSummary(item: WatchItem, tz: string): string {
  switch (item.kind) {
    case 'move': {
      const w = item.weather ? ` (${watchWeatherText(item.weather.from)} → ${watchWeatherText(item.weather.to)} idő)` : ''
      const team = item.team ? `${item.team.members.length} fős közös briefing csapat: ` : ''
      return `${team}${slotShort(item.from, tz)} → ${slotShort(item.to, tz)}${w}${item.leavesTeam ? ' (kiválva a csapatból)' : ''}`
    }
    case 'atRisk':
      return `${slotShort(item.from, tz)}: a héten nincs jobb hely`
    case 'restore':
      return `halasztva → ${slotShort(item.to, tz)}${item.weather ? ` (${watchWeatherText(item.weather)} idő)` : ''}`
    case 'missing':
      return `rögzítettnek jelölted (${slotShort(item.slot, tz)}), de nem találom`
    case 'stillBooked':
      return `halasztva, de a FlightLoggerben még foglalva (${slotShort(item.slot, tz)})`
  }
}

/** Az indítópult kártyája: a nyitott és a háttérben figyelt hét állapota. */
export function WatchCard() {
  const app = useApp()
  const now = useNow()
  const { watch, sideWatch, bundle, weekPlan, timezone } = app
  const toDo = (app.result?.proposals.filter((p) => p.change).length ?? 0) + (app.result?.plannedCancels.filter((c) => !c.done).length ?? 0)
  const own = watch && bundle && weekPlan && (watch.items.length > 0 || watch.watched.booked > 0 || toDo > 0 || watch.capacity) ? watch : null
  if (!own && !sideWatch) return null
  const today = todayIn(timezone)
  return (
    <Card title="Hét közbeni figyelés" className="card-wide watch-card">
      <p className="small muted">
        A FlightLoggerben lévő foglalásokat és a halasztott igényeket a friss adattal újraértékelem. Magától semmit nem módosítok: a javaslatokat a rögzítési listán
        egyenként a foglalási tervbe teheted, és onnan viszed át a FlightLoggerbe, amikor neked alkalmas.
      </p>
      {own && bundle && weekPlan && (
        <WeekSummary
          title={`${dateLabel(app.weekStart)}–${dateLabel(addDays(app.weekStart, 6))} (${relativeWeekLabel(app.weekStart, today)})`}
          watch={own}
          bundle={bundle}
          requests={weekPlan.requests}
          tz={timezone}
          age={relativeAge(bundle.fetchedAt, now)}
          toDo={toDo}
          onOpen={() => app.navigate('recording')}
        />
      )}
      {sideWatch && (
        <WeekSummary
          title={`${dateLabel(sideWatch.weekStart)}–${dateLabel(addDays(sideWatch.weekStart, 6))} (${relativeWeekLabel(sideWatch.weekStart, today)})`}
          watch={sideWatch.watch}
          bundle={sideWatch.bundle}
          requests={sideWatch.requests}
          tz={timezone}
          age={relativeAge(sideWatch.fetchedAt, now)}
          onOpen={() => void app.openSideWatch()}
          openLabel="Megnyitom a hetet"
        />
      )}
    </Card>
  )
}

const MAX_LISTED = 6

function WeekSummary(props: {
  title: string
  watch: WeekWatch
  bundle: DataBundle
  requests: readonly BookingRequest[]
  tz: string
  age: string
  /** A foglalási tervbe tett, a FlightLoggerben még elvégzendő változtatások száma. */
  toDo?: number
  onOpen: () => void
  openLabel?: string
}) {
  const { watch } = props
  const n = watch.items.length
  const urgent = watch.items.filter((i) => (i.kind === 'move' && i.urgent) || i.kind === 'atRisk').length
  return (
    <div className="watch-week">
      <div className="watch-week-head">
        <strong>{props.title}</strong>
        {n === 0 ? (
          <Badge tone="ok">rendben</Badge>
        ) : (
          <Badge tone={urgent > 0 ? 'danger' : 'warn'}>
            {n} javasolt változtatás{urgent > 0 ? `, ebből ${urgent} sürgős` : ''}
          </Badge>
        )}
        {(props.toDo ?? 0) > 0 && <Badge tone="info">{props.toDo} tervbe tett változtatás a FlightLoggerben elvégzendő</Badge>}
        <span className="small muted">adatok: {props.age}</span>
        {watch.capacity && <Badge tone="info">van még hely</Badge>}
        {(n > 0 || (props.toDo ?? 0) > 0 || props.openLabel || watch.capacity) && (
          <Button small variant={n > 0 ? 'primary' : 'secondary'} onClick={props.onOpen}>
            {props.openLabel ?? 'Változtatások'} →
          </Button>
        )}
      </div>
      {watch.capacity && <p className="small">Van még hely: {capacitySummary(watch.capacity, (id) => personName(props.bundle, id))}.</p>}
      {n === 0 ? (
        <p className="small muted">
          {watch.watched.booked} még előttünk álló FlightLogger-foglalás{watch.watched.deferred > 0 ? ` és ${watch.watched.deferred} halasztott igény` : ''} ellenőrizve: nincs
          új javaslat.
        </p>
      ) : (
        <ul className="plain watch-list">
          {watch.items.slice(0, MAX_LISTED).map((item) => (
            <li key={`${item.kind}:${item.requestId}`}>
              {watchBadge(item)} <strong>{requestLabel(props.bundle, props.requests.find((r) => r.id === item.requestId))}</strong>{' '}
              <span className="small">{watchSummary(item, props.tz)}</span>
            </li>
          ))}
          {n > MAX_LISTED && <li className="small muted">és még {n - MAX_LISTED}…</li>}
        </ul>
      )}
    </div>
  )
}

/** Rövid sor a figyelés összefoglalójához (indítópult). */
export function capacitySummary(capacity: WatchCapacity, names: (id: string) => string): string {
  const list = capacity.students.map((s) => names(s.studentId))
  return `a következő ${capacity.days} napban még ${list.length} növendéknek van hely: ${list.length > 4 ? `${list.slice(0, 4).join(', ')} és még ${list.length - 4}` : list.join(', ')}`
}
