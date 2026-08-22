import { useState, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasGeometry, CanvasMode, CanvasState } from './canvas-state.ts'
import { THEME_IDS, TITLE_BAR } from './canvas-state.ts'

/** The formats the header offers, in the order the menu lists them. */
export const EXPORT_FORMATS = ['html', 'pdf', 'pptx'] as const
export type ExportFormat = (typeof EXPORT_FORMATS)[number]

/**
 * Props: the canvas fact bound from the injected `hooks` compartment, plus the
 * plain callbacks that write it.
 */
export interface DeckOverlayProps {
  readonly useDeckCanvas: <S>(select: (state: CanvasState) => S, equal?: (a: S, b: S) => boolean) => S
  readonly close: () => void
  readonly place: (geometry: CanvasGeometry) => void
  readonly setTheme: (theme: string) => void
  readonly setMode: (mode: CanvasMode) => void
  readonly startExport: (format: ExportFormat) => void
}

/**
 * The deck canvas, floating over the whole app.
 *
 * Registered into `shell.overlay` — a root-scoped list slot the shell documents
 * as the seat for "a surface of your own that floats over the whole app". Root
 * scope is the point: one canvas exists for the session's lifetime and
 * retargets to whichever deck was last opened, so a long conversation does not
 * accumulate a column of stale deck frames.
 *
 * Dragging the title bar moves it and the corner grip resizes it, because a
 * canvas fixed to one corner covers the composer and cannot be put beside the
 * text it is being checked against. Both write through the controller, whose
 * state is root-scoped, so a canvas placed once stays placed across turns.
 *
 * Slide navigation is deliberately absent: the deck ships its own controls and
 * key handling inside the frame, and a second set beside them would be a
 * duplicate that can disagree with the deck about which slide is showing.
 *
 * Renders nothing while closed, which keeps the overlay layer empty and the app
 * fully clickable.
 * @param props - the canvas fact and its callbacks.
 * @returns the floating canvas, or null while closed.
 */
export function DeckOverlay({ useDeckCanvas, close, place, setTheme, setMode, startExport }: DeckOverlayProps) {
  const view = useDeckCanvas(state => state.view)
  const open = useDeckCanvas(state => state.open)
  const geometry = useDeckCanvas(state => state.geometry)
  const theme = useDeckCanvas(state => state.theme)
  const mode = useDeckCanvas(state => state.mode)
  const exportStatus = useDeckCanvas(state => state.exportStatus)
  const exportError = useDeckCanvas(state => state.exportError)
  const [menuOpen, setMenuOpen] = useState(false)
  const drag = useRef<{ pointer: number, from: CanvasGeometry, x: number, y: number, mode: 'move' | 'size' } | null>(null)

  const start = (mode: 'move' | 'size') => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, from: geometry, x: event.clientX, y: event.clientY, mode }
  }
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const active = drag.current
    if (active === null || active.pointer !== event.pointerId) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    place(active.mode === 'move'
      ? { ...active.from, x: active.from.x + dx, y: active.from.y + dy }
      : { ...active.from, width: active.from.width + dx, height: active.from.height + dy })
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointer === event.pointerId) drag.current = null
  }

  if (!open || view === null) return null
  const shown = theme ?? view.theme
  // The deck reads `?theme=` and `?mode=` at startup (src/framework/deck.ts),
  // so changing them re-renders the frame in the chosen theme — no message
  // channel between the canvas and the deck, and the same mechanism the
  // export extractor uses.
  const frameSrc = `${view.route}?theme=${encodeURIComponent(shown)}&mode=${mode}`
  return (
    <div style={{ ...PANEL, left: geometry.x, top: geometry.y, width: geometry.width, height: geometry.height }} role="dialog" aria-label={`Deck ${view.deckId}`}>
      <div
        style={BAR}
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <span style={TITLE}>{view.deckId}</span>
        <select
          style={SELECT}
          aria-label="Theme"
          value={shown}
          onPointerDown={stopDrag}
          onChange={(event) => { setTheme(event.target.value) }}
        >
          {THEME_IDS.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
        <button
          type="button"
          style={BUTTON}
          aria-label="Toggle light or dark"
          onPointerDown={stopDrag}
          onClick={() => { setMode(mode === 'dark' ? 'light' : 'dark') }}
        >
          {mode === 'dark' ? 'Dark' : 'Light'}
        </button>
        {exportStatus !== null
          ? (
            <span style={PROGRESS}>
              {exportStatus.format.toUpperCase()} · {exportStatus.done} / {exportStatus.total}
            </span>
          )
          : (
            <span style={MENU_ANCHOR}>
              <button
                type="button"
                style={BUTTON}
                aria-label="Export"
                aria-expanded={menuOpen}
                onPointerDown={stopDrag}
                onClick={() => { setMenuOpen(open => !open) }}
              >
                Export
              </button>
              {menuOpen && (
                <span style={MENU} role="menu">
                  {EXPORT_FORMATS.map(format => (
                    <button
                      key={format}
                      type="button"
                      role="menuitem"
                      style={MENU_ITEM}
                      onPointerDown={stopDrag}
                      onClick={() => { setMenuOpen(false); startExport(format) }}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
        <a style={BUTTON} href={frameSrc} target="_blank" rel="noreferrer" onPointerDown={stopDrag}>Open in tab</a>
        <button type="button" style={BUTTON} aria-label="Close canvas" onPointerDown={stopDrag} onClick={close}>Close</button>
      </div>
      <iframe title={view.deckId} src={frameSrc} style={FRAME} />
      {exportError !== null && <div style={ERROR} role="alert">{exportError}</div>}
      <div
        style={GRIP}
        role="separator"
        aria-label="Resize canvas"
        onPointerDown={start('size')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  )
}

/** Keep a control's own click from starting a drag of the bar beneath it. */
function stopDrag(event: ReactPointerEvent<HTMLElement>): void {
  event.stopPropagation()
}

/**
 * The floating panel. Positioned from state rather than anchored to a corner,
 * which is what lets it be dragged. Inline styles rather than a CSS module:
 * this package's browser bundle has no stylesheet pipeline of its own, and
 * adding one for a single panel would buy a build dependency for no design gain.
 */
const PANEL: CSSProperties = {
  position: 'absolute',
  // border-box so the rendered box matches the geometry the clamp constrains;
  // otherwise the 1px borders push the panel a couple of pixels past the edge
  // the clamp just held it inside.
  boxSizing: 'border-box',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  boxShadow: '0 18px 48px rgb(0 0 0 / 45%)',
  display: 'flex',
  flexDirection: 'column',
}

/** Title row: the drag handle, with the deck name and the two controls. */
const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  height: TITLE_BAR,
  boxSizing: 'border-box',
  borderBottom: '1px solid var(--dsw-color-border, #2a2e35)',
  fontSize: 13,
  color: 'var(--dsw-color-text-secondary, #9aa3af)',
  cursor: 'move',
  touchAction: 'none',
  userSelect: 'none',
}

/** Truncates rather than pushing the controls out of a narrow canvas. */
const TITLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: 'var(--dsw-color-text-primary, #e6e9ef)',
  fontWeight: 500,
}

const SELECT: CSSProperties = {
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '2px 4px',
  maxWidth: 110,
}

const PROGRESS: CSSProperties = { fontVariantNumeric: 'tabular-nums', opacity: 0.85 }

/** Positions the dropdown against the Export button rather than the bar. */
const MENU_ANCHOR: CSSProperties = { position: 'relative', display: 'inline-flex' }

const MENU: CSSProperties = {
  position: 'absolute',
  top: '100%',
  right: 0,
  marginTop: 4,
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 90,
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6,
  overflow: 'hidden',
  boxShadow: '0 8px 24px rgb(0 0 0 / 35%)',
}

const MENU_ITEM: CSSProperties = {
  background: 'transparent',
  border: 0,
  color: 'inherit',
  cursor: 'pointer',
  font: 'inherit',
  padding: '6px 12px',
  textAlign: 'left',
}

/** A failed export says why, beneath the deck, until the next attempt. */
const ERROR: CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  color: 'var(--dsw-color-text-danger, #f87171)',
  borderTop: '1px solid var(--dsw-color-border, #2a2e35)',
}

const BUTTON: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  padding: '2px 8px',
  font: 'inherit',
  textDecoration: 'none',
}

/** The deck fills whatever space the panel has below its bar. */
const FRAME: CSSProperties = { flex: 1, width: '100%', border: 0, display: 'block' }

/** Bottom-right resize grip. */
const GRIP: CSSProperties = {
  position: 'absolute',
  right: 0,
  bottom: 0,
  width: 16,
  height: 16,
  cursor: 'nwse-resize',
  touchAction: 'none',
  background: 'linear-gradient(135deg, transparent 50%, var(--dsw-color-border, #2a2e35) 50%)',
}
