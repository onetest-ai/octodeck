import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDeck, type DeckRequest } from '../definition.ts'
import { scaffoldDeck } from '../octodeck/scaffold.ts'

/** Where a deck is served, given the mounted base path. */
export interface PreviewOptions {
  readonly workspace: string
  readonly base: string
}

/** The canonical value `deck_create` returns. */
export interface DeckCreated {
  readonly deckId: string
  readonly directory: string
  readonly slidesPath: string
  readonly route: string
  readonly theme: string
}

/** The canonical value `deck_view` returns; the canvas renders from exactly these fields. */
export interface DeckView {
  readonly deckId: string
  readonly route: string
  readonly slideCount: number
  readonly theme: string
}

/**
 * Create a deck in the session workspace.
 * @param request - the caller's deck request.
 * @param options - workspace root and mounted preview base.
 * @returns the created deck's identity, paths, and preview route.
 */
export async function createDeck(request: DeckRequest, options: PreviewOptions): Promise<DeckCreated> {
  const spec = resolveDeck(request, options.workspace)
  await scaffoldDeck(spec)
  return {
    deckId: spec.id,
    directory: spec.directory,
    slidesPath: join(spec.directory, 'slides.ts'),
    route: `${options.base}/${spec.name}/`,
    theme: spec.theme,
  }
}

/**
 * Report an existing deck for preview.
 * @param request - names the deck to view.
 * @param options - workspace root and mounted preview base.
 * @returns the deck's preview route, slide count, and theme.
 * @throws {Error} when the deck is not on disk.
 */
export async function viewDeck(request: DeckRequest, options: PreviewOptions): Promise<DeckView> {
  const spec = resolveDeck(request, options.workspace)
  let meta: { theme: string }
  try {
    meta = JSON.parse(await readFile(join(spec.directory, 'deck.json'), 'utf8')) as { theme: string }
  } catch (cause) {
    throw new Error(`no deck named ${spec.name} in this workspace`, { cause })
  }
  const slides = await readFile(join(spec.directory, 'slides.ts'), 'utf8')
  return {
    deckId: spec.id,
    route: `${options.base}/${spec.name}/`,
    slideCount: countSlides(slides),
    theme: meta.theme,
  }
}

/** Count top-level entries in the exported slides array by their trailing commas. */
function countSlides(source: string): number {
  const body = source.slice(source.indexOf('['), source.lastIndexOf(']'))
  return body.split('\n').filter(line => /^\s{2}\S/.test(line)).length
}
