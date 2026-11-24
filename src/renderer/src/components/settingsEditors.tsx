import { lookupAirport } from '@core/airports/lookup'
import { DEFAULT_MINIMA_SOURCE, DEFAULT_OPENING_HOURS, DEFAULT_SCHOOL_MINIMA, defaultLimitRules } from '@core/config/defaults'
import { aircraftChoice, aircraftTypesOf, capacityFromName, importAircraftOrder, moveAircraft, orderFleet, placeAircraft, resetAircraftOrder, setAircraftChoice, type AircraftChoice } from '@core/config/operations'
import { removeRunway, updateRunway } from '@core/config/runways'
import type { Settings } from '@core/config/schema'
import { matchingWeatherPreset, TM_UNCHECKED_RULES, TM_WEATHER_PRESETS, TRAINING_PHASES, type TrainingPhase } from '@core/config/trainingManual'
import { METRIC_LABELS, windowLabel } from '@core/limits/labels'
import type { LimitRule } from '@core/model/limits'
import { CRITERIA, CRITERION_HINTS, CRITERION_LABELS } from '@core/model/criteria'
import type { DataBundle } from '@core/model/dataBundle'
import type { StudentSettings } from '@core/model/people'
import { MAINTENANCE_TYPES, type FleetEntry } from '@core/model/resources'
import { WEEKDAYS, WEEKDAY_LABELS, type Weekday } from '@core/model/time'
import type { WeatherLimits } from '@core/model/weather'
import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { api } from '../bridge'
import { BlockedPeriodsEditor } from './blockedPeriods'
import { studentProgress, syllabusLabel } from '../progress'
import { Badge, Button, DateInput, Field, NumberInput, Select, TextInput } from './ui'

/** A beállítások szerkesztői (SZB-11): az első beállítás és a Beállítások oldal közösen használja. */

type Props = { readonly settings: Settings; readonly onChange: (s: Settings) => void }
type Windows = NonNullable<Settings['airport']>['openingHours']

export function WeeklyWindowsEditor(props: { value: Windows; onChange: (v: Windows) => void; closedLabel?: string }) {
  return (
    <table className="table compact">
      <thead>
        <tr>
          <th>Nap</th>
          <th>Nyitva</th>
          <th>Kezdet</th>
          <th>Vége</th>
        </tr>
      </thead>
      <tbody>
        {WEEKDAYS.map((d: Weekday) => {
          const w = props.value[d]
          return (
            <tr key={d}>
              <td>{WEEKDAY_LABELS[d]}</td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${WEEKDAY_LABELS[d]} nyitva`}
                  checked={w !== null}
                  onChange={(e) => props.onChange({ ...props.value, [d]: e.target.checked ? { start: '08:00', end: '16:00' } : null })}
                />
              </td>
              <td>
                {w ? <input type="time" className="input" value={w.start} aria-label={`${WEEKDAY_LABELS[d]} kezdete`} onChange={(e) => props.onChange({ ...props.value, [d]: { ...w, start: e.target.value } })} /> : <span className="muted">{props.closedLabel ?? 'zárva'}</span>}
              </td>
              <td>{w && <input type="time" className="input" value={w.end} aria-label={`${WEEKDAY_LABELS[d]} vége`} onChange={(e) => props.onChange({ ...props.value, [d]: { ...w, end: e.target.value } })} />}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function AirportEditor({ settings, onChange }: Props) {
  const airport = settings.airport ?? {
    icaoCode: '',
    latitude: 0,
    longitude: 0,
    timezone: 'Europe/Budapest',
    runways: [{ designator: '', trueHeadingDeg: 0 }],
    openingHours: DEFAULT_OPENING_HOURS,
  }
  const set = (patch: Partial<typeof airport>): void => onChange({ ...settings, airport: { ...airport, ...patch } })
  const [lookupMessage, setLookupMessage] = useState<{ ok: boolean; text: string } | null>(null)

  /**
   * Kitöltés a beépített repülőtérlistából. A pályákat csak akkor írja felül, ha még nincs
   * megadva egy sem, vagy ha az oktató kifejezetten kéri (`replaceRunways`).
   */
  const fillFromList = async (code: string, base: typeof airport, replaceRunways: boolean): Promise<void> => {
    const found = await lookupAirport(code)
    if (!found) {
      setLookupMessage({ ok: false, text: `A(z) ${code} kód nincs a beépített listában; a koordinátát és a pályákat add meg kézzel.` })
      return
    }
    const hasRunways = base.runways.some((r) => r.designator !== '')
    const runways = found.runways.length > 0 && (replaceRunways || !hasRunways) ? [...found.runways] : base.runways
    onChange({ ...settings, airport: { ...base, icaoCode: found.icaoCode, latitude: found.latitude, longitude: found.longitude, runways } })
    const parts = [`Koordináta kitöltve: ${found.latitude.toFixed(4)}, ${found.longitude.toFixed(4)}.`]
    if (runways !== base.runways) parts.push(`Pályák: ${found.runways.map((r) => `${r.designator} (${r.trueHeadingDeg}°)`).join(', ')}.`)
    else if (found.runways.length > 0) parts.push('A meglévő pályákat nem írtam felül.')
    else parts.push('A listában nincs pályaadat, add meg kézzel.')
    if (found.headingsEstimated) parts.push('Néhány irány csak a pályajelből becsült (mágneses) – ellenőrizd.')
    setLookupMessage({ ok: true, text: parts.join(' ') })
  }

  return (
    <div className="stack">
      <div className="grid-4">
        <Field label="ICAO-kód" hint="Négy betű beírásakor a koordináta és a pályák a beépített OurAirports-listából töltődnek ki.">
          <TextInput
            value={airport.icaoCode}
            onChange={(v) => {
              const code = v.toUpperCase().trim()
              set({ icaoCode: code })
              setLookupMessage(null)
              if (/^[A-Z]{4}$/.test(code) && code !== airport.icaoCode) void fillFromList(code, { ...airport, icaoCode: code }, false)
            }}
            placeholder="LHXX"
          />
        </Field>
        <Field label="Szélesség (fok)">
          <NumberInput value={airport.latitude} step={0.0001} onChange={(v) => set({ latitude: v ?? 0 })} />
        </Field>
        <Field label="Hosszúság (fok)">
          <NumberInput value={airport.longitude} step={0.0001} onChange={(v) => set({ longitude: v ?? 0 })} />
        </Field>
        <Field label="Időzóna">
          <TextInput value={airport.timezone} onChange={(v) => set({ timezone: v })} />
        </Field>
      </div>
      {lookupMessage && <p className={lookupMessage.ok ? 'ok-text' : 'error-text'}>{lookupMessage.text}</p>}
      {/^[A-Z]{4}$/.test(airport.icaoCode) && (
        <div className="row">
          <Button small onClick={() => void fillFromList(airport.icaoCode, airport, true)} title="A koordinátát és a pályákat a beépített listából tölti ki, a meglévő pályák helyére">
            Kitöltés a listából (pályákkal együtt)
          </Button>
        </div>
      )}
      <Field label="Pályairányok" hint="Egy irányt elég megadni: az ellentétes irány (például 04 → 22) a valós irányával együtt magától kitöltődik. Valós (földrajzi) irány kell: a mágneses irányhoz add hozzá a mágneses elhajlást, mert az Open-Meteo szélirány is valós.">
        <table className="table compact">
          <thead>
            <tr>
              <th>Pályajel</th>
              <th>Valós irány (fok)</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {airport.runways.map((r, i) => (
              <tr key={i}>
                <td>
                  <TextInput width={80} ariaLabel="Pályajel" value={r.designator} onChange={(v) => set({ runways: updateRunway(airport.runways, i, { designator: v.toUpperCase().trim() }) })} />
                </td>
                <td>
                  <NumberInput width={90} ariaLabel="Valós irány" value={r.trueHeadingDeg} min={0} max={359.9} step={1} onChange={(v) => v !== undefined && v >= 0 && v < 360 && set({ runways: updateRunway(airport.runways, i, { trueHeadingDeg: v }) })} />
                </td>
                <td>
                  <Button small variant="ghost" onClick={() => set({ runways: removeRunway(airport.runways, i) })} title="A pályairányt és az ellentétes párját törli">
                    Törlés
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Button small onClick={() => set({ runways: [...airport.runways, { designator: '', trueHeadingDeg: 0 }] })}>
          + Pálya
        </Button>
      </Field>
      <Field label="Nyitvatartás">
        <WeeklyWindowsEditor value={airport.openingHours} onChange={(v) => set({ openingHours: v })} />
      </Field>
    </div>
  )
}

export function WorkTimeEditor({ settings, onChange }: Props) {
  const instructor = settings.instructor
  return (
    <div className="stack">
      <Field label="Heti munkaidő-ablak" hint="A motor csak a nyitvatartás és a munkaidő metszetébe tesz foglalást.">
        <WeeklyWindowsEditor value={instructor.workWindows} closedLabel="nem dolgozik" onChange={(v) => onChange({ ...settings, instructor: { ...instructor, workWindows: v } })} />
      </Field>
      {/* Nem <label>: a sok gomb közül a címkére kattintás az elsőt (törlést) indítaná. */}
      <div className="field" role="group" aria-labelledby="tiltott-idoszakok">
        <span className="field-label" id="tiltott-idoszakok">
          Tiltott időszakok
        </span>
        <span className="field-hint">Amikor nem érsz rá: egyetem, orvos, szabadság.</span>
        <BlockedPeriodsEditor settings={settings} onChange={onChange} />
      </div>
    </div>
  )
}

/**
 * A gépek sorrendje (ERF-01). A FlightLogger API nem adja ki a foglalási oldal kézi
 * sorrendjét, ezért a géplista onnan kimásolva ide illeszthető, vagy gépenként mozgatható.
 */
function AircraftOrderImport(props: Props & { fleet: readonly FleetEntry[] }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const apply = (): void => {
    const result = importAircraftOrder(props.settings, props.fleet, text)
    if (result.found === 0) {
      setMessage({ ok: false, text: 'A szövegben nem találtam egyetlen lajstromot sem.' })
      return
    }
    props.onChange(result.settings)
    setText('')
    setMessage({ ok: true, text: `${result.found} gép sorrendje beállítva.${result.missing.length > 0 ? ` Nem szerepelt a szövegben (a végére kerültek): ${result.missing.join(', ')}.` : ''}` })
  }
  return (
    <details className="order-import">
      <summary>Sorrend a FlightLogger foglalási oldaláról{props.settings.aircraftOrder ? ' (saját sorrend beállítva)' : ''}</summary>
      <div className="stack-tight">
        <span className="field-hint">
          A FlightLogger API nem adja ki a gépek kézi sorrendjét. A Bookings oldalon jelöld ki egérrel a bal oldali géplistát (az első lajstromtól az utolsóig), másold ki, és illeszd be ide. Egyenként a táblázatban is mozgathatod a gépeket: a ⠿ fogantyúval húzva, vagy a ▲▼ gombokkal.
        </span>
        <textarea className="input" rows={4} aria-label="Kimásolt géplista" placeholder="HA-XXX CESSNA 152&#10;HA-YYY PIPER P28A&#10;…" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <Button small variant="primary" disabled={text.trim() === ''} onClick={apply}>
            Sorrend átvétele
          </Button>
          {props.settings.aircraftOrder && (
            <Button
              small
              onClick={() => {
                props.onChange(resetAircraftOrder(props.settings))
                setMessage(null)
              }}
            >
              Alapsorrend (típus, majd lajstrom)
            </Button>
          )}
        </div>
        {message && <span className={message.ok ? 'ok-text small' : 'error-text small'}>{message.text}</span>}
      </div>
    </details>
  )
}

export function ResourcesEditor({ settings, onChange, bundle, detailed }: Props & { bundle: DataBundle | null; detailed?: boolean }) {
  const fleet = orderFleet(bundle?.snapshot.fleet ?? [], settings.aircraftOrder)
  // Sorrend húzással (ERF-01): a fogantyúval megfogott gép a sorok közé ejthető. Mutató-
  // eseményekkel (mint a Tervezet idővonalán), így egérrel és érintéssel is működik.
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ readonly index: number; readonly after: boolean } | null>(null)
  const endDrag = (): void => {
    setDragId(null)
    setDropAt(null)
  }
  const dragOver = (e: ReactPointerEvent): void => {
    if (!dragId) return
    // A táblázatsort a böngésző nem adja vissza találatként, csak a celláját.
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('tr[data-aircraft-index]')
    if (!row) return
    const index = Number(row.dataset['aircraftIndex'])
    const box = row.getBoundingClientRect()
    const after = e.clientY > box.top + box.height / 2
    if (dropAt?.index !== index || dropAt.after !== after) setDropAt({ index, after })
  }
  const drop = (): void => {
    const from = fleet.findIndex((a) => a.id === dragId)
    if (dragId && from >= 0 && dropAt) {
      const slot = dropAt.index + (dropAt.after ? 1 : 0)
      onChange(placeAircraft(settings, fleet, dragId, slot > from ? slot - 1 : slot))
    }
    endDrag()
  }
  const types = aircraftTypesOf(fleet.filter((a) => (settings.resources[a.id]?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')) === 'aircraft'))
  const setTypeRunUp = (type: string, v: number | undefined): void => {
    const aircraftTypes = { ...settings.aircraftTypes }
    if (v === undefined) delete aircraftTypes[type]
    else aircraftTypes[type] = { engineRunUpMinutes: v }
    onChange({ ...settings, aircraftTypes })
  }
  return (
    <div className="stack">
      <p className="muted">A géptípust a FlightLogger adja (például PIPER P28A); a növendékeknél géptípusra vagy egyedi gépre lehet engedélyt és preferenciát adni.</p>
      {fleet.length > 0 && <AircraftOrderImport settings={settings} onChange={onChange} fleet={fleet} />}
      {fleet.length === 0 ? (
        <p className="muted">A gépek listája az adatok betöltése után jelenik meg.</p>
      ) : (
        <div className="table-scroll">
          <table className="table">
            <thead>
              <tr>
                <th>Sorrend</th>
                <th>Gép</th>
                <th>Géptípus</th>
                <th>Besorolás</th>
                {detailed && (
                  <>
                    <th>Motorpróba (perc)</th>
                    <th>Fordulóidő (perc)</th>
                    <th>Biztonsági puffer (óra)</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {fleet.map((a, index) => {
                const r = settings.resources[a.id]
                const kind = r?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')
                const set = (patch: Partial<NonNullable<typeof r>>): void => onChange({ ...settings, resources: { ...settings.resources, [a.id]: { kind, ...r, ...patch } } })
                const typeRunUp = settings.aircraftTypes[a.model]?.engineRunUpMinutes ?? settings.defaults.engineRunUpMinutes
                const rowClass = [
                  a.disabled ? 'muted' : '',
                  dragId === a.id ? 'dragging' : '',
                  dragId && dragId !== a.id && dropAt?.index === index ? (dropAt.after ? 'drop-after' : 'drop-before') : '',
                ]
                  .filter(Boolean)
                  .join(' ')
                return (
                  <tr key={a.id} className={rowClass || undefined} data-aircraft-index={index}>
                    <td className="nowrap">
                      <span
                        className="drag-handle"
                        role="img"
                        aria-label={`${a.callSign} húzással mozgatható`}
                        title="Húzd a kívánt helyre (vagy használd a ▲▼ gombokat)"
                        onPointerDown={(e) => {
                          if (e.button !== 0) return
                          e.preventDefault()
                          e.currentTarget.setPointerCapture(e.pointerId)
                          setDragId(a.id)
                          setDropAt(null)
                        }}
                        onPointerMove={dragOver}
                        onPointerUp={drop}
                        onPointerCancel={endDrag}
                      >
                        ⠿
                      </span>
                      <Button small variant="ghost" disabled={index === 0} onClick={() => onChange(moveAircraft(settings, fleet, a.id, -1))} title={`${a.callSign} feljebb`}>
                        ▲
                      </Button>
                      <Button small variant="ghost" disabled={index === fleet.length - 1} onClick={() => onChange(moveAircraft(settings, fleet, a.id, 1))} title={`${a.callSign} lejjebb`}>
                        ▼
                      </Button>
                    </td>
                    <td>
                      {a.callSign} {!r && <Badge tone="info">új</Badge>}
                    </td>
                    <td>{a.model}</td>
                    <td>
                      <Select ariaLabel={`${a.callSign} besorolása`} value={kind} onChange={(v) => set({ kind: v })} options={[{ value: 'aircraft', label: 'Repülőgép' }, { value: 'simulator', label: 'Szimulátor' }]} />
                    </td>
                    {detailed && (
                      <>
                        <td>
                          <NumberInput width={80} ariaLabel="Motorpróba" value={r?.engineRunUpMinutes} placeholder={String(typeRunUp)} onChange={(v) => set(v === undefined ? omit(r, 'engineRunUpMinutes') : { engineRunUpMinutes: v })} />
                        </td>
                        <td>
                          <NumberInput width={80} ariaLabel="Fordulóidő" value={r?.turnaroundMinutes} placeholder={String(settings.defaults.turnaroundMinutes)} onChange={(v) => set(v === undefined ? omit(r, 'turnaroundMinutes') : { turnaroundMinutes: v })} />
                        </td>
                        <td>
                          <NumberInput width={80} ariaLabel={`${a.callSign} biztonsági puffere`} step={0.5} value={r?.minReserveHours} placeholder={String(settings.defaults.minReserveHours)} onChange={(v) => set(v === undefined ? omit(r, 'minReserveHours') : { minReserveHours: v })} />
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {detailed && types.length > 0 && (
        <Field label="Motorpróba és körüljárás géptípusonként" hint="Üresen a globális alapérték érvényes; a gépnél megadott érték felülírja.">
          <table className="table compact">
            <tbody>
              {types.map((t) => (
                <tr key={t}>
                  <td>{t}</td>
                  <td>
                    <NumberInput width={80} ariaLabel={`${t} motorpróba`} value={settings.aircraftTypes[t]?.engineRunUpMinutes} placeholder={String(settings.defaults.engineRunUpMinutes)} onChange={(v) => setTypeRunUp(t, v)} />
                  </td>
                  <td className="muted">perc</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Field>
      )}
    </div>
  )
}

function omit<T extends object, K extends keyof T>(obj: T | undefined, key: K): Partial<T> {
  if (!obj) return {}
  const { [key]: _removed, ...rest } = obj
  return rest as Partial<T>
}

export function ClassroomsEditor({ settings, onChange, bundle }: Props & { bundle: DataBundle | null }) {
  const ids = bundle?.snapshot.classroomIds ?? Object.keys(settings.classrooms)
  if (ids.length === 0) return <p className="muted">A termek listája az adatok betöltése után jelenik meg.</p>
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Terem</th>
          <th>Férőhely</th>
          <th>Preferencia (1 = legjobb)</th>
        </tr>
      </thead>
      <tbody>
        {ids.map((id) => {
          const c = settings.classrooms[id]
          return (
            <tr key={id}>
              <td>{bundle?.directory.classrooms[id] ?? id}</td>
              <td>
                <NumberInput
                  width={90}
                  ariaLabel="Férőhely"
                  min={1}
                  value={c?.capacity}
                  placeholder={String(capacityFromName(bundle?.directory.classrooms[id] ?? ''))}
                  onChange={(v) => {
                    const classrooms = { ...settings.classrooms }
                    if (v === undefined) delete classrooms[id]
                    else classrooms[id] = { capacity: v, preferenceRank: c?.preferenceRank ?? 1 }
                    onChange({ ...settings, classrooms })
                  }}
                />
              </td>
              <td>
                <NumberInput width={90} ariaLabel="Preferencia" min={1} max={10} value={c?.preferenceRank} onChange={(v) => c && onChange({ ...settings, classrooms: { ...settings.classrooms, [id]: { ...c, preferenceRank: v ?? 1 } } })} />
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

const CHOICE_LABELS: Record<AircraftChoice, string> = { none: 'nincs', allowed: 'engedélyezett', preferred: 'preferált' }
const NEXT_CHOICE: Record<AircraftChoice, AircraftChoice> = { none: 'allowed', allowed: 'preferred', preferred: 'none' }

/**
 * Gépválasztó (NOV-03, NOV-04): egyetlen lista géptípusonként. Egy lajstromra kattintva
 * nincs → engedélyezett → preferált; a típus gombjai a típus összes lajstromát állítják.
 */
function AircraftChoicePicker(props: { fleet: readonly FleetEntry[]; student: StudentSettings; onChange: (s: StudentSettings) => void }) {
  const { fleet, student } = props
  const set = (ids: readonly string[], choice: AircraftChoice): void => props.onChange(setAircraftChoice(student, fleet, ids, choice))
  // A beállított gépsorrendben: a típusok az első gépük helyén, a lajstromok a sorrendjükben.
  const groups = [...new Set(fleet.map((a) => a.model))].map((type) => ({ type, aircraft: fleet.filter((a) => a.model === type) }))
  return (
    <div className="ref-picker">
      <span className="field-label">Gépek</span>
      {fleet.length === 0 ? (
        <span className="muted small">A gépek az adatok betöltése után jelennek meg.</span>
      ) : (
        <div className="aircraft-groups">
          {groups.map((g) => {
            const choices = g.aircraft.map((a) => aircraftChoice(student, a))
            const uniform = choices.every((c) => c === choices[0]) ? choices[0] : undefined
            return (
              <div key={g.type} className="aircraft-group">
                <div className="aircraft-group-head">
                  <strong>{g.type}</strong>
                  <div className="segmented" role="group" aria-label={`${g.type}: a típus összes lajstroma`}>
                    {(['none', 'allowed', 'preferred'] as const).map((c) => (
                      <button key={c} type="button" className={uniform === c ? 'active' : undefined} aria-pressed={uniform === c} onClick={() => set(g.aircraft.map((a) => a.id), c)}>
                        {c === 'none' ? 'egyik sem' : c === 'allowed' ? 'mind engedélyezett' : 'mind preferált'}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row wrap">
                  {g.aircraft.map((a, i) => {
                    const c = choices[i]!
                    return (
                      <button
                        key={a.id}
                        type="button"
                        className={`aircraft-chip ${c}`}
                        aria-label={`${a.callSign}: ${CHOICE_LABELS[c]}`}
                        title={`${CHOICE_LABELS[c]} – kattintásra: ${CHOICE_LABELS[NEXT_CHOICE[c]]}`}
                        onClick={() => set([a.id], NEXT_CHOICE[c])}
                      >
                        {c === 'preferred' ? '★ ' : c === 'allowed' ? '✓ ' : ''}
                        {a.callSign}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
      <span className="field-hint">Kattintás egy lajstromra: nincs → engedélyezett (✓) → preferált (★). A preferált gép egyben engedélyezett is; a motor előnyben részesíti, de nem kizáró.</span>
    </div>
  )
}

/**
 * Növendékek (NOV-01–08, NOV-12). A keresés találatai külön listában jelennek meg, a már
 * hozzárendelt növendékek alatta; egy találat a „Hozzáadás” gombbal kerül át.
 */
export function StudentsEditor({ settings, onChange, bundle, detailed }: Props & { bundle: DataBundle | null; detailed?: boolean }) {
  const [query, setQuery] = useState('')
  const people = bundle?.directory.people ?? {}
  const assigned = new Set(settings.students.map((s) => s.userId))
  const q = query.trim().toLowerCase()
  const results =
    q.length >= 2
      ? Object.entries(people)
          .filter(([id, p]) => p.role === 'student' && !assigned.has(id) && p.name.toLowerCase().includes(q))
          .sort(([, a], [, b]) => a.name.localeCompare(b.name, 'hu'))
          .slice(0, 30)
      : []
  const fleet = orderFleet(bundle?.snapshot.fleet ?? [], settings.aircraftOrder).filter((a) => !a.disabled && (settings.resources[a.id]?.kind ?? (a.aircraftClass === 'SIMULATOR' ? 'simulator' : 'aircraft')) === 'aircraft')
  const update = (userId: string, patch: Partial<Settings['students'][number]>): void =>
    onChange({ ...settings, students: settings.students.map((s) => (s.userId === userId ? stripUndefined({ ...s, ...patch }) : s)) })
  const add = (id: string): void => {
    onChange({ ...settings, students: [...settings.students, { userId: id, allowedResources: [] }] })
    setQuery('')
  }
  const name = (id: string): string => people[id]?.name ?? `#${id}`
  const students = [...settings.students].sort((a, b) => name(a.userId).localeCompare(name(b.userId), 'hu'))

  return (
    <div className="stack">
      <Field label="Növendék keresése" hint="Legalább két betű. A név csak memóriában van, a beállítási fájlba csak az azonosító kerül.">
        <TextInput value={query} onChange={setQuery} placeholder="név" ariaLabel="Növendék keresése" />
      </Field>
      {Object.keys(people).length === 0 && <p className="muted">A növendékek listája az adatok betöltése után jelenik meg.</p>}
      {q.length >= 2 && (
        <div className="search-results" role="listbox" aria-label="Keresési találatok">
          {results.length === 0 ? (
            <p className="muted small">Nincs (még hozzá nem rendelt) találat.</p>
          ) : (
            results.map(([id, p]) => (
              <div key={id} className="row between search-result">
                <span>{p.name}</span>
                <Button small onClick={() => add(id)}>
                  + Hozzáadás
                </Button>
              </div>
            ))
          )}
        </div>
      )}
      {detailed && <SyllabusFolderInfo bundle={bundle} />}
      <h4>Hozzárendelt növendékek ({students.length})</h4>
      {students.length === 0 && <p className="muted">Még nincs hozzárendelt növendék; keress rá névre fent.</p>}
      <div className="student-list">
        {students.map((st) => (
          <StudentRow
            key={st.userId}
            settings={settings}
            bundle={bundle}
            st={st}
            name={name(st.userId)}
            fleet={fleet}
            detailed={!!detailed}
            update={update}
            onRemove={() => onChange({ ...settings, students: settings.students.filter((s) => s.userId !== st.userId) })}
          />
        ))}
      </div>
    </div>
  )
}

/** A betöltött feladatsorok és a saját mappa (SZB-02). */
function SyllabusFolderInfo(props: { bundle: DataBundle | null }) {
  const [folder, setFolder] = useState<string | null>(null)
  const syllabi = props.bundle?.syllabi ?? []
  return (
    <div className="stack-tight">
      <span className="field-label">Feladatsorok (revíziók)</span>
      {syllabi.length === 0 ? (
        <span className="muted small">Nincs betöltött feladatsor. Az adatok betöltése után jelennek meg.</span>
      ) : (
        <span className="small">
          {syllabi.map((s) => `${s.program} – ${s.revision} (${s.tasks.length} feladat)`).join(' · ')}
        </span>
      )}
      {(props.bundle?.syllabusErrors ?? []).map((e) => (
        <span key={e} className="error-text small">
          {e}
        </span>
      ))}
      <div className="row">
        <Button small onClick={() => void api.openSyllabusFolder().then(setFolder)} title="Ide teheted a Tampermonkey-szkripttel exportált új feladatsorokat; az adatok frissítésekor betöltődnek.">
          Saját feladatsor-mappa megnyitása
        </Button>
        {folder && <span className="muted small">{folder}</span>}
      </div>
    </div>
  )
}

function StudentRow(props: {
  settings: Settings
  bundle: DataBundle | null
  st: Settings['students'][number]
  name: string
  fleet: readonly FleetEntry[]
  detailed: boolean
  update: (userId: string, patch: Partial<Settings['students'][number]>) => void
  onRemove: () => void
}) {
  const { settings, st, update } = props
  const limits = st.weatherLimits ?? {}
  const preset = matchingWeatherPreset(st.weatherLimits)
  const setLimit = (key: keyof WeatherLimits, v: number | undefined): void => {
    const next = cleanLimits({ ...limits, [key]: v })
    update(st.userId, { weatherLimits: Object.keys(next).length > 0 ? next : undefined })
  }
  return (
    <section className="student-card">
      <header className="row between">
        <strong>{props.name}</strong>
        <Button small variant="ghost" onClick={props.onRemove}>
          Eltávolítás
        </Button>
      </header>
      <AircraftChoicePicker
        fleet={props.fleet}
        student={st}
        onChange={(next) => update(st.userId, { allowedResources: [...next.allowedResources], preferredResources: next.preferredResources ? [...next.preferredResources] : undefined })}
      />
      {(props.bundle?.syllabi.length ?? 0) > 0 && <SyllabusPicker bundle={props.bundle} settings={settings} st={st} update={update} />}
      {props.detailed && (
        <div className="grid-4">
          <Labeled label="Sorrend a napon">
            <NumberInput width={70} ariaLabel="Napon belüli sorrend" min={0} value={st.dayOrder} onChange={(v) => update(st.userId, { dayOrder: v })} />
          </Labeled>
          <Labeled label="Prioritás 1–5 (5 = legfontosabb)">
            <NumberInput width={70} ariaLabel="Prioritás" min={1} max={5} value={st.priority} placeholder={String(settings.defaults.studentPriority)} onChange={(v) => update(st.userId, { priority: v })} />
          </Labeled>
          <Labeled label="„Régen repült” (nap)">
            <NumberInput width={70} ariaLabel="Régen repült küszöb" min={1} value={st.longNoFlyDays} placeholder={String(settings.defaults.longNoFlyDays)} onChange={(v) => update(st.userId, { longNoFlyDays: v })} />
          </Labeled>
          <Labeled label="Feladatválasztás">
            <Select
              ariaLabel="Feladatválasztás"
              value={st.taskSelectionMode ?? ''}
              onChange={(v) => update(st.userId, { taskSelectionMode: v === '' ? undefined : v })}
              options={[
                { value: '', label: 'alapértelmezett' },
                { value: 'automatic', label: 'automatikus' },
                { value: 'manual', label: 'kézi' },
                { value: 'none', label: 'feladat nélkül' },
              ]}
            />
          </Labeled>
        </div>
      )}
      <div className="grid-2">
        <Labeled label="Képzési fázis (TM II.6.4)">
          <Select
            ariaLabel="Képzési fázis"
            value={st.trainingPhase ?? ''}
            onChange={(v) => update(st.userId, { trainingPhase: v === '' ? undefined : (v as TrainingPhase) })}
            options={[{ value: '', label: 'nincs megadva (csak az általános 4 órás napi limit)' }, ...TRAINING_PHASES.map((p) => ({ value: p.value, label: `${p.label}: napi max. ${hoursLabel(p.maxDailyBlockHours)} blokkidő` }))]}
          />
        </Labeled>
        <Labeled label="Időjárási minimum (TM II.6.2)">
          <Select
            ariaLabel="Időjárási minimum a Training Manual szerint"
            value={preset?.id ?? (st.weatherLimits ? 'custom' : '')}
            onChange={(v) => {
              const chosen = TM_WEATHER_PRESETS.find((p) => p.id === v)
              if (v === '') update(st.userId, { weatherLimits: undefined })
              else if (chosen) update(st.userId, { weatherLimits: { ...chosen.limits } })
            }}
            options={[
              { value: '', label: 'iskolai minimum' },
              ...TM_WEATHER_PRESETS.map((p) => ({ value: p.id, label: p.label })),
              ...(preset || !st.weatherLimits ? [] : [{ value: 'custom', label: 'egyéni (kézzel átírva)' }]),
            ]}
          />
          {preset?.note && <span className="field-hint">A TM-ben még: {preset.note} (ezt a program nem tudja előre ellenőrizni).</span>}
        </Labeled>
      </div>
      <div className="grid-4">
        <Labeled label="Min. látástávolság (m)">
          <NumberInput width={130} ariaLabel="Növendéki látástávolság" min={0} step={500} value={limits.minVisibilityM} placeholder={placeholderOf(settings.weather.schoolMinima.minVisibilityM)} onChange={(v) => setLimit('minVisibilityM', v)} />
        </Labeled>
        <Labeled label="Max. oldalszél (csomó)">
          <NumberInput width={130} ariaLabel="Növendéki oldalszél" min={0} value={limits.maxCrosswindKt} placeholder={placeholderOf(settings.weather.schoolMinima.maxCrosswindKt)} onChange={(v) => setLimit('maxCrosswindKt', v)} />
        </Labeled>
        <Labeled label="Max. szél (csomó)">
          <NumberInput width={130} ariaLabel="Növendéki szél" min={0} value={limits.maxWindKt} placeholder={placeholderOf(settings.weather.schoolMinima.maxWindKt)} onChange={(v) => setLimit('maxWindKt', v)} />
        </Labeled>
        <Labeled label="Max. széllökés (csomó)">
          <NumberInput width={130} ariaLabel="Növendéki széllökés" min={0} value={limits.maxGustKt} placeholder={placeholderOf(settings.weather.schoolMinima.maxGustKt)} onChange={(v) => setLimit('maxGustKt', v)} />
        </Labeled>
        <Labeled label="Min. felhőalap (láb)">
          <NumberInput width={130} ariaLabel="Növendéki felhőalap" min={0} step={100} value={limits.minCloudBaseFt} placeholder={placeholderOf(settings.weather.schoolMinima.minCloudBaseFt)} onChange={(v) => setLimit('minCloudBaseFt', v)} />
        </Labeled>
      </div>
    </section>
  )
}

/**
 * Feladatsor (revízió) választása a növendékhez. Alapból automatikus: a FlightLoggerből
 * olvasott program és revízió neve alapján; kézzel felülírható.
 */
function SyllabusPicker(props: { bundle: DataBundle | null; settings: Settings; st: Settings['students'][number]; update: (userId: string, patch: Partial<Settings['students'][number]>) => void }) {
  const { bundle, st } = props
  const progress = studentProgress(bundle, props.settings, st.userId)
  const detected = syllabusLabel(bundle, progress?.autoSyllabusId)
  const fromApi = progress?.programName && progress?.revisionName ? `${progress.programName} – ${progress.revisionName}` : undefined
  const autoLabel = detected ? `automatikus: ${detected}` : fromApi ? `automatikus (nincs feladatsor ehhez: ${fromApi})` : 'automatikus (a program nem ismert)'
  return (
    <Labeled label="Feladatsor / revízió">
      <Select
        ariaLabel="Feladatsor"
        value={st.syllabusId ?? ''}
        onChange={(v) => props.update(st.userId, { syllabusId: v === '' ? undefined : v })}
        options={[{ value: '', label: autoLabel }, ...(bundle?.syllabi ?? []).map((s) => ({ value: s.id, label: `${s.program} – ${s.revision} (${s.tasks.length} feladat)` }))]}
      />
      {st.syllabusId && progress?.autoSyllabusId && st.syllabusId !== progress.autoSyllabusId && (
        <span className="warn-text small">Eltér a FlightLoggerben hozzárendelt revíziótól ({detected}).</span>
      )}
    </Labeled>
  )
}

function Labeled(props: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
    </label>
  )
}

const placeholderOf = (v: number | undefined): string => (v === undefined ? 'nincs' : `iskolai: ${v}`)

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T
}

function cleanLimits(l: Record<string, number | undefined>): WeatherLimits {
  return Object.fromEntries(Object.entries(l).filter(([, v]) => v !== undefined)) as WeatherLimits
}

const MINIMA_FIELDS: ReadonlyArray<[keyof WeatherLimits, string]> = [
  ['maxWindKt', 'Max. szél (csomó)'],
  ['maxGustKt', 'Max. széllökés (csomó)'],
  ['maxCrosswindKt', 'Max. oldalszél (csomó)'],
  ['minVisibilityM', 'Min. látástávolság (m)'],
  ['minCloudBaseFt', 'Min. felhőalap (láb, plafon)'],
  ['maxLowCloudCoverPct', 'Max. alacsony felhőzet (%)'],
  ['maxPrecipitationMmPerH', 'Max. csapadék (mm/óra)'],
  ['maxPrecipitationProbabilityPct', 'Max. csapadék-valószínűség (%)'],
]

export function WeatherMinimaEditor({ settings, onChange }: Props) {
  const minima = settings.weather.schoolMinima
  return (
    <div className="stack">
      <p className="muted">
        Az iskolai minimum a rossz idő globális küszöbe: 0–2 napon belül kizáró, utána pontlevonás. Alapértéke a Training Manual (Rev 8, II.6.2) legenyhébb, valódi géppel végzett sora; a szigorúbb gyakorlatokhoz a növendéknél választható a TM megfelelő sora.
      </p>
      <div className="grid-3">
        {MINIMA_FIELDS.map(([key, label]) => (
          <Field key={key} label={label}>
            <NumberInput value={minima[key]} onChange={(v) => onChange({ ...settings, weather: { ...settings.weather, schoolMinima: cleanLimits({ ...minima, [key]: v }) } })} />
          </Field>
        ))}
      </div>
      <p className="muted small">
        Forrás: {settings.weather.minimaSource}
        {!sameLimits(minima, DEFAULT_SCHOOL_MINIMA) && ' (kézzel módosítva)'}
      </p>
      {!sameLimits(minima, DEFAULT_SCHOOL_MINIMA) && (
        <div className="row">
          <Button small onClick={() => onChange({ ...settings, weather: { schoolMinima: { ...DEFAULT_SCHOOL_MINIMA }, minimaSource: DEFAULT_MINIMA_SOURCE } })}>
            Training Manual szerinti értékek visszaállítása
          </Button>
        </div>
      )}
      <details>
        <summary>A Training Manual időjárási táblázata (Rev 8, II.6.2) – a növendékeknél választható</summary>
        <div className="table-scroll">
          <table className="table compact">
            <thead>
              <tr>
                <th>Gyakorlat</th>
                <th className="num">Látástávolság</th>
                <th className="num">Felhőalap</th>
                <th className="num">Oldalszél</th>
                <th className="num">Szél (H-wind)</th>
                <th>Egyéb</th>
              </tr>
            </thead>
            <tbody>
              {TM_WEATHER_PRESETS.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td className="num">{p.limits.minVisibilityM !== undefined ? `${p.limits.minVisibilityM / 1000} km` : '–'}</td>
                  <td className="num">{p.limits.minCloudBaseFt !== undefined ? `${p.limits.minCloudBaseFt} ft` : '–'}</td>
                  <td className="num">{p.limits.maxCrosswindKt} kt</td>
                  <td className="num">{p.limits.maxWindKt} kt</td>
                  <td className="muted small">{p.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">A szimulátoros sorokat (FNPT II, MCC) a táblázat nem tartalmazza: ott a valós időjárás nem számít.</p>
      </details>
    </div>
  )
}

function sameLimits(a: WeatherLimits, b: WeatherLimits): boolean {
  return canonical(a) === canonical(b)
}

/** Kulcssorrendtől független összehasonlításhoz (a beállítási fájl más sorrendben is tárolhat). */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .filter(([, x]) => x !== undefined)
            .sort(([x], [y]) => x.localeCompare(y)),
        )
      : v,
  )
}

export function WeightsEditor({ settings, onChange }: Props) {
  return (
    <div className="stack">
      <p className="muted">A súly csak a rangsorra hat, a kizáró feltételekre soha. 0% = nem számít, 100% = a legerősebb, de nem kizáró hatás.</p>
      <table className="table compact">
        <tbody>
          {CRITERIA.map((c) => (
            <tr key={c}>
              <td>
                <div>{CRITERION_LABELS[c]}</div>
                <div className="muted small">{CRITERION_HINTS[c]}</div>
              </td>
              <td style={{ width: '40%' }}>
                <input type="range" min={0} max={100} step={5} value={settings.weights[c]} aria-label={CRITERION_LABELS[c]} onChange={(e) => onChange({ ...settings, weights: { ...settings.weights, [c]: Number(e.target.value) } })} />
              </td>
              <td className="num">{settings.weights[c]}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlanningEditor({ settings, onChange }: Props) {
  const d = settings.defaults
  const setD = (patch: Partial<typeof d>): void => onChange({ ...settings, defaults: { ...d, ...patch } })
  return (
    <div className="grid-3">
      <Field label="Dilemma-küszöb (súlyozott egység, repülésre)" hint="Repülésnél 10 egység kb. 2 pont. A szimulátor és az elmélet küszöbe a saját súlyösszegével arányos, így mindháromnál ugyanakkora pontkülönbség kell a döntéshez.">
        <NumberInput value={settings.planning.dilemmaThreshold} min={0} onChange={(v) => onChange({ ...settings, planning: { ...settings.planning, dilemmaThreshold: v ?? 10 } })} />
      </Field>
      <Field label="Feladatválasztás alapból" hint="Automatikus és kézi módban az igény a soron következő feladattal töltődik ki; a feladat az igénynél átírható.">
        <Select
          value={settings.planning.taskSelectionMode}
          onChange={(v) => onChange({ ...settings, planning: { ...settings.planning, taskSelectionMode: v } })}
          options={[
            { value: 'automatic', label: 'Automatikus' },
            { value: 'manual', label: 'Kézi' },
            { value: 'none', label: 'Feladat nélküli' },
          ]}
        />
      </Field>
      {/* A minimális osztályrészvétel (SZB-09) a 2. körben jön: a motor még nem hoz létre
          „kevés résztvevő” dilemmát, ezért a beállítás addig rejtett (F4). */}
      <Field label="Motorpróba és körüljárás (perc)">
        <NumberInput value={d.engineRunUpMinutes} min={0} onChange={(v) => setD({ engineRunUpMinutes: v ?? 20 })} />
      </Field>
      <Field label="Briefing alapból (perc)" hint="Minden igény ezzel számol, feladattól függetlenül; igényenként választható a feladat szerinti vagy kézi érték. A repülés ideje a feladatból jön.">
        <NumberInput value={d.briefingMinutes} min={0} onChange={(v) => setD({ briefingMinutes: v ?? 45 })} />
      </Field>
      <Field label="Debriefing alapból (perc)">
        <NumberInput value={d.debriefingMinutes} min={0} onChange={(v) => setD({ debriefingMinutes: v ?? 30 })} />
      </Field>
      <Field label="Fordulóidő (perc)">
        <NumberInput value={d.turnaroundMinutes} min={0} onChange={(v) => setD({ turnaroundMinutes: v ?? 15 })} />
      </Field>
      <Field label="Csere közös briefing csapatban (perc)" hint="A páron belül a két növendék között, és amikor a következő egység másik gépre ül. Azonos gépen a fordulóidő is kitelik.">
        <NumberInput value={d.teamSwapMinutes} min={0} onChange={(v) => setD({ teamSwapMinutes: v ?? 10 })} />
      </Field>
      <Field label="„Régen repült” küszöb (nap)">
        <NumberInput value={d.longNoFlyDays} min={1} onChange={(v) => setD({ longNoFlyDays: v ?? 14 })} />
      </Field>
      <Field label="Növendék foglalási prioritása alapból (1–5, 5 = legfontosabb)" hint="Súlyként hat: ha két azonos elsőbbségű igény ugyanarra a helyre pályázik, a magasabb prioritású növendék előnyt kap.">
        <NumberInput value={d.studentPriority} min={1} max={5} onChange={(v) => setD({ studentPriority: v ?? 3 })} />
      </Field>
      <Field label="Igény elsőbbsége alapból (1–5, 1 = legfontosabb)" hint="Szabályként hat: a motor a fontosabb igényeket helyezi el előbb, a kevésbé fontos nem veheti el a helyüket. Igényenként átírható.">
        <NumberInput value={d.requestPriority} min={1} max={5} onChange={(v) => setD({ requestPriority: v ?? 1 })} />
      </Field>
      <Field label="Plusz igény elsőbbsége (1–5)" hint="A szabad helyek kitöltésére felvett plusz igények ezzel kerülnek be, így nem szorítják ki a kézzel felvett igényeket.">
        <NumberInput value={d.fillRequestPriority} min={1} max={5} onChange={(v) => setD({ fillRequestPriority: v ?? 3 })} />
      </Field>
    </div>
  )
}

/**
 * Karbantartás (SZB-06): a kirepülhető idő karbantartás-fajtánként ennyivel repülhető túl; a
 * keret végétől a biztonsági pufferrel korábban már nem foglalunk, és a karbantartás hosszáig
 * a gép nem foglalható.
 */
export function MaintenanceEditor({ settings, onChange }: Props) {
  const setType = (type: (typeof MAINTENANCE_TYPES)[number], patch: Partial<Settings['maintenance'][25]>): void =>
    onChange({ ...settings, maintenance: { ...settings.maintenance, [type]: { ...settings.maintenance[type], ...patch } } })
  return (
    <div className="stack">
      <h4>Karbantartás</h4>
      <p className="muted">
        A tervezés a táblázat kirepülhető idejéhez hozzáadja a következő karbantartás előtti túlrepülést. Amikor a foglalások alapján a keret (a pufferrel együtt) elfogy, a gép karbantartásra megy: addig foglalunk rá, utána a karbantartás hosszáig nem.
      </p>
      <Field label="Biztonsági puffer (óra)" hint="Ennyivel a túlrepüléssel számolt keret vége előtt már nem foglalható a gép. Gépenként felülírható a fenti táblázatban; negatív is lehet.">
        <NumberInput value={settings.defaults.minReserveHours} step={0.5} onChange={(v) => onChange({ ...settings, defaults: { ...settings.defaults, minReserveHours: v ?? 2 } })} />
      </Field>
      <div className="table-scroll">
        <table className="table compact">
          <thead>
            <tr>
              <th>Következő karbantartás</th>
              <th>Túlrepülhető (óra)</th>
              <th>Karbantartás hossza (óra)</th>
            </tr>
          </thead>
          <tbody>
            {MAINTENANCE_TYPES.map((type) => (
              <tr key={type}>
                <td>{type} órás</td>
                <td>
                  <NumberInput width={90} min={0} step={0.5} ariaLabel={`${type} órás karbantartás előtti túlrepülés`} value={settings.maintenance[type].overflyHours} onChange={(v) => setType(type, { overflyHours: v ?? 0 })} />
                </td>
                <td>
                  <NumberInput width={90} min={0} step={1} ariaLabel={`${type} órás karbantartás hossza`} value={settings.maintenance[type].durationHours} onChange={(v) => setType(type, { durationHours: v ?? 24 })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const hoursLabel = (h: number): string => `${String(h).replace('.', ',')} óra`

function LimitRulesTable(props: { rules: readonly LimitRule[]; setRule: (id: string, patch: Partial<LimitRule>) => void }) {
  return (
    <div className="table-scroll">
      <table className="table">
        <thead>
          <tr>
            <th>Be</th>
            <th>Szabály</th>
            <th>Határérték</th>
            <th>Jelzés (%)</th>
            <th>Szimulátor is</th>
            <th>Forrás</th>
          </tr>
        </thead>
        <tbody>
          {props.rules.map((r) => (
            <tr key={r.id} className={r.enabled ? undefined : 'muted'}>
              <td>
                <input type="checkbox" aria-label={`${r.id} bekapcsolva`} checked={r.enabled} onChange={(e) => props.setRule(r.id, { enabled: e.target.checked })} />
              </td>
              <td>
                {METRIC_LABELS[r.metric]} {windowLabel(r.window)}
                {r.metric === 'restTime' ? ' (legalább)' : ' (legfeljebb)'}
                {r.restAtLeastPreviousDuty && <span className="muted small"> – de legalább az előző szolgálat hossza</span>}
              </td>
              <td>
                <div className="row nowrap">
                  <NumberInput width={80} ariaLabel={`${r.id} határérték`} value={r.limit} min={0} step={r.metric === 'taskCount' ? 1 : 0.5} onChange={(v) => props.setRule(r.id, { limit: v ?? 0 })} />
                  <span className="muted small">{r.metric === 'taskCount' ? 'db' : 'óra'}</span>
                </div>
              </td>
              <td>{r.metric === 'restTime' ? <span className="muted">–</span> : <NumberInput width={70} ariaLabel={`${r.id} jelzés`} value={r.warnAtPercent} min={0} max={100} onChange={(v) => props.setRule(r.id, { warnAtPercent: v ?? 80 })} />}</td>
              <td>
                <input type="checkbox" aria-label={`${r.id} szimulátor`} checked={r.includeSimulator} onChange={(e) => props.setRule(r.id, { includeSimulator: e.target.checked })} />
              </td>
              <td className="muted small">{r.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function LimitsEditor({ settings, onChange }: Props) {
  const rules = settings.limits.rules
  const setRule = (id: string, patch: Partial<LimitRule>): void => onChange({ ...settings, limits: { ...settings.limits, rules: rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) } })
  const [entryDate, setEntryDate] = useState('')
  const [entryMinutes, setEntryMinutes] = useState<number | undefined>(undefined)
  const defaults = defaultLimitRules()
  const isDefault = canonical(rules) === canonical(defaults)
  return (
    <div className="stack">
      <p className="muted">
        A túllépés nem tiltja a foglalást, hanem dilemmaként jóváhagyást kér; a jelzés a határérték megadott százalékánál figyelmeztet. A „24 egymást követő óra” szabályokat a program naptári nappal közelíti.
      </p>
      <h4>Növendék – Training Manual Rev 8, II.6.4</h4>
      <LimitRulesTable rules={rules.filter((r) => r.subject === 'student')} setRule={setRule} />
      <div className="muted small stack-tight">
        <span>
          A fázisfüggő napi blokkidőt (1–2. fázis 2,5 óra, 3–4. fázis 4 óra, 5. fázis 3 óra, 6. fázis 6 óra) a növendéknél a „Képzési fázis” választóval lehet bekapcsolni. A szolgálati időhöz csak a betöltött foglalások számítanak, a múltbeli szolgálati időt az API nem adja vissza; a repült időbe a növendék elmúlt egy évének repülései is beleszámítanak.
        </span>
        <span>A TM további előírásai, amelyeket a program nem ellenőriz:</span>
        <ul>
          {TM_UNCHECKED_RULES.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
      <h4>Oktató – Operations Manual</h4>
      <p className="muted small">A Training Manual (II.6.3) az oktatói szolgálati és pihenőidőt az Operations Manualhoz utalja. Az alábbi számok ORO.FTL-minták: az OM értékeivel írd felül.</p>
      <LimitRulesTable rules={rules.filter((r) => r.subject === 'instructor')} setRule={setRule} />
      {!isDefault && (
        <div className="row">
          <Button small onClick={() => onChange({ ...settings, limits: { ...settings.limits, rules: defaults } })} title="Minden limit-szabály a Training Manual szerinti (és az oktatói minta) alapértékre áll vissza">
            Alapértékek visszaállítása (TM Rev 8)
          </Button>
        </div>
      )}
      <Field label="Kézi repült idő" hint="Más munkahelyen vagy 2026. április 1. előtt repült idő, amelyet a FlightLogger API nem ad vissza.">
        <table className="table compact">
          <tbody>
            {settings.limits.manualFlightTime.map((m) => (
              <tr key={m.id}>
                <td>{m.date}</td>
                <td>{(m.minutes / 60).toFixed(1)} óra</td>
                <td>{m.note}</td>
                <td>
                  <Button small variant="ghost" onClick={() => onChange({ ...settings, limits: { ...settings.limits, manualFlightTime: settings.limits.manualFlightTime.filter((x) => x.id !== m.id) } })}>
                    Törlés
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row">
          <DateInput ariaLabel="Kézi bejegyzés napja" value={entryDate} onChange={setEntryDate} />
          <NumberInput width={90} ariaLabel="Perc" placeholder="perc" value={entryMinutes} onChange={setEntryMinutes} />
          <Button
            small
            disabled={!entryDate || !entryMinutes}
            onClick={() => {
              onChange({ ...settings, limits: { ...settings.limits, manualFlightTime: [...settings.limits.manualFlightTime, { id: `kezi-${Date.now().toString(36)}`, date: entryDate, minutes: entryMinutes!, simulator: false }] } })
              setEntryDate('')
              setEntryMinutes(undefined)
            }}
          >
            + Bejegyzés
          </Button>
        </div>
      </Field>
    </div>
  )
}
