import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateChannel } from '../../src/core/update/version'

/**
 * Csomagolás előtti őr (FRS-09–FRS-11): a fő kiadásba nem kerülhet fejlesztői eszköz, a DEV-be
 * viszont kell. A build kimenetében (out/) a DEV-modulok egy-egy jellemző, csak ott előforduló
 * szövegét keresi: a főfolyamatban a GitHub-token fájlnevét, a felületen a fejlesztői rész
 * adatattribútumát.
 */
export const DEV_MARKERS = {
  main: 'github-kiado-token.secret',
  renderer: 'fejlesztoi-eszkozok',
} as const

export interface BuildTexts {
  readonly main: readonly string[]
  readonly renderer: readonly string[]
}

export interface DevMarkersFound {
  readonly main: boolean
  readonly renderer: boolean
}

export function findDevMarkers(texts: BuildTexts): DevMarkersFound {
  return {
    main: texts.main.some((t) => t.includes(DEV_MARKERS.main)),
    renderer: texts.renderer.some((t) => t.includes(DEV_MARKERS.renderer)),
  }
}

export function assertBuildMatchesChannel(channel: UpdateChannel, found: DevMarkersFound): void {
  if (channel === 'stable' && (found.main || found.renderer)) {
    throw new Error('A fő kiadás buildjében fejlesztői eszköz van (a @dev-tools aliasok a DEV-modulra mutattak). A build előtt a verzió nem lehet -dev.N.')
  }
  if (channel === 'dev' && !(found.main && found.renderer)) {
    throw new Error('A DEV-buildből hiányoznak a fejlesztői eszközök. A build előtt a verziónak X.Y.Z-dev.N alakúnak kell lennie.')
  }
}

function jsFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.js') || name.endsWith('.mjs') || name.endsWith('.cjs'))
      .map((name) => readFileSync(join(dir, name), 'utf8'))
  } catch {
    return []
  }
}

/** Az electron-vite kimenetének főfolyamati és felületi JavaScript-fájljai. */
export function readBuildTexts(outDir = 'out'): BuildTexts {
  return { main: jsFiles(join(outDir, 'main')), renderer: jsFiles(join(outDir, 'renderer')) }
}
