import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HELP, SCREEN_HELP, SETTINGS_TAB_HELP, SETUP_STEP_HELP, type HelpBlock } from '../../src/renderer/src/help/helpContent'
import { allSections, findSection, normalize, parseInline, searchHelp } from '../../src/renderer/src/help/helpText'

const blockTexts = (b: HelpBlock): string[] =>
  b.kind === 'list' || b.kind === 'steps' ? [...b.items] : b.kind === 'table' ? [...b.head, ...b.rows.flat()] : [b.text]

describe('súgó tartalma', () => {
  const sections = allSections(HELP)

  it('minden szakasz-azonosító egyedi', () => {
    const ids = sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('minden belső hivatkozás létező szakaszra mutat', () => {
    const broken: string[] = []
    for (const s of sections) {
      for (const text of s.blocks.flatMap(blockTexts)) {
        for (const part of parseInline(text)) {
          if (part.kind === 'link' && !findSection(HELP, part.target)) broken.push(`${s.id} → ${part.target}`)
        }
      }
    }
    expect(broken).toEqual([])
  })

  it('minden képernyőnek, beállítási fülnek és beállítási lépésnek van súgószakasza', () => {
    for (const id of [...Object.values(SCREEN_HELP), ...Object.values(SETTINGS_TAB_HELP), ...SETUP_STEP_HELP]) {
      expect(findSection(HELP, id), id).not.toBeNull()
    }
    expect(Object.keys(SETTINGS_TAB_HELP)).toHaveLength(12)
    expect(SETUP_STEP_HELP).toHaveLength(7)
  })

  it('a fotóbeolvasó gombot a felületen használt néven említi', () => {
    const label = 'Karbantartási táblázat beolvasása fotóról'
    const card = readFileSync('src/renderer/src/components/aircraftHoursCard.tsx', 'utf8')
    expect(card).toContain(`'${label}'`)
    const text = findSection(HELP, 'kirepulheto-ido')!.section.blocks.flatMap(blockTexts).join(' ')
    expect(text).toContain(`**${label}**`)
    expect(JSON.stringify(HELP)).not.toContain('Fotó beolvasása')
  })
})

describe('szövegközi jelölések', () => {
  it('felirat, billentyű és hivatkozás', () => {
    expect(parseInline('Nyomd meg a **Mentés** gombot vagy az [[Enter]]-t, lásd [Gépek](#b-gepek).')).toEqual([
      { kind: 'text', text: 'Nyomd meg a ' },
      { kind: 'ui', text: 'Mentés' },
      { kind: 'text', text: ' gombot vagy az ' },
      { kind: 'key', text: 'Enter' },
      { kind: 'text', text: '-t, lásd ' },
      { kind: 'link', text: 'Gépek', target: 'b-gepek' },
      { kind: 'text', text: '.' },
    ])
  })
})

describe('keresés a súgóban', () => {
  it('ékezet és kisbetű nélkül is talál', () => {
    expect(normalize('Dilemma-KÜSZÖB')).toBe('dilemma-kuszob')
    // A kifejezést egyben tartalmazó szakaszok előzik a csak a szavakat tartalmazókat.
    const ids = searchHelp(HELP, 'dilemma kuszob').map((h) => h.section.id)
    expect(ids.indexOf('b-tervezes')).toBeLessThan(ids.indexOf('indito'))
  })

  it('a címben találtak kerülnek előre, a kivonat a találat környéke', () => {
    const hits = searchHelp(HELP, 'meteogram')
    expect(hits[0]!.section.id).toBe('meteogram')
    const photo = searchHelp(HELP, 'karbantartási táblázat fotó')
    expect(photo.map((h) => h.section.id)).toContain('kirepulheto-ido')
    expect(normalize(photo.find((h) => h.section.id === 'kirepulheto-ido')!.snippet)).toContain('karbantartasi')
  })

  it('üres keresésre nincs találat', () => {
    expect(searchHelp(HELP, '   ')).toEqual([])
  })
})
