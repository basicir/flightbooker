import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { createSecretStore, type SecretStore } from './secretStore'

/** Az API-kulcs titkosított tárolása az Electron safeStorage-dzsal (ALP-06). */
export function createElectronSecretStore(): SecretStore {
  const file = join(app.getPath('userData'), 'flightlogger-key.secret')
  return createSecretStore({
    isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
    backendName: () => (process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined),
    encrypt: (plain) => safeStorage.encryptString(plain),
    decrypt: (cipher) => safeStorage.decryptString(cipher),
    readFile: async () => {
      try {
        return await readFile(file)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
      }
    },
    writeFile: (data) => writeFile(file, data, { mode: 0o600 }),
    deleteFile: () => rm(file, { force: true }),
  })
}
