import type { LimitRule } from '../model/limits'

/** A limit-szabályok emberi nyelvű nevei (a felület és a motor üzenetei közösen használják). */

const WINDOW_LABELS: Record<string, string> = {
  calendarDay: 'naptári napon',
  calendarWeek: 'naptári héten',
  calendarYear: 'naptári évben',
  betweenDuties: 'két szolgálat között',
}

export const METRIC_LABELS: Record<LimitRule['metric'], string> = {
  flightTime: 'Repült (blokk-) idő',
  dutyTime: 'Szolgálati idő',
  restTime: 'Legrövidebb pihenőidő',
  taskCount: 'Feladatok (órák) száma',
}

export function windowLabel(w: LimitRule['window']): string {
  if (w.kind === 'rollingDays') return `${w.days} egymást követő napon`
  if (w.kind === 'rollingCalendarMonths') return `${w.months} naptári hónapban`
  return WINDOW_LABELS[w.kind] ?? w.kind
}

const SUBJECT_LABELS: Record<LimitRule['subject'], string> = { instructor: 'oktató', student: 'növendék' }

/** „oktató: szolgálati idő 7 egymást követő napon” alakú név. */
export function ruleLabel(rule: Pick<LimitRule, 'subject' | 'metric' | 'window'>): string {
  return `${SUBJECT_LABELS[rule.subject]}: ${METRIC_LABELS[rule.metric].toLowerCase()} ${windowLabel(rule.window)}`
}

const num = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',')

/** Az érték mértékegységgel: idő-mérőszámoknál óra, feladatszámnál darab. */
export function limitValueText(metric: LimitRule['metric'], value: number): string {
  return metric === 'taskCount' ? `${num(value)} db` : `${num(value)} óra`
}

/**
 * A limit-figyelmeztetés szövege (H23): olvasható név, mértékegység és az ablak vége.
 * Pihenőidőnél a legrövidebb pihenő és a megkövetelt minimum.
 */
export function limitMessage(
  rule: Pick<LimitRule, 'subject' | 'metric' | 'window'> | undefined,
  ruleId: string,
  value: number,
  limit: number,
  status: 'approach' | 'exceeded' | 'ok',
): string {
  const name = rule ? ruleLabel(rule) : ruleId
  const metric = rule?.metric ?? 'flightTime'
  if (metric === 'restTime') {
    return `Limit túllépés – ${name}: ${limitValueText(metric, value)} pihenő, legalább ${limitValueText(metric, limit)} kell`
  }
  const verb = status === 'exceeded' ? 'Limit túllépés' : 'Limit közelében'
  return `${verb} – ${name}: ${limitValueText(metric, value)} / ${limitValueText(metric, limit)}`
}
