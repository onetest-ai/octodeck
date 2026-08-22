import type { CSSProperties } from 'react'
import { DeckCanvas } from './DeckCanvas.tsx'
import type { CanvasState } from './canvas-state.ts'

/**
 * Props: the canvas fact bound from the injected `hooks` compartment, plus the
 * plain callbacks that write it.
 */
export interface DeckOverlayProps {
  readonly useDeckCanvas: <S>(select: (state: CanvasState) => S, equal?: (a: S, b: S) => boolean) => S
  readonly close: () => void
  readonly setSlide: (slide: number) => void
}

/**
 * The deck canvas, floating over the whole app.
 *
 * Registered into `shell.overlay` — a root-scoped list slot the shell
 * documents as the seat for "a surface of your own that floats over the whole
 * app". Root scope is the point: one canvas exists for the session's lifetime
 * and retargets to whichever deck was last opened, so a long conversation does
 * not accumulate a column of stale deck frames.
 *
 * Renders nothing while closed, which keeps the overlay layer empty and the
 * app fully clickable.
 * @param props - the shared store and its actions.
 * @returns the floating canvas, or null while closed.
 */
export function DeckOverlay({ useDeckCanvas, close, setSlide }: DeckOverlayProps) {
  // Selected field by field: the bound hook re-renders on the selected value
  // changing, so selecting the whole state object would repaint the frame on
  // every slide step even when the deck itself has not moved.
  const view = useDeckCanvas(state => state.view)
  const open = useDeckCanvas(state => state.open)
  const slide = useDeckCanvas(state => state.slide)
  if (!open || view === null) return null
  // Inline styles rather than a CSS module: this package's browser bundle has
  // no stylesheet pipeline of its own, and adding one for a single panel would
  // buy a build dependency for no design gain.
  return (
    <div style={PANEL} role="dialog" aria-label={`Deck ${view.deckId}`}>
      <div style={BAR}>
        <span style={TITLE}>{view.deckId}</span>
        <a style={BUTTON} href={view.route} target="_blank" rel="noreferrer">Open in tab</a>
        <button type="button" style={BUTTON} aria-label="Close canvas" onClick={close}>Close</button>
      </div>
      <DeckCanvas view={view} slide={slide} onSlide={setSlide} />
    </div>
  )
}

/** The floating panel: anchored bottom-right, above the app, sized to the viewport. */
const PANEL: CSSProperties = {
  position: 'absolute',
  right: 24,
  bottom: 24,
  width: 'min(52vw, 880px)',
  borderRadius: 12,
  overflow: 'hidden',
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  boxShadow: '0 18px 48px rgb(0 0 0 / 45%)',
}

/** Title row: deck name on the left, the two controls on the right. */
const BAR: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--dsw-color-border, #2a2e35)',
  fontSize: 13,
  color: 'var(--dsw-color-text-secondary, #9aa3af)',
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
