import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { deckKey, resolveDeck, type DeckRequest } from '../definition.ts'
import { scaffoldDeck } from '../octodeck/scaffold.ts'

/** Where a deck is served, given the mounted base path. */
export interface PreviewOptions {
  /**
   * Fallback workspace root, used only when a call arrives without session
   * metadata. A real tool call resolves its own session's selected workspace;
   * see {@link workspaceFor}.
   */
  readonly workspace: string
  readonly base: string
}

/**
 * The workspace a call's decks belong to: the session's own selected cwd,
 * falling back to the mount-time root when a call carries no session (a
 * direct programmatic call, or a host that creates agents without `meta.cwd`).
 *
 * Reading it per call rather than fixing it at mount is what lets one Host
 * serve sessions rooted in different directories — the harness's own bash tool
 * resolves its workdir from the same `session.header.cwd`.
 * @param exec - the tool execution context.
 * @param options - mount-time preview options supplying the fallback.
 * @returns the absolute workspace root for this call.
 */
export function workspaceFor(exec: CancelableExec | undefined, options: PreviewOptions): string {
  return exec?.agent?.session.header.cwd ?? options.workspace
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

/** The subset of a tool's `exec` this file forwards: only the caller's cancellation signal. */
export interface CancelableExec {
  readonly signal?: AbortSignal
  /**
   * The calling agent, when there is one. Its session header carries the
   * workspace the user selected for that session, which is where the session's
   * decks belong — see {@link workspaceFor}.
   */
  readonly agent?: { readonly session: { readonly header: { readonly cwd?: string } } }
}

/**
 * Create a deck in the session workspace.
 * @param request - the caller's deck request.
 * @param options - workspace root and mounted preview base.
 * @param exec - the caller's execution context, for its cancellation signal.
 * @returns the created deck's identity, paths, and preview route.
 */
export async function createDeck(
  request: DeckRequest,
  options: PreviewOptions,
  exec?: CancelableExec,
): Promise<DeckCreated> {
  const spec = resolveDeck(request, workspaceFor(exec, options))
  // `scaffoldDeck`'s `mkdir`/`writeFile` calls (src/octodeck/scaffold.ts,
  // Task 4, out of scope here) accept no `AbortSignal`, so `exec.signal` has
  // nowhere to forward into for this tool body. Accepted anyway, for
  // symmetry with `viewDeck` and so a future `scaffoldDeck` signature change
  // has a signal ready to hand it.
  await scaffoldDeck(spec)
  return {
    deckId: spec.id,
    directory: spec.directory,
    slidesPath: join(spec.directory, 'slides.ts'),
    route: `${options.base}/${deckKey(spec.directory)}/`,
    theme: spec.theme,
  }
}

/**
 * Report an existing deck for preview.
 * @param request - names the deck to view.
 * @param options - workspace root and mounted preview base.
 * @param exec - the caller's execution context; its cancellation signal is
 *   forwarded into both file reads.
 * @returns the deck's preview route, slide count, and theme.
 * @throws {Error} when the deck is not on disk, or when the caller's signal aborts.
 */
export async function viewDeck(
  request: DeckRequest,
  options: PreviewOptions,
  exec?: CancelableExec,
): Promise<DeckView> {
  const spec = resolveDeck(request, workspaceFor(exec, options))
  const signal = exec?.signal
  const deckJsonPath = join(spec.directory, 'deck.json')
  let raw: string
  try {
    raw = await readFile(deckJsonPath, { encoding: 'utf8', signal })
  } catch (cause) {
    // An aborted read is the caller's own cancellation, not a missing deck;
    // report it as-is rather than mislabeling it as "no deck named X".
    if (signal?.aborted) throw cause
    throw new Error(`no deck named ${spec.name} in this workspace`, { cause })
  }
  const meta = parseDeckMeta(raw, deckJsonPath)
  const slides = await readFile(join(spec.directory, 'slides.ts'), { encoding: 'utf8', signal })
  return {
    deckId: spec.id,
    route: `${options.base}/${deckKey(spec.directory)}/`,
    slideCount: countSlides(slides),
    theme: meta.theme,
  }
}

/**
 * Parse and validate `deck.json`'s contents. The file is a durable-file
 * boundary — a hand-edited or corrupted copy is never trusted as an
 * asserted cast — so malformed JSON, a non-object, or a non-string `theme`
 * all fail loud, naming `path` and what was wrong with it.
 * @param raw - the file's raw text.
 * @param path - the file's absolute path, named in any thrown error.
 * @returns the validated `theme`.
 * @throws {Error} when `raw` is not valid JSON, not an object, or has no string `theme`.
 */
function parseDeckMeta(raw: string, path: string): { theme: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${path} is not valid JSON`, { cause })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} must contain a JSON object, received ${JSON.stringify(parsed)}`)
  }
  const theme = (parsed as Record<string, unknown>).theme
  if (typeof theme !== 'string') {
    throw new Error(`${path} must declare a string "theme", received ${JSON.stringify(theme)}`)
  }
  return { theme }
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
