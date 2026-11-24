/** A felderítő eszköz bemeneteinek értelmezése (tesztelhető, mellékhatás nélkül). */

export interface Coordinates {
  readonly latitude: number
  readonly longitude: number
}

/** Elfogad: „47.4298, 19.2611”, „47,4298 19,2611”, „47.4298;19.2611”, „47.4298,19.2611”. */
export function parseCoordinates(text: string): Coordinates | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  let tokens = trimmed.split(/\s*;\s*|,\s+|\s+/).filter((t) => t !== '')
  if (tokens.length === 1 && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(tokens[0]!)) tokens = tokens[0]!.split(',')
  if (tokens.length !== 2) throw new Error('A koordinátát „szélesség, hosszúság” alakban add meg, például 47.4298, 19.2611.')
  const [latitude, longitude] = tokens.map((t) => Number(t.replace(',', '.'))) as [number, number]
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) throw new Error('A szélesség -90 és 90 közötti szám.')
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('A hosszúság -180 és 180 közötti szám.')
  return { latitude, longitude }
}

/** „ÉÉÉÉ-HH-NN ÓÓ:PP”, a számítógép helyi idejében. */
export function parseLocalDateTime(text: string): Date | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(trimmed)
  if (!match) throw new Error('Az időpontot „ÉÉÉÉ-HH-NN ÓÓ:PP” alakban add meg, például 2026-11-12 09:00.')
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number]
  const date = new Date(y, mo - 1, d, h, mi)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) {
    throw new Error('Nem létező időpont.')
  }
  return date
}

export interface CliOptions {
  readonly pastDays: number
  readonly futureDays: number
}

/** `--vissza=14 --elore=21` */
export function parseCliOptions(argv: readonly string[]): CliOptions {
  let pastDays = 14
  let futureDays = 21
  for (const arg of argv) {
    const match = /^--(vissza|elore)=(\d{1,3})$/.exec(arg)
    if (!match) throw new Error(`Ismeretlen kapcsoló: ${arg}. Használható: --vissza=NAP, --elore=NAP`)
    const value = Number(match[2])
    if (value < 1 || value > 120) throw new Error('A napok száma 1 és 120 között lehet.')
    if (match[1] === 'vissza') pastDays = value
    else futureDays = value
  }
  return { pastDays, futureDays }
}
