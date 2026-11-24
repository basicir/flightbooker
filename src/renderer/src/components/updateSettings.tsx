import { useState } from 'react'
import { api } from '../bridge'
import { channelLabel, useUpdateState } from '../update/UpdateGate'
import { Badge, Button, Checkbox } from './ui'

/** Beállítások → Frissítés (FRS-06): verzió, csatorna, automatikus frissítés, kézi ellenőrzés. */
export function UpdateSettings() {
  const state = useUpdateState()
  const [error, setError] = useState<string | null>(null)
  if (!state) return null
  const disabled = state.channel === null
  const busy = state.phase === 'checking' || state.phase === 'downloading' || state.phase === 'installing'
  const run = (action: () => Promise<unknown>): void => {
    setError(null)
    void action().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  return (
    <div className="stack">
      <p>
        Verzió: <strong>{state.currentVersion}</strong> · Csatorna: <strong>{channelLabel(state.channel)}</strong>{' '}
        {state.channel === 'dev' && <Badge tone="warn">DEV</Badge>}
      </p>
      {disabled ? (
        <p className="muted">
          Ez helyben épített vagy fejlesztői változat, ezért nem frissül magától. A kiadott program minden indításkor megnézi a GitHubon, van-e újabb kiadás.
        </p>
      ) : (
        <>
          <Checkbox
            checked={state.autoUpdate}
            onChange={(enabled) => run(() => api.setAutoUpdate(enabled))}
            label="Automatikus frissítés: indításkor magától letölti és telepíti az új verziót"
          />
          <p className="muted small">
            Kikapcsolva a program indításkor csak jelzi az új verziót, és a telepítést te indítod. A beállítás erre a gépre szól, az exportba nem kerül.
          </p>
          <div className="row">
            <Button disabled={busy} onClick={() => run(() => api.checkForUpdates())}>
              Frissítés keresése most
            </Button>
            {state.latestVersion && state.canInstall && (state.phase === 'available' || state.phase === 'error') && (
              <Button variant="primary" onClick={() => run(() => api.installUpdate())}>
                {state.latestVersion} telepítése most
              </Button>
            )}
            {state.releaseUrl && (
              <a className="btn btn-ghost" href={state.releaseUrl} target="_blank" rel="noreferrer">
                Kiadási jegyzet
              </a>
            )}
          </div>
          <UpdateStatus />
        </>
      )}
      {error && <p className="con-text">{error}</p>}
    </div>
  )
}

function UpdateStatus() {
  const state = useUpdateState()
  if (!state) return null
  const checked = state.checkedAt ? ` (ellenőrizve: ${new Date(state.checkedAt).toLocaleString('hu-HU')})` : ''
  switch (state.phase) {
    case 'checking':
      return <p className="muted">Frissítés keresése…</p>
    case 'up-to-date':
      return <p>Ez a legújabb verzió{checked}.</p>
    case 'available':
      return (
        <p>
          Új verzió érhető el: <strong>{state.latestVersion}</strong>
          {checked}.{!state.canInstall && state.installBlocker && <span className="con-text"> {state.installBlocker}</span>}
        </p>
      )
    case 'downloading':
      return <p className="muted">Letöltés…</p>
    case 'installing':
      return <p className="muted">Telepítés, a program újraindul…</p>
    case 'error':
      return <p className="con-text">{state.message ?? 'A frissítés nem sikerült.'}</p>
    default:
      return null
  }
}
