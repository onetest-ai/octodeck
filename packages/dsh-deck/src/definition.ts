import { join } from 'node:path'

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
    directory: join(workspace, 'decks', request.name),
  }
}
