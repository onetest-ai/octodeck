import { isAbsolute, join, sep } from 'node:path'

/** Opaque cross-boundary deck identity; never a bare string at a package edge. */
export type DeckId = string & { readonly __brand: 'DeckId' }

/** Theme ids the Octodeck framework ships. */
export const THEMES = ['midnight', 'protocol', 'primer', 'radiant', 'commit', 'octo-glass'] as const

/** Theme applied when a request names none. */
export const DEFAULT_THEME = 'midnight'

/** A deck as the caller asks for it, before defaulting. */
export interface DeckRequest {
  readonly name: string
  readonly theme?: string
  readonly title?: string
}

/** A fully resolved deck: every field decided, nothing left to a later fallback. */
export interface DeckSpec {
  readonly id: DeckId
  readonly name: string
  readonly theme: string
  readonly title: string
  readonly directory: string
}

/**
 * The folder decks live in, inside the session's selected workspace. Dotted so
 * a deck project does not clutter the top level of a user's repository the way
 * a plain `decks/` would.
 */
export const DECK_DIRECTORY = '.deck'

/** A deck name is one path segment: lowercase letters, digits, and dashes. */
const NAME = /^[a-z0-9][a-z0-9-]*$/

/** Turn `launch-plan` into `Launch Plan`. */
function titleFrom(name: string): string {
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Decide every field of a deck from a request. Defaulting lives here, at the
 * definition, so no provider hides a `?? default` inside its own run path.
 * @param request - the caller's deck request.
 * @param workspace - absolute path of the session workspace.
 * @returns the resolved deck.
 * @throws {Error} when the name is not a single safe path segment, or the theme is unknown.
 */
export function resolveDeck(request: DeckRequest, workspace: string): DeckSpec {
  if (!NAME.test(request.name)) {
    throw new Error(`deck name must match ${String(NAME)}, received ${JSON.stringify(request.name)}`)
  }
  const theme = request.theme ?? DEFAULT_THEME
  if (!THEMES.includes(theme as (typeof THEMES)[number])) {
    throw new Error(`unknown theme ${JSON.stringify(theme)}; the framework ships ${THEMES.join(', ')}`)
  }
  return {
    id: request.name as DeckId,
    name: request.name,
    theme,
    title: request.title ?? titleFrom(request.name),
    directory: join(workspace, DECK_DIRECTORY, request.name),
  }
}

/**
 * The URL segment that identifies one deck across every workspace.
 *
 * A deck lives in whatever workspace its session selected, so a name alone
 * cannot address it — two sessions may both hold a deck called `launch`. The
 * segment therefore carries the deck's absolute directory, base64url-encoded
 * so it survives a URL path.
 *
 * Encoding the location rather than registering it keeps the preview server
 * stateless: a key minted before a restart still resolves afterwards, and a
 * replayed session's logged route still addresses the same deck.
 * @param directory - the deck's absolute directory.
 * @returns the URL-safe key addressing it.
 */
export function deckKey(directory: string): string {
  return Buffer.from(directory, 'utf8').toString('base64url')
}

/**
 * Recover a deck directory from its URL key.
 *
 * The result is untrusted — it comes off a URL — so callers must confirm it
 * names a real deck before serving anything from it. {@link isDeckDirectory}
 * is that check.
 * @param key - the segment produced by {@link deckKey}.
 * @returns the decoded absolute directory, or undefined when the segment is not valid base64url.
 */
export function decodeDeckKey(key: string): string | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(key)) return undefined
  const decoded = Buffer.from(key, 'base64url').toString('utf8')
  return decoded.length > 0 && isAbsolute(decoded) ? decoded : undefined
}

/**
 * Whether a decoded path is shaped like a deck this plugin created: a single
 * name segment directly inside a {@link DECK_DIRECTORY} folder.
 *
 * This is the containment rule for the preview server. The server no longer
 * grants Vite filesystem access to a whole workspace, so what a request can
 * reach is exactly what this predicate admits — a crafted key cannot walk out
 * to an arbitrary file.
 * @param directory - a decoded absolute directory.
 * @returns true when the path's parent is the deck folder and its own segment is a legal deck name.
 */
export function isDeckDirectory(directory: string): boolean {
  const segments = directory.split(sep)
  const name = segments.at(-1)
  return segments.at(-2) === DECK_DIRECTORY && name !== undefined && NAME.test(name)
}
