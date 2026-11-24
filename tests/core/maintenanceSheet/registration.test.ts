import { describe, expect, it } from 'vitest'
import {
  looksLikeRegistration,
  matchRegistration,
  normalizeRegistration,
  registrationAlphabet,
  registrationDistance,
} from '../../../src/core/maintenanceSheet/registration'

// Szintetikus flotta; a lajstromjelek kitaláltak.
const FLEET = ['HA-XAB', 'HA-XAC', 'HA-XBI', 'HA-XBJ', 'HA-XJA', 'HA-XIY', 'HA-XPC'].map((callSign) => ({ id: `id-${callSign}`, callSign }))

describe('lajstromjel illesztése a flottához (ERF-04)', () => {
  it('normalizál: kötőjel, kis- és nagybetű, ékezet és a jellegzetes OCR-jelek', () => {
    expect(normalizeRegistration('ha-xab')).toBe('HAXAB')
    expect(normalizeRegistration('HA: XB)')).toBe('HAXBJ')
    expect(normalizeRegistration('HA-XB|')).toBe('HAXBI')
  })

  it('a hasonló alakú jelek cseréje olcsóbb', () => {
    expect(registrationDistance('HA-X8C', 'HA-XBC')).toBeCloseTo(0.4)
    expect(registrationDistance('HA-XQC', 'HA-XPC')).toBe(1)
  })

  it('pontos és OCR-hibás olvasatot is a jó géphez rendel', () => {
    expect(matchRegistration('HA-XAB', FLEET)?.aircraft.callSign).toBe('HA-XAB')
    expect(matchRegistration('HA-XIA', FLEET)?.aircraft.callSign).toBe('HA-XJA')
    expect(matchRegistration('HA-XAAB', FLEET)?.aircraft.callSign).toBe('HA-XAB')
  })

  it('egy tetszőleges betű cseréjével nem rendel másik géphez (flottán kívüli gép)', () => {
    expect(matchRegistration('HA-XQC', FLEET)).toBeUndefined()
    expect(matchRegistration('HA-XAZ', FLEET)).toBeUndefined()
  })

  it('kétértelmű olvasatnál nem dönt', () => {
    // „HA-XB” után hiányzik egy jel: HA-XBI és HA-XBJ is lehet.
    expect(matchRegistration('HA-XB', FLEET)).toBeUndefined()
  })

  it('a táblázat kisbetűs szavai nem lajstromok', () => {
    expect(looksLikeRegistration('HA-XAB')).toBe(true)
    expect(looksLikeRegistration('HA-XBt')).toBe(true)
    expect(looksLikeRegistration('Kedd')).toBe(false)
    expect(looksLikeRegistration('Cessna')).toBe(false)
    expect(looksLikeRegistration('PA-28')).toBe(false)
  })

  it('az OCR karakterkészlete a flotta jeleiből áll', () => {
    expect(registrationAlphabet(FLEET)).toBe('-ABCHIJPXY')
    expect(registrationAlphabet([])).toContain('Z')
  })
})
