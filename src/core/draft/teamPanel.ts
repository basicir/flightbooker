import type { BookingRequest, Decision } from '../model/planning'
import { lectureOrderKey, type LectureInfo } from '../progress/lectures'

/**
 * A „Közös briefing szervezése” panel adatai (KBR-03): a heti igények feladatkód szerint, és
 * hogy ki miért nem kerülhet csapatba. Ugyanaz a feladat revíziónként más azonosítójú, ezért a
 * csoport a feladat kódja („I./7.”), nem az azonosítója.
 */

/** A feladat kódja a nevéből („I./7. Traffic patterns I.” → „I./7”); kód nélkül a teljes név. */
export function lessonCode(name: string): string {
  if (!lectureOrderKey(name)) return name.trim()
  return (name.trim().split(/\s+/)[0] ?? name).replace(/\.$/, '').toUpperCase()
}

/** Miért nem lehet az igény csapattag (a panel szürkén mutatja, okkal). */
export type TeamBlockReason = 'noLesson' | 'fixed' | 'deferred' | 'booked'

export const TEAM_BLOCK_LABELS: Readonly<Record<TeamBlockReason, string>> = {
  noLesson: 'nincs feladata',
  fixed: 'fix időpontú',
  deferred: 'halasztva',
  booked: 'már a FlightLoggerben',
}

export interface LessonGroup {
  readonly code: string
  /** A feladat neve (az első igényé). */
  readonly label: string
  /** Az ilyen feladatú repülési és szimulátoros igények, a csapattagokkal együtt. */
  readonly requestIds: readonly string[]
}

export interface TeamPanelData {
  /** Feladatonként, ahol legalább két igény van; a feladat sorrendjében. */
  readonly groups: readonly LessonGroup[]
  /** Igényenként a tiltó ok, ha csapatba nem tehető. */
  readonly blocked: ReadonlyMap<string, TeamBlockReason>
}

/** Az igény feladatkódja, ha van feladata. */
export function requestLessonCode(request: BookingRequest, catalog: Readonly<Record<string, LectureInfo>>): string | undefined {
  const name = request.lectureId ? catalog[request.lectureId]?.name : undefined
  return name ? lessonCode(name) : undefined
}

/** Miért nem tehető csapatba az igény (vagy `undefined`, ha tehető). */
export function teamBlockReason(request: BookingRequest, decisions: readonly Decision[], booked: ReadonlySet<string>): TeamBlockReason | undefined {
  if (booked.has(request.id) && !request.briefingTeamId) return 'booked'
  if (decisions.some((d) => d.kind === 'defer' && d.requestId === request.id)) return 'deferred'
  if (request.timing?.kind === 'fixed') return 'fixed'
  if (!request.lectureId) return 'noLesson'
  return undefined
}

/**
 * A panel csoportjai: a repülési és szimulátoros igények feladatkód szerint. Csak ott van
 * csoport, ahol legalább két ilyen feladatú igény van (egyedül nincs kivel közös briefinget
 * tartani). `booked`: a FlightLoggerben már lefoglalt igények.
 */
export function teamPanelData(requests: readonly BookingRequest[], decisions: readonly Decision[], catalog: Readonly<Record<string, LectureInfo>>, booked: ReadonlySet<string>): TeamPanelData {
  const blocked = new Map<string, TeamBlockReason>()
  const byCode = new Map<string, { label: string; ids: string[] }>()
  for (const r of requests) {
    if (r.kind === 'theory') continue
    const reason = teamBlockReason(r, decisions, booked)
    if (reason) blocked.set(r.id, reason)
    const code = requestLessonCode(r, catalog)
    if (!code) continue
    const entry = byCode.get(code) ?? { label: catalog[r.lectureId!]!.name, ids: [] }
    entry.ids.push(r.id)
    byCode.set(code, entry)
  }
  const groups = [...byCode]
    .filter(([, g]) => g.ids.length >= 2)
    .map(([code, g]) => ({ code, label: g.label, requestIds: g.ids }))
    .sort((a, b) => {
      const ka = lectureOrderKey(a.label)
      const kb = lectureOrderKey(b.label)
      if (ka && kb && (ka[0] !== kb[0] || ka[1] !== kb[1])) return ka[0] - kb[0] || ka[1] - kb[1]
      return a.code.localeCompare(b.code)
    })
  return { groups, blocked }
}

/** A csapat tagjainak feladatkódjai: egynél több kód vegyes feladatú csapat (KBR-06). */
export function teamLessonCodes(requests: readonly BookingRequest[], teamId: string, catalog: Readonly<Record<string, LectureInfo>>): string[] {
  return [...new Set(requests.filter((r) => r.briefingTeamId === teamId).map((r) => requestLessonCode(r, catalog) ?? '–'))].sort()
}
