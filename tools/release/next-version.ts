/**
 * A kiadási folyamat (GitHub Actions) első lépése: a következő verzió és címke kiszámítása, és
 * annak ellenőrzése, hogy a programba épített repónév egyezik a GitHub-repóval.
 *
 *   npx tsx tools/release/next-version.ts --channel dev --tags-file tags.txt --repository owner/name
 *
 * Kimenet (GITHUB_OUTPUT formátum): version=…, tag=…, previous_tag=…
 */
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { releaseRepoSlug } from '../../src/main/net/releaseRepo'
import { nextReleaseVersion } from './versioning'

const { values } = parseArgs({
  options: {
    channel: { type: 'string' },
    'tags-file': { type: 'string' },
    repository: { type: 'string' },
  },
})

const channel = values.channel
if (channel !== 'stable' && channel !== 'dev') throw new Error('--channel stable|dev kell.')
if (values.repository && values.repository.toLowerCase() !== releaseRepoSlug().toLowerCase()) {
  throw new Error(
    `A programba épített kiadási repó (${releaseRepoSlug()}) nem egyezik ezzel a repóval (${values.repository}). Javítsd a src/main/net/releaseRepo.ts-ben.`,
  )
}
const tags = values['tags-file']
  ? readFileSync(values['tags-file'], 'utf8')
      .split(/\r?\n/)
      .map((t) => t.trim())
      .filter(Boolean)
  : []
const packageVersion = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version
const next = nextReleaseVersion({ packageVersion, tags, channel })
if (tags.includes(next.tag)) throw new Error(`A(z) ${next.tag} címke már létezik.`)
process.stdout.write(`version=${next.version}\ntag=${next.tag}\nprevious_tag=${next.previousTag ?? ''}\n`)
