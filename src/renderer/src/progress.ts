import type { Settings } from '@core/config/schema'
import type { DataBundle } from '@core/model/dataBundle'
import type { LectureInfo, StudentProgress } from '@core/progress/lectures'
import { resolveProgress } from '@core/progress/syllabus'

/**
 * A növendék haladása a beállításokban kiválasztott feladatsorral (revízióval). A
 * revízió átállítása így azonnal hat, nem kell hozzá új adatfrissítés.
 */
export function studentProgress(bundle: DataBundle | null, settings: Settings | null, studentId: string): StudentProgress | undefined {
  if (!bundle) return undefined
  const chosen = settings?.students.find((s) => s.userId === studentId)?.syllabusId
  const records = bundle.trainingRecords[studentId] ?? []
  if (bundle.syllabi.length === 0 || (!chosen && records.length === 0 && bundle.progress[studentId])) return bundle.progress[studentId]
  const all = bundle.directory.lectures
  const api: Record<string, LectureInfo> = Object.fromEntries(Object.entries(all).filter(([id]) => !id.startsWith('syl:')))
  return resolveProgress(records, api, all, bundle.syllabi, chosen)
}

/** „ATP(A) Integrated – Revision 7” */
export function syllabusLabel(bundle: DataBundle | null, id: string | undefined): string | undefined {
  const s = id ? bundle?.syllabi.find((x) => x.id === id) : undefined
  return s ? `${s.program} – ${s.revision}` : undefined
}

/** A hozzárendelt növendékek haladása (a tervező szál nem éri el a hét adatát). */
export function progressMap(bundle: DataBundle, settings: Settings): Record<string, StudentProgress | undefined> {
  return Object.fromEntries(settings.students.map((st) => [st.userId, studentProgress(bundle, settings, st.userId)]))
}
