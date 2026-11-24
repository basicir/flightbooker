import { RELEASES_API_PATH, GITHUB_API_HOST, type AllowedDownload, type AllowedFetch } from '../net/allowedFetch'
import { UpdateError, type DownloadOptions, type ReleaseSource } from './updaterCore'

/**
 * A kiadások a GitHubról (FRS-02, FRS-03): a saját repó kiadáslistája az API-ból, a fájlok a
 * kiadás letöltési címéről. Hitelesítés, süti és személyes adat nélkül; csak az engedélyezési
 * listán át (ALP-02).
 */

const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'Foglalastervezo-frissito',
} as const

export function createGithubReleaseSource(fetch: AllowedFetch, download: AllowedDownload): ReleaseSource {
  return {
    async listReleases(signal) {
      const response = await fetch(`https://${GITHUB_API_HOST}${RELEASES_API_PATH}?per_page=30`, { method: 'GET', headers: HEADERS, signal })
      if (response.status === 403 || response.status === 429) {
        throw new UpdateError('A GitHub átmenetileg korlátozza a lekérdezést (kéréskorlát); a következő indításkor újra próbálom.')
      }
      if (!response.ok) throw new UpdateError(`A kiadások listája nem érhető el (HTTP ${response.status}).`)
      return response.json()
    },

    async download(url, options: DownloadOptions) {
      const response = await download(url, { headers: { 'User-Agent': HEADERS['User-Agent'] }, signal: options.signal })
      if (!response.ok || !response.body) throw new UpdateError(`A letöltés nem sikerült (HTTP ${response.status}).`)
      const declared = Number(response.headers.get('content-length') ?? NaN)
      if (Number.isFinite(declared) && declared > options.maxBytes) {
        await response.body.cancel().catch(() => undefined)
        throw new UpdateError('A letöltendő fájl nagyobb a vártnál, ezért nem töltöm le.')
      }
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > options.maxBytes) {
          await reader.cancel().catch(() => undefined)
          throw new UpdateError('A letöltött fájl nagyobb a vártnál, ezért nem telepítem.')
        }
        chunks.push(value)
        options.onProgress?.(received)
      }
      const data = new Uint8Array(received)
      let offset = 0
      for (const chunk of chunks) {
        data.set(chunk, offset)
        offset += chunk.byteLength
      }
      return data
    },
  }
}
