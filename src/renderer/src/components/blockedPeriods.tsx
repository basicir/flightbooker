import { isOngoingBlock, onceBlock, pruneBlockedPeriods, sortBlockedPeriods, weeklyBlocks } from '@core/config/blockedPeriods'
import type { BlockedPeriod, Settings } from '@core/config/schema'
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '@core/model/time'
import { localParts, toMs } from '@core/time/zoned'
import { useState } from 'react'
import { dateLabel, dayLabel, hhmm } from '../format'
import { useNow } from '../state'
import { Badge, Button, DateInput, TextInput } from './ui'

/**
 * Tiltott időszakok szerkesztője (SZB-14, K35): az oktató „nem érek rá” időszakai. Ismétlődő
 * (több nap egyszerre, egész nap vagy idősáv, érvényességgel) vagy eseti (egy vagy több nap). Az
 * elmúlt időszakok nem jelennek meg és mentéskor törlődnek.
 */

const SHORT: Readonly<Record<Weekday, string>> = { mon: 'H', tue: 'K', wed: 'Sze', thu: 'Cs', fri: 'P', sat: 'Szo', sun: 'V' }

type Mode = 'weekly' | 'once'

const newId = (): string => `tilt-${Date.now().toString(36)}`

export function BlockedPeriodsEditor(props: { settings: Settings; onChange: (s: Settings) => void }) {
  const { settings } = props
  const tz = settings.airport?.timezone ?? 'Europe/Budapest'
  const nowMs = useNow()
  // Az elmúlt időszak nem foglal helyet: a lista és a mentés is nélküle megy.
  const current = pruneBlockedPeriods(settings, nowMs)
  const list = sortBlockedPeriods(current.instructor.blockedPeriods)
  const weekly = list.filter((p) => p.kind === 'weekly')
  const once = list.filter((p) => p.kind === 'once')
  const setPeriods = (periods: readonly BlockedPeriod[]): void =>
    props.onChange({ ...current, instructor: { ...current.instructor, blockedPeriods: [...periods] } })
  const remove = (id: string): void => setPeriods(current.instructor.blockedPeriods.filter((p) => p.id !== id))

  const [adding, setAdding] = useState<Mode | null>(null)

  /** Az ismétlődő időszakok napcsoportonként: ugyanaz az idősáv, érvényesség és megjegyzés egy sorban. */
  const groups = new Map<string, BlockedPeriod[]>()
  for (const p of weekly) {
    if (p.kind !== 'weekly') continue
    const key = [p.start, p.end, p.validFrom ?? '', p.validTo ?? '', p.note ?? ''].join('|')
    groups.set(key, [...(groups.get(key) ?? []), p])
  }

  return (
    <div className="blocked">
      {list.length === 0 && !adding && <p className="small muted">Nincs tiltott időszak: a motor a munkaidőn belül bárhová tervezhet.</p>}

      {groups.size > 0 && (
        <section className="blocked-section">
          <h4 className="blocked-heading">Ismétlődő</h4>
          <ul className="blocked-list">
            {[...groups.values()].map((items) => {
              const p = items[0]!
              if (p.kind !== 'weekly') return null
              const allDay = p.start === '00:00' && p.end === '23:59'
              const validity = [p.validFrom ? `${dateLabel(p.validFrom)}-tól` : '', p.validTo ? `${dateLabel(p.validTo)}-ig` : ''].filter(Boolean).join(' ')
              return (
                <li key={items.map((x) => x.id).join(',')} className="blocked-item">
                  <span className="blocked-days" aria-label={items.map((x) => (x.kind === 'weekly' ? WEEKDAY_LABELS[x.weekday] : '')).join(', ')}>
                    {WEEKDAYS.map((d) => (
                      <span key={d} className={items.some((x) => x.kind === 'weekly' && x.weekday === d) ? 'day-dot on' : 'day-dot'}>
                        {SHORT[d]}
                      </span>
                    ))}
                  </span>
                  <span className="blocked-when">
                    <strong>{allDay ? 'egész nap' : `${p.start}–${p.end}`}</strong>
                    {validity && <span className="small muted"> · {validity}</span>}
                    {p.note && <span className="blocked-note">{p.note}</span>}
                  </span>
                  <span className="blocked-actions">
                    {items.length > 1 &&
                      items.map((x) =>
                        x.kind === 'weekly' ? (
                          <button key={x.id} type="button" className="chip-x" title={`Csak a(z) ${WEEKDAY_LABELS[x.weekday]} törlése`} aria-label={`${WEEKDAY_LABELS[x.weekday]} törlése`} onClick={() => remove(x.id)}>
                            {SHORT[x.weekday]} ×
                          </button>
                        ) : null,
                      )}
                    <Button small variant="ghost" onClick={() => setPeriods(current.instructor.blockedPeriods.filter((x) => !items.some((y) => y.id === x.id)))}>
                      Törlés
                    </Button>
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {once.length > 0 && (
        <section className="blocked-section">
          <h4 className="blocked-heading">Eseti</h4>
          <ul className="blocked-list">
            {once.map((p) => (p.kind === 'once' ? <OnceRow key={p.id} p={p} tz={tz} nowMs={nowMs} onRemove={() => remove(p.id)} /> : null))}
          </ul>
        </section>
      )}

      {adding ? (
        <AddForm
          mode={adding}
          setMode={setAdding}
          tz={tz}
          nowMs={nowMs}
          onCancel={() => setAdding(null)}
          onAdd={(periods) => {
            setPeriods([...current.instructor.blockedPeriods, ...periods])
            setAdding(null)
          }}
        />
      ) : (
        <div className="row">
          <Button small onClick={() => setAdding('once')}>
            + Eseti időszak
          </Button>
          <Button small onClick={() => setAdding('weekly')}>
            + Ismétlődő időszak
          </Button>
        </div>
      )}
      <p className="field-hint">A motor ide soha nem tesz foglalást; kézi mozgatásnál figyelmeztet. Az elmúlt időszakok maguktól törlődnek.</p>
    </div>
  )
}

function OnceRow(props: { p: Extract<BlockedPeriod, { kind: 'once' }>; tz: string; nowMs: number; onRemove: () => void }) {
  const { p, tz } = props
  const s = localParts(toMs(p.start), tz)
  const e = localParts(toMs(p.end), tz)
  // Az egész napos időszak vége a következő nap 00:00-ja: kiírásban az utolsó nap.
  const allDay = s.minutes === 0 && e.minutes === 0
  const lastDay = allDay ? localParts(toMs(p.end) - 60_000, tz).date : e.date
  const when = allDay
    ? s.date === lastDay
      ? `${dayLabel(s.date)}, egész nap`
      : `${dayLabel(s.date)} – ${dayLabel(lastDay)}, egész nap`
    : s.date === e.date
      ? `${dayLabel(s.date)} ${hhmm(s.minutes)}–${hhmm(e.minutes)}`
      : `${dayLabel(s.date)} ${hhmm(s.minutes)} – ${dayLabel(e.date)} ${hhmm(e.minutes)}`
  return (
    <li className="blocked-item">
      <span className="blocked-icon" aria-hidden="true">
        ⦸
      </span>
      <span className="blocked-when">
        <strong>{when}</strong> {isOngoingBlock(p, props.nowMs) && <Badge tone="warn">most tart</Badge>}
        {p.note && <span className="blocked-note">{p.note}</span>}
      </span>
      <span className="blocked-actions">
        <Button small variant="ghost" onClick={props.onRemove}>
          Törlés
        </Button>
      </span>
    </li>
  )
}

function AddForm(props: { mode: Mode; setMode: (m: Mode) => void; tz: string; nowMs: number; onCancel: () => void; onAdd: (periods: BlockedPeriod[]) => void }) {
  const today = localParts(props.nowMs, props.tz).date
  const [days, setDays] = useState<Weekday[]>([])
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [allDay, setAllDay] = useState(false)
  const [start, setStart] = useState('08:00')
  const [end, setEnd] = useState('12:00')
  const [validFrom, setValidFrom] = useState('')
  const [validTo, setValidTo] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (): void => {
    const result =
      props.mode === 'weekly'
        ? weeklyBlocks({ weekdays: days, allDay, start, end, validFrom: validFrom || undefined, validTo: validTo || undefined, note, idBase: newId() })
        : onceBlock({ startDate, endDate, allDay, start, end, note, idBase: newId(), tz: props.tz, nowMs: Date.now() })
    if (!result.ok) {
      setError(result.error)
      return
    }
    props.onAdd(result.periods)
  }

  return (
    <div className="blocked-form" role="group" aria-label="Új tiltott időszak">
      <div className="segmented" role="radiogroup" aria-label="Fajta">
        {(['once', 'weekly'] as const).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={props.mode === m} className={props.mode === m ? 'active' : undefined} onClick={() => props.setMode(m)}>
            {m === 'once' ? 'Eseti' : 'Ismétlődő'}
          </button>
        ))}
      </div>

      {props.mode === 'weekly' ? (
        <div className="blocked-form-row">
          <span className="blocked-label">Napok</span>
          <span className="day-picker" role="group" aria-label="Napok">
            {WEEKDAYS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                title={WEEKDAY_LABELS[d]}
                className={days.includes(d) ? 'day-toggle on' : 'day-toggle'}
                onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}
              >
                {SHORT[d]}
              </button>
            ))}
            <button type="button" className="link-button small" onClick={() => setDays(['mon', 'tue', 'wed', 'thu', 'fri'])}>
              hétköznap
            </button>
          </span>
        </div>
      ) : (
        <div className="blocked-form-row">
          <span className="blocked-label">Nap</span>
          <span className="row">
            <DateInput ariaLabel="Kezdő nap" value={startDate} onChange={(v) => {
              setStartDate(v)
              if (!endDate || endDate < v) setEndDate(v)
            }} />
            <span className="muted">–</span>
            <DateInput ariaLabel="Utolsó nap" value={endDate} onChange={setEndDate} />
          </span>
        </div>
      )}

      <div className="blocked-form-row">
        <span className="blocked-label">Idő</span>
        <span className="row">
          <label className="check">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> egész nap
          </label>
          {!allDay && (
            <>
              <input type="time" className="input" aria-label="Kezdés" value={start} onChange={(e) => setStart(e.target.value)} />
              <span className="muted">–</span>
              <input type="time" className="input" aria-label="Vége" value={end} onChange={(e) => setEnd(e.target.value)} />
            </>
          )}
        </span>
      </div>
      {props.mode === 'once' && !allDay && startDate !== endDate && <p className="field-hint">Egyben: a kezdő nap kezdési idejétől az utolsó nap záró idejéig.</p>}

      {props.mode === 'weekly' && (
        <div className="blocked-form-row">
          <span className="blocked-label">Érvényes</span>
          <span className="row">
            <DateInput ariaLabel="Érvényesség kezdete" value={validFrom} onChange={setValidFrom} />
            <span className="muted">–</span>
            <DateInput ariaLabel="Érvényesség vége" value={validTo} onChange={setValidTo} />
            <span className="small muted">üresen: mindig</span>
          </span>
        </div>
      )}

      <div className="blocked-form-row">
        <span className="blocked-label">Megjegyzés</span>
        <TextInput value={note} onChange={setNote} placeholder="például egyetem, orvos" ariaLabel="Megjegyzés" maxLength={500} />
      </div>

      {error && <p className="error-text">{error}</p>}
      <div className="row">
        <Button small variant="primary" onClick={submit}>
          Hozzáadás
        </Button>
        <Button small variant="ghost" onClick={props.onCancel}>
          Mégsem
        </Button>
      </div>
    </div>
  )
}
