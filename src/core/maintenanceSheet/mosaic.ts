import { componentBoxes, otsuThreshold, type GrayImage } from './image'
import { TEXT_HEIGHT } from './layout'
import type { Box } from './tokens'

/**
 * Mozaik az OCR-hez (ERF-04): a kiválasztott cellaszövegeket egymás alá, nagy közzel egyetlen
 * képre tesszük, így egy Tesseract-hívás minden cellát külön sorként olvas. Minden darabot a
 * saját környezetéből számolt Otsu-küszöbbel binarizálunk (a színes háttér így nem számít), és
 * csak a darab magjába belógó komponenseket tartjuk meg (a szomszédos rácsvonal kimarad).
 */

export interface Mosaic {
  readonly image: GrayImage
  /** Darabonként a mozaikbeli függőleges sáv [y0, y1). */
  readonly spans: ReadonlyArray<readonly [number, number]>
}

/**
 * Egy darab kivágása és binarizálása. `thresholdShift`: az Otsu-küszöb eltolása (negatív:
 * vékonyabb, pozitív: vastagabb vonalú betűk) – az ellentmondásos sorok újraolvasásához.
 */
export function cropBinary(img: GrayImage, box: Box, thresholdShift = 0): GrayImage {
  const T = TEXT_HEIGHT
  const mx = Math.round(T * 0.3)
  const my = Math.round(T * 0.2)
  const x0 = Math.max(0, box.x0 - mx)
  const y0 = Math.max(0, box.y0 - my)
  const x1 = Math.min(img.width - 1, box.x1 + mx)
  const y1 = Math.min(img.height - 1, box.y1 + my)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = img.data[(y0 + y) * img.width + x0 + x]!
  const t = otsuThreshold(gray) + thresholdShift
  const bin = new Uint8Array(w * h)
  for (let i = 0; i < bin.length; i++) bin[i] = gray[i]! <= t ? 1 : 0
  // Csak a darab magjával (a felismert befoglaló téglalappal) érintkező komponensek maradnak.
  const keep = new Uint8Array(w * h)
  const core = { x0: box.x0 - x0, y0: box.y0 - y0, x1: box.x1 - x0, y1: box.y1 - y0 }
  const comps = componentBoxes(bin, w, h)
  for (const c of comps) {
    const overlaps = c.x1 >= core.x0 && c.x0 <= core.x1 && c.y1 >= core.y0 && c.y0 <= core.y1
    const lineLike = (c.y1 - c.y0 + 1 <= T * 0.2 && c.x1 - c.x0 + 1 >= T * 1.5) || (c.x1 - c.x0 + 1 <= T * 0.2 && c.y1 - c.y0 + 1 >= T * 1.6)
    if (!overlaps || lineLike) continue
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (bin[y * w + x]) keep[y * w + x] = 1
  }
  const data = new Uint8Array(w * h)
  for (let i = 0; i < data.length; i++) data[i] = keep[i] ? 0 : 255
  return { width: w, height: h, data }
}

/**
 * A darab első szava: a legszélesebb (legalább `minGap` széles) üres oszlopsáv előtti rész.
 * „200 órás” → „200”. Ha a darabban nincs szóköz, `undefined`.
 */
export function leadingWord(img: GrayImage, box: Box, minGap = TEXT_HEIGHT * 0.2): Box | undefined {
  const w = box.x1 - box.x0 + 1
  const h = box.y1 - box.y0 + 1
  if (w <= 0 || h <= 0) return undefined
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = img.data[(box.y0 + y) * img.width + box.x0 + x]!
  const t = otsuThreshold(gray)
  const ink = Array.from({ length: w }, (_, x) => {
    let n = 0
    for (let y = 0; y < h; y++) if (gray[y * w + x]! <= t) n++
    return n
  })
  let best: { start: number; length: number } | undefined
  let runStart = -1
  for (let x = 0; x <= w; x++) {
    const empty = x < w && ink[x] === 0
    if (empty && runStart < 0) runStart = x
    if (!empty && runStart >= 0) {
      const length = x - runStart
      // Csak a darab belsejében lévő köz számít (a szélén lévő üres sáv nem szóköz).
      if (runStart > 0 && x < w && length >= minGap && (!best || length > best.length)) best = { start: runStart, length }
      runStart = -1
    }
  }
  return best ? { x0: box.x0, y0: box.y0, x1: box.x0 + best.start - 1, y1: box.y1 } : undefined
}

export function buildMosaic(img: GrayImage, boxes: readonly Box[], thresholdShift = 0): Mosaic {
  const T = TEXT_HEIGHT
  const crops = boxes.map((b) => cropBinary(img, b, thresholdShift))
  const gap = Math.round(T * 0.9)
  const margin = T
  const width = Math.max(T * 4, ...crops.map((c) => c.width)) + 2 * margin
  const height = crops.reduce((s, c) => s + c.height + gap, gap)
  const data = new Uint8Array(width * height).fill(255)
  const spans: Array<readonly [number, number]> = []
  let oy = gap
  for (const c of crops) {
    for (let y = 0; y < c.height; y++) data.set(c.data.subarray(y * c.width, (y + 1) * c.width), (oy + y) * width + margin)
    spans.push([oy, oy + c.height])
    oy += c.height + gap
  }
  return { image: { width, height, data }, spans }
}

/** Egy felismert szövegsor a mozaikon (a Tesseract kimenetéből). */
export interface OcrLine {
  readonly text: string
  readonly confidence: number
  readonly y0: number
  readonly y1: number
}

export interface OcrReading {
  readonly text: string
  /** 0–100; ha a darabhoz nem jött sor, 0. */
  readonly confidence: number
}

/** A felismert sorok visszarendelése a darabokhoz a függőleges helyzetük alapján. */
export function assignLines(mosaic: Mosaic, lines: readonly OcrLine[]): OcrReading[] {
  const out = mosaic.spans.map(() => ({ texts: [] as string[], conf: [] as number[] }))
  for (const l of lines) {
    const c = (l.y0 + l.y1) / 2
    let best = -1
    let bestDist = Infinity
    mosaic.spans.forEach(([a, b], i) => {
      const d = c < a ? a - c : c > b ? c - b : 0
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    if (best >= 0 && bestDist <= TEXT_HEIGHT * 0.45 && l.text.trim() !== '') {
      out[best]!.texts.push(l.text.trim())
      out[best]!.conf.push(l.confidence)
    }
  }
  return out.map((o) => ({
    text: o.texts.join(' '),
    confidence: o.conf.length === 0 ? 0 : Math.min(...o.conf),
  }))
}
