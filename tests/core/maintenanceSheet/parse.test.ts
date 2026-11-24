import { describe, expect, it } from 'vitest'
import { parseInteger, parseSheetDate, parseWeekday } from '../../../src/core/maintenanceSheet/read'

describe('számok és dátum a táblázatból (ERF-04)', () => {
  it('egész szám, a tipikus betű–szám tévesztésekkel és negatív előjellel', () => {
    expect(parseInteger('18829')).toBe(18829)
    expect(parseInteger('-7')).toBe(-7)
    expect(parseInteger('—2')).toBe(-2)
    expect(parseInteger('1O6l1')).toBe(10611)
    expect(parseInteger(' 4 2 ')).toBe(42)
    expect(parseInteger('200 órás')).toBeNull()
    expect(parseInteger('')).toBeNull()
    expect(parseInteger('-')).toBeNull()
  })

  it('dátum a fejlécből, több darabban is', () => {
    expect(parseSheetDate('2026.10.29.')).toBe('2026-10-29')
    expect(parseSheetDate('Csütörtök 2026 10.29')).toBe('2026-10-29')
    expect(parseSheetDate('2026.11.2.')).toBe('2026-11-02')
    expect(parseSheetDate('2026.02.30.')).toBeNull()
    expect(parseSheetDate('Repülőgép üzemidő')).toBeNull()
  })

  it('napnév az OCR jellegzetes hibáival (0 = vasárnap)', () => {
    expect(parseWeekday('Hétfő')).toBe(1)
    expect(parseWeekday('Hetfo')).toBe(1)
    expect(parseWeekday('Csiitortok')).toBe(4)
    expect(parseWeekday('Repiilogép lizemido 6sszesités Pentek 2026.10.30')).toBe(5)
    expect(parseWeekday('Lajstrom')).toBeNull()
  })
})
