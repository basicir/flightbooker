import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { ManifestEnvelopeSchema, ManifestSchema, type Manifest } from '../../core/update/manifest'
import { UpdateError } from './updaterCore'

/**
 * A kiadás leírásának ellenőrzése (FRS-04): Ed25519-aláírás a programba épített nyilvános
 * kulcsok valamelyikével. Aláírás nélküli vagy hamis leírás alapján semmi nem települ.
 */
export function createManifestVerifier(publicKeysPem: readonly string[]): (text: string) => Manifest {
  const keys: KeyObject[] = publicKeysPem.map((pem) => createPublicKey(pem))
  if (keys.some((k) => k.asymmetricKeyType !== 'ed25519')) throw new Error('A frissítés nyilvános kulcsa csak Ed25519 lehet.')
  return (text) => {
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new UpdateError('A kiadás leírása nem olvasható.')
    }
    const envelope = ManifestEnvelopeSchema.safeParse(json)
    if (!envelope.success) throw new UpdateError('A kiadás leírása nem a várt formátumú.')
    const payload = Buffer.from(envelope.data.payload, 'utf8')
    const signature = Buffer.from(envelope.data.signature, 'base64')
    if (!keys.some((key) => verify(null, payload, key, signature))) {
      throw new UpdateError('A kiadás aláírása érvénytelen, ezért a frissítést nem telepítem.')
    }
    let inner: unknown
    try {
      inner = JSON.parse(envelope.data.payload)
    } catch {
      throw new UpdateError('A kiadás leírása nem olvasható.')
    }
    const manifest = ManifestSchema.safeParse(inner)
    if (!manifest.success) throw new UpdateError('A kiadás leírása nem a várt formátumú.')
    return manifest.data
  }
}

export const sha512Base64 = (data: Uint8Array): string => createHash('sha512').update(data).digest('base64')
