import type { DeckViewData } from './deck-view.ts'

/** Where the canvas sits and how big it is, in viewport pixels. */
export interface CanvasGeometry {
  x: number
  y: number
  width: number
  height: number
}

/**
 * What the canvas is showing, and where the reader put it.
 *
 * Root-scoped and shared by both registrations: the transcript row writes the
 * deck, the canvas reads it. That is what makes the canvas one surface rather
 * than one frame per `deck_view` call — a conversation that opens five decks
 * leaves five compact rows and a single canvas showing the last one asked for,
 * instead of five live iframes stacked up the transcript.
 *
 * Geometry lives here too, so a canvas dragged out of the way stays there
 * across turns and across the deck being retargeted.
 */
export interface CanvasState {
  /** The deck on the canvas, or null before any deck has been opened. */
  view: DeckViewData | null
  /** Whether the canvas surface is showing. */
  open: boolean
  /** Position and size, carried across decks and turns. */
  geometry: CanvasGeometry
}

/** Smallest useful canvas: below this the 16:9 frame stops being readable. */
export const MIN_WIDTH = 320
export const MIN_HEIGHT = 220

/** The canvas before anything has been opened: nothing shown, nothing floating. */
export function initialCanvas(): CanvasState {
  return { view: null, open: false, geometry: { x: 0, y: 0, width: 0, height: 0 } }
}

/**
 * Put a deck on the canvas.
 *
 * Geometry is untouched: retargeting the surface to a different deck should not
 * move a canvas the reader has already placed.
 * @param state - the draft canvas state.
 * @param view - the deck to show.
 */
export function showDeck(state: CanvasState, view: DeckViewData): void {
  state.view = view
  state.open = true
}

/** Hide the surface, remembering which deck it held and where it sat. */
export function closeCanvas(state: CanvasState): void {
  state.open = false
}

/**
 * Place the canvas, clamped so it can never be dragged or sized out of reach.
 *
 * A panel dragged past the viewport edge is unrecoverable without clearing
 * state, so both position and size are constrained here rather than trusted
 * from the pointer.
 * @param state - the draft canvas state.
 * @param geometry - the requested placement.
 * @param viewport - the current viewport size to clamp against.
 */
export function placeCanvas(
  state: CanvasState,
  geometry: CanvasGeometry,
  viewport: { width: number, height: number },
): void {
  const width = Math.max(MIN_WIDTH, Math.min(geometry.width, viewport.width))
  const height = Math.max(MIN_HEIGHT, Math.min(geometry.height, viewport.height))
  state.geometry = {
    width,
    height,
    x: Math.max(0, Math.min(geometry.x, viewport.width - width)),
    y: Math.max(0, Math.min(geometry.y, viewport.height - height)),
  }
}

/**
 * The canvas's first placement: bottom-right, sized to the viewport.
 *
 * Computed on first open rather than stored as a constant because it depends
 * on the window, and a 16:9 frame is what the deck actually needs.
 * @param viewport - the current viewport size.
 * @returns a starting geometry.
 */
export function defaultGeometry(viewport: { width: number, height: number }): CanvasGeometry {
  const width = Math.max(MIN_WIDTH, Math.min(880, Math.round(viewport.width * 0.52)))
  const height = Math.max(MIN_HEIGHT, Math.round(width * 9 / 16) + TITLE_BAR)
  return { width, height, x: Math.max(0, viewport.width - width - 24), y: Math.max(0, viewport.height - height - 24) }
}

/** Title-bar height, added to the 16:9 frame so the deck is not squeezed by it. */
export const TITLE_BAR = 37
