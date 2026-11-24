import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { createSecretStore, type SecretStore } from './secretStore'

/**
 * Titok tárolása az Electron safeStorage-dzsal: a FlightLogger API-kulcs (ALP-06), a DEV-ben a
 * kiadás GitHub-tokenje is (FRS-09), külön fájlban.
 */
export function createElectronSecretStore(fileName = 'flightlogger-key.secret'): SecretStore {
  const file = join(app.getPath('userData'), fileName)
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
