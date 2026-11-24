import { assertReadOnlyQuery } from '../readOnlyGuard'

declare const persistedQueryBrand: unique symbol

/**
 * Rögzített, csak olvasó lekérdezés. Csak a `defineQuery` hozhat létre ilyet,
 * ezért a kliens tetszőleges szöveget nem tud elküldeni. A guard már modulbetöltéskor
 * lefut, így egy hibás lekérdezés az alkalmazás indulásakor kiderül.
 */
export interface PersistedQuery<TData, TVariables extends Record<string, unknown> = Record<string, never>> {
  readonly [persistedQueryBrand]: true
  readonly name: string
  readonly source: string
  /** Csak típusinformáció, futáskor nincs értéke. */
  readonly __types?: { data: TData; variables: TVariables }
}

export function defineQuery<TData, TVariables extends Record<string, unknown> = Record<string, never>>(
  name: string,
  source: string,
): PersistedQuery<TData, TVariables> {
  assertReadOnlyQuery(source)
  return Object.freeze({ name, source }) as PersistedQuery<TData, TVariables>
}

export type QueryData<Q> = Q extends PersistedQuery<infer D, Record<string, unknown>> ? D : never
export type QueryVariables<Q> = Q extends PersistedQuery<unknown, infer V> ? V : never
