// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { DeckCanvas } from '../src/client/DeckCanvas.tsx'

const view = { deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' }

afterEach(cleanup)

describe('DeckCanvas', () => {
  it('frames the deck at the slide the viewer is on', () => {
    render(<DeckCanvas view={view} slide={2} onSlide={() => {}} />)
    expect(screen.getByTitle('launch')).toHaveAttribute('src', '/deck/launch/#2')
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
