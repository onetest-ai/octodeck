import { describe, expect, it } from 'vitest'
import {
  closeCanvas, defaultGeometry, initialCanvas, placeCanvas, showDeck, MIN_HEIGHT, MIN_WIDTH,
} from '../src/client/canvas-state.ts'

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
