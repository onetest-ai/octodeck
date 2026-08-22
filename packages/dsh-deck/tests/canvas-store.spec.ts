import { describe, expect, it } from 'vitest'
import {
  closeCanvas, defaultGeometry, initialCanvas, placeCanvas, showDeck, MIN_HEIGHT, MIN_WIDTH,
} from '../src/client/canvas-state.ts'
import { createCanvasController } from '../src/client/canvas-controller.ts'

const deck = (route: string) => ({ deckId: 'launch', route, slideCount: 3, theme: 'midnight' })
const viewport = { width: 1440, height: 900 }

describe('canvas state', () => {
  it('starts closed, so the overlay layer is empty until a deck is opened', () => {
    expect(initialCanvas()).toMatchObject({ open: false, view: null })
  })

  it('shows one deck at a time — a second deck replaces the first rather than stacking', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    showDeck(s, deck('/deck/bbb/'))
    expect(s.view?.route).toBe('/deck/bbb/')
  })

  it('leaves the reader’s placement alone when the deck is retargeted', () => {
    const s = initialCanvas()
    placeCanvas(s, { x: 100, y: 80, width: 700, height: 500 }, viewport)
    showDeck(s, deck('/deck/bbb/'))
    expect(s.geometry).toEqual({ x: 100, y: 80, width: 700, height: 500 })
  })

  it('closing hides the surface but remembers the deck and where it sat', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    placeCanvas(s, { x: 40, y: 40, width: 640, height: 400 }, viewport)
    closeCanvas(s)
    expect(s.open).toBe(false)
    expect(s.view?.route).toBe('/deck/aaa/')
    expect(s.geometry.x).toBe(40)
  })
})

describe('placeCanvas clamping', () => {
  it('cannot be dragged off the right or bottom edge', () => {
    const s = initialCanvas()
    placeCanvas(s, { x: 99999, y: 99999, width: 600, height: 400 }, viewport)
    expect(s.geometry.x).toBe(viewport.width - 600)
    expect(s.geometry.y).toBe(viewport.height - 400)
  })

  it('cannot be dragged off the top or left edge', () => {
    const s = initialCanvas()
    placeCanvas(s, { x: -500, y: -500, width: 600, height: 400 }, viewport)
    expect(s.geometry).toMatchObject({ x: 0, y: 0 })
  })

  it('cannot be resized below a readable frame', () => {
    const s = initialCanvas()
    placeCanvas(s, { x: 0, y: 0, width: 10, height: 10 }, viewport)
    expect(s.geometry.width).toBe(MIN_WIDTH)
    expect(s.geometry.height).toBe(MIN_HEIGHT)
  })

  it('cannot be resized larger than the viewport', () => {
    const s = initialCanvas()
    placeCanvas(s, { x: 0, y: 0, width: 99999, height: 99999 }, viewport)
    expect(s.geometry.width).toBe(viewport.width)
    expect(s.geometry.height).toBe(viewport.height)
  })
})

describe('defaultGeometry', () => {
  it('opens bottom-right, inside the viewport', () => {
    const g = defaultGeometry(viewport)
    expect(g.x + g.width).toBeLessThanOrEqual(viewport.width)
    expect(g.y + g.height).toBeLessThanOrEqual(viewport.height)
  })

  it('sizes the frame 16:9 beneath its title bar', () => {
    const g = defaultGeometry(viewport)
    expect(Math.round((g.width / (g.height - 37)) * 100) / 100).toBeCloseTo(16 / 9, 1)
  })

  it('stays usable on a small window', () => {
    const g = defaultGeometry({ width: 400, height: 300 })
    expect(g.width).toBeGreaterThanOrEqual(MIN_WIDTH)
    expect(g.x).toBeGreaterThanOrEqual(0)
  })
})

describe('theme selection', () => {
  const view = deck('/deck/k/')
  const read = () => ({ width: 1600, height: 900 })

  it('starts with no override, so the deck shows its authored theme', () => {
    const canvas = createCanvasController(read)
    canvas.show(view)
    expect(canvas.store.getSnapshot().theme).toBeNull()
  })

  it('records a chosen theme without rewriting the deck value', () => {
    // Preview-only: deck.json keeps what the agent authored, so a casual
    // click cannot silently change the deck.
    const canvas = createCanvasController(read)
    canvas.show(view)
    canvas.setTheme('radiant')
    expect(canvas.store.getSnapshot().theme).toBe('radiant')
    expect(canvas.store.getSnapshot().view?.theme).toBe('midnight')
  })

  it('keeps the chosen theme when the canvas is retargeted to another deck', () => {
    const canvas = createCanvasController(read)
    canvas.show(view)
    canvas.setTheme('radiant')
    canvas.show({ ...view, deckId: 'other', theme: 'commit' })
    expect(canvas.store.getSnapshot().theme).toBe('radiant')
  })

  it('defaults the mode to dark and records a change', () => {
    const canvas = createCanvasController(read)
    expect(canvas.store.getSnapshot().mode).toBe('dark')
    canvas.setMode('light')
    expect(canvas.store.getSnapshot().mode).toBe('light')
  })
})

describe('export status', () => {
  const read = () => ({ width: 1600, height: 900 })

  it('tracks the running export and clears any previous error', () => {
    const canvas = createCanvasController(read)
    canvas.exportDone('earlier failure')
    canvas.startExport('pdf', 12)
    expect(canvas.store.getSnapshot().exportStatus).toEqual({ format: 'pdf', done: 0, total: 12 })
    expect(canvas.store.getSnapshot().exportError).toBeNull()
  })

  it('advances progress per slide', () => {
    const canvas = createCanvasController(read)
    canvas.startExport('pptx', 3)
    canvas.exportProgress(2, 3)
    expect(canvas.store.getSnapshot().exportStatus).toEqual({ format: 'pptx', done: 2, total: 3 })
  })

  it('ignores progress arriving after the export finished', () => {
    // A late callback from an aborted run must not resurrect the progress row.
    const canvas = createCanvasController(read)
    canvas.startExport('pptx', 3)
    canvas.exportDone()
    canvas.exportProgress(3, 3)
    expect(canvas.store.getSnapshot().exportStatus).toBeNull()
  })

  it('surfaces a failure and stops showing progress', () => {
    const canvas = createCanvasController(read)
    canvas.startExport('pdf', 4)
    canvas.exportDone('deck frame is cross-origin')
    expect(canvas.store.getSnapshot().exportStatus).toBeNull()
    expect(canvas.store.getSnapshot().exportError).toBe('deck frame is cross-origin')
  })
})
