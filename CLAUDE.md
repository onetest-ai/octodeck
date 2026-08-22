# CLAUDE.md — agent guide to this repo

**Octodeck** is a tiny TypeScript + Vite framework for building presentation decks as
webpages. Slides are plain TS components — `(ctx) => HTMLElement` — rendered on a
fixed **1280×720 (16:9) canvas that scales to the viewport**, themed entirely through
a `--octo-*` CSS variable contract. It ships as a **self-contained, distributable
skill** (`octodeck-presentations`) installable via `npx skills add`.

This repo is **under git** (single clean history) with **CI** (`.github/workflows/ci.yml`:
build + SKILL validation + bundled-template staleness guard).

## Run it

```bash
npm install
npm run dev                 # http://localhost:9001  (port set in vite.config.ts)
npm run new:deck -- <name>  # scaffold a deck → /<name>.html + src/decks/<name>/
npm run build               # tsc --noEmit + production bundle → dist/
```

`index.html` → `src/main.ts` is the **component gallery / theme switcher** (the only
deck shipped in-repo; it demos the framework). Real decks are created with `new:deck`:
each is its own `<name>.html` + `src/decks/<name>/{main.ts,slides.ts,<name>.css}`.

## Exporting a deck (all faithful to the live render; need `npm run dev` running)

| command | output | notes |
|---|---|---|
| `DECK=<name> npm run build:single` | `dist-single/<name>.html` | self-contained file, all JS/CSS/fonts inlined; offline |
| `npm run build:pdf -- <theme> --deck <name>` | `dist-pdf/<name>-<theme>.pdf` | one slide per page, 16:9, pixel-perfect (raster) |
| `npm run build:pptx -- <theme> --deck <name>` | `dist-pptx/<name>-<theme>.pptx` | **pixel-tight, editable** native PowerPoint |

`--deck` is required. `build:pptx` also needs a one-time `npm run pptx:themes`
(theme-token snapshot) + `npm run pptx:bake` (rich-theme backdrops). Export uses the
system browser (Chrome/Edge), falling back to a bundled Chromium. Full pptx runbook:
`scripts/pptx/README.md`.

## Layout

```
src/framework/   the Octodeck engine — h.ts (hyperscript), components.ts (slide
                 templates/primitives), deck.ts (scaling renderer + nav), contract.css
                 (the --octo-* token contract), styles.css, theme.ts, diagram.ts
src/themes/      6 themes: commit, midnight, octo-glass, primer, protocol, radiant
src/decks/       decks you scaffold with `npm run new:deck` (empty by default)
src/slides/      the component-gallery slideshow shown at index.html
scripts/         new-deck.mjs, export-pdf.ts, inline-single.mjs, extract-theme.ts,
                 build-skill-assets.mjs (bundle generator), validate-skill.mjs, and
                 pptx/ (the HTML→PowerPoint pipeline: extract.ts, ooxml.ts, build.ts, …)
skills/octodeck-presentations/   the distributable SKILL (methodology + QA refs +
                 scripts + assets/template = a generated, self-contained Octodeck project)
packages/dsh-deck/  @onetest/dsh-deck — the DeepSeek Harness plugin: deck tools, a
                 middleware-mode Vite preview server, the floating canvas (theme
                 switcher + HTML/PDF/PPTX export buttons), the export route, and the
                 Deck creator agent preset. `npm run build` there vendors src/framework
                 and src/themes into the package so a published copy is self-contained.
                 Export launches no browser: the canvas measures the deck in a hidden
                 same-origin iframe and Node assembles the file.
```

## Conventions (get these right)

- **Size in `cqw`/`cqh`/`rem`, never `vw`/`vh`** — the canvas is scaled; window units break.
- **Never hardcode colours** — read the `--octo-*` contract so slides theme for free.
- **Content must fit the 16:9 frame** — no overlap, no clipping, fill the frame.
- **Verify by looking.** Screenshot every slide and bug-hunt with fresh eyes; the first
  render is rarely right. Use `skills/octodeck-presentations/scripts/capture_slides.mjs`.
- The **deck-building methodology lives in the `octodeck-presentations` skill** — read it
  (and its `references/`) before building/reviewing slides or exporting.

## Gotchas that have bitten

- **Exports need the dev server** (except `build:single`). They render the live DOM.
- **Do NOT leave fonts installed in `~/Library/Fonts`.** Staging Geist/Switzer there for
  LibreOffice pptx-validation is system-wide and makes the *browser* render the HTML
  deck with the wrong font cut. Stage transiently, then remove (see `scripts/pptx/README.md`).
- **pptx colour helpers (`tintAlpha`/`tintOverBg`/`mix`) take fractions (0.45), not
  percents (45)** — including inside ternaries.
- **The skill bundles a generated copy of the project** in `assets/template/`. After
  changing the framework/scripts, run `npm run skill:assets` to regenerate it (CI fails
  if it's stale). Edit the canonical `skills/octodeck-presentations/`;
  `.claude/skills/octodeck-presentations` is a symlink to it.

## Where to look next

- `README.md` — the framework's quick-start and slide-authoring guide.
- `scripts/pptx/README.md` — the pixel-tight HTML→PowerPoint runbook.
- The `octodeck-presentations` skill (`SKILL.md` + `references/`) — how to build/export decks.
- `docs/design/2026-08-22-dsh-deck-handoff.md` — state of the DeepSeek Harness plugin: what is
  verified, what is assumed, and the constraints that are not visible from the code.
- Memory index: `.claude/projects/-Users-arozumenko-octofarm/memory/MEMORY.md`.
```
