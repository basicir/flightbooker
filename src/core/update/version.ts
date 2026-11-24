/**
 * Verziók és frissítési csatornák (FRS-01, FRS-05).
 *
 * - Fő kiadás (`stable`, a `main` ágról): `X.Y.Z`, címke `vX.Y.Z`.
 * - Fejlesztői kiadás (`dev`, a `dev` ágról): `X.Y.Z-dev.N`, címke `vX.Y.Z-dev.N`.
 * A két csatorna külön alkalmazás, mindegyik csak a saját csatornája kiadásait nézi.
 */

export type UpdateChannel = 'stable' | 'dev'

export interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  /** A fejlesztői kiadás sorszáma; fő kiadásnál nincs. */
  readonly dev?: number
}

const VERSION = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:-dev\.(\d{1,6}))?$/

export function parseVersion(text: string): ParsedVersion | null {
  const m = VERSION.exec(text)
  if (!m) return null
  const [, major, minor, patch, dev] = m
  const base = { major: Number(major), minor: Number(minor), patch: Number(patch) }
  return dev === undefined ? base : { ...base, dev: Number(dev) }
}

export function formatVersion(v: ParsedVersion): string {
  const base = `${v.major}.${v.minor}.${v.patch}`
  return v.dev === undefined ? base : `${base}-dev.${v.dev}`
}

/** Semver szerinti összevetés: a `-dev.N` előzetes kiadás kisebb, mint ugyanaz a fő verzió. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  if (a.patch !== b.patch) return a.patch - b.patch
  if (a.dev === undefined && b.dev === undefined) return 0
  if (a.dev === undefined) return 1
  if (b.dev === undefined) return -1
  return a.dev - b.dev
}

export function versionChannel(v: ParsedVersion): UpdateChannel {
  return v.dev === undefined ? 'stable' : 'dev'
}

export const tagForVersion = (version: string): string => `v${version}`

/** A kiadás címkéjéből a verzió, ha a címke a mi formátumunk. */
export function versionFromTag(tag: string): ParsedVersion | null {
  return tag.startsWith('v') ? parseVersion(tag.slice(1)) : null
}
