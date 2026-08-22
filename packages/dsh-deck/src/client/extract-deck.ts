/**
 * The deck's design canvas, in CSS pixels.
 *
 * The extraction frame must be exactly this size. The deck scales itself by
 * `min(innerWidth / 1280, innerHeight / 720)` (src/framework/deck.ts), and the
 * walker measures `getBoundingClientRect()` — so at any other size every
 * measurement comes back scaled and the IR is silently, uniformly wrong.
 */
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720

/** Settle delay after fonts resolve, matching the proven CLI extractor. */
const SETTLE_MS = 350

/** Loads one slide into the frame and hands back its document. */
export type SlideLoader = (frame: HTMLIFrameElement, url: string) => Promise<Document | null>

/** What the extractor needs to walk one deck. */
export interface ExtractOptions {
  /** The deck's preview route, e.g. `/deck/<key>/`. */
  readonly route: string
  readonly slideCount: number
  readonly theme: string
  readonly mode: string
  /** Cancels the run between slides. */
  readonly signal?: AbortSignal
  /** Called after each slide is walked. */
  readonly onProgress?: (done: number, total: number) => void
  /** Where the hidden frame is mounted; defaults to `document.body`. */
  readonly container?: HTMLElement
  /** The walker; injected so the driver is testable without layout. */
  readonly walker?: (doc: Document) => unknown[]
  /** How a slide is loaded; injected so the driver is testable without a real frame. */
  readonly loadSlide?: SlideLoader
  /** Settle delay after fonts resolve. */
  readonly settleMs?: number
}

/**
 * Walk every slide of a deck through a hidden, exactly-sized iframe.
 *
 * This is the whole reason deck export needs no headless browser: the deck is
 * already rendering in one, and the preview route is same-origin with the
 * harness UI, so the live DOM can be measured directly.
 *
 * The *visible* canvas is deliberately not used. It is whatever size the
 * reader dragged it to, which would scale every measurement — and walking it
 * would also yank the reader's view from slide to slide.
 *
 * One reload per slide rather than hash navigation: a hash change re-runs
 * neither entry animations nor font settling, and the CLI extractor this
 * mirrors has always reloaded.
 * @param options - the deck, the theme to render in, and the driver's seams.
 * @returns one array of raw walker items per slide, in slide order.
 * @throws {Error} when the frame is cross-origin, the caller aborts, or the walker throws.
 */
export async function extractDeckRaw(options: ExtractOptions): Promise<unknown[][]> {
  const { route, slideCount, theme, mode, signal, onProgress } = options
  const container = options.container ?? document.body
  const walk = options.walker ?? (await loadWalker())
  const load = options.loadSlide ?? defaultLoadSlide(options.settleMs ?? SETTLE_MS)

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.setAttribute('title', 'deck export')
  // Rendered but invisible: layout has to happen for the rects to be real, so
  // `display:none` and `visibility:hidden` are both unusable here.
  frame.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    `width:${CANVAS_WIDTH}px`, `height:${CANVAS_HEIGHT}px`,
    'opacity:0', 'pointer-events:none', 'border:0', 'z-index:-1',
  ].join(';')
  container.appendChild(frame)

  try {
    const raw: unknown[][] = []
    for (let n = 1; n <= slideCount; n++) {
      signal?.throwIfAborted()
      // A cache-busting param per slide: without it, assigning a URL that
      // differs only in its hash does not reload the frame.
      const url = `${route}?theme=${encodeURIComponent(theme)}&mode=${encodeURIComponent(mode)}&_=${n}#/${n}`
      const doc = await load(frame, url)
      if (doc === null) {
        throw new Error(
          'the deck frame is cross-origin, so its slides cannot be measured for export. '
          + 'Export renders the deck this browser is already showing, which requires the '
          + 'deck route and the harness UI to share an origin.',
        )
      }
      signal?.throwIfAborted()
      raw.push(walk(doc))
      onProgress?.(n, slideCount)
    }
    return raw
  } finally {
    // Always, including on abort: a leaked 1280x720 frame keeps a whole deck
    // document alive for the rest of the session.
    frame.remove()
  }
}

/**
 * Load one slide: navigate, wait for the document, its fonts, and a settle.
 *
 * `fonts.ready` matters more than it looks — a slide measured before its
 * webfont loads is measured in the fallback face, so every text rect is the
 * wrong width and the export's line breaks disagree with the deck's.
 * @param settleMs - pause after fonts resolve, for entry transitions.
 * @returns a loader bound to that delay.
 */
function defaultLoadSlide(settleMs: number): SlideLoader {
  return async (frame, url) => {
    const loaded = new Promise<void>((resolve, reject) => {
      frame.addEventListener('load', () => { resolve() }, { once: true })
      frame.addEventListener('error', () => { reject(new Error(`slide failed to load: ${url}`)) }, { once: true })
    })
    frame.src = url
    await loaded
    const doc = frame.contentDocument
    if (doc === null) return null
    await doc.fonts?.ready
    if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs))
    return doc
  }
}

/**
 * Resolve the vendored walker.
 *
 * Imported lazily so this module can be loaded — and its driver tested — in an
 * environment that has no vendored pipeline, and so the walker's bulk is not
 * pulled into the client bundle's initial evaluation.
 * @returns the vendored `WALKER`.
 */
async function loadWalker(): Promise<(doc: Document) => unknown[]> {
  // `walker.ts`, never `extract.ts`: the latter also carries the Node-side
  // mapping, which pulls `color.ts` and the OOXML pipeline into a browser
  // bundle that needs none of it.
  const { WALKER } = await import('../../vendor/pptx/walker.js')
  return WALKER as (doc: Document) => unknown[]
}
