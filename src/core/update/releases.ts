import { z } from 'zod'
import { MANIFEST_ASSET } from './manifest'
import { compareVersions, formatVersion, parseVersion, versionChannel, versionFromTag, type UpdateChannel } from './version'

/**
 * A GitHub kiadáslistájából a csatorna legújabb, a futónál újabb kiadása (FRS-01, FRS-05).
 * Vázlat, idegen formátumú címke és aláírt leírás nélküli (félbemaradt) kiadás nem számít.
 */

const ReleaseAssetSchema = z.object({
  name: z.string(),
  size: z.number(),
  browser_download_url: z.string(),
})

const ReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  html_url: z.string(),
  published_at: z.string().nullable().optional(),
  assets: z.array(ReleaseAssetSchema),
})

export const ReleaseListSchema = z.array(ReleaseSchema).max(200)
export type ReleaseList = z.infer<typeof ReleaseListSchema>
export type Release = z.infer<typeof ReleaseSchema>
export type ReleaseAsset = z.infer<typeof ReleaseAssetSchema>

export interface ReleaseCandidate {
  readonly release: Release
  readonly version: string
  readonly manifestAsset: ReleaseAsset
}

export function pickLatestRelease(releases: ReleaseList, channel: UpdateChannel, currentVersion: string): ReleaseCandidate | null {
  const current = parseVersion(currentVersion)
  let best: { release: Release; parsed: NonNullable<ReturnType<typeof parseVersion>>; manifestAsset: ReleaseAsset } | null = null
  for (const release of releases) {
    if (release.draft) continue
    const parsed = versionFromTag(release.tag_name)
    if (!parsed || versionChannel(parsed) !== channel) continue
    // A fejlesztői kiadás előzetes (prerelease), a fő kiadás nem.
    if (release.prerelease !== (channel === 'dev')) continue
    const manifestAsset = release.assets.find((a) => a.name === MANIFEST_ASSET)
    if (!manifestAsset) continue
    if (!best || compareVersions(parsed, best.parsed) > 0) best = { release, parsed, manifestAsset }
  }
  if (!best) return null
  // Ismeretlen saját verziónál (pl. kézi build) nem frissítünk magától.
  if (!current || compareVersions(best.parsed, current) <= 0) return null
  return { release: best.release, version: formatVersion(best.parsed), manifestAsset: best.manifestAsset }
}
