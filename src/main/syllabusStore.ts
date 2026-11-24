import { mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseSyllabusFile, type Syllabus } from '../core/progress/syllabus'

/**
 * Feladatsorok betöltése (SZB-02). Két mappából olvas:
 * 1. a programmal szállított `feladatsorok/` mappából (fejlesztéskor a projekt gyökerében,
 *    telepítve az alkalmazás erőforrásai között);
 * 2. a felhasználói adatmappa `feladatsorok/` almappájából, ahová új exportok tehetők
 *    újratelepítés nélkül. Azonos program és revízió esetén ez utóbbi az erősebb.
 * Csak `.json` fájlokat olvas; a hibás fájl nem állítja meg a többit.
 */

export interface SyllabusLoad {
  readonly syllabi: Syllabus[]
  readonly errors: string[]
}

async function readDir(dir: string, label: string): Promise<SyllabusLoad> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json')).sort()
  } catch {
    return { syllabi: [], errors: [] }
  }
  const syllabi: Syllabus[] = []
  const errors: string[] = []
  for (const name of names) {
    try {
      const parsed = parseSyllabusFile(JSON.parse(await readFile(join(dir, name), 'utf8')), `${label}/${name}`)
      syllabi.push(...parsed.syllabi)
      errors.push(...parsed.errors)
    } catch (error) {
      errors.push(`${label}/${name}: nem olvasható JSON (${(error as Error).message})`)
    }
  }
  return { syllabi, errors }
}

export async function loadSyllabi(bundledDir: string, userDir: string): Promise<SyllabusLoad> {
  await mkdir(userDir, { recursive: true }).catch(() => undefined)
  const bundled = await readDir(bundledDir, 'beépített')
  const user = await readDir(userDir, 'saját')
  const byId = new Map<string, Syllabus>()
  for (const s of [...bundled.syllabi, ...user.syllabi]) byId.set(s.id, s)
  const syllabi = [...byId.values()].sort((a, b) => a.program.localeCompare(b.program) || a.revision.localeCompare(b.revision, undefined, { numeric: true }))
  return { syllabi, errors: [...bundled.errors, ...user.errors] }
}
