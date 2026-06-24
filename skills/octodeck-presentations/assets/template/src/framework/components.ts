/**
 * Octodeck component library — slide templates and layout/content primitives.
 *
 * Everything here is a plain function returning an HTMLElement, so it composes
 * with `h()` and drops straight into a `Slide`:
 *
 *   () => HeaderSlide({ title: 'Roadmap' },
 *     Columns({ cols: '65/35' }, Bullets([...]), Card({ title: 'Now' }, ...)))
 */
import { h, type Child } from './h'

// ── column / grid system ────────────────────────────────────────────────────

/**
 * A column ratio spec. All of these are valid:
 *   2            → two equal columns (50/50)
 *   3            → three equal columns (33/33/33)
 *   '65/35'      → a 65/35 split
 *   '33/33/33'   → three equal columns
 *   [2, 1]       → a 66/33 split (raw fr weights)
 */
export type ColSpec = number | number[] | string

export interface ColumnsOptions {
  /** Ratio of the columns. Defaults to N equal columns for N children. */
  cols?: ColSpec
  /** Gap between columns. Default: 2.5rem. */
  gap?: string
  /** Vertical alignment of columns within the row. Default: stretch (equal height). */
  align?: 'start' | 'center' | 'end' | 'stretch'
}

/** Lay children out in columns. The headline layout primitive. */
export function Columns(opts: ColumnsOptions, ...children: Child[]): HTMLElement {
  const present = children.filter(isPresent)
  const tracks = parseCols(opts.cols ?? present.length)
  return h('div', {
    class: 'octo-columns',
    style: {
      gridTemplateColumns: tracks.map((t) => `${t}fr`).join(' '),
      gap: opts.gap ?? '2.5rem',
      alignItems: opts.align ?? 'stretch',
    },
  }, ...present.map((c) => h('div', { class: 'octo-col' }, c)))
}

export interface GridOptions {
  /** Number of columns. Default: 2. */
  cols?: number
  gap?: string
}

/** A uniform N-column grid that wraps — good for logo walls, card galleries. */
export function Grid(opts: GridOptions, ...children: Child[]): HTMLElement {
  return h('div', {
    class: 'octo-grid',
    style: {
      gridTemplateColumns: `repeat(${opts.cols ?? 2}, 1fr)`,
      gap: opts.gap ?? '1.5rem',
    },
  }, ...children.filter(isPresent))
}

export interface StackOptions {
  gap?: string
  align?: 'start' | 'center' | 'end' | 'stretch'
}

/** Vertical stack with a consistent gap. */
export function Stack(opts: StackOptions, ...children: Child[]): HTMLElement {
  return h('div', {
    class: 'octo-stack',
    style: { gap: opts.gap ?? '1rem', alignItems: opts.align ?? 'stretch' },
  }, ...children.filter(isPresent))
}

function parseCols(spec: ColSpec): number[] {
  if (typeof spec === 'number') return Array.from({ length: Math.max(1, spec) }, () => 1)
  if (typeof spec === 'string') return spec.split('/').map((s) => Number(s.trim()) || 1)
  return spec.length ? spec : [1]
}

// ── content components ──────────────────────────────────────────────────────

/** Small uppercase label that sits above a heading. */
export const Kicker = (text: Child): HTMLElement => h('div', { class: 'octo-kicker' }, text)

/** Slide heading (h2-level). For the deck title use `TitleSlide`. */
export const Heading = (text: Child): HTMLElement => h('h2', { class: 'octo-heading' }, text)

/** Muted supporting line under a heading. */
export const Subheading = (text: Child): HTMLElement => h('p', { class: 'octo-subheading' }, text)

/** A small muted footnote / aside. */
export const Note = (text: Child): HTMLElement => h('p', { class: 'octo-note' }, text)

export interface BulletsOptions {
  /** Reveal each item one step at a time via the deck's fragment mechanism. */
  fragment?: boolean
  /** Render as an ordered (numbered) list. */
  ordered?: boolean
}

/** A bullet (or numbered) list, optionally revealed item-by-item. */
export function Bullets(items: Child[], opts: BulletsOptions = {}): HTMLElement {
  return h(opts.ordered ? 'ol' : 'ul', { class: 'octo-bullets' },
    ...items.filter(isPresent).map((item) =>
      h('li', opts.fragment ? { 'data-fragment': true } : {}, item)))
}

export interface CardOptions {
  title?: Child
  /** Tint the card with the accent color. */
  accent?: boolean
}

/** A bordered content card — the natural child of `Columns`/`Grid`. */
export function Card(opts: CardOptions, ...body: Child[]): HTMLElement {
  return h('div', { class: 'octo-card' + (opts.accent ? ' is-accent' : '') },
    opts.title ? h('h3', { class: 'octo-card-title' }, opts.title) : null,
    ...body)
}

export interface MetricOptions {
  value: Child
  label: Child
}

/** A big number with a caption — for stats / KPIs. */
export function Metric(opts: MetricOptions): HTMLElement {
  return h('div', { class: 'octo-metric' },
    h('div', { class: 'octo-metric-value' }, opts.value),
    h('div', { class: 'octo-metric-label' }, opts.label))
}

export interface ImageOptions {
  src: string
  alt?: string
  caption?: Child
  fit?: 'contain' | 'cover'
}

/** A responsive image with an optional caption. */
export function Image(opts: ImageOptions): HTMLElement {
  return h('figure', { class: 'octo-figure' },
    h('img', { src: opts.src, alt: opts.alt ?? '', style: { objectFit: opts.fit ?? 'contain' } }),
    opts.caption ? h('figcaption', {}, opts.caption) : null)
}

/** A code block. `lang` is recorded as a data attribute for syntax tooling. */
export function Code(source: string, opts: { lang?: string } = {}): HTMLElement {
  return h('pre', { class: 'octo-code' },
    h('code', opts.lang ? { 'data-lang': opts.lang } : {}, source))
}

// ── slide templates (fill the whole slide) ──────────────────────────────────

export interface TitleSlideOptions {
  eyebrow?: Child
  title: Child
  subtitle?: Child
  footer?: Child
}

/** Centered hero slide — the opener. */
export function TitleSlide(opts: TitleSlideOptions): HTMLElement {
  return h('div', { class: 'octo-layout octo-title-slide' },
    opts.eyebrow ? Kicker(opts.eyebrow) : null,
    h('h1', { class: 'octo-title' }, opts.title),
    opts.subtitle ? h('p', { class: 'octo-lead' }, opts.subtitle) : null,
    opts.footer ? h('div', { class: 'octo-title-footer' }, opts.footer) : null)
}

export interface SectionSlideOptions {
  /** Section number / index, shown large and faint. */
  number?: Child
  title: Child
  subtitle?: Child
}

/** A section divider — big number plus a section title. */
export function SectionSlide(opts: SectionSlideOptions): HTMLElement {
  return h('div', { class: 'octo-layout octo-section-slide' },
    opts.number != null ? h('div', { class: 'octo-section-number' }, opts.number) : null,
    h('h2', { class: 'octo-section-title' }, opts.title),
    opts.subtitle ? h('p', { class: 'octo-lead' }, opts.subtitle) : null)
}

export interface StatementSlideOptions {
  text: Child
  /** Attribution, shown under the statement. */
  cite?: Child
}

/** One large centered statement or pull-quote. */
export function StatementSlide(opts: StatementSlideOptions): HTMLElement {
  return h('div', { class: 'octo-layout octo-statement-slide' },
    h('blockquote', { class: 'octo-statement' }, opts.text),
    opts.cite ? h('div', { class: 'octo-cite' }, '— ', opts.cite) : null)
}

export interface HeaderSlideOptions {
  title: Child
  subtitle?: Child
  kicker?: Child
}

/**
 * The workhorse content layout: a heading region pinned to the top and a body
 * region that fills the rest (and vertically centers its content). Drop a
 * `Columns`/`Grid`/`Bullets` into the body.
 */
export function HeaderSlide(opts: HeaderSlideOptions, ...body: Child[]): HTMLElement {
  return h('div', { class: 'octo-layout octo-header-slide' },
    h('header', { class: 'octo-slide-header' },
      opts.kicker ? Kicker(opts.kicker) : null,
      h('h2', { class: 'octo-heading' }, opts.title),
      opts.subtitle ? Subheading(opts.subtitle) : null),
    h('div', { class: 'octo-body' }, ...body.filter(isPresent)))
}

// ── Split: text panel + full-bleed media (the pitch-deck workhorse) ──────────

export interface SplitSlideOptions {
  /** Content/media ratio, e.g. '60/40'. Default: '60/40'. */
  ratio?: ColSpec
  /** Which side the media panel sits on. Default: 'right'. */
  side?: 'left' | 'right'
  /** The media element (Image, video, or any node). Bleeds to the slide edge. */
  media: Child
  kicker?: Child
}

/**
 * A two-panel slide: a padded content column and a full-bleed media column.
 * The media reaches the slide edges (no padding) — the most common title /
 * feature layout in real decks.
 */
export function SplitSlide(opts: SplitSlideOptions, ...content: Child[]): HTMLElement {
  const [a, b] = parseCols(opts.ratio ?? '60/40')
  const mediaPanel = h('div', { class: 'octo-split-media' }, opts.media)
  const contentPanel = h('div', { class: 'octo-split-content' },
    opts.kicker ? Kicker(opts.kicker) : null,
    ...content.filter(isPresent))

  const left = opts.side === 'left' ? mediaPanel : contentPanel
  const right = opts.side === 'left' ? contentPanel : mediaPanel
  const tracks = opts.side === 'left' ? `${b}fr ${a}fr` : `${a}fr ${b}fr`

  return h('div', {
    class: 'octo-split',
    style: { gridTemplateColumns: tracks },
  }, left, right)
}

// ── Bento: a span grid (feature walls, stat grids, logo walls) ───────────────

export interface BentoOptions {
  /** Number of columns the tiles span across. Default: 4. */
  cols?: number
  /** Fixed number of rows (equal height). Omit for content-sized auto rows. */
  rows?: number
  gap?: string
}

/** An asymmetric tile grid — tiles declare their own `span`/`rowSpan`. */
export function Bento(opts: BentoOptions, ...tiles: Child[]): HTMLElement {
  return h('div', {
    class: 'octo-bento',
    style: {
      gridTemplateColumns: `repeat(${opts.cols ?? 4}, 1fr)`,
      ...(opts.rows ? { gridTemplateRows: `repeat(${opts.rows}, 1fr)` } : {}),
      gap: opts.gap ?? '1.25rem',
    },
  }, ...tiles.filter(isPresent))
}

export interface TileOptions {
  /** Columns this tile spans. Default: 1. */
  span?: number
  /** Rows this tile spans. Default: 1. */
  rowSpan?: number
  title?: Child
  accent?: boolean
}

/** A Bento cell. Uses the same panel material as Card, so it themes for free. */
export function Tile(opts: TileOptions, ...body: Child[]): HTMLElement {
  return h('div', {
    class: 'octo-card octo-tile' + (opts.accent ? ' is-accent' : ''),
    style: { gridColumn: `span ${opts.span ?? 1}`, gridRow: `span ${opts.rowSpan ?? 1}` },
  },
    opts.title ? h('h3', { class: 'octo-card-title' }, opts.title) : null,
    ...body.filter(isPresent))
}

// ── Sequence: ordered steps (process · timeline · agenda) ────────────────────

export interface SequenceOptions {
  /** Layout direction. Default: 'horizontal'. */
  orientation?: 'horizontal' | 'vertical'
  /** Show auto-incrementing numbers in the markers. Default: true. */
  numbered?: boolean
  /** Draw a connector line between steps. Default: true. */
  connector?: boolean
}

/**
 * An ordered run of steps. Horizontal + connector → process/roadmap;
 * vertical + numbered → agenda/table-of-contents. One primitive, both layouts.
 */
export function Sequence(opts: SequenceOptions, ...steps: Child[]): HTMLElement {
  const cls = ['octo-sequence']
  if (opts.numbered ?? true) cls.push('is-numbered')
  if (opts.connector ?? true) cls.push('is-connected')
  return h('div', {
    class: cls.join(' '),
    'data-orientation': opts.orientation ?? 'horizontal',
  }, ...steps.filter(isPresent))
}

export interface StepOptions {
  /** Small overline above the title, e.g. 'Stage 01' or a year. */
  label?: Child
  title?: Child
}

/** One step within a `Sequence`. The marker number is supplied by CSS. */
export function Step(opts: StepOptions, ...body: Child[]): HTMLElement {
  return h('div', { class: 'octo-step' },
    h('div', { class: 'octo-step-marker' }),
    h('div', { class: 'octo-step-content' },
      opts.label ? h('div', { class: 'octo-step-label' }, opts.label) : null,
      opts.title ? h('h3', { class: 'octo-step-title' }, opts.title) : null,
      ...body.filter(isPresent)))
}

// ── Quote / testimonial ──────────────────────────────────────────────────────

export interface QuoteOptions {
  author?: Child
  role?: Child
  /** Avatar image URL. */
  avatar?: string
}

/** A pull-quote with attribution — testimonial slides, customer voice. */
export function Quote(opts: QuoteOptions, ...text: Child[]): HTMLElement {
  const by = (opts.author || opts.role || opts.avatar)
    ? h('figcaption', { class: 'octo-quote-by' },
        opts.avatar ? h('img', { class: 'octo-quote-avatar', src: opts.avatar, alt: '' }) : null,
        h('div', {},
          opts.author ? h('div', { class: 'octo-quote-author' }, opts.author) : null,
          opts.role ? h('div', { class: 'octo-quote-role' }, opts.role) : null))
    : null
  return h('figure', { class: 'octo-quote' },
    h('blockquote', { class: 'octo-quote-text' }, ...text.filter(isPresent)),
    by)
}

// ── Logo wall ────────────────────────────────────────────────────────────────

export type Logo = string | { src: string; alt?: string }

/** A muted row of partner/customer logos. */
export function LogoWall(logos: Logo[], opts: { gap?: string } = {}): HTMLElement {
  return h('div', { class: 'octo-logowall', style: { gap: opts.gap ?? '2.5rem' } },
    ...logos.map((l) => {
      const src = typeof l === 'string' ? l : l.src
      const alt = typeof l === 'string' ? '' : (l.alt ?? '')
      return h('img', { class: 'octo-logo', src, alt })
    }))
}

// ── helpers ─────────────────────────────────────────────────────────────────

function isPresent(c: Child): c is Node | string | number {
  return c !== false && c !== null && c !== undefined
}
