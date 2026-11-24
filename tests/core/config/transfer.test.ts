import { describe, expect, it } from 'vitest'
import { createDefaultSettings } from '../../../src/core/config/defaults'
import type { Settings } from '../../../src/core/config/schema'
import { serializeSettings } from '../../../src/core/config/settings'
import { applySettingsImport, buildSettingsExport, readSettingsImport, settingsExportFileName } from '../../../src/core/config/transfer'
import { createDemoSettings } from '../../../src/core/demo/demoData'

// Szintetikus beállítás (bemutató adat): kitalált azonosítók, nincs benne személyes adat.
const NOW = '2026-11-12T10:00:00.000Z'
const source: Settings = { ...createDemoSettings('2026-11-12', NOW), lastSeen: { at: NOW, aircraftIds: ['demo-p1'], classroomIds: [] } }
const exportOf = (includeStudents: boolean): string => buildSettingsExport(source, { includeStudents, exportedAt: NOW, appVersion: '0.1.0' })
const ok = (text: string) => {
  const file = readSettingsImport(text)
  if (!file.ok) throw new Error(file.errors.join('\n'))
  return file
}

/** A célgép: más növendékkel és saját óraállással. */
const target: Settings = {
  ...createDefaultSettings(),
  students: [{ userId: 'masik-novendek', allowedResources: [] }],
  aircraftHours: { 'demo-p1': { date: '2026-11-12', hoursUntilMaintenance: 1, maintenanceType: 50, enteredAt: NOW } },
  lastSeen: null,
}

describe('beállítások exportja', () => {
  it('a gépre tartozó mezők sosem kerülnek bele, a növendékek csak kérésre', () => {
    const without = JSON.parse(exportOf(false))
    expect(without.kind).toBe('foglalastervezo-beallitasok')
    expect(without.includesStudents).toBe(false)
    expect(without.settings).not.toHaveProperty('students')
    for (const key of ['lastSeen', 'aircraftHours']) expect(without.settings).not.toHaveProperty(key)

    const withStudents = JSON.parse(exportOf(true))
    expect(withStudents.includesStudents).toBe(true)
    expect(withStudents.settings.students).toHaveLength(source.students.length)
    expect(withStudents.settings).not.toHaveProperty('aircraftHours')
  })

  it('érvénytelen beállítást nem exportál', () => {
    const bad = { ...source, weights: { ...source.weights, weatherFlight: 500 } }
    expect(() => buildSettingsExport(bad, { includeStudents: false, exportedAt: NOW, appVersion: 'x' })).toThrow(/nem exportálható/)
  })

  it('fájlnév a dátummal és a növendékek jelzésével', () => {
    expect(settingsExportFileName('2026-11-12', false)).toBe('foglalastervezo-beallitasok-2026-11-12.json')
    expect(settingsExportFileName('2026-11-12', true)).toBe('foglalastervezo-beallitasok-2026-11-12-novendekekkel.json')
  })
})

describe('beállítások importja', () => {
  it('növendékek nélküli export: a mostani növendékek és gépre tartozó mezők maradnak', () => {
    const file = ok(exportOf(false))
    expect(file.includesStudents).toBe(false)
    const next = applySettingsImport(target, file, { importStudents: true })
    expect(next.students).toEqual(target.students)
    expect(next.aircraftHours).toEqual(target.aircraftHours)
    expect(next.lastSeen).toBeNull()
    expect(next.airport).toEqual(source.airport)
    expect(next.weights).toEqual(source.weights)
    expect(next.resources).toEqual(source.resources)
  })

  it('növendékes export: a növendékek csak kérésre cserélődnek', () => {
    const file = ok(exportOf(true))
    expect(file.includesStudents).toBe(true)
    expect(file.studentCount).toBe(source.students.length)
    expect(applySettingsImport(target, file, { importStudents: true }).students).toEqual(source.students)
    expect(applySettingsImport(target, file, { importStudents: false }).students).toEqual(target.students)
  })

  it('a nyers beállítási fájlt is elfogadja, növendékekkel', () => {
    const file = ok(serializeSettings(source))
    expect(file.includesStudents).toBe(true)
    const next = applySettingsImport(target, file, { importStudents: true })
    expect(next.students).toEqual(source.students)
  })

  it('a bemutató mód idejéből való fájl adatforrás-mezője kimarad (8. → 9. formátum)', () => {
    const old = JSON.parse(serializeSettings(source))
    old.formatVersion = 8
    old.dataSource = 'demo'
    const file = ok(JSON.stringify(old))
    expect(file.migratedFrom).toBe(8)
    expect(file.raw).not.toHaveProperty('dataSource')
    expect(applySettingsImport(target, file, { importStudents: true })).not.toHaveProperty('dataSource')
  })

  it('régebbi formátumot migrál', () => {
    const old = JSON.parse(exportOf(false))
    old.settings.formatVersion = 4
    delete old.settings.maintenance
    const file = ok(JSON.stringify(old))
    expect(file.migratedFrom).toBe(4)
    expect(applySettingsImport(target, file, { importStudents: false }).maintenance).toBeDefined()
  })

  it('hibás fájlnál érthető hibát ad, és nem alkalmaz semmit', () => {
    expect(readSettingsImport('nem json')).toMatchObject({ ok: false })
    expect(readSettingsImport('{"foo": 1}')).toEqual({ ok: false, errors: ['Ez nem a Foglalástervező beállítási vagy export fájlja.'] })
    const newer = JSON.parse(exportOf(false))
    newer.exportVersion = 99
    expect(readSettingsImport(JSON.stringify(newer))).toMatchObject({ ok: false })
    const invalid = JSON.parse(exportOf(false))
    invalid.settings.weights.weatherFlight = 500
    const result = readSettingsImport(JSON.stringify(invalid))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.join('\n')).toMatch(/weights\.weatherFlight/)
  })
})
