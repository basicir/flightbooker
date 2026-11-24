import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { RefreshProgress } from '../../../shared/api'

/** Egyszerű, akadálymentes alapelemek. */

export function Button(props: {
  children: ReactNode
  onClick?: () => void
  /** `defer`: halasztás (enyhén piros kiemelés, minden helyen ugyanígy). */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'defer'
  disabled?: boolean
  type?: 'button' | 'submit'
  title?: string
  small?: boolean
}) {
  return (
    <button
      type={props.type ?? 'button'}
      className={`btn btn-${props.variant ?? 'secondary'}${props.small ? ' btn-small' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
    >
      {props.children}
    </button>
  )
}

export function Field(props: { label: string; hint?: string; children: ReactNode; error?: string | undefined }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
      {props.error && <span className="field-error">{props.error}</span>}
    </label>
  )
}

/**
 * Számmező. Szerkesztés közben a beírt szöveget mutatja, nem a szülő értékét: így az utolsó
 * számjegy (például egy 0) is kitörölhető, akkor is, ha a szülő üres mezőnél alapértéket
 * állít be. Kilépéskor a mező a ténylegesen beállított értéket mutatja.
 */
export function NumberInput(props: { value: number | undefined; onChange: (v: number | undefined) => void; min?: number; max?: number; step?: number; placeholder?: string; width?: number; ariaLabel?: string; disabled?: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const shown = editing ?? (props.value === undefined ? '' : String(props.value))
  return (
    <input
      type="number"
      className="input"
      style={props.width ? { width: props.width } : undefined}
      value={shown}
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      disabled={props.disabled}
      onFocus={() => setEditing(shown)}
      onBlur={() => setEditing(null)}
      onChange={(e) => {
        const text = e.target.value
        setEditing(text)
        if (text.trim() === '') props.onChange(undefined)
        else {
          const n = Number(text)
          if (Number.isFinite(n)) props.onChange(n)
        }
      }}
    />
  )
}

/** Dátum és idő; az év legfeljebb négy számjegy (a böngésző alapból hatot is enged). */
export function DateTimeInput(props: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return <input type="datetime-local" className="input" min="1900-01-01T00:00" max="9999-12-31T23:59" aria-label={props.ariaLabel} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
}

/** Dátum; az év legfeljebb négy számjegy. */
export function DateInput(props: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  return <input type="date" className="input" min="1900-01-01" max="9999-12-31" aria-label={props.ariaLabel} value={props.value} onChange={(e) => props.onChange(e.target.value)} />
}

/** Szövegmező; a tervezetbe kerülő szövegek 500 karakterig érvényesek (H14), ezért ott `maxLength`. */
export function TextInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string; ariaLabel?: string; width?: number; maxLength?: number }) {
  return (
    <input
      type={props.type ?? 'text'}
      className="input"
      style={props.width ? { width: props.width } : undefined}
      value={props.value}
      placeholder={props.placeholder}
      aria-label={props.ariaLabel}
      maxLength={props.maxLength}
      onChange={(e) => props.onChange(e.target.value)}
    />
  )
}

export function Select<T extends string>(props: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: string }>; ariaLabel?: string }) {
  return (
    <select className="input" value={props.value} aria-label={props.ariaLabel} onChange={(e) => props.onChange(e.target.value as T)}>
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Checkbox(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} />
      <span>{props.label}</span>
    </label>
  )
}

export function Badge(props: { children: ReactNode; tone?: 'neutral' | 'info' | 'warn' | 'danger' | 'ok' }) {
  return <span className={`badge badge-${props.tone ?? 'neutral'}`}>{props.children}</span>
}

export function Card(props: { title?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={`card ${props.className ?? ''}`}>
      {(props.title || props.actions) && (
        <header className="card-header">
          {props.title && <h3>{props.title}</h3>}
          {props.actions && <div className="card-actions">{props.actions}</div>}
        </header>
      )}
      {props.children}
    </section>
  )
}

export function Empty(props: { children: ReactNode }) {
  return <p className="empty">{props.children}</p>
}

export function PageHeader(props: { title: string; lead?: ReactNode; actions?: ReactNode; week?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <div className="page-title">
          <h1>{props.title}</h1>
          {props.week}
        </div>
        {props.lead && <p className="lead">{props.lead}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </header>
  )
}

export function ErrorList(props: { errors: readonly string[] }) {
  if (props.errors.length === 0) return null
  return (
    <ul className="error-list" role="alert">
      {props.errors.map((e) => (
        <li key={e}>{e}</li>
      ))}
    </ul>
  )
}

/** Az adatfrissítés állása egy sorban (az oldalsávhoz). */
export function progressSummary(p: RefreshProgress | null): string {
  if (!p || p.total === 0) return 'kapcsolódás…'
  return `${p.done}/${p.total} rész kész`
}

/**
 * Áttetsző, blokkoló töltő réteg az adatfrissítés idejére: a felület mögötte látszik, de
 * nem kezelhető (a tartalom `inert`), így félkész adattal nem lehet dolgozni.
 */
export function LoadingOverlay(props: { title: string; progress: RefreshProgress | null; onCancel?: () => void }) {
  const p = props.progress
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : 0
  return (
    <div className="loading-overlay" role="alertdialog" aria-modal="true" aria-busy="true" aria-labelledby="loading-title">
      <div className="loading-panel" aria-live="polite">
        <div className="loading-head">
          <span className="spinner" aria-hidden="true" />
          <strong id="loading-title">{props.title}</strong>
        </div>
        <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="progress-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
        </div>
        <span className="small">{p && p.stage ? `Folyamatban: ${p.stage}` : p && p.total > 0 && p.done === p.total ? 'Feldolgozás…' : 'Kapcsolódás a FlightLoggerhez…'}</span>
        {p && (
          <span className="muted small">
            {progressSummary(p)} · {p.requests} kérés
            {p.waitedSeconds > 0 && ` · ${p.waitedSeconds} mp várakozás a FlightLogger kéréskorlátja miatt`}
          </span>
        )}
        {props.onCancel && (
          <button type="button" className="btn btn-ghost btn-small" onClick={props.onCancel}>
            Megszakítás
          </button>
        )}
      </div>
    </div>
  )
}

/** Szegmentált kapcsoló néhány kizáró lehetőséghez (egy kattintás, nincs lenyíló lista). */
export function Segmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: ReactNode; title?: string; disabled?: boolean }>; ariaLabel: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.ariaLabel}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          className={o.value === props.value ? 'active' : undefined}
          title={o.title}
          disabled={o.disabled}
          onClick={() => o.value !== props.value && props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Modális párbeszédablak (natív `<dialog>`): fókuszcsapda és Esc a böngészőtől. Csak nyitott
 * állapotban kell megjeleníteni; bezáráskor (Esc vagy gomb) az `onClose` hívódik.
 */
/**
 * Modális dialógus. `focusSelf`: megnyitáskor maga a dialógus kapja a fókuszt, ne az első
 * vezérlője (ahol az első vezérlő kiemelése zavaró és fölösleges, például választók listájánál).
 */
export function Dialog(props: { title: string; children: ReactNode; actions: ReactNode; onClose: () => void; className?: string; focusSelf?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const focusSelf = props.focusSelf === true
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) {
      d.showModal()
      if (focusSelf) d.focus()
    }
  }, [focusSelf])
  return (
    <dialog
      ref={ref}
      className={props.className ? `dialog ${props.className}` : 'dialog'}
      aria-labelledby={titleId}
      onClose={props.onClose}
      {...(focusSelf ? { tabIndex: -1 } : {})}
    >
      <div className="dialog-body">
        <h2 id={titleId}>{props.title}</h2>
        {props.children}
        <div className="dialog-actions">{props.actions}</div>
      </div>
    </dialog>
  )
}

/** Választás néhány lehetőség közül, lehetőségenként címmel és magyarázattal (rádiógombok). */
export function ChoiceList<T extends string>(props: { name: string; value: T; onChange: (v: T) => void; options: ReadonlyArray<{ value: T; label: ReactNode; hint?: ReactNode }> }) {
  return (
    <div className="choice-list" role="radiogroup">
      {props.options.map((o) => (
        <label key={o.value} className={o.value === props.value ? 'choice active' : 'choice'}>
          <input type="radio" name={props.name} checked={o.value === props.value} onChange={() => props.onChange(o.value)} />
          <span className="choice-text">
            <span className="choice-label">{o.label}</span>
            {o.hint && <span className="choice-hint">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  )
}
