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
  const value = packagedField('updateChannel')
  return value === 'stable' || value === 'dev' ? value : null
}

/**
 * A csomag commitja (tools/release/package.ts írja a kiadási folyamatban). A DEV „Kiadás: dev →
 * main” gombja pontosan ezt adja ki (FRS-09). Helyi buildnél nincs.
 */
export function readBuildCommit(): string | null {
  const value = packagedField('buildCommit')
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value) ? value : null
}

function packagedField(name: string): unknown {
  if (!app.isPackaged) return undefined
  try {
    const pkg = JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as Record<string, unknown>
    return pkg[name]
  } catch {
    return undefined
  }
}
