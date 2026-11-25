import { useState, type ReactNode } from 'react'

/**
 * Az igény űrlapjának két része: a tervezéshez szükséges mezők kiemelve („Tervezéshez”), a csak a
 * FlightLogger-foglalásba kerülő mezők (típus, program, komment …) egy lenyitható „Egyéb” részben. A lenyitható rész
 * fejléce egyértelműen kattintható (nyíl, kiemelés), és összecsukva is mutatja, mi van
 * megadva és mi hiányzik.
 */

export function PlanFields(props: { children: ReactNode; title?: string }) {
  return (
    <div className="plan-fields">
      <span className="plan-fields-title">{props.title ?? 'Tervezéshez'}</span>
      {props.children}
    </div>
  )
}

/**
 * Egy mező a FlightLogger-részben: balra a címke, jobbra a mező (és a tipp). `missing`: a
 * FlightLogger-import ezt az adatot várja, de nincs megadva – a címke mellett „kell” jelzés.
 */
export function FlField(props: { label: string; missing?: boolean; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="fl-field">
      <span className={`fl-field-label${props.missing ? ' missing' : ''}`}>
        {props.label}
        {props.missing && <span className="fl-field-required">kell</span>}
      </span>
      <div className="fl-field-control">
        {props.children}
        {props.hint ? <span className="small muted">{props.hint}</span> : null}
      </div>
    </div>
  )
}

export function FlOnlySection(props: { summary?: ReactNode; missing?: readonly string[]; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const missing = props.missing ?? []
  return (
    <details className="fl-only" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <svg className="fl-only-chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="fl-only-head">
          <span className="fl-only-heading">
            <span className="fl-only-title">Egyéb</span>
            <span className="fl-only-note">a FlightLogger-foglalás adatai – a tervet nem befolyásolják</span>
          </span>
          {!open && (props.summary || missing.length > 0) && (
            <span className="fl-only-values">
              {props.summary ? <span className="fl-only-summary">{props.summary}</span> : null}
              {missing.length > 0 ? <span className="fl-only-missing">hiányzik: {missing.join(', ')}</span> : null}
            </span>
          )}
        </span>
      </summary>
      <div className="fl-only-body">{props.children}</div>
    </details>
  )
}
