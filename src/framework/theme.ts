/**
 * Theme runtime. A theme is metadata + a lazily-loaded stylesheet that fills
 * the contract (see contract.css). Switching a theme is two attributes on the
 * deck root: `data-theme` (identity) and `data-mode` (light/dark).
 */

export type Mode = 'light' | 'dark'

export interface Theme {
  /** Stable id, also the `data-theme` value and the CSS scope. */
  id: string
  /** Human-readable name for switchers. */
  name: string
  /** Which mode to use when none is requested. Default: 'dark'. */
  defaultMode?: Mode
  /** Modes this theme actually supports. Default: ['dark', 'light']. */
  modes?: Mode[]
  /** Loads the theme's CSS (dynamic import → code-split, fetched on first use). */
  load: () => Promise<unknown>
  /**
   * Optional escape hatch for effects CSS can't express (e.g. an animated/WebGL
   * backdrop). Runs after the theme is applied; return a cleanup function.
   */
  mount?: (root: HTMLElement) => (() => void) | void
}

/** Identity helper — keeps theme files typed and uniform. */
export function defineTheme(theme: Theme): Theme {
  return { defaultMode: 'dark', modes: ['dark', 'light'], ...theme }
}

let activeCleanup: (() => void) | void
let loaded = new Set<string>()

/** Apply a theme (loading its CSS once) and set the mode on the root element. */
export async function applyTheme(
  theme: Theme,
  mode: Mode | undefined,
  root: HTMLElement,
): Promise<void> {
  if (!loaded.has(theme.id)) {
    await theme.load()
    loaded.add(theme.id)
  }
  const resolved = pickMode(theme, mode)
  root.setAttribute('data-theme', theme.id)
  root.setAttribute('data-mode', resolved)

  activeCleanup?.()
  activeCleanup = theme.mount?.(root)
}

/** Change only the mode on an already-themed root. */
export function applyMode(mode: Mode, root: HTMLElement): void {
  root.setAttribute('data-mode', mode)
}

function pickMode(theme: Theme, requested: Mode | undefined): Mode {
  const supported = theme.modes ?? ['dark', 'light']
  if (requested && supported.includes(requested)) return requested
  return theme.defaultMode ?? supported[0] ?? 'dark'
}
