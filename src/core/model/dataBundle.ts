import type { LectureInfo, StudentProgress, TrainingRecord } from '../progress/lectures'
import type { Syllabus } from '../progress/syllabus'
import type { Snapshot } from './snapshot'
import type { IsoDateTime } from './time'

/**
 * Egy adatfrissítés eredménye (ADT-01–07). A névjegyzék csak memóriában él (3.3):
 * a felület ebből jeleníti meg a neveket, a beállítási és a tervezetfájlba nem kerül.
 */
export interface DirectoryPerson {
  readonly name: string
  readonly role: 'student' | 'instructor'
  /**
   * A FlightLogger-kód (`callSign`): a FlightLogger választói „KÓD - Név” alakban írják ki az
   * embereket, az import ezzel keres (FLI-02). Csak memóriában, mint a név.
   */
  readonly callSign?: string
}

/** Osztály (növendékcsoport) a FlightLoggerből, elmélet-foglaláshoz. */
export interface DirectoryClass {
  readonly name: string
  readonly memberIds: readonly string[]
}

export interface Directory {
  readonly people: Readonly<Record<string, DirectoryPerson>>
  readonly classrooms: Readonly<Record<string, string>>
  /** Ismert feladatok (Lecture) a tervezett időtartamokkal, programrevízióval. */
  readonly lectures: Readonly<Record<string, LectureInfo>>
  /** Osztályok tagsággal (az elmélethez ideiglenesen hozzáadhatók). */
  readonly classes: Readonly<Record<string, DirectoryClass>>
}

export interface DataBundle {
  readonly source: 'live' | 'demo'
  /** Az adatfrissítés ideje (ALP-08). */
  readonly fetchedAt: IsoDateTime
  readonly snapshot: Snapshot
  readonly directory: Directory
  /** A hozzárendelt növendékek haladása (SZB-02): utolsó és soron következő feladat. */
  readonly progress: Readonly<Record<string, StudentProgress>>
  /** A betöltött feladatsorok (a `feladatsorok/` mappákból). */
  readonly syllabi: readonly Syllabus[]
  /** Hibás vagy nem olvasható feladatsor-fájlok. */
  readonly syllabusErrors: readonly string[]
  /** A hozzárendelt növendékek elkönyvelt feladatai: a revízióváltás azonnal újraszámolható. */
  readonly trainingRecords: Readonly<Record<string, readonly TrainingRecord[]>>
  /** Nem végzetes hibák részletenként (például az időjárás nem jött meg). */
  readonly errors: readonly string[]
}
