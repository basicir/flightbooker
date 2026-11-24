import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { programLabel, type TheoryCatalog, type TheoryProgramOption, type TheorySubjectOption } from '../../core/model/theoryCatalog'
import type { FlightLoggerClient } from '../net/flightLogger/client'
import { SubjectCategoriesQuery, TheoryProgramsQuery } from '../net/flightLogger/queries'

/**
 * A FlightLogger programlistája az elméleti foglaláshoz (FLI-11): programok, revíziók és a
 * revíziók tárgyai, csak olvasó lekérdezéssel, az oktató kulcsával. A lista ritkán változik, ezért
 * a gyorsítótárból jön, amíg 7 napnál nem régebbi (a felületről kérésre újratölthető).
 */

export const THEORY_CATALOG_MAX_AGE_MS = 7 * 24 * 3_600_000
/** Ennyi revízió tárgyait kérjük le legfeljebb (kéréskorlát). */
const MAX_REVISIONS = 60

const cacheSchema = z.object({
  format: z.literal(1),
  fetchedAt: z.iso.datetime({ offset: true }),
  programs: z
    .array(
      z.object({
        revisionId: z.string().min(1).max(200),
        programId: z.string().min(1).max(200),
        programName: z.string().max(300),
        revisionName: z.string().max(300),
        label: z.string().max(600),
        programType: z.enum(['FLIGHT_TRAINING', 'GROUND_TRAINING', 'COMBINED_SYLLABUS']).optional(),
      }),
    )
    .max(5000),
  subjects: z.array(z.object({ id: z.string().min(1).max(200), name: z.string().max(300), revisionId: z.string().min(1).max(200) })).max(20_000),
})

export interface TheoryCatalogCacheStore {
  load(): Promise<Omit<TheoryCatalog, 'source' | 'errors'> | undefined>
  save(catalog: Omit<TheoryCatalog, 'source' | 'errors'>): Promise<void>
}

export function createTheoryCatalogCacheStore(path: string): TheoryCatalogCacheStore {
  return {
    async load() {
      try {
        const parsed = cacheSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
        return parsed.success ? { fetchedAt: parsed.data.fetchedAt, programs: parsed.data.programs, subjects: parsed.data.subjects } : undefined
      } catch {
        return undefined
      }
    },
    async save(catalog) {
      await mkdir(dirname(path), { recursive: true })
      const tmp = `${path}.tmp`
      await writeFile(tmp, JSON.stringify({ format: 1, ...catalog }), { encoding: 'utf8', mode: 0o600 })
      await rename(tmp, path)
    },
  }
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function loadTheoryCatalog(deps: {
  readonly client: Pick<FlightLoggerClient, 'fetchAll'>
  readonly now: Date
  readonly cache?: TheoryCatalogCacheStore
  readonly force?: boolean
}): Promise<TheoryCatalog> {
  const cached = deps.cache ? await deps.cache.load() : undefined
  if (cached && !deps.force && deps.now.getTime() - Date.parse(cached.fetchedAt) < THEORY_CATALOG_MAX_AGE_MS) return { ...cached, source: 'cache', errors: [] }

  const errors: string[] = []
  let programs: TheoryProgramOption[] = []
  try {
    const nodes = await deps.client.fetchAll(TheoryProgramsQuery, {}, (d) => d.programs, { pageSize: 50 })
    programs = nodes.flatMap((p) =>
      (p.programRevisions?.nodes ?? [])
        .filter((r): r is { id: string; name: string } => r !== null)
        .map((r) => ({
          revisionId: r.id,
          programId: p.id,
          programName: p.name,
          revisionName: r.name,
          label: programLabel(p.name, r.name),
          ...(p.programType ? { programType: p.programType } : {}),
        })),
    )
  } catch (error) {
    errors.push(`Programlista: ${message(error)}`)
  }
  if (programs.length === 0 && errors.length === 0) {
    errors.push('A FlightLogger ezzel a kulccsal nem adott programlistát. A program és a tárgy szabad szöveggel is megadható; az import a felirat szerint keres.')
  }

  // Tárgyak a Ground training és a vegyes programok revízióihoz (ezekhez kér a FlightLogger tárgyat).
  const subjects: TheorySubjectOption[] = []
  const forSubjects = programs.filter((p) => p.programType !== 'FLIGHT_TRAINING').slice(0, MAX_REVISIONS)
  let failed = 0
  for (const p of forSubjects) {
    try {
      const nodes = await deps.client.fetchAll(SubjectCategoriesQuery, { programRevisionId: p.revisionId }, (d) => d.subjectCategories, { pageSize: 100 })
      for (const s of nodes) if (s.name) subjects.push({ id: s.id, name: s.name, revisionId: p.revisionId })
    } catch {
      failed++
    }
  }
  if (failed > 0) errors.push(`${failed} programrevízió tárgylistája nem jött le; ott a tárgy szabad szöveggel adható meg.`)

  const fresh = { fetchedAt: deps.now.toISOString(), programs, subjects }
  if (programs.length > 0) await deps.cache?.save(fresh).catch(() => undefined)
  // Ha most nem jött semmi, de van korábbi lista, az jobb, mint az üres.
  if (programs.length === 0 && cached) return { ...cached, source: 'cache', errors }
  return { ...fresh, source: 'live', errors }
}
