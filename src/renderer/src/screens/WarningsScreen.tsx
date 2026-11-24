import { Badge, Button, Card, Empty, ErrorList, PageHeader } from '../components/ui'
import { dateTimeShort, requestLabel, resolveText } from '../format'
import { useApp } from '../state'
import { WeekTag } from '../components/weekTag'

/** Figyelmeztetések (10. fejezet): limitek, kettős foglalások, elavult adatok egy helyen. */
export function WarningsScreen() {
  const app = useApp()
  const { result, weekPlan, bundle, timezone } = app
  if (!result || !weekPlan) return null
  const requests = weekPlan.requests
  const perProposal = result.proposals.flatMap((p) => p.warnings.map((w) => ({ p, w })))
  const groups: Array<[string, typeof perProposal]> = [
    ['Limit-túllépés és jóváhagyott figyelmeztetés', perProposal.filter(({ w }) => ['limitExceeded', 'doubleBooking', 'outsideAvailability', 'hardConstraintOverridden'].includes(w.kind))],
    ['Limit-közelítés', perProposal.filter(({ w }) => w.kind === 'limitApproach')],
    ['Zivatarveszély', perProposal.filter(({ w }) => w.kind === 'weatherRisk')],
    ['Hiányzó adat', perProposal.filter(({ w }) => w.kind === 'staleData')],
  ]
  const emptyGroups = groups.filter(([, items]) => items.length === 0)
  const GENERAL_LABELS: Partial<Record<string, string>> = { longNoFly: 'régen repült', maintenanceDue: 'karbantartás', missingData: 'hiányzó adat', team: 'közös briefing' }
  const personOf = (w: (typeof result.warnings)[number]): string =>
    (w.kind === 'longNoFly' || w.kind === 'missingData') && w.requestId
      ? `${bundle?.directory.people[w.requestId]?.name ?? ''}: `
      : w.kind === 'team' && w.requestId
        ? `${requestLabel(bundle ?? null, requests.find((r) => r.id === w.requestId))}: `
        : ''
  return (
    <div className="page">
      <PageHeader title="Figyelmeztetések" week={<WeekTag />} lead="A FlightLogger saját figyelmeztetéseit ez nem helyettesíti." />
      {bundle && bundle.errors.length > 0 && (
        <Card title="Adatfrissítés">
          <ErrorList errors={bundle.errors} />
        </Card>
      )}
      <Card title={`Általános (${result.warnings.length})`}>
        {result.warnings.length === 0 ? (
          <Empty>Nincs általános figyelmeztetés.</Empty>
        ) : (
          <ul className="plain">
            {result.warnings.map((w, i) => (
              <li key={i}>
                <Badge tone="warn">{GENERAL_LABELS[w.kind] ?? 'adat'}</Badge> {personOf(w)}
                {w.message}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {groups
        .filter(([, items]) => items.length > 0)
        .map(([title, items]) => (
        <Card
          key={title}
          title={`${title} (${items.length})`}
          actions={
            <Button small onClick={() => app.navigate('draft')} title="A foglalások a tervezeten mozgathatók vagy halaszthatók">
              Tervezet megnyitása
            </Button>
          }
        >
          <ul className="plain">
            {items.map(({ p, w }, i) => (
              <li key={i}>
                <strong>{requestLabel(bundle, requests.find((r) => r.id === p.requestId))}</strong>, {dateTimeShort(p.slot.start, timezone)}: {resolveText(w.message, bundle, requests)}
              </li>
            ))}
          </ul>
        </Card>
        ))}
      {result.decisionIssues.length > 0 && (
        <Card
          title={`Megdőlt döntések (${result.decisionIssues.length})`}
          actions={
            <Button small onClick={() => app.navigate('dilemmas')}>
              Dilemmák megnyitása
            </Button>
          }
        >
          <ErrorList errors={result.decisionIssues.map((d) => resolveText(d.message, bundle, requests))} />
        </Card>
      )}
      {emptyGroups.length > 0 && <p className="small muted">Nincs: {emptyGroups.map(([title]) => title.toLowerCase()).join(', ')}.</p>}
    </div>
  )
}
