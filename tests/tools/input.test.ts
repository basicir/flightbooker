import { describe, expect, it } from 'vitest'
import { parseCliOptions, parseCoordinates, parseLocalDateTime } from '../../tools/discovery/input'
import { distribution, redactSensitive } from '../../tools/discovery/stats'

describe('a felderítő eszköz bemenetei', () => {
  it.each([
    ['47.4298, 19.2611'],
    ['47,4298 19,2611'],
    ['47.4298;19.2611'],
    ['47.4298,19.2611'],
    ['  47.4298   19.2611 '],
  ])('koordináta: %s', (text) => {
    expect(parseCoordinates(text)).toEqual({ latitude: 47.4298, longitude: 19.2611 })
  })

  it('üres koordináta: kihagyás; hibás: hiba', () => {
    expect(parseCoordinates('')).toBeUndefined()
    expect(() => parseCoordinates('91, 10')).toThrow()
    expect(() => parseCoordinates('LHBP')).toThrow()
  })

  it('helyi időpont', () => {
    const date = parseLocalDateTime('2026-11-12 09:05')!
    expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes()]).toEqual([2026, 10, 12, 9, 5])
    expect(parseLocalDateTime('')).toBeUndefined()
    expect(() => parseLocalDateTime('2026-02-30 09:00')).toThrow()
    expect(() => parseLocalDateTime('holnap')).toThrow()
  })

  it('parancssori kapcsolók', () => {
    expect(parseCliOptions([])).toEqual({ pastDays: 14, futureDays: 21 })
    expect(parseCliOptions(['--vissza=7', '--elore=30'])).toEqual({ pastDays: 7, futureDays: 30 })
    expect(() => parseCliOptions(['--kulcs=x'])).toThrow()
  })
})

describe('összesítő segédfüggvények', () => {
  it('eloszlás', () => {
    expect(distribution([3, 1, 2])).toEqual({ n: 3, min: 1, median: 2, max: 3 })
    expect(distribution([]).n).toBe(0)
  })

  it('kitakarás: e-mail és ismert szöveg, a rövid töredékeket nem', () => {
    const { text, redactions } = redactSensitive('Anna (a@b.hu) és Bé', ['Anna', 'Bé'])
    expect(text).toBe('[kitakarva] ([e-mail kitakarva]) és Bé')
    expect(redactions).toBe(2)
  })

  it('kitakarás csak egész szóra: a típusneveket nem vágja szét', () => {
    const { text } = redactSensitive('TypeQuestionnaireBooking: 14, Type Ádám, Típus', ['Type', 'Ádám'])
    expect(text).toBe('TypeQuestionnaireBooking: 14, [kitakarva] [kitakarva], Típus')
  })
})
