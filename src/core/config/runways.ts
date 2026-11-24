/**
 * Pályairányok kezelése (7.4, oldalszél). Egy fizikai pályának két iránya van: ha az egyiket
 * megadják, az ellentétes irány a jelöléssel és a valós (földrajzi) iránnyal együtt magától
 * kitöltődik (például 04 / 041° → 22 / 221°).
 */

export interface Runway {
  readonly designator: string
  readonly trueHeadingDeg: number
}

const SIDE_SWAP: Readonly<Record<string, string>> = { L: 'R', R: 'L', C: 'C', '': '' }

/** Érvényes pályajel: 01–36, opcionális L/C/R. */
export function isRunwayDesignator(designator: string): boolean {
  return /^(0[1-9]|[12]\d|3[0-6])[LCR]?$/.test(designator)
}

/** Az ellentétes irány jele: 04 → 22, 36 → 18, 09L → 27R. */
export function reciprocalDesignator(designator: string): string | undefined {
  if (!isRunwayDesignator(designator)) return undefined
  const m = /^(\d{2})([LCR]?)$/.exec(designator)!
  const n = Number(m[1])
  const r = ((n + 18 - 1) % 36) + 1
  return `${String(r).padStart(2, '0')}${SIDE_SWAP[m[2]!]}`
}

/** Az ellentétes irány valós iránya fokban, 0 ≤ x < 360. */
export function reciprocalHeading(heading: number): number {
  return Math.round((((heading + 180) % 360) + 360) % 360 * 10) / 10
}

/** A jelből becsült irány (mágneses, tízesre kerekítve); csak kiinduló érték. */
export function headingFromDesignator(designator: string): number | undefined {
  if (!isRunwayDesignator(designator)) return undefined
  const n = Number(designator.slice(0, 2))
  return n === 36 ? 0 : n * 10
}

/**
 * Egy pályairány módosítása a párjával együtt. Új, érvényes jelnél, ha még nincs megadva
 * irány, a jelből becsült irányt tölti be; a pár (ellentétes irány) jele és iránya mindig
 * ehhez igazodik, és ha még nincs a listában, bekerül.
 */
export function updateRunway(runways: readonly Runway[], index: number, patch: Partial<Runway>): Runway[] {
  const current = runways[index]
  if (!current) return [...runways]
  const oldPair = reciprocalDesignator(current.designator)
  let next: Runway = { ...current, ...patch }
  if (patch.designator !== undefined && patch.trueHeadingDeg === undefined && current.trueHeadingDeg === 0) {
    const guess = headingFromDesignator(next.designator)
    if (guess !== undefined) next = { ...next, trueHeadingDeg: guess }
  }
  const list = runways.map((r, i) => (i === index ? next : r))
  const pair = reciprocalDesignator(next.designator)
  if (!pair) return list
  const pairRunway: Runway = { designator: pair, trueHeadingDeg: reciprocalHeading(next.trueHeadingDeg) }
  const pairIndex = list.findIndex((r, i) => i !== index && (r.designator === pair || (oldPair !== undefined && r.designator === oldPair)))
  if (pairIndex >= 0) return list.map((r, i) => (i === pairIndex ? pairRunway : r))
  // Az üres sort használjuk, ha van; különben a pár a módosított irány után kerül.
  const emptyIndex = list.findIndex((r, i) => i !== index && r.designator === '')
  if (emptyIndex >= 0) return list.map((r, i) => (i === emptyIndex ? pairRunway : r))
  return [...list.slice(0, index + 1), pairRunway, ...list.slice(index + 1)]
}

/** Egy pályairány törlése a párjával együtt. */
export function removeRunway(runways: readonly Runway[], index: number): Runway[] {
  const current = runways[index]
  if (!current) return [...runways]
  const pair = reciprocalDesignator(current.designator)
  return runways.filter((r, i) => i !== index && (pair === undefined || r.designator !== pair))
}
