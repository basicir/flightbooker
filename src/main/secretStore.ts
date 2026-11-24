/**
 * API-kulcs tárolása (ALP-06), Electron nélkül tesztelhető mag.
 * A kulcs csak az operációs rendszer titkosításával (Keychain / Windows DPAPI)
 * kerül lemezre, külön fájlba; a beállítási fájl soha nem tartalmazza.
 */
export interface SecretStoreDeps {
  isEncryptionAvailable(): boolean
  /** Linuxon a „basic_text” háttér nem valódi titkosítás; ott megtagadjuk a tárolást. */
  backendName(): string | undefined
  encrypt(plain: string): Buffer
  decrypt(cipher: Buffer): string
  readFile(): Promise<Buffer | undefined>
  writeFile(data: Buffer): Promise<void>
  deleteFile(): Promise<void>
}

export class SecretStoreError extends Error {
  override readonly name = 'SecretStoreError'
}

export interface SecretStore {
  hasApiKey(): Promise<boolean>
  saveApiKey(key: string): Promise<void>
  loadApiKey(): Promise<string | undefined>
  clearApiKey(): Promise<void>
}

export function createSecretStore(deps: SecretStoreDeps): SecretStore {
  const ensureSecureBackend = (): void => {
    if (!deps.isEncryptionAvailable()) {
      throw new SecretStoreError('Az operációs rendszer titkosítása nem érhető el, a kulcs nem tárolható.')
    }
    if (deps.backendName() === 'basic_text') {
      throw new SecretStoreError('A rendszer titoktárolója nem biztonságos (basic_text), a kulcs nem tárolható.')
    }
  }

  return {
    async hasApiKey() {
      return (await deps.readFile()) !== undefined
    },
    async saveApiKey(key) {
      const trimmed = key.trim()
      if (trimmed === '') throw new SecretStoreError('Üres kulcs nem menthető.')
      if (/\s/.test(trimmed)) throw new SecretStoreError('A kulcs nem tartalmazhat szóközt vagy sortörést.')
      ensureSecureBackend()
      await deps.writeFile(deps.encrypt(trimmed))
    },
    async loadApiKey() {
      const data = await deps.readFile()
      if (data === undefined) return undefined
      ensureSecureBackend()
      try {
        return deps.decrypt(data)
      } catch {
        // A hibaüzenet szándékosan nem tartalmaz semmit a titkosított adatból.
        throw new SecretStoreError('A tárolt kulcs nem fejthető vissza; add meg újra.')
      }
    },
    async clearApiKey() {
      await deps.deleteFile()
    },
  }
}
