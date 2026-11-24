import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readSheetImage } from '../../../src/main/maintenanceSheet/readSheet'

/**
 * Regressziós teszt valódi fotókon (ERF-04). A fotók és az elvárt értékek a gitignore-olt
 * tests/local/karbantartas/ mappában vannak (valódi üzemi adat, nem kerülhet a repóba);
 * ha a mappa hiányzik, a teszt kimarad.
 *
 * expected.json: { "<fájlnév kiterjesztés nélkül>": { "date": "ÉÉÉÉ-HH-NN",
 *   "rows": [["HA-ABC", aktuális | null, következő | null, hátralévő], …] } }
 */

const DIR = resolve('tests/local/karbantartas')
const PATHS = { langPath: resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int') }
type Expected = Record<string, { date: string; rows: Array<[string, number | null, number | null, number]> }>

const available = existsSync(resolve(DIR, 'expected.json'))
const expected: Expected = available ? JSON.parse(readFileSync(resolve(DIR, 'expected.json'), 'utf8')) : {}
const photos = available ? readdirSync(DIR).filter((f) => /\.(jpe?g|png)$/i.test(f) && expected[basename(f, extname(f))]) : []
const fleet = [...new Set(Object.values(expected).flatMap((e) => e.rows.map((r) => r[0])))].map((callSign) => ({ id: callSign, callSign }))

describe.skipIf(!available)('valódi fotók (helyi, gitignore-olt)', () => {
  it.each(photos)('%s', async (file) => {
    const exp = expected[basename(file, extname(file))]!
    const reading = await readSheetImage(new Uint8Array(readFileSync(resolve(DIR, file))), fleet, PATHS)
    expect(reading.date).toBe(exp.date)
    for (const [reg, current, , remaining] of exp.rows) {
      const row = reading.rows.find((r) => r.aircraftId === reg)
      expect(row, reg).toBeDefined()
      expect(row!.hours, reg).toBe(current === null ? null : remaining)
    }
    // A karbantartás fajtája (SZB-06): ha olvasható, csak érvényes érték lehet; a lefedettséget kiírjuk.
    const typed = reading.rows.filter((r) => r.maintenanceType !== null).length
    console.info(`${file}: karbantartás-fajta ${typed}/${reading.rows.length} sorban`)
    // „Egyezik” állapotú sor értéke soha nem lehet rossz.
    for (const row of reading.rows.filter((r) => r.status === 'ok')) {
      expect(row.hours, row.registration).toBe(exp.rows.find((r) => r[0] === row.aircraftId)?.[3])
    }
  }, 90_000)
})
