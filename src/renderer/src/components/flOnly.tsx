import type { ReactNode } from 'react'

/**
 * Az igény űrlapjának két része: a tervezéshez szükséges mezők kiemelve, a csak a FlightLogger-
 * foglalásba kerülő mezők (típus, program, komment …) összecsukva és halványan. Az összecsukott
 * rész fejléce mutatja, mi van megadva és mi hiányzik, így nyitás nélkül is látszik.
 */

export function PlanFields(props: { children: ReactNode; title?: string }) {
  return (
    <div className="plan-fields">
      <span className="plan-fields-title">{props.title ?? 'Tervezéshez'}</span>
      {props.children}
    </div>
  )
}

export function FlOnlySection(props: { summary?: ReactNode; missing?: readonly string[]; children: ReactNode }) {
  return (
    <details className="fl-only">
      <summary>
        <span className="fl-only-title">FlightLoggerbe</span>
        <span className="fl-only-note">nem hat a tervre</span>
        {props.summary ? <span className="fl-only-summary">{props.summary}</span> : null}
        {props.missing && props.missing.length > 0 ? <span className="fl-only-missing">hiányzik: {props.missing.join(', ')}</span> : null}
      </summary>
      <div className="fl-only-body">{props.children}</div>
    </details>
  )
}
