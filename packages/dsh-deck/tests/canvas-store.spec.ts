import { describe, expect, it } from 'vitest'
import { closeCanvas, initialCanvas, selectSlide, showDeck } from '../src/client/canvas-state.ts'

const deck = (route: string, slideCount = 5) => ({ deckId: 'launch', route, slideCount, theme: 'midnight' })

describe('canvas store', () => {
  it('starts closed, so the overlay layer is empty until a deck is opened', () => {
    const s = initialCanvas()
    expect(s).toMatchObject({ open: false, view: null })
  })

  it('shows one deck at a time — a second deck replaces the first rather than stacking', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    showDeck(s, deck('/deck/bbb/'))
    expect(s.view?.route).toBe('/deck/bbb/')
  })

  it('restarts at slide 1 when a different deck is opened', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    selectSlide(s, 4)
    showDeck(s, deck('/deck/bbb/'))
    expect(s.slide).toBe(1)
  })

  it('keeps the position when the same deck is reopened', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    selectSlide(s, 3)
    showDeck(s, deck('/deck/aaa/'))
    expect(s.slide).toBe(3)
  })

  it('clamps navigation to the deck it is showing', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/', 2))
    selectSlide(s, 9)
    expect(s.slide).toBe(2)
    selectSlide(s, 0)
    expect(s.slide).toBe(1)
  })

  it('closing hides the surface but remembers the deck', () => {
    const s = initialCanvas()
    showDeck(s, deck('/deck/aaa/'))
    closeCanvas(s)
    expect(s).toMatchObject({ open: false })
    expect(s.view?.route).toBe('/deck/aaa/')
  })
})
