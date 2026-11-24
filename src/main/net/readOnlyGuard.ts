import { Kind, parse, type DocumentNode, type OperationDefinitionNode } from 'graphql'

/**
 * Csak olvasás (ALP-03). A FlightLogger API foglalást is tud létrehozni és törölni,
 * csak olvasható kulcs nincs, ezért a zárat a kliensnek kell garantálnia.
 *
 * Elfogadott: pontosan egy `query` művelet, opcionálisan fragmentekkel.
 * Elutasított: mutation, subscription, több művelet, sémadefiníció, elemezhetetlen szöveg.
 */
export class ReadOnlyViolationError extends Error {
  override readonly name = 'ReadOnlyViolationError'
}

export function assertReadOnlyQuery(source: unknown): DocumentNode {
  if (typeof source !== 'string' || source.trim() === '') {
    throw new ReadOnlyViolationError('A lekérdezés üres vagy nem szöveg, nem küldhető el.')
  }

  let document: DocumentNode
  try {
    document = parse(source)
  } catch {
    throw new ReadOnlyViolationError('A lekérdezés nem elemezhető, ezért nem küldhető el.')
  }

  const operations: OperationDefinitionNode[] = []
  for (const definition of document.definitions) {
    if (definition.kind === Kind.OPERATION_DEFINITION) {
      operations.push(definition)
    } else if (definition.kind !== Kind.FRAGMENT_DEFINITION) {
      throw new ReadOnlyViolationError(`Nem engedett GraphQL-definíció: ${definition.kind}.`)
    }
  }

  if (operations.length !== 1) {
    throw new ReadOnlyViolationError(`Pontosan egy műveletet kell küldeni, ${operations.length} érkezett.`)
  }

  const [operation] = operations as [OperationDefinitionNode]
  if (operation.operation !== 'query') {
    throw new ReadOnlyViolationError(
      `A FlightLogger felé csak olvasó lekérdezés mehet, „${operation.operation}” művelet nem.`,
    )
  }

  return document
}

/**
 * A HTTP-kérés törzsének ellenőrzése: az allowedFetch ezzel vizsgálja a
 * FlightLogger felé menő minden kérést, akkor is, ha valaki a kliens megkerülésével hívná.
 */
export function assertReadOnlyRequestBody(body: unknown): void {
  if (typeof body !== 'string') {
    throw new ReadOnlyViolationError('A FlightLogger-kérés törzse csak JSON szöveg lehet.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new ReadOnlyViolationError('A FlightLogger-kérés törzse nem érvényes JSON.')
  }
  if (Array.isArray(parsed)) {
    throw new ReadOnlyViolationError('Kötegelt (batch) GraphQL-kérés nem engedett.')
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ReadOnlyViolationError('A FlightLogger-kérés törzse nem objektum.')
  }
  const allowedKeys = new Set(['query', 'variables', 'operationName'])
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      throw new ReadOnlyViolationError(`Ismeretlen mező a kérés törzsében: ${key}.`)
    }
  }
  assertReadOnlyQuery((parsed as { query?: unknown }).query)
}
