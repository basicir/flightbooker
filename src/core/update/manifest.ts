import { z } from 'zod'
import { parseVersion, type UpdateChannel } from './version'

/**
 * A kiadás aláírt leírása (FRS-04): melyik fájl melyik gépre való, mekkora, és mi a SHA-512
 * lenyomata. A kiadási folyamat Ed25519-kulccsal aláírja, a program a beépített nyilvános
 * kulccsal ellenőrzi, mielőtt bármit telepítene. A borítékban a leírás szövegként van, mert
 * az aláírás pontosan ezekre a bájtokra vonatkozik.
 */

export const MANIFEST_ASSET = 'update-manifest.json'
export const MANIFEST_APP = 'flightbooker'
/** A leírás felső mérethatára letöltéskor. */
export const MAX_MANIFEST_BYTES = 64 * 1024

export const ManifestEnvelopeSchema = z.object({
  format: z.literal(1),
  payload: z.string().min(2).max(MAX_MANIFEST_BYTES),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
})
export type ManifestEnvelope = z.infer<typeof ManifestEnvelopeSchema>

export const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/

export const ManifestAssetSchema = z.object({
  platform: z.enum(['darwin', 'win32']),
  arch: z.enum(['arm64', 'x64']),
  /** zip: macOS-frissítés; dmg: macOS első telepítés; nsis: Windows-telepítő. */
  kind: z.enum(['zip', 'dmg', 'nsis']),
  name: z.string().regex(ASSET_NAME),
  size: z.number().int().positive().max(2_000_000_000),
  sha512: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
})
export type ManifestAsset = z.infer<typeof ManifestAssetSchema>

/** Ismeretlen mezőt elhagy (nem utasít el), hogy a későbbi bővítés ne törje el a régi példányokat. */
export const ManifestSchema = z.object({
  app: z.literal(MANIFEST_APP),
  channel: z.enum(['stable', 'dev']),
  version: z.string().refine((v) => parseVersion(v) !== null, 'Érvénytelen verzió.'),
  createdAt: z.string(),
  commit: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  assets: z.array(ManifestAssetSchema).min(1).max(20),
})
export type Manifest = z.infer<typeof ManifestSchema>

/**
 * A géphez illő frissítőfájl: macOS-en az architektúrának megfelelő zip, Windowson az NSIS-
 * telepítő (ARM-es Windowson is az x64-es, emulációval fut).
 */
export function selectInstallAsset(manifest: Manifest, platform: string, arch: string): ManifestAsset | null {
  if (platform === 'darwin') return manifest.assets.find((a) => a.platform === 'darwin' && a.kind === 'zip' && a.arch === arch) ?? null
  if (platform === 'win32') {
    const nsis = manifest.assets.filter((a) => a.platform === 'win32' && a.kind === 'nsis')
    return nsis.find((a) => a.arch === arch) ?? nsis.find((a) => a.arch === 'x64') ?? null
  }
  return null
}

/** A leírás a várt csatornára és verzióra szól-e. Üres lista: rendben. */
export function manifestProblems(manifest: Manifest, expected: { readonly channel: UpdateChannel; readonly version: string }): string[] {
  const problems: string[] = []
  if (manifest.channel !== expected.channel) problems.push(`A leírás a(z) ${manifest.channel} csatornára szól, nem a(z) ${expected.channel} csatornára.`)
  if (manifest.version !== expected.version) problems.push(`A leírás verziója (${manifest.version}) nem egyezik a kiadáséval (${expected.version}).`)
  const names = manifest.assets.map((a) => a.name)
  if (new Set(names).size !== names.length) problems.push('A leírásban kétszer szerepel ugyanaz a fájl.')
  return problems
}
