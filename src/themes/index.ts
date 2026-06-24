/**
 * Theme registry. Each theme's metadata is imported statically (tiny); its CSS
 * is loaded lazily via `load()` only when the theme is first applied.
 */
import type { Theme } from '../framework/theme'

import { midnight } from './midnight/theme'
import { protocol } from './protocol/theme'
import { primer } from './primer/theme'
import { radiant } from './radiant/theme'
import { commit } from './commit/theme'
import { octoGlass } from './octo-glass/theme'

export const themes: Record<string, Theme> = {
  midnight,
  protocol,
  primer,
  radiant,
  commit,
  'octo-glass': octoGlass,
}

export const themeList: Theme[] = Object.values(themes)

/** Resolve a theme by id, falling back to the default. */
export function getTheme(id: string | undefined): Theme {
  return (id && themes[id]) || midnight
}
