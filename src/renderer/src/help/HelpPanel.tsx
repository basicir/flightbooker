import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApp } from '../state'
import { HELP, SCREEN_HELP, type HelpBlock, type HelpTarget } from './helpContent'
import { allSections, findSection, parseInline, searchHelp } from './helpText'

/**
 * A program súgója: jobb oldalt nyíló panel, amely az épp nyitott képernyőhöz tartozó részt
 * mutatja. F1-re vagy az oldalsáv Súgó gombjára nyílik, Esc-re (a panelen belül) bezárul.
 * Nem modális: olvasás közben a képernyő tovább használható.
 */

interface HelpApi {
  readonly open: boolean
  /** Megnyitja a súgót; szakasz nélkül az aktuális képernyőhöz tartozót mutatja. */
  readonly openHelp: (sectionId?: string) => void
  readonly toggleHelp: () => void
  readonly closeHelp: () => void
  /** A képernyő pontosabb súgótémát jelez (például a Beállítások aktuális füle). */
  readonly setTopic: (sectionId: string | null) => void
}

const HelpContext = createContext<HelpApi | null>(null)

export function useHelp(): HelpApi {
  const ctx = useContext(HelpContext)
  if (!ctx) throw new Error('A useHelp csak a HelpProvideren belül használható.')
  return ctx
}

/** A képernyő ezzel jelzi, melyik súgószakasz illik hozzá a legjobban (amíg látszik). */
export function useHelpTopic(sectionId: string | null): void {
  const { setTopic } = useHelp()
  useEffect(() => {
    setTopic(sectionId)
    return () => setTopic(null)
  }, [sectionId, setTopic])
}

export function HelpProvider(props: { children: ReactNode }) {
  const app = useApp()
  const [open, setOpen] = useState(false)
  const [sectionId, setSectionId] = useState<string>('alapelvek')
  const [topic, setTopic] = useState<string | null>(null)

  const contextSection = useCallback((): string => {
    if (topic) return topic
    if (app.phase.kind === 'ready') return SCREEN_HELP[app.screen]
    return 'beallitas-attekintes'
  }, [topic, app.phase.kind, app.screen])

  const openHelp = useCallback(
    (id?: string) => {
      setSectionId(id ?? contextSection())
      setOpen(true)
    },
    [contextSection],
  )
  const closeHelp = useCallback(() => setOpen(false), [])
  const toggleHelp = useCallback(() => {
    if (open) setOpen(false)
    else openHelp()
  }, [open, openHelp])

  // F1: súgó az aktuális képernyőhöz (nyitott súgónál a képernyő témájára ugrik).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'F1') return
      e.preventDefault()
      openHelp()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openHelp])

  // Nyitott súgónál a tartalom keskenyebb, hogy a panel ne takarja el (lásd styles.css).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-help-open', open)
  }, [open])

  const api = useMemo<HelpApi>(() => ({ open, openHelp, toggleHelp, closeHelp, setTopic }), [open, openHelp, toggleHelp, closeHelp])
  return (
    <HelpContext.Provider value={api}>
      {props.children}
      {open && <HelpPanel sectionId={sectionId} contextId={contextSection()} onSection={setSectionId} onClose={closeHelp} />}
    </HelpContext.Provider>
  )
}

const SCREEN_NAMES: Readonly<Record<HelpTarget['screen'], string>> = {
  dashboard: 'Indítópult',
  requests: 'Heti igények',
  theories: 'Elméletek',
  dilemmas: 'Dilemmák',
  draft: 'Tervezet',
  recording: 'Rögzítési lista',
  warnings: 'Figyelmeztetések',
  settings: 'Beállítások',
}

function HelpPanel(props: { sectionId: string; contextId: string; onSection: (id: string) => void; onClose: () => void }) {
  const app = useApp()
  const [query, setQuery] = useState('')
  const [showToc, setShowToc] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLElement>(null)

  const found = findSection(HELP, props.sectionId) ?? findSection(HELP, 'alapelvek')!
  const { section, chapter } = found
  const order = allSections(HELP)
  const index = order.findIndex((s) => s.id === section.id)
  const prev = index > 0 ? order[index - 1] : undefined
  const next = index < order.length - 1 ? order[index + 1] : undefined
  const hits = useMemo(() => searchHelp(HELP, query), [query])
  const searching = query.trim().length > 0

  const go = (id: string): void => {
    props.onSection(id)
    setQuery('')
    setShowToc(false)
  }
  // Új szakasznál a panel a tetejéről indul.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 })
  }, [props.sectionId, showToc, searching])
  // Megnyitáskor a fókusz a panelre kerül, hogy billentyűzettel is olvasható legyen.
  useEffect(() => {
    panelRef.current?.focus()
  }, [])

  const target = section.open
  // Az „Ugrás ide” gomb csak akkor látszik, ha a szakasz képernyője (füle) nincs épp nyitva.
  const here = target !== undefined && app.screen === target.screen && (!target.settingsTab || props.contextId === section.id)
  const canJump = target && app.phase.kind === 'ready' && !here

  return (
    <aside
      ref={panelRef}
      className="help-panel"
      aria-label="Súgó"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          props.onClose()
        }
      }}
    >
      <header className="help-head">
        <div className="help-title">
          <HelpIcon />
          <strong>Súgó</strong>
          <button type="button" className="help-close" onClick={props.onClose} aria-label="A súgó bezárása" title="Bezárás (Esc)">
            ×
          </button>
        </div>
        <input
          className="input help-search"
          type="search"
          placeholder="Keresés a súgóban…"
          aria-label="Keresés a súgóban"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="help-tools">
          <button type="button" className={showToc && !searching ? 'help-tab active' : 'help-tab'} onClick={() => { setQuery(''); setShowToc(true) }} aria-pressed={showToc && !searching}>
            Tartalom
          </button>
          <button type="button" className={!showToc && !searching ? 'help-tab active' : 'help-tab'} onClick={() => { setQuery(''); setShowToc(false) }} aria-pressed={!showToc && !searching}>
            {section.title}
          </button>
        </div>
      </header>

      <div className="help-body" ref={bodyRef}>
        {searching ? (
          <div className="help-results" aria-live="polite">
            {hits.length === 0 ? (
              <p className="muted">Nincs találat. Próbálj más szót, vagy nézd meg a tartalomjegyzéket.</p>
            ) : (
              <>
                <p className="muted small">{hits.length} találat</p>
                <ul>
                  {hits.map((hit) => (
                    <li key={hit.section.id}>
                      <button type="button" className="help-result" onClick={() => go(hit.section.id)}>
                        <span className="help-result-chapter">
                          {hit.chapter.number}. {hit.chapter.title}
                        </span>
                        <strong>{hit.section.title}</strong>
                        {hit.snippet && <span className="help-result-snippet">{hit.snippet}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        ) : showToc ? (
          <nav className="help-toc" aria-label="A súgó tartalma">
            <ol>
              {HELP.map((c) => (
                <li key={c.number}>
                  <span className="help-toc-chapter">
                    <span className="help-num">{c.number}</span>
                    {c.title}
                  </span>
                  <ul>
                    {c.sections.map((s) => (
                      <li key={s.id}>
                        <button type="button" className={s.id === section.id ? 'link current' : 'link'} onClick={() => go(s.id)}>
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          <article className="help-article">
            <p className="help-crumb">
              {chapter.number}. {chapter.title}
            </p>
            <h2>{section.title}</h2>
            {section.blocks.map((b, i) => (
              <Block key={i} block={b} onLink={go} />
            ))}
            {canJump && (
              <p>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => app.navigate(target.screen, target.settingsTab ? { settingsTab: target.settingsTab } : undefined)}>
                  Ugrás ide: {SCREEN_NAMES[target.screen]}
                  {target.settingsTab ? ` → ${target.settingsTab}` : ''}
                </button>
              </p>
            )}
            <nav className="help-pager" aria-label="Lapozás a súgóban">
              {prev ? (
                <button type="button" className="link" onClick={() => go(prev.id)}>
                  ‹ {prev.title}
                </button>
              ) : (
                <span />
              )}
              {next && (
                <button type="button" className="link" onClick={() => go(next.id)}>
                  {next.title} ›
                </button>
              )}
            </nav>
          </article>
        )}
      </div>
    </aside>
  )
}

function Inline(props: { text: string; onLink: (id: string) => void }) {
  return (
    <>
      {parseInline(props.text).map((part, i) => {
        switch (part.kind) {
          case 'text':
            return <Fragment key={i}>{part.text}</Fragment>
          case 'ui':
            return <strong key={i}>{part.text}</strong>
          case 'key':
            return <kbd key={i}>{part.text}</kbd>
          case 'link':
            return (
              <button key={i} type="button" className="link" onClick={() => props.onLink(part.target)}>
                {part.text}
              </button>
            )
        }
      })}
    </>
  )
}

const NOTE_LABEL = { tip: 'Tipp', important: 'Fontos', info: 'Jó tudni' } as const

function Block(props: { block: HelpBlock; onLink: (id: string) => void }) {
  const { block, onLink } = props
  switch (block.kind) {
    case 'p':
      return (
        <p>
          <Inline text={block.text} onLink={onLink} />
        </p>
      )
    case 'h':
      return (
        <h3>
          <Inline text={block.text} onLink={onLink} />
        </h3>
      )
    case 'list':
    case 'steps': {
      const items = block.items.map((t, i) => (
        <li key={i}>
          <Inline text={t} onLink={onLink} />
        </li>
      ))
      return block.kind === 'steps' ? <ol>{items}</ol> : <ul>{items}</ul>
    }
    case 'note':
      return (
        <div className={`help-note ${block.tone}`}>
          <span className="help-note-label">{NOTE_LABEL[block.tone]}</span>
          <p>
            <Inline text={block.text} onLink={onLink} />
          </p>
        </div>
      )
    case 'table':
      return (
        <div className="help-table-wrap">
          <table className="help-table">
            <thead>
              <tr>
                {block.head.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((c, i) => (
                    <td key={i}>
                      <Inline text={c} onLink={onLink} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
  }
}

/** Kérdőjel körben, a szöveg színét követi. */
export function HelpIcon() {
  return (
    <svg className="nav-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" />
      <path d="M6.3 6.3a1.8 1.8 0 1 1 2.5 1.65c-.5.22-.8.6-.8 1.1v.35" strokeLinecap="round" />
      <circle cx="8" cy="11.4" r=".55" fill="currentColor" stroke="none" />
    </svg>
  )
}
