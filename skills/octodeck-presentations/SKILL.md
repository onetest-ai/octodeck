---
name: octodeck-presentations
description: "Build, recreate, improve, or review slide decks with the Octodeck framework (src/framework/, src/decks/). Use this whenever the user is working on a presentation in this project — creating a new deck, recreating one from a PDF/PPTX, adding or fixing slides, building diagrams, theming, or reviewing how a deck looks. Trigger on 'deck', 'slides', 'presentation', 'pitch deck', 'recreate this PDF/PPTX as slides', or any work under src/decks/ or src/framework/, even if the word 'Octodeck' isn't used. It encodes the layout, scaling, diagram, and visual-QA rules that keep a deck from looking AI-generated. To export an Octodeck deck to a pixel-tight PowerPoint, see references/pptx-export.md (NOT the generic 'pptx' skill — that builds slides from scratch; this reproduces the deck you designed)."
compatibility: "Operates an Octodeck project (Node + Vite; dev server on :9001). Slide capture and PDF/PPTX export need Playwright (npx playwright install chromium); rasterizing source decks and validating PPTX renders need poppler (pdftoppm) and LibreOffice (soffice)."
metadata:
  version: "0.1.0"
---

# Building Effective Presentations (Octodeck)

This skill encodes how to build a deck with the **Octodeck** framework
(`src/framework/`) that looks professional rather than AI-generated. Most of the
rules exist because a real deck got them wrong first; the *why* is given so you
can apply judgment, not just follow steps.

A Octodeck deck is TypeScript: each slide is a function returning DOM, themed by a
CSS-variable contract, rendered on a fixed 16:9 canvas that scales to the screen.

## The non-negotiables

Get these wrong and the deck looks broken or amateur. Check every one before
declaring a slide done.

1. **Content fits the 16:9 frame — never overlaps, never clips.** Header, body,
   and any footer bar must not collide; nothing bleeds past the edge; no text
   hides under a bar or gets cut at a box boundary. If it doesn't fit, make it
   fit — smaller, fewer items, or split into two slides. The cheap insurance is
   `overflow: hidden` on the body region so it can never spill into the header/bar.
2. **Fill the frame.** Content marooned in a small band with dead space around it
   reads as unfinished. If you have little to say, say it bigger — don't shrink it.
3. **It scales.** A deck is shown end-of-day on a projector. Octodeck scales the
   canvas automatically; you only keep it true by sizing in `cqw`/`cqh`/`rem`,
   never `vw`/`vh` (those track the window, not the frame, and break under scale).
4. **No alignment jumps.** Repeated things — cards in a row, list items, headings
   — must share baselines, start positions, and gaps. A 1-line title beside a
   2-line title still aligns (reserve a fixed height so it does).
5. **Verify by looking, with fresh eyes.** The first render is almost never
   right. Screenshot every slide and hunt for bugs — assume they exist.

## Workflow

Work in a **plan → build → verify** loop. Never build the whole deck and check
once at the end; build a few slides, screenshot, fix, repeat.

1. **Understand the source / intent.** Recreating a PDF or PPTX? Rasterize and
   read every page first, and catalog each slide's archetype plus the deck's
   design language (palette, fonts, motif) before writing code:
   ```bash
   bash scripts/rasterize_source.sh <source.pdf|pptx> /tmp/src
   ```
   Strip review annotations (e.g. "Zach to update", "Team review complete") —
   they're scaffolding, not design.
2. **Shape the argument, then the structure.** For each slide, name its one idea
   and write the title as the *takeaway* (assertion), then pick the layout that
   fits it and the theme (once, up front). `references/principles.md` for the
   communication fundamentals (one-idea, narrative, hierarchy), `references/layouts.md`
   for which layout to use and how to use it optimally, `references/design.md` for
   palette/type/motif, `references/framework.md` for the component catalog.
3. **Build.** Compose templates and parametric primitives; never hardcode colors
   (read the contract). Diagrams follow `references/diagrams.md`.
4. **Verify.** Run the dev server, then screenshot every slide:
   ```bash
   node scripts/capture_slides.mjs --url http://localhost:9001/<deck>.html \
        --count <N> --out /tmp/shots --themes <a,b> --mode <light|dark>
   ```
   Inspect with fresh eyes (ideally a subagent) against the bug list in
   `references/qa.md`. Fix, then **re-verify the changed slide** — one fix often
   breaks a neighbor. Done only when a full pass finds nothing new.

## Reference files

Read the one relevant to your current step; don't load them all up front.

- **`references/principles.md`** — how slides *communicate*: one idea per slide,
  the title-as-assertion habit, narrative arc, visual hierarchy, CRAP, cognitive
  load. Read when shaping the deck's story and deciding what each slide is for.
- **`references/layouts.md`** — the layout catalog: for each archetype, when to
  use it, how much it holds, the Octodeck composition, and how to use it optimally
  (plus pitfalls). Read when laying out any slide.
- **`references/design.md`** — visual design decisions: palettes, the 60–70%
  dominance rule, dark/light sandwich, motif, type pairings/scale, and the
  anti-pattern list (the AI-generated tells). Read when choosing the look.
- **`references/framework.md`** — Octodeck mechanics: the scaling canvas, the
  `--octo-*` contract, slide templates, the parametric component playbook,
  theming (incl. `extract-theme`), and the separate-deck pattern. Read when
  structuring or building slides.
- **`references/diagrams.md`** — the `Diagram` component and the rules that keep
  diagrams clean (deterministic placement, adaptive label spacing, chip labels,
  shadow room, font-to-box proportion). Read before building any diagram.
- **`references/qa.md`** — the visual-QA bug-hunt checklist and how to use the
  capture script. Read during the verify step.
- **`references/pptx-export.md`** — exporting an Octodeck deck to a pixel-tight,
  editable PowerPoint (the `scripts/pptx/` pipeline). Read when the user wants a
  `.pptx` version of a deck they already built.

## Setup — one command (you run it; the user installs nothing)

This skill bundles the whole Octodeck project. When the user wants to work on decks and
there's no project yet, **run the bootstrap for them** — they install nothing:

```bash
node <skill-dir>/scripts/setup.mjs                       # → ./octodeck (copies project + npm install)
```

(`<skill-dir>` = where this skill is installed, e.g. `.claude/skills/octodeck-presentations`.)
It's idempotent — re-running once installed is a no-op. **Already in an Octodeck repo?**
(you see `src/framework/` + a `package.json` named `octodeck`) — skip setup.

Everything in the catalog below then runs **inside that project** (`cd ./octodeck`). The
bundle carries the framework, 6 themes, export pipeline, embedded fonts, and theme snapshot,
so `npm run dev` / authoring / `build:single` work with just `npm install` — **no browser**.
Export (pdf/pptx/capture) renders the deck in a browser and **auto-uses the machine's
installed Chrome/Edge** — no download. Only if there's *no* Chrome/Edge, add a bundled
Chromium fallback: `node <skill-dir>/scripts/setup.mjs --export`. Maintainers regenerate the
bundle from repo source with `npm run skill:assets`.

## Show the user — live preview (don't work blind)

A deck is visual, so the user must SEE it to steer. Don't build silently and hand over a
file — run a live loop, the way you'd demo something:

1. **Start the preview** — tell the user first ("I'll start a local preview server on :9001"),
   then run `npm run dev` in the background. The deck renders at
   `http://localhost:9001/<name>.html`; offer the user that URL to open live. Vite
   **hot-reloads on every edit**, so it stays current as you work.
2. **Show them in-chat** — capture the slides and display the PNGs inline, so they see the
   deck without leaving the conversation:
   `node <skill-dir>/scripts/capture_slides.mjs --url http://localhost:9001/<name>.html --count <N> --out /tmp/shots`
3. **Iterate** — edit `slides.ts` → the page live-reloads → re-capture → show → take feedback →
   repeat until they're happy. Then export (pdf / pptx / single).

Keep the dev server running across the session; one heads-up is enough.

## Command catalog — operating Octodeck

The deck lifecycle is **scaffold → dev → edit → verify → export**, all via `npm`
scripts run from the project root. Verify and export read the *live* deck, so they
need `npm run dev` running first.

**Scaffold & run**
- `npm run new:deck -- <name>` — create a starter deck: `src/decks/<name>/`
  (`main.ts` + `slides.ts` + `<name>.css`) + `<name>.html`, auto-registered in
  `vite.config.ts`. Starter has a cover / content / closing slide to edit. (`scripts/new-deck.mjs`)
- `npm run dev` — Vite dev server on **:9001**; open `/<name>.html`. Hot-reloads.
- `npm run build` — typecheck (`tsc --noEmit`) + production bundle → `dist/`.

**Verify (the QA loop — do this every time)**
- `scripts/capture_slides.mjs` — drive the running dev deck with Playwright and
  screenshot each slide (optionally across themes/modes); read the PNGs with fresh
  eyes against `references/qa.md`.
  `node <skill>/scripts/capture_slides.mjs --url http://localhost:9001/<name>.html --count <N> --out /tmp/shots [--themes a,b]`
- `scripts/rasterize_source.sh <source.pdf|pptx> <outdir> [dpi]` — when recreating a
  source deck, rasterize it first to read every page. Needs `pdftoppm` (poppler); `soffice` for PPTX.
- Both need the project's `playwright` dep (`npx playwright install chromium`).

**Export a finished deck** (start `npm run dev` first; see `references/pptx-export.md` for pptx)
- `npm run build:pdf -- <theme> [--deck <name>]` → one slide per page, exact 16:9, pixel-perfect (raster).
- `npm run build:pptx -- <theme> [--deck <name>]` → **pixel-tight, editable** native PowerPoint.
  One-time after setup (and when theme tokens/backdrops change): `npm run pptx:themes`, then
  `npm run pptx:bake` for rich-theme backgrounds — the bundle ships without the baked-backdrop
  cache, so without `pptx:bake` rich themes get a flat (not aurora/glow) PowerPoint background.
- `DECK=<name> npm run build:single` → one self-contained HTML (JS/CSS/fonts inlined; opens offline).

> `--deck <name>` is required (it names a scaffolded `<name>.html`); output is `dist-{pdf,pptx,single}/<deck>-<theme>.*`. Slide
> count auto-detects from the deck (override with `SLIDES=`); `DECK_BASE` overrides the host.
> So: `npm run new:deck -- talk` → edit → `npm run build:pptx -- octo-glass --deck talk`.

The generic `pptx` skill is only for building a `.pptx` from scratch — unrelated to an
Octodeck deck.
