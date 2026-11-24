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
}

export const CHANNELS: Readonly<Record<UpdateChannel, ChannelPackaging>> = {
  stable: { appId: 'local.flightbooker.planner', productName: 'Foglalastervezo', displayName: 'Foglalástervező', icon: 'build/icon.png' },
  dev: { appId: 'local.flightbooker.planner.dev', productName: 'FoglalastervezoDev', displayName: 'Foglalástervező DEV', icon: 'build/icon-dev.png' },
}

export type ReleasePlatform = 'mac' | 'win'
export type ReleaseArch = 'arm64' | 'x64'

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
