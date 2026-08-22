# Handoff: `@onetest/dsh-deck`

Status as of 2026-08-22. Read [the design record](2026-08-21-deck-capability-and-canvas.md) for why the architecture is shaped this way, and [the package README](../../packages/dsh-deck/README.md) for how to build, install, and publish it. This document is the part neither of those carries: what is proven, what is not, and which walls have already been walked into.

## Where things stand

`@onetest/dsh-deck@0.1.0` is published to npm and installable. `onetest-ai/octodeck` is public, MIT, CI green. 177 tests pass from a bare `npm test` on a fresh clone.

The whole loop is verified live against a real harness driven by a local model through Ollama: the agent creates a deck, authors its slides as TypeScript, and the deck renders on a canvas floating over the conversation. The deck lands in the session's selected workspace under `.deck/<name>/`.

Since then the canvas has gained a theme switcher and HTML / PPTX / PDF export — see [the export design](2026-08-22-deck-export-and-theme-switcher.md). The decisive constraint there: **the renderer is the browser already showing the deck**, so no headless browser ships with the plugin. `dsh-desktop` was checked and grants nothing extra — its main window runs with no preload, so from inside, the plugin is exactly a web page. The cost is that export is client-initiated, so there is no model-callable `deck_export`.

## The shape, in one pass

`src/definition.ts` decides everything about a deck once — name validation, theme defaulting, title, directory — and hands back a `DeckSpec`. Nothing downstream re-decides any of it. It also owns `deckKey`/`decodeDeckKey`/`isDeckDirectory`, which is how a deck is addressed in a URL.

`src/octodeck/scaffold.ts` writes only deck-owned files into the workspace. The framework never gets copied out.

`src/octodeck/vite-server.ts` runs one Vite server per Host in middleware mode. It resolves and loads deck files itself rather than letting Vite serve them, because `fs.allow` lists no workspace — containment is `isDeckDirectory`, not a filesystem prefix.

`src/host/preview-route.ts` mounts that server on the harness's own HTTP server inside a single async `ctx.effect`, so cordis owns start, routes, and teardown together.

`src/tools/deck-create.ts` holds both tool bodies. Each resolves its own session's workspace per call.

`src/client/` is the browser half: a compact row per `deck_view` call, and one floating canvas on `shell.overlay`.

## What is proven, and what is not

Verified by observation, not inference:

- installs into a profile, mounts (`include:deck`, Cordis status **Mounted**), and serves
- a session-created deck renders in the harness
- HMR connects — a real `vite-hmr` WebSocket through the mounted upgrade route
- editing `slides.ts` updates the browser with no tool call
- drag and resize, clamped so the canvas cannot be lost off-screen
- the Deck creator preset mounts and changes model behaviour
- a published tarball, extracted elsewhere, serves a deck

Not proven, and worth knowing before you trust it:

- **Non-loopback deployments.** The origin/port design is built for it; nobody has run it from another machine.
- **Session replay.** The canvas derives from the logged tool result specifically so replay works, and `presentationMeta` is directly tested — but no replay has been exercised.
- **Two sessions in different workspaces, at once.** The per-call workspace resolution is unit-tested; a live two-session run has not happened.
- **`deck_capture`.** Not built. Phase 3 of the design.
- **Export under a non-loopback deployment.** The canvas measures the deck through a same-origin iframe; a shell that ever served the UI from `file://` while the deck stayed on HTTP would break it, and the extractor fails loudly with a named cause if so.

## Walls already walked into

Each of these cost real time. None is obvious from the code.

**Updates are a page reload, not a hot update.** The deck's `slides.ts` arrives through a `@vite-ignore` dynamic import, so it never enters Vite's hot-update graph and Vite reloads instead. The deck updates, but returns to slide 1. Making it a true in-place update means `runtime/entry.ts` accepting the module and re-rendering while preserving the index.

**A store handle belongs to exactly one slot scope.** The transcript row is session-scoped and the canvas is root-scoped; mounting one handle in both fails plugin load with *"one handle, one scope"*. They share a plugin-owned controller through the reserved `hooks` compartment instead.

**`conversation.details.tool` is single-occupant.** Registering the canvas there would silently replace every other tool's details view. `tool.call.toolview` keyed by tool name is additive and is the documented escape.

**Neither slot hands a component the raw tool value.** `deck_view` declares `presentationMeta` so its canonical value reaches `block.meta`. Remove that and the canvas goes blank with no error.

**Vite applies `fs.allow` to anything it serves itself.** A plugin can resolve a path and still get a 403. Loading the bytes in the plugin is what sidesteps it — and makes containment explicit rather than path-shaped.

**The harness must be launched from its own directory on a source run.** Its `tsx` import resolves from the working directory; a foreign cwd fails with a confusing `FiberState` export error that looks like a version conflict and is not. This was misdiagnosed once and written into a README before a control run disproved it.

**`npm test` needs the framework vendored.** `pretest` runs the vendor step for that reason. Without it five tests hit the loud framework-missing check.

## Deferred, with the reason

Eleven minor findings were recorded during review and deliberately not fixed. The ones a future change is most likely to meet:

- `countSlides` anchors on `indexOf('slides')` and can be desynced by an earlier lowercase "slides" in the file; an escaped bracket inside a **regex literal** also desyncs its depth scan. Exact counting via the preview server's `ssrLoadModule` is the principled replacement.
- `'slides.ts'` is hardcoded in several places with no single source of truth.
- `THEMES` in `definition.ts` hand-copies the six ids from `src/themes/index.ts`; a seventh theme silently becomes unreachable through `deck_create`.
- `DeckViewData` is declared twice — the TypeScript type and the tool's JSON schema — with only prose connecting them.
- Deck files are written with bare `node:fs`, bypassing the harness filesystem capability and its approval policy. Not an escape (the name is validated), but it will be a blocker for upstreaming.
- `tool-todo` fails to apply from a user-root preset and is left out of Deck creator rather than shipped broken. Cause not diagnosed.

Two more surfaced while verifying `0.2.0` against a live harness. Both are pre-existing, neither is a regression, and both cost real diagnosis time:

- **A deck's URL segment is its `deckKey`, not its name.** `isDeckPageRequest` accepts `{base}/{anything}/` as a page, so `{base}/<name>/` renders the host page — and then `runtime/entry.ts` builds `{base}@dsh-deck/<name>/slides.ts` from that segment, which the resolver cannot decode. The result is a **blank deck with a 404 in the console** rather than a 404 from the route. It reads exactly like a broken build; it is a wrong URL. Either reject a segment that does not `decodeDeckKey`, or have the page fail visibly with the reason.
- **`dsh plugin add` exits nonzero on a clean install.** pnpm refuses `esbuild`'s build script (`ERR_PNPM_IGNORED_BUILDS`, via `vite`), and the CLI surfaces that as `pnpm failed in profile directory`. On macOS arm64 nothing is actually broken — the prebuilt binary ships in the platform package and `esbuild.transformSync` works — but the install *looks* failed. Worth either a README note or a `pnpm.onlyBuiltDependencies` entry in the profile.

## Running it

For working on the plugin, the fastest loop is the direct preview server in the package README — no harness needed.

For the full thing, the README's install section is accurate and was followed end to end. Two manual steps remain by design: appending the bundle to `dsh.profile.bundles`, and copying `presets/deck-creator` into `$DSH_HOME/.agent-presets/`.

A local model works well for testing. Ollama needs a declared `llm-pi-ai` route in `$DSH_HOME/settings.yaml`; pi-ai wants an `apiKeyEnv` reference even for a local endpoint, and any value satisfies it.

## Two open licensing questions

Both were surfaced before the repository was opened and accepted as-is:

- **Switzer** is redistributed under Fontshare's free license, whose terms differ from the OFL. The Geist and Inter files ship their OFL text; Switzer's redistribution has not been confirmed. **Cabinet Grotesk** — `primer`'s display face, also Fontshare — is deliberately *not* bundled for that reason, so that theme's headings fall back in exports.
- **`src/themes/octo-glass/vendor/*.css`** appears to originate in a private design-system repository and is now public.
