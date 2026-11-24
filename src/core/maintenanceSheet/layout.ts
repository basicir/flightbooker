import { blur, componentBoxes, darkMask, downscale, grayFromRgba, removeLines, rotateQuarter, sample, type GrayImage, type RgbaImage } from './image'
import { findTokens, groupRows, type TokenRow } from './tokens'

/**
 * A fotó előkészítése (ERF-04): ferdeség- és betűméret-becslés, egy lépésben forgatás és
 * átméretezés úgy, hogy a számjegyek kb. `TEXT_HEIGHT` képpont magasak legyenek, majd a
 * cellaszövegek és sorok megkeresése.
 */

/** A munkakép számjegymagassága képpontban; a Tesseract ekkora betűkkel a legpontosabb. */
export const TEXT_HEIGHT = 32

/**
 * A ferdeség becslése vetületi élességgel: azt a szöget keressük, amelynél a sötét
 * képpontok (rácsvonalak és szövegsorok) a legélesebb vízszintes sávokba esnek.
 * Az eredmény a sorok meredekségének szöge radiánban (pozitív: jobbra lefelé).
 */
export function estimateSkew(img: GrayImage): number {
  const factor = Math.min(1, 900 / Math.max(img.width, img.height))
  const small = downscale(img, factor)
  const mask = darkMask(small, Math.max(8, Math.round(Math.max(small.width, small.height) / 60)), 0.75)
  const xs: number[] = []
  const ys: number[] = []
  for (let y = 0; y < small.height; y++) {
    for (let x = 0; x < small.width; x++) {
      if (mask[y * small.width + x]) {
        xs.push(x)
        ys.push(y)
      }
    }
  }
  if (xs.length === 0) return 0
  const step = Math.max(1, Math.floor(xs.length / 120_000))
  const diag = Math.ceil(Math.hypot(small.width, small.height))
  const hist = new Float64Array(diag * 2 + 2)
  const score = (theta: number): number => {
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    hist.fill(0)
    for (let i = 0; i < xs.length; i += step) hist[Math.round(ys[i]! * cos - xs[i]! * sin) + diag]!++
    let s = 0
    for (const v of hist) s += v * v
    return s
  }
  const deg = Math.PI / 180
  let best = 0
  let bestScore = -1
  for (let t = -20; t <= 20; t += 0.5) {
    const s = score(t * deg)
    if (s > bestScore) {
      bestScore = s
      best = t
    }
  }
  let fine = best
  for (let t = best - 0.5; t <= best + 0.5; t += 0.05) {
    const s = score(t * deg)
    if (s > bestScore) {
      bestScore = s
      fine = t
    }
  }
  return fine * deg
}

/**
 * A számjegyek és nagybetűk tipikus magassága képpontban (a betűméretű sötét komponensek
 * magasságának mediánja).
 */
export function estimateTextHeight(img: GrayImage): number {
  const factor = Math.min(1, 1600 / Math.max(img.width, img.height))
  const small = downscale(img, factor)
  const mask = darkMask(small, Math.max(8, Math.round(Math.max(small.width, small.height) / 60)), 0.75)
  const heights = componentBoxes(mask, small.width, small.height)
    .map((b) => ({ w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, n: b.n }))
    .filter((b) => b.h >= 6 && b.h <= small.height / 10 && b.w <= b.h * 1.3 && b.w >= b.h * 0.25 && b.n >= b.w * b.h * 0.15)
    .map((b) => b.h)
    .sort((p, q) => p - q)
  if (heights.length < 10) return 20 / factor
  return heights[Math.floor(heights.length / 2)]! / factor
}

/**
 * Forgatás és nagyítás egy lépésben (bilineáris). A vászon akkora, hogy a teljes elforgatott
 * kép ráférjen. Kicsinyítésnél előbb területátlagolunk, hogy ne legyen élsimítási hiba.
 */
export function rotateScale(img: GrayImage, angle: number, scale: number): GrayImage {
  let src = img
  let s = scale
  if (scale < 1) {
    src = downscale(img, scale)
    s = 1
  }
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const w = Math.ceil((Math.abs(cos) * src.width + Math.abs(sin) * src.height) * s)
  const h = Math.ceil((Math.abs(sin) * src.width + Math.abs(cos) * src.height) * s)
  const data = new Uint8Array(w * h)
  const scx = (src.width - 1) / 2
  const scy = (src.height - 1) / 2
  const dcx = (w - 1) / 2
  const dcy = (h - 1) / 2
  for (let y = 0; y < h; y++) {
    const dy = (y - dcy) / s
    for (let x = 0; x < w; x++) {
      const dx = (x - dcx) / s
      // A cél képpontból vissza a forrásba: a sorok meredekségét (angle) visszaforgatjuk.
      data[y * w + x] = Math.round(sample(src, cos * dx - sin * dy + scx, sin * dx + cos * dy + scy))
    }
  }
  return { width: w, height: h, data }
}

export interface SheetLayout {
  /** Kiegyenesített, átméretezett szürke munkakép (a cellák innen kerülnek az OCR-be). */
  readonly image: GrayImage
  readonly rows: readonly TokenRow[]
  /** Becsült elforgatás fokban (diagnosztika). */
  readonly skewDegrees: number
}

/**
 * A teljes előkészítés: RGBA fotóból kiegyenesített munkakép, cellaszövegek és sorok.
 * `quarterTurns`: előzetes elforgatás 90°-os lépésekben (oldalra fordított fotóhoz).
 */
export function analyzeLayout(rgba: RgbaImage, quarterTurns = 0): SheetLayout {
  const gray = rotateQuarter(grayFromRgba(rgba), quarterTurns)
  const skew = estimateSkew(gray)
  const scale = Math.max(0.25, Math.min(4, TEXT_HEIGHT / estimateTextHeight(gray)))
  const image = rotateScale(gray, skew, scale)
  const mask = darkMask(blur(image, 1), Math.round(TEXT_HEIGHT * 1.5), 0.75)
  removeLines(mask, image.width, image.height, Math.round(TEXT_HEIGHT * 2.5), Math.round(TEXT_HEIGHT * 2.5), Math.round(TEXT_HEIGHT * 0.35))
  const tokens = findTokens(mask, image.width, image.height, TEXT_HEIGHT)
  return { image, rows: groupRows(tokens, TEXT_HEIGHT), skewDegrees: (skew * 180) / Math.PI }
}
