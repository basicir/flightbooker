/**
 * Lajstromjel illesztése a flottához (ERF-04). Az OCR a hasonló alakú jeleket gyakran
 * összetéveszti (B–8, J–), I–1, O–0 …), ezért ezek cseréje olcsóbb, mint egy tetszőleges
 * karakteré. Csak egyértelmű, közeli találatot fogadunk el.
 */

export interface FleetAircraft {
  readonly id: string
  readonly callSign: string
}

export interface RegistrationMatch {
  readonly aircraft: FleetAircraft
  readonly distance: number
  /** A második legjobb jelölt távolsága mínusz a legjobbé (nincs második: végtelen). */
  readonly margin: number
}

/** Nagybetűs, csak betű és szám (kötőjel, szóköz és írásjel nélkül). */
export function normalizeRegistration(text: string): string {
  return text
    .replace(/[)\]}]/g, 'J')
    .replace(/[|!]/g, 'I')
    .replace(/\$/g, 'S')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

const CONFUSABLE: ReadonlyArray<string> = ['B8', 'O0', 'OD', 'OQ', 'D0', 'IJ', 'I1', 'IL', 'J1', 'L1', 'S5', 'Z2', 'G6']
const confusable = new Set(CONFUSABLE.flatMap((p) => [p, `${p[1]}${p[0]}`]))

function substitutionCost(a: string, b: string): number {
  if (a === b) return 0
  return confusable.has(a + b) ? 0.4 : 1
}

/** Súlyozott szerkesztési távolság (beszúrás és törlés 1, hasonló jel cseréje 0,4). */
export function registrationDistance(read: string, callSign: string): number {
  const a = normalizeRegistration(read)
  const b = normalizeRegistration(callSign)
  const prev = new Array<number>(b.length + 1)
  const cur = new Array<number>(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + substitutionCost(a[i - 1]!, b[j - 1]!))
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!
  }
  return prev[b.length]!
}

/**
 * Lajstromjel-szerű-e az olvasott szöveg (flottán kívüli gép felismeréséhez): nagybetűs,
 * egy-két jeles előtag és három-négy jeles utótag, például „HA-ABC”. A táblázat kisbetűs
 * szavai („Kedd”, „Cessna”) így nem számítanak lajstromnak.
 */
export function looksLikeRegistration(text: string): boolean {
  const t = text.replace(/\s+/g, '')
  return /^[A-Z0-9]{1,2}[-–—.:~][A-Za-z0-9()|!{}[\]]{3,4}$/.test(t) && /[A-Z]/.test(t)
}

/** A legközelebbi flottabeli gép távolsága (egyértelműségtől függetlenül). */
export function nearestRegistrationDistance(read: string, fleet: readonly FleetAircraft[]): number {
  let best = Infinity
  for (const a of fleet) best = Math.min(best, registrationDistance(read, a.callSign))
  return best
}

/**
 * A legjobb flottabeli találat. Csak olyan eltérést fogadunk el, amely OCR-hibából eredhet:
 * hasonló alakú jelek cseréjét (legfeljebb kettőt), vagy egyetlen kimaradt / betoldott jelet.
 * Egy tetszőleges betű cseréje nem elég: a táblázatban olyan gép is lehet, amely nincs a
 * flottában (például HA-DQC a HA-DPC mellett), és azt nem szabad egy másik géphez rendelni.
 * Kétértelmű találatot (a második legjobb 0,35-nél közelebb) sem fogadunk el.
 */
export function matchRegistration(read: string, fleet: readonly FleetAircraft[]): RegistrationMatch | undefined {
  const norm = normalizeRegistration(read)
  if (norm.length < 3) return undefined
  const scored = fleet.map((aircraft) => ({ aircraft, distance: registrationDistance(read, aircraft.callSign) })).sort((p, q) => p.distance - q.distance)
  const best = scored[0]
  if (!best) return undefined
  const lengthDiffers = normalizeRegistration(best.aircraft.callSign).length !== norm.length
  const plausible = best.distance <= 0.8 + 1e-9 || (lengthDiffers && best.distance <= 1 + 1e-9)
  if (!plausible) return undefined
  const margin = scored[1] ? scored[1].distance - best.distance : Infinity
  if (best.distance > 0 && margin < 0.35) return undefined
  return { ...best, margin }
}

/** A flotta lajstromjeleiben előforduló jelek (az OCR karakterlistájához). */
export function registrationAlphabet(fleet: readonly FleetAircraft[]): string {
  const chars = new Set<string>(['-'])
  for (const a of fleet) for (const c of a.callSign.toUpperCase()) if (/[A-Z0-9-]/.test(c)) chars.add(c)
  if (chars.size <= 1) return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'
  return [...chars].sort().join('')
}
