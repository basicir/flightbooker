import * as jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import { describe, expect, it } from 'vitest'
import { applyOrientation, decodeImage, detectImageKind, readJpegOrientation } from '../../../src/main/maintenanceSheet/decode'

/** 3×2-es kép, képpontonként más vörös értékkel (a = 10, b = 20 … f = 60). */
function tiny(): { width: number; height: number; data: Uint8Array } {
  const data = new Uint8Array(3 * 2 * 4)
  for (let i = 0; i < 6; i++) data.set([(i + 1) * 10, 0, 0, 255], i * 4)
  return { width: 3, height: 2, data }
}
const reds = (img: { data: Uint8Array }): number[] => Array.from({ length: img.data.length / 4 }, (_, i) => img.data[i * 4]!)

/** Egy APP1 „Exif” szegmens beszúrása a JPEG elejére a megadott tájolással. */
function withOrientation(bytes: Uint8Array, orientation: number, bigEndian = false): Uint8Array {
  const u16 = (v: number): number[] => (bigEndian ? [v >> 8, v & 0xff] : [v & 0xff, v >> 8])
  const u32 = (v: number): number[] => (bigEndian ? [0, 0, v >> 8, v & 0xff] : [v & 0xff, v >> 8, 0, 0])
  const tiff = [...(bigEndian ? [0x4d, 0x4d] : [0x49, 0x49]), ...u16(42), ...u32(8), ...u16(1), ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0, ...u32(0)]
  const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const length = payload.length + 2
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, length >> 8, length & 0xff, ...payload, ...bytes.subarray(2)])
}

describe('a beolvasott kép dekódolása (ERF-04)', () => {
  it('felismeri a formátumot a fájl elejéről', () => {
    expect(detectImageKind(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg')
    expect(detectImageKind(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png')
    expect(detectImageKind(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0'))).toBe('heic')
    expect(detectImageKind(new TextEncoder().encode('GIF89a'))).toBe('unknown')
  })

  it('a telefonos JPEG tájolását az EXIF-ből olvassa (kis- és nagy-endián)', () => {
    const plain = new Uint8Array(jpeg.encode({ ...tiny(), data: Buffer.from(tiny().data) }, 90).data)
    expect(readJpegOrientation(plain)).toBe(1)
    expect(readJpegOrientation(withOrientation(plain, 6))).toBe(6)
    expect(readJpegOrientation(withOrientation(plain, 8, true))).toBe(8)
    const decoded = decodeImage(withOrientation(plain, 6))
    expect([decoded.width, decoded.height]).toEqual([2, 3])
  })

  it('elforgatja és tükrözi a képet a tájolás szerint', () => {
    expect(reds(applyOrientation(tiny(), 1))).toEqual([10, 20, 30, 40, 50, 60])
    // 6: 90° az óramutató járásával
    const r6 = applyOrientation(tiny(), 6)
    expect([r6.width, r6.height]).toEqual([2, 3])
    expect(reds(r6)).toEqual([40, 10, 50, 20, 60, 30])
    expect(reds(applyOrientation(tiny(), 3))).toEqual([60, 50, 40, 30, 20, 10])
    expect(reds(applyOrientation(tiny(), 8))).toEqual([30, 60, 20, 50, 10, 40])
    expect(reds(applyOrientation(tiny(), 2))).toEqual([30, 20, 10, 60, 50, 40])
  })

  it('PNG-t is olvas', () => {
    const png = new PNG({ width: 3, height: 2 })
    png.data = Buffer.from(tiny().data)
    const decoded = decodeImage(new Uint8Array(PNG.sync.write(png)))
    expect(reds(decoded)).toEqual([10, 20, 30, 40, 50, 60])
  })

  it('érthető hibát ad a nem támogatott vagy sérült fájlra', () => {
    expect(() => decodeImage(new TextEncoder().encode('\0\0\0\x18ftypheic\0\0\0\0'))).toThrow(/HEIC/)
    expect(() => decodeImage(new TextEncoder().encode('GIF89a......'))).toThrow(/JPEG vagy PNG/)
    expect(() => decodeImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2]))).toThrow(/nem olvasható/)
  })
})
