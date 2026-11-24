import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { lectureInfoOf, type LectureInfo, type TrainingRecord } from '../../../src/core/progress/lectures'
import { mapRecordsToSyllabus, matchSyllabus, parseSyllabusFile, resolveProgress, syllabusLectures, syllabusId, type Syllabus } from '../../../src/core/progress/syllabus'

// Szintetikus feladatsor (CLAUDE.md 4. pont) a Tampermonkey-export formátumában.
const task = (order: number, name: string, extra: Record<string, unknown> = {}) => ({
  order,
  phase: `Phase ${name.split('.')[0]}`,
  code: name.split(' ')[0],
  name,
  category: 'Flight lesson',
  minutes: { vfrDual: 60 },
  flightMinutes: 60,
  simulator: false,
  night: false,
  ...extra,
})

const FILE = {
  format: 'flightbooker-feladatsor',
  formatVersion: 1,
  exportedAt: '2026-11-11T00:00:00.000Z',
  programs: [
    {
      program: 'Szintetikus ATP',
      revision: 'Revision 7',
      tasks: [
        task(1, 'I./1. Ismerkedés'),
        task(2, 'I./2. Gurulás'),
        task(3, 'II./1. Egyedül', { minutes: { vfrDual: 15, vfrSolo: 30, vfrSpic: 15 } }),
        task(4, 'II./2. Kör'),
        task(5, 'II./3. Éjszaka', { night: true, minutes: { vfrDual: 45, night: 45 }, flightMinutes: 45 }),
        task(6, 'IV./1.S. Műszeres (FNPT II.)', { simulator: true, minutes: { ifrSim: 120 }, flightMinutes: 120 }),
        { ...task(7, 'Session Removed'), code: null },
        task(8, 'II./2. Kör'),
      ],
    },
  ],
}

const parsed = parseSyllabusFile(FILE, 'teszt.json')
const SYL: Syllabus = parsed.syllabi[0]!

// Az API-ból ismert feladatok (más azonosítóval, ugyanazzal a kóddal).
const api: Record<string, LectureInfo> = Object.fromEntries(
  [
    ['901', 'I./1. Ismerkedés'],
    ['902', 'I./2. Gurulás'],
    ['903', 'II./1. Egyedül'],
    ['904', 'II./2. Kör'],
  ].map(([id, name]) => [id, { id: id!, name: name!, revisionId: 'fl-rev', briefingMinutes: 45, flightMinutes: 60, debriefingMinutes: 30, simulator: false, night: false }]),
)
const full = { ...api, ...Object.fromEntries(syllabusLectures(SYL, () => ({ briefing: 45, debriefing: 30 })).map((l) => [l.id, l])) }

const rec = (lectureId: string, day: number, extra: Partial<TrainingRecord> = {}): TrainingRecord => ({
  lectureId,
  status: 'PASSED',
  at: new Date(Date.UTC(2026, 9, day, 10)).toISOString(),
  revisionId: 'fl-rev',
  programName: 'Szintetikus ATP',
  revisionName: 'Revision 7',
  lectureName: api[lectureId]?.name,
  ...extra,
})

describe('feladatsor-fájl beolvasása', () => {
  it('a kód nélküli és az ismétlődő sorokat kihagyja, a sorrendet megtartja', () => {
    expect(parsed.errors).toEqual([])
    expect(SYL.id).toBe(syllabusId('Szintetikus ATP', 'Revision 7'))
    expect(SYL.tasks.map((t) => t.code)).toEqual(['I./1.', 'I./2.', 'II./1.', 'II./2.', 'II./3.', 'IV./1.S.'])
  })

  it('az egyedül és SPIC-ként repült perceket külön tartja (a fizetett idő kimutatásához)', () => {
    const lectures = syllabusLectures(SYL, () => ({ briefing: 45, debriefing: 30 }))
    expect(lectures.find((l) => l.name === 'II./1. Egyedül')?.soloMinutes).toBe(45)
    expect(lectures.find((l) => l.name === 'I./1. Ismerkedés')?.soloMinutes).toBe(0)
    expect(lectureInfoOf({ id: 'x', name: 'II./1.', vfrDualMinutes: 20, vfrSoloMinutes: 40 }).soloMinutes).toBe(40)
    expect(lectureInfoOf({ id: 'y', name: 'II./2.' }).soloMinutes).toBeUndefined()
  })

  it('a hibás fájlt jelzi, de nem dob kivételt', () => {
    expect(parseSyllabusFile({ format: 'más' }, 'rossz.json').errors[0]).toMatch(/rossz\.json/)
  })

  it('a katalógusban a feladat fajtáját és nappali jellegét viszi', () => {
    const lectures = syllabusLectures(SYL, () => ({ briefing: 40, debriefing: 20 }))
    expect(lectures.find((l) => l.name.startsWith('IV./1.S.'))).toMatchObject({ simulator: true, flightMinutes: 120, briefingMinutes: 40, revisionId: SYL.id })
    expect(lectures.find((l) => l.name.startsWith('II./3.'))).toMatchObject({ night: true, flightMinutes: 45 })
  })
})

describe('revízió és haladás', () => {
  it('a program és a revízió neve alapján felismeri a feladatsort (kis-nagybetű és szóköz nem számít)', () => {
    expect(matchSyllabus([SYL], 'szintetikus  ATP', 'revision 7')).toBe(SYL.id)
    expect(matchSyllabus([SYL], 'Szintetikus ATP', 'Revision 6')).toBeUndefined()
  })

  it('az elkönyvelt feladatokat kód szerint párosítja, a más program feladatát elhagyja', () => {
    const mapped = mapRecordsToSyllabus([rec('901', 1), rec('999', 2, { lectureName: 'X./1. Idegen' })], api, SYL)
    expect(mapped.map((r) => r.lectureId)).toEqual([`syl:${SYL.id}:I./1.`])
  })

  it('a felismert revízió szerint adja a következő feladatot, a még senki által nem repültet is', () => {
    const p = resolveProgress([rec('901', 1), rec('902', 2), rec('903', 3), rec('904', 4)], api, full, [SYL], undefined)
    expect(p.syllabusId).toBe(SYL.id)
    expect(p.autoSyllabusId).toBe(SYL.id)
    expect(full[p.nextLectureId!]!.name).toBe('II./3. Éjszaka')
  })

  it('az egyedi feladat (Custom lesson) teljesít, de nem viszi vissza a helyet', () => {
    const records = [rec('901', 1), rec('902', 2), rec('903', 3), rec('901', 4, { custom: true })]
    const p = resolveProgress(records, api, full, [SYL], undefined)
    expect(full[p.lastLectureId!]!.name).toBe('II./1. Egyedül')
    expect(full[p.nextLectureId!]!.name).toBe('II./2. Kör')
  })

  it('kézzel választott revíziónál azt használja, és jelzi a felismertet is', () => {
    const other: Syllabus = { ...SYL, id: syllabusId('Szintetikus ATP', 'Revision 6'), revision: 'Revision 6' }
    const p = resolveProgress([rec('901', 1)], api, full, [SYL, other], other.id)
    expect(p.syllabusId).toBe(other.id)
    expect(p.autoSyllabusId).toBe(SYL.id)
  })

  it('elkönyvelt feladat nélkül, kézzel választott revíziónál annak első feladata jön', () => {
    const p = resolveProgress([], api, { ...full, x: { id: 'x', name: 'I./1. Más program', briefingMinutes: 0, flightMinutes: 0, debriefingMinutes: 0, simulator: false, night: false } }, [SYL], SYL.id)
    expect(p.nextLectureId).toBe(`syl:${SYL.id}:I./1.`)
  })

  it('feladatsor nélkül az API-ból ismert feladatokkal dolgozik', () => {
    const p = resolveProgress([rec('901', 1)], api, full, [], undefined)
    expect(p.syllabusId).toBeUndefined()
    expect(p.nextLectureId).toBe('902')
  })
})

describe('a feladatsorok/ mappa fájljai', () => {
  const dir = join(__dirname, '../../../feladatsorok')
  const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

  it.each(files)('%s hibátlanul betölthető, és nincs benne személyes adat', (file) => {
    const text = readFileSync(join(dir, file), 'utf8')
    const result = parseSyllabusFile(JSON.parse(text), file)
    expect(result.errors).toEqual([])
    expect(result.syllabi.length).toBeGreaterThan(0)
    for (const s of result.syllabi) expect(s.tasks.length).toBeGreaterThan(100)
    expect(text).not.toMatch(/flightlogger\.net|user_lectures|\d{2}\.\d{2}\.20\d{2}/)
  })
})
