import type { Settings } from '@core/config/schema'
import { SettingsSchema } from '@core/config/schema'
import { prefillClassrooms } from '@core/config/operations'
import { formatIssues } from '@core/config/settings'
import { defaultWeekStart } from '@core/draft/weekPlan'
import type { DataBundle } from '@core/model/dataBundle'
import { useEffect, useState } from 'react'
import { api } from '../bridge'
import { AirportEditor, ClassroomsEditor, LimitsEditor, ResourcesEditor, StudentsEditor, WeatherMinimaEditor, WorkTimeEditor } from '../components/settingsEditors'
import type { RefreshProgress } from '../../../shared/api'
import { Button, Card, ErrorList, Field, LoadingOverlay, TextInput } from '../components/ui'
import { SETUP_STEP_HELP } from '../help/helpContent'
import { HelpIcon, useHelp, useHelpTopic } from '../help/HelpPanel'
import { todayIn, useApp } from '../state'

/**
 * Első beállítás (10. fejezet): adatforrás, repülőtér, limitek és időjárás, gépek, termek,
 * növendékek, munkaidő. Az időjárás a növendékek előtt van, mert a növendéki limitek
 * alapértéke az iskolai minimum.
 */

const STEPS = ['Adatforrás', 'Repülőtér', 'Limitek és időjárás', 'Gépek', 'Termek', 'Növendékek', 'Munkaidő'] as const

export function FirstSetup(props: { initial: Settings }) {
  const { finishSetup } = useApp()
  const [step, setStep] = useState(0)
  const [settings, setSettings] = useState<Settings>(props.initial)
  const [apiKey, setApiKey] = useState('')
  const [keyMessage, setKeyMessage] = useState<{ ok: boolean; message: string } | null>(null)
  const [hasStoredKey, setHasStoredKey] = useState<boolean | null>(null)
  const [bundle, setBundle] = useState<DataBundle | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<RefreshProgress | null>(null)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const help = useHelp()
  // A súgó (F1) az épp nyitott lépéshez tartozó részt mutatja.
  useHelpTopic(SETUP_STEP_HELP[step] ?? null)

  useEffect(() => {
    void api.hasApiKey().then((has) => {
      setHasStoredKey(has)
      if (has) {
        setKeyMessage({ ok: true, message: 'Van elmentett FlightLogger API-kulcs a rendszer titoktárolójában.' })
      }
    })
  }, [])

  const tz = settings.airport?.timezone ?? 'Europe/Budapest'

  /** Az első beállításhoz csak a névjegyzék kell (gépek, termek, növendékek): ez gyors. */
  const loadData = async (s: Settings): Promise<void> => {
    setBusy(true)
    setErrors([])
    setProgress(null)
    setLoading(true)
    const unsubscribe = api.onRefreshProgress(setProgress)
    try {
      const loaded = await api.refreshData(defaultWeekStart(todayIn(tz)), s, { scope: 'directory' })
      setBundle(loaded)
      // ERF-07: a termek férőhelye a névből („18 Classroom I.” → 18), szám nélkül 1.
      setSettings((prev) => prefillClassrooms(prev, loaded.snapshot.classroomIds, loaded.directory.classrooms))
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    } finally {
      unsubscribe()
      setBusy(false)
      setLoading(false)
      setProgress(null)
    }
  }

  const saveKey = async (): Promise<void> => {
    setBusy(true)
    const result = await api.saveApiKey(apiKey)
    setApiKey('')
    setKeyMessage(result)
    setBusy(false)
    if (result.ok) {
      setHasStoredKey(true)
      void loadData(settings)
    }
  }

  const continueWithLive = async (): Promise<void> => {
    setStep(1)
    if (!bundle) {
      void loadData(settings)
    }
  }

  const finish = async (): Promise<void> => {
    const parsed = SettingsSchema.safeParse(settings)
    if (!parsed.success) {
      setErrors(formatIssues(parsed.error.issues))
      return
    }
    await finishSetup(parsed.data)
  }

  const needsData = step >= 3 && step <= 5
  return (
    <>
    <div className="setup" inert={loading}>
      <header className="setup-header">
        <div className="setup-title">
          <h1>Első beállítás</h1>
          <button type="button" className="btn btn-ghost btn-small" aria-expanded={help.open} onClick={help.toggleHelp} title="Súgó ehhez a lépéshez (F1)">
            <HelpIcon />
            Súgó
          </button>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={i === step ? 'current' : i < step ? 'done' : undefined}>
              <button type="button" className="step" aria-current={i === step ? 'step' : undefined} onClick={() => setStep(i)} disabled={i > 0 && !(keyMessage?.ok || hasStoredKey)}>
                <span className="nav-step">{i < step ? '✓' : i + 1}</span>
                {s}
              </button>
            </li>
          ))}
        </ol>
      </header>
      <ErrorList errors={errors} />
      {needsData && !bundle && (
        <Card>
          <p>Ehhez a lépéshez be kell tölteni az adatokat.</p>
          <Button variant="primary" onClick={() => void loadData(settings)} disabled={busy}>
            {busy ? 'Betöltés…' : 'Adatok betöltése'}
          </Button>
        </Card>
      )}
      <Card title={STEPS[step]}>
        {step === 0 && (
          <div className="stack">
            <p>
              A program csak olvassa a FlightLoggert. Az API-kulcs a rendszer titoktárolójába kerül (macOS Kulcskarika, Windows DPAPI), a beállítási fájlba nem.
            </p>
            <Field label="FlightLogger API-kulcs" hint="A kulcsot csak ide írd be; a program elmenti és kipróbálja.">
              <div className="row">
                <TextInput type="password" value={apiKey} onChange={setApiKey} ariaLabel="API-kulcs" placeholder="kulcs" />
                <Button variant="primary" onClick={() => void saveKey()} disabled={busy || apiKey.trim().length < 8}>
                  Mentés és próba
                </Button>
              </div>
            </Field>
            {keyMessage && <p className={keyMessage.ok ? 'ok-text' : 'error-text'}>{keyMessage.message}</p>}
            {(keyMessage?.ok || hasStoredKey) && (
              <div className="row">
                <Button variant="primary" onClick={() => void continueWithLive()}>
                  Tovább
                </Button>
              </div>
            )}
          </div>
        )}
        {step === 1 && <AirportEditor settings={settings} onChange={setSettings} />}
        {step === 2 && (
          <div className="stack">
            <h4>Iskolai időjárási minimum</h4>
            <WeatherMinimaEditor settings={settings} onChange={setSettings} />
            <h4>Repülési, szolgálati és pihenőidő-limitek</h4>
            <LimitsEditor settings={settings} onChange={setSettings} />
          </div>
        )}
        {step === 3 && <ResourcesEditor settings={settings} onChange={setSettings} bundle={bundle} />}
        {step === 4 && <ClassroomsEditor settings={settings} onChange={setSettings} bundle={bundle} />}
        {step === 5 && <StudentsEditor settings={settings} onChange={setSettings} bundle={bundle} />}
        {step === 6 && <WorkTimeEditor settings={settings} onChange={setSettings} />}
      </Card>
      {step > 0 && (
        <div className="savebar">
          <span className="savebar-text">
            {step + 1}. lépés a {STEPS.length}-ből
          </span>
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            ← Vissza
          </Button>
          {step < STEPS.length - 1 ? (
            <Button variant="primary" onClick={() => setStep(step + 1)}>
              Tovább: {STEPS[step + 1]} →
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void finish()}>
              Beállítás befejezése
            </Button>
          )}
        </div>
      )}
    </div>
    {loading && <LoadingOverlay title="Gépek, termek és felhasználók betöltése" progress={progress} />}
    </>
  )
}
