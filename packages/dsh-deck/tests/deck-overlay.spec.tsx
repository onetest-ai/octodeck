// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { DeckOverlay } from '../src/client/DeckOverlay.tsx'
import { initialCanvas, type CanvasState } from '../src/client/canvas-state.ts'

afterEach(cleanup)

/**
 * The overlay reads its facts through the injected `useDeckCanvas` selector,
 * so a plain object stands in for the store — no controller, no subscription.
 */
function harness(overrides: Partial<CanvasState> = {}) {
  const state: CanvasState = {
    ...initialCanvas(),
    open: true,
    view: { deckId: 'launch', route: '/deck/k/', slideCount: 3, theme: 'midnight' },
    geometry: { x: 0, y: 0, width: 800, height: 500 },
    ...overrides,
  }
  return <S,>(select: (s: CanvasState) => S): S => select(state)
}

function renderOverlay(overrides: Partial<CanvasState> = {}, actions: Partial<{
  setTheme: (t: string) => void
  setMode: (m: 'light' | 'dark') => void
  startExport: (f: 'html' | 'pdf' | 'pptx') => void
}> = {}) {
  const props = {
    useDeckCanvas: harness(overrides),
    close: vi.fn(),
    place: vi.fn(),
    setTheme: actions.setTheme ?? vi.fn(),
    setMode: actions.setMode ?? vi.fn(),
    startExport: actions.startExport ?? vi.fn(),
  }
  render(<DeckOverlay {...props} />)
  return props
}

describe('DeckOverlay theme switcher', () => {
  it('lists all six themes and preselects the deck’s authored one', () => {
    renderOverlay()
    const select = screen.getByLabelText('Theme') as HTMLSelectElement
    expect(select.value).toBe('midnight')
    expect(select.options).toHaveLength(6)
  })

  it('reports a chosen theme', () => {
    const setTheme = vi.fn()
    renderOverlay({}, { setTheme })
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'radiant' } })
    expect(setTheme).toHaveBeenCalledWith('radiant')
  })

  it('shows the chosen theme rather than the deck’s once one is picked', () => {
    renderOverlay({ theme: 'commit' })
    expect((screen.getByLabelText('Theme') as HTMLSelectElement).value).toBe('commit')
  })

  it('drives the frame through ?theme= and ?mode=, which the deck reads at startup', () => {
    renderOverlay({ theme: 'radiant', mode: 'light' })
    const frame = screen.getByTitle('launch') as HTMLIFrameElement
    expect(frame.src).toContain('theme=radiant')
    expect(frame.src).toContain('mode=light')
  })

  it('toggles the mode', () => {
    const setMode = vi.fn()
    renderOverlay({ mode: 'dark' }, { setMode })
    fireEvent.click(screen.getByLabelText('Toggle light or dark'))
    expect(setMode).toHaveBeenCalledWith('light')
  })
})

describe('DeckOverlay export menu', () => {
  it('offers the three formats once opened', () => {
    renderOverlay()
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    for (const format of ['HTML', 'PDF', 'PPTX']) {
      expect(screen.getByRole('menuitem', { name: format })).toBeInTheDocument()
    }
  })

  it('starts the chosen format and closes the menu', () => {
    const startExport = vi.fn()
    renderOverlay({}, { startExport })
    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'PPTX' }))
    expect(startExport).toHaveBeenCalledWith('pptx')
    expect(screen.queryByRole('menuitem', { name: 'PPTX' })).not.toBeInTheDocument()
  })

  it('replaces the menu with progress while an export runs', () => {
    renderOverlay({ exportStatus: { format: 'pdf', done: 7, total: 20 } })
    expect(screen.getByText(/PDF/)).toBeInTheDocument()
    expect(screen.getByText(/7\s*\/\s*20/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
  })

  it('shows a failure with its cause, so a silent no-op is impossible', () => {
    renderOverlay({ exportError: 'deck frame is cross-origin' })
    expect(screen.getByRole('alert')).toHaveTextContent('cross-origin')
  })
})
