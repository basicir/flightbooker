import { describe, expect, it } from 'vitest'
import {
  compareLectures,
  computeProgress,
  lectureInfoOf,
  lectureOrderKey,
  mergeCatalog,
  nextLecture,
  programLectures,
  suggestNextLecture,
  type LectureInfo,
  type TrainingRecord,
} from '../../../src/core/progress/lectures'

// Szintetikus feladatlista (CLAUDE.md 4. pont): a nevek kódja a valós iskolai mintát követi.
const L = (id: string, name: string, extra: Partial<LectureInfo> = {}): LectureInfo => ({
  id,
  name,
  revisionId: 'rev',
  briefingMinutes: 45,
  flightMinutes: 60,
  debriefingMinutes: 30,
  simulator: false,
  night: false,
  ...extra,
})

const CATALOG = mergeCatalog([
  L('110', 'II./1. Szintetikus egyedül'),
  L('101', 'I./1. Szintetikus ismerkedés'),
  L('103', 'I./3. Szintetikus forduló'),
  L('102', 'I./2. Szintetikus gurulás'),
  L('111', 'II./2. Szintetikus kör'),
  L('112', 'II./10. Szintetikus útvonal'),
  L('113', 'II./9. Szintetikus egyedül'),
  L('120', 'III./1. Szintetikus éjszaka', { night: true }),
  L('130', 'IV./1.S. Szintetikus műszeres (FNPT II.)', { simulator: true }),
  L('199', 'Szintetikus kód nélküli'),
  L('900', 'I./1. Másik program', { revisionId: 'masik' }),
])

const rec = (lectureId: string, status: TrainingRecord['status'], day: number): TrainingRecord => ({
  lectureId,
  status,
  at: new Date(Date.UTC(2026, 9, day, 9)).toISOString(),
  revisionId: 'rev',
  programName: 'Szintetikus ATP',
})

describe('feladatsorrend a név kódjából', () => {
  it('felismeri a fázist és a sorszámot, a „Custom lesson” előtagot is', () => {
    expect(lectureOrderKey('III./17. PIC traffic patterns I.')).toEqual([3, 17])
    expect(lectureOrderKey('IV./3.S. Getting the grips')).toEqual([4, 3])
    expect(lectureOrderKey('V./1 Advanced UPRT I.')).toEqual([5, 1])
    expect(lectureOrderKey('Custom lesson - II./4. Dual visual circuits III.')).toEqual([2, 4])
    expect(lectureOrderKey('Szabad repülés')).toBeUndefined()
  })

  it('a fázist és a sorszámot számként rendezi (II./9 a II./10 előtt), a kód nélküli a végére kerül', () => {
    expect(programLectures(CATALOG, 'rev').map((l) => l.id)).toEqual(['101', '102', '103', '110', '111', '113', '112', '120', '130', '199'])
    expect(compareLectures({ id: '5', name: 'II./9. a' }, { id: '4', name: 'II./10. b' })).toBeLessThan(0)
  })

  it('a program szerint szűr', () => {
    expect(programLectures(CATALOG, 'masik').map((l) => l.id)).toEqual(['900'])
  })
})

describe('a Lecture tervezett percei', () => {
  it('összeadja a repült perceket, a szimulátort és az éjszakát felismeri', () => {
    const base = { briefingMinutes: 45, debriefingMinutes: 30, vfrDualMinutes: 0, vfrSoloMinutes: 0, vfrSpicMinutes: 0, vfrSimMinutes: 0, ifrDualMinutes: 0, ifrSimMinutes: 0, ifrSpicMinutes: 0, nightMinutes: 0 }
    expect(lectureInfoOf({ id: '1', name: 'x', ...base, vfrSoloMinutes: 40, nightMinutes: 40 }, { revisionId: 'r' })).toMatchObject({ flightMinutes: 40, night: true, simulator: false, revisionId: 'r' })
    expect(lectureInfoOf({ id: '2', name: 'y', ...base, ifrSimMinutes: 120 })).toMatchObject({ flightMinutes: 120, simulator: true })
    expect(lectureInfoOf({ id: '3', name: 'z', ...base, vfrSpicMinutes: 90 })).toMatchObject({ flightMinutes: 90, simulator: false, night: false })
  })
})

describe('a soron következő feladat', () => {
  it('a legutóbb repült feladat utáni első teljesítetlen, akkor is, ha a növendék előreszaladt', () => {
    // Előbb a II./10-et repülte, utoljára az I./2-t: a következő az I./3.
    const p = computeProgress([rec('101', 'PASSED', 1), rec('112', 'PASSED', 2), rec('102', 'PASSED', 3)], CATALOG)
    expect(p).toMatchObject({ revisionId: 'rev', programName: 'Szintetikus ATP', lastLectureId: '102', nextLectureId: '103' })
  })

  it('a már teljesített (például egyedi feladatként repült) feladatokat átugorja', () => {
    const p = computeProgress([rec('101', 'PASSED', 1), rec('103', 'PASSED', 2), rec('110', 'PASSED', 3), rec('102', 'PASSED', 4)], CATALOG)
    expect(p.nextLectureId).toBe('111')
  })

  it('sikertelen feladat után ugyanazt ismétli', () => {
    const p = computeProgress([rec('101', 'PASSED', 1), rec('102', 'FAILED', 2)], CATALOG)
    expect(p.nextLectureId).toBe('102')
  })

  it('a lista végén az első kihagyott feladatra lép vissza', () => {
    const records = programLectures(CATALOG, 'rev').filter((l) => l.id !== '111').map((l, i) => rec(l.id, 'PASSED', i + 1))
    expect(computeProgress(records, CATALOG).nextLectureId).toBe('111')
  })

  it('új növendéknél az első feladat', () => {
    expect(nextLecture(programLectures(CATALOG, 'rev'), new Set(), undefined)?.id).toBe('101')
  })

  it('a héten már igényelt feladat után a rákövetkezőt javasolja', () => {
    const p = computeProgress([rec('101', 'PASSED', 1)], CATALOG)
    expect(suggestNextLecture(p, CATALOG)?.id).toBe('102')
    expect(suggestNextLecture(p, CATALOG, new Set(['102']))?.id).toBe('103')
    expect(suggestNextLecture(p, CATALOG, new Set(['102', '103']))?.id).toBe('110')
  })
})
