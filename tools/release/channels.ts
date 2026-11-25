import { APP_DISPLAY_NAME } from '../../src/core/update/appNames'
import type { UpdateChannel } from '../../src/core/update/version'

/**
 * A két kiadási csatorna csomagolási adatai (FRS-05). A két program egymás mellett telepíthető:
 * külön azonosító, név, ikon, parancsikon és adatmappa (az adatmappa a `displayName`-ből).
 * A fő kiadás azonosítója és neve a korábbi helyi buildekével egyezik, így a meglévő beállítások
 * és az API-kulcs megmaradnak.
 */
export interface ChannelPackaging {
  readonly appId: string
  /** ASCII név a csomagon belül (ékezettel a Chromium nem találja a segédfolyamatokat). */
  readonly productName: string
  /** A Finderben, a Dockban, a Start menüben és a parancsikonon látszó név; ebből az adatmappa neve. */
  readonly displayName: string
  readonly icon: string
  /** A macOS-csomag formái: a frissítő a zipet használja, a DMG csak az első telepítéshez kell. */
  readonly macFormats: readonly ('dmg' | 'zip')[]
}

export const CHANNELS: Readonly<Record<UpdateChannel, ChannelPackaging>> = {
  stable: { appId: 'local.flightbooker.planner', productName: 'Foglalastervezo', displayName: APP_DISPLAY_NAME.stable, icon: 'build/icon.png', macFormats: ['dmg', 'zip'] },
  // A DEV-hez nem készül DMG (gyorsabb kiadás): első telepítésnél a zip kibontva az Alkalmazások mappába kerül.
  dev: { appId: 'local.flightbooker.planner.dev', productName: 'FoglalastervezoDev', displayName: APP_DISPLAY_NAME.dev, icon: 'build/icon-dev.png', macFormats: ['zip'] },
}

export type ReleasePlatform = 'mac' | 'win'
export type ReleaseArch = 'arm64' | 'x64'

/** Egy csomagolási feladat a GitHub Actions mátrixában. */
export interface ReleaseTarget {
  readonly platform: ReleasePlatform
  readonly arch: ReleaseArch
  /** A GitHub Actions gépe. */
  readonly os: string
}

/**
 * Csatornánként ezek a csomagok készülnek. A fejlesztői (DEV) változat csak a fejlesztő Apple
 * Silicon Macjére kerül, ezért ahhoz csak egy csomag készül (gyorsabb kiadás); a fő kiadás macOS-re
 * (Apple Silicon, Intel) és Windowsra.
 */
export const RELEASE_TARGETS: Readonly<Record<UpdateChannel, readonly ReleaseTarget[]>> = {
  stable: [
    { platform: 'mac', arch: 'arm64', os: 'macos-latest' },
    { platform: 'mac', arch: 'x64', os: 'macos-latest' },
    { platform: 'win', arch: 'x64', os: 'windows-latest' },
  ],
  dev: [{ platform: 'mac', arch: 'arm64', os: 'macos-latest' }],
}

/** A frissítőnek kötelező fájlok: macOS-en a zip, Windowson az NSIS-telepítő (FRS-03). */
export function requiredAssets(channel: UpdateChannel): readonly ClassifiedAsset[] {
  return RELEASE_TARGETS[channel].map((t): ClassifiedAsset => (t.platform === 'mac' ? { platform: 'darwin', arch: t.arch, kind: 'zip' } : { platform: 'win32', arch: t.arch, kind: 'nsis' }))
}

/** A kiadási fájlok nevének eleje, pl. `Foglalastervezo-0.1.3-mac-arm64`. */
export const assetBaseName = (channel: UpdateChannel, version: string, platform: ReleasePlatform, arch: ReleaseArch): string =>
  `${CHANNELS[channel].productName}-${version}-${platform}-${arch}`

export interface ClassifiedAsset {
  readonly platform: 'darwin' | 'win32'
  readonly arch: ReleaseArch
  readonly kind: 'zip' | 'dmg' | 'nsis'
}

/** A kiadás egy fájljának szerepe a neve alapján; idegen fájlnál `null`. */
export function classifyAsset(name: string, channel: UpdateChannel, version: string): ClassifiedAsset | null {
  for (const platform of ['mac', 'win'] as const) {
    for (const arch of ['arm64', 'x64'] as const) {
      const base = assetBaseName(channel, version, platform, arch)
      if (platform === 'mac' && name === `${base}.zip`) return { platform: 'darwin', arch, kind: 'zip' }
      if (platform === 'mac' && name === `${base}.dmg`) return { platform: 'darwin', arch, kind: 'dmg' }
      if (platform === 'win' && name === `${base}-setup.exe`) return { platform: 'win32', arch, kind: 'nsis' }
    }
  }
  return null
}
