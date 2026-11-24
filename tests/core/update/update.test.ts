import { describe, expect, it } from 'vitest'
import { manifestProblems, selectInstallAsset, type Manifest, type ManifestAsset } from '../../../src/core/update/manifest'
import { pickLatestRelease, type Release } from '../../../src/core/update/releases'
import { compareVersions, parseVersion, versionFromTag } from '../../../src/core/update/version'

const SHA = `${'A'.repeat(86)}==`

describe('verziók (FRS-05)', () => {
  it('a fő és a fejlesztői verziót is felismeri, mást nem', () => {
    expect(parseVersion('0.1.3')).toEqual({ major: 0, minor: 1, patch: 3 })
    expect(parseVersion('0.1.3-dev.12')).toEqual({ major: 0, minor: 1, patch: 3, dev: 12 })
    for (const bad of ['0.1', '0.1.3-beta.1', 'v0.1.3', '0.1.3-dev', '0.1.3 ', '']) expect(parseVersion(bad), bad).toBeNull()
    expect(versionFromTag('v0.2.0')).toEqual({ major: 0, minor: 2, patch: 0 })
    expect(versionFromTag('0.2.0')).toBeNull()
  })

  it('semver szerint hasonlít: a dev előzetes kisebb, mint ugyanaz a fő verzió', () => {
    const cmp = (a: string, b: string) => Math.sign(compareVersions(parseVersion(a)!, parseVersion(b)!))
    expect(cmp('0.1.10', '0.1.9')).toBe(1)
    expect(cmp('0.2.0', '0.1.99')).toBe(1)
    expect(cmp('0.1.3-dev.2', '0.1.3')).toBe(-1)
    expect(cmp('0.1.3-dev.10', '0.1.3-dev.9')).toBe(1)
    expect(cmp('0.1.4-dev.1', '0.1.3-dev.50')).toBe(1)
    expect(cmp('1.0.0', '1.0.0')).toBe(0)
  })
})

function release(tag: string, options: Partial<Release> = {}): Release {
  return {
    tag_name: tag,
    draft: false,
    prerelease: tag.includes('-dev.'),
    html_url: `https://github.com/o/r/releases/tag/${tag}`,
    published_at: null,
    assets: [{ name: 'update-manifest.json', size: 900, browser_download_url: `https://github.com/o/r/releases/download/${tag}/update-manifest.json` }],
    ...options,
  }
}

describe('a csatorna legújabb kiadása (FRS-01)', () => {
  const list = [release('v0.1.2'), release('v0.1.3'), release('v0.1.4-dev.7'), release('v0.1.4-dev.8'), release('v0.1.1')]

  it('a fő kiadás csak a fő kiadásokat nézi', () => {
    expect(pickLatestRelease(list, 'stable', '0.1.2')?.version).toBe('0.1.3')
    expect(pickLatestRelease(list, 'stable', '0.1.3')).toBeNull()
  })

  it('a fejlesztői változat csak a fejlesztői kiadásokat nézi', () => {
    expect(pickLatestRelease(list, 'dev', '0.1.4-dev.7')?.version).toBe('0.1.4-dev.8')
    expect(pickLatestRelease(list, 'dev', '0.1.4-dev.8')).toBeNull()
  })

  it('régebbire nem lép vissza, és ismeretlen saját verziónál nem frissít', () => {
    expect(pickLatestRelease(list, 'stable', '0.2.0')).toBeNull()
    expect(pickLatestRelease(list, 'stable', 'fejlesztői')).toBeNull()
  })

  it('a vázlatot, a leírás nélküli és a rossz jelölésű kiadást kihagyja', () => {
    const tricky = [
      release('v0.1.9', { draft: true }),
      release('v0.1.8', { assets: [] }),
      release('v0.1.7', { prerelease: true }),
      release('v0.1.6-dev.1', { prerelease: false }),
      release('valami'),
      release('v0.1.5'),
    ]
    expect(pickLatestRelease(tricky, 'stable', '0.1.0')?.version).toBe('0.1.5')
    expect(pickLatestRelease(tricky, 'dev', '0.1.0-dev.0')).toBeNull()
  })
})

describe('a géphez illő telepítő (FRS-07)', () => {
  const asset = (a: Partial<ManifestAsset>): ManifestAsset => ({ platform: 'darwin', arch: 'arm64', kind: 'zip', name: 'x.zip', size: 10, sha512: SHA, ...a })
  const manifest: Manifest = {
    app: 'flightbooker',
    channel: 'stable',
    version: '0.1.3',
    createdAt: '2026-11-24T00:00:00Z',
    assets: [
      asset({ name: 'a.zip' }),
      asset({ name: 'a.dmg', kind: 'dmg' }),
      asset({ name: 'b.zip', arch: 'x64' }),
      asset({ name: 'c.exe', platform: 'win32', arch: 'x64', kind: 'nsis' }),
    ],
  }

  it('macOS-en az architektúra zipje, Windowson az NSIS-telepítő (ARM-en is az x64)', () => {
    expect(selectInstallAsset(manifest, 'darwin', 'arm64')?.name).toBe('a.zip')
    expect(selectInstallAsset(manifest, 'darwin', 'x64')?.name).toBe('b.zip')
    expect(selectInstallAsset(manifest, 'win32', 'x64')?.name).toBe('c.exe')
    expect(selectInstallAsset(manifest, 'win32', 'arm64')?.name).toBe('c.exe')
    expect(selectInstallAsset(manifest, 'linux', 'x64')).toBeNull()
  })

  it('a leírásnak a várt csatornára és verzióra kell szólnia', () => {
    expect(manifestProblems(manifest, { channel: 'stable', version: '0.1.3' })).toEqual([])
    expect(manifestProblems(manifest, { channel: 'dev', version: '0.1.3' })).toHaveLength(1)
    expect(manifestProblems(manifest, { channel: 'stable', version: '0.1.4' })).toHaveLength(1)
  })
})
