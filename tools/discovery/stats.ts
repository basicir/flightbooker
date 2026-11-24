/** Névtelen összesítő segédfüggvények a felderítő jelentéshez. Csak számokat és enumokat adnak vissza. */

export type Counts = Record<string, number>

export function countBy<T>(items: readonly T[], key: (item: T) => string | null | undefined): Counts {
  const counts: Counts = {}
  for (const item of items) {
    const k = key(item) ?? '(üres)'
    counts[k] = (counts[k] ?? 0) + 1
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
}

/** Arány 0 és 1 között; üres listánál null. */
export function ratio<T>(items: readonly T[], predicate: (item: T) => boolean): number | null {
  if (items.length === 0) return null
  return items.filter(predicate).length / items.length
}

export interface Distribution {
  readonly n: number
  readonly min: number | null
  readonly median: number | null
  readonly max: number | null
}

export function distribution(values: readonly number[]): Distribution {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (sorted.length === 0) return { n: 0, min: null, median: null, max: null }
  const mid = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
  return { n: sorted.length, min: sorted[0]!, median, max: sorted[sorted.length - 1]! }
}

export function minutesBetween(fromIso: string | undefined | null, toIso: string | undefined | null): number | null {
  if (!fromIso || !toIso) return null
  const a = Date.parse(fromIso)
  const b = Date.parse(toIso)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((b - a) / 60000)
}

export function formatRatio(value: number | null): string {
  return value === null ? '–' : `${Math.round(value * 1000) / 10}%`
}

export function formatNumber(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–'
  return Number.isInteger(value) ? String(value) : value.toFixed(digits)
}

export function formatCounts(counts: Counts): string {
  const entries = Object.entries(counts)
  return entries.length === 0 ? '–' : entries.map(([k, v]) => `${k}: ${v}`).join(', ')
}

export function formatDistribution(d: Distribution, unit = ''): string {
  if (d.n === 0) return '–'
  return `${formatNumber(d.min)}${unit} / ${formatNumber(d.median)}${unit} / ${formatNumber(d.max)}${unit} (n=${d.n})`
}

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/**
 * Utolsó védővonal: a jelentés szövegéből kitakarja a kulcsot, az e-mail-címeket és
 * a memóriában látott neveket, kommenteket. Visszaadja a kitakarások számát is.
 */
export function redactSensitive(text: string, secrets: Iterable<string>): { text: string; redactions: number } {
  let redactions = 0
  let result = text.replace(EMAIL, () => {
    redactions++
    return '[e-mail kitakarva]'
  })
  const unique = [...new Set([...secrets].map((s) => s.trim()).filter((s) => s.length >= 3))].sort(
    (a, b) => b.length - a.length,
  )
  for (const secret of unique) {
    // Csak egész szóként takarunk ki, hogy például egy „Type” hívójel ne vágja szét a
    // „TypeQuestionnaireBooking” típusnevet.
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, 'gu')
    result = result.replace(pattern, () => {
      redactions++
      return '[kitakarva]'
    })
  }
  return { text: result, redactions }
}
