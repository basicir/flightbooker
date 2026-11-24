import { useCallback, useEffect, useState } from 'react'
import type { PromotionRun, PromotionState } from '../../../shared/api'
import { api } from '../bridge'
import { Button, Field, TextInput } from './ui'

/**
 * A fejlesztői (DEV) változat eszközei (FRS-09, FRS-10). Csak a DEV-ben jelenik meg (a
 * Frissítés fülön); a fő változatban a főfolyamat a hozzájuk tartozó hívásokat sem kezeli.
 */
export function DevTools() {
  return (
    <div className="stack">
      <h4>Fejlesztői eszközök (csak a DEV-ben)</h4>
      <StableImport />
      <Promotion />
    </div>
  )
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const IMPORT_CONFIRM =
  'Beállítások átvétele a Foglalástervezőből\n\n' +
  'A DEV mostani beállítása, mentett heti tervei és saját feladatsorai helyére a fő változatéi kerülnek, a DEV gyorsítótára törlődik. ' +
  'A fő változathoz a program nem nyúl. Az API-kulcs nem jön át: a DEV-ben külön kell megadni.\n\n' +
  'Utána a program újraindul. Átveszed?'

/** A fő változat beállításainak átvétele (FRS-10). */
function StableImport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (): Promise<void> => {
    if (!window.confirm(IMPORT_CONFIRM)) return
    setBusy(true)
    setError(null)
    try {
      const r = await api.dev.importFromStable()
      const parts = [`beállítás (${r.students} növendékkel)`, `${r.plans} heti terv`, `${r.syllabi} saját feladatsor`, ...(r.weatherLog ? ['az időjárás-modellek mérése'] : [])]
      window.alert(`Átvéve: ${parts.join(', ')}.\n\nA program most újraindul.`)
      await api.dev.relaunch()
    } catch (e) {
      setError(messageOf(e))
      setBusy(false)
    }
  }
  return (
    <div className="stack">
      <p>
        <strong>Beállítások átvétele.</strong> A Foglalástervező (fő változat) beállítása, növendékei, mentett heti tervei és saját feladatsorai átkerülnek ide, hogy a DEV-et
        ugyanazzal az adattal próbálhasd ki. Az API-kulcsot a Beállítások → Adatforrás fülön add meg.
      </p>
      <div className="row">
        <Button disabled={busy} onClick={() => void run()}>
          {busy ? 'Átvétel…' : 'Beállítások átvétele a Foglalástervezőből'}
        </Button>
      </div>
      {error && <p className="con-text">{error}</p>}
    </div>
  )
}

const TOKEN_HELP_URL = 'https://github.com/settings/personal-access-tokens/new'

/** A „Kiadás: dev → main” gomb (FRS-09): a futó DEV-verzió kiadása fő kiadásként. */
function Promotion() {
  const [state, setState] = useState<PromotionState | null>(null)
  const [token, setToken] = useState('')
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  // Minden lekérés egy „kör”: a refresh csak a kört lépteti, a lekérés a hatásban fut.
  const [round, setRound] = useState(0)
  const refresh = useCallback(() => setRound((r) => r + 1), [])
  useEffect(() => {
    let active = true
    api.dev.getPromotionState().then(
      (s) => {
        if (active) setState(s)
      },
      (e: unknown) => {
        if (active) setMessage({ ok: false, text: messageOf(e) })
      },
    )
    return () => {
      active = false
    }
  }, [round])
  // Amíg a kiadás a GitHubon fut, 10 másodpercenként frissül az állapota.
  const running = state?.lastRun ? state.lastRun.status !== 'completed' : false
  useEffect(() => {
    if (!running) return
    const timer = setInterval(refresh, 10_000)
    return () => clearInterval(timer)
  }, [running, refresh])

  if (!state) return null
  const shortCommit = state.buildCommit ? state.buildCommit.slice(0, 7) : null

  const saveToken = async (): Promise<void> => {
    setBusy(true)
    const result = await api.dev.saveGithubToken(token).catch((e: unknown) => ({ ok: false, message: messageOf(e) }))
    setToken('')
    setMessage({ ok: result.ok, text: result.message })
    refresh()
    setBusy(false)
  }

  const clearToken = async (): Promise<void> => {
    if (!window.confirm('Törlöd a mentett GitHub-tokent?')) return
    await api.dev.clearGithubToken()
    setMessage(null)
    refresh()
  }

  const start = async (): Promise<void> => {
    const confirmText =
      'Fő kiadás: dev → main\n\n' +
      `A most futó DEV-verzió (${state.buildVersion}, commit ${shortCommit ?? '?'}) kerül ki fő kiadásként. ` +
      'Minden telepített Foglalástervező a következő indításkor frissül rá.\n\nIndítod?'
    if (!window.confirm(confirmText)) return
    setBusy(true)
    setMessage(null)
    try {
      setState(await api.dev.startPromotion())
      setMessage({ ok: true, text: 'A kiadás elindult a GitHubon (kb. 5 perc). Az állapota itt frissül.' })
      // A GitHub pár másodperc múlva veszi fel az új futást.
      setTimeout(refresh, 5_000)
    } catch (e) {
      setMessage({ ok: false, text: messageOf(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <p>
        <strong>Kiadás: dev → main.</strong> A most futó DEV-verziót adja ki fő kiadásként: pontosan ezt a commitot, akkor is, ha a dev ágon azóta újabb változás van.
        Minden telepített Foglalástervező a következő indításkor frissül rá.
      </p>
      <p className="muted small">
        Kiadandó: <strong>{state.buildVersion}</strong> · commit {shortCommit ? <code>{shortCommit}</code> : 'ismeretlen (helyi build, nem adható ki)'}
      </p>
      {state.tokenSaved ? (
        <div className="row">
          <span>GitHub-token: mentve a Kulcskarikában.</span>
          <Button variant="ghost" onClick={() => void clearToken()}>
            Token törlése
          </Button>
        </div>
      ) : (
        <Field
          label="GitHub-token"
          hint="Egyszer kell. GitHub → Fine-grained token: Repository access → Only select repositories → flightbooker; Permissions → Actions: Read and write. A program kipróbálja, és a Kulcskarikába menti; a token sehol máshol nem jelenik meg."
        >
          <div className="row">
            <TextInput type="password" value={token} onChange={setToken} ariaLabel="GitHub-token" placeholder="github_pat_…" />
            <Button variant="primary" disabled={busy || token.trim().length < 20} onClick={() => void saveToken()}>
              Mentés és próba
            </Button>
            <a className="btn btn-ghost" href={TOKEN_HELP_URL} target="_blank" rel="noreferrer">
              Token létrehozása a GitHubon
            </a>
          </div>
        </Field>
      )}
      <div className="row">
        <Button variant="primary" disabled={busy || running || !state.tokenSaved || !state.buildCommit} onClick={() => void start()}>
          {running ? 'Kiadás folyamatban…' : 'Kiadás: dev → main'}
        </Button>
      </div>
      {state.lastRun && <RunStatus run={state.lastRun} />}
      {state.error && <p className="con-text">{state.error}</p>}
      {message && <p className={message.ok ? 'ok-text' : 'con-text'}>{message.text}</p>}
    </div>
  )
}

function runLabel(run: PromotionRun): string {
  if (run.status === 'in_progress') return 'fut'
  if (run.status !== 'completed') return 'várakozik'
  switch (run.conclusion) {
    case 'success':
      return 'sikeres – a fő kiadás elkészült'
    case 'failure':
      return 'sikertelen'
    case 'cancelled':
      return 'megszakítva'
    default:
      return run.conclusion ?? 'befejeződött'
  }
}

function RunStatus(props: { readonly run: PromotionRun }) {
  const { run } = props
  const failed = run.status === 'completed' && run.conclusion !== 'success'
  return (
    <p className={failed ? 'con-text' : undefined}>
      Utolsó kiadás ({new Date(run.createdAt).toLocaleString('hu-HU')}): <strong>{runLabel(run)}</strong>.{' '}
      <a href={run.url} target="_blank" rel="noreferrer">
        Megnyitás a GitHubon
      </a>
    </p>
  )
}
