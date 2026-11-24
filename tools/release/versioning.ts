import { compareVersions, formatVersion, parseVersion, versionChannel, versionFromTag, type ParsedVersion, type UpdateChannel } from '../../src/core/update/version'

/**
 * A következő kiadás verziója (FRS-05), a meglévő címkékből – kézi verzióléptetés nélkül.
 *
 * - Fő kiadás: a package.json `X.Y.Z` verziója az alsó határ; ha már van ennél nem kisebb fő
 *   kiadás, a legnagyobb javítószáma +1. (A package.json-ban a fő/alverzió kézzel emelhető.)
 * - Fejlesztői kiadás: a következő fő kiadás verziója `-dev.N` utótaggal, ahol N az eddigi
 *   legnagyobb fejlesztői sorszám +1. Így minden új dev-kiadás nagyobb az előzőnél.
 */

export interface NextVersionInput {
  readonly packageVersion: string
  readonly tags: readonly string[]
  readonly channel: UpdateChannel
}

export interface NextVersion {
  readonly version: string
  readonly tag: string
  /** Ugyanazon csatorna előző kiadásának címkéje (a kiadási jegyzethez), ha van. */
  readonly previousTag: string | null
}

const max = (versions: readonly ParsedVersion[]): ParsedVersion | null =>
  versions.reduce<ParsedVersion | null>((best, v) => (!best || compareVersions(v, best) > 0 ? v : best), null)

export function nextReleaseVersion(input: NextVersionInput): NextVersion {
  const base = parseVersion(input.packageVersion)
  if (!base || base.dev !== undefined) throw new Error(`A package.json verziója X.Y.Z alakú legyen, nem: ${input.packageVersion}`)
  const parsed = input.tags.map(versionFromTag).filter((v): v is ParsedVersion => v !== null)
  const stable = parsed.filter((v) => versionChannel(v) === 'stable')
  const dev = parsed.filter((v) => versionChannel(v) === 'dev')
  const latestStable = max(stable)
  const bumped = latestStable ? { major: latestStable.major, minor: latestStable.minor, patch: latestStable.patch + 1 } : null
  const nextStable = bumped && compareVersions(bumped, base) > 0 ? bumped : base

  if (input.channel === 'stable') {
    const version = formatVersion(nextStable)
    return { version, tag: `v${version}`, previousTag: latestStable ? `v${formatVersion(latestStable)}` : null }
  }
  const latestDev = max(dev)
  const devNumber = Math.max(0, ...dev.map((v) => v.dev ?? 0)) + 1
  const version = formatVersion({ ...nextStable, dev: devNumber })
  return { version, tag: `v${version}`, previousTag: latestDev ? `v${formatVersion(latestDev)}` : null }
}
