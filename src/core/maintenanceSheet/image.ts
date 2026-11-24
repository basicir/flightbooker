/**
 * Szürkeárnyalatos képműveletek a karbantartási táblázat fotójához (ERF-04).
 * Tiszta TypeScript: nincs benne fájl, hálózat vagy Electron, ezért tesztelhető és a
 * főfolyamatban és a parancssori eszközben is ugyanúgy fut.
 */

export interface GrayImage {
  readonly width: number
  readonly height: number
  /** Soronként, 0 = fekete, 255 = fehér. */
  readonly data: Uint8Array
}

export interface RgbaImage {
  readonly width: number
  readonly height: number
  /** RGBA, soronként, 4 bájt / képpont. */
  readonly data: Uint8Array
}

/**
 * A színes cellahátterek (piros, narancs, sárga, zöld) mind tartalmaznak legalább egy erős
 * színcsatornát, a fekete szöveg és a rácsvonal egyiket sem. Ezért a csatornák maximuma
 * (HSV „value”) a háttérszíntől függetlenül világos hátteret és sötét szöveget ad.
 */
export function grayFromRgba(img: RgbaImage): GrayImage {
  const out = new Uint8Array(img.width * img.height)
  const src = img.data
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = src[p]!
    const g = src[p + 1]!
    const b = src[p + 2]!
    out[i] = r > g ? (r > b ? r : b) : g > b ? g : b
  }
  return { width: img.width, height: img.height, data: out }
}

/** Kicsinyítés területátlagolással (moaré és zaj ellen is jó). */
export function downscale(img: GrayImage, factor: number): GrayImage {
  if (factor >= 1) return img
  const w = Math.max(1, Math.round(img.width * factor))
  const h = Math.max(1, Math.round(img.height * factor))
  const out = new Uint8Array(w * h)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy)
    const y1 = Math.max(y0 + 1, Math.min(img.height, Math.floor((y + 1) * sy)))
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.min(img.width, Math.floor((x + 1) * sx)))
      let sum = 0
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * img.width
        for (let xx = x0; xx < x1; xx++) sum += img.data[row + xx]!
      }
      out[y * w + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)))
    }
  }
  return { width: w, height: h, data: out }
}

/** Elforgatás 90°-os lépésekben (óramutató járásával egyezően, `turns` × 90°). */
export function rotateQuarter(img: GrayImage, turns: number): GrayImage {
  const k = ((turns % 4) + 4) % 4
  if (k === 0) return img
  const { width: w, height: h, data } = img
  const ow = k === 2 ? w : h
  const oh = k === 2 ? h : w
  const out = new Uint8Array(w * h)
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const [sx, sy] = k === 1 ? [y, h - 1 - x] : k === 2 ? [w - 1 - x, h - 1 - y] : [w - 1 - y, x]
      out[y * ow + x] = data[sy * w + sx]!
    }
  }
  return { width: ow, height: oh, data: out }
}

/** Bilineáris mintavétel; a képen kívül fehér. */
export function sample(img: GrayImage, x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  const get = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= img.width || yy >= img.height ? 255 : img.data[yy * img.width + xx]!)
  const top = get(x0, y0) * (1 - fx) + get(x0 + 1, y0) * fx
  const bottom = get(x0, y0 + 1) * (1 - fx) + get(x0 + 1, y0 + 1) * fx
  return top * (1 - fy) + bottom * fy
}

/** Összegzett terület (integrálkép) a gyors helyi átlaghoz. */
export function integral(img: GrayImage): Float64Array {
  const { width: w, height: h, data } = img
  const out = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let rowSum = 0
    for (let x = 0; x < w; x++) {
      rowSum += data[y * w + x]!
      out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1]! + rowSum
    }
  }
  return out
}

/**
 * Sötét képpontok maszkja helyi küszöbbel: egy képpont sötét, ha jóval sötétebb a
 * környezete átlagánál. A fotó egyenetlen megvilágítását így nem kell külön kezelni.
 */
export function darkMask(img: GrayImage, radius: number, ratio: number): Uint8Array {
  const { width: w, height: h, data } = img
  const ii = integral(img)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(h, y + radius + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(w, x + radius + 1)
      const sum = ii[y1 * (w + 1) + x1]! - ii[y0 * (w + 1) + x1]! - ii[y1 * (w + 1) + x0]! + ii[y0 * (w + 1) + x0]!
      const mean = sum / ((y1 - y0) * (x1 - x0))
      out[y * w + x] = data[y * w + x]! < mean * ratio ? 1 : 0
    }
  }
  return out
}

export interface ComponentBox {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
  /** Képpontok száma. */
  readonly n: number
}

/** Összefüggő sötét komponensek (8-szomszédság) befoglaló téglalapjai. */
export function componentBoxes(mask: Uint8Array, w: number, h: number): ComponentBox[] {
  return labelComponents(mask, w, h).boxes
}

/** Komponenscímkézés: képpontonként a komponens sorszáma (háttér: -1) és a téglalapok. */
export function labelComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; boxes: ComponentBox[] } {
  const labels = new Int32Array(w * h).fill(-1)
  const out: ComponentBox[] = []
  const stack: number[] = []
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]! >= 0) continue
    const id = out.length
    let x0 = w
    let y0 = h
    let x1 = 0
    let y1 = 0
    let n = 0
    labels[i] = id
    stack.push(i)
    while (stack.length > 0) {
      const p = stack.pop()!
      const x = p % w
      const y = (p - x) / w
      n++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (mask[q] && labels[q]! < 0) {
            labels[q] = id
            stack.push(q)
          }
        }
      }
    }
    out.push({ x0, y0, x1, y1, n })
  }
  return { labels, boxes: out }
}
/**
 * Hosszú vízszintes és függőleges futamok (rácsvonalak) törlése a bináris maszkból.
 * `cross` > 0 esetén a vonalon áthaladó betűszárat megtartjuk: egy vízszintes vonal
 * képpontja marad, ha a vonalsávon túl fölötte és alatta is tinta folytatódik (legfeljebb
 * `cross` távolságon belül; függőlegesnél balra és jobbra), így a vonallal keresztezett
 * számjegyek nem esnek szét.
 */
export function removeLines(mask: Uint8Array, w: number, h: number, minLenH: number, minLenV: number, cross = 0): void {
  const KILL_H = 1
  const KILL_V = 2
  const kill = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    let start = -1
    for (let x = 0; x <= w; x++) {
      const on = x < w && mask[y * w + x]
      if (on && start < 0) start = x
      if (!on && start >= 0) {
        if (x - start >= minLenH) for (let k = start; k < x; k++) kill[y * w + k]! |= KILL_H
        start = -1
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let start = -1
    for (let y = 0; y <= h; y++) {
      const on = y < h && mask[y * w + x]
      if (on && start < 0) start = y
      if (!on && start >= 0) {
        if (y - start >= minLenV) for (let k = start; k < y; k++) kill[k * w + x]! |= KILL_V
        start = -1
      }
    }
  }
  // A törlendő sávon túl (legfeljebb `cross` lépésre) az első nem törlendő képpont tinta-e.
  const inkBeyond = (x: number, y: number, dx: number, dy: number): boolean => {
    for (let s = 1; s <= cross; s++) {
      const xx = x + dx * s
      const yy = y + dy * s
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) return false
      const i = yy * w + xx
      if (kill[i] === 0) return mask[i] === 1
    }
    return false
  }
  const remove: number[] = []
  for (let i = 0; i < kill.length; i++) {
    const k = kill[i]!
    if (k === 0) continue
    if (cross > 0) {
      const x = i % w
      const y = (i - x) / w
      if (k === KILL_H && inkBeyond(x, y, 0, -1) && inkBeyond(x, y, 0, 1)) continue
      if (k === KILL_V && inkBeyond(x, y, -1, 0) && inkBeyond(x, y, 1, 0)) continue
    }
    remove.push(i)
  }
  for (const i of remove) mask[i] = 0
}



/** Otsu-küszöb egy hisztogramra. */
export function otsuThreshold(values: Uint8Array): number {
  const hist = new Float64Array(256)
  for (const v of values) hist[v]!++
  const total = values.length
  let sumAll = 0
  for (let i = 0; i < 256; i++) sumAll += i * hist[i]!
  let sumB = 0
  let wB = 0
  let best = 0
  let bestT = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]!
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]!
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      bestT = t
    }
  }
  return bestT
}

/** Gauss-szerű elmosás három egymás utáni dobozszűrővel (moaré ellen). */
export function blur(img: GrayImage, radius: number): GrayImage {
  if (radius <= 0) return img
  let cur = img.data
  const { width: w, height: h } = img
  for (let pass = 0; pass < 3; pass++) {
    const tmp = new Uint8Array(w * h)
    for (let y = 0; y < h; y++) {
      let acc = 0
      const row = y * w
      for (let x = -radius; x <= radius; x++) acc += cur[row + Math.min(w - 1, Math.max(0, x))]!
      for (let x = 0; x < w; x++) {
        tmp[row + x] = Math.round(acc / (2 * radius + 1))
        acc += cur[row + Math.min(w - 1, x + radius + 1)]! - cur[row + Math.max(0, x - radius)]!
      }
    }
    const next = new Uint8Array(w * h)
    for (let x = 0; x < w; x++) {
      let acc = 0
      for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
      for (let y = 0; y < h; y++) {
        next[y * w + x] = Math.round(acc / (2 * radius + 1))
        acc += tmp[Math.min(h - 1, y + radius + 1) * w + x]! - tmp[Math.max(0, y - radius) * w + x]!
      }
    }
    cur = next
  }
  return { width: w, height: h, data: cur }
}

/** PGM (P5) kódolás: a Tesseract (Leptonica) közvetlenül olvassa, nem kell hozzá külön kódoló. */
export function encodePgm(img: GrayImage): Uint8Array {
  const header = new TextEncoder().encode(`P5\n${img.width} ${img.height}\n255\n`)
  const out = new Uint8Array(header.length + img.data.length)
  out.set(header, 0)
  out.set(img.data, header.length)
  return out
}
