import type { Settings } from '@core/config/schema'
import type { DataBundle } from '@core/model/dataBundle'
import { FL_SESSION_TYPES, theoryTypeOf, type BookingRequest, type FlSessionType, type FlTheoryFields } from '@core/model/planning'
import { groundPrograms, subjectsOf, type TheoryCatalog } from '@core/model/theoryCatalog'
import { useEffect, useState } from 'react'
import { api } from '../bridge'
import { FlField } from './flOnly'
import { Button, Select, TextInput } from './ui'

/**
 * A FlightLogger programlistája (FLI-11) a munkamenetre egyszer töltődik be (a főfolyamat a
 * lemezen is gyorsítótáraz); a „Programlista frissítése” újratölti.
 */
let catalogRequest: Promise<TheoryCatalog> | null = null
function requestCatalog(settings: Settings, force: boolean): Promise<TheoryCatalog> {
  if (force || !catalogRequest) {
    catalogRequest = api.loadTheoryCatalog(settings, force ? { force: true } : undefined)
    catalogRequest.catch(() => {
      catalogRequest = null
    })
  }
  return catalogRequest
}

export interface CatalogState {
  readonly catalog: TheoryCatalog | null
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => void
}

/** A programlista betöltése, csak ha kell (Ground training vagy Extra theory van a héten). */
export function useTheoryCatalog(settings: Settings | null, needed: boolean): CatalogState {
  /** A legutóbbi válasz a kérés sorszámával: ha a sorszám régebbi, épp töltődik. */
  const [result, setResult] = useState<{ readonly round: number; readonly catalog: TheoryCatalog | null; readonly error: string | null } | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!settings || !needed) return
    let alive = true
    requestCatalog(settings, round > 0).then(
      (catalog) => {
        if (alive) setResult({ round, catalog, error: null })
      },
      (e: unknown) => {
        if (alive) setResult((prev) => ({ round, catalog: prev?.catalog ?? null, error: e instanceof Error ? e.message : String(e) }))
      },
    )
    return () => {
      alive = false
    }
  }, [settings, needed, round])
  return { catalog: result?.catalog ?? null, loading: needed && result?.round !== round, error: result?.error ?? null, reload: () => setRound((n) => n + 1) }
}

/** A programlista állapota egy sorban, frissítés gombbal. */
export function CatalogStatus(props: { state: CatalogState; timezoneLabel?: string }) {
  const { catalog, loading, error } = props.state
  return (
    <div className="row wrap small">
      <span className="muted">
        {loading
          ? 'A FlightLogger programlistája töltődik…'
          : error
            ? `A programlista nem töltődött be: ${error}`
            : catalog
              ? `FlightLogger programlista: ${catalog.programs.length} program, ${catalog.subjects.length} tárgy${catalog.source === 'cache' ? ' (gyorsítótárból)' : catalog.source === 'demo' ? ' (szintetikus előnézet)' : ''}.`
              : ''}
      </span>
      {catalog?.errors.map((e) => (
        <span key={e} className="muted">
          {e}
        </span>
      ))}
      <Button small variant="ghost" disabled={loading} onClick={props.state.reload} title="A programok és tárgyak újratöltése a FlightLoggerből (csak olvasás)">
        Programlista frissítése
      </Button>
    </div>
  )
}

/**
 * Az elméleti igény FlightLogger-mezői a típusa szerint (FLI-11): Ground trainingnél osztály,
 * program, tárgy, Session type és Session; Extra theorynál program. A választók a FlightLogger
 * programlistájából jönnek; ha az nincs meg, szabad szöveg (az import a felirat szerint keres).
 */
export function TheoryFlFields(props: {
  request: BookingRequest
  bundle: DataBundle | null
  catalog: TheoryCatalog | null
  onChange: (patch: { readonly flTheory?: FlTheoryFields; readonly classId?: string }) => void
}) {
  const { request, bundle, catalog } = props
  const type = theoryTypeOf(request)
  if (type === 'meeting') return null
  const fl = request.flTheory ?? {}
  const set = (patch: Partial<FlTheoryFields>): void => {
    const next = Object.fromEntries(Object.entries({ ...fl, ...patch }).filter(([, v]) => v !== undefined && v !== '')) as FlTheoryFields
    props.onChange({ flTheory: Object.keys(next).length > 0 ? next : undefined })
  }
  const programs = catalog ? (type === 'groundTraining' ? groundPrograms(catalog) : catalog.programs) : []
  const subjects = catalog ? subjectsOf(catalog, fl.programRevisionId) : []
  const classes = Object.entries(bundle?.directory.classes ?? {}).sort(([, a], [, b]) => a.name.localeCompare(b.name, 'hu'))
  // A kiválasztott program akkor is látszik, ha a mostani listában nincs (például régebbi revízió).
  const programKnown = programs.some((p) => p.revisionId === fl.programRevisionId)

  const programField =
    programs.length > 0 ? (
      <Select
        ariaLabel="Program a FlightLoggerben"
        value={programKnown ? (fl.programRevisionId ?? '') : ''}
        onChange={(revisionId) => {
          const p = programs.find((x) => x.revisionId === revisionId)
          set({ programRevisionId: p?.revisionId, program: p?.label, subjectId: undefined, subject: undefined })
        }}
        options={[{ value: '', label: fl.program && !programKnown ? `${fl.program} (kézzel)` : 'nincs megadva' }, ...programs.map((p) => ({ value: p.revisionId, label: p.label }))]}
      />
    ) : (
      <TextInput ariaLabel="Program a FlightLoggerben" value={fl.program ?? ''} placeholder="program – töredék is elég, pl. „ground 6”" width={260} onChange={(v) => set({ program: v, programRevisionId: undefined })} />
    )

  return (
    <>
      {type === 'groundTraining' && (
        <FlField label="Osztály (Class)">
          <Select
            ariaLabel="Osztály a FlightLoggerben"
            value={request.classId ?? ''}
            onChange={(classId) => props.onChange({ classId: classId || undefined })}
            options={[{ value: '', label: 'nincs' }, ...classes.map(([id, c]) => ({ value: id, label: c.name }))]}
          />
        </FlField>
      )}
      <FlField label="Program" missing={!fl.program}>
        {programField}
      </FlField>
      {type === 'groundTraining' && (
        <>
          <FlField label="Tárgy (Subject)" missing={!fl.subject}>
            {programs.length > 0 && !fl.programRevisionId && !fl.subject ? (
              <span className="small muted">előbb a programot válaszd (a tárgyak attól függnek)</span>
            ) : subjects.length > 0 ? (
              <Select
                ariaLabel="Tárgy a FlightLoggerben"
                value={subjects.some((s) => s.id === fl.subjectId) ? (fl.subjectId ?? '') : ''}
                onChange={(id) => {
                  const s = subjects.find((x) => x.id === id)
                  set({ subjectId: s?.id, subject: s?.name })
                }}
                options={[{ value: '', label: 'nincs megadva' }, ...subjects.map((s) => ({ value: s.id, label: s.name }))]}
              />
            ) : (
              <TextInput ariaLabel="Tárgy a FlightLoggerben" value={fl.subject ?? ''} placeholder="tárgy – töredék is elég, pl. „cross”" width={240} onChange={(v) => set({ subject: v, subjectId: undefined })} />
            )}
          </FlField>
          <FlField label="Session type">
            <Select<FlSessionType>
              ariaLabel="Session type a FlightLoggerben"
              value={fl.sessionType ?? 'Ground lesson'}
              onChange={(v) => set({ sessionType: v === 'Ground lesson' ? undefined : v })}
              options={FL_SESSION_TYPES.map((v) => ({ value: v, label: v }))}
            />
          </FlField>
          <FlField label="Session (az óra címe)" missing={!fl.session}>
            <TextInput ariaLabel="Session a FlightLoggerben" value={fl.session ?? ''} placeholder="az óra címe" width={260} maxLength={300} onChange={(v) => set({ session: v })} />
          </FlField>
        </>
      )}
    </>
  )
}
