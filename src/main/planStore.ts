import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { createPlanStore, type PlanStore } from './planStoreCore'

export function createElectronPlanStore(): PlanStore {
  const dir = join(app.getPath('userData'), 'tervek')
  return createPlanStore(
    {
      readText: async (path) => {
        try {
          return await readFile(path, 'utf8')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
          throw error
        }
      },
      writeText: async (path, text) => {
        await mkdir(dir, { recursive: true })
        await writeFile(path, text, { encoding: 'utf8', mode: 0o600 })
      },
      rename: (from, to) => rename(from, to),
    },
    dir,
  )
}
