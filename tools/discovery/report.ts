import type {
  AircraftData,
  BookingsData,
  BookingStats,
  CheckOutcome,
  DiscoveryResult,
  UnpublishedData,
  AvailabilityData,
  WeatherModelData,
} from './checks'
import { formatCounts, formatDistribution, formatNumber, formatRatio } from './stats'

/**
 * A felderítő jelentés Markdown-szövege. Csak a `DiscoveryResult` névtelen
 * összesítéseiből dolgozik; nevet, e-mailt, kommentet és azonosítót nem kap meg.
 */

const DWD_VISIBILITY_DEADLINE = '2026-11-30'

interface Answer {
  readonly question: string
  readonly answer: string
  readonly evidence: string
}

function outcomeNote(outcome: CheckOutcome<unknown>): string | undefined {
  if (outcome.status === 'hiba') return `_Hiba: ${outcome.error ?? 'ismeretlen'}_`
  if (outcome.status === 'kihagyva') return `_Kihagyva: ${outcome.error ?? ''}_`
  return undefined
}

const cell = (value: string | number | null | undefined): string =>
  value === null || value === undefined || value === '' ? '–' : String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ')

function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null | undefined>>): string {
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  return [head, sep, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)].join('\n')
}

// ---------- Első olvasat a nyitott kérdésekre ----------

export function answerAircraftVisibility(aircraft: CheckOutcome<AircraftData>, bookings: CheckOutcome<BookingsData>): Answer {
  const question = 'K02 – Minden gépet lát a kulcs?'
  if (aircraft.status !== 'ok' || !aircraft.data) return { question, answer: 'Nem eldönthető', evidence: aircraft.error ?? '' }
  const a = aircraft.data
  const parts = [`${a.total} aktív erőforrás (${formatCounts(a.byClass)})`]
  let answer = 'Valószínűleg igen – vesd össze a flottalistával'
  if (bookings.status === 'ok' && bookings.data) {
    const all = bookings.data.all
    parts.push(`a teljes nézetben ${all.distinctAircraft} gépen van foglalás, ${all.aircraftWithoutBookings ?? '–'} gépen nincs`)
    parts.push(`gép nélküli repülési foglalás: ${formatRatio(all.aircraftNullRatio)}`)
    if ((all.aircraftNullRatio ?? 0) > 0) answer = 'Részben: egyes foglalásoknál a gép rejtett (jogosultság)'
  }
  return { question, answer, evidence: parts.join('; ') }
}

export function answerOtherInstructors(bookings: CheckOutcome<BookingsData>): Answer {
  const question = 'K02 – Látszanak más oktatók foglalásai?'
  if (bookings.status !== 'ok' || !bookings.data) return { question, answer: 'Nem eldönthető', evidence: bookings.error ?? '' }
  const { own, all } = bookings.data
  const evidence = `saját nézet ${own.total}, teljes nézet ${all.total} foglalás; más oktatóhoz kötött: ${all.otherInstructor}; különböző oktatók: ${all.distinctInstructors}; oktató mező kitöltve: ${formatRatio(all.instructorPresentRatio)}`
  if (all.otherInstructor > 0) {
    const partial = (all.instructorPresentRatio ?? 1) < 1
    return { question, answer: partial ? 'Igen, de egyes foglalásoknál az oktató rejtett' : 'Igen', evidence }
  }
  if (all.total <= own.total) return { question, answer: 'Nem: az all: true nem ad több foglalást – jogosultság kellhet', evidence }
  return { question, answer: 'Részben: több foglalás látszik, de oktató nélkül', evidence }
}

export function answerStudentBookings(bookings: CheckOutcome<BookingsData>): Answer {
  const question = 'K02 – Látszanak a növendékek más oktatóval tartott foglalásai?'
  if (bookings.status !== 'ok' || !bookings.data) return { question, answer: 'Nem eldönthető', evidence: bookings.error ?? '' }
  const d = bookings.data
  const evidence = `${d.ownStudents} saját növendék az ablakban; más oktatóval: ${d.ownStudentsBookingsWithOtherInstructor}; oktató nélkül: ${d.ownStudentsBookingsWithoutInstructor}`
  if (d.ownStudents === 0) return { question, answer: 'Nem eldönthető: nincs saját növendék a vizsgált ablakban', evidence }
  if (d.ownStudentsBookingsWithOtherInstructor > 0) return { question, answer: 'Igen', evidence }
  return { question, answer: 'Nem látszik ilyen – lehet, hogy nincs is; egy ismert esettel ellenőrizd', evidence }
}

export function answerTimeLeft(aircraft: CheckOutcome<AircraftData>): Answer {
  const question = 'Mit jelent a timeLeft és a nextService?'
  if (aircraft.status !== 'ok' || !aircraft.data) return { question, answer: 'Nem eldönthető', evidence: aircraft.error ?? '' }
  const rows = aircraft.data.maintenance.filter((r) => r.aircraftClass !== 'SIMULATOR')
  const comparable = rows.filter((r) => r.timeLeft !== null && r.derivedHoursToService !== null)
  const matching = comparable.filter((r) => Math.abs((r.timeLeft ?? 0) - (r.derivedHoursToService ?? 0)) <= 0.15)
  const withTimeLeft = rows.filter((r) => r.timeLeft !== null).length
  const units = [...new Set(rows.map((r) => r.warningMeasurement).filter(Boolean))].join(', ') || '–'
  const evidence = `${withTimeLeft}/${rows.length} gépnél van timeLeft; mértékegység: ${units}; ${matching.length}/${comparable.length} gépnél egyezik a nextPrimaryService − primaryLog különbséggel`
  if (comparable.length > 0 && matching.length === comparable.length) {
    return { question, answer: 'Valószínűleg a következő szervizig hátralévő óra – vesd össze a reggeli dokumentummal', evidence }
  }
  return { question, answer: 'Nem egyértelmű – a 2. rész táblázatát vesd össze a maintenance crew reggeli dokumentumával', evidence }
}

export function answerUnpublished(unpublished: CheckOutcome<UnpublishedData>): Answer {
  const question = 'Megjelennek a nem publikált foglalások?'
  if (unpublished.status !== 'ok' || !unpublished.data) return { question, answer: 'Nem eldönthető', evidence: unpublished.error ?? '' }
  const d = unpublished.data
  if (!d.probe) {
    return {
      question,
      answer: 'Nem ellenőrizve',
      evidence: 'Hozz létre egy nem publikált teszt-foglalást, és futtasd újra a kezdőidejével.',
    }
  }
  if (d.matchesAll > 0) {
    const desc = d.matches.map((m) => `${m.type}/${m.status}/${m.color ?? 'szín nélkül'}`).join(', ')
    return { question, answer: 'Igen, megjelenik az API-ban', evidence: `${d.matchesAll} találat a megadott időpontra: ${desc}` }
  }
  return { question, answer: 'Nem jelenik meg az API-ban', evidence: 'A megadott kezdőidőre (±1 perc) nincs foglalás egyik nézetben sem.' }
}

export function answerAvailability(availability: CheckOutcome<AvailabilityData>): Answer {
  const question = 'Aktív a ráérés funkció?'
  if (availability.status !== 'ok' || !availability.data) return { question, answer: 'Nem eldönthető', evidence: availability.error ?? '' }
  const d = availability.data
  const ownText = 'error' in d.own ? `saját: hiba (${d.own.error})` : `saját: ${d.own.events} esemény, ebből ${d.own.unavailable} nem elérhető`
  const evidence = `${d.windowDays} nap; ${ownText}; növendékek: ${d.studentsWithAny}/${d.studentsSampled} töltötte ki, ${d.studentEvents} esemény, ${d.studentErrors} hiba`
  const ownEvents = 'error' in d.own ? 0 : d.own.events
  if (ownEvents > 0 || d.studentsWithAny > 0) return { question, answer: 'Igen, van kitöltött ráérés', evidence }
  if ('error' in d.own || d.studentErrors > 0) return { question, answer: 'Hiba a lekérdezésben – lehet, hogy nincs engedélyezve', evidence }
  return { question, answer: 'Nincs adat: a funkció kikapcsolt, vagy senki nem töltötte ki', evidence }
}

export function answerIconD2(weather: CheckOutcome<readonly WeatherModelData[]>): Answer {
  const question = 'Lefedi az ICON-D2 a repülőteret?'
  if (weather.status !== 'ok' || !weather.data) return { question, answer: 'Nem ellenőrizve', evidence: weather.error ?? '' }
  const d2 = weather.data.find((m) => m.model === 'icon_d2')
  if (!d2 || d2.status !== 'ok') return { question, answer: 'Nem', evidence: d2?.error ?? 'Nincs válasz.' }
  const wind = d2.variables?.['wind_speed_10m']
  if (!wind || wind.nonNull === 0) return { question, answer: 'Nem: az ICON-D2 nem ad szelet erre a pontra', evidence: '' }
  return { question, answer: `Igen, kb. ${wind.lastHourAhead ?? '?'} órára előre`, evidence: `${wind.nonNull} órás szélérték` }
}

export function answerVisibility(weather: CheckOutcome<readonly WeatherModelData[]>, generatedAt: string): Answer {
  const question = 'Honnan jön a látástávolság?'
  if (weather.status !== 'ok' || !weather.data) return { question, answer: 'Nem ellenőrizve', evidence: weather.error ?? '' }
  const parts = weather.data
    .filter((m) => m.status === 'ok')
    .map((m) => {
      const v = m.variables?.['visibility']
      return `${m.model}: ${v && v.nonNull > 0 ? `${v.lastHourAhead ?? '?'} óráig` : 'nincs'}`
    })
  const providers = weather.data.filter((m) => (m.variables?.['visibility']?.nonNull ?? 0) > 0).map((m) => m.model)
  const beforeDeadline = generatedAt.slice(0, 10) <= DWD_VISIBILITY_DEADLINE
  const note = beforeDeadline
    ? ` A DWD-modellek látástávolsága ${DWD_VISIBILITY_DEADLINE}-ig él; utána érdemes újrafuttatni.`
    : ''
  return {
    question,
    answer: providers.length > 0 ? `Elérhető: ${providers.join(', ')}` : 'Egyik modell sem ad látástávolságot',
    evidence: parts.join('; ') + '.' + note,
  }
}

// ---------- Részletes szakaszok ----------

function bookingRows(own: BookingStats, all: BookingStats): Array<[string, string | number, string | number]> {
  return [
    ['Foglalások', own.total, all.total],
    ['Típus szerint', formatCounts(own.byType), formatCounts(all.byType)],
    ['Állapot szerint', formatCounts(own.byStatus), formatCounts(all.byStatus)],
    ['Múltbeli / jövőbeli', `${own.past} / ${own.future}`, `${all.past} / ${all.future}`],
    ['Repülési (gépes) foglalás', own.aircraftBookings, all.aircraftBookings],
    ['– gép nélkül (rejtett?)', formatRatio(own.aircraftNullRatio), formatRatio(all.aircraftNullRatio)],
    ['– különböző gép', own.distinctAircraft, all.distinctAircraft],
    ['Oktató mező kitöltve', formatRatio(own.instructorPresentRatio), formatRatio(all.instructorPresentRatio)],
    ['Különböző oktató', own.distinctInstructors, all.distinctInstructors],
    ['Saját / más oktató', `${own.ownInstructor} / ${own.otherInstructor}`, `${all.ownInstructor} / ${all.otherInstructor}`],
    ['Egynövendékes, növendék nélkül', formatRatio(own.singleStudentNullStudentRatio), formatRatio(all.singleStudentNullStudentRatio)],
    ['Egynövendékes, tervezett feladattal', formatRatio(own.plannedLessonRatio), formatRatio(all.plannedLessonRatio)],
    ['Nem üres komment (csak darab)', own.commentNonEmpty, all.commentNonEmpty],
    ['Színek', formatCounts(own.colors), formatCounts(all.colors)],
    ['A kulcs tulajdonosa hozta létre', own.createdByOwn, all.createdByOwn],
    ['Létrehozás ideje hiányzik', formatRatio(own.auditMissingRatio), formatRatio(all.auditMissingRatio)],
    ['Briefing perc (min/medián/max)', formatDistribution(own.briefingMinutes), formatDistribution(all.briefingMinutes)],
    ['Repülés perc (min/medián/max)', formatDistribution(own.flightMinutes), formatDistribution(all.flightMinutes)],
    ['Debriefing perc (min/medián/max)', formatDistribution(own.debriefingMinutes), formatDistribution(all.debriefingMinutes)],
    ['Termes foglalás', own.classroomBookings, all.classroomBookings],
    ['– terem nélkül (rejtett?)', formatRatio(own.classroomNullRatio), formatRatio(all.classroomNullRatio)],
  ]
}

function weatherSection(models: readonly WeatherModelData[]): string {
  const variableNames = [...new Set(models.flatMap((m) => Object.keys(m.variables ?? {})))]
  const header = ['Változó', ...models.map((m) => m.model)]
  const rows = variableNames.map((name) => [
    name,
    ...models.map((m) => {
      const v = m.variables?.[name]
      if (!v) return m.status === 'hiba' ? 'hiba' : '–'
      return v.nonNull === 0 ? 'nincs' : `${v.nonNull} óra, +${v.lastHourAhead ?? '?'} h (${v.unit ?? '?'})`
    }),
  ])
  const meta = models.map((m) =>
    m.status === 'ok'
      ? `- ${m.model}: ${m.hours} óra, tengerszint feletti magasság ${formatNumber(m.elevation)} m, időzóna ${m.timezone ?? '–'}, napkelte/napnyugta: ${formatCounts(m.dailyPresent ?? {})}`
      : `- ${m.model}: hiba – ${m.error ?? ''}`,
  )
  return [table(header, rows), '', ...meta].join('\n')
}

export function renderReport(result: DiscoveryResult): string {
  const out: string[] = []
  const push = (...lines: string[]): void => {
    out.push(...lines)
  }

  push(
    '# Felderítő jelentés – FlightLogger API és Open-Meteo',
    '',
    `Készült: ${result.finishedAt} · Foglalási ablak: ${result.settings.pastDays} nap vissza, ${result.settings.futureDays} nap előre`,
    '',
    '> Névtelenített jelentés: nevet, e-mail-címet, foglalási kommentet és felhasználói azonosítót nem tartalmaz.',
    '> A gépek lajstromjele és a karbantartási adatok szerepelnek, mert ezek nem személyes adatok.',
    '',
    '## 1. Első olvasat a nyitott kérdésekre',
    '',
    'Az alábbi válaszokat a program automatikusan vezeti le a számokból; a végleges értelmezést közösen végezzük.',
    '',
  )
  const answers = [
    answerAircraftVisibility(result.aircraft, result.bookings),
    answerOtherInstructors(result.bookings),
    answerStudentBookings(result.bookings),
    answerTimeLeft(result.aircraft),
    answerUnpublished(result.unpublished),
    answerAvailability(result.availability),
    answerIconD2(result.weather),
    answerVisibility(result.weather, result.finishedAt),
  ]
  push(table(['Kérdés', 'Első olvasat', 'Bizonyíték'], answers.map((a) => [a.question, a.answer, a.evidence])), '')

  // 2. Gépek
  push('## 2. Gépek és karbantartás (ADT-01, K09)', '')
  const aircraftNote = outcomeNote(result.aircraft)
  if (aircraftNote || !result.aircraft.data) push(aircraftNote ?? '', '')
  else {
    const a = result.aircraft.data
    push(
      `- Aktív erőforrás: ${a.total} (${formatCounts(a.byClass)}), letiltott a listában: ${a.disabled}`,
      `- Típusok: ${formatCounts(a.byModel)}`,
      `- Bázis-repülőtér: ${formatCounts(a.homeAirports)}; helyzet: ${formatCounts(a.locationKinds)}`,
      `- Gépelérhetőségi esemény a következő napokra: ${a.availabilityEvents} (${a.aircraftWithAvailability} gépen; csonkolt lista: ${a.availabilityTruncated})`,
      '',
      'Vesd össze a `timeLeft` oszlopot a maintenance crew reggeli dokumentumával. A „Számolt” oszlop a `nextPrimaryService − primaryLog` különbség.',
      '',
      table(
        ['Gép', 'Típus', 'Osztály', 'timeLeft', 'Számolt', 'daysLeft', 'Figyelmeztetés', 'Tétel', 'Mértékegység', 'nextPrimaryService', 'nextServiceDate', 'primaryLog óra', 'Log típus'],
        a.maintenance.map((r) => [
          r.callSign,
          r.model,
          r.aircraftClass,
          formatNumber(r.timeLeft, 2),
          formatNumber(r.derivedHoursToService, 2),
          formatNumber(r.daysLeft, 0),
          r.warningStatus,
          r.warningSubject,
          [r.warningMeasurement, r.warningTimerType, r.warningLogType].filter(Boolean).join(' / '),
          formatNumber(r.nextPrimaryService, 2),
          r.nextServiceDate,
          formatNumber(r.primaryLogHours, 2),
          [r.primaryLogType, r.primaryLogMeasurement].filter(Boolean).join(' / '),
        ]),
      ),
      '',
    )
  }

  // 3. Foglalások
  push('## 3. Foglalások: saját nézet és teljes nézet (ADT-01–03, K02)', '')
  const bookingNote = outcomeNote(result.bookings)
  if (bookingNote || !result.bookings.data) push(bookingNote ?? '', '')
  else {
    const b = result.bookings.data
    push(
      `Ablak: ${b.windowFrom} – ${b.windowTo}, átfedéssel. A „saját nézet” \`all: false\`, a „teljes nézet” \`all: true\`.`,
      '',
      table(['Mérőszám', 'Saját nézet', 'Teljes nézet'], bookingRows(b.own, b.all)),
      '',
      `- Saját növendékek az ablakban: ${b.ownStudents}; foglalásaik más oktatóval: ${b.ownStudentsBookingsWithOtherInstructor}; oktató nélkül: ${b.ownStudentsBookingsWithoutInstructor}`,
      `- Gép, amelyen a teljes nézetben nincs foglalás: ${b.all.aircraftWithoutBookings ?? '–'}`,
      '',
    )
  }
  const unpublishedNote = outcomeNote(result.unpublished)
  if (!unpublishedNote && result.unpublished.data) {
    const u = result.unpublished.data
    push(
      `- Nem publikált teszt-foglalás: ${u.probe ? `${u.probe}, saját nézetben ${u.matchesOwn}, teljes nézetben ${u.matchesAll} találat` : 'nem adtál meg időpontot'}`,
      `- A kulcs tulajdonosa által az elmúlt 48 órában létrehozott foglalás: ${u.createdByOwnLast48h}`,
      '',
    )
  }

  // 4. Felhasználók és ráérések
  push('## 4. Felhasználók és ráérések (ADT-02, SZB-03)', '')
  const usersNote = outcomeNote(result.users)
  if (usersNote || !result.users.data) push(usersNote ?? '', '')
  else {
    const u = result.users.data
    push(
      `- Felhasználók szerepkör szerint: ${Object.entries(u.byRole).map(([k, v]) => `${k}: ${v}`).join(', ')}`,
      `- Növendékeknél látszik név: ${formatRatio(u.studentNameVisibleRatio)}`,
      `- A saját növendékek megtalálhatók a STUDENT listában: ${formatRatio(u.ownStudentsFoundInStudentList)}`,
    )
  }
  const availabilityNote = outcomeNote(result.availability)
  if (availabilityNote) push(availabilityNote)
  else push(`- Ráérés: ${answerAvailability(result.availability).evidence}`)
  push('')

  // 5. Termek, programok, haladás
  push('## 5. Termek, programok, haladás (ADT-03, ADT-04)', '')
  const classroomNote = outcomeNote(result.classrooms)
  if (classroomNote || !result.classrooms.data) push(classroomNote ?? '')
  else {
    const c = result.classrooms.data
    push(
      `- Termek: ${c.active} aktív, letiltottakkal együtt ${c.includingDisabled}; helyzet: ${formatCounts(c.locationKinds)}`,
      `- Osztályok: ${c.classes}; létszám (min/medián/max): ${c.classSizes ? formatDistribution(c.classSizes) : '–'}`,
    )
  }
  const programNote = outcomeNote(result.programs)
  if (programNote || !result.programs.data) push(programNote ?? '')
  else {
    const p = result.programs.data
    push(
      `- Programok: ${p.programs} (${formatCounts(p.byType)}), revízió: ${p.revisions}, fázis: ${p.phases}, feladat: ${p.lectures}`,
      `- Feladatkategóriák: ${formatCounts(p.lectureCategories)}`,
      `- Tervezett percek a feladatokban (min/medián/max) – briefing: ${formatDistribution(p.briefingMinutes)}; repülés: ${formatDistribution(p.flightMinutes)}; debriefing: ${formatDistribution(p.debriefingMinutes)}`,
      `- Időtartam nélküli feladat: ${p.lecturesWithoutDurations}`,
    )
  }
  const progressNote = outcomeNote(result.progress)
  if (progressNote || !result.progress.data) push(progressNote ?? '')
  else {
    const g = result.progress.data
    push(
      `- Haladás ${g.studentsQueried} saját növendékre: programhozzárendelés ${g.userPrograms} (${formatCounts(g.userProgramStatus)})`,
      `- Elmúlt 120 nap feladatai: ${g.trainings} (${formatCounts(g.trainingStatus)}); teljesítmény miatt sikertelen: ${g.failedPerformance}`,
      `- Feladat repüléssel: ${formatRatio(g.withFlightsRatio)}; foglaláshoz kötve: ${formatRatio(g.withBookingRatio)}`,
      `- Napok az utolsó repülés óta, növendékenként (min/medián/max): ${formatDistribution(g.daysSinceLastFlight, ' nap')}`,
      `- Feladatok a Training → Lecture úton: ${g.lecturesViaTrainings}, programfázissal: ${formatRatio(g.lecturesWithPhaseRatio)}; tervezett percek (min/medián/max) – briefing: ${formatDistribution(g.lectureBriefingMinutes)}; repülés: ${formatDistribution(g.lectureFlightMinutes)}; debriefing: ${formatDistribution(g.lectureDebriefingMinutes)}`,
    )
    const v = g.trainingVisibility
    if (typeof v === 'string') push(`- Feladatok láthatósága (növendékszűrő vs. iskolai szint): ${v}`)
    else
      push(
        `- Feladatok növendékszűrővel: ${v.byStudentFilter.total}; saját oktatóval: ${v.byStudentFilter.ownInstructor}, más oktatóval: ${v.byStudentFilter.otherInstructor}, különböző oktató: ${v.byStudentFilter.distinctInstructors}`,
        `- Feladatok iskolai szinten: ${v.schoolWide.total}, ebből saját növendéké: ${v.schoolWide.ofOwnStudents}; saját oktatóval: ${v.schoolWide.ownInstructor}, más oktatóval: ${v.schoolWide.otherInstructor}, különböző oktató: ${v.schoolWide.distinctInstructors}; csak iskolai szinten látszik: ${v.schoolWide.missingFromStudentFilter}`,
      )
  }
  push('')

  // 6. Repülések és logbook
  push('## 6. Repülések és oktatói logbook (ADT-05, LIM-01)', '')
  const flightsNote = outcomeNote(result.flights)
  if (flightsNote || !result.flights.data) push(flightsNote ?? '')
  else {
    const f = result.flights.data
    push(
      `- Repülések az elmúlt ${f.windowDays} napban: saját nézet ${f.own}, teljes nézet ${f.all}, ${f.distinctAircraftAll} gépen; típus: ${formatCounts(f.flightTypes)}`,
    )
  }
  const logbookNote = outcomeNote(result.logbook)
  if (logbookNote || !result.logbook.data) push(logbookNote ?? '')
  else {
    const l = result.logbook.data
    if (l.source === 'flights') {
      push(
        `- A myFlightLogger nem érhető el ezzel a kulccsal (${l.myFlightLoggerError ?? ''}). Tartalékként a saját repülések block time-ja ebben a fiókban:`,
        `- Elmúlt 365 nap: ${l.entries365} repülés, ${formatNumber(l.hours365FromEntries)} óra; elmúlt 28 nap: ${formatNumber(l.summation28Hours)} óra; naptári év: ${formatNumber(l.summationYearHours)} óra`,
        '- Más munkahelyen repült idő így nem látszik; ehhez kézi korrekció kell (8.3).',
      )
    } else push(
      `- Logbook-bejegyzés az elmúlt 365 napban: ${l.entries365}; összes idő ${formatNumber(l.hours365FromEntries)} óra, ebből oktatói ${formatNumber(l.instructorHours365FromEntries)} óra, szimulátor ${formatNumber(l.syntheticHours365FromEntries)} óra`,
      `- includeInFtl: ${formatCounts(l.includeInFtl)}`,
      `- Összesítő (logbookSummations): 28 nap ${formatNumber(l.summation28Hours)} óra, naptári év ${formatNumber(l.summationYearHours)} óra, 365 nap ${formatNumber(l.summation365Hours)} óra (a bejegyzésekből számolt: ${formatNumber(l.hours365FromEntries)} óra)`,
    )
  }
  push('')

  // 7. Időjárás
  push('## 7. Időjárás: Open-Meteo modellek a repülőtérre (ADT-07)', '')
  const weatherNote = outcomeNote(result.weather)
  if (weatherNote || !result.weather.data) push(weatherNote ?? '', '')
  else push('Cellánként: hány órában van érték, és meddig (+óra a futtatástól).', '', weatherSection(result.weather.data), '')

  // 8. Séma
  push('## 8. Séma és rögzített lekérdezések', '')
  const schemaNote = outcomeNote(result.schema)
  if (schemaNote || !result.schema.data) push(schemaNote ?? '', '')
  else {
    const s = result.schema.data
    const invalid = Object.entries(s.validation)
    push(
      `- A séma mentve: \`${s.savedTo}\` (${s.typeCount} típus, ${s.queryFields} query mező, ${s.mutationFields} mutation mező – ez utóbbiakat a kliens soha nem küldi)`,
      invalid.length === 0
        ? '- Minden rögzített lekérdezés érvényes a séma szerint.'
        : `- Érvénytelen lekérdezések:\n${invalid.map(([name, errors]) => `  - ${name}: ${errors.join('; ')}`).join('\n')}`,
      '',
    )
  }

  // 9. Hálózat és időtartam
  push('## 9. Hálózat', '')
  if (result.network) {
    const n = result.network
    push(
      `- FlightLogger-kérések: ${n.requests}, ebből 429: ${n.rateLimited}, leghosszabb Retry-After: ${n.maxRetryAfterSeconds ?? '–'} mp, összes idő: ${formatNumber(n.totalMs / 1000)} mp`,
      `- Lekérdezésenként: ${formatCounts(n.byQuery)}`,
    )
  }
  const checks = [
    ['kulcs tulajdonosa', result.viewer],
    ['séma', result.schema],
    ['gépek', result.aircraft],
    ['foglalások', result.bookings],
    ['nem publikált', result.unpublished],
    ['felhasználók', result.users],
    ['ráérések', result.availability],
    ['termek', result.classrooms],
    ['programok', result.programs],
    ['haladás', result.progress],
    ['repülések', result.flights],
    ['logbook', result.logbook],
    ['időjárás', result.weather],
  ] as const
  push('', table(['Ellenőrzés', 'Állapot', 'Idő (mp)', 'Megjegyzés'], checks.map(([name, c]) => [name, c.status, formatNumber(c.durationMs / 1000), c.error ?? ''])), '')

  return out.join('\n')
}
