# Deck export and theme switching on the canvas

Design record, 2026-08-22. Phases 3 and 4 of [the deck capability design](2026-08-21-deck-capability-and-canvas.md), scoped by [the handoff](2026-08-22-dsh-deck-handoff.md) that closed the walking skeleton.

Adds three export buttons and a theme switcher to the `@onetest/dsh-deck` canvas header. A deck already renders live on that canvas; this makes it leave the harness as a file.

## The decision that shapes everything else

**The renderer is the browser already showing the deck.** No Playwright launch, no system-browser discovery, no bundled Chromium — the canvas holds a same-origin iframe containing the fully rendered deck, and that is the render surface.

This was not the original plan. [The capability design](2026-08-21-deck-capability-and-canvas.md) put headless capture in an optional `@onetest/dsh-deck-capture` package specifically so a harness install would not acquire a browser download. Reusing the browser that is already running deletes that package before it is written.

Two checks confirmed the ground is solid:

- `dsh-desktop` (the Electron shell) loads the harness from `http://127.0.0.1:<port>` (`src/main/server.ts:27`), and the deck route is served by that same server — so the iframe is same-origin in `dsh web` and in the desktop app alike.
- That Electron shell grants nothing extra. Its main window runs `contextIsolation: true, nodeIntegration: false` with **no preload** (`src/main/window.ts:16`; `src/main/settings-window.ts:16` states the preload lives only on the settings window). Its only IPC channels are `settings:read`, `settings:pick-folder`, `settings:save`. From inside, the plugin's client half is exactly a web page.

So `printToPDF` and `capturePage` are unreachable, and reaching them would mean adding a preload to `dsh-desktop` — breaking its own "shell, not a fork" premise and making export work only in the desktop app. The design assumes nothing beyond a standards-compliant browser.

**Consequence, accepted:** the server has no renderer, so a model-callable `deck_export` tool cannot produce PPTX or PDF. Export is client-initiated. Buttons work; autonomous export does not.

**Constraint, held throughout:** Node only. The current PPTX packaging shells out to `python3` (`scripts/pptx/build.ts:63`); that dependency is removed, not ported.

## Architecture

Export splits at one line: what only a browser can know (measured layout of the live DOM) versus what only Node should do (file assembly and writes).

```
canvas button
   │
   ├─ HTML ──────────► GET  {base}/@export/{key}/html?theme=<id>&mode=<mode>
   │                                            (pure Node: vite build + inline)
   │
   └─ PPTX / PDF
        │ hidden 1280×720 iframe, one slide at a time
        │ WALKER(document) measures the live DOM → Scene IR (JSON)
        └─ POST {base}/@export/{key}/{pptx|pdf}   { ir, theme, mode }
                                                  (pure Node: IR → file)
```

| unit | responsibility | depends on |
|---|---|---|
| `src/client/extract-deck.ts` | drive a hidden iframe, return `SlideIR[]` | vendored `WALKER`, DOM |
| `src/host/export-route.ts` | three endpoints, containment, write + stream | `decodeDeckKey` / `isDeckDirectory` |
| `src/export/html.ts` | deck → self-contained HTML | `vite`, `vite-plugin-singlefile` |
| `src/export/pptx.ts` | IR → `.pptx` | vendored `ooxml` / `theme` / `color` / `ir` |
| `src/export/pdf.ts` | IR → `.pdf` | vendored `ir`, embedded TTFs |
| `src/export/zip.ts` | virtual file map → ZIP bytes | `node:zlib` |

### The route is `@export`, not `export`

Deck names match `/^[a-z0-9][a-z0-9-]*$/` (`packages/dsh-deck/src/definition.ts:36`), so `export` **is a legal deck name** — a plain `{base}/export` prefix would shadow a real deck. `@` can never appear in a name, and the prefix matches the existing `/@dsh-deck/` idiom.

The harness dispatches longest-prefix-wins (`packages/host/webserver/src/index.ts:256` in the harness checkout), so `{base}/@export` sits under the preview base without touching `preview-route.ts`'s handler. Containment is unchanged: `decodeDeckKey` then `isDeckDirectory`, the same rule the preview server already enforces.

### Extraction uses a hidden iframe, never the visible canvas

`WALKER` measures `getBoundingClientRect()`, and the deck applies `scale(min(innerWidth/1280, innerHeight/720))` (`src/framework/deck.ts:73`). At the canvas's arbitrary size every rect comes back scaled and the IR is silently wrong. A 1280×720 offscreen iframe gives scale exactly 1 — the same condition the Playwright script buys with a fixed viewport. It also leaves the slide the user is looking at undisturbed.

### Backdrops are vendored, not baked at runtime

`scripts/pptx/bake-backdrops.ts` is a browser screenshot, but it is per-*theme* and deck-independent — six PNGs at most. Baked once in this repository and shipped in the package's `vendor/`. This removes the last runtime browser dependency.

## Producers

**`zip.ts`.** `buildPptx` already returns `Record<string, string | Buffer>`, a virtual file map (`scripts/pptx/ooxml.ts:155`). So the Python step is not replaced but deleted, along with the `dist-pptx/unpacked` disk staging it required: deflate each entry with `node:zlib`'s `deflateRaw`, emit local headers and a central directory. `[Content_Types].xml` must be the first entry — the one ordering PowerPoint is strict about.

**`pptx.ts`.** Thin: `IR + theme id → resolveTheme() → buildPptx() → zip()`. The vendored `themes.resolved.json` snapshot means `pptx:themes` never runs at export time; vendored backdrops mean `pptx:bake` never does either.

**`pdf.ts`.** A new writer over the same `SlideIR`: one page per slide, `rect`/`text`/`path` shapes to content streams, TTFs embedded as `FontFile2` with Identity-H CID mapping, gradients as Type 2/3 shadings.

The IR is in CSS pixels and PDF's unit is the point, so each page is **960×540 pt** (1280×720 px at 96dpi) and the content stream carries a `0.75` scale. Stating the conversion here because "1280×720" appears throughout this document as the *pixel* canvas and would otherwise be read as the page box.

Text stays real text — selectable, searchable, roughly a tenth the size of today's 2× raster export.

**`html.ts`.** The obvious implementation is wrong. A `vite.build()` over `runtime/index.html` produces a file that still 404s, because `packages/dsh-deck/runtime/entry.ts:31` loads slides through `@vite-ignore` dynamic imports and Rollup deliberately does not follow those — the deck never gets bundled. The fix is a **generated entry** that statically imports the deck's `slides.ts` and `deck.json` by absolute path. That also drops the `/@dsh-deck/` alias for this path (`fs.allow` is a dev-server concern, not a build one), so no resolver refactor is needed and containment stays at the route.

The generated entry takes the theme and mode from the request's query rather than from `deck.json`, so HTML export follows the displayed theme like the other two formats. It registers only that one theme, since a single-file export has no switcher to serve — which also keeps exactly one theme's fonts inlined rather than all six.

### Fonts

The six themes pull faces from three hosts, and only some are vendored:

| theme | face | vendored TTF |
|---|---|---|
| octo-glass | Geist, Geist Mono | yes |
| radiant | Switzer | yes |
| commit, protocol | Inter (rsms.me) | no |
| primer | Cabinet Grotesk + Inter | no |

All three formats need these files — PPTX and PDF embed them, HTML inlines them. This gap is **pre-existing, not introduced here**: today's PPTX already warns `font not embedded` on four of six themes, and `scripts/inline-single.mjs` only ever matched the `fonts.googleapis.com` import, leaving four themes' fonts remote in a file that claims to be self-contained. Shipping export buttons makes it user-visible.

**Decision: vendor Inter; fetch-or-warn for Cabinet Grotesk.** Inter is OFL and clean to redistribute, covering `commit` and `protocol` fully and `primer`'s body text. Cabinet Grotesk is fetched at export time when the network is up; otherwise the export **succeeds** with an explicit warning naming the missing face. This adds no new licensing exposure — Cabinet Grotesk is Fontshare, the same redistribution question the handoff already lists as open for Switzer.

## Theme switching

The framework already supports this; almost nothing new is required.

- `deck.setTheme(id, mode)` (`src/framework/deck.ts:106`), `toggleMode()`, a `themes` getter, and a `deckt:themechange` event to keep the header in sync.
- Theme CSS is **lazily loaded** — `load: () => import(...)`, fetched on first use (`src/themes/index.ts`). Registering all six costs nothing until one is applied, so a deck page does not pull fonts from three CDNs at once; a theme's fonts load only when it is selected.
- The deck already reads `?theme=` and `?mode=` from the URL at startup (`src/framework/deck.ts:87`).

So the runtime change is one line: `packages/dsh-deck/runtime/entry.ts` registers `themes: themeList` (all six) with `theme: meta.theme` as the initial pick, instead of registering only the authored theme.

This makes export simpler rather than harder. The hidden extraction iframe loads `?theme=<id>&mode=<mode>&_=n#/n` — the same mechanism the proven Playwright script uses. `themes.resolved.json` already carries all six themes for PPTX and PDF, and vendoring the rich themes' backdrops covers switching. The light/dark mode toggle comes nearly free, since each theme declares its supported `modes`.

**Scope: preview-only, and export follows the displayed theme.** Switching is a viewing choice; `deck.json` keeps the theme the agent authored. The user can preview all six and export the one they like, and a casual preview click never silently rewrites authored intent. `deck_view`'s `presentationMeta.theme` therefore continues to report the authored theme, not the displayed one.

## The client half

`src/client/extract-deck.ts` drives the hidden iframe, one slide per reload:

```
for n in 1..slideCount:
    iframe.src = `${route}?theme=${theme}&mode=${mode}&_=${n}#/${n}`
    await load → await contentDocument.fonts.ready → settle
    ir.push(WALKER(iframe.contentDocument))
```

Per-slide reload rather than hash navigation, matching the proven script — a hash change re-runs neither entry animations nor font settling. At roughly 600ms per slide a 20-slide deck takes about 12 seconds, which is why progress is part of the design rather than bolted on. The iframe is removed in a `finally`, including on abort.

**One upstream change, not a fork: `WALKER` takes a `document` parameter.** It closes over the global `document` today (`scripts/pptx/extract.ts:20`) because Playwright stringifies it into the page. In an iframe the parent's `document` is the wrong one, and `contentWindow.eval` is both an eval and CSP-fragile. Parameterizing it (`WALKER(doc)`, using `doc.defaultView.getComputedStyle` and `doc.createRange()`) leaves Playwright's call site working — it passes `document` — and makes it directly callable against the iframe. One source, two consumers.

**Cross-origin guard.** If `contentDocument` is ever `null` — a future shell serving the UI over `file://` while the deck stays on HTTP — extraction fails immediately naming cross-origin, rather than producing an empty IR that exports a blank deck.

### Header layout

Title (truncating), theme `<select>`, `Export` (menu: HTML · PDF · PPTX), `Open in tab`, `Close`. While an export runs the menu is replaced by `Slide 7/20…`; on failure, by an error line naming the cause.

`MIN_WIDTH` goes 320 → 420. 320 was already marginal for a readable 16:9 frame and will not hold five controls.

Export status and the selected theme live in `CanvasState` on the root-scoped controller, alongside `view` / `open` / `geometry`. `DeckOverlay` stays presentational and unit-testable as it is now, and an in-flight export survives the canvas being dragged or retargeted.

HTML export needs no extraction — it is a plain link to the route — so that button works even while the iframe path is running.

## Delivery

Each export **writes into the deck directory and streams the file as a download**. The artifact lands at `.deck/<name>/export/<name>-<theme>.<ext>`.

Writing as well as downloading is what lets the model see and reference the artifact on disk; downloading as well as writing is what gets it to the user without a file hunt. The cost is disk in the workspace, accepted.

Deck files today are written with bare `node:fs`, bypassing the harness filesystem capability — the handoff records this as a known blocker for upstreaming. Export writes follow the same path for consistency and inherit the same debt; fixing it is a separate change across all deck writes.

## Failure modes

| failure | outcome |
|---|---|
| unknown or invalid deck key | 404 at the route; containment stays `isDeckDirectory` |
| malformed IR body | 400, no file written |
| missing TTF (Cabinet Grotesk, offline) | export **succeeds**, warning names the substituted face |
| slide extraction times out | abort the export, name the slide, remove the iframe |
| cross-origin iframe | fail fast, named cause |
| workspace write fails | surfaced verbatim; no half-written file |

Nothing partially succeeds silently. The font warning is the one deliberate exception, and it is visible in the header.

## Testing

Against the existing vitest + jsdom + testing-library setup (75 tests passing today):

- `zip.ts` — round-trip through a reader written in the test; `[Content_Types].xml` is entry zero, CRC32s correct, central-directory offsets correct.
- `pdf.ts` — structural invariants (page count, 960×540 pt page box, embedded `FontFile2`, text objects present), not golden bytes.
- `export-route.ts` — containment rejection, format dispatch, headers, write-then-stream ordering.
- `extract-deck.ts` — iframe lifecycle, sequencing, cleanup, abort, cross-origin guard, with a stubbed walker.
- `canvas-state` and `DeckOverlay` — export status transitions, theme selection, menu, progress, disabled states.
- `html.ts` — integration against a scaffolded temp deck with a real `vite.build()`.

**Honest gap.** jsdom has no layout, so `getBoundingClientRect` returns zeros and **`WALKER` itself cannot be meaningfully unit-tested here**. The driver around it is new and fully covered; WALKER's own correctness stays where it is today — verified by looking. Per this repository's convention, that is closed by exporting a real deck in all three formats, in more than one theme, and opening the files.

## Build sequence

1. `zip.ts` and the `python3` removal — unblocks PPTX and is independently verifiable against the existing CLI export.
2. `export-route.ts` with HTML only — proves the seam end to end with the producer that needs no browser.
3. Theme switcher — one-line runtime change plus header UI; independently useful and gates nothing.
4. `WALKER(document)` parameterization and `extract-deck.ts` — the browser half.
5. `pptx.ts` — first consumer of the IR path.
6. `pdf.ts` — the largest new component, last.

HTML and PPTX land well before PDF.

## Rejected

**Playwright in the plugin.** Every install pays a browser download for something the running browser can already do.

**A separate `@onetest/dsh-deck-capture` package.** Its whole purpose was keeping the browser download out of the base install; with no browser needed, it is two packages to publish and version in lockstep for no gain.

**Browser print-to-PDF (`window.print()`).** Near-zero code and faithful, but the file goes through the OS save dialog: no workspace write, and the model never sees the artifact. It breaks the delivery model for exactly one format.

**In-page raster (SVG `foreignObject` → canvas).** Silently drops external fonts and much CSS. Against this project's pixel-tight bar.

**Electron `printToPDF` via a `dsh-desktop` preload.** Would work only in the desktop app, dead in `dsh web`, and breaks that shell's "never modifies the harness" premise.

**Persisting theme switches to `deck.json`.** A casual preview click would silently rewrite what the agent authored.
