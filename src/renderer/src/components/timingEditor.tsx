import { useEffect, useRef, useState } from 'react'
import type { BookingRequest, TimeWindow } from '@core/model/planning'
import type { LocalDate, Weekday } from '@core/model/time'
import { workWindowOn } from '@core/config/operations'
import { addDays, localParts, localToMs, toMs } from '@core/time/zoned'
import { dayLabel, fromLocalInput, hhmm, toLocalInput } from '../format'
import { useApp } from '../state'
import { Button, Checkbox, DateTimeInput, Segmented } from './ui'

const DAY_SHORT: Readonly<Record<Weekday, string>> = { mon: 'H', tue: 'K', wed: 'Sze', thu: 'Cs', fri: 'P', sat: 'Szo', sun: 'V' }
const ANY_DAY = 'any'
const DEFAULT_WINDOW_MINUTES = 180

/** Egy sor a felugró ablakban: nap (vagy a hét bármely napja) és a kezdés helyi „ÓÓ:PP” határai. */
interface WindowRow {
  readonly key: number
  readonly day: LocalDate | typeof ANY_DAY
  readonly from: string
  readonly to: string
}

const toMinutes = (hm: string): number | undefined => {
  const m = /^(\d{2}):(\d{2})$/.exec(hm)
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined
}

const weekDates = (weekStart: LocalDate): LocalDate[] => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

/**
 * Tárolt ablakokból szerkeszthető sorok. Ha ugyanaz az idősáv a hét minden napján szerepel,
 * egyetlen „bármely nap” sor lesz belőle.
 */
function rowsFromWindows(windows: readonly TimeWindow[], weekStart: LocalDate, tz: string): WindowRow[] {
  const days = weekDates(weekStart)
  const groups = new Map<string, { from: string; to: string; dates: LocalDate[] }>()
  for (const w of windows) {
    const s = localParts(toMs(w.start), tz)
    const e = localParts(toMs(w.end), tz)
    const from = hhmm(s.minutes)
    // Éjfélen átnyúló (régi) ablak a nap végéig látszik.
    const to = e.date === s.date ? hhmm(e.minutes) : '23:59'
    const key = `${from}-${to}`
    const g = groups.get(key) ?? { from, to, dates: [] }
    g.dates.push(s.date)
    groups.set(key, g)
  }
  const rows: WindowRow[] = []
  let k = 0
  for (const g of groups.values()) {
    if (days.every((d) => g.dates.includes(d))) rows.push({ key: k++, day: ANY_DAY, from: g.from, to: g.to })
    else for (const d of [...new Set(g.dates)].sort()) rows.push({ key: k++, day: d, from: g.from, to: g.to })
  }
  return rows.sort((a, b) => (a.day === b.day ? a.from.localeCompare(b.from) : a.day === ANY_DAY ? -1 : b.day === ANY_DAY ? 1 : a.day.localeCompare(b.day)))
}

function windowsFromRows(rows: readonly WindowRow[], weekStart: LocalDate, tz: string): TimeWindow[] {
  const seen = new Set<string>()
  const out: TimeWindow[] = []
  for (const r of rows) {
    const from = toMinutes(r.from)
    const to = toMinutes(r.to)
    if (from === undefined || to === undefined || to < from) continue
    for (const date of r.day === ANY_DAY ? weekDates(weekStart) : [r.day]) {
      const w = { start: new Date(localToMs(date, from, tz)).toISOString(), end: new Date(localToMs(date, to, tz)).toISOString() }
      const key = `${w.start}/${w.end}`
      if (!seen.has(key)) {
        seen.add(key)
        out.push(w)
      }
    }
  }
  return out.sort((a, b) => toMs(a.start) - toMs(b.start))
}

/** Rövid összefoglaló a gombra: „K 09:00–12:00 · Cs 14:00–18:00”. */
function summaryOf(windows: readonly TimeWindow[], weekStart: LocalDate, tz: string): string {
  const parts = rowsFromWindows(windows, weekStart, tz).map((r) => {
    const day = r.day === ANY_DAY ? 'Minden nap' : DAY_SHORT[localParts(Date.parse(`${r.day}T12:00:00Z`), 'UTC').weekday]
    return `${day} ${r.from}–${r.to}`
  })
  return parts.length <= 3 ? parts.join(' · ') : `${parts.slice(0, 2).join(' · ')} · +${parts.length - 2}`
}

/**
 * Fix időpont vagy időablakok (TRV-02); alapból bármikor, a motor választ.
 * Időablaknál egy kis felugró ablakban több idősáv adható meg a foglalás kezdetére, napra vagy a
 * hét bármely napjára. Egy nap kiválasztásakor az idősáv alapból a munkaidő eleje és a munkaidő
 * vége mínusz a foglalás hossza: ebben a sávban kezdve a foglalás a munkaidőn belül marad.
 */
export function TimingEditor(props: { request: BookingRequest; tz: string; weekStart: LocalDate; defaultStart: string; onChange: (timing: BookingRequest['timing'] | undefined) => void }) {
  const { request, tz, weekStart } = props
  const timing = request.timing
  const kind = timing?.kind ?? 'none'
  const [editing, setEditing] = useState(false)
  const totalMinutes = request.durations.briefing + request.durations.main + request.durations.debriefing
  const settings = useApp().settings
  const dayDefault = (date: LocalDate): { from: string; to: string } | undefined => {
    const w = settings ? workWindowOn(settings, date) : undefined
    if (!w) return undefined
    return { from: hhmm(w.start), to: hhmm(Math.max(w.start, w.end - totalMinutes)) }
  }

  /** Új ablak javaslata: a fix időpont napja és ideje, különben a hét bármely napja az alapidőtől. */
  const initialRows = (): WindowRow[] => {
    if (timing?.kind === 'preferred') return rowsFromWindows(timing.windows, weekStart, tz)
    if (timing?.kind === 'fixed') {
      const fixed = localParts(toMs(timing.start), tz)
      return [{ key: 0, day: fixed.date, from: hhmm(fixed.minutes), to: hhmm(fixed.minutes) }]
    }
    const base = localParts(toMs(props.defaultStart), tz)
    return [{ key: 0, day: ANY_DAY, from: hhmm(base.minutes), to: hhmm(Math.min(base.minutes + DEFAULT_WINDOW_MINUTES, 23 * 60 + 59)) }]
  }

  return (
    <div className="timing-editor">
      <Segmented
        ariaLabel="Időpont módja"
        value={kind}
        onChange={(v) => {
          if (v === 'none') props.onChange(undefined)
          else if (v === 'preferred') setEditing(true)
          else props.onChange({ kind: 'fixed', start: timing?.kind === 'preferred' ? timing.windows[0]!.start : props.defaultStart })
        }}
        options={[
          { value: 'none', label: 'Bármikor', title: 'A motor választ időpontot' },
          { value: 'preferred', label: 'Időablak', title: 'Egy vagy több idősáv, amelyben a foglalás lehetőleg (vagy csak abban) kezdődjön' },
          { value: 'fixed', label: 'Fix', title: 'Pontosan erre az időpontra' },
        ]}
      />
      {timing?.kind === 'fixed' && (
        <DateTimeInput
          ariaLabel="Időpont"
          value={toLocalInput(timing.start, tz)}
          onChange={(v) => {
            const iso = fromLocalInput(v, tz)
            if (iso) props.onChange({ kind: 'fixed', start: iso })
          }}
        />
      )}
      {timing?.kind === 'preferred' && (
        <button
          type="button"
          className={`btn btn-ghost btn-small timing-summary${timing.onlyWithin ? ' strict' : ''}`}
          title={`${timing.onlyWithin ? 'Csak ezekben az idősávokban kezdődhet' : 'Kezdési időablakok'}: ${summaryOf(timing.windows, weekStart, tz)} – szerkesztés`}
          onClick={() => setEditing(true)}
        >
          {timing.onlyWithin && <span className="timing-only">csak</span>}
          <span className="timing-text">{summaryOf(timing.windows, weekStart, tz)}</span>
        </button>
      )}
      {editing && (
        <TimeWindowsDialog
          initial={initialRows()}
          initialOnlyWithin={timing?.kind === 'preferred' && timing.onlyWithin === true}
          weekStart={weekStart}
          totalMinutes={totalMinutes}
          dayDefault={dayDefault}
          onCancel={() => setEditing(false)}
          onSave={(rows, onlyWithin) => {
            setEditing(false)
            const windows = windowsFromRows(rows, weekStart, tz)
            props.onChange(windows.length > 0 ? { kind: 'preferred', windows, ...(onlyWithin ? { onlyWithin: true } : {}) } : undefined)
          }}
        />
      )}
    </div>
  )
}

/**
 * Kis modális ablak az idősávokhoz; Esc vagy a háttérre kattintás bezárja mentés nélkül.
 * A pipával az ablakok kizáróvá válnak: azokon kívül a motor nem helyezi el az igényt.
 */
function TimeWindowsDialog(props: {
  initial: WindowRow[]
  initialOnlyWithin: boolean
  weekStart: LocalDate
  totalMinutes: number
  /** Az adott nap alapértelmezett kezdési sávja a munkaidőből; `undefined`, ha aznap nincs munka. */
  dayDefault: (date: LocalDate) => { from: string; to: string } | undefined
  onCancel: () => void
  onSave: (rows: readonly WindowRow[], onlyWithin: boolean) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [rows, setRows] = useState<WindowRow[]>(props.initial)
  const [onlyWithin, setOnlyWithin] = useState(props.initialOnlyWithin)
  const nextKey = useRef(Math.max(0, ...props.initial.map((r) => r.key)) + 1)

  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])

  const days = weekDates(props.weekStart)
  const dayOptions = [{ value: ANY_DAY, label: 'Bármely nap' }, ...days.map((d) => ({ value: d, label: dayLabel(d) }))]
  const errorOf = (r: WindowRow): string | undefined => {
    const from = toMinutes(r.from)
    const to = toMinutes(r.to)
    if (from === undefined || to === undefined) return 'Add meg mindkét időt.'
    if (to < from) return 'A legkésőbbi kezdés nem lehet a legkorábbi előtt.'
    return undefined
  }
  const hasError = rows.some((r) => errorOf(r) !== undefined)
  const update = (key: number, patch: Partial<WindowRow>): void => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  /** Napváltáskor a sáv a nap munkaidejéhez igazodik (ha aznap nincs munka, marad a régi). */
  const setDay = (key: number, day: WindowRow['day']): void => update(key, { day, ...(day === ANY_DAY ? {} : props.dayDefault(day)) })
  const add = (): void =>
    setRows((rs) => {
      const last = rs[rs.length - 1]
      const day = !last || last.day === ANY_DAY ? ANY_DAY : (days[days.indexOf(last.day) + 1] ?? last.day)
      const times = (day === ANY_DAY ? undefined : props.dayDefault(day)) ?? { from: last?.from ?? '09:00', to: last?.to ?? '12:00' }
      return [...rs, { key: nextKey.current++, day, ...times }]
    })

  return (
    <dialog
      ref={ref}
      className="timing-dialog"
      aria-labelledby="timing-dialog-title"
      onCancel={(e) => {
        e.preventDefault()
        props.onCancel()
      }}
      onClick={(e) => e.target === ref.current && props.onCancel()}
    >
      <form
        className="timing-dialog-body"
        onSubmit={(e) => {
          e.preventDefault()
          if (!hasError) props.onSave(rows, onlyWithin)
        }}
      >
        <strong id="timing-dialog-title">{onlyWithin ? 'Időablakok (csak ezeken belül)' : 'Időablakok'}</strong>
        <span className="muted small">
          Az idősáv a foglalás kezdetére vonatkozik (a foglalás {props.totalMinutes} perc).{' '}
          {onlyWithin
            ? 'Csak úgy helyezhető el, hogy valamelyik idősávban kezdődjön; ha ez nem lehet, dilemma lesz belőle.'
            : 'A motor úgy tervez, hogy valamelyik idősávban kezdődjön; ha ez nem lehet, máshová kerül.'}
        </span>
        {rows.length === 0 ? (
          <span className="muted small">Nincs időablak; mentéskor „Bármikor” lesz.</span>
        ) : (
          <ul className="timing-rows">
            <li className="timing-rows-head muted small" aria-hidden="true">
              <span>Nap</span>
              <span>Kezdés legkorábban – legkésőbb</span>
            </li>
            {rows.map((r, i) => {
              const error = errorOf(r)
              return (
                <li key={r.key}>
                  <div className="timing-row">
                    <select className="input" aria-label={`${i + 1}. ablak napja`} value={r.day} autoFocus={i === 0} onChange={(e) => setDay(r.key, e.target.value)}>
                      {dayOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input type="time" className="input" step={300} aria-label={`${i + 1}. ablak: legkorábbi kezdés`} value={r.from} onChange={(e) => update(r.key, { from: e.target.value })} />
                    <span aria-hidden="true">–</span>
                    <input type="time" className="input" step={300} aria-label={`${i + 1}. ablak: legkésőbbi kezdés`} value={r.to} onChange={(e) => update(r.key, { to: e.target.value })} />
                    <button type="button" className="btn btn-ghost btn-small" aria-label={`${i + 1}. ablak törlése`} title="Törlés" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      ✕
                    </button>
                  </div>
                  {error && <span className="error-text small">{error}</span>}
                </li>
              )
            })}
          </ul>
        )}
        <Checkbox checked={onlyWithin} onChange={setOnlyWithin} label="Csak ezeken belül helyezhető el" />
        <div className="timing-dialog-actions">
          <Button small variant="ghost" onClick={add}>
            + Időablak
          </Button>
          <span className="spacer" />
          <Button small variant="ghost" onClick={props.onCancel}>
            Mégse
          </Button>
          <Button small variant="primary" type="submit" disabled={hasError}>
            Mentés
          </Button>
        </div>
      </form>
    </dialog>
  )
}
