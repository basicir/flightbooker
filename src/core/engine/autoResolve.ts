import type { Decision, DilemmaType } from '../model/planning'
import { plan, type PlanInput } from './plan'

/**
 * „A többit döntse el a rendszer” (9.3, H13). A döntések után új dilemmák keletkezhetnek
 * (a vesztes a következő helyén újra versenyezhet), ezért a gomb addig ismétli magát, amíg
 * van automatikusan eldönthető dilemma. A fix ütközés kézi marad: ott érv nélkül halasztana el
 * egy fix időpontú igényt; a figyelmeztetéses és a „nincs hely” dilemma is az oktatóé.
 */

export const AUTO_RESOLVABLE: ReadonlySet<DilemmaType> = new Set(['competition', 'standby'])

/** A döntés megjelölése: a tervezet és a döntéslista külön jelzi (mindhárom döntéstípusnál). */
export function markAuto(d: Decision): Decision {
  switch (d.kind) {
    case 'assign':
    case 'standby':
    case 'defer':
    case 'noStandby':
    case 'teamOff':
      return { ...d, auto: true }
    default:
      return d
  }
}

/** Az automatikusan hozott döntések, sorrendben; a bemenet döntései után kell őket fűzni. */
export function autoResolveDecisions(input: PlanInput, maxRounds = 25): Decision[] {
  const added: Decision[] = []
  for (let round = 0; round < maxRounds; round++) {
    const result = plan({ ...input, decisions: [...input.decisions, ...added] })
    const next = result.dilemmas
      .filter((d) => AUTO_RESOLVABLE.has(d.type))
      .flatMap((d) => {
        const o = d.options.find((x) => x.id === d.recommendedOptionId)
        return o ? [o.decision, ...(o.also ?? [])] : []
      })
      .map(markAuto)
    if (next.length === 0) break
    added.push(...next)
  }
  return added
}
