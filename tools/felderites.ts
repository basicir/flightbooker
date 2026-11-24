import { mkdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { FlightLoggerClient, type RequestEvent } from '../src/main/net/flightLogger/client'
import { fetchForecast } from '../src/main/net/openMeteo'
import { runDiscovery, type DiscoveryResult, type NetworkData } from './discovery/checks'
import { parseCliOptions, parseCoordinates, parseLocalDateTime } from './discovery/input'
import { ask, askHidden } from './discovery/prompt'
import { renderReport } from './discovery/report'
import { countBy, redactSensitive } from './discovery/stats'

/**
 * Felderítő eszköz (koncepció 13.1, K02). Csak olvas: minden kérés az allowedFetch-en
 * és a readOnlyGuardon megy át. Az API-kulcsot rejtett bevitellel kéri, csak memóriában
 * tartja, és sehova nem írja ki. A jelentés névtelenített.
 *
 * Futtatás: npm run felderites [-- --vissza=14 --elore=21]
 */

const ROOT = join(__dirname, '..')

async function askUntilValid<T>(question: string, parse: (text: string) => T): Promise<T> {
  for (;;) {
    try {
      return parse(await ask(question))
    } catch (error) {
      console.log(`  ${(error as Error).message}`)
    }
  }
}

function timestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2))

  console.log('Foglalástervező – felderítés')
  console.log('A program csak olvas a FlightLoggerből, és névtelenített jelentést ír a reports/ mappába.')
  console.log('Az API-kulcs nem jelenik meg gépeléskor, és nem kerül fájlba vagy naplóba.\n')

  const apiKey = await askHidden('FlightLogger API-kulcs: ')
  if (apiKey === '') {
    console.log('Nem adtál meg kulcsot, a felderítés nem indul el.')
    process.exitCode = 1
    return
  }
  const airport = await askUntilValid(
    'A repülőtér koordinátái „szélesség, hosszúság” (Enter: időjárás kihagyása): ',
    parseCoordinates,
  )
  const unpublishedProbe = await askUntilValid(
    'Nem publikált teszt-foglalás kezdete „ÉÉÉÉ-HH-NN ÓÓ:PP” helyi időben (Enter: kihagyás): ',
    parseLocalDateTime,
  )
  console.log('')

  const events: RequestEvent[] = []
  const client = new FlightLoggerClient({ apiKey, onRequest: (event) => events.push(event) })
  const sensitive = new Set<string>([apiKey])

  const result = await runDiscovery(
    {
      client,
      now: new Date(),
      pastDays: options.pastDays,
      futureDays: options.futureDays,
      ...(airport ? { airport } : {}),
      ...(unpublishedProbe ? { unpublishedProbe } : {}),
      fetchForecast: (request) => fetchForecast(request),
      saveSchema: async (sdl) => {
        const path = join(ROOT, 'docs', 'schema.graphql')
        await writeFile(path, `# FlightLogger GraphQL-séma (introspekció, ${new Date().toISOString()})\n\n${sdl}\n`, 'utf8')
        return relative(ROOT, path)
      },
      log: (line) => console.log(line),
    },
    sensitive,
  )

  const retryAfters = events.map((e) => e.retryAfterSeconds).filter((v): v is number => v !== undefined)
  const network: NetworkData = {
    requests: events.length,
    rateLimited: events.filter((e) => e.status === 429).length,
    maxRetryAfterSeconds: retryAfters.length > 0 ? Math.max(...retryAfters) : null,
    totalMs: events.reduce((sum, e) => sum + e.durationMs, 0),
    byQuery: countBy(events, (e) => e.queryName),
  }
  const full: DiscoveryResult = { ...result, network }

  const markdown = redactSensitive(renderReport(full), sensitive)
  const json = redactSensitive(JSON.stringify(full, null, 2), sensitive)
  if (markdown.text.includes(apiKey) || json.text.includes(apiKey)) {
    throw new Error('Biztonsági leállás: a jelentés tartalmazná a kulcsot, ezért nem készült el.')
  }

  const dir = join(ROOT, 'reports')
  await mkdir(dir, { recursive: true })
  const base = `felderites-${timestamp(new Date())}`
  await writeFile(join(dir, `${base}.md`), markdown.text, 'utf8')
  await writeFile(join(dir, `${base}.json`), json.text, 'utf8')

  console.log('')
  console.log(`Jelentés: reports/${base}.md (és .json)`)
  if (full.schema.status === 'ok') console.log('Séma: docs/schema.graphql')
  const redactions = markdown.redactions + json.redactions
  if (redactions > 0) console.log(`Megjegyzés: ${redactions} helyen kitakartam nevet, e-mailt vagy kommentet.`)
  console.log('Nézd át a jelentést, mielőtt megosztod.')
}

main().catch((error: unknown) => {
  console.error(`Hiba: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
