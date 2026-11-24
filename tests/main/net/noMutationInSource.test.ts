import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { Kind, parse } from 'graphql'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * ALP-03: a forrásban (src/, tools/) sehol nincs GraphQL mutation vagy subscription.
 * Minden szöveg- és sablonliterált megvizsgálunk: ami GraphQL-ként elemezhető,
 * abban csak query lehet; ami mutation/subscription kulcsszóval kezdődik, az tilos.
 * A tesztfájlok kimaradnak, mert azok szándékosan tartalmaznak tiltott példákat.
 */
const ROOT = join(__dirname, '../../..')
const SCANNED = ['src', 'tools']

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return listSourceFiles(full)
    return /\.(ts|tsx|mts|cts)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : []
  })
}

function collectLiterals(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const literals: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text)
    } else if (ts.isTemplateExpression(node)) {
      // A behelyettesítéseket semleges szövegre cseréljük, így a sablon szerkezete elemezhető marad.
      literals.push(node.head.text + node.templateSpans.map((span) => ' ' + span.literal.text).join(''))
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return literals
}

function violation(text: string): string | undefined {
  if (/^\s*(mutation|subscription)\b/.test(text)) return 'mutation/subscription kulcsszóval kezdődik'
  try {
    const document = parse(text)
    for (const definition of document.definitions) {
      if (definition.kind === Kind.OPERATION_DEFINITION && definition.operation !== 'query') {
        return `${definition.operation} művelet`
      }
    }
  } catch {
    // Nem GraphQL szöveg.
  }
  return undefined
}

describe('a forrásban nincs írási művelet (ALP-03)', () => {
  const files = SCANNED.flatMap((dir) => listSourceFiles(join(ROOT, dir)))

  it('van mit átvizsgálni', () => {
    expect(files.length).toBeGreaterThan(5)
  })

  it('egyetlen literál sem tartalmaz mutation-t vagy subscription-t', () => {
    const findings = files.flatMap((file) =>
      collectLiterals(file)
        .map((text) => ({ text, reason: violation(text) }))
        .filter((f) => f.reason)
        .map((f) => `${relative(ROOT, file)}: ${f.reason}: ${f.text.slice(0, 60)}`),
    )
    expect(findings).toEqual([])
  })

  it('a vizsgálat valóban felismeri a mutation-t', () => {
    expect(violation('mutation { deleteBookings(ids: ["1"]) }')).toBeDefined()
    expect(violation('  subscription S { a }')).toBeDefined()
    expect(violation('query A { a }')).toBeUndefined()
  })
})
