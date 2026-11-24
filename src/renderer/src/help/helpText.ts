import type { HelpBlock, HelpChapter, HelpSection } from './helpContent'

/** A súgószöveg egy darabja a szövegközi jelölések (`**…**`, `[…](#…)`, `[[…]]`) feldolgozása után. */
export type InlinePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'ui'; readonly text: string }
  | { readonly kind: 'link'; readonly text: string; readonly target: string }
  | { readonly kind: 'key'; readonly text: string }

const INLINE = /\*\*(.+?)\*\*|\[\[(.+?)\]\]|\[([^\]]+)\]\(#([\w-]+)\)/g

export function parseInline(source: string): InlinePart[] {
  const parts: InlinePart[] = []
  let last = 0
  for (const m of source.matchAll(INLINE)) {
    const at = m.index
    if (at > last) parts.push({ kind: 'text', text: source.slice(last, at) })
    if (m[1] !== undefined) parts.push({ kind: 'ui', text: m[1] })
    else if (m[2] !== undefined) parts.push({ kind: 'key', text: m[2] })
    else parts.push({ kind: 'link', text: m[3]!, target: m[4]! })
    last = at + m[0].length
  }
  if (last < source.length) parts.push({ kind: 'text', text: source.slice(last) })
  return parts
}

/** A jelölések nélküli, olvasható szöveg (kereséshez, kivonathoz). */
export function plainText(source: string): string {
  return parseInline(source)
    .map((p) => p.text)
    .join('')
}

function blockStrings(block: HelpBlock): string[] {
  switch (block.kind) {
    case 'p':
    case 'note':
    case 'h':
      return [block.text]
    case 'list':
    case 'steps':
      return [...block.items]
    case 'table':
      return [...block.head, ...block.rows.flat()]
  }
}

/** A szakasz összes szövege jelölések nélkül, blokkonként/soronként. */
export function sectionStrings(section: HelpSection): string[] {
  return section.blocks.flatMap(blockStrings).map(plainText)
}

/** Kis- és nagybetű, valamint ékezet nélküli alak: „kuszob” is megtalálja a „küszöb”-öt. */
export function normalize(s: string): string {
  return s
    .toLocaleLowerCase('hu')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export interface HelpHit {
  readonly section: HelpSection
  readonly chapter: HelpChapter
  /** Rövid részlet a találat környékéről; a cím találatánál üres. */
  readonly snippet: string
}

/**
 * Keresés a súgóban: minden szónak (ékezettől függetlenül) szerepelnie kell a szakasz címében
 * vagy szövegében. Előre kerül, ahol a szavak a címben vannak, ahol a kifejezés egyben szerepel
 * (a kötőjel szóköznek számít: „dilemma kuszob” = „dilemma-küszöb”), és ahol egy mondatban mind.
 */
export function searchHelp(chapters: readonly HelpChapter[], query: string): HelpHit[] {
  const words = searchForm(query).split(/\s+/).filter((w) => w.length > 0)
  if (words.length === 0) return []
  const phrase = words.join(' ')
  const hits: Array<HelpHit & { readonly rank: number }> = []
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      const title = searchForm(section.title)
      const lines = sectionStrings(section)
      const forms = lines.map(searchForm)
      const body = forms.join(' ')
      if (!words.every((w) => title.includes(w) || body.includes(w))) continue
      const allInLine = forms.findIndex((f) => words.every((w) => f.includes(w)))
      const withPhrase = forms.findIndex((f) => f.includes(phrase))
      const rank =
        10 * words.filter((w) => title.includes(w)).length +
        (title.includes(phrase) ? 10 : 0) +
        (withPhrase >= 0 ? 5 : 0) +
        (allInLine >= 0 ? 3 : 0)
      const best = withPhrase >= 0 ? withPhrase : allInLine >= 0 ? allInLine : forms.findIndex((f) => f.includes(words[0]!))
      hits.push({ section, chapter, snippet: best >= 0 ? snippetAround(lines[best]!, words[0]!) : '', rank })
    }
  }
  // A rendezés stabil: azonos pontszámnál a súgó sorrendje marad.
  return hits.sort((a, b) => b.rank - a.rank).map(({ section, chapter, snippet }) => ({ section, chapter, snippet }))
}

/** Keresési alak: a `normalize`-on túl a kötőjel szóköz, a többszörös szóköz egy. */
function searchForm(s: string): string {
  return normalize(s).replace(/-/g, ' ').replace(/\s+/g, ' ')
}

function snippetAround(line: string, word: string): string {
  if (!line) return ''
  const at = normalize(line).indexOf(word)
  const radius = 70
  const start = Math.max(0, at - radius)
  const end = Math.min(line.length, at + word.length + radius)
  return `${start > 0 ? '…' : ''}${line.slice(start, end).trim()}${end < line.length ? '…' : ''}`
}

export function findSection(chapters: readonly HelpChapter[], id: string): { section: HelpSection; chapter: HelpChapter } | null {
  for (const chapter of chapters) {
    const section = chapter.sections.find((s) => s.id === id)
    if (section) return { section, chapter }
  }
  return null
}

/** Az összes szakasz olvasási sorrendben (előző/következő lapozáshoz). */
export function allSections(chapters: readonly HelpChapter[]): HelpSection[] {
  return chapters.flatMap((c) => c.sections)
}
