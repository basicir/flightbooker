import { requestPriorityOf } from '@core/config/operations'
import type { Settings } from '@core/config/schema'
import type { BookingRequest } from '@core/model/planning'
import { Badge } from './ui'

/**
 * Az igény elsőbbsége (ELS-01): 1 a legfontosabb. A motor a fontosabb igényeket helyezi el előbb,
 * a kevésbé fontos nem veheti el a helyüket (ELS-02). Ellentétes irányú, mint a növendék
 * foglalási prioritása (NOV-12, ott az 5 a legfontosabb), ezért a felirat mindig kiírja.
 */

const LABELS: Readonly<Record<number, string>> = {
  1: '1 – legfontosabb',
  2: '2',
  3: '3',
  4: '4',
  5: '5 – legkevésbé fontos',
}

export const PRIORITY_HELP =
  'Elsőbbség (1 = először): a motor a fontosabb igényeket helyezi el előbb, a kevésbé fontos nem veheti el a helyüket. Azonos elsőbbségen belül a súlyok döntenek.'

/** Elsőbbség-választó egy igényhez. Az alapértékkel egyező választás az alapértékre állít vissza. */
export function PrioritySelect(props: { settings: Settings; request: BookingRequest; onChange: (priority: number | undefined) => void }) {
  const normal = props.settings.defaults.requestPriority
  const value = requestPriorityOf(props.settings, props.request)
  return (
    <label className="row small priority-select" title={PRIORITY_HELP}>
      <span className="muted small">Elsőbbség:</span>
      <select
        className="input"
        aria-label="Elsőbbség (1 = legfontosabb)"
        value={value}
        onChange={(e) => {
          const p = Number(e.target.value)
          props.onChange(p === normal ? undefined : p)
        }}
      >
        {[1, 2, 3, 4, 5].map((p) => (
          <option key={p} value={p}>
            {LABELS[p]}
            {p === normal ? ' (alap)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Jelvény a tervezeten és a listákon: csak az alapértéktől eltérő elsőbbségnél jelenik meg. */
export function PriorityBadge(props: { settings: Settings | null | undefined; request: BookingRequest | undefined }) {
  if (!props.settings || !props.request) return null
  const value = requestPriorityOf(props.settings, props.request)
  if (value === props.settings.defaults.requestPriority) return null
  return (
    <span title={PRIORITY_HELP}>
      <Badge tone={value > props.settings.defaults.requestPriority ? 'neutral' : 'info'}>{value}. elsőbbség</Badge>
    </span>
  )
}
