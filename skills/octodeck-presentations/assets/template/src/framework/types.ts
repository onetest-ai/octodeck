/** Context handed to every slide render so slides can react to where they are. */
export interface SlideContext {
  /** Zero-based index of this slide in the deck. */
  index: number
  /** Total number of slides. */
  total: number
  /** Imperatively move within the deck from inside a slide. */
  go: (to: number) => void
  next: () => void
  prev: () => void
}

/**
 * The render output of a slide: either a DOM node, or an element plus metadata.
 * Returning a bare node is the common case; the object form unlocks notes/classes.
 */
export type SlideResult =
  | Node
  | {
      el: Node
      /** Speaker notes, surfaced in the console and (later) a presenter view. */
      notes?: string
      /** Extra class(es) applied to the slide wrapper — e.g. a per-slide theme. */
      class?: string
    }

/**
 * A slide is a function of its context. Keeping it a function (not a static node)
 * means a slide is re-rendered fresh each time it's shown, so interactive and
 * data-driven slides always reflect current state.
 */
export type Slide = (ctx: SlideContext) => SlideResult

export interface DeckOptions {
  /** Where to mount. Accepts a selector or an element. Defaults to `#deck`. */
  mount?: string | HTMLElement
  /** Fixed design width of the slide canvas (px). Default: 1280. */
  width?: number
  /** Fixed design height of the slide canvas (px). Default: 720 (16:9). */
  height?: number
  /** Themes available to this deck (enables switching + id resolution). */
  themes?: import('./theme').Theme[]
  /** Initial theme id. Overridden by a `?theme=` URL param. */
  theme?: string
  /** Initial mode. Overridden by a `?mode=` URL param. Falls back to the theme's default. */
  mode?: import('./theme').Mode
  /** Show the slide-number readout (e.g. `3 / 12`). Default: true. */
  showProgress?: boolean
  /** Show the thin progress bar at the top. Default: true. */
  showProgressBar?: boolean
  /** Sync the current slide to the URL hash (`#/3`). Default: true. */
  hashRouting?: boolean
  /** Enable left/right swipe on touch devices. Default: true. */
  touch?: boolean
  /** Loop from last slide back to the first (and vice-versa). Default: false. */
  loop?: boolean
}
