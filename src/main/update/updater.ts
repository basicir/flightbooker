import { join } from 'node:path'
import { app } from 'electron'
import { allowedDownload, allowedFetch } from '../net/allowedFetch'
import { readUpdateChannel } from './buildInfo'
import { createGithubReleaseSource } from './githubSource'
import { createPlatformInstaller } from './install'
import { createPrefsStore } from './prefsStore'
import publicKeys from './update-public-keys.json'
import { createUpdater, type Updater } from './updaterCore'
import { createManifestVerifier, sha512Base64 } from './verify'

/** A program frissítője a valódi GitHub-forrással, telepítővel és beállításfájllal. */
export function createAppUpdater(): Updater {
  return createUpdater({
    channel: readUpdateChannel(),
    currentVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    source: createGithubReleaseSource(allowedFetch, allowedDownload),
    verifyManifest: createManifestVerifier(publicKeys.keys),
    sha512: sha512Base64,
    installer: createPlatformInstaller(),
    prefs: createPrefsStore(join(app.getPath('userData'), 'frissites.json')),
    now: () => new Date(),
  })
}
