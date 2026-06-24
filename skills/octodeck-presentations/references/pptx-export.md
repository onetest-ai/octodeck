# Exporting an Octodeck deck to PowerPoint (pixel-tight)

This project has a **pixel-tight Octodeck→PPTX exporter** under `scripts/pptx/`. Use it
to turn a built Octodeck deck (e.g. `<name>.html`) into a self-contained, editable
`.pptx` that matches the rendered HTML pixel-for-pixel — native grouped shapes, real
text, vector diagrams (béziers + gradients + arrowheads), embedded fonts, baked
backdrop.

> Do **not** use the generic `pptx` skill for this. That one builds slides from
> scratch with limited styling/grouping. This pipeline reproduces *the Octodeck deck you
> already designed*.

## When to use

The user has an Octodeck deck and wants a PowerPoint version of it ("export to pptx",
"PowerPoint version", "the boss wants a .pptx"). The goal is parity with the HTML, not
a new deck.

## How (authoritative runbook)

The full, runnable procedure — prerequisites, commands, validation loop, and the
hard-won gotchas — lives next to the code: **`scripts/pptx/README.md`**. Read it and
follow it. The short version:

```bash
npm run dev                        # serve the deck (required — extraction reads the live DOM)
npm run pptx:themes && npm run pptx:bake   # one-time / when theme tokens or backdrops change
npm run build:pptx -- <theme> --deck <name>   # → dist-pptx/<deck>-<theme>.pptx  (pixel-tight extraction)
```

Validate with LibreOffice (it can't read embedded fonts — install the TTFs from
`scripts/pptx/fonts/` into `~/Library/Fonts` first), render to PNG, and compare
pairwise against `capture_slides.mjs` HTML screenshots. See the README for the exact
commands.

## Why it works (so you don't "fix" it the wrong way)

Parity comes from **measuring** the rendered deck (`extract.ts`: `getBoundingClientRect`,
per-char `Range` line rects, computed styles, SVG→native vector), never from
re-deriving CSS layout in JS. If a slide is off, the fix is almost always in the
*extractor's* measurement (e.g. a CSS feature not yet captured), not in nudging
coordinates. The README's "Gotchas" section lists the traps (skip `<defs>`, synthesize
`::marker` bullets + `text-transform`, per-side borders, name exact font weights, tint
helpers take fractions).

There's also a `--synthetic` no-browser builder (`deck.ts`/`layout.ts`) as a fallback
for headless/MCP use — it is **not** pixel-tight.
