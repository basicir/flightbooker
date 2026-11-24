import { WeekPlanSchema, type WeekPlan } from '../core/draft/weekPlan'
import { formatIssues } from '../core/config/settings'

/** Heti tervezetek tárolása hetenként egy fájlban (4. fejezet: Tervezet – helyben tárolt). */

export interface PlanFileSystem {
  readText(path: string): Promise<string | undefined>
  writeText(path: string, text: string): Promise<void>
  rename(from: string, to: string): Promise<void>
}

export interface PlanStore {
  load(weekStart: string): Promise<WeekPlan | null>
  save(plan: WeekPlan): Promise<void>
}

const WEEK = /^\d{4}-\d{2}-\d{2}$/

export function createPlanStore(fs: PlanFileSystem, dir: string): PlanStore {
  const pathOf = (weekStart: string): string => {
    if (!WEEK.test(weekStart)) throw new Error('Érvénytelen hét.')
    return `${dir}/terv-${weekStart}.json`
  }
  return {
    async load(weekStart) {
      const text = await fs.readText(pathOf(weekStart))
      if (text === undefined) return null
      const parsed = WeekPlanSchema.safeParse(JSON.parse(text))
      if (!parsed.success) throw new Error(`A ${weekStart} heti tervezet hibás:\n${formatIssues(parsed.error.issues).join('\n')}`)
      return parsed.data
    },
    async save(plan) {
      const parsed = WeekPlanSchema.safeParse(plan)
      if (!parsed.success) throw new Error(`A tervezet érvénytelen:\n${formatIssues(parsed.error.issues).join('\n')}`)
      const path = pathOf(parsed.data.weekStart)
      await fs.writeText(`${path}.tmp`, `${JSON.stringify(parsed.data, null, 2)}\n`)
      await fs.rename(`${path}.tmp`, path)
    },
  }
}
