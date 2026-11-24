/**
 * A kiadás aláírt leírásának elkészítése (FRS-04). A GitHub Actions a kész fájlok mellé futtatja:
 *
 *   UPDATE_SIGNING_KEY=… npx tsx tools/release/manifest.ts --channel dev --version 0.1.1-dev.3 --dir dist --commit <sha>
 *
 * A titkos kulcs (Ed25519, PEM) csak környezeti változóban jöhet, fájlba és naplóba nem kerül.
 * Aláírás után a programba épített nyilvános kulccsal vissza is ellenőrzi: ha a GitHub-titok és
 * a beépített kulcs nem pár, a kiadás itt megáll, és nem jelenik meg használhatatlan frissítés.
 */
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { MANIFEST_APP, MANIFEST_ASSET, ManifestSchema, type Manifest, type ManifestAsset } from '../../src/core/update/manifest'
import { parseVersion } from '../../src/core/update/version'
import publicKeys from '../../src/main/update/update-public-keys.json'
import { classifyAsset } from './channels'

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    version: { type: 'string' },
    dir: { type: 'string' },
    commit: { type: 'string' },
  },
})
const channel = values.channel
if (channel !== 'stable' && channel !== 'dev') throw new Error('--channel stable|dev kell.')
const version = values.version ?? ''
if (!parseVersion(version)) throw new Error(`Érvénytelen verzió: ${version}`)
const dir = values.dir ?? 'dist'
const keyPem = process.env['UPDATE_SIGNING_KEY']
if (!keyPem) throw new Error('Hiányzik az UPDATE_SIGNING_KEY (a GitHub-repó titka).')

const assets: ManifestAsset[] = []
for (const name of readdirSync(dir).sort()) {
  if (name === MANIFEST_ASSET) continue
  const role = classifyAsset(name, channel, version)
  if (!role) throw new Error(`Ismeretlen fájl a kiadásban: ${name}`)
  const data = readFileSync(join(dir, name))
  assets.push({ ...role, name, size: statSync(join(dir, name)).size, sha512: createHash('sha512').update(data).digest('base64') })
}
for (const required of [
  { platform: 'darwin', arch: 'arm64', kind: 'zip' },
  { platform: 'darwin', arch: 'x64', kind: 'zip' },
  { platform: 'win32', arch: 'x64', kind: 'nsis' },
] as const) {
  if (!assets.some((a) => a.platform === required.platform && a.arch === required.arch && a.kind === required.kind)) {
    throw new Error(`Hiányzik a kiadásból: ${required.platform} ${required.arch} ${required.kind}`)
  }
}

const manifest: Manifest = ManifestSchema.parse({
  app: MANIFEST_APP,
  channel,
  version,
  createdAt: new Date().toISOString(),
  ...(values.commit ? { commit: values.commit } : {}),
  assets,
})
const payload = JSON.stringify(manifest)
const privateKey = createPrivateKey(keyPem)
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('Az aláírókulcs csak Ed25519 lehet.')
const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey)
if (!publicKeys.keys.some((pem) => verify(null, Buffer.from(payload, 'utf8'), createPublicKey(pem), signature))) {
  throw new Error('Az aláírás nem ellenőrizhető a programba épített nyilvános kulccsal: az UPDATE_SIGNING_KEY nem a src/main/update/update-public-keys.json párja.')
}
writeFileSync(join(dir, MANIFEST_ASSET), `${JSON.stringify({ format: 1, payload, signature: signature.toString('base64') }, null, 2)}\n`)
process.stdout.write(`${MANIFEST_ASSET}: ${assets.length} fájl, ${channel} ${version}\n`)
