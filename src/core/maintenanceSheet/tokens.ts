import { componentBoxes, labelComponents, removeLines, type ComponentBox } from './image'

/**
 * Saját elrendezés-elemzés a binarizált képen (ERF-04): karakterek → szövegdarabok (egy-egy
 * cella tartalma) → sorok. A táblázat cellái egysorosak és középre igazítottak, a cellák
 * között nagy a vízszintes köz, ezért ez egyszerűbb és kiszámíthatóbb, mint a Tesseract
 * oldalelemzése, és egyetlen cellát sem hagy ki.
 */

export interface Box {
  readonly x0: number
  readonly y0: number
  readonly x1: number
  readonly y1: number
}

export interface Token extends Box {
  /** A darab „fő” karaktereinek magassága (a kis jelek, például mínusz és pont nélkül). */
  readonly charHeight: number
}

export interface TokenRow {
  readonly tokens: readonly Token[]
  /** A sor középvonala: y = a + b·x. */
  readonly a: number
  readonly b: number
}

const width = (b: Box): number => b.x1 - b.x0 + 1
const height = (b: Box): number => b.y1 - b.y0 + 1
const cy = (b: Box): number => (b.y0 + b.y1) / 2

function union(p: Box, q: Box): Box {
  return { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) }
}

function verticalOverlap(p: Box, q: Box): number {
  return Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0) + 1)
}

/**
 * Szövegdarabok képzése. `textHeight` a várható számjegymagasság képpontban.
 * A fő karakterek (számjegy, betű) szóközénél kisebb réssel összeérnek; a kis jeleket
 * (mínusz, pont, ékezet) csak akkor csatoljuk, ha a helyük alapján a darabhoz tartoznak –
 * a rácsvonal-maradványok így kimaradnak.
 */
export function findTokens(mask: Uint8Array, w: number, h: number, textHeight: number): Token[] {
  const T = textHeight
  const tooBig = (b: Box): boolean => height(b) > T * 2.2 || width(b) > T * 10
  const { labels, boxes } = labelComponents(mask, w, h)
  const candidates: ComponentBox[] = []
  boxes.forEach((b, id) => {
    if (!tooBig(b)) {
      candidates.push(b)
      return
    }
    // Szöveghez ért vonaldarab: a komponensen belül töröljük a karakternél hosszabb
    // futamokat (egy karakterben sincs a betűmagasság 1,2-szeresénél hosszabb vízszintes vagy
    // 1,6-szeresénél hosszabb függőleges futam), és a maradékot újra szétválogatjuk.
    const bw = width(b)
    const bh = height(b)
    if (bw > w / 2 || bh > h / 2) return
    const local = new Uint8Array(bw * bh)
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (labels[(b.y0 + y) * w + b.x0 + x] === id) local[y * bw + x] = 1
    removeLines(local, bw, bh, Math.round(T * 1.2), Math.round(T * 1.6), Math.round(T * 0.35))
    for (const s of componentBoxes(local, bw, bh)) {
      const sb = { x0: s.x0 + b.x0, y0: s.y0 + b.y0, x1: s.x1 + b.x0, y1: s.y1 + b.y0, n: s.n }
      if (!tooBig(sb)) candidates.push(sb)
    }
  })
  const main: ComponentBox[] = []
  const small: ComponentBox[] = []
  for (const b of candidates) {
    const bw = width(b)
    const bh = height(b)
    if (bh >= T * 0.45) {
      if (b.n < bw * bh * 0.08) continue // vékony keret-sarok
      if (bh > T * 1.45 && bw <= T * 0.25) continue // függőleges vonalcsonk (egy karakter sem ilyen magas és vékony)
      main.push(b)
    } else if (bw <= T * 0.9 && b.n >= 4) small.push(b)
  }

  // Fő karakterek láncolása balról jobbra: kis vízszintes rés és jelentős függőleges átfedés.
  main.sort((p, q) => p.x0 - q.x0)
  const groups: Array<{ box: Box; chars: Box[] }> = []
  for (const c of main) {
    let best: { box: Box; chars: Box[] } | undefined
    let bestGap = Infinity
    for (const g of groups) {
      const last = g.chars[g.chars.length - 1]!
      const gap = c.x0 - g.box.x1
      if (gap > T * 0.9 || gap < -T * 0.5) continue
      const ov = verticalOverlap(c, last)
      if (ov < Math.min(height(c), height(last)) * 0.5) continue
      if (gap < bestGap) {
        bestGap = gap
        best = g
      }
    }
    if (best) {
      best.chars.push(c)
      best.box = union(best.box, c)
    } else groups.push({ box: c, chars: [c] })
  }

  const tokens = groups.map((g) => {
    const hs = g.chars.map(height).sort((p, q) => p - q)
    return { box: g.box, charHeight: hs[Math.floor(hs.length / 2)]! }
  })

  // Kis jelek: a darab sávjában, vagy közvetlenül előtte a sáv közepén (mínusz előjel).
  for (const s of small) {
    const sc = cy(s)
    let target: (typeof tokens)[number] | undefined
    for (const t of tokens) {
      const b = t.box
      const inside = s.x0 >= b.x0 - 1 && s.x1 <= b.x1 + T * 0.35 && sc >= b.y0 - T * 0.25 && sc <= b.y1 + T * 0.1
      const mid0 = b.y0 + height(b) * 0.25
      const mid1 = b.y1 - height(b) * 0.25
      const minus = s.x1 < b.x0 && b.x0 - s.x1 <= T * 0.7 && sc >= mid0 && sc <= mid1 && height(s) <= T * 0.3 && width(s) >= height(s) * 1.5
      if (inside || minus) {
        target = t
        break
      }
    }
    if (target) target.box = union(target.box, s)
  }

  // Második kör: a csatolt kötőjel áthidalja a „HA” és az „SKV” közti rést.
  tokens.sort((p, q) => p.box.x0 - q.box.x0)
  const merged: typeof tokens = []
  for (const t of tokens) {
    const prev = merged.find((m) => {
      const gap = t.box.x0 - m.box.x1
      return gap <= T * 0.6 && verticalOverlap(m.box, t.box) >= Math.min(height(m.box), height(t.box)) * 0.5
    })
    if (prev) {
      prev.box = union(prev.box, t.box)
      prev.charHeight = Math.max(prev.charHeight, t.charHeight)
    } else merged.push({ ...t })
  }

  return merged.map((t) => ({ ...t.box, charHeight: t.charHeight }))
}

/** Egyenes illesztése a darabok középpontjaira: y = a + b·x. */
function fitRow(list: Token[]): TokenRow {
  list.sort((p, q) => p.x0 - q.x0)
  const xs = list.map((t) => (t.x0 + t.x1) / 2)
  const ys = list.map(cy)
  const n = list.length
  const mx = xs.reduce((s, v) => s + v, 0) / n
  const my = ys.reduce((s, v) => s + v, 0) / n
  let sxx = 0
  let sxy = 0
  for (let k = 0; k < n; k++) {
    sxx += (xs[k]! - mx) ** 2
    sxy += (xs[k]! - mx) * (ys[k]! - my)
  }
  const b = n >= 2 && sxx > 1 ? Math.max(-0.05, Math.min(0.05, sxy / sxx)) : 0
  return { tokens: list, a: my - b * mx, b }
}

/**
 * Sorok képzése. A sorokat csak a betűméretű darabok alkotják: mindegyiket a legközelebbi
 * jobb oldali, vele függőlegesen legalább félig átfedő betűméretű darabhoz kötjük (így a
 * perspektíva miatti sodródás nem köt össze két szomszédos sort, és egy apró szemcse sem
 * szakítja meg a láncot). Az apró darabok utólag a legközelebbi sorhoz kerülnek.
 */
export function groupRows(tokens: readonly Token[], textHeight: number): TokenRow[] {
  const big = tokens.filter((t) => t.charHeight >= textHeight * 0.7)
  const small = tokens.filter((t) => t.charHeight < textHeight * 0.7)
  const parent = big.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  for (let m = 0; m < big.length; m++) {
    const p = big[m]!
    let best = -1
    let bestGap = Infinity
    for (let n = 0; n < big.length; n++) {
      const q = big[n]!
      if (n === m || q.x0 <= p.x0) continue
      const minH = Math.min(height(p), height(q))
      if (verticalOverlap(p, q) < minH * 0.5 || Math.abs(cy(p) - cy(q)) > minH * 0.45) continue
      const gap = q.x0 - p.x1
      if (gap < bestGap) {
        bestGap = gap
        best = n
      }
    }
    if (best >= 0) parent[find(best)] = find(m)
  }
  const byRoot = new Map<number, Token[]>()
  big.forEach((t, i) => {
    const r = find(i)
    byRoot.set(r, [...(byRoot.get(r) ?? []), t])
  })
  const rows = [...byRoot.values()].map(fitRow)

  // Apró darabok: a legközelebbi sorhoz, ha a sor középvonalához elég közel vannak.
  const extra = new Map<TokenRow, Token[]>()
  const loose: Token[] = []
  for (const t of small) {
    const x = (t.x0 + t.x1) / 2
    let best: TokenRow | undefined
    let bestDist = Infinity
    for (const r of rows) {
      const d = Math.abs(r.a + r.b * x - cy(t))
      if (d < bestDist) {
        bestDist = d
        best = r
      }
    }
    if (best && bestDist <= textHeight * 0.5) extra.set(best, [...(extra.get(best) ?? []), t])
    else loose.push(t)
  }
  const all = rows.map((r) => {
    const more = extra.get(r)
    return more ? { ...r, tokens: [...r.tokens, ...more].sort((p, q) => p.x0 - q.x0) } : r
  })
  for (const t of loose) all.push(fitRow([t]))
  all.sort((p, q) => p.a + p.b * 1000 - (q.a + q.b * 1000))
  return all
}
