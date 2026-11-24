import { addExtraRequest, dismissWatch, removeExtraRequest, undeferRequest, type WeekPlan } from '@core/draft/weekPlan'
import { CAPACITY_DISMISSAL_ID } from '@core/engine/openings'
import { watchWeatherText, type WatchCapacity } from '@core/engine/weekWatch'
import type { BookingRequest } from '@core/model/planning'
import { useEffect, useState } from 'react'
import { personName, resolveText, timeOf } from '../format'
import type { OpeningsList, OpeningView, StudentOpeningsView, TrialView } from '../openingsSession'
import { useApp } from '../state'
import { Badge, Button, Dialog, Field, Select } from './ui'
import { slotLine, slotShort } from './weekWatch'

/**
 * „Van még hely?” (KIT-01–06): kérésre megmutatja, melyik növendék melyik feladata fér még be a
 * héten a mostani terv mellett. A növendék, azon belül a feladat legördülőből választható; a
 * kiválasztottra a próbaszámolás megmondja, hová kerülne, és ki mozdulna miatta. A felvett igény
 * rendes igény időpont nélkül, a kitöltő elsőbbséggel (a kézi igényeket nem szoríthatja ki);
 * halasztott igénynél csak a halasztás szűnik meg. A felvétel visszavonható, és utána a lista
 * újraszámol, mert a következő lehetőség helye már más lehet.
 */

/** A felvétel visszavonása (a tervet a mostani állapotából állítja vissza). */
interface Added {
  readonly message: string
  readonly undo: (plan: WeekPlan) => WeekPlan
}

export function OpeningsButton(props: {
  readonly small?: boolean
  /** Csak ennyi napra előre (a hét közbeni figyelés jelzéséből 2); alapból az egész hét. */
  readonly days?: number
  readonly label?: string
  readonly variant?: 'primary' | 'secondary'
}) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<Added | null>(null)
  // A visszavonás 10 másodpercig kínálkozik, ha az ablak már be van zárva.
  useEffect(() => {
    if (!added || open) return
    const timer = setTimeout(() => setAdded(null), 10_000)
    return () => clearTimeout(timer)
  }, [added, open])
  const undo = (entry: Added): void => {
    app.updatePlan(entry.undo)
    setAdded(null)
  }
  return (
    <>
      <Button
        {...(props.small ? { small: true } : {})}
        {...(props.variant ? { variant: props.variant } : {})}
        onClick={() => setOpen(true)}
        disabled={!app.result}
        title="Megkeresi, melyik növendék melyik feladata fér még be a héten a mostani terv mellett (a kézi igényeidet nem szorítja ki)"
      >
        {props.label ?? 'Van még hely?'}
      </Button>
      {open && <OpeningsDialog {...(props.days !== undefined ? { days: props.days } : {})} added={added} onAdded={setAdded} onUndo={undo} onClose={() => setOpen(false)} />}
      {!open && added && (
        <div className="toast" role="status">
          <span>{added.message}</span>
          <button type="button" className="link" onClick={() => undo(added)}>
            Visszavonás
          </button>
          <button type="button" className="chip-x" aria-label="Bezárás" onClick={() => setAdded(null)}>
            ×
          </button>
        </div>
      )}
    </>
  )
}

type Trial = { readonly state: 'loading' } | { readonly state: 'done'; readonly trial: TrialView } | { readonly state: 'error'; readonly message: string }

function OpeningsDialog(props: { readonly days?: number; readonly added: Added | null; readonly onAdded: (a: Added) => void; readonly onUndo: (a: Added) => void; readonly onClose: () => void }) {
  const app = useApp()
  const { bundle, settings, result, timezone, weekPlan, findOpenings, trialOpening } = app
  // A lista a tervhez tartozik, amelyre készült: új terv után (például felvétel) újra kell keresni.
  const [found, setFound] = useState<{ readonly list: OpeningsList; readonly for: unknown } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [studentId, setStudentId] = useState<string | null>(null)
  const [key, setKey] = useState<string | null>(null)

  // KIT-06: nyitott dilemmánál a szabad hely a döntéseken múlik (a standby-ajánlás elhagyható).
  const days = props.days
  const span = days !== undefined ? `a következő ${days} napban` : 'a héten'
  const openDilemmas = result?.dilemmas.filter((d) => d.type !== 'standby').length ?? 0

  // Keresés a kész tervhez; új terv (például felvétel után) új keresést indít.
  useEffect(() => {
    if (!result || openDilemmas > 0) return
    let cancelled = false
    findOpenings(days !== undefined ? { days } : undefined).then(
      (l) => {
        if (cancelled || !l) return
        setFound({ list: l, for: result })
        setError(null)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [result, openDilemmas, findOpenings, days])

  const list = found && found.for === result ? found.list : null
  const students = list?.students ?? []
  const student: StudentOpeningsView | undefined = students.find((s) => s.studentId === studentId) ?? students[0]
  const option: OpeningView | undefined = student?.options.find((o) => o.key === key) ?? student?.options[0]

  // Próbaszámolás a kiválasztott lehetőségre (KIT-04), a háttérszálon; az eredmény a lehetőséghez tartozik.
  const token = list?.token
  const optionStudent = student?.studentId
  const optionKey = option?.key
  const trialKey = token !== undefined && optionStudent && optionKey ? `${token}|${optionStudent}|${optionKey}` : null
  const presetTrial = option?.trial
  const [computed, setComputed] = useState<{ readonly key: string; readonly trial: Trial } | null>(null)
  useEffect(() => {
    if (token === undefined || !optionStudent || !optionKey || presetTrial) return
    const k = `${token}|${optionStudent}|${optionKey}`
    let cancelled = false
    trialOpening(token, optionStudent, optionKey).then(
      (t) => {
        if (!cancelled) setComputed({ key: k, trial: { state: 'done', trial: t } })
      },
      (e: unknown) => {
        if (!cancelled) setComputed({ key: k, trial: { state: 'error', message: e instanceof Error ? e.message : String(e) } })
      },
    )
    return () => {
      cancelled = true
    }
  }, [token, optionStudent, optionKey, presetTrial, trialOpening])
  const trial: Trial | null = !trialKey ? null : presetTrial ? { state: 'done', trial: presetTrial } : computed?.key === trialKey ? computed.trial : { state: 'loading' }

  if (!settings || !weekPlan) return null
  const catalog = bundle?.directory.lectures ?? {}
  const requests = weekPlan.requests
  const nameOf = (id: string): string => personName(bundle, id)
  const requestName = (id: string, extra?: BookingRequest): string => {
    const r = requests.find((x) => x.id === id) ?? (extra?.id === id ? extra : undefined)
    const who = r?.studentIds.map(nameOf).join(', ') ?? 'törölt igény'
    const lecture = r?.lectureId ? catalog[r.lectureId]?.name : undefined
    return lecture ? `${who} (${lecture})` : who
  }
  const lectureName = (r: BookingRequest): string | undefined => (r.lectureId ? catalog[r.lectureId]?.name : undefined)
  const optionLabel = (o: OpeningView): string => {
    const name = lectureName(o.request)
    const where = slotShort(o.best, timezone)
    switch (o.kind) {
      case 'restore':
        return `Halasztott igény visszahozása${name ? `: ${name}` : ''} (${where})`
      case 'default':
        if (o.request.taskSelectionMode === 'automatic') return `⟳ Automatikus${name ? `: ${name}` : ' (feladat nélkül)'} (${where})`
        return `${name ?? 'Feladat nélkül'} – soron következő (${where})`
      case 'lecture':
        return `${name ?? 'Feladat'} (${where})`
      case 'none':
        return `Feladat nélkül (${where})`
    }
  }
  const studentLabel = (s: StudentOpeningsView): string => {
    const restore = s.options.some((o) => o.kind === 'restore')
    const count = restore ? 'halasztott igény' : `${s.options.length} lehetőség`
    return `${nameOf(s.studentId)} – ${count}${s.missingAvailability ? ' · nincs megadott ráérés' : ''}`
  }

  const done = trial?.state === 'done' ? trial.trial : undefined
  const canAdd = option !== undefined && done?.ok === true && !app.planning

  const add = (): void => {
    if (!option || !done?.placed) return
    const where = slotLine(done.placed.slot, bundle, timezone)
    const who = nameOf(option.request.studentIds[0] ?? '')
    if (option.kind === 'restore') {
      const id = option.request.id
      const removed = undeferRequest(weekPlan, id).removed
      app.updatePlan((p) => undeferRequest(p, id).plan)
      props.onAdded({
        message: `Visszakerült: ${who}, ${where}`,
        undo: (p) => ({ ...p, decisions: [...p.decisions, ...removed.filter((d) => !p.decisions.some((x) => x.kind === 'defer' && x.requestId === d.requestId))] }),
      })
    } else {
      const request = option.request
      const deselect = request.studentIds.filter((id) => !weekPlan.selectedStudentIds.includes(id))
      app.updatePlan((p) => (p.requests.some((r) => r.id === request.id) ? p : addExtraRequest(p, request)))
      props.onAdded({ message: `Bekerült: ${who}, ${where}`, undo: (p) => removeExtraRequest(p, request.id, deselect) })
    }
    setKey(null)
  }

  return (
    <Dialog
      title={days !== undefined ? `Van még hely a következő ${days} napban?` : 'Van még hely?'}
      className="dialog-openings"
      onClose={props.onClose}
      actions={
        <>
          <Button variant="ghost" onClick={props.onClose}>
            Bezárás
          </Button>
          {openDilemmas === 0 && (
            <Button variant="primary" onClick={add} disabled={!canAdd} title={canAdd ? 'Rendes igényként kerül be, időpont nélkül; a motor helyezi el' : 'Csak az vehető fel, ami mellékhatás nélkül befér'}>
              {option?.kind === 'restore' ? 'Visszahozás' : 'Felvétel'}
            </Button>
          )}
        </>
      }
    >
      {openDilemmas > 0 ? (
        <>
          <p>
            Előbb döntsd el a nyitott dilemmákat (<strong>{openDilemmas}</strong>): hogy hol van még hely, az a döntéseiden múlik.
          </p>
          <div>
            <Button
              variant="primary"
              onClick={() => {
                props.onClose()
                app.navigate('dilemmas')
              }}
            >
              Dilemmák →
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            A mostani terv mellett ennyi fér még be {span} tiszta helyre (legalább 2 óra múlva, repülésnél repülhető időben). A felvett igény rendes igény időpont nélkül, {settings.defaults.fillRequestPriority}-es elsőbbséggel: a
            kézi igényeidet nem szoríthatja ki.
          </p>
          {props.added && (
            <div className="banner info row wrap" role="status">
              <span>{props.added.message}</span>
              <button type="button" className="link" onClick={() => props.onUndo(props.added!)}>
                Visszavonás
              </button>
            </div>
          )}
          {error ? (
            <p className="error-text">A keresés nem sikerült: {error}</p>
          ) : !list || app.planning ? (
            <p className="muted">Keresés…</p>
          ) : students.length === 0 ? (
            <p>Most egyik növendéked feladata sem fér be tiszta helyre {span}.</p>
          ) : (
            <>
              <Field label="Növendék">
                <Select
                  ariaLabel="Növendék"
                  value={student?.studentId ?? ''}
                  onChange={(v) => {
                    setStudentId(v)
                    setKey(null)
                  }}
                  options={students.map((s) => ({ value: s.studentId, label: studentLabel(s) }))}
                />
              </Field>
              {student && (
                <Field label="Feladat">
                  <Select ariaLabel="Feladat" value={option?.key ?? ''} onChange={setKey} options={student.options.map((o) => ({ value: o.key, label: optionLabel(o) }))} />
                </Field>
              )}
              {student?.missingAvailability && <p className="muted small">Nincs megadott ráérése a hétre: a motor szabadnak veszi, ezért a hely csak feltételes.</p>}
              {option && trialSummary(trial, option, (id) => requestName(id, option.request))}
            </>
          )}
        </>
      )}
    </Dialog>
  )

  function trialSummary(state: Trial | null, opening: OpeningView, nameOfRequest: (id: string) => string) {
    if (!state || state.state === 'loading') return <p className="muted">Próbaszámolás…</p>
    if (state.state === 'error') return <p className="error-text">{state.message}</p>
    const p = { option: opening, requestName: nameOfRequest }
    const t = state.trial
    const weather = p.option.weather && p.option.weather !== 'flyable' ? watchWeatherText(p.option.weather) : undefined
    return (
      <div className="openings-trial">
        {t.placed ? (
          <p>
            <strong>Ide kerülne:</strong> {slotLine(t.placed.slot, bundle, timezone)}
            {t.placed.slot.flightStart && <span className="muted"> (gépidő kezdete: {timeOf(t.placed.slot.flightStart, timezone)})</span>}
            {weather && (
              <>
                {' '}
                <Badge tone="warn">idő: {weather}</Badge>
              </>
            )}
            {t.ok && t.moved.length === 0 && <span className="muted"> · más nem változik</span>}
          </p>
        ) : (
          <p>
            <strong>Nem kerülne be tisztán</strong> (csak dilemmával vagy jóváhagyandó figyelmeztetéssel).
          </p>
        )}
        {t.moved.length > 0 && (
          <div>
            <span className="muted small">Máshová kerülne a tervben:</span>
            <ul>
              {t.moved.map((m) => (
                <li key={m.requestId}>
                  {p.requestName(m.requestId)}: {slotShort(m.from, timezone)} → {slotShort(m.to, timezone)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {t.displaced.length > 0 && (
          <p>
            <strong>Kiszorulna:</strong> {t.displaced.map(p.requestName).join(', ')}
          </p>
        )}
        {t.newDilemmas.length > 0 && (
          <div>
            <strong>Új dilemma keletkezne:</strong>
            <ul>
              {t.newDilemmas.map((d) => (
                <li key={d.id}>{resolveText(d.headline ?? d.question, bundle, [...requests, p.option.request])}</li>
              ))}
            </ul>
          </div>
        )}
        {!t.ok && <p className="muted small">Ezt nem ajánlom felvenni: csak mellékhatással férne be. Ha mégis kell, a Heti igényeken kézzel veheted fel.</p>}
      </div>
    )
  }
}

/**
 * A hét közbeni figyelés „van még hely” jelzése (KIT-07): egyetlen összefoglaló a következő napokra,
 * a visszahozható halasztott igényeket visszahozottnak véve. A „Megnézem” ugyanazt az ablakot
 * nyitja, a napokra szűkítve; a „Most nem” aznapra elhallgattatja.
 */
export function CapacityNotice(props: { readonly capacity: WatchCapacity }) {
  const app = useApp()
  const { capacity } = props
  const names = capacity.students.map((s) => personName(app.bundle, s.studentId))
  const listed = names.length > 4 ? `${names.slice(0, 4).join(', ')} és még ${names.length - 4}` : names.join(', ')
  return (
    <div className="banner info row wrap capacity-notice" role="status">
      <span>
        <strong>Van még hely:</strong> a következő {capacity.days} napban még {capacity.students.length} növendékednek férne be repülés vagy szimulátor ({listed}).
      </span>
      <span className="row">
        <OpeningsButton small variant="primary" days={capacity.days} label="Megnézem" />
        <Button
          small
          variant="ghost"
          title="Ma nem szól újra; holnap ismét keres"
          onClick={() => app.updatePlan((p) => dismissWatch(p, CAPACITY_DISMISSAL_ID, 'capacity', capacity.dismissFrom, new Date().toISOString()))}
        >
          Most nem
        </Button>
      </span>
    </div>
  )
}

