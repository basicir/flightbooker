import { z } from 'zod'
import { computeProgress, lectureOrderKey, type LectureInfo, type StudentProgress, type TrainingRecord } from './lectures'

/**
 * Feladatsorok (syllabus) a `feladatsorok/` mappából (SZB-02, K36). A fájlokat a
 * `tools/tampermonkey/feladatsor-export.user.js` készíti a FlightLogger Programs oldaláról,
 * mert a program szerkezete az iskolai API-kulccsal nem olvasható. Egy fájl egy vagy több
 * program-revíziót tartalmaz; a revíziót a növendékhez a program és a revízió neve köti
 * (az API is ezeket a neveket adja), vagy az oktató választja ki kézzel.
 *
 * A feladatok azonosítója a fájlban nincs (az oldal nem mutatja), ezért a FlightLogger
 * elvégzett feladataival a név kódja („III./16.”) alapján párosítunk.
 */

export const SYLLABUS_FORMAT = 'flightbooker-feladatsor'

const minutes = z.number().int().min(0).max(24 * 60)

const taskSchema = z.object({
  order: z.number().int().min(0),
  phase: z.string().nullable(),
  code: z.string().nullable(),
  name: z.string().min(1).max(300),
  category: z.string().max(100).optional().default(''),
  minutes: z.record(z.string(), z.number().int().min(-24 * 60).max(24 * 60)).optional().default({}),
  flightMinutes: minutes,
  simulator: z.boolean(),
  night: z.boolean(),
})

const programSchema = z.object({
  program: z.string().min(1).max(200),
  revision: z.string().min(1).max(200),
  tasks: z.array(taskSchema),
})

const fileSchema = z.object({
  format: z.literal(SYLLABUS_FORMAT),
  formatVersion: z.literal(1),
  programs: z.array(programSchema).min(1),
})

export interface SyllabusTask {
  readonly order: number
  readonly phase: string | null
  readonly code: string
  readonly name: string
  readonly category: string
  readonly flightMinutes: number
  /** Ebből egyedül vagy SPIC-ként repült idő (az oktató nincs a gépen). */
  readonly soloMinutes: number
  readonly simulator: boolean
  readonly night: boolean
}

/** Az egyedül és SPIC-ként repült percek oszlopai a feladatsor-exportban. */
const SOLO_COLUMNS = ['vfrSolo', 'vfrSpic', 'ifrSpic'] as const

export interface Syllabus {
  /** Program és revízió, normalizálva: „atp(a) integrated|revision 7”. */
  readonly id: string
  readonly program: string
  readonly revision: string
  readonly tasks: readonly SyllabusTask[]
  /** A fájl neve, amelyből jött (a felületen jelenik meg). */
  readonly source: string
}

/** A felületnek elég összefoglaló. */
export interface SyllabusSummary {
  readonly id: string
  readonly program: string
  readonly revision: string
  readonly taskCount: number
  readonly source: string
}

const norm = (s: string): string => s.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()

export function syllabusId(program: string, revision: string): string {
  return `${norm(program)}|${norm(revision)}`
}

const keyOf = (name: string): string | undefined => {
  const k = lectureOrderKey(name)
  return k ? `${k[0]}/${k[1]}` : undefined
}

/**
 * Egy feladatsor-fájl beolvasása. A kód nélküli sorokat (például „Session Removed”) és az
 * azonos kódú ismétléseket kihagyja.
 */
export function parseSyllabusFile(value: unknown, source: string): { readonly syllabi: Syllabus[]; readonly errors: string[] } {
  const parsed = fileSchema.safeParse(value)
  if (!parsed.success) {
    return { syllabi: [], errors: [`${source}: nem feladatsor-fájl vagy hibás (${parsed.error.issues[0]?.message ?? 'ismeretlen hiba'})`] }
  }
  const syllabi = parsed.data.programs.map((p) => {
    const seen = new Set<string>()
    const tasks: SyllabusTask[] = []
    for (const t of [...p.tasks].sort((a, b) => a.order - b.order)) {
      const key = keyOf(t.name)
      if (!t.code || !key || seen.has(key)) continue
      seen.add(key)
      const soloMinutes = SOLO_COLUMNS.reduce((sum, c) => sum + Math.max(0, t.minutes[c] ?? 0), 0)
      tasks.push({ order: tasks.length + 1, phase: t.phase, code: t.code, name: t.name, category: t.category, flightMinutes: t.flightMinutes, soloMinutes: Math.min(soloMinutes, t.flightMinutes), simulator: t.simulator, night: t.night })
    }
    return { id: syllabusId(p.program, p.revision), program: p.program, revision: p.revision, tasks, source }
  })
  return { syllabi, errors: [] }
}

export function summarize(s: Syllabus): SyllabusSummary {
  return { id: s.id, program: s.program, revision: s.revision, taskCount: s.tasks.length, source: s.source }
}

/** A feladatsor feladatainak azonosítója a katalógusban. */
export const syllabusLectureId = (s: Pick<Syllabus, 'id'>, code: string): string => `syl:${s.id}:${code}`

/**
 * A feladatsor feladatai katalógus-bejegyzésként. A briefing és a debriefing nincs a
 * Programs oldalon: ha a FlightLogger API-ból ismert ugyanannak a kódnak a feladata, onnan
 * jön, különben az alapértékből.
 */
export function syllabusLectures(
  s: Syllabus,
  briefingFor: (code: string) => { readonly briefing: number; readonly debriefing: number },
): LectureInfo[] {
  return s.tasks.map((t) => {
    const b = briefingFor(t.name)
    return {
      id: syllabusLectureId(s, t.code),
      name: t.name,
      revisionId: s.id,
      programName: s.program,
      briefingMinutes: b.briefing,
      flightMinutes: t.flightMinutes,
      soloMinutes: t.soloMinutes,
      debriefingMinutes: b.debriefing,
      simulator: t.simulator,
      night: t.night,
    }
  })
}

/** Briefing- és debriefing-idő a FlightLogger API-ból ismert, azonos kódú feladatokból. */
export function briefingLookup(
  apiLectures: readonly LectureInfo[],
  fallback: { readonly briefing: number; readonly debriefing: number },
): (name: string) => { readonly briefing: number; readonly debriefing: number } {
  const byKey = new Map<string, { briefing: number; debriefing: number }>()
  for (const l of apiLectures) {
    const key = keyOf(l.name)
    if (key && !byKey.has(key) && (l.briefingMinutes > 0 || l.debriefingMinutes > 0)) {
      byKey.set(key, { briefing: l.briefingMinutes || fallback.briefing, debriefing: l.debriefingMinutes || fallback.debriefing })
    }
  }
  return (name) => byKey.get(keyOf(name) ?? '') ?? fallback
}

/** A növendék programjához illő feladatsor a program és a revízió neve alapján. */
export function matchSyllabus(syllabi: readonly Pick<Syllabus, 'id'>[], programName: string | undefined, revisionName: string | undefined): string | undefined {
  if (!programName || !revisionName) return undefined
  const id = syllabusId(programName, revisionName)
  return syllabi.some((s) => s.id === id) ? id : undefined
}

/**
 * Az elkönyvelt feladatok átírása a feladatsor azonosítóira, a név kódja szerint. Amit
 * nem lehet párosítani (más program feladata), kimarad.
 */
export function mapRecordsToSyllabus(
  records: readonly TrainingRecord[],
  apiCatalog: Readonly<Record<string, Pick<LectureInfo, 'name'>>>,
  syllabus: Syllabus,
): TrainingRecord[] {
  const byKey = new Map(syllabus.tasks.map((t) => [keyOf(t.name), syllabusLectureId(syllabus, t.code)]))
  const result: TrainingRecord[] = []
  for (const r of records) {
    const name = r.lectureName ?? apiCatalog[r.lectureId]?.name
    const id = name ? byKey.get(keyOf(name)) : undefined
    if (!id) continue
    result.push({ ...r, lectureId: id, revisionId: syllabus.id, programName: syllabus.program, revisionName: syllabus.revision })
  }
  return result
}

/**
 * A növendék haladása: ha van hozzá feladatsor (kézzel választott, vagy a program és a
 * revízió neve alapján felismert), akkor annak sorrendjében; különben az API-ból ismert
 * feladatok alapján.
 */
export function resolveProgress(
  records: readonly TrainingRecord[],
  apiCatalog: Readonly<Record<string, LectureInfo>>,
  fullCatalog: Readonly<Record<string, LectureInfo>>,
  syllabi: readonly Syllabus[],
  chosenSyllabusId: string | undefined,
): StudentProgress {
  const base = computeProgress(records, apiCatalog)
  const autoId = matchSyllabus(syllabi, base.programName, base.revisionName)
  const chosen = syllabi.find((s) => s.id === (chosenSyllabusId ?? autoId))
  if (!chosen) return { ...base, ...(autoId ? { autoSyllabusId: autoId } : {}) }
  const mapped = computeProgress(mapRecordsToSyllabus(records, apiCatalog, chosen), fullCatalog, chosen.id)
  return {
    ...mapped,
    revisionId: chosen.id,
    programName: chosen.program,
    revisionName: chosen.revision,
    syllabusId: chosen.id,
    ...(autoId ? { autoSyllabusId: autoId } : {}),
  }
}
