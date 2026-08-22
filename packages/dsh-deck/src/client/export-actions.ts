import type { CanvasController } from './canvas-controller.ts'
import type { ExportFormat } from './DeckOverlay.tsx'
import { extractDeckRaw, type ExtractOptions } from './extract-deck.ts'
import type { DeckViewData } from './deck-view.ts'

/**
 * The endpoint one export posts to.
 *
 * `view.route` is `${base}/${key}/`, and the export route is a sibling of the
 * key under the same base — derived here rather than threaded through the tool
 * result, so `deck_view`'s canonical value keeps exactly the fields the canvas
 * renders from and gains nothing replay has to carry.
 * @param route - the deck's preview route.
 * @param format - the format to produce.
 * @param theme - the displayed theme, which the export follows.
 * @param mode - the displayed light/dark mode.
 * @returns the absolute path to request.
 */
export function exportEndpoint(route: string, format: string, theme: string, mode: string): string {
  const trimmed = route.replace(/\/+$/, '')
  const cut = trimmed.lastIndexOf('/')
  const key = trimmed.slice(cut + 1)
  const base = trimmed.slice(0, cut)
  return `${base}/@export/${key}/${format}?theme=${encodeURIComponent(theme)}&mode=${encodeURIComponent(mode)}`
}

/** The browser seams one export needs; injected so the driver is testable. */
export interface ExportDeps {
  fetch: typeof globalThis.fetch
  /** Hands the finished bytes to the reader as a download. */
  save: (blob: Blob, filename: string) => void
  extract: (options: ExtractOptions) => Promise<unknown[][]>
}

/**
 * Save a blob through an anchor click.
 *
 * The route also writes the artifact into the deck directory; this is the
 * other half of the delivery, so the reader does not have to go find it.
 * @param blob - the response body.
 * @param filename - the name to save under.
 */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

const browserDeps: ExportDeps = {
  fetch: (...args) => globalThis.fetch(...args),
  save: saveBlob,
  extract: extractDeckRaw,
}

/**
 * Run one export from the canvas.
 *
 * HTML needs no measurement — the server can build it alone — so it is a plain
 * request and works even while something else is being measured. PPTX and PDF
 * walk the deck in a hidden frame first and post the raw items: the browser
 * measures, Node assembles. That split is why export needs no headless
 * browser, and equally why export cannot be a model-callable tool — the server
 * has no renderer of its own.
 *
 * Every outcome, including failure, is written back through the controller, so
 * the header can never sit on a stale progress row or fail silently.
 * @param canvas - the canvas controller, for progress and errors.
 * @param view - the deck being exported.
 * @param theme - the displayed theme, which the export follows.
 * @param mode - the displayed light/dark mode.
 * @param format - which file to produce.
 * @param deps - browser seams; defaults to the real ones.
 */
export async function runExport(
  canvas: CanvasController,
  view: DeckViewData,
  theme: string,
  mode: string,
  format: ExportFormat,
  deps: ExportDeps = browserDeps,
): Promise<void> {
  const endpoint = exportEndpoint(view.route, format, theme, mode)
  canvas.startExport(format, view.slideCount)
  try {
    const response = format === 'html'
      ? await deps.fetch(endpoint)
      : await deps.fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          raw: await deps.extract({
            route: view.route,
            slideCount: view.slideCount,
            theme,
            mode,
            onProgress: (done, total) => { canvas.exportProgress(done, total) },
          }),
          theme,
          mode,
        }),
      })
    if (!response.ok) {
      // The route answers a failure with its cause in the body; surfacing that
      // beats a bare status the reader cannot act on.
      throw new Error(await response.text() || `export failed (${response.status})`)
    }
    deps.save(await response.blob(), `${view.deckId}-${theme}.${format}`)
    canvas.exportDone()
  } catch (error) {
    canvas.exportDone(error instanceof Error ? error.message : String(error))
  }
}
