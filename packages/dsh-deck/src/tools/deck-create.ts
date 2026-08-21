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

/**
 * Count top-level entries in the exported `slides` array with a depth-aware
 * scan: brackets, string literals, template literals, and comments never
 * perturb the count, so a slide title containing `[` or `,` (in prose, in a
 * string, or behind a `//`/`/* *\/` comment) cannot be mistaken for a slide
 * boundary. The array literal's own opening `[` is found after the first
 * `=` that follows the `slides` identifier, since the `Slide[]` type
 * annotation's own brackets appear before it. One entry is counted per
 * completed segment between top-level commas (or between the array's own
 * brackets when there is exactly one entry); a trailing comma after the
 * last entry adds nothing, and an array with no non-comment content is 0.
 *
 * This is a static scan, not a module evaluation: it cannot see through a
 * computed entry or a spread (`...moreSlides`) and would undercount either.
 * An exact count needs the module actually loaded (e.g. through the preview
 * server's `ssrLoadModule`), which is out of scope for this display value.
 * @param source - the slides module's source text.
 * @returns the number of top-level entries in the `slides` array.
 */
export function countSlides(source: string): number {
  const nameIndex = source.indexOf('slides')
  const assignIndex = source.indexOf('=', nameIndex === -1 ? 0 : nameIndex)
  const start = source.indexOf('[', assignIndex === -1 ? 0 : assignIndex)
  if (start === -1) return 0

  let entries = 0
  let segmentHasContent = false
  let depth = 1
  let i = start + 1
  const n = source.length

  while (i < n && depth > 0) {
    const ch = source[i]
    if (ch === '/' && source[i + 1] === '/') {
      i += 2
      while (i < n && source[i] !== '\n') i++
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      segmentHasContent = true
      const quote = ch
      i++
      while (i < n && source[i] !== quote) i += source[i] === '\\' ? 2 : 1
      i++
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++
      segmentHasContent = true
      i++
      continue
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        if (segmentHasContent) entries++
        break
      }
      segmentHasContent = true
      i++
      continue
    }
    if (ch === ',' && depth === 1) {
      if (segmentHasContent) entries++
      segmentHasContent = false
      i++
      continue
    }
    if (!/\s/.test(ch)) segmentHasContent = true
    i++
  }
  return entries
}
