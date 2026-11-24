import { execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { ManifestAsset } from '../../core/update/manifest'
import { UpdateError, type Installer } from './updaterCore'

/**
 * A frissítés telepítése (FRS-07). Az aláírt leírás szerint ellenőrzött fájlból:
 * - macOS: a zipből kibontott alkalmazáscsomag a régi helyére kerül, a program újraindul.
 *   Apple-tanúsítvány nélkül a Squirrel-alapú frissítő nem működne, ezért cseréljük magunk.
 *   A program által letöltött fájl nem kap karantén-jelölést, így a Gatekeeper nem állítja meg.
 * - Windows: az NSIS-telepítő csendben fut (`/S`), majd elindítja a programot.
 */

const execFileAsync = promisify(execFile)
const WORK_PREFIX = 'foglalastervezo-frissites-'

function macBundlePath(): string {
  return resolve(app.getPath('exe'), '..', '..', '..')
}

async function writable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK)
    return true
  } catch {
    return false
  }
}

async function macBlocker(): Promise<string | null> {
  const bundle = macBundlePath()
  if (!bundle.endsWith('.app')) return 'A program csomagja nem található, ezért a frissítést kézzel kell telepíteni.'
  if (bundle.includes('/AppTranslocation/') || bundle.startsWith('/Volumes/')) {
    return 'A program nem az Alkalmazások mappából fut (például közvetlenül a lemezképről). Húzd át az Alkalmazások mappába, és onnan indítsd.'
  }
  if (!(await writable(dirname(bundle))) || !(await writable(bundle))) {
    return 'A program mappája nem írható a te felhasználóddal, ezért a frissítést kézzel kell telepíteni.'
  }
  return null
}

/** Áthelyezés; másik kötetre (EXDEV) másolással. */
async function moveInto(source: string, target: string): Promise<void> {
  try {
    await rename(source, target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await execFileAsync('/usr/bin/ditto', [source, target])
    await rm(source, { recursive: true, force: true })
  }
}

async function installMac(data: Uint8Array): Promise<void> {
  const bundle = macBundlePath()
  const work = await mkdtemp(join(tmpdir(), WORK_PREFIX))
  try {
    const zip = join(work, 'frissites.zip')
    await writeFile(zip, data)
    const extracted = join(work, 'kibontva')
    await mkdir(extracted)
    await execFileAsync('/usr/bin/ditto', ['-x', '-k', zip, extracted])
    const apps = (await readdir(extracted)).filter((name) => name.endsWith('.app'))
    if (apps.length !== 1 || apps[0] !== basename(bundle)) throw new UpdateError('A frissítés csomagja nem ezt az alkalmazást tartalmazza.')
    const fresh = join(extracted, apps[0])
    await execFileAsync('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', fresh]).catch(() => undefined)
    const backup = join(dirname(bundle), `.${basename(bundle)}.regi`)
    await rm(backup, { recursive: true, force: true })
    await rename(bundle, backup)
    try {
      await moveInto(fresh, bundle)
    } catch (error) {
      await rm(bundle, { recursive: true, force: true }).catch(() => undefined)
      await rename(backup, bundle)
      throw error
    }
    await rm(backup, { recursive: true, force: true }).catch(() => undefined)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
  // Az új példány csak a mostani kilépése után indul (ugyanazon az útvonalon már az új csomag van).
  const waiter = spawn(
    '/bin/sh',
    ['-c', 'while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 0.2; done; /usr/bin/open "$2"', 'frissito', String(process.pid), bundle],
    { detached: true, stdio: 'ignore' },
  )
  waiter.unref()
  app.exit(0)
}

async function installWindows(asset: ManifestAsset, data: Uint8Array): Promise<void> {
  const work = await mkdtemp(join(tmpdir(), WORK_PREFIX))
  const installer = join(work, asset.name)
  await writeFile(installer, data)
  // Az electron-builder NSIS-telepítője: --updated (frissítés), /S (csendes), --force-run (utána indítja).
  const child = spawn(installer, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' })
  await new Promise<void>((resolveSpawn, reject) => {
    child.once('spawn', () => resolveSpawn())
    child.once('error', (error) => reject(new UpdateError(`A telepítő nem indult el: ${error.message}`)))
  })
  child.unref()
  // A telepítő csak a program kilépése után tudja cserélni a fájlokat.
  app.exit(0)
}

export function createPlatformInstaller(): Installer {
  return {
    async blocker() {
      if (!app.isPackaged) return 'Fejlesztői futtatásnál nincs telepítés.'
      if (process.platform === 'darwin') return macBlocker()
      if (process.platform === 'win32') {
        if (process.env['PORTABLE_EXECUTABLE_FILE']) return 'A hordozható változat nem frissül magától; töltsd le a telepítőt a kiadás oldaláról.'
        return null
      }
      return 'Ezen a rendszeren a frissítést kézzel kell telepíteni.'
    },
    async install(asset, data) {
      if (process.platform === 'darwin' && asset.kind === 'zip') return installMac(data)
      if (process.platform === 'win32' && asset.kind === 'nsis') return installWindows(asset, data)
      throw new UpdateError('Ehhez a géphez nincs automatikus telepítés.')
    },
  }
}
