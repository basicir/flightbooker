import { createDefaultSettings, DEFAULT_OPENING_HOURS } from '../config/defaults'
import type { TheoryCatalog } from '../model/theoryCatalog'
import type { Settings } from '../config/schema'
import type { DataBundle, DirectoryPerson } from '../model/dataBundle'
import type { ExistingBooking } from '../model/planning'
import type { MaintenanceType } from '../model/resources'
import type { WeatherHour } from '../model/snapshot'
import type { LocalDate } from '../model/time'
import { computeProgress, programLectures, type LectureInfo, type TrainingRecord } from '../progress/lectures'
import { addDays, localParts, localToMs, toIso, toMs } from '../time/zoned'
import { WEATHER_CHECK_MODELS, type ModelForecast, type WeatherCheckModelId } from '../weather/forecastCheck'
import type { VerificationLogHour } from '../weather/skill'

/**
 * Bemutató mód: teljesen szintetikus adat a felület kipróbálásához és a teszteléshez.
 * Minden név, lajstromjel, azonosító és koordináta kitalált; valódi adat nincs benne.
 */

export const DEMO_TIMEZONE = 'Europe/Budapest'
export const DEMO_INSTRUCTOR = 'demo-oktato'

const STUDENTS: ReadonlyArray<[string, string]> = [
  ['demo-n1', 'Demó Anna'],
  ['demo-n2', 'Demó Bence'],
  ['demo-n3', 'Demó Csilla'],
  ['demo-n4', 'Demó Dávid'],
  ['demo-n5', 'Demó Eszter'],
  ['demo-n6', 'Demó Ferenc'],
  ['demo-n7', 'Demó Gréta'],
  ['demo-n8', 'Demó Huba'],
]

const DEMO_REVISION = 'demo-rev'

/** Szintetikus feladatlista; a nevek kódja adja a sorrendet, a sorrend itt szándékosan kevert. */
const DEMO_LECTURES: readonly LectureInfo[] = (
  [
    ['demo-l3', 'I./3. Demó egyenes repülés', 45, 60, 30, false, false],
    ['demo-l1', 'I./1. Demó ismerkedő repülés', 45, 30, 30, false, false],
    ['demo-l2', 'I./2. Demó gurulás és kör', 45, 30, 30, false, false],
    ['demo-l10', 'II./1. Demó első egyedül', 45, 30, 30, false, false],
    ['demo-l4', 'I./4. Demó forduló', 45, 60, 30, false, false],
    ['demo-l5', 'I./5. Demó iskolakör', 45, 60, 30, false, false],
    ['demo-l6', 'I./6. Demó kényszerhelyzetek', 45, 90, 30, false, false],
    ['demo-l7', 'I./7. Demó éjszakai kör', 45, 60, 30, false, true],
    ['demo-l8', 'I./8. Demó műszeres alapok (FNPT)', 30, 60, 30, true, false],
    ['demo-l9', 'I./9. Demó útvonal', 45, 120, 30, false, false],
  ] as const
).map(([id, name, briefingMinutes, flightMinutes, debriefingMinutes, simulator, night]) => ({ id, name, revisionId: DEMO_REVISION, programName: 'Demó PPL(A)', briefingMinutes, flightMinutes, debriefingMinutes, simulator, night }))

const DEMO_CATALOG: Readonly<Record<string, LectureInfo>> = Object.fromEntries(DEMO_LECTURES.map((l) => [l.id, l]))

const at = (date: LocalDate, hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return toIso(localToMs(date, h * 60 + m, DEMO_TIMEZONE))
}

/** Determinisztikus időjárás a héten: hétfő jó, kedd délután szeles, szerda front, csütörtök bizonytalan. */
function demoWeather(weekStart: LocalDate): WeatherHour[] {
  const hours: WeatherHour[] = []
  for (let day = -1; day < 8; day++) {
    const date = addDays(weekStart, day)
    for (let h = 0; h < 24; h++) {
      const time = toIso(localToMs(date, h * 60, DEMO_TIMEZONE))
      let wind = 6
      let dir = 50
      let gust = 10
      let vis = 25_000
      let dew = 1
      let rain = 0
      if (day === 1 && h >= 12) {
        wind = 24
        dir = 140
        gust = 34
      }
      if (day === 2) {
        wind = 18
        dir = 200
        gust = 30
        vis = 3000
        dew = 8.5
        rain = 2.5
      }
      if (day === 3) {
        wind = 11
        dir = 110
        gust = 18
      }
      hours.push({
        time,
        temperatureC: 9,
        dewPointC: dew,
        windSpeedKt: wind,
        windDirectionDeg: dir,
        windGustKt: gust,
        visibilityM: vis,
        cloudCoverLowPct: day === 2 ? 95 : 20,
        precipitationMm: rain,
        precipitationProbabilityPct: day === 2 ? 90 : 10,
        capeJPerKg: 0,
      })
    }
  }
  return hours
}

/**
 * Bemutató útvonal-időjárás (K27, SZB-19): a bázisé, de pénteken délelőtt a frontzóna már
 * eléri a többi repülőteret (gyenge látás, alacsony felhőalap), így látszik a különbség.
 */
export function demoRouteWeather(weekStart: LocalDate): WeatherHour[] {
  const friday = addDays(weekStart, 4)
  return demoWeather(weekStart).map((h) => {
    const local = localParts(toMs(h.time), DEMO_TIMEZONE)
    if (local.date !== friday || local.minutes < 8 * 60 || local.minutes >= 13 * 60) return h
    return { ...h, visibilityM: 2500, dewPointC: 8.5, cloudCoverLowPct: 95, precipitationMm: 1.5, precipitationProbabilityPct: 85 }
  })
}

/**
 * Bemutató modell-összevetés az indítópult időjárás-ellenőrzéséhez: a bázis időjárása
 * modellenként kicsit eltolva (szél, front időzítése), a valódi modellekhez hasonló
 * előrejelzési hosszal. Az ICON-D2 a valósághoz hasonlóan nem fedi le a bázist.
 */
export function demoModelForecasts(now: Date, weekStart: LocalDate): ModelForecast[] {
  const variants: Record<WeatherCheckModelId, { horizonH: number; windDelta: number; frontShiftH: number; visibility: boolean } | undefined> = {
    icon_d2: undefined,
    icon_eu: { horizonH: 120, windDelta: 2, frontShiftH: 0, visibility: true },
    icon_global: { horizonH: 180, windDelta: 0, frontShiftH: 3, visibility: false },
    ecmwf_ifs025: { horizonH: 360, windDelta: -2, frontShiftH: -4, visibility: false },
    gfs_seamless: { horizonH: 384, windDelta: 4, frontShiftH: 6, visibility: true },
    ukmo_seamless: { horizonH: 168, windDelta: 1, frontShiftH: -2, visibility: true },
    meteofrance_seamless: { horizonH: 108, windDelta: -1, frontShiftH: 2, visibility: false },
    dmi_seamless: { horizonH: 168, windDelta: 1, frontShiftH: 1, visibility: true },
  }
  const base = demoWeather(weekStart)
  const nowMs = now.getTime()
  return WEATHER_CHECK_MODELS.map(({ id }) => {
    const v = variants[id]
    if (!v) return { model: id, hours: [], error: 'Erre a helyre nincs adata.' }
    const hours = base.map((h, i) => {
      const t = toMs(h.time)
      if (t > nowMs + v.horizonH * 3_600_000) return { ...h, temperatureC: null, dewPointC: null, windSpeedKt: null, windDirectionDeg: null, windGustKt: null, visibilityM: null, cloudCoverLowPct: null, precipitationMm: null, precipitationProbabilityPct: null, capeJPerKg: null }
      // A front időzítése: a modell más óra értékeit látja ugyanarra az időpontra.
      const src = base[Math.min(base.length - 1, Math.max(0, i - v.frontShiftH))]!
      const shift = (x: number | null): number | null => (x === null ? null : Math.max(0, x + v.windDelta))
      return { ...src, time: h.time, windSpeedKt: shift(src.windSpeedKt), windGustKt: shift(src.windGustKt), visibilityM: v.visibility ? src.visibilityM : null }
    })
    return { model: id, hours }
  })
}

/**
 * Bemutató mérési napló (ADT-07): az elmúlt 48 óra szintetikus METAR-jai és a bemutató
 * modellek előrejelzése rájuk, a modellek eltérő hibájával. Csak a felület bemutatásához.
 */
export function demoVerificationLog(now: Date): VerificationLogHour[] {
  const variants: Partial<Record<WeatherCheckModelId, { readonly wind: number; readonly temp: number; readonly vis: boolean; readonly ceil: number }>> = {
    icon_eu: { wind: 2, temp: 0.5, vis: true, ceil: 200 },
    icon_global: { wind: -3, temp: 1.5, vis: false, ceil: 600 },
    ecmwf_ifs025: { wind: -1, temp: -0.8, vis: false, ceil: 300 },
    gfs_seamless: { wind: 6, temp: 2.5, vis: true, ceil: 900 },
    ukmo_seamless: { wind: 1, temp: -1.2, vis: true, ceil: 400 },
    meteofrance_seamless: { wind: -2, temp: 0.3, vis: false, ceil: 250 },
    dmi_seamless: { wind: 1, temp: 0.2, vis: true, ceil: 150 },
  }
  const lastHour = Math.floor(now.getTime() / 3_600_000) * 3_600_000
  const out: VerificationLogHour[] = []
  for (let i = 47; i >= 1; i--) {
    const ms = lastHour - i * 3_600_000
    const time = new Date(ms).toISOString()
    const wave = Math.sin(i / 5)
    const windKt = Math.max(0, Math.round(8 + 6 * wave))
    const gustKt = windKt >= 12 ? windKt + 9 : windKt
    const visibilityM = i % 13 < 3 ? 4000 : 10_000
    const ceilingFt = i % 11 < 4 ? 1200 + (i % 4) * 300 : null
    const temperatureC = Math.round(6 + 4 * Math.sin((i - 6) / 4))
    const d = new Date(ms)
    const dd = String(d.getUTCDate()).padStart(2, '0')
    const hh = String(d.getUTCHours()).padStart(2, '0')
    const tt = (c: number): string => (c < 0 ? `M${String(-c).padStart(2, '0')}` : String(c).padStart(2, '0'))
    const raw = `METAR ZZZZ ${dd}${hh}00Z 240${String(windKt).padStart(2, '0')}${gustKt > windKt ? `G${gustKt}` : ''}KT ${visibilityM >= 10_000 ? '9999' : visibilityM}${visibilityM < 5000 ? ' BR' : ''} ${ceilingFt ? `BKN${String(ceilingFt / 100).padStart(3, '0')}` : 'SCT045'} ${tt(temperatureC)}/${tt(temperatureC - 3)} Q1018`
    const forecasts = Object.entries(variants).map(([model, v]) => ({
      model,
      issuedAt: new Date(ms - (6 + (i % 12)) * 3_600_000).toISOString(),
      windKt: Math.max(0, windKt + v.wind),
      gustKt: Math.max(0, gustKt + v.wind + (i % 3) - 1),
      visibilityM: v.vis ? (i % 13 < 4 ? 5000 : 10_000) : null,
      ceilingFt: ceilingFt === null ? (i % 7 === 0 ? 2500 : 8000) : ceilingFt + v.ceil,
      temperatureC: Math.round((temperatureC + v.temp) * 10) / 10,
    }))
    out.push({ time, observation: { time, windKt, gustKt, visibilityM, ceilingFt, temperatureC, raw }, forecasts })
  }
  return out
}

export function createDemoBundle(now: Date, weekStart: LocalDate): DataBundle {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const today = localParts(now.getTime(), DEMO_TIMEZONE).date
  const bookings: ExistingBooking[] = [
    // Más oktatók repülései
    ...days.slice(0, 5).map((d, i) => ({
      id: `demo-b${i}`,
      type: 'singleStudent' as const,
      status: 'OPEN' as const,
      start: at(d, '08:00'),
      end: at(d, '10:15'),
      flightStart: at(d, '08:30'),
      flightEnd: at(d, '09:45'),
      resourceId: 'demo-p1',
      instructorId: 'demo-masik',
      participantIds: ['demo-k1'],
      color: '#4AADFF',
    })),
    // Karbantartás: a Cessna szerdától péntekig nem elérhető
    {
      id: 'demo-mx',
      type: 'maintenance',
      status: 'OPEN',
      start: at(days[2]!, '00:00'),
      end: at(days[4]!, '23:00'),
      flightStart: at(days[2]!, '00:00'),
      flightEnd: at(days[4]!, '23:00'),
      resourceId: 'demo-c1',
      participantIds: [],
      color: '#A0A0A0',
    },
    // Az oktató saját megbeszélése kedd délelőtt
    {
      id: 'demo-meet',
      type: 'meeting',
      status: 'OPEN',
      start: at(days[1]!, '09:00'),
      end: at(days[1]!, '10:30'),
      classroomId: 'demo-r2',
      instructorId: DEMO_INSTRUCTOR,
      participantIds: [DEMO_INSTRUCTOR],
      color: '#C191EC',
    },
  ]
  const lastFlightAt = Object.fromEntries(
    STUDENTS.map(([id], i) => [id, i === 7 ? null : toIso(toMs(at(addDays(today, -(2 + i * 3)), '10:00')))]),
  )
  const instructorFlights = Array.from({ length: 20 }, (_, i) => {
    const start = toMs(at(addDays(today, -(1 + i)), '09:00'))
    return { start: toIso(start), end: toIso(start + 90 * 60_000), simulator: i % 7 === 0 }
  })
  const people: Record<string, DirectoryPerson> = {
    [DEMO_INSTRUCTOR]: { name: 'Demó Oktató', role: 'instructor', callSign: 'DEMO' },
    'demo-masik': { name: 'Demó Másik Oktató', role: 'instructor', callSign: 'DMAS' },
    'demo-k1': { name: 'Demó Kálmán', role: 'student', callSign: 'DKAL' },
    ...Object.fromEntries(STUDENTS.map(([id, name], i) => [id, { name, role: 'student' as const, callSign: `D${String(i + 1).padStart(2, '0')}` }])),
  }
  return {
    source: 'demo',
    fetchedAt: now.toISOString(),
    snapshot: {
      generatedAt: now.toISOString(),
      weekStart,
      timezone: DEMO_TIMEZONE,
      instructorId: DEMO_INSTRUCTOR,
      fleet: [
        { id: 'demo-p1', callSign: 'HA-DPA', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
        { id: 'demo-p2', callSign: 'HA-DPB', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
        { id: 'demo-p3', callSign: 'HA-DPC', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
        { id: 'demo-c1', callSign: 'HA-DCA', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
        { id: 'demo-c2', callSign: 'HA-DCB', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
        { id: 'demo-s1', callSign: 'DEMO SIM', model: 'SIM-1', aircraftClass: 'SIMULATOR', disabled: false },
      ],
      classroomIds: ['demo-r1', 'demo-r2', 'demo-r3'],
      bookings,
      availabilities: { 'demo-n3': [{ start: at(days[3]!, '00:00'), end: at(days[3]!, '23:59'), unavailable: true }] },
      lastFlightAt,
      instructorFlights,
      weather: demoWeather(weekStart),
      daylight: Object.fromEntries([addDays(weekStart, -1), ...days].map((d) => [d, { sunrise: at(d, '06:45'), sunset: at(d, '16:15') }])),
    },
    directory: {
      people,
      classrooms: { 'demo-r1': 'Demó terem 1', 'demo-r2': 'Demó terem 2', 'demo-r3': 'Demó tárgyaló' },
      lectures: DEMO_CATALOG,
      classes: {
        'demo-o1': { name: 'Demó osztály A', memberIds: ['demo-n1', 'demo-n2', 'demo-n7'] },
        'demo-o2': { name: 'Demó osztály B', memberIds: ['demo-n3', 'demo-n4', 'demo-n8'] },
      },
    },
    progress: Object.fromEntries(
      STUDENTS.map(([id], i) => {
        // Szintetikus haladás: minden növendék máshol tart, az egyik kihagyott egy feladatot.
        const done = programLectures(DEMO_CATALOG, DEMO_REVISION).slice(0, 2 + i).filter((_, j) => !(i === 4 && j === 3))
        const records: TrainingRecord[] = done.map((l, j) => ({ lectureId: l.id, status: 'PASSED', at: at(addDays(weekStart, -30 + j * 3 + i), '09:00'), revisionId: DEMO_REVISION, programName: 'Demó PPL(A)' }))
        return [id, computeProgress(records, DEMO_CATALOG)]
      }),
    ),
    syllabi: [],
    syllabusErrors: [],
    trainingRecords: {},
    errors: [],
  }
}

/** A bemutató mód kitöltött beállításai, hogy az első beállítás gyorsan végigjárható legyen. */
export function createDemoSettings(today: LocalDate, nowIso: string): Settings {
  const s = createDefaultSettings()
  const hours = (n: number, maintenanceType: MaintenanceType) => ({ date: today, hoursUntilMaintenance: n, maintenanceType, enteredAt: nowIso })
  return {
    ...s,
    dataSource: 'demo',
    airport: {
      icaoCode: 'ZZZZ',
      latitude: 47.5,
      longitude: 21.6,
      timezone: DEMO_TIMEZONE,
      runways: [
        { designator: '04', trueHeadingDeg: 41 },
        { designator: '22', trueHeadingDeg: 221 },
      ],
      openingHours: DEFAULT_OPENING_HOURS,
    },
    aircraftTypes: {},
    resources: {
      'demo-p1': { kind: 'aircraft' },
      'demo-p2': { kind: 'aircraft' },
      'demo-p3': { kind: 'aircraft' },
      'demo-c1': { kind: 'aircraft' },
      'demo-c2': { kind: 'aircraft' },
      'demo-s1': { kind: 'simulator' },
    },
    aircraftHours: { 'demo-p1': hours(22, 50), 'demo-p2': hours(4.5, 200), 'demo-p3': hours(35, 100), 'demo-c1': hours(12, 50), 'demo-c2': hours(28, 25) },
    maintenance: { ...s.maintenance, 50: { overflyHours: 5, durationHours: 24 }, 100: { overflyHours: 10, durationHours: 24 }, 200: { overflyHours: 10, durationHours: 48 } },
    classrooms: { 'demo-r1': { capacity: 12, preferenceRank: 1 }, 'demo-r2': { capacity: 8, preferenceRank: 2 }, 'demo-r3': { capacity: 4, preferenceRank: 3 } },
    students: STUDENTS.slice(0, 6).map(([userId], i) => ({
      userId,
      allowedResources: i % 3 === 2 ? [{ aircraftType: 'CESSNA 152' }, { aircraftType: 'PIPER P28A' }] : [{ aircraftType: 'PIPER P28A' }],
      preferredResources: i % 3 === 2 ? [{ aircraftType: 'CESSNA 152' }] : [{ aircraftId: i % 2 === 0 ? 'demo-p1' : 'demo-p3' }],
      dayOrder: i,
      priority: i === 1 ? 5 : 3,
    })),
  }
}

/** Szintetikus programlista az elméleti foglaláshoz (FLI-11), a bemutató módhoz. */
export function demoTheoryCatalog(now: Date): TheoryCatalog {
  const programs = [
    { revisionId: 'demo-rev-gs1', programId: 'demo-gs', programName: 'Demó Ground School', revisionName: 'Revision 1', programType: 'GROUND_TRAINING' as const },
    { revisionId: 'demo-rev-th2', programId: 'demo-th', programName: 'Demó Theory', revisionName: 'Revision 2', programType: 'GROUND_TRAINING' as const },
    { revisionId: 'demo-rev-ppl', programId: 'demo-ppl', programName: 'Demó PPL(A)', revisionName: 'Revision 3', programType: 'FLIGHT_TRAINING' as const },
  ].map((p) => ({ ...p, label: `${p.programName} ${p.revisionName}` }))
  const subjects = [
    ...['Demó alapismeretek', 'Demó navigáció', 'Demó meteorológia'].map((name, i) => ({ id: `demo-subj-gs-${i}`, name, revisionId: 'demo-rev-gs1' })),
    ...['Demó műszeres repülés', 'Demó emberi tényezők'].map((name, i) => ({ id: `demo-subj-th-${i}`, name, revisionId: 'demo-rev-th2' })),
  ]
  return { fetchedAt: now.toISOString(), source: 'demo', programs, subjects, errors: [] }
}
