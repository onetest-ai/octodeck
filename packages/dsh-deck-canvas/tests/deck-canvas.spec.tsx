// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { DeckCanvas } from '../src/client/DeckCanvas.tsx'

const view = { deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' }

afterEach(cleanup)

describe('DeckCanvas', () => {
  it('frames the deck at the slide the viewer is on, in the hash format the framework parses', () => {
    // Octodeck's own hash router (src/framework/deck.ts) only recognizes
    // `/^#\/(\d+)$/` and writes `#/${index + 1}` — documented as `#/3` on
    // `DeckOptions.hashRouting` (src/framework/types.ts). Asserting the bare
    // `#2` form the component happened to emit is what let this drift ship:
    // it checks the component agrees with itself, not with the framework it
    // targets. This regex is that framework contract, not the component's
    // own output, so a future change back to a bare-number hash fails here.
    render(<DeckCanvas view={view} slide={2} onSlide={() => {}} />)
    const src = screen.getByTitle('launch').getAttribute('src')
    expect(src).toMatch(/^\/deck\/launch\/#\/\d+$/)
    expect(src).toBe('/deck/launch/#/2')
  })

  it('shows the viewer where they are in the deck', () => {
    render(<DeckCanvas view={view} slide={2} onSlide={() => {}} />)
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
  })

  it('does not offer a previous control on the first slide', () => {
    render(<DeckCanvas view={view} slide={1} onSlide={() => {}} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })
})
