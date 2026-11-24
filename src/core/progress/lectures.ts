import type { Durations, RequestKind } from '../model/planning'

/**
 * Feladatok (Lecture) és a növendék haladása (SZB-02, 7.5, K36).
 *
 * Felderítés, 2026-11-11: az iskolai kulccsal a program szerkezete (fázisok, feladatlista)
 * nem olvasható – a `programPhases` elemei `null`-ok, a `userPrograms` üres. A feladatokat
 * ezért az elkönyvelt feladatokból (Training → Lecture) és a foglalások tervezett
 * feladataiból gyűjtjük össze, programrevíziónként.
 *
 * A sorrendet a feladat nevének kódja adja („II./19.”, „IV./3.S.”), nem a FlightLogger által
 * visszaadott sorrend és nem az azonosító: az AugmentFlogger a fázisok és feladatok listáját
 * egyszerűen megfordította, és ez néhol rossz sorrendet adott.
 */

export interface LectureInfo {
  readonly id: string
  readonly name: string
  /** A programrevízió azonosítója, amelyhez a feladat tartozik (ha ismert). */
  readonly revisionId?: string
  readonly programName?: string
  readonly briefingMinutes: number
  /** A tervezett repült vagy szimulátoros idő (a Lecture VFR/IFR perceinek összege). */
  readonly flightMinutes: number
  readonly debriefingMinutes: number
  /**
   * A repült időből (`flightMinutes`) ennyi az, amikor a növendék egyedül vagy SPIC-ként repül,
   * az oktató nincs a gépen (a fizetett idő kimutatásában tájékoztatásul). Hiányzik, ha a feladat
   * percei nem ismertek.
   */
  readonly soloMinutes?: number
  /** Csak szimulátoros idő van benne (FNPT). */
  readonly simulator: boolean
  /** Éjszakai repülés is van benne: nem nappali feladat. */
  readonly night: boolean
}

/** A Lecture tervezett percei, ahogy a FlightLoggerből jönnek. */
export interface LectureMinutes {
  readonly briefingMinutes: number
  readonly debriefingMinutes: number
  readonly vfrDualMinutes: number
  readonly vfrSoloMinutes: number
  readonly vfrSpicMinutes: number
  readonly vfrSimMinutes: number
  readonly ifrDualMinutes: number
  readonly ifrSimMinutes: number
  readonly ifrSpicMinutes: number
  readonly nightMinutes: number
}

export function lectureInfoOf(
  lecture: { readonly id: string; readonly name: string } & Partial<LectureMinutes>,
  program?: { readonly revisionId?: string | undefined; readonly programName?: string | undefined },
): LectureInfo {
  const n = (v: number | undefined): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const sim = n(lecture.vfrSimMinutes) + n(lecture.ifrSimMinutes)
  const real = n(lecture.vfrDualMinutes) + n(lecture.vfrSoloMinutes) + n(lecture.vfrSpicMinutes) + n(lecture.ifrDualMinutes) + n(lecture.ifrSpicMinutes)
  const solo = n(lecture.vfrSoloMinutes) + n(lecture.vfrSpicMinutes) + n(lecture.ifrSpicMinutes)
  return {
    id: lecture.id,
    name: lecture.name,
    ...(program?.revisionId ? { revisionId: program.revisionId } : {}),
    ...(program?.programName ? { programName: program.programName } : {}),
    briefingMinutes: n(lecture.briefingMinutes),
    flightMinutes: sim + real,
    ...(sim + real > 0 ? { soloMinutes: solo } : {}),
    debriefingMinutes: n(lecture.debriefingMinutes),
    simulator: sim > 0 && real === 0,
    night: n(lecture.nightMinutes) > 0,
  }
}

const ROMAN: Readonly<Record<string, number>> = { I: 1, V: 5, X: 10, L: 50, C: 100 }

function romanToInt(roman: string): number | undefined {
  let total = 0
  for (let i = 0; i < roman.length; i++) {
    const v = ROMAN[roman[i]!]
    const next = ROMAN[roman[i + 1] ?? '']
    if (v === undefined) return undefined
    total += next !== undefined && next > v ? -v : v
  }
  return total
}

/**
 * Sorrendkulcs a feladat nevéből: „III./17. PIC …” → [3, 17]. A „Custom lesson - ” előtag
 * nem számít. Kód nélküli névnél `undefined` (ezek a kódoltak után következnek).
 */
export function lectureOrderKey(name: string): readonly [number, number] | undefined {
  const m = /^\s*(?:custom lesson\s*-\s*)?([IVXLC]+)\s*\.?\s*\/\s*(\d+)/i.exec(name)
  if (!m) return undefined
  const phase = romanToInt(m[1]!.toUpperCase())
  return phase === undefined ? undefined : [phase, Number(m[2])]
}

/** Feladatok sorrendje: névkód, azon belül (és kód nélkül) a numerikus azonosító. */
export function compareLectures(a: Pick<LectureInfo, 'id' | 'name'>, b: Pick<LectureInfo, 'id' | 'name'>): number {
  const ka = lectureOrderKey(a.name)
  const kb = lectureOrderKey(b.name)
  if (ka && kb) {
    if (ka[0] !== kb[0]) return ka[0] - kb[0]
    if (ka[1] !== kb[1]) return ka[1] - kb[1]
  } else if (ka || kb) {
    return ka ? -1 : 1
  }
  const na = Number(a.id)
  const nb = Number(b.id)
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb
  return a.id.localeCompare(b.id) || a.name.localeCompare(b.name)
}

/** Feladatkatalógus: azonos azonosítónál a több adatot hordozó (revízióval ellátott) változat marad. */
export function mergeCatalog(...lists: ReadonlyArray<readonly LectureInfo[]>): Record<string, LectureInfo> {
  const result: Record<string, LectureInfo> = {}
  for (const list of lists) {
    for (const l of list) {
      const prev = result[l.id]
      if (!prev || (!prev.revisionId && l.revisionId)) result[l.id] = l
    }
  }
  return result
}

/** Egy program feladatai sorrendben. Revízió nélkül az összes ismert feladat. */
export function programLectures(catalog: Readonly<Record<string, LectureInfo>>, revisionId: string | undefined): LectureInfo[] {
  return Object.values(catalog)
    .filter((l) => revisionId === undefined || l.revisionId === revisionId)
    .sort(compareLectures)
}

/** Egy elkönyvelt feladat a haladáshoz. */
export interface TrainingRecord {
  readonly lectureId: string
  readonly status: 'CREDITED' | 'FAILED' | 'NOT_FLOWN' | 'PARTIALLY_COMPLETED' | 'PASSED'
  /** A repülés kezdete, ennek híján a rögzítés ideje. */
  readonly at: string | undefined
  readonly revisionId?: string
  readonly programName?: string
  readonly revisionName?: string
  /** A feladat neve (a feladatsorral való párosításhoz, a kód miatt). */
  readonly lectureName?: string
  /** „Custom lesson”: egyedi feladat, egy meglévő feladat ismétlése vagy pótlása. */
  readonly custom?: boolean
}

export interface StudentProgress {
  readonly revisionId?: string
  readonly programName?: string
  readonly revisionName?: string
  /** A használt feladatsor (kézzel választott vagy felismert). */
  readonly syllabusId?: string
  /** A program és a revízió neve alapján felismert feladatsor, ha van. */
  readonly autoSyllabusId?: string
  /** Teljesített (PASSED vagy CREDITED) feladatok. */
  readonly passedLectureIds: readonly string[]
  /** A legutóbb repült feladat és eredménye. */
  readonly lastLectureId?: string
  readonly lastStatus?: TrainingRecord['status']
  readonly lastAt?: string
  /** A soron következő feladat (lásd `nextLecture`). */
  readonly nextLectureId?: string
}

const DONE: ReadonlySet<TrainingRecord['status']> = new Set(['PASSED', 'CREDITED'])

/**
 * A soron következő feladat. A növendékek nem mindig szigorú sorrendben haladnak (a 58_KOG
 * például a III./25-öt a III./16 előtt repülte), ezért a legutóbb repült feladat a kiindulópont:
 * - ha az nem sikerült, ugyanazt kell ismételni;
 * - különben az utána következő, még nem teljesített feladat;
 * - ha utána nincs ilyen, az első még nem teljesített feladat a programban.
 * A már ezen a héten igényelt feladatokat (`exclude`) átugorja.
 */
export function nextLecture(
  ordered: readonly LectureInfo[],
  passed: ReadonlySet<string>,
  last: { readonly lectureId: string; readonly status: TrainingRecord['status'] } | undefined,
  exclude: ReadonlySet<string> = new Set(),
): LectureInfo | undefined {
  const open = (l: LectureInfo): boolean => !passed.has(l.id) && !exclude.has(l.id)
  if (last && !DONE.has(last.status) && last.status !== 'NOT_FLOWN' && !passed.has(last.lectureId) && !exclude.has(last.lectureId)) {
    const same = ordered.find((l) => l.id === last.lectureId)
    if (same) return same
  }
  const from = last ? ordered.findIndex((l) => l.id === last.lectureId) : -1
  if (from >= 0) {
    const after = ordered.slice(from + 1).find(open)
    if (after) return after
  }
  // Ha a kiválasztott (kizárt) feladat után nincs több, a kizárt utánit keressük.
  if (exclude.size > 0) {
    const lastExcluded = Math.max(-1, ...ordered.map((l, i) => (exclude.has(l.id) ? i : -1)))
    const afterExcluded = ordered.slice(lastExcluded + 1).find(open)
    if (afterExcluded) return afterExcluded
  }
  return ordered.find(open)
}

/** A növendék haladása az elkönyvelt feladataiból. */
export function computeProgress(records: readonly TrainingRecord[], catalog: Readonly<Record<string, LectureInfo>>, revisionOverride?: string): StudentProgress {
  const passed = new Set(records.filter((r) => DONE.has(r.status)).map((r) => r.lectureId))
  const dated = records.filter((r) => r.status !== 'NOT_FLOWN' && r.at !== undefined).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!) || a.lectureId.localeCompare(b.lectureId))
  // Az egyedi feladat („Custom lesson”) egy korábbi feladat ismétlése: teljesítettnek
  // számít, de nem viszi vissza a növendék helyét a programban.
  const last = dated.filter((r) => !r.custom).at(-1) ?? dated.at(-1)
  // Az aktuális program: a legutóbbi feladaté; ha annak nincs revíziója, a leggyakoribb.
  // A kézzel választott feladatsor akkor is érvényes, ha a növendéknek még nincs elkönyvelt feladata.
  const revisionId = revisionOverride ?? last?.revisionId ?? mostCommon(records.map((r) => r.revisionId).filter((r): r is string => r !== undefined))
  const programName = records.find((r) => r.revisionId === revisionId && r.programName)?.programName
  const revisionName = records.find((r) => r.revisionId === revisionId && r.revisionName)?.revisionName
  const ordered = programLectures(catalog, revisionId)
  const next = nextLecture(ordered, passed, last)
  return {
    ...(revisionId ? { revisionId } : {}),
    ...(programName ? { programName } : {}),
    ...(revisionName ? { revisionName } : {}),
    passedLectureIds: [...passed].sort(),
    ...(last ? { lastLectureId: last.lectureId, lastStatus: last.status, ...(last.at ? { lastAt: last.at } : {}) } : {}),
    ...(next ? { nextLectureId: next.id } : {}),
  }
}

function mostCommon(values: readonly string[]): string | undefined {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | undefined
  for (const [v, c] of counts) if (best === undefined || c > counts.get(best)! || (c === counts.get(best)! && v < best)) best = v
  return best
}

/** Az igény adatai a feladatból: időtartamok, fajta, nappali-e (SZB-02, SZB-12). */
export function requestShapeFromLecture(
  lecture: LectureInfo,
  fallback: Durations,
): { readonly kind: Extract<RequestKind, 'flight' | 'simulator'>; readonly durations: Durations; readonly daylightOnly: boolean } {
  const kind = lecture.simulator ? 'simulator' : 'flight'
  return {
    kind,
    durations: {
      briefing: lecture.briefingMinutes > 0 ? lecture.briefingMinutes : fallback.briefing,
      main: lecture.flightMinutes > 0 ? lecture.flightMinutes : fallback.main,
      debriefing: lecture.debriefingMinutes > 0 ? lecture.debriefingMinutes : fallback.debriefing,
    },
    daylightOnly: kind === 'flight' && !lecture.night,
  }
}

/** A legutóbb repült feladatot kell-e ismételni (nem sikerült), ahogy a `nextLecture` is dönt. */
export function repeatsLastLecture(progress: StudentProgress): boolean {
  const { lastLectureId, lastStatus } = progress
  return lastLectureId !== undefined && lastStatus !== undefined && !DONE.has(lastStatus) && lastStatus !== 'NOT_FLOWN' && !progress.passedLectureIds.includes(lastLectureId)
}

/**
 * A növendék következő feladata a tervezett hétre. A héten már igényelt feladatokat
 * (`alreadyRequested`) átugorja, így egy második igény a rákövetkező feladatot kapja.
 */
export function suggestNextLecture(
  progress: StudentProgress | undefined,
  catalog: Readonly<Record<string, LectureInfo>>,
  alreadyRequested: ReadonlySet<string> = new Set(),
): LectureInfo | undefined {
  if (!progress) return undefined
  if (alreadyRequested.size === 0 && progress.nextLectureId) return catalog[progress.nextLectureId]
  const last = progress.lastLectureId && progress.lastStatus ? { lectureId: progress.lastLectureId, status: progress.lastStatus } : undefined
  return nextLecture(programLectures(catalog, progress.revisionId), new Set(progress.passedLectureIds), last, alreadyRequested)
}
