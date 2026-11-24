import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptSafeStorageMac, readStableApiKey, STABLE_KEY_FILE } from '../../../src/main/dev/stableApiKey'

/**
 * Szintetikus adat: kitalált „kulcs” és Kulcskarika-jelszó, a Chromium macOS-es „v10” formátumában
 * titkosítva (ahogy az Electron safeStorage teszi). Valódi kulcs nincs a tesztben.
 */
const FAKE_KEY = 'nem-valodi-teszt-ertek-123456'
const FAKE_PASSWORD = 'kitalalt-kulcskarika-jelszo'

function encryptV10(plain: string, password: string): Buffer {
  const key = pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  return Buffer.concat([Buffer.from('v10', 'latin1'), cipher.update(plain, 'utf8'), cipher.final()])
}

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
async function stableDirWith(data?: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'fb-kulcs-'))
  dirs.push(dir)
  if (data) await writeFile(join(dir, STABLE_KEY_FILE), data)
  return dir
}

describe('a fő változat API-kulcsának átvétele (FRS-11)', () => {
  it('a safeStorage macOS-es formátumát visszafejti', () => {
    expect(decryptSafeStorageMac(encryptV10(FAKE_KEY, FAKE_PASSWORD), FAKE_PASSWORD)).toBe(FAKE_KEY)
  })

  it('rossz jelszónál vagy ismeretlen formátumnál hibát ad, a tartalom nélkül', () => {
    const wrong = (() => {
      try {
        return decryptSafeStorageMac(encryptV10(FAKE_KEY, FAKE_PASSWORD), 'masik-jelszo')
      } catch (e) {
        return (e as Error).message
      }
    })()
    // Rossz kulccsal a PKCS7-kitöltés szinte mindig hibás; ha mégsem, a szöveg akkor sem az eredeti.
    expect(wrong).not.toBe(FAKE_KEY)
    expect(() => decryptSafeStorageMac(Buffer.from('v11abc'), FAKE_PASSWORD)).toThrow(/ismeretlen formátumú/)
  })

  it('a fő változat Kulcskarika-elemét kéri, és a kulcsot adja vissza', async () => {
    const readKeychainPassword = vi.fn(async () => FAKE_PASSWORD)
    const stableDir = await stableDirWith(encryptV10(FAKE_KEY, FAKE_PASSWORD))
    expect(await readStableApiKey({ stableDir, appName: 'Foglalástervező', platform: 'darwin', readKeychainPassword })).toBe(FAKE_KEY)
    expect(readKeychainPassword).toHaveBeenCalledWith('Foglalástervező Safe Storage', 'Foglalástervező Key')
  })

  it('kulcsfájl nélkül, más platformon és elutasított engedélynél érthető hiba', async () => {
    const readKeychainPassword = vi.fn(async () => FAKE_PASSWORD)
    await expect(readStableApiKey({ stableDir: await stableDirWith(), appName: 'X', platform: 'darwin', readKeychainPassword })).rejects.toThrow(/nincs mentett API-kulcs/)
    await expect(readStableApiKey({ stableDir: await stableDirWith(), appName: 'X', platform: 'win32', readKeychainPassword })).rejects.toThrow(/csak macOS/)
    expect(readKeychainPassword).not.toHaveBeenCalled()
    const denied = vi.fn(async () => {
      throw new Error('A Kulcskarika nem adta ki')
    })
    const stableDir = await stableDirWith(encryptV10(FAKE_KEY, FAKE_PASSWORD))
    await expect(readStableApiKey({ stableDir, appName: 'X', platform: 'darwin', readKeychainPassword: denied })).rejects.toThrow(/Kulcskarika/)
  })
})
