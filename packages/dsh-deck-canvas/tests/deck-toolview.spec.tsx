// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { asDeckView, DeckToolview } from '../src/client/DeckToolview.tsx'

const deckView = { deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' }

afterEach(cleanup)

describe('asDeckView', () => {
  it('accepts a deck_view canonical value', () => {
    expect(asDeckView(deckView)).toEqual(deckView)
  })

  it('rejects another tool\'s result rather than rendering an empty frame', () => {
    expect(asDeckView({ stdout: 'ok', exitCode: 0 })).toBeNull()
  })

  it('rejects a null value', () => {
    expect(asDeckView(null)).toBeNull()
  })
})

describe('DeckToolview', () => {
  it('renders the canvas once the call settles with meta carrying the deck_view value', () => {
    const block = {
      kind: 'tool-result' as const,
      seq: 1,
      time: 0,
      callId: 'call-1',
      call: { name: 'deck_view', argsRaw: '{"name":"launch"}' },
      callTime: 0,
      content: [],
      isError: false,
      meta: deckView,
      callView: null,
      resultView: null,
      subCalls: [],
    }
    render(<DeckToolview block={block} />)
    expect(screen.getByTitle('launch')).toHaveAttribute('src', '/deck/launch/#1')
  })

  it('renders nothing for a still-running call', () => {
    const block = {
      callId: 'call-1',
      name: 'deck_view',
      argsRaw: '{"name":"launch"}',
      turn: 0,
      step: 0,
      time: 0,
      callView: null,
      subCalls: [],
    }
    const { container } = render(<DeckToolview block={block} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the settled result carries no recognizable deck_view meta', () => {
    const block = {
      kind: 'tool-result' as const,
      seq: 1,
      time: 0,
      callId: 'call-1',
      call: { name: 'bash', argsRaw: '{}' },
      callTime: 0,
      content: [],
      isError: false,
      callView: null,
      resultView: null,
      subCalls: [],
    }
    const { container } = render(<DeckToolview block={block} />)
    expect(container).toBeEmptyDOMElement()
  })
})
