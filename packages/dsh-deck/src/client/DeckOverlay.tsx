import { useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { CanvasGeometry, CanvasState } from './canvas-state.ts'
import { TITLE_BAR } from './canvas-state.ts'

/**
 * Props: the canvas fact bound from the injected `hooks` compartment, plus the
 * plain callbacks that write it.
 */
export interface DeckOverlayProps {
  readonly useDeckCanvas: <S>(select: (state: CanvasState) => S, equal?: (a: S, b: S) => boolean) => S
  readonly close: () => void
  readonly place: (geometry: CanvasGeometry) => void
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
export function DeckOverlay({ useDeckCanvas, close, place }: DeckOverlayProps) {
  const view = useDeckCanvas(state => state.view)
  const open = useDeckCanvas(state => state.open)
  const geometry = useDeckCanvas(state => state.geometry)
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
        <a style={BUTTON} href={view.route} target="_blank" rel="noreferrer" onPointerDown={stopDrag}>Open in tab</a>
        <button type="button" style={BUTTON} aria-label="Close canvas" onPointerDown={stopDrag} onClick={close}>Close</button>
      </div>
      <iframe title={view.deckId} src={view.route} style={FRAME} />
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

const TITLE: CSSProperties = { flex: 1, color: 'var(--dsw-color-text-primary, #e6e9ef)', fontWeight: 500 }

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
