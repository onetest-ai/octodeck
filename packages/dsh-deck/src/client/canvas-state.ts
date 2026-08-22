import type { DeckViewData } from './DeckCanvas.tsx'

/**
 * Which deck the canvas is showing, and where in it.
 *
 * Root-scoped and shared by both registrations: the transcript row writes it,
 * the overlay reads it. That is what makes the canvas one surface rather than
 * one frame per `deck_view` call — a conversation that opens five decks leaves
 * five compact rows behind and a single canvas showing the last one asked for,
 * instead of five live iframes stacked up the transcript.
 */
export interface CanvasState {
  /** The deck on the canvas, or null before any deck has been opened. */
  view: DeckViewData | null
  /** Whether the canvas surface is showing. */
  open: boolean
  /** 1-based slide index, as the framework's own hash router counts. */
  slide: number
}

/** The canvas before any deck has been opened: nothing shown, nothing floating. */
export function initialCanvas(): CanvasState {
  return { view: null, open: false, slide: 1 }
}

/**
 * Put a deck on the canvas.
 *
 * Opening a *different* deck restarts at slide 1, because the index belongs to
 * the deck being shown and carrying a position across decks can land on a
 * slide the new deck does not have. Reopening the same deck keeps the reader
 * where they were.
 *
 * Written as a pure transition rather than inline in the store's action so it
 * can be tested directly: the store runtime ships as a browser closure-factory
 * bundle that a plain test cannot import.
 * @param state - the draft canvas state.
 * @param view - the deck to show.
 */
export function showDeck(state: CanvasState, view: DeckViewData): void {
  if (state.view?.route !== view.route) state.slide = 1
  state.view = view
  state.open = true
}

/**
 * Move within the deck currently shown, clamped to its slide count.
 * @param state - the draft canvas state.
 * @param slide - the requested 1-based index.
 */
export function selectSlide(state: CanvasState, slide: number): void {
  const count = state.view?.slideCount ?? 1
  state.slide = Math.min(Math.max(slide, 1), count)
}

/** Hide the surface, remembering which deck it held. */
export function closeCanvas(state: CanvasState): void {
  state.open = false
}
