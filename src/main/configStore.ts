import { copyFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { SETTINGS_FILE_NAME } from '../core/config/settings'
import { createConfigStore, type ConfigStore } from './configStoreCore'

/** A beállítási fájl a felhasználói adatkönyvtárban: embernek olvasható JSON (ALP-05). */
export function createElectronConfigStore(): ConfigStore {
  return createConfigStore(
    {
      readText: async (path) => {
        try {
          return await readFile(path, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      },
      writeText: (path, text) => writeFile(path, text, { encoding: 'utf8', mode: 0o600 }),
      rename: (from, to) => rename(from, to),
      copy: (from, to) => copyFile(from, to),
    },
    join(app.getPath('userData'), SETTINGS_FILE_NAME),
  )
}
