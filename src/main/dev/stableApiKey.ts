import { execFile } from 'node:child_process'
import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

/**
 * A fő változat API-kulcsának átvétele a fejlesztői változatba (FRS-11), a felhasználó kérésére
 * (gomb) és engedélyével (a macOS Kulcskarika ablaka). Az ALP-06 kiegészítése, 2026-11-25.
 *
 * A fő változat a kulcsot az Electron safeStorage-dzsal titkosította. macOS-en ez a Chromium „v10”
 * formátuma: AES-128-CBC, a kulcs a Kulcskarika „<név> Safe Storage” jelszavából PBKDF2-vel (SHA-1,
 * „saltysalt”, 1003 kör), a kezdővektor 16 szóköz. A jelszót a macOS csak a felhasználó engedélyével
 * adja ki. A visszafejtett kulcs csak a memóriában van: kipróbálás után a DEV a saját
 * titoktárolójába menti; fájlba, naplóba, hibaüzenetbe nem kerül.
 */

/** A fő változat kulcsfájlja a felhasználói adatmappájában (secrets.ts). */
export const STABLE_KEY_FILE = 'flightlogger-key.secret'

const V10 = 'v10'

/** A Chromium (Electron safeStorage) macOS-es „v10” titkosításának visszafejtése. */
export function decryptSafeStorageMac(data: Uint8Array, keychainPassword: string): string {
  const buffer = Buffer.from(data)
  if (buffer.subarray(0, V10.length).toString('latin1') !== V10) throw new Error('A fő változat kulcsfájlja ismeretlen formátumú.')
  const key = pbkdf2Sync(keychainPassword, 'saltysalt', 1003, 16, 'sha1')
  try {
    const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
    return Buffer.concat([decipher.update(buffer.subarray(V10.length)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('A fő változat kulcsa nem fejthető vissza.')
  }
}

export interface StableApiKeyDeps {
  /** A fő változat felhasználói adatmappája. */
  readonly stableDir: string
  /** A fő változat neve: ebből a Kulcskarika-bejegyzés neve („<név> Safe Storage”, „<név> Key”). */
  readonly appName: string
  readonly platform: string
  readonly readKeychainPassword: (service: string, account: string) => Promise<string>
}

/** A fő változat API-kulcsa, visszafejtve (csak macOS). */
export async function readStableApiKey(deps: StableApiKeyDeps): Promise<string> {
  if (deps.platform !== 'darwin') throw new Error('Az API-kulcs átvétele csak macOS-en érhető el.')
  let data: Buffer
  try {
    data = await readFile(join(deps.stableDir, STABLE_KEY_FILE))
  } catch {
    throw new Error('A Foglalástervezőben nincs mentett API-kulcs.')
  }
  const password = await deps.readKeychainPassword(`${deps.appName} Safe Storage`, `${deps.appName} Key`)
  return decryptSafeStorageMac(data, password).trim()
}

const execFileAsync = promisify(execFile)

/**
 * A Kulcskarika-jelszó a macOS `security` parancsával. A macOS ablakban kérdezi meg a felhasználót
 * (Mac-jelszó, „Engedélyezés”); elutasításnál vagy hiánynál általános hibaüzenet, a parancs kimenete
 * nélkül.
 */
export async function readMacKeychainPassword(service: string, account: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-w', '-s', service, '-a', account], { timeout: 180_000 })
    return stdout.replace(/\n$/, '')
  } catch {
    throw new Error('A Kulcskarika nem adta ki a Foglalástervező titkosítókulcsát (elutasítottad, lejárt az idő, vagy nem található).')
  }
}
