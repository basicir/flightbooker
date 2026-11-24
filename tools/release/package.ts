/**
 * Csomagolás egy csatornára, platformra és architektúrára (a GitHub Actions és a helyi próba is
 * ezt hívja). Előtte `npm run build` kell; a verzió a package.json-ból jön.
 *
 *   npx tsx tools/release/package.ts --channel dev --platform mac --arch arm64
 *
 * Az electron-builder.yml az alap; ez csak a csatornától függő részeket írja felül, és a
 * csomagba kerülő package.json-ba beírja a frissítési csatornát (`updateChannel`, FRS-05).
 * Kimenet: release/<csatorna>/<platform>-<arch>/
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { Arch, build, Platform, type Configuration } from 'electron-builder'
import { assetBaseName, CHANNELS, type ReleaseArch, type ReleasePlatform } from './channels'

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    platform: { type: 'string' },
    arch: { type: 'string' },
  },
})
const channel = values.channel
const platform = values.platform as ReleasePlatform | undefined
const arch = values.arch as ReleaseArch | undefined
if (channel !== 'stable' && channel !== 'dev') throw new Error('--channel stable|dev kell.')
if (platform !== 'mac' && platform !== 'win') throw new Error('--platform mac|win kell.')
if (arch !== 'arm64' && arch !== 'x64') throw new Error('--arch arm64|x64 kell.')

const version = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const c = CHANNELS[channel]
const base = assetBaseName(channel, version, platform, arch)

const config: Configuration = {
  appId: c.appId,
  productName: c.productName,
  // A csomag package.json-jába: a program neve (ebből az adatmappa és a kulcstár bejegyzése) és a csatorna.
  extraMetadata: { productName: c.displayName, updateChannel: channel },
  directories: { output: `release/${channel}/${platform}-${arch}` },
  mac: {
    icon: c.icon,
    target: ['dmg', 'zip'],
    artifactName: `${base}.\${ext}`,
    extendInfo: { CFBundleDisplayName: c.displayName },
  },
  dmg: { artifactName: `${base}.\${ext}`, title: c.displayName },
  win: { icon: c.icon, target: ['nsis'] },
  nsis: {
    artifactName: `${base}-setup.\${ext}`,
    shortcutName: c.displayName,
    uninstallDisplayName: c.displayName,
  },
  publish: null,
}

const targets = platform === 'mac' ? Platform.MAC.createTarget(['dmg', 'zip'], Arch[arch]) : Platform.WINDOWS.createTarget(['nsis'], Arch[arch])
build({ targets, config, publish: 'never' }).then(
  (files) => {
    for (const file of files) process.stdout.write(`${file}\n`)
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exit(1)
  },
)
