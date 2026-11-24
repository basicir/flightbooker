import { api, isBrowserDemo } from './bridge'
import { relativeAge } from './format'
import { Dashboard } from './screens/Dashboard'
import { DilemmaWizard } from './screens/DilemmaWizard'
import { DraftView } from './screens/DraftView'
import { FirstSetup } from './screens/FirstSetup'
import { RecordingList } from './screens/RecordingList'
import { SettingsScreen } from './screens/SettingsScreen'
import { Theories } from './screens/Theories'
import { WarningsScreen } from './screens/WarningsScreen'
import { WeeklyRequests } from './screens/WeeklyRequests'
import { useApp, useNow, type ScreenId } from './state'
import { Button, ErrorList, LoadingOverlay, progressSummary } from './components/ui'
import { HelpIcon, useHelp } from './help/HelpPanel'
import { UpdateBanner, useUpdateState } from './update/UpdateGate'
import { DevImportNotice } from './components/devTools'

/** Oldalsáv: áttekintés, a heti munkafolyamat öt lépése sorban, végül a kiegészítők. */
const NAV_GROUPS: ReadonlyArray<{ title?: string; items: ReadonlyArray<{ id: ScreenId; label: string; step?: number }> }> = [
  { items: [{ id: 'dashboard', label: 'Indítópult' }] },
  {
    title: 'Heti tervezés',
    items: [
      { id: 'requests', label: 'Heti igények', step: 1 },
      { id: 'theories', label: 'Elméletek', step: 2 },
      { id: 'dilemmas', label: 'Dilemmák', step: 3 },
      { id: 'draft', label: 'Tervezet', step: 4 },
      { id: 'recording', label: 'Rögzítési lista', step: 5 },
    ],
  },
  {
    title: 'Egyéb',
    items: [
      { id: 'warnings', label: 'Figyelmeztetések' },
      { id: 'settings', label: 'Beállítások' },
    ],
  },
]

export function App() {
  const app = useApp()
  const now = useNow()
  const help = useHelp()
  const update = useUpdateState()
  if (app.phase.kind === 'loading') return <div className="splash">Betöltés…</div>
  if (app.phase.kind === 'error') {
    return (
      <div className="splash">
        <h1>A beállítások nem olvashatók</h1>
        <ErrorList errors={app.phase.errors} />
      </div>
    )
  }
  if (app.phase.kind === 'setup') return <FirstSetup initial={app.phase.draft} />

  const counts: Partial<Record<ScreenId, number>> = {
    dilemmas: app.result?.dilemmas.length ?? 0,
    // A hét közbeni figyelés javaslatai és a tervbe tett, a FlightLoggerben még elvégzendő
    // változtatások a rögzítési listán vannak (TRV-15, 9.7).
    recording:
      (app.watch?.items.length ?? 0) +
      (app.result?.proposals.filter((p) => p.change).length ?? 0) +
      (app.result?.plannedCancels.filter((c) => !c.done).length ?? 0),
    warnings: (app.result?.warnings.length ?? 0) + (app.bundle?.errors.length ?? 0) + (app.result?.decisionIssues.length ?? 0),
  }
  return (
    <>
    <div className="shell" inert={app.dataLoading && !app.dataBackground}>
      <nav className="sidebar" aria-label="Fő navigáció">
        {(isBrowserDemo || update?.channel === 'dev') && (
          <div className="brand">
            {update?.channel === 'dev' && (
              <span className="dev-flag" title={`Fejlesztői változat (${update.currentVersion})`}>
                DEV
              </span>
            )}
            {isBrowserDemo && (
              <span className="demo-flag" title="Böngészős fejlesztői előnézet, szintetikus adattal">
                előnézet
              </span>
            )}
          </div>
        )}
        {NAV_GROUPS.map((g, gi) => (
          <div key={gi}>
            {g.title && <div className="nav-section">{g.title}</div>}
            <ul>
              {g.items.map((n) => (
                <li key={n.id}>
                  <button
                    className={['nav-item', n.id === 'dashboard' ? 'home' : '', app.screen === n.id ? 'active' : ''].filter(Boolean).join(' ')}
                    aria-current={app.screen === n.id ? 'page' : undefined}
                    onClick={() => app.navigate(n.id)}
                  >
                    {n.id === 'dashboard' && <HomeIcon />}
                    {n.step && <span className="nav-step">{n.step}</span>}
                    <span>{n.label}</span>
                    {!!counts[n.id] && <span className="nav-count">{counts[n.id]}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <button
          type="button"
          className={help.open ? 'nav-item help-toggle active' : 'nav-item help-toggle'}
          aria-expanded={help.open}
          onClick={help.toggleHelp}
          title="Súgó az épp nyitott képernyőhöz (F1)"
        >
          <HelpIcon />
          <span>Súgó</span>
          <kbd className="nav-kbd">F1</kbd>
        </button>
        <div className="freshness" aria-live="polite">
          {app.dataLoading && app.dataBackground && app.bundle && (
            <span className="refresh-bg">
              <span className="spinner small-spinner" aria-hidden="true" />
              Frissítés a háttérben… {progressSummary(app.dataProgress)}
            </span>
          )}
          <span>
            {app.dataLoading && !app.dataBackground
              ? `Adatfrissítés… ${progressSummary(app.dataProgress)}`
              : app.bundle
                ? `Adatok: ${relativeAge(app.bundle.fetchedAt, now)}`
                : 'Nincs adat'}
          </span>
          {app.dataLoading ? (
            <Button small variant="ghost" onClick={() => void api.cancelRefresh()}>
              Megszakítás
            </Button>
          ) : (
            <Button small onClick={() => void app.refresh()} title="Friss adatok a FlightLoggerből és az Open-Meteóból">
              Adatok frissítése
            </Button>
          )}
        </div>
      </nav>
      <main className="content">
        <UpdateBanner onOpenSettings={() => app.navigate('settings', { settingsTab: 'Frissítés' })} />
        <DevImportNotice onOpenSettings={() => app.navigate('settings', { settingsTab: 'Adatforrás' })} />
        {app.dataError && <ErrorList errors={[`Adatfrissítési hiba: ${app.dataError}`]} />}
        {app.saveError && (
          <div className="banner error" role="alert">
            {app.saveError} A módosítások a következő sikeres mentésig csak a memóriában vannak.
          </div>
        )}
        {app.planError && (
          <div className="banner error" role="alert">
            A terv számolása nem sikerült: {app.planError}
          </div>
        )}
        {app.screen === 'dashboard' && <Dashboard />}
        {app.screen === 'requests' && <WeeklyRequests />}
        {app.screen === 'theories' && <Theories />}
        {app.screen === 'dilemmas' && <DilemmaWizard />}
        {app.screen === 'draft' && <DraftView />}
        {app.screen === 'recording' && <RecordingList />}
        {app.screen === 'warnings' && <WarningsScreen />}
        {app.screen === 'settings' && <SettingsScreen />}
      </main>
    </div>
    {app.dataLoading && !app.dataBackground && <LoadingOverlay title="Adatok frissítése a FlightLoggerből" progress={app.dataProgress} onCancel={() => void api.cancelRefresh()} />}
    </>
  )
}

/** Az indítópult gombjának ikonja (ház), a szöveg színét követi. */
function HomeIcon() {
  return (
    <svg className="nav-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 7.2 8 2.5l5.5 4.7V13a.5.5 0 0 1-.5.5H9.6V10H6.4v3.5H3a.5.5 0 0 1-.5-.5V7.2Z" />
    </svg>
  )
}
