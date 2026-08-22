// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { asDeckView } from '../src/client/deck-toolview.ts'
import { DeckRow } from '../src/client/DeckRow.tsx'

afterEach(cleanup)

const value = { deckId: 'launch', route: '/deck/abc/', slideCount: 3, theme: 'midnight' }

describe('asDeckView', () => {
  it('accepts a deck_view canonical value', () => {
    expect(asDeckView(value)).toEqual(value)
  })

  it("rejects another tool's result rather than rendering an empty frame", () => {
    expect(asDeckView({ stdout: 'ok', exitCode: 0 })).toBeNull()
  })

  it('rejects a null value', () => {
    expect(asDeckView(null)).toBeNull()
  })
})

describe('DeckRow', () => {
  it('summarises the deck and offers the canvas', () => {
    render(<DeckRow block={{ kind: 'result', meta: value } as never} showDeck={() => {}} />)
    expect(screen.getByText('launch')).toBeInTheDocument()
    expect(screen.getByText(/3 slides · midnight/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open canvas' })).toBeInTheDocument()
  })

  it('points the canvas at its own deck when opened', () => {
    const showDeck = vi.fn()
    render(<DeckRow block={{ kind: 'result', meta: value } as never} showDeck={showDeck} />)
    screen.getByRole('button', { name: 'Open canvas' }).click()
    expect(showDeck).toHaveBeenCalledWith(value)
  })

  it('renders nothing for a still-running call', () => {
    const { container } = render(<DeckRow block={{ name: 'deck_view' } as never} showDeck={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
