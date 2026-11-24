import { headingFromDesignator, reciprocalDesignator, type Runway } from '../config/runways'

/**
 * Repülőtér keresése ICAO-kód alapján a beépített OurAirports-listából (Első beállítás).
 * A lista a csomag része, futás közben nincs hálózati kérés (ALP-02). Az adat lusta
 * betöltésű, mert közel 1 MB.
 */

type RawAirport = [number, number, Array<[string, number | null]>?]

export interface AirportLookupResult {
  readonly icaoCode: string
  readonly latitude: number
  readonly longitude: number
  /** Pályairányok valós iránnyal; ahol a forrás nem ad irányt, a jelből becsült érték. */
  readonly runways: readonly Runway[]
  /** Van-e olyan pálya, amelynek irányát csak a jelből becsültük (mágneses, ellenőrizendő). */
  readonly headingsEstimated: boolean
}

let cache: Readonly<Record<string, RawAirport>> | undefined

async function data(): Promise<Readonly<Record<string, RawAirport>>> {
  if (!cache) {
    const { AIRPORTS_JSON } = await import('./data')
    cache = JSON.parse(AIRPORTS_JSON) as Record<string, RawAirport>
  }
  return cache
}

export async function lookupAirport(icaoCode: string): Promise<AirportLookupResult | undefined> {
  const code = icaoCode.trim().toUpperCase()
  if (!/^[A-Z]{4}$/.test(code)) return undefined
  const raw = (await data())[code]
  if (!raw) return undefined
  let estimated = false
  const runways: Runway[] = []
  for (const [designator, heading] of raw[2] ?? []) {
    let h = heading
    if (h === null) {
      // A pár irányából, ha az ismert; különben a jelből.
      const pair = raw[2]?.find(([d]) => d === reciprocalDesignator(designator))?.[1]
      h = pair !== null && pair !== undefined ? (pair + 180) % 360 : (headingFromDesignator(designator) ?? null)
      estimated = estimated || pair === null || pair === undefined
    }
    if (h !== null) runways.push({ designator, trueHeadingDeg: Math.round(h * 10) / 10 })
  }
  return { icaoCode: code, latitude: raw[0], longitude: raw[1], runways, headingsEstimated: estimated }
}
