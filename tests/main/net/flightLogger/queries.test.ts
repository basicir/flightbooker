import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildSchema, Kind, parse, validate } from 'graphql'
import { describe, expect, it } from 'vitest'
import { ALL_QUERIES } from '../../../../src/main/net/flightLogger/queries'

const SCHEMA_PATH = join(__dirname, '../../../../docs/schema.graphql')

describe('rögzített FlightLogger-lekérdezések', () => {
  it.each(ALL_QUERIES.map((q) => [q.name, q] as const))('%s: egyetlen query művelet, a nevével', (name, query) => {
    const document = parse(query.source)
    const operations = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION)
    expect(operations).toHaveLength(1)
    expect(operations[0]!.operation).toBe('query')
    expect(operations[0]!.name?.value).toBe(name)
  })

  it('a lekérdezések nevei egyediek', () => {
    const names = ALL_QUERIES.map((q) => q.name)
    expect(new Set(names).size).toBe(names.length)
  })

  // A séma a felderítés után kerül a docs/schema.graphql-be; addig ez a teszt kimarad.
  it.skipIf(!existsSync(SCHEMA_PATH))('mind érvényes a FlightLogger sémája szerint', () => {
    const schema = buildSchema(readFileSync(SCHEMA_PATH, 'utf8'))
    for (const query of ALL_QUERIES) {
      expect(validate(schema, parse(query.source)).map((e) => `${query.name}: ${e.message}`)).toEqual([])
    }
  })
})
