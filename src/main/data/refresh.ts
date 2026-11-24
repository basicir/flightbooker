import type { Settings } from '../../core/config/schema'
import type { DataBundle, DirectoryClass, DirectoryPerson } from '../../core/model/dataBundle'
import { mergeCatalog, type LectureInfo, type StudentProgress, type TrainingRecord } from '../../core/progress/lectures'
import { briefingLookup, resolveProgress, syllabusLectures, type Syllabus } from '../../core/progress/syllabus'
import type { FlownActivity, Snapshot } from '../../core/model/snapshot'
import { addDays, daysBetween, DAY_MS, localParts, localToMs, toIso } from '../../core/time/zoned'
import { FlightLoggerPageLimitError, type FlightLoggerClient } from '../net/flightLogger/client'
import {
  AircraftQuery,
  BookingsQuery,
  ClassesQuery,
  ClassroomsQuery,
  FlightsQuery,
  TrainingLecturesQuery,
  TrainingsQuery,
  UserAvailabilitiesQuery,
  UsersByRoleQuery,
  ViewerQuery,
} from '../net/flightLogger/queries'
import type { ForecastRequest, ForecastResponse } from '../net/openMeteo'
import { fetchPlanningWeather, type SkillSource } from './blendedWeather'
import type { Booking, Flight, Training, User } from '../net/flightLogger/types'
import { lastFlights, lecturesFromBookings, lecturesFromTrainings, mapAircraft, mapBooking, studentFlightsFrom, trainingRecordsByStudent } from './mapping'

/**
 * Élő adatfrissítés (ADT-01–07): a FlightLoggerből és az Open-Meteóból pillanatképet
 * épít a megadott hétre. Csak olvas. Egy rész hibája nem állítja meg a többit; a hibák
 * az eredményben jelennek meg (13.3: adathiány kezelése).
 */

export interface RefreshDeps {
  readonly client: FlightLoggerClient
  readonly fetchForecast: (request: ForecastRequest) => Promise<ForecastResponse>
  /** A modellek METAR-ral mért pontossága (ADT-07); nélküle az induló súlyok. */
  readonly skill?: SkillSource
  readonly now: Date
  /** A betöltött feladatsorok (SZB-02). */
  readonly syllabi?: { readonly syllabi: readonly Syllabus[]; readonly errors: readonly string[] }
  /**
   * `directory`: csak a névjegyzék (gépek, termek, felhasználók, osztályok) – az első
   * beállításhoz ennyi kell, és sokkal gyorsabb. `full`: a tervezéshez szükséges minden adat.
   */
  readonly scope?: 'full' | 'directory'
  /** Előrehaladás a felületnek (melyik rész töltődik). */
  readonly onProgress?: (progress: { readonly stage: string; readonly done: number; readonly total: number }) => void
  /**
   * A feladatkatalógus helyi gyorsítótára. Személyes adat nincs benne (feladatnevek és
   * tervezett percek); vele a két évnyi elkönyvelt feladat helyett csak a változások jönnek.
   */
  readonly catalogCache?: LectureCatalogCacheStore
  /**
   * A felhasználók névjegyzéke a főfolyamat memóriájában (fájlba nem kerül, mert név van
   * benne). Vele a következő frissítés csak az azóta változott felhasználókat kéri le.
   */
  readonly userCache?: UserDirectoryCache
  /**
   * A növendékek haladásának és az oktató saját repüléseinek gyorsítótára (törölhető, a
   * felhasználói adatmappában; név nincs benne, csak azonosítók). Vele a következő frissítés
   * csak az azóta változott elemeket kéri le, így kevesebb kérés megy a kéréskorlátba.
   */
  readonly historyCache?: HistoryCacheStore
}

/** Változás szerint frissített lista: mikor töltöttük le teljesen, és mikor utoljára. */
export interface HistoryEntry<T> {
  /** Az utolsó teljes letöltés ideje (ISO); ennyi idő után újra teljes letöltés jön. */
  readonly fullAt: string
  /** Az utolsó (teljes vagy változás szerinti) letöltés ideje (ISO). */
  readonly fetchedAt: string
  readonly items: readonly T[]
}

export interface HistoryCache {
  /** A haladás: az `userIds` növendékek összes elkönyvelt feladata. */
  readonly trainings?: HistoryEntry<Training> & { readonly userIds: readonly string[] }
  /** Az oktató saját repülései az elmúlt egy évből (limitek). */
  readonly flights?: HistoryEntry<Flight>
  /**
   * A korábbi foglalások a gördülő szolgálati- és pihenőidő-limitekhez (H09) és a fizetett
   * időhöz: a `from`–`to` időablakból; csak az oktatót vagy a hozzárendelt növendékeket érintők.
   * A `to` a teljesen letöltött ablak vége: az utána következő szakasz (ami a korábbi letöltéskor
   * még jövő volt) mindig teljesen jön le, mert a változatlan foglalás a változás szerinti
   * lekérdezésben nem jelenne meg. Régebbi gyorsítótárban hiányzik (akkor teljes letöltés).
   */
  readonly pastBookings?: HistoryEntry<Booking> & { readonly from: string; readonly to?: string }
}

/** A gördülő limitek (7, 14, 28 nap) miatt ennyi nappal a hét előttről kellenek a foglalások. */
export const PAST_BOOKING_DAYS = 28

export interface HistoryCacheStore {
  load(): Promise<HistoryCache | undefined>
  save(cache: HistoryCache): Promise<void>
}

/**
 * Ennyi nap után a haladást és a repüléseket újra teljesen letöltjük: a változáslekérdezés a
 * törölt elemeket nem jelzi, így a gyorsítótár legfeljebb ennyi ideig tarthat meg egy törölt
 * elkönyvelést vagy repülést.
 */
export const HISTORY_FULL_REFRESH_DAYS = 7

/** Memóriabeli névjegyzék-gyorsítótár: szerepkörönként a felhasználók és a letöltés ideje. */
export interface UserDirectoryCache {
  value?: { readonly fetchedAt: number; readonly byRole: Readonly<Record<'STUDENT' | 'FLIGHT_INSTRUCTOR', readonly User[]>> }
}

/** Ennyi idő után a névjegyzéket újra teljesen letöltjük (a törölt felhasználók miatt). */
const USER_FULL_REFRESH_MS = 12 * 60 * 60 * 1000

/** A feladatkatalógus gyorsítótára: mikor töltöttük le, és a feladatok. */
export interface LectureCatalogCache {
  readonly fetchedAt: string
  readonly lectures: readonly LectureInfo[]
}

export interface LectureCatalogCacheStore {
  load(): Promise<LectureCatalogCache | undefined>
  save(cache: LectureCatalogCache): Promise<void>
}

/**
 * Ennyi nap után a katalógust újra teljesen letöltjük. A változáslekérdezés minden új vagy
 * módosított elkönyvelt feladattal a feladat friss adatait is hozza, ezért ritkán kell.
 */
export const CATALOG_FULL_REFRESH_DAYS = 30
/** A változáslekérdezés átfedése, hogy az óraeltérés miatt se maradjon ki semmi. */
const CATALOG_OVERLAP_MS = 60 * 60 * 1000


const fail = (part: string, error: unknown): string => `${part}: ${error instanceof Error ? error.message : String(error)}`

type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }

/**
 * A párhuzamosan futó részek követése: az előrehaladás a még futó részeket és a készek számát
 * mutatja. Egy rész hibája nem állítja meg a többit (13.3).
 */
function partRunner(report: (stage: string, done: number, total: number) => void) {
  const running: string[] = []
  let done = 0
  let total = 0
  const emit = (): void => report(running.join(', '), done, total)
  return async <T>(label: string, errorLabel: string, fn: () => Promise<T>): Promise<Outcome<T>> => {
    total++
    running.push(label)
    emit()
    try {
      return { ok: true, value: await fn() }
    } catch (error) {
      return { ok: false, error: fail(errorLabel, error) }
    } finally {
      running.splice(running.indexOf(label), 1)
      done++
      emit()
    }
  }
}

/**
 * Időablak felosztása egyforma részekre a párhuzamos lapozáshoz. A FlightLogger `from`/`to`
 * szűrője a teljes egészében az ablakba eső elemeket adja („utána kezdődik”, „előtte ér
 * véget”), ezért a részek vége `overlapMs`-mel átnyúlik a következőbe: a határon átívelő elem
 * sem marad ki. A külső határ az eredeti; az ismétlődést az azonosító szerinti szűrés kezeli.
 */
export function splitRange(fromMs: number, toMs: number, parts: number, overlapMs = DAY_MS): Array<readonly [number, number]> {
  const n = Math.max(1, Math.floor(parts))
  const step = (toMs - fromMs) / n
  return Array.from({ length: n }, (_, i) => [Math.round(fromMs + i * step), i === n - 1 ? toMs : Math.min(toMs, Math.round(fromMs + (i + 1) * step) + overlapMs)] as const)
}

/** Azonosító szerint egyedi elemek (az ablakok határán átfedő elemek miatt). */
function uniqueById<T extends { readonly id: string }>(lists: ReadonlyArray<readonly T[]>): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      result.push(item)
    }
  }
  return result
}

export async function refreshLive(deps: RefreshDeps, settings: Settings, weekStart: string): Promise<DataBundle> {
  const { client, now } = deps
  const nowMs = now.getTime()
  const tz = settings.airport?.timezone ?? 'Europe/Budapest'
  const errors: string[] = []
  const iso = (ms: number): string => toIso(ms)
  const weekStartMs = localToMs(weekStart, 0, tz)
  const weekEndMs = localToMs(addDays(weekStart, 7), 0, tz)

  const report = (stage: string, done: number, total: number): void => deps.onProgress?.({ stage, done, total })
  report('Kapcsolódás a FlightLoggerhez', 0, 0)
  const viewer = (await client.query(ViewerQuery, {})).user
  if (!viewer) throw new Error('A kulcshoz nem tartozik felhasználó.')

  // A részek egymástól függetlenek: párhuzamosan futnak, a kliens korlátozza az egyidejű kéréseket.
  const part = partRunner(report)
  const assigned = settings.students.map((s) => s.userId)
  const full = deps.scope !== 'directory'

  const fleetPart = part('Gépek', 'Gépek', () => client.fetchAll(AircraftQuery, {}, (d) => d.aircraft, { pageSize: 25 }))
  const roomsPart = part('Termek', 'Termek', () => client.fetchAll(ClassroomsQuery, {}, (d) => d.classrooms))
  // Névjegyzék: friss memóriabeli példánynál csak az azóta változott felhasználók jönnek le.
  const cachedUsers = deps.userCache?.value
  const usersFresh = cachedUsers !== undefined && cachedUsers.fetchedAt <= nowMs && nowMs - cachedUsers.fetchedAt < USER_FULL_REFRESH_MS
  const usersOf = async (role: 'STUDENT' | 'FLIGHT_INSTRUCTOR'): Promise<User[]> => {
    if (!usersFresh) return client.fetchAll(UsersByRoleQuery, { roles: [role] }, (d) => d.users)
    const changed = await client.fetchAll(UsersByRoleQuery, { roles: [role], changedAfter: toIso(cachedUsers.fetchedAt - CATALOG_OVERLAP_MS) }, (d) => d.users)
    return uniqueById([changed, cachedUsers.byRole[role]])
  }
  const studentsPart = part('Növendékek', 'Növendékek', () => usersOf('STUDENT'))
  const instructorsPart = part('Oktatók', 'Oktatók', () => usersOf('FLIGHT_INSTRUCTOR'))
  const classesPart = part('Osztályok', 'Osztályok', () => client.fetchAll(ClassesQuery, {}, (d) => d.classes))

  // Foglalások (ADT-01–03): a tervezett hétre és az előtte lévő napra (növendéki pihenőidő),
  // a mostani időponttól. A már folyamatban lévőt az `overlap` miatt megkapjuk.
  const bookingsFromMs = Math.max(weekStartMs - DAY_MS, nowMs)
  const bookingsToMs = weekEndMs + DAY_MS
  const bookingsPart =
    full && bookingsFromMs < bookingsToMs
      ? part('Foglalások', 'Foglalások', () => client.fetchAll(BookingsQuery, { from: iso(bookingsFromMs), to: iso(bookingsToMs), all: true, overlap: true }, (d) => d.bookings))
      : undefined

  const history = full && deps.historyCache ? deps.historyCache.load().catch(() => undefined) : Promise.resolve(undefined)

  // Korábbi foglalások (H09): a gördülő szolgálati- és pihenőidő-limitek 28 napot néznek
  // vissza. Csak az oktatót és a hozzárendelt növendékeket érintők maradnak meg; a következő
  // frissítés csak a változásokat kéri le (gyorsítótár).
  const pastFromMs = weekStartMs - PAST_BOOKING_DAYS * DAY_MS
  const pastToMs = Math.min(bookingsFromMs, weekEndMs)
  const relevant = new Set([viewer.id, ...assigned])
  const isRelevant = (b: Booking): boolean => {
    const m = mapBooking(b)
    return (m.instructorId !== undefined && relevant.has(m.instructorId)) || m.participantIds.some((id) => relevant.has(id))
  }
  const pastPart: Promise<Outcome<NonNullable<HistoryCache['pastBookings']>>> | undefined =
    full && pastFromMs < pastToMs
      ? part('Korábbi foglalások (limitek)', 'Korábbi foglalások', async () => {
          const cached = (await history)?.pastBookings
          const usable = cached?.to && isFresh(cached, nowMs) && Date.parse(cached.from) <= pastFromMs ? { ...cached, to: cached.to } : undefined
          const fetchRange = (fromMs: number, toMs: number, changedAfter?: string) =>
            client.fetchAll(BookingsQuery, { from: iso(fromMs), to: iso(toMs), all: true, overlap: true, ...(changedAfter ? { changedAfter } : {}) }, (d) => d.bookings)
          const now = iso(nowMs)
          if (!usable) return { fullAt: now, fetchedAt: now, from: iso(pastFromMs), to: iso(pastToMs), items: (await fetchRange(pastFromMs, pastToMs)).filter(isRelevant) }
          // A már letöltött ablakban a változások, a korábban még jövőbeli szakaszon minden foglalás.
          const cachedTo = Date.parse(usable.to)
          const since = Math.min(Date.parse(usable.fetchedAt), nowMs) - CATALOG_OVERLAP_MS
          const [changed, extension] = await Promise.all([
            fetchRange(Date.parse(usable.from), cachedTo, iso(since)),
            cachedTo < pastToMs ? fetchRange(cachedTo, pastToMs) : Promise.resolve([]),
          ])
          return {
            fullAt: usable.fullAt,
            fetchedAt: now,
            from: usable.from,
            to: iso(Math.max(cachedTo, pastToMs)),
            items: uniqueById([changed, extension, usable.items]).filter(isRelevant),
          }
        })
      : undefined

  const availabilityParts = full
    ? [viewer.id, ...assigned].map((id) =>
        part('Ráérések', 'Ráérések', async () => {
          const events = await client.fetchAll(UserAvailabilitiesQuery, { id, from: iso(weekStartMs), to: iso(weekEndMs) }, (d) => d.user?.availabilities)
          return [id, events.map((e) => ({ start: e.startsAt, end: e.endsAt, unavailable: e.unavailable }))] as const
        }),
      )
    : []

  // Feladatlista (SZB-02): az iskolai kulccsal a program szerkezete nem olvasható, ezért az
  // elkönyvelt feladatokból és a foglalások tervezett feladataiból gyűjtjük össze.
  const catalogPart = full ? part('Feladatlista', 'Feladatlista', () => loadCatalog(deps, nowMs)) : undefined

  // A növendékek teljes haladása (nem csak az utolsó hónapok): ebből jön a soron következő
  // feladat. Növendékenként külön, párhuzamosan; minden elkönyvelt feladat egy növendéké.
  const progressPart: Promise<Outcome<{ entry: NonNullable<HistoryCache['trainings']>; incremental: boolean }>> | undefined =
    full && assigned.length > 0
      ? part('Növendékek haladása', 'Haladás', async () => {
          const cached = (await history)?.trainings
          const usable = cached && isFresh(cached, nowMs) && assigned.every((id) => cached.userIds.includes(id)) ? cached : undefined
          const result = await incremental(usable, nowMs, (changedAfter) =>
            client.fetchAll(TrainingsQuery, { userIds: assigned, all: true, ...(changedAfter ? { changedAfter } : {}) }, (d) => d.trainings),
          )
          return { entry: { ...result.entry, userIds: usable ? usable.userIds : assigned }, incremental: result.incremental }
        })
      : undefined

  // Iskolai kulccsal a myFlightLogger nem érhető el; a saját repülések block time-ja a pótlás
  // (8.3, K37).
  const flightsFromMs = nowMs - 366 * DAY_MS
  const flightsPart: Promise<Outcome<NonNullable<HistoryCache['flights']>>> | undefined = full
    ? part('Saját repülések (limitek)', 'Repülések', async () => {
        const cached = (await history)?.flights
        const result = await incremental(cached && isFresh(cached, nowMs) ? cached : undefined, nowMs, (changedAfter) =>
          client.fetchAll(FlightsQuery, { from: iso(flightsFromMs), to: iso(nowMs), all: false, ...(changedAfter ? { changedAfter } : {}) }, (d) => d.flights),
        )
        // Az egy évnél régebbi repülés kiesik a gyorsítótárból is.
        return { ...result.entry, items: result.entry.items.filter((f) => Date.parse(f.offBlock) >= flightsFromMs) }
      })
    : undefined

  const airport = settings.airport
  const weatherPart =
    full && airport
      ? part('Időjárás', 'Időjárás', async () => {
          const today = localParts(nowMs, tz).date
          const days = Math.min(16, Math.max(1, daysBetween(today, addDays(weekStart, 7)) + 1))
          // A tervezés előrejelzése a modellek pontosság szerint súlyozott együttese (ADT-07).
          return fetchPlanningWeather({ fetchForecast: deps.fetchForecast, ...(deps.skill ? { skill: deps.skill } : {}), now }, { ...airport, timezone: tz }, days)
        })
      : undefined

  // ---------- névjegyzék ----------
  const fleetOutcome = await fleetPart
  if (!fleetOutcome.ok) throw new Error(fleetOutcome.error)
  const fleet = fleetOutcome.value.map(mapAircraft)

  let classroomIds: string[] = []
  const classroomNames: Record<string, string> = {}
  const rooms = await roomsPart
  if (rooms.ok) {
    classroomIds = rooms.value.map((r) => r.id)
    for (const r of rooms.value) classroomNames[r.id] = r.name
  } else errors.push(rooms.error)

  const studentsOutcome = await studentsPart
  const instructorsOutcome = await instructorsPart
  if (deps.userCache && studentsOutcome.ok && instructorsOutcome.ok) {
    deps.userCache.value = { fetchedAt: nowMs, byRole: { STUDENT: studentsOutcome.value, FLIGHT_INSTRUCTOR: instructorsOutcome.value } }
  }
  const people: Record<string, DirectoryPerson> = {}
  for (const [role, outcome] of [
    ['student', studentsOutcome],
    ['instructor', instructorsOutcome],
  ] as const) {
    if (!outcome.ok) {
      errors.push(outcome.error)
      continue
    }
    for (const u of outcome.value) {
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.callSign
      if (!people[u.id] || role === 'instructor') people[u.id] = { name, role, ...(u.callSign ? { callSign: u.callSign } : {}) }
    }
  }

  // Osztályok az elmélethez: tagjaik egyenként adhatók hozzá (TRV-01).
  const classes: Record<string, DirectoryClass> = {}
  const classesOutcome = await classesPart
  if (classesOutcome.ok) {
    for (const c of classesOutcome.value) classes[c.id] = { name: c.name, memberIds: c.users.filter((u): u is { id: string } => u !== null).map((u) => u.id) }
  } else errors.push(classesOutcome.error)

  const syllabusLoad = deps.syllabi ?? { syllabi: [], errors: [] }
  if (!full) {
    // Első beállítás: a névjegyzék elég, a heti adatot a beállítás végén töltjük be.
    return {
      source: 'live',
      fetchedAt: now.toISOString(),
      snapshot: { generatedAt: now.toISOString(), weekStart, timezone: tz, instructorId: viewer.id, fleet, classroomIds, bookings: [], availabilities: {}, lastFlightAt: {}, instructorFlights: [], weather: [], daylight: {} },
      directory: { people, classrooms: classroomNames, lectures: {}, classes },
      progress: {},
      syllabi: syllabusLoad.syllabi,
      syllabusErrors: [...syllabusLoad.errors],
      trainingRecords: {},
      errors,
    }
  }

  // ---------- heti adatok ----------
  let bookings: Snapshot['bookings'] = []
  let rawBookings: Booking[] = []
  if (bookingsPart) {
    const outcome = await bookingsPart
    if (outcome.ok) {
      rawBookings = outcome.value
      bookings = rawBookings.map(mapBooking)
    } else errors.push(outcome.error)
  }
  let pastEntry: HistoryCache['pastBookings']
  if (pastPart) {
    const outcome = await pastPart
    if (outcome.ok) {
      pastEntry = outcome.value
      const seen = new Set(bookings.map((b) => b.id))
      const windowEnd = pastToMs
      const past = outcome.value.items.filter((b) => !seen.has(b.id) && Date.parse(b.endsAt) > pastFromMs && Date.parse(b.startsAt) < windowEnd).map(mapBooking)
      bookings = [...past, ...bookings]
    } else errors.push(outcome.error)
  }

  const availabilities: Record<string, Snapshot['availabilities'][string]> = {}
  let availabilityError: string | undefined
  for (const outcome of await Promise.all(availabilityParts)) {
    if (outcome.ok) availabilities[outcome.value[0]] = outcome.value[1]
    else availabilityError ??= outcome.error
  }
  if (availabilityError) errors.push(availabilityError)

  let lastFlightAt: Record<string, string | null> = {}
  const catalogSources: LectureInfo[][] = [lecturesFromBookings(rawBookings)]
  const catalogOutcome = await catalogPart!
  if (catalogOutcome.ok) catalogSources.push([...catalogOutcome.value])
  else errors.push(catalogOutcome.error)

  const syllabi = syllabusLoad.syllabi
  let apiLectures: Record<string, LectureInfo> = mergeCatalog(...catalogSources)
  let records: Record<string, TrainingRecord[]> = {}
  let studentFlights: Record<string, FlownActivity[]> | undefined
  const nextHistory: { trainings?: HistoryCache['trainings']; flights?: HistoryCache['flights']; pastBookings?: HistoryCache['pastBookings'] } = {}
  if (pastEntry) nextHistory.pastBookings = pastEntry
  if (progressPart) {
    const outcome = await progressPart
    if (outcome.ok) {
      nextHistory.trainings = outcome.value.entry
      // A gyorsítótárban a korábbi növendékek elkönyvelései is lehetnek: csak a hozzárendeltek kellenek.
      const assignedSet = new Set(assigned)
      const trainings = outcome.value.entry.items.filter((t) => !t.student || assignedSet.has(t.student.id))
      lastFlightAt = lastFlights(trainings, assigned)
      apiLectures = mergeCatalog(lecturesFromTrainings(trainings), ...catalogSources)
      records = trainingRecordsByStudent(trainings)
      studentFlights = studentFlightsFrom(trainings, assigned, nowMs - 366 * DAY_MS)
    } else errors.push(outcome.error)
  }
  // A feladatsorok feladatai a katalógusba; a briefing/debriefing az API-ból, ha ismert.
  const briefing = briefingLookup(Object.values(apiLectures), { briefing: settings.defaults.briefingMinutes, debriefing: settings.defaults.debriefingMinutes })
  const lectures: Record<string, LectureInfo> = { ...apiLectures, ...Object.fromEntries(syllabi.flatMap((s) => syllabusLectures(s, briefing)).map((l) => [l.id, l])) }
  const progress: Record<string, StudentProgress> = {}
  for (const id of assigned) {
    const chosen = settings.students.find((s) => s.userId === id)?.syllabusId
    progress[id] = resolveProgress(records[id] ?? [], apiLectures, lectures, syllabi, chosen)
  }

  const simulatorIds = new Set(fleet.filter((a) => (settings.resources[a.id]?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')) === 'simulator').map((a) => a.id))
  let instructorFlights: FlownActivity[] = []
  const flightsOutcome = await flightsPart!
  if (flightsOutcome.ok) nextHistory.flights = flightsOutcome.value
  if (flightsOutcome.ok) instructorFlights = flightsOutcome.value.items.map((f) => ({ start: f.offBlock, end: f.onBlock, simulator: f.aircraft ? simulatorIds.has(f.aircraft.id) : false }))
  else errors.push(flightsOutcome.error)

  // A gyorsítótár hibája nem rontja el a betöltést; a hibás részt a korábbi érték pótolja.
  if (deps.historyCache && (nextHistory.trainings || nextHistory.flights || nextHistory.pastBookings)) {
    const previous = await history
    const trainings = nextHistory.trainings ?? previous?.trainings
    const flights = nextHistory.flights ?? previous?.flights
    const pastBookings = nextHistory.pastBookings ?? previous?.pastBookings
    await deps.historyCache.save({ ...(trainings ? { trainings } : {}), ...(flights ? { flights } : {}), ...(pastBookings ? { pastBookings } : {}) }).catch(() => undefined)
  }

  let weather: Snapshot['weather'] = []
  let daylight: Snapshot['daylight'] = {}
  let weatherSource: Snapshot['weatherSource']
  if (weatherPart) {
    const outcome = await weatherPart
    if (outcome.ok) {
      weather = outcome.value.hours
      daylight = outcome.value.daylight
      weatherSource = {
        kind: 'blend',
        models: outcome.value.models,
        measuredHours: outcome.value.skill.measuredHours,
        ...(outcome.value.staleModels.length > 0 ? { staleModels: outcome.value.staleModels } : {}),
      }
      if (outcome.value.skill.error) errors.push(`Időjárás – modellpontosság: ${outcome.value.skill.error}`)
    } else errors.push(outcome.error)
  } else {
    errors.push('Időjárás: nincs megadva a repülőtér.')
  }

  return {
    source: 'live',
    fetchedAt: now.toISOString(),
    snapshot: {
      generatedAt: now.toISOString(),
      weekStart,
      timezone: tz,
      instructorId: viewer.id,
      fleet,
      classroomIds,
      bookings,
      availabilities,
      lastFlightAt,
      instructorFlights,
      ...(studentFlights ? { studentFlights } : {}),
      weather,
      ...(weatherSource ? { weatherSource } : {}),
      daylight,
    },
    directory: { people, classrooms: classroomNames, lectures, classes },
    progress,
    syllabi,
    syllabusErrors: [...syllabusLoad.errors],
    trainingRecords: records,
    errors,
  }
}

function isFresh(entry: { readonly fullAt: string }, nowMs: number): boolean {
  const fullAt = Date.parse(entry.fullAt)
  return Number.isFinite(fullAt) && fullAt <= nowMs && nowMs - fullAt < HISTORY_FULL_REFRESH_DAYS * DAY_MS
}

/**
 * Változás szerinti letöltés: használható gyorsítótárnál csak az utolsó letöltés óta
 * létrehozott vagy módosított elemek jönnek (átfedéssel), és azonosító szerint felülírják a
 * régieket; egyébként teljes letöltés.
 */
export async function incremental<T extends { readonly id: string }>(
  cached: HistoryEntry<T> | undefined,
  nowMs: number,
  fetch: (changedAfter: string | undefined) => Promise<readonly T[]>,
): Promise<{ readonly entry: HistoryEntry<T>; readonly incremental: boolean }> {
  const now = toIso(nowMs)
  if (!cached) return { entry: { fullAt: now, fetchedAt: now, items: [...(await fetch(undefined))] }, incremental: false }
  const since = Math.min(Date.parse(cached.fetchedAt), nowMs) - CATALOG_OVERLAP_MS
  const changed = await fetch(toIso(since))
  return { entry: { fullAt: cached.fullAt, fetchedAt: now, items: uniqueById([changed, cached.items]) }, incremental: true }
}

/**
 * Feladatkatalógus az iskola elkönyvelt feladataiból (SZB-02). Friss gyorsítótárnál csak az
 * azóta létrehozott vagy módosított feladatokat kéri (`changedAfter`), egyébként az elmúlt két
 * évet négy részben, párhuzamosan. A katalógusból így nem vész el feladat: a gyorsítótár
 * legfeljebb bővebb, és havonta teljesen megújul.
 */
async function loadCatalog(deps: RefreshDeps, nowMs: number): Promise<readonly LectureInfo[]> {
  const { client } = deps
  const cached = deps.catalogCache ? await deps.catalogCache.load().catch(() => undefined) : undefined
  const cachedAt = cached ? Date.parse(cached.fetchedAt) : Number.NaN
  const fresh = cached !== undefined && Number.isFinite(cachedAt) && cachedAt <= nowMs && nowMs - cachedAt < CATALOG_FULL_REFRESH_DAYS * DAY_MS
  let lectures: LectureInfo[]
  if (fresh) {
    const changed = await client.fetchAll(TrainingLecturesQuery, { changedAfter: toIso(cachedAt - CATALOG_OVERLAP_MS), all: true }, (d) => d.trainings)
    lectures = Object.values(mergeCatalog(lecturesFromTrainings(changed), cached.lectures))
  } else {
    // Ha egy rész túl nagy (eléri a lapszám-korlátot), kettébontjuk: az iskola forgalmának
    // növekedése sem állítja meg a letöltést. Legfeljebb 5 szint (egy rész legalább kb. 6 nap).
    const fetchRange = async (from: number, to: number, depth: number): Promise<Array<Pick<Training, 'id' | 'lecture' | 'userProgram'>>> => {
      try {
        return await client.fetchAll(TrainingLecturesQuery, { from: toIso(from), to: toIso(to), all: true }, (d) => d.trainings)
      } catch (error) {
        if (!(error instanceof FlightLoggerPageLimitError) || depth >= 5) throw error
        const halves = splitRange(from, to, 2)
        return (await Promise.all(halves.map(([f, t]) => fetchRange(f, t, depth + 1)))).flat()
      }
    }
    const ranges = splitRange(nowMs - 730 * DAY_MS, nowMs, 4)
    const lists = await Promise.all(ranges.map(([from, to]) => fetchRange(from, to, 0)))
    lectures = Object.values(mergeCatalog(lecturesFromTrainings(uniqueById(lists))))
  }
  // A gyorsítótár hibája nem rontja el a betöltést.
  await deps.catalogCache?.save({ fetchedAt: toIso(fresh ? Math.max(cachedAt, nowMs) : nowMs), lectures }).catch(() => undefined)
  return lectures
}
