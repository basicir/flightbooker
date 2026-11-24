import { describe, expect, it } from 'vitest'
import { createSecretStore, SecretStoreError, type SecretStoreDeps } from '../../src/main/secretStore'

function fakeDeps(overrides: Partial<SecretStoreDeps> = {}) {
  let stored: Buffer | undefined
  const deps: SecretStoreDeps = {
    isEncryptionAvailable: () => true,
    backendName: () => undefined,
    // Szintetikus „titkosítás” a teszthez: megfordítja a bájtokat.
    encrypt: (plain) => Buffer.from(plain, 'utf8').reverse(),
    decrypt: (cipher) => Buffer.from(cipher).reverse().toString('utf8'),
    readFile: async () => stored,
    writeFile: async (data) => {
      stored = data
    },
    deleteFile: async () => {
      stored = undefined
    },
    ...overrides,
  }
  return { deps, stored: () => stored }
}

describe('API-kulcs tárolása (ALP-06)', () => {
  it('titkosítva ment, és visszaolvassa', async () => {
    const { deps, stored } = fakeDeps()
    const store = createSecretStore(deps)
    await store.saveApiKey('  szintetikus-kulcs  ')
    expect(stored()?.toString('utf8')).not.toContain('szintetikus-kulcs')
    await expect(store.loadApiKey()).resolves.toBe('szintetikus-kulcs')
    await store.clearApiKey()
    await expect(store.hasApiKey()).resolves.toBe(false)
  })

  it('titkosítás nélkül nem ment', async () => {
    const store = createSecretStore(fakeDeps({ isEncryptionAvailable: () => false }).deps)
    await expect(store.saveApiKey('k')).rejects.toThrow(SecretStoreError)
  })

  it('a basic_text háttérrel nem ment', async () => {
    const store = createSecretStore(fakeDeps({ backendName: () => 'basic_text' }).deps)
    await expect(store.saveApiKey('k')).rejects.toThrow(SecretStoreError)
  })

  it('üres vagy szóközt tartalmazó kulcsot elutasít', async () => {
    const store = createSecretStore(fakeDeps().deps)
    await expect(store.saveApiKey('   ')).rejects.toThrow(SecretStoreError)
    await expect(store.saveApiKey('a b')).rejects.toThrow(SecretStoreError)
  })

  it('visszafejtési hibánál nem szivárogtat adatot', async () => {
    const { deps } = fakeDeps({
      decrypt: () => {
        throw new Error('belső részlet')
      },
    })
    const store = createSecretStore(deps)
    await store.saveApiKey('k')
    await expect(store.loadApiKey()).rejects.toThrow('A tárolt kulcs nem fejthető vissza; add meg újra.')
  })
})
