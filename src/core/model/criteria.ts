/**
 * Súlyozott feltételek (7.3, SZB-10). A súly 0–100%: 0 = nem számít, 100 = legerősebb,
 * de soha nem kizáró. A végső pont a részpontok súlyozott átlaga.
 */
export const CRITERIA = [
  'weatherFlight',
  'longNoFly',
  'scarcity',
  'badWeatherFit',
  'priority',
  'planStability',
  'aircraftReserve',
  'preferredAircraft',
  'avoidFirstFlight',
  'dayOrder',
  'instructorLoad',
  'instructorContinuity',
  'preferredClassroom',
  'classroomSize',
] as const

export type Criterion = (typeof CRITERIA)[number]

export type Weights = Readonly<Record<Criterion, number>>

export const CRITERION_LABELS: Readonly<Record<Criterion, string>> = {
  weatherFlight: 'Időjárás repülésnél',
  longNoFly: 'Régen repült növendék',
  scarcity: 'Szűkösség',
  badWeatherFit: 'Rossz idő illesztése',
  priority: 'Foglalási prioritás',
  planStability: 'Terv stabilitása',
  aircraftReserve: 'Gépóra-tartalék',
  preferredAircraft: 'Preferált gép',
  avoidFirstFlight: 'Kevesebb motorpróba',
  dayOrder: 'Időbeli sorrend',
  instructorLoad: 'Oktató napi terhelése',
  instructorContinuity: 'Folyamatos oktatói program',
  preferredClassroom: 'Preferált terem',
  classroomSize: 'Megfelelő teremméret',
}

/** Mit mér a feltétel (7.3 táblázat „Mit mér” oszlopa), a súlyszerkesztő magyarázatához. */
export const CRITERION_HINTS: Readonly<Record<Criterion, string>> = {
  weatherFlight: 'Mennyire esik az óra a növendék limitjein belülre.',
  longNoFly: 'Az utolsó repülés óta eltelt napok a küszöbhöz képest, szokatlan gépen csökkentett előnnyel.',
  scarcity: 'Hány elfogadható hely marad az igénynek a héten.',
  badWeatherFit: 'Mennyire rossz repülésre az óra, elméletnél és szimulátornál.',
  priority: 'A növendék 1–5-ös prioritása, ha két növendék verseng.',
  planStability: 'Újratervezéskor mennyire tér el a korábbi tervtől.',
  aircraftReserve: 'Mennyi idő marad a gépben a heti foglalások után.',
  preferredAircraft: 'A preferált gép vagy géptípus jut-e a növendéknek.',
  avoidFirstFlight: 'Lehetőleg olyan gépre kerüljön a foglalás, amely aznap már repül, mert a napi első repülés motorpróbája sok idő.',
  dayOrder: 'Mennyire követi a növendékek preferált sorrendjét.',
  instructorLoad: 'Mennyire egyenletes a heti beosztás.',
  instructorContinuity: 'Ne maradjon nagy üresjárat az oktató napján: a foglalás a nap többi foglalásához közel kerüljön (fél óráig nincs levonás, 3 óra szünetnél már nem ér pontot).',
  preferredClassroom: 'A preferált terem jut-e az elméletnek.',
  classroomSize: 'A legkisebb terem, amelybe a résztvevők még beférnek; a nagyobb termek szabadon maradnak.',
}
