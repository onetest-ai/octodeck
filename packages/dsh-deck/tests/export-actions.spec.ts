// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createCanvasController } from '../src/client/canvas-controller.ts'
import { exportEndpoint, runExport, type ExportDeps } from '../src/client/export-actions.ts'

const view = { deckId: 'launch', route: '/deck/abc123/', slideCount: 3, theme: 'midnight' }

function harness(overrides: Partial<ExportDeps> = {}) {
  const canvas = createCanvasController(() => ({ width: 1600, height: 900 }))
  const saved: { name: string, size: number }[] = []
  const deps: ExportDeps = {
    fetch: vi.fn(async () => new Response('bytes', { status: 200 })),
    save: (blob, name) => { saved.push({ name, size: blob.size }) },
    extract: vi.fn(async () => [[{ t: 'rect' }], [], []]),
    ...overrides,
  }
  return { canvas, deps, saved }
}

describe('exportEndpoint', () => {
  it('addresses the export route as a sibling of the deck key', () => {
    expect(exportEndpoint('/deck/abc123/', 'pdf', 'radiant', 'dark'))
      .toBe('/deck/@export/abc123/pdf?theme=radiant&mode=dark')
  })

  it('works without a trailing slash', () => {
    expect(exportEndpoint('/deck/abc123', 'html', 'commit', 'light'))
      .toContain('/@export/abc123/html')
  })

  it('escapes a theme id so it cannot alter the query', () => {
    expect(exportEndpoint('/deck/k/', 'pdf', 'a&b=c', 'dark')).toContain('theme=a%26b%3Dc')
  })
})

describe('runExport', () => {
  it('requests HTML without measuring anything', async () => {
    const { canvas, deps } = harness()
    await runExport(canvas, view, 'radiant', 'dark', 'html', deps)
    expect(deps.extract).not.toHaveBeenCalled()
    expect(deps.fetch).toHaveBeenCalledWith(expect.stringContaining('/html?theme=radiant'))
  })

  it('measures the deck and posts the raw items for pptx', async () => {
    const { canvas, deps } = harness()
    await runExport(canvas, view, 'radiant', 'dark', 'pptx', deps)
    expect(deps.extract).toHaveBeenCalledOnce()
    const [, init] = (deps.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ raw: [[{ t: 'rect' }], [], []], theme: 'radiant', mode: 'dark' })
  })

  it('measures in the displayed theme, not the deck’s authored one', async () => {
    const { canvas, deps } = harness()
    await runExport(canvas, view, 'octo-glass', 'light', 'pdf', deps)
    expect(deps.extract).toHaveBeenCalledWith(expect.objectContaining({ theme: 'octo-glass', mode: 'light' }))
  })

  it('saves the result named for the deck and theme', async () => {
    const { canvas, deps, saved } = harness()
    await runExport(canvas, view, 'commit', 'dark', 'pptx', deps)
    expect(saved).toEqual([{ name: 'launch-commit.pptx', size: 5 }])
  })

  it('clears the progress row when it finishes', async () => {
    const { canvas, deps } = harness()
    await runExport(canvas, view, 'radiant', 'dark', 'html', deps)
    expect(canvas.store.getSnapshot().exportStatus).toBeNull()
    expect(canvas.store.getSnapshot().exportError).toBeNull()
  })

  it('forwards extraction progress to the header', async () => {
    const seen: number[] = []
    const { canvas, deps } = harness({
      extract: async (options) => { options.onProgress?.(1, 3); options.onProgress?.(2, 3); return [[], [], []] },
    })
    const unsubscribe = canvas.store.subscribe(() => {
      const status = canvas.store.getSnapshot().exportStatus
      if (status !== null) seen.push(status.done)
    })
    await runExport(canvas, view, 'radiant', 'dark', 'pptx', deps)
    unsubscribe()
    expect(seen).toEqual([0, 1, 2])
  })

  it('surfaces the route’s failure text rather than a bare status', async () => {
    const { canvas, deps } = harness({
      fetch: async () => new Response('unknown theme "nope"', { status: 500 }),
    })
    await runExport(canvas, view, 'nope', 'dark', 'html', deps)
    expect(canvas.store.getSnapshot().exportError).toBe('unknown theme "nope"')
  })

  it('surfaces an extraction failure and does not post', async () => {
    const fetchSpy = vi.fn(async () => new Response('bytes'))
    const { canvas, deps } = harness({
      fetch: fetchSpy,
      extract: async () => { throw new Error('the deck frame is cross-origin') },
    })
    await runExport(canvas, view, 'radiant', 'dark', 'pdf', deps)
    expect(canvas.store.getSnapshot().exportError).toMatch(/cross-origin/)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(canvas.store.getSnapshot().exportStatus).toBeNull()
  })
})
