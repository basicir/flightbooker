import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { UpdateState } from '../../../shared/api'
import { api } from '../bridge'

/**
 * A program frissítése a felületen (FRS-01, FRS-06–FRS-08).
 *
 * Indításkor a kapu addig tartja vissza a programot (a beállítások és az adatok betöltését),
 * amíg a főfolyamat ellenőrzi, van-e új kiadás: ha nincs, a program simán megnyílik; ha van és az
 * automatikus frissítés be van kapcsolva, a letöltés és a telepítés állása látszik, utána a
 * program újraindul. A „Kihagyás” gombbal a mostani verzió azonnal indul.
 */

const UpdateContext = createContext<UpdateState | null>(null)

/** A frissítés állapota (a kapun belül mindig van). */
export function useUpdateState(): UpdateState | null {
  return useContext(UpdateContext)
}

export const channelLabel = (channel: UpdateState['channel']): string =>
  channel === 'dev' ? 'fejlesztői (dev)' : channel === 'stable' ? 'fő kiadás' : 'nincs (helyi változat)'

export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

export function UpdateGate(props: { children: ReactNode }) {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    let active = true
    const unsubscribe = api.onUpdateState((s) => setState(s))
    void api.getUpdateState().then((s) => {
      if (active) setState((prev) => prev ?? s)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])
  const isDev = state?.channel === 'dev'
  useEffect(() => {
    document.title = isDev ? 'Foglalástervező DEV' : 'Foglalástervező'
  }, [isDev])

  if (!state) return <div className="splash">Indítás…</div>
  const busy = state.phase === 'downloading' || state.phase === 'installing' || (state.startup && state.phase === 'checking')
  return (
    <UpdateContext.Provider value={state}>
      {!state.startup && props.children}
      {state.startup && !busy && <div className="splash">Indítás…</div>}
      {busy && <UpdateOverlay state={state} />}
    </UpdateContext.Provider>
  )
}

function UpdateOverlay(props: { state: UpdateState }) {
  const { state } = props
  const p = state.progress
  const pct = p && p.total > 0 ? Math.round((p.received / p.total) * 100) : 0
  const title =
    state.phase === 'checking'
      ? 'Frissítés keresése…'
      : state.phase === 'downloading'
        ? `Frissítés letöltése: ${state.latestVersion ?? ''}`
        : 'Frissítés telepítése, a program újraindul…'
  return (
    <div className="loading-overlay" role="alertdialog" aria-modal="true" aria-busy="true" aria-labelledby="update-title">
      <div className="loading-panel" aria-live="polite">
        <div className="loading-head">
          <span className="spinner" aria-hidden="true" />
          <strong id="update-title">{title}</strong>
        </div>
        {state.phase === 'downloading' && (
          <>
            <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div className="progress-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
            </div>
            {p && (
              <span className="muted small">
                {formatMegabytes(p.received)} / {formatMegabytes(p.total)} ({pct}%)
              </span>
            )}
          </>
        )}
        <span className="muted small">
          Jelenlegi verzió: {state.currentVersion} · csatorna: {channelLabel(state.channel)}
        </span>
        {state.phase !== 'installing' && (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => void api.skipUpdate()}>
            {state.phase === 'checking' ? 'Kihagyás, indítás most' : 'Letöltés megszakítása, indítás a mostani verzióval'}
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Sáv a tartalom tetején, ha van új verzió, de a program nem telepítette magától (kikapcsolt
 * automatikus frissítés, vagy a gépen csak kézzel telepíthető).
 */
export function UpdateBanner(props: { onOpenSettings: () => void }) {
  const state = useUpdateState()
  const [hidden, setHidden] = useState<string | null>(null)
  if (!state || !state.latestVersion || hidden === state.latestVersion) return null
  if (state.phase !== 'available' && state.phase !== 'error') return null
  return (
    <div className="banner info row" role="status">
      <span>
        Új verzió érhető el: <strong>{state.latestVersion}</strong> (most: {state.currentVersion}).
        {!state.canInstall && state.installBlocker && ` ${state.installBlocker}`}
      </span>
      <span className="row">
        {state.canInstall && (
          <button type="button" className="btn btn-primary btn-small" onClick={() => void api.installUpdate()}>
            Telepítés most
          </button>
        )}
        {state.releaseUrl && (
          <a className="btn btn-ghost btn-small" href={state.releaseUrl} target="_blank" rel="noreferrer">
            Kiadási jegyzet
          </a>
        )}
        <button type="button" className="btn btn-ghost btn-small" onClick={props.onOpenSettings}>
          Beállítások
        </button>
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setHidden(state.latestVersion ?? null)}>
          Később
        </button>
      </span>
    </div>
  )
}
