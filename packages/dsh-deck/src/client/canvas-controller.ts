import {
  closeCanvas, defaultGeometry, initialCanvas, placeCanvas, showDeck,
  type CanvasGeometry, type CanvasState,
} from './canvas-state.ts'
import type { DeckViewData } from './deck-view.ts'

/** A bare observable the renderer can bind to a `use<Name>` hook. */
export interface CanvasSource {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => CanvasState
}

/** The canvas surface's plugin-owned state, plus the writes both registrations make. */
export interface CanvasController {
  readonly store: CanvasSource
  show: (view: DeckViewData) => void
  close: () => void
  place: (geometry: CanvasGeometry) => void
}

/** The viewport the canvas is clamped against; injected so the logic stays testable. */
export type ViewportReader = () => { width: number, height: number }

const browserViewport: ViewportReader = () => ({ width: window.innerWidth, height: window.innerHeight })

/**
 * Own the canvas surface's state for the lifetime of the plugin.
 *
 * A declared slot store cannot serve here: the transcript row registers into a
 * session-scoped slot and the canvas into a root-scoped one, and a store handle
 * belongs to exactly one scope — mounting the same handle in both fails plugin
 * load with "one handle, one scope". Plugin-owned state injected through the
 * reserved `hooks` compartment is the documented way a registrant carries a
 * reactive fact of its own, and it crosses the two scopes because it belongs to
 * neither.
 *
 * Snapshots are immutable and replaced on write, so the identity stays stable
 * between changes — which is what the renderer's subscription requires.
 * @param viewport - reads the current viewport; defaults to the browser window.
 * @returns the controller shared by both registrations.
 */
export function createCanvasController(viewport: ViewportReader = browserViewport): CanvasController {
  let state = initialCanvas()
  const listeners = new Set<() => void>()
  const commit = (mutate: (draft: CanvasState) => void): void => {
    const draft = { ...state }
    mutate(draft)
    state = draft
    for (const listener of listeners) listener()
  }
  return {
    store: {
      subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      getSnapshot: () => state,
    },
    show: (view) => {
      commit((draft) => {
        showDeck(draft, view)
        // First open places the canvas; later opens leave the reader's own
        // position alone.
        if (draft.geometry.width === 0) placeCanvas(draft, defaultGeometry(viewport()), viewport())
      })
    },
    close: () => { commit(closeCanvas) },
    place: (geometry) => { commit((draft) => { placeCanvas(draft, geometry, viewport()) }) },
  }
}
