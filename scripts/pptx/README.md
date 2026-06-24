# Octodeck → PowerPoint (pixel-tight export)

Exports an Octodeck deck (e.g. `<name>.html`) to a self-contained, **editable** `.pptx`
that matches the rendered HTML pixel-for-pixel: native grouped shapes, real text,
vector diagrams (béziers + gradients + arrowheads), embedded fonts, baked backdrop.

There are two ways to produce IR, both feeding the same OOXML backend:

- **Extraction (default, pixel-tight)** — measures the real rendered deck in a
  browser and transcribes the DOM to IR. **This is the one to use.** Needs the dev
  server running.
- **Synthetic (`--synthetic`)** — a hand-coded builder (`deck.ts` + `layout.ts`),
  no browser. A fallback for headless/MCP use; **not** pixel-tight (estimates text
  wrapping). Only touch this if you can't run a browser.

## Prerequisites (one-time)

1. **Playwright Chromium**: `npx playwright install chromium` (project already deps `playwright`).
2. **LibreOffice** (for visual validation only): `brew install --cask libreoffice`.
3. **Fonts** committed in `scripts/pptx/fonts/` (Geist, Geist Mono, Switzer TTFs).
   They are embedded into the `.pptx`, so PowerPoint renders them correctly with
   nothing installed. **LibreOffice does NOT read PPTX-embedded fonts** (PowerPoint
   does), so local validation needs the TTFs visible to LO — see the warning below.

   > ⚠️ **Do NOT leave these fonts installed in `~/Library/Fonts`.** That is
   > system-wide and will change how the *HTML* deck renders in the browser
   > (a same-named "Geist" installed system-wide can override the page's own
   > inlined `@font-face`, making headings render with the wrong cut/weight).
   > Install them **only transiently** for a validation render and remove them
   > right after — see the Validate step.

## Build (the normal path)

```bash
npm run dev                       # serve the deck at :9001 (leave running)
npm run pptx:themes               # one-time / when a theme's tokens change → themes.resolved.json
npm run pptx:bake                 # one-time / when a rich theme's backdrop changes → backdrops/<theme>.png
npm run build:pptx -- octo-glass --deck <name>  # EXTRACTS the live deck → dist-pptx/<name>-octo-glass.pptx
```

- `build:pptx` defaults to extraction and **requires the dev server**. Append
  `--synthetic` to use the no-browser builder instead.
- Themes: `octo-glass` and `radiant` are rich (baked aurora/glow backdrop, fonts
  embedded); `midnight` is flat (solid bg, system→Calibri). Pass any theme id.

## Validate (no PowerPoint needed)

Render the `.pptx` with LibreOffice and eyeball it against the HTML. LibreOffice on
macOS finds fonts only via the system, so **temporarily** stage them, render, then
**remove them immediately** (leaving them installed breaks the HTML deck — see the
prerequisites warning):

```bash
soffice="/Applications/LibreOffice.app/Contents/MacOS/soffice"

# 1. capture HTML ground truth FIRST, before touching system fonts
node ../../.claude/skills/octodeck-presentations/scripts/capture_slides.mjs \
  --url http://localhost:9001/<name>.html --count 10 --out /tmp/htmlref --themes octo-glass

# 2. transiently install fonts, render the pptx, then clean up
cp scripts/pptx/fonts/*.ttf ~/Library/Fonts/
"$soffice" --headless --convert-to pdf --outdir /tmp/x dist-pptx/<name>-octo-glass.pptx
pdftoppm -png -r 144 /tmp/x/<name>-octo-glass.pdf /tmp/x/s        # → /tmp/x/s-01.png …
rm -f ~/Library/Fonts/{Geist,GeistMono,Switzer}-*.ttf             # ← REQUIRED cleanup
```

Then read both PNG sets (ideally via a subagent) and diff slide by slide. Expect
parity **except** CSS drop-shadow glows (filters have no PPTX equivalent) and tiny
dash-density differences.

## Files

| file | role |
|------|------|
| `extract.ts`  | **pixel-tight extractor** — DOM → IR (per-line text, per-side borders, SVG→vector). The default path. |
| `ooxml.ts`    | IR → OOXML parts (`p:grpSp` groups, `roundRect`/`diamond`/`ellipse`, `custGeom` paths, `gradFill`, embedded fonts, baked-image master bg). |
| `build.ts`    | entry point — resolve theme, get IR (extract or `--synthetic`), load fonts/backdrop, zip the `.pptx`. |
| `ir.ts`       | Scene IR types + colour helpers (`tintAlpha`/`tintOverBg`/`mix` take **fractions**, not percents). |
| `theme.ts`    | pure-JS theme adapter — reads `themes.resolved.json`. |
| `color.ts`    | colour parsing/space conversions (hex/rgb/oklch/oklab/lab/lch/color-mix → hex+alpha). |
| `resolve-themes.ts` | offline Playwright snapshot of `--octo-*` tokens → `themes.resolved.json`. |
| `bake-backdrops.ts` | offline render of rich-theme backdrops → `backdrops/<theme>.png`. |
| `deck.ts`, `layout.ts` | the `--synthetic` builder (fallback, not pixel-tight). |
| `fonts/`      | embeddable TTFs (Geist OFL · Switzer Fontshare-free). |

## Gotchas (learned the hard way)

- **Measure, don't re-derive.** Pixel parity comes from `getBoundingClientRect` +
  per-char `Range` rects, never from re-implementing CSS layout in JS.
- **Skip `<defs>`/`<marker>`** when walking SVG, or you emit stray template shapes.
- **`::marker` bullets and `text-transform` uppercase are not DOM text** — synthesize
  the bullet and apply the transform to the captured string.
- **Borders are per-side** — read all four (cells often have only `border-bottom`).
- **Name the exact font weight** (`Geist SemiBold`), don't set a bold flag, or the
  renderer synthesizes a too-heavy 700 over the deck's 600 headings.
- **Tint helpers take fractions** (`0.45`), not integer percents — including inside
  ternaries that regex sweeps miss.
