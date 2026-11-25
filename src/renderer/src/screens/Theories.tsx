import { newRequestId, removeRequest } from '@core/draft/weekPlan'
import { DEFAULT_THEORY_TYPE, theoryHeadcount, theoryTypeOf, type BookingRequest, type TheoryType } from '@core/model/planning'
import { localToMs } from '@core/time/zoned'
import { TimingEditor } from '../components/timingEditor'
import type { DataBundle } from '@core/model/dataBundle'
import { useState } from 'react'
import { Button, Card, Empty, NumberInput, PageHeader, Select, TextInput } from '../components/ui'
import { personName, THEORY_TYPE_LABELS, THEORY_TYPE_SHORT } from '../format'
import { useApp } from '../state'
import { WeekTag } from '../components/weekTag'
import { PrioritySelect } from '../components/priority'
import { CatalogStatus, TheoryFlFields, useTheoryCatalog } from '../components/theoryFlFields'
import { FlField, FlOnlySection, PlanFields } from '../components/flOnly'

/** Elméletek (6. fejezet 3. lépés, TRV-01–03, SZB-08): résztvevők, időpont, terem. */
export function Theories() {
  const app = useApp()
  const { settings, bundle, weekPlan, timezone } = app
  // A FlightLogger programlistája csak akkor kell, ha van Ground training vagy Extra theory (FLI-11).
  const needsCatalog = !!weekPlan?.requests.some((r) => r.kind === 'theory' && theoryTypeOf(r) !== 'meeting')
  const catalogState = useTheoryCatalog(settings, needsCatalog)
  if (!settings || !weekPlan) return null
  const theories = weekPlan.requests.filter((r) => r.kind === 'theory')
  const defaultStart = new Date(localToMs(weekPlan.weekStart, 10 * 60, timezone)).toISOString()
  const rooms = bundle?.snapshot.classroomIds ?? []

  const update = (id: string, patch: Partial<BookingRequest>): void =>
    app.updatePlan((p) => ({
      ...p,
      requests: p.requests.map((r) => (r.id === id ? (Object.fromEntries(Object.entries({ ...r, ...patch }).filter(([, v]) => v !== undefined)) as unknown as BookingRequest) : r)),
    }))

  const add = (): void =>
    app.updatePlan((p) => ({
      ...p,
      requests: [
        ...p.requests,
        {
          id: newRequestId('elmelet'),
          kind: 'theory',
          theoryType: DEFAULT_THEORY_TYPE,
          // Üresen indul: a résztvevőket az oktató választja ki (egyenként, kereséssel vagy osztályként).
          studentIds: [],
          taskSelectionMode: 'none',
          durations: { briefing: 0, main: 90, debriefing: 0 },
          daylightOnly: false,
          origin: 'manual',
        },
      ],
    }))

  return (
    <div className="page">
      <PageHeader
        title="Elméletek" week={<WeekTag />}
        lead="Fix időpontot vagy időablakot adhatsz; ezek nélkül az elmélet rossz időre kerül, megfelelő teremmel. A „Tervezéshez” rész kell a tervhez; a „FlightLoggerbe” rész csak a foglalásba kerül (típus, program, tárgy, komment)."
        actions={
          <>
            <Button onClick={add}>+ Elmélet</Button>
            <Button variant="primary" onClick={() => app.navigate('dilemmas')}>
              Tovább: dilemmák →
            </Button>
          </>
        }
      />
      {needsCatalog && (
        <Card>
          <CatalogStatus state={catalogState} />
        </Card>
      )}
      {theories.length === 0 ? (
        <Card>
          <Empty>Ezen a héten még nincs elméleti igény.</Empty>
        </Card>
      ) : (
        theories.map((t) => (
          <Card
            key={t.id}
            title={`${THEORY_TYPE_LABELS[theoryTypeOf(t)]} – ${theoryHeadcount(t)} résztvevő (${t.studentIds.length} növendék + oktató)`}
            actions={
              <Button small variant="ghost" onClick={() => app.updatePlan((p) => removeRequest(p, t.id))}>
                Törlés
              </Button>
            }
          >
            <div className="stack">
              <PlanFields>
                <ParticipantsEditor bundle={bundle} assignedIds={settings.students.map((s) => s.userId)} value={t.studentIds} onChange={(studentIds) => update(t.id, { studentIds })} />
                <div className="row wrap">
                  <span className="plan-label">Hossz (perc):</span>
                  <NumberInput width={80} ariaLabel="Elmélet hossza" value={t.durations.main} min={15} onChange={(v) => update(t.id, { durations: { ...t.durations, main: v ?? 90 } })} />
                  <span className="plan-label">Időpont:</span>
                  <TimingEditor request={t} tz={timezone} weekStart={weekPlan.weekStart} defaultStart={defaultStart} onChange={(timing) => update(t.id, { timing })} />
                  <span className="plan-label">Preferált terem:</span>
                  <Select
                    ariaLabel="Preferált terem"
                    value={t.preferredClassroomId ?? ''}
                    onChange={(v) => update(t.id, { preferredClassroomId: v || undefined })}
                    options={[{ value: '', label: 'bármelyik' }, ...rooms.map((id) => ({ value: id, label: `${bundle?.directory.classrooms[id] ?? id} (${settings.classrooms[id]?.capacity ?? '?'} fő)` }))]}
                  />
                  <PrioritySelect settings={settings} request={t} onChange={(priority) => update(t.id, { priority })} />
                </div>
              </PlanFields>
              <FlOnlySection summary={theoryFlSummary(t, bundle)} missing={theoryFlMissing(t)}>
                <FlField
                  label="Típus"
                  hint={
                    theoryTypeOf(t) === 'extraTheory' && t.studentIds.length > 1
                      ? 'A FlightLoggerben az extra elmélet egynövendékes: növendékenként külön foglalás lesz, ugyanarra az időre és terembe.'
                      : theoryTypeOf(t) === 'meeting'
                        ? 'A megbeszélésnek nincs oktató mezője: te is résztvevőként kerülsz rá.'
                        : undefined
                  }
                >
                  <Select
                    ariaLabel="Elmélet típusa"
                    value={theoryTypeOf(t)}
                    onChange={(theoryType: TheoryType) => update(t.id, { theoryType })}
                    options={(Object.keys(THEORY_TYPE_LABELS) as TheoryType[]).map((value) => ({ value, label: THEORY_TYPE_LABELS[value] }))}
                  />
                </FlField>
                <TheoryFlFields request={t} bundle={bundle} catalog={catalogState.catalog} onChange={(patch) => update(t.id, patch)} />
                <FlField label="Komment">
                  <TextInput ariaLabel="Komment a FlightLoggerbe" value={t.note ?? ''} placeholder="a foglalás megjegyzése (a résztvevők is látják)" width={380} maxLength={500} onChange={(v) => update(t.id, { note: v || undefined })} />
                </FlField>
              </FlOnlySection>
            </div>
          </Card>
        ))
      )}
    </div>
  )
}

/**
 * Elmélet résztvevői (TRV-01). A hozzárendelt növendékek mellett ideiglenesen bárki
 * hozzáadható a FlightLogger növendékei közül, vagy egy egész osztály; az osztály tagjai
 * egyenként kerülnek a listába, így egyenként törölhetők. Az ideiglenes résztvevők csak
 * ehhez az elmélethez tartoznak, a beállításokba nem kerülnek.
 */
function ParticipantsEditor(props: { bundle: DataBundle | null; assignedIds: readonly string[]; value: readonly string[]; onChange: (ids: string[]) => void }) {
  const { bundle, value } = props
  const [query, setQuery] = useState('')
  const [classId, setClassId] = useState('')
  const present = new Set(value)
  const assigned = new Set(props.assignedIds)
  const people = bundle?.directory.people ?? {}
  const classes = bundle?.directory.classes ?? {}
  const q = query.trim().toLowerCase()
  const results =
    q.length >= 2
      ? Object.entries(people)
          .filter(([id, p]) => p.role === 'student' && !present.has(id) && p.name.toLowerCase().includes(q))
          .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'hu'))
          .slice(0, 12)
      : []
  const add = (ids: readonly string[]): void => props.onChange([...value, ...ids.filter((id) => !present.has(id))])
  const classOptions = Object.entries(classes)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'hu'))
    .map(([id, c]) => ({ value: id, label: `${c.name} (${c.memberIds.length} fő)` }))
  const addClass = (): void => {
    const members = classes[classId]?.memberIds ?? []
    // Csak növendékek: az osztályban oktató is lehet.
    add(members.filter((id) => people[id]?.role !== 'instructor'))
    setClassId('')
  }
  const notAssignedPresent = props.assignedIds.filter((id) => !present.has(id))
  const nameOf = (id: string): string => personName(bundle, id)
  return (
    <div className="stack">
      <div className="participants" aria-label="Résztvevők">
        {value.length === 0 && <span className="muted small">Még nincs résztvevő.</span>}
        {value.map((id) => (
          <span key={id} className="chip" title={assigned.has(id) ? 'Hozzárendelt növendék' : 'Ideiglenesen hozzáadva'}>
            {personName(bundle, id)}
            {!assigned.has(id) && <span className="muted small"> (ideiglenes)</span>}
            <button className="chip-x" aria-label={`${personName(bundle, id)} eltávolítása`} onClick={() => props.onChange(value.filter((x) => x !== id))}>
              ×
            </button>
          </span>
        ))}
      </div>
      {notAssignedPresent.length > 0 && (
        <div className="row wrap quick-add" aria-label="Saját növendékek hozzáadása egyenként">
          <span className="muted small">Saját növendékeim:</span>
          {[...notAssignedPresent].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'hu')).map((id) => (
            <button key={id} type="button" className="add-chip" onClick={() => add([id])} title={`${nameOf(id)} hozzáadása`}>
              + {nameOf(id)}
            </button>
          ))}
          {notAssignedPresent.length > 1 && (
            <button type="button" className="link small" onClick={() => add(notAssignedPresent)} title="Az összes hiányzó saját növendék">
              mind ({notAssignedPresent.length})
            </button>
          )}
        </div>
      )}
      <div className="row wrap">
        <TextInput value={query} onChange={setQuery} placeholder="növendék keresése" ariaLabel="Résztvevő keresése" width={200} />
        <Select ariaLabel="Osztály" value={classId} onChange={setClassId} options={[{ value: '', label: classOptions.length > 0 ? 'osztály…' : 'nincs osztály' }, ...classOptions]} />
        <Button small disabled={!classId} onClick={addClass} title="Az osztály tagjai egyenként kerülnek a listába">
          + Osztály tagjai
        </Button>
        {value.length > 0 && (
          <Button small variant="ghost" onClick={() => props.onChange([])}>
            Mind törlése
          </Button>
        )}
      </div>
      {q.length >= 2 && (
        <div className="search-results">
          {results.length === 0 ? (
            <p className="muted small">Nincs találat.</p>
          ) : (
            results.map(([id, p]) => (
              <div key={id} className="row between search-result">
                <span>
                  {p.name} {!assigned.has(id) && <span className="muted small">(ideiglenes)</span>}
                </span>
                <Button
                  small
                  onClick={() => {
                    add([id])
                    setQuery('')
                  }}
                >
                  + Hozzáadás
                </Button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/** A FlightLogger-rész fejléce: a típus és a megadott mezők röviden. */
function theoryFlSummary(t: BookingRequest, bundle: DataBundle | null): string {
  const type = theoryTypeOf(t)
  const fl = t.flTheory ?? {}
  const parts: string[] = [`Típus: ${THEORY_TYPE_SHORT[type]}`]
  if (type === 'groundTraining') {
    if (t.classId) parts.push(bundle?.directory.classes[t.classId]?.name ?? 'osztály')
    if (fl.program) parts.push(fl.program)
    if (fl.subject) parts.push(fl.subject)
    if (fl.sessionType && fl.sessionType !== 'Ground lesson') parts.push(fl.sessionType)
    if (fl.session) parts.push(`„${fl.session}”`)
  }
  if (type === 'extraTheory' && fl.program) parts.push(fl.program)
  if (t.note) parts.push('komment megadva')
  return parts.join(' · ')
}

/** Ami a FlightLogger ablakában kellene, de az igényen nincs megadva (az import ezt kézzel kéri). */
function theoryFlMissing(t: BookingRequest): string[] {
  const type = theoryTypeOf(t)
  const fl = t.flTheory ?? {}
  if (type === 'groundTraining') return [!fl.program && 'program', !fl.subject && 'tárgy', !fl.session && 'Session'].filter((x): x is string => !!x)
  if (type === 'extraTheory') return fl.program ? [] : ['program']
  return []
}
