import { describe, expect, it } from 'vitest'
import { createDefaultSettings, DEFAULT_LIMIT_RULES, DEFAULT_WEIGHTS } from '../../../src/core/config/defaults'
import { SettingsSchema, type Settings } from '../../../src/core/config/schema'
import { migrateRaw, parseSettings, parseSettingsJson, serializeSettings } from '../../../src/core/config/settings'
import type { LimitRule } from '../../../src/core/model/limits'
import type { StudentSettings, WeatherLimits } from '../../../src/core/model'
import type { AircraftHoursEntry, AircraftTypeSettings, ClassroomSettings, ResourceSettings } from '../../../src/core/model/resources'

// Fordítási idejű ellenőrzés: a séma típusai a 4. fejezet modelltípusaiba illeszkednek.
const _typeChecks = (s: Settings): void => {
  const student: StudentSettings | undefined = s.students[0]
  const rule: LimitRule | undefined = s.limits.rules[0]
  const aircraftType: AircraftTypeSettings | undefined = s.aircraftTypes['x']
  const resource: ResourceSettings | undefined = s.resources['x']
  const hours: AircraftHoursEntry | undefined = s.aircraftHours['x']
  const classroom: ClassroomSettings | undefined = s.classrooms['x']
  const minima: WeatherLimits = s.weather.schoolMinima
  void [student, rule, aircraftType, resource, hours, classroom, minima]
}
void _typeChecks

const withChanges = (change: (s: Record<string, unknown>) => void): unknown => {
  const s = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
  change(s)
  return s
}

function errorsOf(value: unknown): string[] {
  const result = parseSettings(value)
  return result.ok ? [] : [...result.errors]
}

describe('alapértékek (7.3, 8.2, 10. fejezet)', () => {
  it('az alapbeállítás érvényes a séma szerint', () => {
    expect(SettingsSchema.safeParse(createDefaultSettings()).success).toBe(true)
  })

  it('a 10. fejezet táblázatának értékeit adja', () => {
    const s = createDefaultSettings()
    expect(s.defaults).toEqual({
      engineRunUpMinutes: 20,
      briefingMinutes: 45,
      debriefingMinutes: 30,
      turnaroundMinutes: 15,
      teamSwapMinutes: 10,
      minReserveHours: 2,
      longNoFlyDays: 14,
      studentPriority: 3,
      requestPriority: 1,
      fillRequestPriority: 3,
    })
    expect(s.planning).toEqual({ taskSelectionMode: 'automatic', dilemmaThreshold: 10, minClassAttendancePct: 90 })
    expect(s.limits.rules.every((r) => r.warnAtPercent === 80)).toBe(true)
  })

  it('a 7.3 súlyait adja', () => {
    expect(DEFAULT_WEIGHTS).toMatchObject({ weatherFlight: 90, longNoFly: 80, scarcity: 70, preferredClassroom: 20 })
    expect(DEFAULT_WEIGHTS.avoidFirstFlight).toBe(40)
    expect(DEFAULT_WEIGHTS.classroomSize).toBe(40)
    expect(DEFAULT_WEIGHTS.instructorContinuity).toBe(30)
    expect(Object.keys(DEFAULT_WEIGHTS)).toHaveLength(14)
  })

  it('a 8.2 ajánlott limit-szabályait adja', () => {
    const byId = Object.fromEntries(DEFAULT_LIMIT_RULES.map((r) => [r.id, r]))
    expect(DEFAULT_LIMIT_RULES).toHaveLength(15)
    // Növendék: Training Manual Rev 8, II.6.4
    expect(byId['novendek-blokk-nap']).toMatchObject({ subject: 'student', metric: 'flightTime', limit: 4, window: { kind: 'calendarDay' } })
    expect(byId['novendek-blokk-ev']).toMatchObject({ metric: 'flightTime', limit: 900, window: { kind: 'calendarYear' } })
    expect(byId['novendek-szolgalat-nap']).toMatchObject({ metric: 'dutyTime', limit: 12 })
    expect(byId['novendek-szolgalat-30nap']).toMatchObject({ metric: 'dutyTime', limit: 210, window: { kind: 'rollingDays', days: 30 } })
    expect(byId['novendek-szolgalat-ev']).toMatchObject({ metric: 'dutyTime', limit: 2000, window: { kind: 'calendarYear' } })
    expect(byId['novendek-piheno']).toMatchObject({ metric: 'restTime', limit: 10 })
    expect(DEFAULT_LIMIT_RULES.filter((r) => r.subject === 'student').every((r) => r.source.startsWith('TM Rev 8'))).toBe(true)
    expect(byId['oktato-repult-28nap']).toMatchObject({ limit: 100, window: { kind: 'rollingDays', days: 28 } })
    expect(byId['oktato-repult-12honap']).toMatchObject({ limit: 1000, window: { kind: 'rollingCalendarMonths', months: 12 } })
    expect(byId['oktato-piheno']).toMatchObject({ limit: 12, restAtLeastPreviousDuty: true })
    expect(byId['novendek-feladat-nap']).toMatchObject({ metric: 'taskCount', limit: 2 })
  })

  it('a létrehozott alapbeállítások nem osztoznak objektumon', () => {
    const a = createDefaultSettings()
    const b = createDefaultSettings()
    ;(a.weights as Record<string, number>)['priority'] = 1
    expect(b.weights.priority).toBe(65)
  })
})

describe('kiírás és beolvasás (ALP-05)', () => {
  it('oda-vissza alakítás után ugyanazt kapjuk, a kiírás stabil', () => {
    const text = serializeSettings(createDefaultSettings())
    const parsed = parseSettingsJson(text)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(serializeSettings(parsed.settings)).toBe(text)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('\n  "formatVersion": 9,')
  })

  it('érvénytelen beállítást nem ír ki', () => {
    const bad = { ...createDefaultSettings(), weights: { ...DEFAULT_WEIGHTS, priority: 150 } }
    expect(() => serializeSettings(bad)).toThrow(/nem menthető/)
  })

  it('nem JSON szövegnél érthető hibát ad', () => {
    const result = parseSettingsJson('{ ez nem json')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/nem érvényes JSON/)
  })
})

describe('szigorú séma', () => {
  it('ismeretlen mezőt nem fogad el, így API-kulcs sem kerülhet a fájlba (ALP-06)', () => {
    expect(errorsOf(withChanges((s) => (s['apiKey'] = 'x'))).join(' ')).toMatch(/apiKey/)
    expect(errorsOf(withChanges((s) => ((s['planning'] as Record<string, unknown>)['token'] = 'x'))).length).toBeGreaterThan(0)
  })

  it('a növendékhez nem tárol nevet vagy e-mailt (3.3)', () => {
    const value = withChanges((s) => (s['students'] = [{ userId: 'u1', allowedResources: [], email: 'a@b.hu' }]))
    expect(errorsOf(value).join(' ')).toMatch(/email/)
  })

  it.each([
    ['prioritás 1–5 (NOV-12)', (s: Record<string, unknown>) => (s['students'] = [{ userId: 'u1', allowedResources: [], priority: 6 }])],
    ['súly 0–100% (SZB-10)', (s: Record<string, unknown>) => (s['weights'] = { ...DEFAULT_WEIGHTS, scarcity: 101 })],
    ['ÓÓ:PP idő', (s: Record<string, unknown>) => ((s['instructor'] as { workWindows: Record<string, unknown> }).workWindows['mon'] = { start: '25:00', end: '26:00' })],
    ['az ablak vége a kezdete után', (s: Record<string, unknown>) => ((s['instructor'] as { workWindows: Record<string, unknown> }).workWindows['mon'] = { start: '18:00', end: '08:00' })],
    ['kategória a gépnél (2. formátumtól nincs)', (s: Record<string, unknown>) => (s['resources'] = { a1: { kind: 'aircraft', categoryId: 'nincs' } })],
    ['kategóriára hivatkozó növendék (2. formátumtól nincs)', (s: Record<string, unknown>) => (s['students'] = [{ userId: 'u1', allowedResources: [{ categoryId: 'nincs' }] }])],
    ['CAPE-limit (2. formátumtól nincs)', (s: Record<string, unknown>) => ((s['weather'] as { schoolMinima: Record<string, unknown> }).schoolMinima['maxCapeJPerKg'] = 1000)],
    ['ismétlődő növendék', (s: Record<string, unknown>) => (s['students'] = [{ userId: 'u1', allowedResources: [] }, { userId: 'u1', allowedResources: [] }])],
    ['pihenőidő más ablakkal', (s: Record<string, unknown>) => ((s['limits'] as { rules: Array<Record<string, unknown>> }).rules.find((r) => r['metric'] === 'restTime')!['window'] = { kind: 'calendarDay' })],
    ['érvénytelen pályajel', (s: Record<string, unknown>) => (s['airport'] = { icaoCode: 'XXXX', latitude: 47, longitude: 21, timezone: 'Europe/Budapest', runways: [{ designator: '40', trueHeadingDeg: 10 }], openingHours: createDefaultSettings().instructor.workWindows })],
    ['tiltott időszak fordított végekkel', (s: Record<string, unknown>) => ((s['instructor'] as { blockedPeriods: unknown[] }).blockedPeriods = [{ id: 'b1', kind: 'once', start: '2026-11-12T10:00:00Z', end: '2026-11-12T09:00:00Z' }])],
  ])('elutasítja: %s', (_label, change) => {
    expect(errorsOf(withChanges(change)).length).toBeGreaterThan(0)
  })

  it('elfogadja a negatív tartalékot (SZB-06) és az ismétlődő tiltott időszakot (K35)', () => {
    const value = withChanges((s) => {
      s['resources'] = { a1: { kind: 'aircraft', minReserveHours: -1.5 } }
      ;(s['instructor'] as { blockedPeriods: unknown[] }).blockedPeriods = [
        { id: 'b1', kind: 'weekly', weekday: 'wed', start: '12:00', end: '13:00', note: 'ebéd' },
      ]
    })
    expect(errorsOf(value)).toEqual([])
  })

  it('a hibaüzenetek magyarok és megnevezik a mezőt', () => {
    const errors = errorsOf(withChanges((s) => (s['students'] = [{ userId: 'u1', allowedResources: [], priority: 6 }])))
    expect(errors[0]).toMatch(/^students\.0\.priority: /)
    expect(errors[0]).not.toMatch(/Too big|Number must/)
  })
})

describe('verziókezelés', () => {
  it('a 8. formátum adatforrás-mezőjét elhagyja (a bemutató mód megszűnt)', () => {
    for (const dataSource of ['live', 'demo']) {
      const result = parseSettings({ ...structuredClone(createDefaultSettings()), formatVersion: 8, dataSource })
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.migratedFrom).toBe(8)
        expect(result.settings).not.toHaveProperty('dataSource')
      }
    }
  })

  it('hiányzó verziót és újabb verziót elutasít', () => {
    expect(errorsOf(withChanges((s) => delete s['formatVersion']))[0]).toMatch(/formatVersion/)
    expect(errorsOf(withChanges((s) => (s['formatVersion'] = 10)))[0]).toMatch(/újabb verziójával/)
  })

  it('az 1. formátumot a 2.-ra alakítja: géptípus a kategória helyett, több preferált gép, nincs globális repülési idő és CAPE', () => {
    const v2 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { aircraftTypes: _t, ...rest } = v2
    const v1 = {
      ...rest,
      formatVersion: 1,
      categories: [{ id: 'piper', name: 'Piper', engineRunUpMinutes: 25 }],
      resources: { a1: { kind: 'aircraft', categoryId: 'piper', turnaroundMinutes: 10 } },
      defaults: { ...(v2['defaults'] as object), flightMinutes: 60 },
      weather: { schoolMinima: { maxWindKt: 25, maxCapeJPerKg: 1000 }, minimaSource: 'x' },
      students: [
        { userId: 'u1', allowedResources: [{ categoryId: 'piper' }, { aircraftId: 'a1' }], preferredResource: { aircraftId: 'a1' }, flightMinutes: 50, weatherLimits: { maxCrosswindKt: 10, maxCapeJPerKg: 500 } },
        { userId: 'u2', allowedResources: [], preferredResource: { categoryId: 'piper' } },
      ],
    }
    const result = parseSettings(v1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(1)
    expect(result.settings.aircraftTypes).toEqual({})
    expect(result.settings.resources).toEqual({ a1: { kind: 'aircraft', turnaroundMinutes: 10 } })
    expect(result.settings.defaults).not.toHaveProperty('flightMinutes')
    expect(result.settings.weather.schoolMinima).toEqual({ maxWindKt: 25 })
    expect(result.settings.students).toEqual([
      { userId: 'u1', allowedResources: [{ aircraftId: 'a1' }], preferredResources: [{ aircraftId: 'a1' }], weatherLimits: { maxCrosswindKt: 10 } },
      { userId: 'u2', allowedResources: [] },
    ])
  })

  it('a 2. formátumot a 3.-ra alakítja: a „Kevesebb motorpróba” súlya alapból 40%, a többi súly marad', () => {
    const v3 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { avoidFirstFlight: _a, ...oldWeights }: Record<string, number> = { ...(v3['weights'] as Record<string, number>), priority: 55 }
    const result = parseSettings({ ...v3, formatVersion: 2, weights: oldWeights })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(2)
    expect(result.settings.weights.avoidFirstFlight).toBe(40)
    expect(result.settings.weights.priority).toBe(55)
  })

  it('a 3. formátumot a 4.-re alakítja: a „Megfelelő teremméret” súlya alapból 40%, a többi súly marad', () => {
    const v4 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { classroomSize: _c, ...oldWeights }: Record<string, number> = { ...(v4['weights'] as Record<string, number>), avoidFirstFlight: 25 }
    const result = parseSettings({ ...v4, formatVersion: 3, weights: oldWeights })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(3)
    expect(result.settings.weights.classroomSize).toBe(40)
    expect(result.settings.weights.avoidFirstFlight).toBe(25)
  })

  it('az 5. formátumot a 6.-ra alakítja: a „Folyamatos oktatói program” az ajánlott 30%-kal, a többi súly marad', () => {
    const v6 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { instructorContinuity: _c, ...oldWeights }: Record<string, number> = { ...(v6['weights'] as Record<string, number>), instructorLoad: 45 }
    const result = parseSettings({ ...v6, formatVersion: 5, weights: oldWeights })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(5)
    expect(result.settings.weights.instructorContinuity).toBe(30)
    expect(result.settings.weights.instructorLoad).toBe(45)
  })

  it('a 6. formátumot a 7.-re alakítja: a közös briefing csapat csereideje alapból 10 perc (KBR-12), a többi alapérték marad', () => {
    const v7 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { teamSwapMinutes: _t, ...oldDefaults }: Record<string, number> = { ...(v7['defaults'] as Record<string, number>), turnaroundMinutes: 20 }
    const result = parseSettings({ ...v7, formatVersion: 6, defaults: oldDefaults })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(6)
    expect(result.settings.defaults.teamSwapMinutes).toBe(10)
    expect(result.settings.defaults.turnaroundMinutes).toBe(20)
  })

  it('a 7. formátumot a 8.-ra alakítja: az igény elsőbbsége alapból 1, a plusz igényé 3 (ELS-01), a többi alapérték marad', () => {
    const v8 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { requestPriority: _r, fillRequestPriority: _f, ...oldDefaults }: Record<string, number> = { ...(v8['defaults'] as Record<string, number>), studentPriority: 4 }
    const result = parseSettings({ ...v8, formatVersion: 7, defaults: oldDefaults })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(7)
    expect(result.settings.defaults.requestPriority).toBe(1)
    expect(result.settings.defaults.fillRequestPriority).toBe(3)
    expect(result.settings.defaults.studentPriority).toBe(4)
  })

  it('a 4. formátumot az 5.-re alakítja: karbantartás-fajtánként túlrepülés nélkül, 24 órás karbantartással (SZB-06)', () => {
    const v5 = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const { maintenance: _m, ...v4 } = v5
    const result = parseSettings({ ...v4, formatVersion: 4 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.migratedFrom).toBe(4)
    expect(result.settings.maintenance).toEqual({
      25: { overflyHours: 0, durationHours: 24 },
      50: { overflyHours: 0, durationHours: 24 },
      100: { overflyHours: 0, durationHours: 24 },
      200: { overflyHours: 0, durationHours: 24 },
    })
  })

  it('a kirepülhető időnél a karbantartás fajtája csak 25, 50, 100 vagy 200 lehet', () => {
    const base = structuredClone(createDefaultSettings()) as unknown as Record<string, unknown>
    const hours = (maintenanceType: number) => ({ a1: { date: '2026-11-11', hoursUntilMaintenance: 8, maintenanceType, enteredAt: '2026-11-11T07:00:00.000Z' } })
    expect(parseSettings({ ...base, aircraftHours: hours(200) }).ok).toBe(true)
    expect(parseSettings({ ...base, aircraftHours: hours(150) }).ok).toBe(false)
  })

  it('a migrációkat sorban alkalmazza', () => {
    const migrations = {
      1: (raw: Record<string, unknown>) => ({ ...raw, a: 1 }),
      2: (raw: Record<string, unknown>) => ({ ...raw, b: (raw['a'] as number) + 1 }),
    }
    const result = migrateRaw({ formatVersion: 1 }, migrations, 3)
    expect(result).toEqual({ raw: { formatVersion: 3, a: 1, b: 2 }, from: 1 })
    expect(migrateRaw({ formatVersion: 1 }, {}, 2)).toEqual({ error: 'Nincs migráció a 1. formátumról.' })
  })
})

describe('FlightLogger-import színek (FLI-12)', () => {
  it('a színek típusonként opcionálisak; hiányuk nem kell migrációhoz', () => {
    const base = createDefaultSettings()
    expect(SettingsSchema.safeParse(base).success).toBe(true)
    expect(SettingsSchema.safeParse({ ...base, flImport: { colors: { singleStudent: '#26A69A', meeting: '#eb83b5' } } }).success).toBe(true)
    expect(SettingsSchema.safeParse({ ...base, flImport: { colors: {} } }).success).toBe(true)
  })

  it('csak #RRGGBB szín és ismert típus fogadható el', () => {
    const base = createDefaultSettings()
    expect(SettingsSchema.safeParse({ ...base, flImport: { colors: { singleStudent: 'piros' } } }).success).toBe(false)
    expect(SettingsSchema.safeParse({ ...base, flImport: { colors: { rental: '#26A69A' } } }).success).toBe(false)
  })
})
