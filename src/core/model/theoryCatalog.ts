/**
 * A FlightLogger programlistája az elméleti foglaláshoz (FLI-11): a programok revíziónként (a
 * FlightLogger ablakában „program revízió” felirattal) és a revíziók tárgyai (Subject). Csak
 * program- és tárgynevek, személyes adat nincs benne.
 */

export interface TheoryProgramOption {
  readonly revisionId: string
  readonly programId: string
  readonly programName: string
  readonly revisionName: string
  /** A FlightLogger listájának felirata: „ATP(A) Integrated Ground School Revision 6”. */
  readonly label: string
  readonly programType?: 'FLIGHT_TRAINING' | 'GROUND_TRAINING' | 'COMBINED_SYLLABUS'
}

export interface TheorySubjectOption {
  readonly id: string
  readonly name: string
  readonly revisionId: string
}

export interface TheoryCatalog {
  readonly fetchedAt: string
  readonly source: 'live' | 'cache' | 'demo'
  readonly programs: readonly TheoryProgramOption[]
  readonly subjects: readonly TheorySubjectOption[]
  /** Nem végzetes hibák (például a kulccsal üres a programlista). */
  readonly errors: readonly string[]
}

/** A program felirata a FlightLogger listájában. */
export const programLabel = (programName: string, revisionName: string): string => [programName, revisionName].map((s) => s.trim()).filter(Boolean).join(' ')

/** Elméleti foglaláshoz illő programok: Ground training és vegyes; ha nincs ilyen, mind. */
export function groundPrograms(catalog: Pick<TheoryCatalog, 'programs'>): readonly TheoryProgramOption[] {
  const ground = catalog.programs.filter((p) => p.programType === 'GROUND_TRAINING' || p.programType === 'COMBINED_SYLLABUS')
  return ground.length > 0 ? ground : catalog.programs
}

export const subjectsOf = (catalog: Pick<TheoryCatalog, 'subjects'>, revisionId: string | undefined): readonly TheorySubjectOption[] =>
  revisionId ? catalog.subjects.filter((s) => s.revisionId === revisionId) : []
