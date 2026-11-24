import type { Settings } from '@core/config/schema'
import { SettingsSchema } from '@core/config/schema'
import { formatIssues } from '@core/config/settings'
import { applySettingsImport, readSettingsImport, type SettingsImportFile } from '@core/config/transfer'
import { useEffect, useState } from 'react'
import { api, isBrowserDemo } from '../bridge'
import {
  AirportEditor,
  ClassroomsEditor,
  LimitsEditor,
  MaintenanceEditor,
  PlanningEditor,
  ResourcesEditor,
  StudentsEditor,
  WeatherMinimaEditor,
  WeightsEditor,
  WorkTimeEditor,
} from '../components/settingsEditors'
import { Badge, Button, Card, ChoiceList, Dialog, ErrorList, Field, PageHeader, TextInput } from '../components/ui'
import { FlImportColors, FlImportGuide } from '../components/flImportGuide'
import { UpdateSettings } from '../components/updateSettings'
import { SETTINGS_TAB_HELP } from '../help/helpContent'
import { useHelpTopic } from '../help/HelpPanel'
import { useApp } from '../state'

/** Beállítások (SZB-11): minden állítható érték egy helyen, mentés gombbal. */

/** A gyakran állított fülek elöl (növendékek, gépek), a ritkán hangolt súlyok és az adatforrás hátul. */
const TABS = ['Növendékek', 'Gépek', 'Termek', 'Munkaidő', 'Limitek', 'Időjárás', 'Repülőtér', 'Tervezés', 'Súlyok', 'Adatforrás', 'FlightLogger-import', 'Frissítés'] as const
type Tab = (typeof TABS)[number]

export function SettingsScreen() {
  const app = useApp()
  const requested = TABS.find((t) => t === app.settingsTab)
  const [tab, setTab] = useState<Tab>(requested ?? 'Növendékek')
  // Másik képernyőről kért fül (például „Beállítások → Gépek”) akkor is érvényes, ha már itt vagyunk.
  const [lastRequested, setLastRequested] = useState(app.settingsTab)
  if (lastRequested !== app.settingsTab) {
    setLastRequested(app.settingsTab)
    if (requested) setTab(requested)
  }
  // A súgó (F1) az épp nyitott fülhöz tartozó részt mutatja.
  useHelpTopic(SETTINGS_TAB_HELP[tab] ?? null)
  const [draft, setDraft] = useState<Settings | null>(app.settings)
  const [errors, setErrors] = useState<string[]>([])
  const [saved, setSaved] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [keyMessage, setKeyMessage] = useState<string | null>(null)

  // A mentett beállítás változásakor a vázlat is frissül (React-minta: összevetés renderelés közben).
  const [base, setBase] = useState(app.settings)
  if (base !== app.settings) {
    setBase(app.settings)
    setDraft(app.settings)
  }
  useEffect(() => {
    void api.hasApiKey().then(setHasKey)
  }, [])
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(app.settings)
  // Mentetlen módosításnál a képernyőváltás előtt rákérdez (H16, U4).
  const { setLeaveGuard } = app
  useEffect(() => {
    setLeaveGuard(dirty ? () => window.confirm('A Beállításokban mentetlen módosítás van. Elveted, és továbblépsz?') : null)
    return () => setLeaveGuard(null)
  }, [dirty, setLeaveGuard])
  const [cacheMessage, setCacheMessage] = useState<string | null>(null)
  // Export és import: az importált beállítás vázlat marad, amíg el nem mented (átnézhető, elvethető).
  const [exportOpen, setExportOpen] = useState(false)
  const [exportStudents, setExportStudents] = useState<'without' | 'with'>('without')
  const [pendingImport, setPendingImport] = useState<{ name: string; file: Extract<SettingsImportFile, { ok: true }> } | null>(null)
  const [importStudents, setImportStudents] = useState<'with' | 'without'>('with')
  const [importedFrom, setImportedFrom] = useState<string | null>(null)
  const [transferMessage, setTransferMessage] = useState<{ ok: boolean; text: string } | null>(null)
  if (!draft) return null

  const change = (s: Settings): void => {
    setDraft(s)
    setSaved(false)
  }
  const save = async (): Promise<void> => {
    const parsed = SettingsSchema.safeParse(draft)
    if (!parsed.success) {
      setErrors(formatIssues(parsed.error.issues))
      return
    }
    setErrors([])
    await app.saveSettings(parsed.data)
    setSaved(true)
    setImportedFrom(null)
  }

  const runExport = async (): Promise<void> => {
    setExportOpen(false)
    try {
      const name = await api.exportSettings(app.settings!, { includeStudents: exportStudents === 'with' })
      if (name) setTransferMessage({ ok: true, text: `Exportálva: ${name}` })
    } catch (error) {
      setTransferMessage({ ok: false, text: `Az exportálás nem sikerült: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  const applyImport = (name: string, file: Extract<SettingsImportFile, { ok: true }>, withStudents: boolean): void => {
    const next = applySettingsImport(draft, file, { importStudents: withStudents })
    if (JSON.stringify(next) === JSON.stringify(app.settings)) {
      setTransferMessage({ ok: true, text: `A(z) ${name} tartalma megegyezik a mostani beállítással.` })
      return
    }
    change(next)
    setImportedFrom(name)
    setTransferMessage(null)
  }

  const startImport = async (): Promise<void> => {
    if (dirty && !window.confirm('A Beállításokban mentetlen módosítás van; az importálás felülírja. Folytatod?')) return
    setTransferMessage(null)
    let picked: { name: string; text: string } | null
    try {
      picked = await api.openSettingsFile()
    } catch (error) {
      setTransferMessage({ ok: false, text: `A fájl nem olvasható: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
    if (!picked) return
    const file = readSettingsImport(picked.text)
    if (!file.ok) {
      setErrors([`A(z) ${picked.name} nem importálható:`, ...file.errors])
      return
    }
    setErrors([])
    if (file.includesStudents) {
      setImportStudents('with')
      setPendingImport({ name: picked.name, file })
    } else applyImport(picked.name, file, false)
  }

  return (
    <div className="page">
      <PageHeader
        title="Beállítások"
        lead="Az értékek a beállítási fájlba kerülnek; a módosítás a terv újraszámolásával azonnal hat. Ha a növendékek, a repülőtér vagy az adatforrás változik, mentés után az adatok is újratöltődnek."
        actions={
          <>
            {saved && !dirty && <Badge tone="ok">Mentve</Badge>}
            <Button onClick={() => void startImport()} title="Beállítások betöltése fájlból; mentés előtt átnézheted">
              Importálás…
            </Button>
            <Button onClick={() => setExportOpen(true)} title="A beállítások mentése fájlba, növendékekkel vagy nélkülük">
              Exportálás…
            </Button>
          </>
        }
      />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <ErrorList errors={errors} />
      {transferMessage && (
        <div className={transferMessage.ok ? 'banner info' : 'banner error'} role="status">
          {transferMessage.text}
        </div>
      )}
      <Card>
        {tab === 'Súlyok' && <WeightsEditor settings={draft} onChange={change} />}
        {tab === 'Tervezés' && <PlanningEditor settings={draft} onChange={change} />}
        {tab === 'Gépek' && (
          <div className="stack">
            <ResourcesEditor settings={draft} onChange={change} bundle={app.bundle} detailed />
            <MaintenanceEditor settings={draft} onChange={change} />
          </div>
        )}
        {tab === 'Termek' && <ClassroomsEditor settings={draft} onChange={change} bundle={app.bundle} />}
        {tab === 'Növendékek' && <StudentsEditor settings={draft} onChange={change} bundle={app.bundle} detailed />}
        {tab === 'Limitek' && <LimitsEditor settings={draft} onChange={change} />}
        {tab === 'Időjárás' && <WeatherMinimaEditor settings={draft} onChange={change} />}
        {tab === 'Repülőtér' && <AirportEditor settings={draft} onChange={change} />}
        {tab === 'Munkaidő' && <WorkTimeEditor settings={draft} onChange={change} />}
        {tab === 'Frissítés' && <UpdateSettings />}
        {tab === 'FlightLogger-import' && (
          <div className="stack">
            <FlImportColors settings={draft} onChange={change} />
            <FlImportGuide />
          </div>
        )}
        {tab === 'Adatforrás' && (
          <div className="stack">
            <p>
              Adatforrás: <strong>FlightLogger</strong>, az API-kulcsoddal, csak olvasva.
            </p>
            {!isBrowserDemo && (
              <Field label="API-kulcs" hint={hasKey ? 'Van tárolt kulcs. A kulcs maga soha nem jelenik meg.' : 'Nincs tárolt kulcs.'}>
                <div className="row">
                  <TextInput type="password" value={apiKey} onChange={setApiKey} ariaLabel="Új API-kulcs" placeholder="új kulcs" />
                  <Button
                    disabled={apiKey.trim().length < 8}
                    onClick={() =>
                      void api.saveApiKey(apiKey).then((r) => {
                        setApiKey('')
                        setKeyMessage(r.message)
                        void api.hasApiKey().then(setHasKey)
                      })
                    }
                  >
                    Csere és próba
                  </Button>
                  <Button
                    variant="danger"
                    disabled={!hasKey}
                    onClick={() =>
                      void api.clearApiKey().then(() => {
                        setHasKey(false)
                        setKeyMessage('A kulcs törölve.')
                      })
                    }
                  >
                    Kulcs törlése
                  </Button>
                </div>
              </Field>
            )}
            {keyMessage && <p>{keyMessage}</p>}
            <hr className="divider" />
            <div className="stack">
              <h4>Gyorsítótár</h4>
              <p>
                A legutóbb letöltött heti adatok (a névjegyzékkel és a foglalásokkal), a haladás és a feladatlista titkosítva a gépen maradnak, hogy indításkor azonnal legyen mit mutatni. Törlésük után a következő frissítés mindent újra letölt.
              </p>
              <div className="row">
                <Button
                  onClick={() =>
                    void api.clearCache().then(
                      () => setCacheMessage('A gyorsítótár törölve.'),
                      (e: unknown) => setCacheMessage(`Nem sikerült törölni: ${e instanceof Error ? e.message : String(e)}`),
                    )
                  }
                >
                  Gyorsítótár törlése
                </Button>
                {cacheMessage && <span className="small muted">{cacheMessage}</span>}
              </div>
            </div>
            <hr className="divider" />
            <div className="stack">
              <h4>Alaphelyzetbe állítás (Reset)</h4>
              <p>
                Törli a helyi beállítási fájlt, a mentett heti terveket és az adatok gyorsítótárát (az utoljára letöltött heti adatot, a haladást és a feladatlistát), majd elölről indítja az első beállítási folyamatot.
              </p>
              <div className="row wrap">
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (window.confirm('Biztosan törlöd a beállításokat és a terveket?\n\nA tárolt API-kulcs megmarad, így az első beállításnál egy kattintással tovább tudsz lépni.')) {
                      await app.resetApp({ clearApiKey: false })
                    }
                  }}
                >
                  Beállítások törlése és újrakezdés (kulcs megtartásával)
                </Button>
                <Button
                  variant="danger"
                  onClick={async () => {
                    if (window.confirm('FIGYELEM: Ez MINDENT töröl, beleértve a tárolt API-kulcsot is!\n\nBiztosan teljesen elölről kezded?')) {
                      await app.resetApp({ clearApiKey: true })
                    }
                  }}
                >
                  Teljes törlés (API-kulccsal együtt)
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
      {dirty && (
        <div className="savebar dirty" role="region" aria-label="Mentetlen módosítások">
          <span className="savebar-text">{importedFrom ? `Importálva: ${importedFrom} – nézd át, majd mentsd` : 'Mentetlen módosítás'}</span>
          <Button
            variant="ghost"
            onClick={() => {
              change(app.settings!)
              setImportedFrom(null)
            }}
          >
            Elvetés
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            Mentés
          </Button>
        </div>
      )}
      {exportOpen && (
        <Dialog
          title="Beállítások exportálása"
          onClose={() => setExportOpen(false)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setExportOpen(false)}>
                Mégse
              </Button>
              <Button variant="primary" onClick={() => void runExport()}>
                Exportálás
              </Button>
            </>
          }
        >
          <ChoiceList
            name="export-students"
            value={exportStudents}
            onChange={setExportStudents}
            options={[
              { value: 'without', label: 'Növendékek nélkül', hint: 'Repülőtér, munkaidő, limitek, időjárás, gépek, termek, tervezés és súlyok. Kollégával is megosztható.' },
              { value: 'with', label: `Növendékekkel együtt (${app.settings!.students.length})`, hint: 'A fentiek és a növendékek beállításai (FlightLogger-azonosítóval, név nélkül). Saját mentéshez vagy másik gépre.' },
            ]}
          />
          <p className="small muted">Nem kerül bele: az API-kulcs, az adatforrás és a gépek napi óraállása.</p>
          {dirty && <p className="small warn-text">A mentetlen módosítások nem kerülnek bele; ha kellenek, előbb mentsd őket.</p>}
        </Dialog>
      )}
      {pendingImport && (
        <Dialog
          title={`Importálás: ${pendingImport.name}`}
          onClose={() => setPendingImport(null)}
          actions={
            <>
              <Button variant="ghost" onClick={() => setPendingImport(null)}>
                Mégse
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  applyImport(pendingImport.name, pendingImport.file, importStudents === 'with')
                  setPendingImport(null)
                }}
              >
                Betöltés
              </Button>
            </>
          }
        >
          <p>A fájl a beállítások mellett {pendingImport.file.studentCount} növendéket is tartalmaz.</p>
          <ChoiceList
            name="import-students"
            value={importStudents}
            onChange={setImportStudents}
            options={[
              { value: 'with', label: 'Növendékekkel együtt', hint: `A mostani ${draft.students.length} növendék helyére a fájlban lévők kerülnek.` },
              { value: 'without', label: 'Növendékek nélkül', hint: 'A mostani növendékek és beállításaik maradnak; csak az alapbeállítások töltődnek be.' },
            ]}
          />
          <p className="small muted">Betöltés után átnézheted; a Mentés gombig semmi nem íródik felül, az Elvetés visszaállítja a korábbit.</p>
        </Dialog>
      )}
    </div>
  )
}
