import { createDefaultSettings, DEFAULT_OPENING_HOURS } from '../../src/core/config/defaults'
import type { Settings } from '../../src/core/config/schema'
import type { BookingRequest, ExistingBooking } from '../../src/core/model/planning'
import type { Snapshot, WeatherHour } from '../../src/core/model/snapshot'
import { addDays, localToMs, toIso } from '../../src/core/time/zoned'

/**
 * Szintetikus heti forgatókönyvek a motor teszteléséhez. Minden azonosító, lajstromjel
 * és koordináta kitalált (CLAUDE.md 4. pont).
 *
 * A hét 2026. november 16-án (hétfő) kezdődik, a terv vasárnap 10:00-kor készül,
 * a repülőtér időzónája Europe/Budapest.
 */

export const TZ = 'Europe/Budapest'
export const WEEK_START = '2026-11-16'
export const PLANNED_AT = '2026-11-15T09:00:00.000Z'
export const INSTRUCTOR = 'oktato-1'
export const DAYS = Array.from({ length: 7 }, (_, i) => addDays(WEEK_START, i))

export const at = (date: string, hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number]
  return toIso(localToMs(date, h * 60 + m, TZ))
}

export function baseSettings(): Settings {
  const s = createDefaultSettings()
  const workday = { start: '08:00', end: '16:00' }
  return {
    ...s,
    airport: { icaoCode: 'XXXX', latitude: 47.5, longitude: 21.5, timezone: TZ, runways: [{ designator: '04', trueHeadingDeg: 41 }, { designator: '22', trueHeadingDeg: 221 }], openingHours: DEFAULT_OPENING_HOURS },
    instructor: { workWindows: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: null, sun: null }, blockedPeriods: [] },
    resources: {
      p1: { kind: 'aircraft' },
      p2: { kind: 'aircraft' },
      c1: { kind: 'aircraft' },
      s1: { kind: 'simulator' },
    },
    aircraftHours: {
      p1: { date: '2026-11-15', hoursUntilMaintenance: 40, enteredAt: '2026-11-15T07:00:00.000Z' },
      p2: { date: '2026-11-15', hoursUntilMaintenance: 40, enteredAt: '2026-11-15T07:00:00.000Z' },
      c1: { date: '2026-11-15', hoursUntilMaintenance: 40, enteredAt: '2026-11-15T07:00:00.000Z' },
    },
    classrooms: { r1: { capacity: 10, preferenceRank: 1 }, r2: { capacity: 4, preferenceRank: 2 } },
    students: ['n1', 'n2', 'n3', 'n4', 'n5'].map((userId) => ({ userId, allowedResources: [{ aircraftType: 'PIPER P28A' }] })),
  }
}

/** Jó idő: gyenge szél a pálya irányából, jó látás, magas felhőalap. */
export function goodHour(time: string): WeatherHour {
  return {
    time,
    temperatureC: 10,
    dewPointC: 2,
    windSpeedKt: 5,
    windDirectionDeg: 40,
    windGustKt: 8,
    visibilityM: 20_000,
    cloudCoverLowPct: 10,
    precipitationMm: 0,
    precipitationProbabilityPct: 5,
    capeJPerKg: 0,
  }
}

/** Rossz idő: erős oldalszél és széllökés. */
export function badHour(time: string): WeatherHour {
  return { ...goodHour(time), windSpeedKt: 30, windDirectionDeg: 130, windGustKt: 40 }
}

export function weekWeather(isBad: (date: string, hour: number) => boolean = () => false): WeatherHour[] {
  const hours: WeatherHour[] = []
  for (const date of [addDays(WEEK_START, -1), ...DAYS]) {
    for (let h = 0; h < 24; h++) {
      const time = toIso(localToMs(date, h * 60, TZ))
      hours.push(isBad(date, h) ? badHour(time) : goodHour(time))
    }
  }
  return hours
}

export function baseSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    generatedAt: PLANNED_AT,
    weekStart: WEEK_START,
    timezone: TZ,
    instructorId: INSTRUCTOR,
    fleet: [
      { id: 'p1', callSign: 'HA-XPA', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
      { id: 'p2', callSign: 'HA-XPB', model: 'PIPER P28A', aircraftClass: 'SINGLE_ENGINE', disabled: false },
      { id: 'c1', callSign: 'HA-XCA', model: 'CESSNA 152', aircraftClass: 'SINGLE_ENGINE', disabled: false },
      { id: 's1', callSign: 'SIM-X', model: 'SIM', aircraftClass: 'SIMULATOR', disabled: false },
    ],
    classroomIds: ['r1', 'r2'],
    bookings: [],
    availabilities: {},
    lastFlightAt: { n1: '2026-11-10T10:00:00.000Z', n2: '2026-11-10T10:00:00.000Z', n3: '2026-11-10T10:00:00.000Z', n4: '2026-11-10T10:00:00.000Z', n5: '2026-11-10T10:00:00.000Z' },
    instructorFlights: [],
    weather: weekWeather(),
    daylight: Object.fromEntries(DAYS.map((d) => [d, { sunrise: at(d, '06:50'), sunset: at(d, '16:10') }])),
    ...overrides,
  }
}

export function flight(id: string, studentId: string, extra: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id,
    kind: 'flight',
    studentIds: [studentId],
    taskSelectionMode: 'none',
    durations: { briefing: 30, main: 60, debriefing: 15 },
    daylightOnly: true,
    origin: 'manual',
    ...extra,
  }
}

export function theory(id: string, studentIds: string[], extra: Partial<BookingRequest> = {}): BookingRequest {
  return {
    id,
    kind: 'theory',
    studentIds,
    taskSelectionMode: 'none',
    durations: { briefing: 0, main: 90, debriefing: 0 },
    daylightOnly: false,
    origin: 'manual',
    ...extra,
  }
}

export function existing(id: string, extra: Partial<ExistingBooking> & Pick<ExistingBooking, 'start' | 'end'>): ExistingBooking {
  return { id, type: 'singleStudent', status: 'OPEN', participantIds: [], ...extra }
}

/** Determinisztikus álvéletlen-generátor a tulajdonságteszthez (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
