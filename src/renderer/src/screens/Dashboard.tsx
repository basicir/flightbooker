import { useState } from 'react'
import { findUnclassifiedResources, orderFleet } from '@core/config/operations'
import { manualMoveCount } from '@core/draft/weekPlan'
import { daysBetween, localParts, toMs } from '@core/time/zoned'
import { AircraftHoursCard } from '../components/aircraftHoursCard'
import { Badge, Button, Card, Empty, ErrorList, PageHeader } from '../components/ui'
import { dateTimeFull, hoursMinutes, personName, resourceLabel } from '../format'
import { todayIn, useApp, type ScreenId } from '../state'
import { WeekTag } from '../components/weekTag'
import { WeatherForecastCard } from '../components/weatherForecastCard'
import { WatchCard } from '../components/weekWatch'

/**
 * Indítópult (10. fejezet): hét közbeni figyelés, adatok frissessége, változások,
 * időjárás-előrejelzés a modellek összevetésével, óraszám-bekérés, régen repült növendékek.
 */
export function Dashboard() {
  const app = useApp()
  const { settings, bundle, result, weekPlan, timezone } = app
  const [photoSlot, setPhotoSlot] = useState<HTMLSpanElement | null>(null)
  if (!settings) return null
  const today = todayIn(timezone)
  const fleet = orderFleet(bundle?.snapshot.fleet ?? [], settings.aircraftOrder)
  const unclassified = findUnclassifiedResources(settings, fleet)

  const longNoFly = settings.students
    .map((s) => {
      const last = bundle?.snapshot.lastFlightAt[s.userId]
      const days = last === undefined ? undefined : last === null ? Number.POSITIVE_INFINITY : daysBetween(localParts(toMs(last), timezone).date, today)
      return { id: s.userId, days, threshold: s.longNoFlyDays ?? settings.defaults.longNoFlyDays }
    })
    .filter((x) => x.days !== undefined && x.days >= x.threshold)

  return (
    <div className="page">
      <PageHeader
        title="Indítópult" week={<WeekTag />}
        actions={
          // A karbantartási táblázat fotóról való beolvasása gyakori napi teendő, ezért a gomb fent van; a kártya a meteogram alatt marad.
          // A hét a fejléc hétjelzőjén váltható, mint minden képernyőn.
          <span className="row" ref={setPhotoSlot} />
        }
      />
      <div className="grid-2 grid-dense">
        <WatchCard />
        {app.inventoryChange && (
          <Card title="Változott a gépek vagy termek listája" actions={<Button small onClick={() => void app.acknowledgeInventory()}>Tudomásul vettem</Button>}>
            <ul className="plain">
              {app.inventoryChange.missing.map((id) => (
                <li key={`m${id}`}>
                  <Badge tone="warn">eltűnt</Badge> {resourceLabel(bundle, id)} – a FlightLoggerben már nem látszik (vagy inaktív); a terv nem számol vele.
                </li>
              ))}
              {app.inventoryChange.added.map((id) => (
                <li key={`a${id}`}>
                  <Badge tone="info">új</Badge> {resourceLabel(bundle, id)} – ellenőrizd a besorolását és a növendékek engedélyezett gépeit.
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card title="Adatok">
          {bundle ? (
            <div className="stack">
              <p>
                Forrás: <strong>{bundle.source === 'demo' ? 'szintetikus adat (fejlesztői előnézet)' : 'FlightLogger és Open-Meteo'}</strong>
                <br />
                Utolsó frissítés: <strong>{dateTimeFull(bundle.fetchedAt, timezone)}</strong>
              </p>
              <p className="muted">
                {fleet.length} erőforrás, {bundle.snapshot.bookings.length} foglalás, {bundle.snapshot.weather.length} órás előrejelzés.
              </p>
              <ErrorList errors={bundle.errors} />
            </div>
          ) : (
            <Empty>{app.dataLoading ? 'Adatfrissítés folyamatban…' : 'Még nincs betöltött adat.'}</Empty>
          )}
        </Card>

        <Card title="Tervezés állapota">
          {result && weekPlan ? (
            <div className="stack">
              <div className="stats">
                <Stat label="igény" value={weekPlan.requests.length} />
                <Stat label="javaslat" value={result.proposals.length} />
                <Stat label="dilemma" value={result.dilemmas.length} tone={result.dilemmas.length > 0 ? 'warn' : 'ok'} />
                <Stat label="foglalatlan" value={result.unplaced.length} tone={result.unplaced.length > 0 ? 'warn' : 'ok'} />
              </div>
              <NextStep
                requests={weekPlan.requests.length}
                dilemmas={result.dilemmas.length}
                accepted={Boolean(weekPlan.acceptedAt)}
                onGo={app.navigate}
              />
            </div>
          ) : (
            <Empty>A terv az adatok betöltése után készül el.</Empty>
          )}
        </Card>

        <WeatherForecastCard settings={settings} bundle={bundle} weekStart={app.weekStart} today={today} />

        {weekPlan?.metrics && result && (
          <Card title="Mérőszámok a héten">
            <p className="small muted">A sikerkritériumokhoz, helyben gyűjtve (csak ezen a gépen, név nélkül).</p>
            <div className="stats">
              <Stat label="legtöbb dilemma" value={weekPlan.metrics.maxDilemmas} tone={weekPlan.metrics.maxDilemmas > 10 ? 'warn' : 'ok'} />
              <Stat label="kézi mozgatás" value={manualMoveCount(weekPlan)} />
              <Stat label="változatlan javaslat" value={result.proposals.filter((p) => p.decidedBy === 'engine' && !p.standby).length} />
            </div>
            <p className="small">
              Tervezési idő:{' '}
              {weekPlan.metrics.firstRecordedAt
                ? hoursMinutes(Math.max(0, Math.round((Date.parse(weekPlan.metrics.firstRecordedAt) - Date.parse(weekPlan.metrics.openedAt)) / 60_000)))
                : 'a hét első rögzítéséig mérjük'}
            </p>
          </Card>
        )}


      </div>
      {/*
        Az időjárás-előrejelzés alatti kártyák külön rácsban: a sűrű kitöltés (grid-dense) így nem húzhatja
        az időjárás-előrejelzés fölé a kirepülhető időt, amikor fölötte üres cella marad.
      */}
      <div className="grid-2 grid-dense grid-after">
        <AircraftHoursCard settings={settings} fleet={fleet} today={today} photoButtonTarget={photoSlot} />

        <Card title="Régen repült növendékek">
          {longNoFly.length === 0 ? (
            <Empty>Nincs a küszöbnél régebben repült növendék.</Empty>
          ) : (
            <ul className="plain">
              {longNoFly.map((x) => (
                <li key={x.id}>
                  {personName(bundle, x.id)} <Badge tone="warn">{Number.isFinite(x.days!) ? `${x.days} napja` : 'még nem repült'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {unclassified.length > 0 && (
          <Card title="Új erőforrás" actions={<Button small onClick={() => app.navigate('settings', { settingsTab: 'Gépek' })}>Besorolás</Button>}>
            <ul className="plain">
              {unclassified.map((u) => (
                <li key={u.aircraftId}>
                  {u.callSign} ({u.model}) – javaslat: {u.suggestedKind === 'simulator' ? 'szimulátor' : 'repülőgép'}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  )
}

/**
 * A tervezés soron következő lépése egyetlen fő gombbal (a lépések listája az oldalsávon van):
 * igények nélkül a felvétel, nyitott dilemmánál a döntés, utána a tervezet, elfogadás után a rögzítés.
 */
function NextStep(props: { requests: number; dilemmas: number; accepted: boolean; onGo: (screen: ScreenId) => void }) {
  const next: { screen: ScreenId; label: string; hint: string } =
    props.requests === 0
      ? { screen: 'requests', label: 'Heti igények felvétele', hint: 'Még nincs igény a héten.' }
      : props.dilemmas > 0
        ? { screen: 'dilemmas', label: `Dilemmák eldöntése (${props.dilemmas})`, hint: 'A terv a döntésekre vár.' }
        : !props.accepted
          ? { screen: 'draft', label: 'Tervezet átnézése', hint: 'Minden dilemma eldőlt; nézd át és fogadd el a tervet.' }
          : { screen: 'recording', label: 'Rögzítési lista', hint: 'A terv elfogadva; jöhet a FlightLoggerbe vitel.' }
  return (
    <div className="next-step">
      <span className="muted">{next.hint}</span>
      <Button variant="primary" onClick={() => props.onGo(next.screen)}>
        {next.label} →
      </Button>
    </div>
  )
}

function Stat(props: { label: string; value: number; tone?: 'ok' | 'warn' }) {
  return (
    <div className={`stat ${props.tone ?? ''}`}>
      <span className="stat-value">{props.value}</span>
      <span className="stat-label">{props.label}</span>
    </div>
  )
}
