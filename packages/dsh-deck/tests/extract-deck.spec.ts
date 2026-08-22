// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { extractDeckRaw, type SlideLoader } from '../src/client/extract-deck.ts'

/**
 * jsdom has no layout and does not load iframe content, so the driver is
 * exercised with an injected loader and walker. That is the honest split: the
 * walker's own correctness depends on real measurement and is verified by
 * looking at real exports, while the sequencing, cleanup, cancellation, and
 * cross-origin handling around it are ordinary logic and are covered here.
 */
const loader = (doc: unknown = { fonts: { ready: Promise.resolve() } }): SlideLoader =>
  async () => doc as Document

function run(overrides: Parameters<typeof extractDeckRaw>[0] extends infer T ? Partial<T> : never = {}) {
  return extractDeckRaw({
    route: '/deck/k/',
    slideCount: 3,
    theme: 'radiant',
    mode: 'dark',
    walker: () => [{ t: 'rect' }],
    loadSlide: loader(),
    settleMs: 0,
    ...overrides,
  })
}

describe('extractDeckRaw', () => {
  it('walks every slide once, in order', async () => {
    const walker = vi.fn(() => [{ t: 'rect' }])
    const raw = await run({ walker })
    expect(raw).toHaveLength(3)
    expect(walker).toHaveBeenCalledTimes(3)
  })

  it('requests each slide by hash, with a cache-buster so the frame reloads', async () => {
    const urls: string[] = []
    await run({ loadSlide: async (_frame, url) => { urls.push(url); return {} as Document } })
    expect(urls).toEqual([
      '/deck/k/?theme=radiant&mode=dark&_=1#/1',
      '/deck/k/?theme=radiant&mode=dark&_=2#/2',
      '/deck/k/?theme=radiant&mode=dark&_=3#/3',
    ])
  })

  it('renders in the requested theme and mode, which is what export follows', async () => {
    const urls: string[] = []
    await run({
      slideCount: 1,
      theme: 'octo-glass',
      mode: 'light',
      loadSlide: async (_frame, url) => { urls.push(url); return {} as Document },
    })
    expect(urls[0]).toContain('theme=octo-glass')
    expect(urls[0]).toContain('mode=light')
  })

  it('reports progress for each completed slide', async () => {
    const onProgress = vi.fn()
    await run({ slideCount: 2, onProgress })
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
  })

  it('measures a frame sized to the design canvas, not to the visible panel', async () => {
    let seen: HTMLIFrameElement | undefined
    await run({ slideCount: 1, loadSlide: async (frame) => { seen = frame; return {} as Document } })
    // Any other size scales every getBoundingClientRect the walker takes.
    expect(seen?.style.width).toBe('1280px')
    expect(seen?.style.height).toBe('720px')
  })

  it('removes the frame when the run succeeds', async () => {
    const container = document.createElement('div')
    await run({ container })
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('removes the frame even when the walker throws', async () => {
    const container = document.createElement('div')
    await expect(run({
      container,
      walker: () => { throw new Error('boom') },
    })).rejects.toThrow('boom')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('fails with a named cause when the frame is cross-origin', async () => {
    // A null contentDocument would otherwise yield an empty IR, exporting a
    // blank deck with no error at all.
    await expect(run({ loadSlide: async () => null })).rejects.toThrow(/cross-origin/i)
  })

  it('stops early when the caller aborts', async () => {
    const controller = new AbortController()
    const walker = vi.fn(() => { controller.abort(); return [] })
    await expect(run({ slideCount: 5, walker, signal: controller.signal })).rejects.toThrow()
    expect(walker).toHaveBeenCalledTimes(1)
  })

  it('does not start at all when the signal is already aborted', async () => {
    const walker = vi.fn(() => [])
    await expect(run({ walker, signal: AbortSignal.abort() })).rejects.toThrow()
    expect(walker).not.toHaveBeenCalled()
  })
})
