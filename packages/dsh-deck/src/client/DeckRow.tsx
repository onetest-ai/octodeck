import type { CSSProperties } from 'react'
import { asDeckView, type DeckToolviewProps } from './deck-toolview.ts'
import type { DeckViewData } from './deck-view.ts'

/** Props: the tool block this row describes, plus the canvas write set. */
export type DeckRowProps = DeckToolviewProps & {
  readonly showDeck: (view: DeckViewData) => void
}

/**
 * The transcript's record of one `deck_view` call: a compact row, not a frame.
 *
 * The deck itself renders on the shared canvas (see DeckOverlay), so a
 * conversation that opens several decks leaves several one-line rows and a
 * single live surface. Embedding a frame per call was the alternative, and it
 * turns a long session into a column of stale iframes — each one a running
 * document the browser keeps alive.
 * @param props - the tool block and the canvas actions.
 * @returns the row, or null when the block carries no deck value.
 */
export function DeckRow({ block, showDeck }: DeckRowProps) {
  if (!('kind' in block)) return null
  const view = asDeckView(block.meta)
  if (view === null) return null
  return (
    <div style={ROW}>
      <span style={NAME}>{view.deckId}</span>
      <span>{view.slideCount} slide{view.slideCount === 1 ? '' : 's'} · {view.theme}</span>
      <span style={{ flex: 1 }} />
      <button type="button" style={BUTTON} onClick={() => { showDeck(view) }}>Open canvas</button>
    </div>
  )
}

/** One compact transcript line per deck_view call. */
const ROW: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 8,
  fontSize: 13,
  color: 'var(--dsw-color-text-secondary, #9aa3af)',
}

const NAME: CSSProperties = { color: 'var(--dsw-color-text-primary, #e6e9ef)', fontWeight: 500 }

const BUTTON: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6,
  color: 'inherit',
  cursor: 'pointer',
  padding: '3px 10px',
  font: 'inherit',
}
