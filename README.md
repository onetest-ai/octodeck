# Octodeck

A tiny **TypeScript + Vite** framework for building presentation-like webpages.
Slides are plain TS components — `(ctx) => HTMLElement` — so they're typed,
hot-reloadable, and can be fully interactive.

## Quick start

```bash
npm install
npm run dev               # http://localhost:9001
npm run new:deck -- <name># scaffold a deck → /<name>.html
npm run build             # typecheck + production bundle into dist/
npm run preview           # serve the built bundle on 9001
DECK=<name> npm run build:single  # compile a deck → ONE self-contained HTML (dist-single/<name>.html)
```

> The dev server runs on **port 9001** (configured in `vite.config.ts`).

### Self-contained single-file export

`DECK=<name> npm run build:single` produces `dist-single/<name>.html` — a single file with
**all JS, CSS, the favicon, and the web fonts inlined** (zero external references; opens
offline in any browser). It runs the single-file Vite build
(`vite.singlefile.config.ts`, via `vite-plugin-singlefile`) then `scripts/inline-single.mjs`
(inlines the favicon and fetches/embeds the Google fonts as data URIs). The `DECK` env var
selects which `<name>.html` entry to bundle. (Font embedding needs network at build time; it degrades to remote fonts
if offline.)

## The DeepSeek Harness plugin

`packages/dsh-deck` is [`@onetest/dsh-deck`](packages/dsh-deck/README.md): an installable DeepSeek Harness plugin that builds these decks from inside a harness session. The agent creates a deck, authors its slides as TypeScript, and the deck renders on a canvas floating over the conversation while it works.

Decks it creates live in the session's selected workspace under `.deck/<name>/` and are ordinary Octodeck decks — the same framework, templates, and themes documented below, exportable the same ways.

```bash
npm run build  --workspace @onetest/dsh-deck
npm run bundle --workspace @onetest/dsh-deck
```

Its README covers installing into a harness profile, the `Deck creator` agent preset, and publishing.

## Writing slides

Edit `src/slides/index.ts`. Each entry in the exported `slides` array is a
component returning a DOM node:

```ts
import { h } from '../framework'
import type { Slide } from '../framework'

export const slides: Slide[] = [
  // A node — uses the built-in typographic defaults.
  () => h('h1', 'Hello'),

  // Context gives you position + navigation.
  (ctx) => h('p', `Slide ${ctx.index + 1} of ${ctx.total}`),

  // Step-through reveals: any [data-fragment] shows on the next →.
  () => h('ul', {},
    h('li', { 'data-fragment': true }, 'appears first'),
    h('li', { 'data-fragment': true }, 'then this'),
  ),

  // Metadata form: attach speaker notes or a per-slide class.
  () => ({ el: h('h2', 'Closing'), notes: 'Thank the audience', class: 'dark' }),
]
```

Because slides are **functions**, they re-render every time they're shown —
interactive widgets (event listeners, timers, fetched data) start fresh on each
visit. See the click-counter slide for an example.

## Slide templates & layout components

Rather than hand-rolling each slide with raw `h()`, compose from the built-in
library (all exported from `./framework`, defined in `src/framework/components.ts`).

**Slide templates** — fill the whole slide:

| Template | Slots |
| --- | --- |
| `TitleSlide` | `eyebrow?`, `title`, `subtitle?`, `footer?` |
| `SectionSlide` | `number?`, `title`, `subtitle?` (section divider) |
| `StatementSlide` | `text`, `cite?` (one big pull-quote) |
| `HeaderSlide` | `{ title, subtitle?, kicker? }, ...body` (the workhorse) |

**Layout components** — compose inside a template:

```ts
Columns({ cols: '65/35' }, left, right)   // also: 2 | 3 | [2,1] | '33/33/33'
Grid({ cols: 3 }, ...cells)               // uniform N-column grid
Stack({ gap: '1rem' }, ...items)          // vertical stack
```

`Columns` is one parametric component for **every** ratio you'd want:

| You want | `cols:` |
| --- | --- |
| 50 / 50 | `2` or `'50/50'` |
| 33 / 33 / 33 | `3` or `'33/33/33'` |
| 65 / 35 | `'65/35'` |
| 70 / 30 | `'70/30'` |
| 2 : 1 | `[2, 1]` |

**Content components:** `Heading`, `Subheading`, `Kicker`, `Note`,
`Bullets(items, { fragment?, ordered? })`, `Card({ title?, accent? }, ...)`,
`Metric({ value, label })`, `Image({ src, alt?, caption? })`, `Code(src, { lang? })`.

**Deck-archetype layouts** (modelled on patterns from real decks):

```ts
// Split — content panel + full-bleed media (the classic title/feature slide)
SplitSlide({ ratio: '60/40', side: 'right', media: Image({ src }) }, Heading('…'), Bullets([…]))

// Bento — an asymmetric span grid; tiles declare their own size
Bento({ cols: 4, rows: 2 },
  Tile({ span: 2, rowSpan: 2 }, Metric({ value: '10×', label: 'faster' })),
  Tile({ span: 2 }, …), Tile({}, …), Tile({}, …))

// Sequence — process / timeline / agenda (one primitive, two orientations)
Sequence({ orientation: 'horizontal' },          // vertical → agenda/TOC
  Step({ label: 'Stage 01', title: 'Ideate' }, '…'),
  Step({ label: 'Stage 02', title: 'Create' }, '…'))

// Quote — testimonial with attribution
Quote({ author: 'Stacey', role: 'Founder', avatar }, 'This is genius.')

// LogoWall — muted partner/customer logos
LogoWall([{ src }, { src }])
```

`Bento`/`Tile` reuse the panel material role, so every archetype themes for free.

**Diagrams** — deterministic and theme-aware (no auto-layout engine). You place
each node on a grid cell; edges auto-route orthogonally between them:

```ts
Diagram({
  cols: 3, rows: 3,
  nodes: {
    client: { at: [0, 1], label: 'Client', shape: 'pill' },
    api:    { at: [1, 1], label: 'API gateway', accent: true },
    db:     { at: [2, 0], label: 'Database' },
    cache:  { at: [2, 1], label: 'Cache' },
  },
  edges: [
    { from: 'client', to: 'api', label: 'HTTPS' },
    { from: 'api', to: 'db', label: 'SQL' },
    { from: 'api', to: 'cache', dashed: true },
  ],
})
```

Renders to a single responsive SVG using the contract colors, so it matches the
active theme (flat boxes, glass, etc.). Predictable because *you* decide the
layout — nothing shifts between renders. For large auto-laid-out graphs, the same
`{nodes, edges}` spec can later be fed to `elkjs` to compute the `at` positions.

Putting it together:

```ts
() => HeaderSlide({ kicker: 'Roadmap', title: 'Where we’re headed' },
  Columns({ cols: '65/35', align: 'center' },
    Bullets([
      'Ship the editor',
      'Add presenter view',
      'Theme marketplace',
    ], { fragment: true }),
    Card({ title: 'Now', accent: true }, Metric({ value: 'Q3', label: 'GA target' })),
  ),
)
```

`src/slides/index.ts` is a working gallery of all of the above.

## Themes

A theme restyles the whole deck by filling the **contract** — the `--octo-*`
variables in `src/framework/contract.css`. Components read only those, so a
theme never touches component code. Two axes:

- **`data-theme`** — identity (fonts, geometry, material style, accent)
- **`data-mode`** — `light` / `dark` polarity (just the seed colors flip)

Both are applied to `<html>`. Switch via the deck:

```ts
import { themeList } from './themes'

const d = deck(slides, { themes: themeList, theme: 'primer', mode: 'light' }).start()
d.setTheme('octo-glass')   // load + apply (CSS is code-split, fetched on first use)
d.toggleMode()             // light ⇄ dark
d.cycleTheme()             // next theme
```

URL overrides for previewing: `?theme=radiant&mode=dark`. Keys: `t` cycles
themes, `d` toggles mode.

### Built-in themes

| id | look | modes |
| --- | --- | --- |
| `midnight` | clean flat dark (default) | dark · light |
| `protocol` | flat technical-docs | dark · light |
| `primer` | editorial-bold, soft shadows | light · dark |
| `radiant` | gradient/glow, big display | light · dark |
| `commit` | dark-first flat (draft) | dark · light |
| `octo-glass` | Liquid Glass (vendored `@octo/ui` tokens) | dark · light |

### Writing a theme

Most themes are **data, not code** — fill the contract under your scope:

```css
/* src/themes/sunrise/theme.css */
[data-theme="sunrise"] {                         /* identity (mode-independent) */
  --octo-font: 'Fraunces', serif;
  --octo-radius: 18px;
}
[data-theme="sunrise"][data-mode="light"] {      /* polarity seeds — rest derives */
  --octo-bg: #fdfcf9; --octo-fg: #2b2118; --octo-accent: #e0644b;
}
[data-theme="sunrise"][data-mode="dark"] {
  --octo-bg: #1a1410; --octo-fg: #f3ece2; --octo-accent: #ff7a5c;
}
```

Surfaces, muted text, borders, and card fills **derive** from `bg`/`fg`/`accent`
via `color-mix`, so light and dark stay coherent from a few seeds. For richer
themes, fill the **material layer** too — `--octo-panel-bg`, `--octo-panel-shadow`,
`--octo-panel-backdrop` (blur), `--octo-panel-sheen`, `--octo-backdrop`,
`--octo-heading-fill` (gradient text). That's all glass/gradient looks need —
no component CSS. Then register it in `src/themes/index.ts`.

### Reverse-engineering a theme from a live site

Most real themes are recovered from a rendered page, not a token source:

```bash
npx playwright install chromium          # one-time
npm run extract-theme -- https://primer.tailwindui.com primer
```

It loads the URL (following an embedded preview iframe), sweeps computed styles
for colors/fonts/material in both light and dark, and writes
`src/themes/primer/{theme.draft.css, tokens.json, reference.png}`. Review the
draft against the screenshot, pick the real accent, then rename to `theme.css`.

## The `h()` helper

```ts
h('div', { class: 'card', onClick: () => ... }, h('h3', 'Title'), 'text child')
```

- Second arg is treated as props **or** a child (so `h('h1', 'text')` works).
- `onX` keys become event listeners; `style` accepts a string or object.
- `raw('<svg>…</svg>')` builds a fragment from an HTML string.

## Navigation (free, built in)

| Key | Action |
| --- | --- |
| `→` / `Space` / `PageDown` | next fragment, then next slide |
| `←` / `PageUp` | previous fragment, then previous slide |
| `Home` / `End` | first / last slide |
| `F` | toggle fullscreen |

Also: swipe left/right on touch devices, and deep-linking via the URL hash
(`#/3` jumps to slide 3).

## Configuration

```ts
import { deck } from './framework'
import { slides } from './slides'

deck(slides, {
  mount: '#deck',        // selector or element
  showProgress: true,    // the "3 / 12" readout
  showProgressBar: true, // thin top bar
  hashRouting: true,     // sync slide to URL hash
  touch: true,           // swipe navigation
  loop: false,           // wrap past the last slide
}).start()
```

## Theming

Override the CSS custom properties from `src/framework/styles.css`
(`--octo-bg`, `--octo-accent`, `--octo-font`, …) anywhere in your own CSS.

## Layout

```
src/
  framework/        the reusable engine (drop into any project)
    deck.ts         Deck class — navigation, rendering, fragments, routing
    h.ts            hyperscript DOM helper
    types.ts        Slide / SlideContext / DeckOptions
    styles.css      base theme
    index.ts        public API barrel
  slides/index.ts   YOUR deck lives here
  main.ts           bootstrap
  app.css           styling for the example slides
```
