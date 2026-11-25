import { describe, expect, it } from 'vitest'
import { APP_DISPLAY_NAME } from '../../src/core/update/appNames'
import { assetBaseName, CHANNELS, classifyAsset, RELEASE_TARGETS, requiredAssets } from '../../tools/release/channels'
import { nextReleaseVersion } from '../../tools/release/versioning'

describe('a következő kiadás verziója (FRS-05)', () => {
  it('első kiadásnál a package.json verziója', () => {
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags: [], channel: 'stable' })).toEqual({ version: '0.1.0', tag: 'v0.1.0', previousTag: null })
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags: [], channel: 'dev' })).toEqual({ version: '0.1.0-dev.1', tag: 'v0.1.0-dev.1', previousTag: null })
  })

  it('a fő kiadás javítószáma magától nő, a dev sorszáma folyamatos', () => {
    const tags = ['v0.1.0', 'v0.1.1', 'v0.1.1-dev.4', 'v0.1.2-dev.5', 'v0.1.2-dev.6']
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags, channel: 'stable' })).toEqual({ version: '0.1.2', tag: 'v0.1.2', previousTag: 'v0.1.1' })
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags, channel: 'dev' })).toEqual({
      version: '0.1.2-dev.7',
      tag: 'v0.1.2-dev.7',
      previousTag: 'v0.1.2-dev.6',
    })
  })

  it('a fő kiadás után a dev a következő fő verzióra mutat, és továbbra is nő', () => {
    const tags = ['v0.1.2-dev.7', 'v0.1.2']
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags, channel: 'dev' }).version).toBe('0.1.3-dev.8')
  })

  it('a package.json-ban emelt alverzió az új alsó határ; régebbire nem lép vissza', () => {
    expect(nextReleaseVersion({ packageVersion: '0.2.0', tags: ['v0.1.7'], channel: 'stable' }).version).toBe('0.2.0')
    expect(nextReleaseVersion({ packageVersion: '0.1.0', tags: ['v0.3.4'], channel: 'stable' }).version).toBe('0.3.5')
  })

  it('a package.json verziója nem lehet dev', () => {
    expect(() => nextReleaseVersion({ packageVersion: '0.1.0-dev.1', tags: [], channel: 'stable' })).toThrow()
  })
})

describe('kiadási fájlok', () => {
  it('a csatorna és a verzió szerinti nevek felismerhetők, idegen fájl nem', () => {
    const v = '0.1.2-dev.7'
    expect(classifyAsset(`${assetBaseName('dev', v, 'mac', 'arm64')}.zip`, 'dev', v)).toEqual({ platform: 'darwin', arch: 'arm64', kind: 'zip' })
    expect(classifyAsset(`${assetBaseName('dev', v, 'mac', 'x64')}.dmg`, 'dev', v)).toEqual({ platform: 'darwin', arch: 'x64', kind: 'dmg' })
    expect(classifyAsset(`${assetBaseName('dev', v, 'win', 'x64')}-setup.exe`, 'dev', v)).toEqual({ platform: 'win32', arch: 'x64', kind: 'nsis' })
    expect(classifyAsset(`${assetBaseName('stable', v, 'mac', 'arm64')}.zip`, 'dev', v)).toBeNull()
    expect(classifyAsset(`${assetBaseName('dev', v, 'mac', 'arm64')}.zip.blockmap`, 'dev', v)).toBeNull()
  })
})

describe('csatornánkénti csomagok', () => {
  it('a DEV csak Apple Silicon Macre, zipként készül; a fő kiadás minden platformra, DMG-vel is', () => {
    expect(RELEASE_TARGETS.dev).toEqual([{ platform: 'mac', arch: 'arm64', os: 'macos-latest' }])
    expect(requiredAssets('dev')).toEqual([{ platform: 'darwin', arch: 'arm64', kind: 'zip' }])
    expect(CHANNELS.dev.macFormats).toEqual(['zip'])
    expect(RELEASE_TARGETS.stable.map((t) => `${t.platform}-${t.arch}`)).toEqual(['mac-arm64', 'mac-x64', 'win-x64'])
    expect(requiredAssets('stable')).toContainEqual({ platform: 'win32', arch: 'x64', kind: 'nsis' })
    expect(CHANNELS.stable.macFormats).toEqual(['dmg', 'zip'])
  })

  it('a programnév (és így az adatmappa) egy helyről jön; a DEV ebből találja a fő változatot', () => {
    expect(CHANNELS.stable.displayName).toBe(APP_DISPLAY_NAME.stable)
    expect(CHANNELS.dev.displayName).toBe(APP_DISPLAY_NAME.dev)
    expect(APP_DISPLAY_NAME.stable).toBe('Foglalástervező')
  })
})
