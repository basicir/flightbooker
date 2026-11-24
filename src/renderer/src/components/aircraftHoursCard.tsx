import { aircraftNeedingHoursEntry, aircraftWithHoursEntry, recordAircraftHours, sheetEntryDate } from '@core/config/operations'
import type { Settings } from '@core/config/schema'
import type { SheetReading, SheetRow } from '@core/maintenanceSheet/read'
import { MAINTENANCE_TYPES, type FleetEntry, type MaintenanceType } from '@core/model/resources'
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, isBrowserDemo } from '../bridge'
import { useApp } from '../state'
import { Badge, Button, Card, Empty, NumberInput, Select } from './ui'

/**
 * Kirepülhető idő ma (ERF-04, ERF-05): kézi megadás, vagy a maintenance crew táblázatáról
 * készült fotó beolvasása (helyi OCR). A beolvasott értékek csak előtöltik a mezőket; mentés
 * előtt az oktató átnézi őket, az ellenőrizendő sorokat a felület kiemeli.
 */

interface Imported {
  readonly reading: SheetReading
  readonly fileName: string
}

const sheetDateText = (date: string): string => `${date.replaceAll('-', '.')}.`

type TypeChoice = '' | `${MaintenanceType}`
const TYPE_OPTIONS: ReadonlyArray<{ value: TypeChoice; label: string }> = [{ value: '', label: '–' }, ...MAINTENANCE_TYPES.map((t) => ({ value: `${t}` as TypeChoice, label: `${t} órás` }))]
const typeFromChoice = (v: TypeChoice): MaintenanceType | undefined => (v === '' ? undefined : (Number(v) as MaintenanceType))

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // Az Electron az IPC-hibát előtaggal adja vissza; a felhasználónak csak a lényeg kell.
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '')
}

function isImageFile(file: File): boolean {
  return /^image\/(jpeg|png)$/.test(file.type) || /\.(jpe?g|png)$/i.test(file.name)
}

/** A meglévő érték újabb-e a fotónál (ilyenkor a fotó értéke nem írja felül). */
function isOlderThanStored(settings: Settings, aircraftId: string, sheetDate: string | null): boolean {
  const stored = settings.aircraftHours[aircraftId]
  return sheetDate !== null && stored !== undefined && stored.date > sheetDate
}

function StatusBadge(props: { row: SheetRow | undefined; inSheet: boolean; olderThanStored: boolean }) {
  const { row } = props
  if (!row) return props.inSheet ? null : <Badge>nincs a képen</Badge>
  if (props.olderThanStored) return <Badge>régebbi a meglévőnél</Badge>
  switch (row.status) {
    case 'ok':
      return (
        <span title={`Következő − Aktuális: ${row.next} − ${row.current} = ${row.hours}`}>
          <Badge tone="ok">egyezik</Badge>
        </span>
      )
    case 'check':
      return <Badge tone="warn">ellenőrizd</Badge>
    case 'empty':
      return <Badge>üres a táblázatban</Badge>
    default:
      return <Badge tone="danger">nem olvasható</Badge>
  }
}

/**
 * `photoButtonTarget`: ha meg van adva, a „Karbantartási táblázat beolvasása fotóról” gomb oda kerül (az Indítópulton a
 * lap tetejére), a beolvasás eredménye és a mentés viszont a kártyában marad.
 */
export function AircraftHoursCard(props: { settings: Settings; fleet: readonly FleetEntry[]; today: string; photoButtonTarget?: HTMLElement | null }) {
  const { settings, fleet, today } = props
  const app = useApp()
  const [hours, setHours] = useState<Record<string, number | undefined>>({})
  /** A következő karbantartás fajtája (SZB-06); hiányában a korábban megadott. */
  const [types, setTypes] = useState<Record<string, MaintenanceType | undefined>>({})
  const [imported, setImported] = useState<Imported | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const eligible = useMemo(() => aircraftWithHoursEntry(settings, fleet), [settings, fleet])
  const needHours = aircraftNeedingHoursEntry(settings, fleet, today)
  const rowByAircraft = useMemo(() => {
    const map = new Map<string, SheetRow>()
    for (const row of imported?.reading.rows ?? []) if (row.aircraftId && !map.has(row.aircraftId)) map.set(row.aircraftId, row)
    return map
  }, [imported])

  const runImport = useCallback(
    async (file: File) => {
      if (!isImageFile(file)) {
        setError('Csak JPEG vagy PNG kép olvasható be.')
        return
      }
      setBusy(true)
      setError(null)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const reading = await api.readMaintenanceSheet(
          bytes,
          eligible.map((a) => ({ id: a.id, callSign: a.callSign })),
        )
        setImported({ reading, fileName: file.name || 'beillesztett kép' })
        const usable = reading.rows.filter(
          // Régebbi fotó nem írja felül a már megadott, újabb értéket.
          (row) => row.aircraftId && row.hours !== null && (row.status === 'ok' || row.status === 'check') && !isOlderThanStored(settings, row.aircraftId, reading.date),
        )
        setHours((prev) => {
          const next = { ...prev }
          for (const row of usable) next[row.aircraftId!] = row.hours!
          return next
        })
        setTypes((prev) => {
          const next = { ...prev }
          for (const row of usable) if (row.maintenanceType !== null) next[row.aircraftId!] = row.maintenanceType
          return next
        })
      } catch (e) {
        setError(errorText(e))
      } finally {
        setBusy(false)
      }
    },
    [eligible, settings],
  )

  // Beillesztés vágólapról (például képernyőkép vagy üzenetből másolt fotó).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const file = [...(event.clipboardData?.files ?? [])].find(isImageFile)
      if (!file) return
      event.preventDefault()
      void runImport(file)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [runImport])

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    setDragOver(false)
    const file = [...event.dataTransfer.files].find(isImageFile) ?? event.dataTransfer.files[0]
    if (file) void runImport(file)
  }

  const discardImport = (): void => {
    setHours((prev) => {
      const next = { ...prev }
      for (const [id, row] of rowByAircraft) if (next[id] === row.hours) delete next[id]
      return next
    })
    setTypes((prev) => {
      const next = { ...prev }
      for (const [id, row] of rowByAircraft) if (next[id] === row.maintenanceType) delete next[id]
      return next
    })
    setImported(null)
  }

  const save = async (): Promise<void> => {
    const enteredAt = new Date().toISOString()
    const importDate = imported ? sheetEntryDate(imported.reading.date, today) : today
    let next = settings
    for (const [id, value] of Object.entries(hours)) {
      if (value === undefined) continue
      // A fotóból változatlanul átvett érték a táblázat napjára vonatkozik.
      const fromSheet = rowByAircraft.get(id)?.hours === value
      next = recordAircraftHours(next, id, value, fromSheet ? importDate : today, enteredAt, typeOf(id))
    }
    await app.saveSettings(next)
    setHours({})
    setTypes({})
    setImported(null)
  }

  /** A választott fajta; ha nem nyúltak hozzá, a korábban megadott. */
  const typeOf = (id: string): MaintenanceType | undefined => (Object.hasOwn(types, id) ? types[id] : settings.aircraftHours[id]?.maintenanceType)

  const shown = eligible.filter((a) => needHours.includes(a) || rowByAircraft.has(a.id))
  const reading = imported?.reading
  const counts = { ok: 0, check: 0, other: 0 }
  for (const [id, row] of rowByAircraft) {
    if (isOlderThanStored(settings, id, reading?.date ?? null)) counts.other++
    else if (row.status === 'ok') counts.ok++
    else if (row.status === 'check') counts.check++
    else counts.other++
  }
  const missing = reading ? eligible.filter((a) => reading.missingAircraftIds.includes(a.id)) : []
  const canSave = Object.values(hours).some((v) => v !== undefined)

  const photoButton = (
    <Button
      small
      onClick={() => fileInput.current?.click()}
      disabled={busy || isBrowserDemo}
      title={
        isBrowserDemo
          ? 'Csak az asztali alkalmazásban'
          : 'A gépek kirepülhető idejét (óra a karbantartásig) a karbantartási táblázatról készült fotóból tölti ki; mentés előtt átnézheted.'
      }
    >
      {busy ? 'Táblázat beolvasása…' : 'Karbantartási táblázat beolvasása fotóról'}
    </Button>
  )
  const external = props.photoButtonTarget ?? null

  return (
    <Card
      title="Kirepülhető idő ma"
      actions={
        <>
          {external
            ? createPortal(
                <>
                  {photoButton}
                  {imported && (
                    <Button small variant="ghost" onClick={() => document.getElementById('aircraft-hours-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} title="A beolvasott értékek a „Kirepülhető idő ma” kártyában nézhetők át és menthetők">
                      Átnézés és mentés ↓
                    </Button>
                  )}
                </>,
                external,
              )
            : photoButton}
          {/* Mentés csak akkor látszik, ha van mit menteni. */}
          {canSave && (
            <Button variant="primary" small onClick={() => void save()} disabled={busy}>
              Mentés
            </Button>
          )}
        </>
      }
    >
      <span id="aircraft-hours-card" className="anchor" />
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void runImport(file)
        }}
      />
      <div
        className={`dropzone${dragOver ? ' active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          if (!busy && !isBrowserDemo) setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (busy || isBrowserDemo) {
            e.preventDefault()
            setDragOver(false)
          } else onDrop(e)
        }}
      >
        <div className="stack">
          {!isBrowserDemo && !reading && !busy && <p className="muted small">A karbantartási táblázat fotóját ide is húzhatod, vagy beillesztheted a vágólapról.</p>}
          <p className="muted small">
            A következő karbantartás fajtájából jön a túlrepülhető idő és a karbantartás hossza.{' '}
            <button type="button" className="link" onClick={() => app.navigate('settings', { settingsTab: 'Gépek' })}>
              Beállítások → Gépek
            </button>
          </p>
          {busy && <p className="muted">A fotó elemzése néhány másodpercig tart…</p>}
          {error && (
            <p className="error-list" role="alert">
              {error}
            </p>
          )}
          {reading && imported && (
            <div className="sheet-import stack-tight">
              <div className="row between wrap">
                <span>
                  <strong>Fotóból:</strong> {imported.fileName}
                  {reading.date ? ` – a táblázat dátuma ${sheetDateText(reading.date)}` : ' – a táblázat dátuma nem olvasható'}
                </span>
                <Button variant="ghost" small onClick={discardImport}>
                  Elvetés
                </Button>
              </div>
              {reading.date && reading.date !== today && (
                <p className="warn-text">
                  A fotón {sheetDateText(reading.date)} szerepel, nem a mai nap. Az átvett értékek{' '}
                  {sheetEntryDate(reading.date, today) === reading.date ? 'ezzel a dátummal kerülnek mentésre, a mai értéket a program továbbra is kéri.' : 'a mai dátummal kerülnek mentésre – ellenőrizd, hogy a jó táblázatot olvastad-e be.'}
                </p>
              )}
              {rowByAircraft.size > 0 && (
                <p>
                  {rowByAircraft.size} gép a képen: {counts.ok} egyezik
                  {counts.check > 0 && <>, <span className="warn-text">{counts.check} ellenőrizendő</span></>}
                  {counts.other > 0 && <>, {counts.other} átvett érték nélkül</>}.{' '}
                  {counts.check > 0 ? 'Mentés előtt nézd át a kiemelt sorokat a fotón.' : 'Mentés előtt egy pillantással vesd össze a fotóval.'}
                </p>
              )}
              {reading.warnings.map((w) => (
                <p key={w} className="warn-text small">
                  {w}
                </p>
              ))}
              {missing.length > 0 && <p className="muted small">Nincs a képen: {missing.map((a) => a.callSign).join(', ')}.</p>}
            </div>
          )}
          {shown.length === 0 ? (
            <Empty>Minden repülőgépnél megadtad a mai értéket.</Empty>
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Gép</th>
                  <th>Előző érték</th>
                  <th>Mai érték (óra a karbantartásig)</th>
                  <th>Következő karbantartás</th>
                  {reading && <th>Fotó</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => {
                  const prev = settings.aircraftHours[a.id]
                  const row = rowByAircraft.get(a.id)
                  const older = row !== undefined && isOlderThanStored(settings, a.id, reading?.date ?? null)
                  const flagged = row !== undefined && !older && row.status !== 'ok'
                  return (
                    <tr key={a.id} className={flagged ? 'has-warning' : undefined}>
                      <td className="nowrap">{a.callSign}</td>
                      <td className="muted">{prev ? `${prev.hoursUntilMaintenance} óra${prev.maintenanceType ? `, ${prev.maintenanceType} órás` : ''} (${prev.date})` : '–'}</td>
                      <td>
                        <NumberInput width={100} step={0.1} ariaLabel={`${a.callSign} kirepülhető ideje`} value={hours[a.id]} onChange={(v) => setHours({ ...hours, [a.id]: v })} />
                      </td>
                      <td>
                        <Select<TypeChoice> ariaLabel={`${a.callSign} következő karbantartása`} value={typeOf(a.id) === undefined ? '' : (`${typeOf(a.id)}` as TypeChoice)} options={TYPE_OPTIONS} onChange={(v) => setTypes({ ...types, [a.id]: typeFromChoice(v) })} />
                      </td>
                      {reading && (
                        <td>
                          <div className="stack-tight">
                            <StatusBadge row={row} inSheet={!reading.missingAircraftIds.includes(a.id)} olderThanStored={older} />
                            {older && prev && <span className="small muted">A meglévő érték ({prev.date}) újabb a fotónál, ezért nem töltöttem ki.</span>}
                            {row && !older && row.status !== 'ok' && row.notes.length > 0 && <span className="small">{row.notes.join(' ')}</span>}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Card>
  )
}
