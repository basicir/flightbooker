import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { UpdateChannel } from '../../core/update/version'

/**
 * A csomagolt program frissítési csatornája (FRS-05). A kiadási folyamat írja a csomagba
 * kerülő package.json `updateChannel` mezőjébe (tools/release/package.ts); helyi buildnél és
 * fejlesztői futtatásnál nincs, ilyenkor a frissítő ki van kapcsolva.
 */
export function readUpdateChannel(): UpdateChannel | null {
  if (!app.isPackaged) return null
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { updateChannel?: unknown }
    return pkg.updateChannel === 'stable' || pkg.updateChannel === 'dev' ? pkg.updateChannel : null
  } catch {
    return null
  }
}
