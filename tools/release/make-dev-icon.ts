/**
 * A fejlesztői (DEV) változat ikonja a fő ikonból (FRS-05): a kék háttér narancsra vált, alul
 * „DEV” felirat. Egyszer kell futtatni, ha a fő ikon változik:
 *
 *   npx tsx tools/release/make-dev-icon.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { PNG } from 'pngjs'

const SOURCE = 'build/icon.png'
const TARGET = 'build/icon-dev.png'

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max / 255]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
}

const png = PNG.sync.read(readFileSync(SOURCE))
const { width, height, data } = png
const scale = width / 1024

// Kék árnyalatok → narancs (a fehér, a szürke és a piros marad).
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] === 0) continue
  const [h, s, v] = rgbToHsv(data[i]!, data[i + 1]!, data[i + 2]!)
  if (h >= 190 && h <= 250 && s > 0.25) {
    const [r, g, b] = hsvToRgb(22, Math.min(1, s * 1.05), v * 0.95)
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
  }
}

// „DEV” felirat a naptár alatt, fehérrel.
const cell = Math.round(11 * scale)
const gap = Math.round(16 * scale)
const text = 'DEV'
const textWidth = text.length * 5 * cell + (text.length - 1) * gap
let x0 = Math.round((width - textWidth) / 2)
const y0 = Math.round(822 * scale)
for (const ch of text) {
  const glyph = GLYPHS[ch]!
  glyph.forEach((row, gy) => {
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== '1') continue
      for (let dy = 0; dy < cell; dy++) {
        for (let dx = 0; dx < cell; dx++) {
          const px = x0 + gx * cell + dx
          const py = y0 + gy * cell + dy
          if (px < 0 || py < 0 || px >= width || py >= height) continue
          const i = (py * width + px) * 4
          data[i] = 255
          data[i + 1] = 255
          data[i + 2] = 255
          data[i + 3] = 255
        }
      }
    }
  })
  x0 += 5 * cell + gap
}

writeFileSync(TARGET, PNG.sync.write(png))
process.stdout.write(`${TARGET} kész.\n`)
