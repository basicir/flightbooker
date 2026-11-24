import * as jpeg from 'jpeg-js'
import { PNG } from 'pngjs'
import type { RgbaImage } from '../../core/maintenanceSheet/image'

/**
 * A beolvasott fotó dekódolása (ERF-04): JPEG és PNG, tisztán JavaScriptben (nincs natív
 * függőség, Windows-on és macOS-en ugyanúgy működik). A telefonos JPEG tájolását az EXIF
 * „Orientation” mezője alapján állítjuk helyre.
 */

export class ImageDecodeError extends Error {
  override readonly name = 'ImageDecodeError'
}

/** Legfeljebb ekkora fájlt fogadunk el (bájt). */
export const MAX_IMAGE_BYTES = 40 * 1024 * 1024

export type ImageKind = 'jpeg' | 'png' | 'heic' | 'webp' | 'unknown'

export function detectImageKind(bytes: Uint8Array): ImageKind {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  const ascii = (from: number, to: number): string => String.fromCharCode(...bytes.subarray(from, to))
  if (bytes.length >= 12 && ascii(4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(ascii(8, 12))) return 'heic'
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
  return 'unknown'
}

/**
 * Az EXIF tájolás (1–8) egy JPEG-ből; ha nincs, 1. Csak az APP1 „Exif” szegmens első
 * IFD-jét olvassuk.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = 2
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) return 1
    const marker = bytes[p + 1]!
    if (marker === 0xda || marker === 0xd9) return 1 // a képadat kezdete: nincs több fejléc
    const length = view.getUint16(p + 2)
    if (marker === 0xe1 && p + 10 <= bytes.length && String.fromCharCode(...bytes.subarray(p + 4, p + 10)) === 'Exif\0\0') {
      const tiff = p + 10
      if (tiff + 8 > bytes.length) return 1
      const little = bytes[tiff] === 0x49
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > bytes.length) return 1
      const count = view.getUint16(ifd, little)
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12
        if (entry + 12 > bytes.length) return 1
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    p += 2 + length
  }
  return 1
}

/** A kép elforgatása / tükrözése az EXIF tájolás szerint, hogy „álló” legyen. */
export function applyOrientation(img: RgbaImage, orientation: number): RgbaImage {
  if (orientation <= 1 || orientation > 8) return img
  const { width: w, height: h } = img
  const swap = orientation >= 5
  const ow = swap ? h : w
  const oh = swap ? w : h
  const src = new Uint32Array(img.data.buffer, img.data.byteOffset, w * h)
  const out = new Uint8Array(ow * oh * 4)
  const dst = new Uint32Array(out.buffer)
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let sx: number
      let sy: number
      switch (orientation) {
        case 2:
          sx = w - 1 - x
          sy = y
          break
        case 3:
          sx = w - 1 - x
          sy = h - 1 - y
          break
        case 4:
          sx = x
          sy = h - 1 - y
          break
        case 5:
          sx = y
          sy = x
          break
        case 6:
          sx = y
          sy = h - 1 - x
          break
        case 7:
          sx = w - 1 - y
          sy = h - 1 - x
          break
        default:
          sx = w - 1 - y
          sy = x
      }
      dst[y * ow + x] = src[sy * w + sx]!
    }
  }
  return { width: ow, height: oh, data: out }
}

/** Fájltartalomból RGBA kép; érthető magyar hibaüzenettel, ha nem olvasható. */
export function decodeImage(bytes: Uint8Array): RgbaImage {
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageDecodeError('A kép túl nagy (legfeljebb 40 MB lehet).')
  const kind = detectImageKind(bytes)
  try {
    if (kind === 'jpeg') {
      const raw = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 80, maxMemoryUsageInMB: 1024 })
      // A dekódolt puffer igazítása a 32 bites nézethez.
      const data = raw.data.byteOffset % 4 === 0 ? raw.data : Uint8Array.from(raw.data)
      return applyOrientation({ width: raw.width, height: raw.height, data }, readJpegOrientation(bytes))
    }
    if (kind === 'png') {
      const png = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return { width: png.width, height: png.height, data: Uint8Array.from(png.data) }
    }
  } catch (error) {
    throw new ImageDecodeError(`A kép nem olvasható (${(error as Error).message}).`)
  }
  if (kind === 'heic') {
    throw new ImageDecodeError('HEIC formátumú képet nem tudok beolvasni. Mentsd el JPEG-ként (iPhone-on: Beállítások › Kamera › Formátumok › Legkompatibilisebb), vagy készíts képernyőképet.')
  }
  throw new ImageDecodeError('Csak JPEG vagy PNG kép olvasható be.')
}
