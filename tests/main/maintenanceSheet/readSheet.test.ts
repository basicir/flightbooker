import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readMaintenanceSheet, type SheetReading } from '../../../src/core/maintenanceSheet/read'
import { normalizeRegistration } from '../../../src/core/maintenanceSheet/registration'
import { applyOrientation, decodeImage } from '../../../src/main/maintenanceSheet/decode'
import { assertLocalPath, withOcrEngine } from '../../../src/main/maintenanceSheet/ocrEngine'
import { readSheetImage } from '../../../src/main/maintenanceSheet/readSheet'

/**
 * A teljes beolvasás valódi (helyi) OCR-rel a szintetikus táblázatképen (ERF-04).
 * A kép és az elvárt értékek: tests/fixtures/maintenanceSheet (generate.py készíti).
 */

const FIXTURE = resolve('tests/fixtures/maintenanceSheet')
const PATHS = { langPath: resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int') }
const image = new Uint8Array(readFileSync(resolve(FIXTURE, 'synthetic-sheet.jpg')))
const expected = JSON.parse(readFileSync(resolve(FIXTURE, 'synthetic-sheet.json'), 'utf8')) as {
  date: string
  rows: Array<{ registration: string; current: number | null; next: number | null; remaining: number; maintenanceType: number | null }>
}
const expectedByReg = new Map(expected.rows.map((r) => [normalizeRegistration(r.registration), r]))
/** A bemutató mód gépei: ezek szerepelnek a flottában, a HA-DQ… jelek nem. */
const DEMO_FLEET = ['HA-DPA', 'HA-DPB', 'HA-DPC', 'HA-DCA', 'HA-DCB'].map((callSign) => ({ id: `id-${callSign}`, callSign }))
const FULL_FLEET = expected.rows.map((r) => ({ id: `id-${r.registration}`, callSign: r.registration }))

/** Biztonsági tulajdonság: „egyezik” állapotú sor értéke mindig helyes. */
function expectNoWrongOk(reading: SheetReading): void {
  for (const row of reading.rows.filter((r) => r.status === 'ok')) {
    const exp = expectedByReg.get(normalizeRegistration(row.callSign ?? row.registration))
    expect(exp, row.registration).toBeDefined()
    expect(row.hours, row.registration).toBe(exp!.remaining)
  }
}

describe('karbantartási táblázat fotójának beolvasása (ERF-04)', () => {
  it('a flotta gépeinek kirepülhető idejét és a dátumot helyesen olvassa', async () => {
    const reading = await readSheetImage(image, DEMO_FLEET, PATHS)
    expect(reading.date).toBe(expected.date)
    for (const aircraft of DEMO_FLEET) {
      const row = reading.rows.find((r) => r.aircraftId === aircraft.id)
      expect(row, aircraft.callSign).toBeDefined()
      expect(row!.hours, aircraft.callSign).toBe(expectedByReg.get(normalizeRegistration(aircraft.callSign))!.remaining)
      expect(row!.status, aircraft.callSign).toBe('ok')
      // A karbantartás fajtája (SZB-06) a hátralévő idő mellett.
      expect(row!.maintenanceType, aircraft.callSign).toBe(expectedByReg.get(normalizeRegistration(aircraft.callSign))!.maintenanceType)
    }
    expect(reading.missingAircraftIds).toEqual([])
    expectNoWrongOk(reading)
  }, 60_000)

  it('a flottán kívüli lajstromot nem rendeli egy hasonló géphez, hanem jelzi', async () => {
    const reading = await readSheetImage(image, DEMO_FLEET, PATHS)
    // HA-DQC egy betűben tér el a HA-DPC-től: nem kerülhet hozzá.
    expect(reading.rows.filter((r) => r.aircraftId === 'id-HA-DPC')).toHaveLength(1)
    expect(reading.warnings.join(' ')).toMatch(/Ismeretlen lajstrom.*HA-DQC/)
    expect(reading.rows.filter((r) => r.aircraftId === null).every((r) => r.registration.startsWith('HA-DQ'))).toBe(true)
  }, 60_000)

  it('üres óraszámú sornál nem javasol értéket, negatív hátralévő időt is olvas', async () => {
    const reading = await readSheetImage(image, FULL_FLEET, PATHS)
    expect(reading.rows.find((r) => r.callSign === 'HA-DQB')?.status).toBe('empty')
    expect(reading.rows.find((r) => r.callSign === 'HA-DQB')?.hours).toBeNull()
    expect(reading.rows.find((r) => r.callSign === 'HA-DQA')?.hours).toBe(-3)
    expect(reading.rows.length).toBe(expected.rows.length)
    expectNoWrongOk(reading)
  }, 60_000)

  it('az oldalra fordított, EXIF nélküli fotót is beolvassa', async () => {
    const sideways = applyOrientation(decodeImage(image), 6)
    const reading = await withOcrEngine(PATHS, (engine) => readMaintenanceSheet(sideways, DEMO_FLEET, engine))
    expect(reading.rows.filter((r) => r.aircraftId !== null)).toHaveLength(DEMO_FLEET.length)
    expectNoWrongOk(reading)
  }, 90_000)

  it('nem táblázatfotón nem talál semmit, és ezt üzenetben jelzi', async () => {
    const blank = { width: 400, height: 300, data: new Uint8Array(400 * 300 * 4).fill(255) }
    const reading = await withOcrEngine(PATHS, (engine) => readMaintenanceSheet(blank, DEMO_FLEET, engine))
    expect(reading.rows).toEqual([])
    expect(reading.warnings[0]).toMatch(/Nem találtam/)
  }, 60_000)

  it('a nyelvi modell csak helyi fájlból tölthető (ALP-02)', () => {
    expect(() => assertLocalPath('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng')).toThrow(/ALP-02/)
    expect(() => assertLocalPath('relativ/ut')).toThrow(/ALP-02/)
    expect(() => assertLocalPath(PATHS.langPath)).not.toThrow()
  })
})
