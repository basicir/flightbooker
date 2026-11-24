import { describe, expect, it } from 'vitest'
import {
  assertReadOnlyQuery,
  assertReadOnlyRequestBody,
  ReadOnlyViolationError,
} from '../../../src/main/net/readOnlyGuard'

const CREATE_BOOKING = `
  mutation CreateBooking($input: SingleStudentBookingInput!) {
    createSingleStudentBooking(input: $input) { id }
  }
`
const DELETE_BOOKINGS = `mutation { deleteBookings(ids: ["1", "2"]) }`

describe('readOnlyGuard (ALP-03)', () => {
  it('elfogadja a nevesített és a rövidített query-t', () => {
    expect(() => assertReadOnlyQuery('query A { aircraft { nodes { id } } }')).not.toThrow()
    expect(() => assertReadOnlyQuery('{ aircraft { nodes { id } } }')).not.toThrow()
  })

  it('elfogadja a fragmenteket egyetlen query mellett', () => {
    const source = 'query A { aircraft { nodes { ...F } } } fragment F on Aircraft { id }'
    expect(() => assertReadOnlyQuery(source)).not.toThrow()
  })

  it.each([
    ['createSingleStudentBooking', CREATE_BOOKING],
    ['deleteBookings', DELETE_BOOKINGS],
    ['subscription', 'subscription S { bookings { id } }'],
    ['query mellé csempészett mutation', `query A { aircraft { nodes { id } } } ${DELETE_BOOKINGS}`],
    ['két query', 'query A { a } query B { b }'],
    ['sémadefiníció', 'type Query { a: String }'],
    ['elemezhetetlen szöveg', 'mutation {'],
    ['üres szöveg', '   '],
  ])('elutasítja: %s', (_label, source) => {
    expect(() => assertReadOnlyQuery(source)).toThrow(ReadOnlyViolationError)
  })

  it('nem szöveg bemenetet elutasít', () => {
    expect(() => assertReadOnlyQuery(undefined)).toThrow(ReadOnlyViolationError)
    expect(() => assertReadOnlyQuery({ query: 'query { a }' })).toThrow(ReadOnlyViolationError)
  })
})

describe('a kéréstörzs ellenőrzése', () => {
  const body = (value: unknown): string => JSON.stringify(value)

  it('elfogadja a query-t változókkal és műveletnévvel', () => {
    expect(() => assertReadOnlyRequestBody(body({ query: 'query A { a }', variables: {}, operationName: 'A' }))).not.toThrow()
  })

  it('elutasítja a mutation-t a törzsben', () => {
    expect(() => assertReadOnlyRequestBody(body({ query: DELETE_BOOKINGS }))).toThrow(ReadOnlyViolationError)
  })

  it('elutasítja a kötegelt kérést', () => {
    expect(() => assertReadOnlyRequestBody(body([{ query: 'query A { a }' }]))).toThrow(ReadOnlyViolationError)
  })

  it('elutasítja az ismeretlen mezőt (pl. tárolt lekérdezés hash-sel)', () => {
    const apq = { extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } }
    expect(() => assertReadOnlyRequestBody(body(apq))).toThrow(ReadOnlyViolationError)
    expect(() => assertReadOnlyRequestBody(body({ query: 'query A { a }', extensions: {} }))).toThrow(ReadOnlyViolationError)
  })

  it('elutasítja a nem JSON vagy nem szöveg törzset', () => {
    expect(() => assertReadOnlyRequestBody('query A { a }')).toThrow(ReadOnlyViolationError)
    expect(() => assertReadOnlyRequestBody(undefined)).toThrow(ReadOnlyViolationError)
  })
})
