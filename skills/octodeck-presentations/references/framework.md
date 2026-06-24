# Octodeck Framework Mechanics

Read this when structuring or building slides. It covers the scaling model, the
theme contract, the templates/components to compose with, and theming.

## Files

- `src/framework/components.ts` — slide templates + layout/content components.
- `src/framework/diagram.ts` — the `Diagram` component (see `diagrams.md`).
- `src/framework/contract.css` — the `--octo-*` variable interface every
  component reads. **Slides never hardcode colors/sizes — they read these.**
- `src/framework/theme.ts` + `src/framework/deck.ts` — theme runtime + engine.
- `src/decks/<name>/` — a self-contained deck (HTML entry + main + slides +
  local theme + local helpers). Use this pattern, not the gallery, for real decks.

## Scaling model (why `cqw/cqh`, not `vw/vh`)

Every slide renders on a fixed **1280×720 design canvas** that the engine scales
with a CSS transform to fit the window (letterboxing if the aspect differs). So:

- A slide is always exactly 16:9; you design once at 1280×720 and it fits any screen.
- `rem` and `px` are fixed canvas units → they scale with the canvas. Good.
- `cqw`/`cqh` are container-query units relative to the canvas (the canvas is a
  size container) → they too are frame-relative. Good.
- `vw`/`vh` reference the *window*, not the canvas → they break under scaling.
  Never use them in slide or deck CSS.

`width`/`height` deck options change the canvas size if you ever need 4:3, etc.

## The contract (theme interface)

Components read semantic variables; a theme fills them. Key ones:

- Color seeds: `--octo-bg`, `--octo-fg`, `--octo-accent` (most else derives via
  `color-mix`: `--octo-surface`, `--octo-fg-muted`, `--octo-border`, …).
- Type: `--octo-font`, `--octo-font-heading`, `--octo-font-mono`,
  `--octo-weight-heading`, `--octo-tracking-heading`, `--octo-fs-*`.
- Material (the "panel" surface role): `--octo-panel-bg`, `--octo-panel-border`,
  `--octo-panel-shadow`, `--octo-panel-backdrop` (blur), `--octo-panel-sheen`.
- Decoration: `--octo-backdrop` (full-bleed gradient/aurora), `--octo-heading-fill`.

Because components read these, the same slide restyles across themes (flat,
glass, gradient) with zero per-slide changes.

## Slide templates (fill the whole slide)

| Slide job | Template |
|---|---|
| Opener / closer | `TitleSlide` (dark) · `StatementSlide` |
| Section divider | `SectionSlide` |
| Titled content (the workhorse) | `HeaderSlide({ kicker?, title, subtitle? }, …body)` |
| Text + full-bleed media | `SplitSlide({ ratio, side, media }, …content)` |

## Parametric components (compose inside templates)

Prefer one parametric component over a zoo of bespoke ones — e.g. `Columns`
covers every ratio.

| Content shape | Component |
|---|---|
| N columns, any ratio | `Columns({ cols: '65/35' | 3 | [2,1] })` |
| Asymmetric tiles / stat wall / logo wall | `Bento({ cols, rows })` + `Tile({ span, rowSpan })` |
| Vertical stack | `Stack({ gap, align })` |
| Process · timeline · agenda | `Sequence({ orientation })` + `Step({ label, title })` |
| KPI / big number | `Metric({ value, label })` |
| Feature list (optional step-reveal) | `Bullets(items, { fragment })` |
| Card | `Card({ title?, accent? }, …)` |
| Architecture / flow | `Diagram(spec)` — see `diagrams.md` |
| Testimonial | `Quote({ author, role, avatar }, …text)` |
| Logos | `LogoWall(logos)` |

Vary which you use slide-to-slide — repetition of the same layout is an AI tell.

## Fit & alignment mechanics

- Author custom slide shells as `position: absolute; inset: 0` with internal
  padding, so full-bleed bars/media reach the edges and `overflow: hidden` on the
  body guarantees no overlap with header/bar.
- Reserve fixed heights for variable elements: a card title that may wrap to two
  lines gets `min-height: 2.3em` so underlines and lists align across a row.
- Keep dense content within 720px tall: tight item fonts (~`1.2cqw`), tight gaps,
  2-line-max titles. If it still won't fit, split the slide.

## Theming

- A theme is **data**: fill the contract under `[data-theme="x"]` (identity) and
  `[data-theme="x"][data-mode="m"]` (seed colors per light/dark). Material is just
  more variables — no per-theme component CSS.
- **Scope a deck's theme to that deck** (register it on the deck, not the global
  registry) so one deck never restyles another.
- **Reverse-engineer a brand/site look** instead of guessing tokens:
  `npm run extract-theme -- <url> <name>` sweeps computed styles (colors, fonts,
  material, both light/dark) into a draft theme; refine it against a screenshot.

## Separate-deck pattern

A real deck lives in its own folder + HTML entry so it can't disturb others:

```
src/decks/<name>/
  theme.ts / theme.css   # local theme (defineTheme, scoped)
  components.ts          # deck-local helpers (frames, bars, medallions)
  slides.ts              # the slide functions
  main.ts                # deck(slides, { themes:[local], theme:'<name>' }).start()
<name>.html              # entry at project root → /<name>.html ; add to vite.config input
```

## Export to ONE self-contained HTML file (shareable, offline)

To hand someone a single file that opens anywhere with **zero external references**
(no dev server, no network), compile JS + CSS + favicon + fonts into the HTML.

1. **Install** `vite-plugin-singlefile` (`npm i -D vite-plugin-singlefile`).
2. **A dedicated build config** — `vite.singlefile.config.ts`, one HTML input, all
   assets forced inline:
   ```ts
   import { defineConfig } from 'vite'
   import { viteSingleFile } from 'vite-plugin-singlefile'
   export default defineConfig({
     plugins: [viteSingleFile()],
     build: {
       outDir: 'dist-single',
       cssCodeSplit: false,        // fold the lazily-imported theme.css in
       assetsInlineLimit: 100_000_000,
       rollupOptions: { input: '<name>.html' },
     },
   })
   ```
   `vite build --config vite.singlefile.config.ts` inlines the JS and CSS into the HTML.
3. **Post-process for true self-containment** (a small `scripts/inline-single.mjs`):
   - **favicon** → replace `href="./favicon.svg"` with a `data:image/svg+xml;base64,…` URI.
   - **fonts** → the theme's `@import url("https://fonts.googleapis.com/…")` survives as a
     *remote* import. Fetch that CSS (with a desktop-Chrome `User-Agent` to get `woff2`),
     fetch each `*.woff2`, base64 them into `data:font/woff2;base64,…`, and replace the
     `@import` with the resulting `@font-face` block.
4. **Wire it** as an npm script: `"build:single": "vite build --config vite.singlefile.config.ts && node scripts/inline-single.mjs"`.

**Gotchas (each cost a debug cycle):**
- Vite **minifies** `@import url("x")` → `@import"x";`, so match
  `/@import"https:\/\/fonts\.googleapis\.com[^"]*";/` — and note the Google URL itself
  contains `;` (`wght@400;500;…`), so match to the **closing quote**, not the first `;`.
- The per-deck theme CSS is **dynamically imported** (code-split); `cssCodeSplit: false`
  is what folds it into the single inlined stylesheet.
- Font inlining needs network **at build time** (fetching gstatic) — make the script
  degrade gracefully (keep the remote `@import`) if offline.
- **Verify** by loading the file over `file://` in Playwright with `context.setOffline(true)`
  and screenshotting — proves it renders with no network. Result is ~0.5 MB (fonts dominate).
