# Design: Octodeck deck capability with a live preview canvas

Status: proposed. Date: 2026-08-21.

## Problem

Octodeck (`onetest-ai/octodeck`) is a TypeScript and Vite framework for presentation decks. Its slides are plain `(ctx) => HTMLElement` components rendered on a fixed 1280x720 canvas that scales to the viewport, themed entirely through a `--octo-*` CSS variable contract, with six shipped themes and export paths to self-contained HTML, PDF, and PowerPoint. It already ships its authoring methodology as a skill.

Building a deck with it today means driving a checkout by hand and watching the result in a separate browser tab. DeepSeek Harness has no notion of a deck, so nothing in a session can create one, look at one, or hand one back to the user.

Two consequences matter. First, deck authoring gains nothing from the harness — no tools, no skill guidance, no session record of what was produced. Second, and more damaging, the model cannot see what it wrote. Generated slides fail visually far more often than they fail logically: text overflows the frame, columns collide, content clips at the 16:9 edge. Octodeck's own methodology names verifying by looking as the practice that separates a correct deck from a plausible one, and a model with no rendering surface cannot practice it.

## Proposal

Ship a `deck` capability for DeepSeek Harness as an independently installable plugin bundle, provided by a packaged Octodeck runtime, and put the rendered deck on a canvas inside the harness web GUI so the user watches the deck take shape while the model writes it.

The model creates a deck, authors slides as ordinary TypeScript files, screenshots its own output to find visual defects, and exports the result — all inside one session. The user sees every change land on the canvas without asking for it, because the deck is served through a Vite dev server that pushes each save to the browser.

Octodeck is not vendored or replaced. Its framework source ships as a runtime asset of this bundle; upstream stays where it is.

## Why it ships from the Octodeck repository

DeepSeek Harness accepts out-of-tree plugins as a first-class path. A bundle is any npm package whose manifest declares `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`, and out-of-tree bundles install into a profile with `dsh plugin --profile <name> add <package>`. The browser roster works the same way: `dsh.client` rows in a cordis patch are scanned by the modules node half into the boot payload, so a third-party patch contributes UI plugins exactly as the in-box web bundle does.

Building outside the harness tree means the plugin ships and is distributable immediately, on its own release cadence, without depending on an upstream contribution window. Proposing it for official adoption is a parallel, later track, and this document is the artifact that track starts from. The design deliberately follows harness conventions — capability seam roles, explicit `resolve(request)` defaulting, registrations as effects, model-visible input implying a logged event — so that upstreaming is a move, not a rewrite.

The plugin lives in this repository rather than a repository of its own because it is a second consumer of the framework in this tree, not a separate product. Two consequences pay for the choice. The provider consumes the framework source as a workspace sibling, so there is no second copy to keep in step and no version skew between the bundled runtime and the framework it renders. And the browser-dependent work — headless capture and the PDF and PowerPoint exports — reuses this repository's existing Playwright dependency and its established system-browser-with-bundled-fallback pattern, instead of introducing that dependency somewhere it does not already exist.

## Distribution

The npm scope `@onetest` is already owned by this account (`@onetest/tms` is published under it), so the package names below are available without new account setup. Publishing requires an authenticated npm session, which the development machine does not currently hold.

The packages are named for the harness rather than the engine: `dsh-deck` states what the package is at the point where a reader meets it, in an install command, and leaves the `octodeck` name to the framework. They publish from this repository as workspace packages; the framework's own root project keeps its current identity and release path.

## Package topology

| Package | Contents |
|---|---|
| `@onetest/dsh-deck` | The whole plugin, both halves in one package. Node half:  `cordis.patch.yml`, the `deck` Service Definition, the Octodeck Service Provider with its bundled framework assets and Vite server, the `deck_create` / `deck_view` / `deck_export` tool Consumers, the host preview route, and the bundled authoring skill. |
| `@onetest/dsh-deck-capture` | Optional headless slide capture. Separate so the base installation carries no browser download. |

The repository becomes an npm workspace: the root package.json gains a `packages/*` workspace list, and the three packages above live under `packages/`. The framework keeps the repository root, its current identity, its scripts, and its release path, so `npm run dev`, `npm run build`, and `npm run new:deck` behave exactly as they do today; the plugin packages reach the framework as a workspace sibling. The bundled-skill template generator and its CI staleness guard predate the workspace, so the walking skeleton verifies that they ignore `packages/` rather than sweeping it into the generated template.

The browser half lives in this same package rather than a second one. A dynamic client package does need its own `dsh.client` declaration and `./client` export, but that is a manifest fact, not a packaging one — 43 harness packages carry a node half and a browser half together. The harness's client scanner reads `dsh.client` independently and never consults `dsh.bundle`, so one Loader row contributes both halves. Splitting them would mean a second package to publish, version in lockstep, and depend on by exact version — the earlier split's unpublished sibling dependency was itself the reason a profile install returned 404.

The capability seam's three roles — Service Definition, Service Provider, Consumer — live as distinct modules and cordis entries inside `@onetest/dsh-deck` rather than as three npm packages. The harness glossary splits a seam across packages only when its roles evolve independently, which these do not yet do. Splitting later is a move of files, not a redesign.

`@deepseek-ai/cordis` is a peer dependency of every plugin package here, matching the harness convention.

## Deck layout

A deck occupies `decks/<name>/` inside the session workspace and holds only its own material: `slides.ts`, `deck.css`, `assets/`, and a `deck.json` recording title and theme.

The framework, the Vite configuration, and `node_modules` never enter the user's workspace. Vite's root is the packaged runtime, with the workspace deck directory supplied through an alias. This removes the dependency install a scaffolded standalone project would need, makes the first preview immediate, and lets a framework fix ship with the plugin instead of stranding every previously scaffolded copy.

The deck directory is correspondingly not runnable on its own outside the harness. Exporting a self-contained HTML file is the portability answer, and it is in scope.

## Serving the deck

The provider creates one Vite server per Host in middleware mode, lazily on the first preview, and disposes it with its plugin fiber. The resulting connect middleware registers as a `prefix` route on `ctx.webServer`, so the deck is served from the harness's own origin and port. Hot module replacement rides `ctx.webServer.registerUpgrade`: Vite expects an object it can attach an `upgrade` listener to, and the provider supplies an event emitter, forwarding the upgrade route's request, socket, and head into it.

Serving from the harness's own origin is what makes a remote Web deployment work. There is no second port for the browser to reach, no reverse proxy to own, and no cross-origin frame. Server lifetime also collapses into the existing plugin lifetime rather than becoming a second thing to supervise.

One shared server means a broken slide module in one session can surface a Vite error overlay in another session's canvas. This is accepted for a development-facing surface. Per-session isolation would cost a Node process, a port, and a warm-up per active deck session, plus a reaper for abandoned ones.

## The canvas and state ownership

The canvas adds no shell layout. It registers once, as the keyed `tool.call.toolview` renderer for `deck_view` calls (key `'deck_view'`): the full canvas — an iframe on the deck's preview route, previous/next controls, and a slide counter — renders inline in the transcript row for that tool call.

The brief's original assumption was a second registration into `conversation.details.tool`, with the keyed toolview reduced to a small card (deck name, theme, slide count, a thumbnail). Implementation research found that slot is `kind: 'single'`: one occupant renders the output of *every* tool call the user selects, and its shipped occupant hard-dispatches a fixed chain of card models from `owner.block`. Taking that seat for the canvas would silently drop every other tool's details output — exactly the trap the slot's own doc comment warns against, and which the doc comment names `tool.call.toolview` as the intended escape for. `tool.call.toolview` is `kind: 'keyed'`, dispatched by wire tool name, so registering under `'deck_view'` there is additive: it replaces only the generic row for `deck_view` calls and leaves every other tool's rendering untouched. The full canvas lives there instead of a details-column panel; no filmstrip or in-canvas theme switcher shipped in the walking skeleton. See `packages/dsh-deck/src/client/DeckToolview.tsx`'s own doc comment for the complete resolved-props trace.

Because Octodeck already scales its fixed frame to the viewport, the transcript row only has to give the iframe a 16:9 box.

No new session event is introduced. The `deck_view` canonical value carries the deck id, the preview route, the slide count, and the theme, and it is persisted as a tool result, so the canvas derives everything it renders from the session snapshot and replays correctly. The current slide index and the panel's view state are transient viewing state in a store declared at registration — how-to-draw facts, which the harness keeps out of the session log. The model-visible rule is satisfied because every model-visible input here is a tool call or a tool result, both already logged.

## The authoring loop

`deck_create` scaffolds a deck and returns its paths and preview route. The model then edits `slides.ts` with the harness's ordinary file tools, and the Vite dev server pushes each save to the canvas.

The push is a **full page reload, not an in-place hot module update**. A deck's `slides.ts` is reached through a dynamic `import()` the transform pipeline deliberately does not rewrite, so it never enters Vite's hot-update graph with an accept handler, and Vite's only remaining option is to reload the page. Verified in a real browser: editing `slides.ts` with the deck open logs `[vite] (client) page reload` and the new slides appear without any tool call or user gesture.

The user-visible consequence is that a reload returns the deck to slide 1. Someone reviewing slide 7 when the model edits a slide is bounced to the start. Preserving position would require `runtime/entry.ts` to register `import.meta.hot.accept` for the slides module and re-render in place, restoring the current index; that is deferred, and the HMR socket the reload depends on is itself verified working.

Slides stay plain TypeScript rather than moving behind typed slide tools. This keeps Octodeck's full expressive range, including interactive slides and custom components, adds no schema to every request, and reuses file-editing behavior the model is already good at.

`deck_capture` renders slides headlessly off the running server and returns images to the model, so the model finds its own overflow and clipping. The bundled skill supplies the layout, design, and QA guidance so the model composes from the shipped templates and layout components instead of inventing slide structure. `deck_export` wraps Octodeck's three export paths: self-contained HTML needs no browser, while PDF and PowerPoint both render the live DOM through one, and PowerPoint additionally requires the theme-token snapshot and backdrop-bake steps to be ported.

## Phasing

0. **Spike: the third-party client build.** Prove a dynamic client package built outside the harness repository produces a `lib/client.js` the module table accepts, externalizing the shell-seeded baseline. This single fact decides whether the canvas can ship out-of-tree, so it precedes all feature work.
1. **Walking skeleton**: the Service Definition, the provider with its bundled runtime and Vite middleware server, `deck_create` and `deck_view`, the host preview route, and — if the spike passed — the canvas as a keyed `tool.call.toolview` renderer (see "The canvas and state ownership" above for why that slot, not the details column, is what shipped). The end state is that a request for a deck produces a deck the user watches appear.
2. **Skill bundling.** Small, and the largest single jump in output quality.
3. **Capture**, gated on the browser dependency decision below.
4. **Exports**, in the order self-contained HTML, then PDF, then PowerPoint.

## Alternatives considered

**Building in the DeepSeek Harness tree.** Not chosen: the repository has no open pull request path, so the work could not ship on its own schedule. The out-of-tree bundle contract exists precisely for this, and the design stays upstreamable.

**A standalone plugin repository.** Considered and set aside once the framework repository was the alternative. A separate repository would need its own copy of the framework assets or a published dependency on them, its own Playwright setup, and its own CI, and every framework change would arrive as a version bump to chase. Living beside the framework removes all four. The cost is that this repository now serves two audiences, deck authors and harness users, which the workspace split keeps legible.

**Vendoring Octodeck into the plugin.** Rejected: it duplicates an actively developed framework, and the plugin gains nothing a packaged runtime asset does not already give it.

**Scaffolding a full standalone Octodeck project per deck**, the way the existing skill does. Rejected for the walking skeleton: it costs a dependency install per deck, pins a template copy later framework fixes cannot reach, and delays the first preview. Its one real advantage, a portable and hackable deck directory, is served by the self-contained HTML export.

**Pointing at an existing Octodeck checkout through config.** Rejected: the plugin would be inert without that checkout, and a capability whose provider silently depends on an unmanaged local path fails the harness rule against skipping a missing referent.

**Spawning Vite as a child process and reverse-proxying it.** Not chosen, but retained as the fallback if the upgrade forwarding cannot be made to work. It is known to work and isolates a Vite crash to a child process, at the cost of a process to reap, a proxy to own, and a second copy of port and readiness state.

**Building a single-file HTML on every preview instead of running a dev server.** Rejected: it is trivially isolated and needs no long-lived process, but every edit costs a full rebuild, which turns the write-and-see loop from milliseconds into seconds and removes the property that makes the canvas worth building.

**Structured slide tools** taking a typed template and slot specification. Rejected: they cap what a slide can be, lose interactive slides, and duplicate the component library as JSON schema in every request.

**A dedicated full-width canvas surface** replacing the conversation column. Rejected for the walking skeleton: it requires new shell layout work in the harness's own layout package. (Written against the original details-column assumption; the walking skeleton shipped the canvas as a keyed `tool.call.toolview` row instead, still with no new shell layout, per "The canvas and state ownership" above.)

## Acceptance criteria

- `dsh plugin --profile web add @onetest/dsh-deck` installs the bundle, and the deck tools appear in a session with no further configuration.
- A session can create a deck, and the deck's files appear under `decks/<name>/` in the session workspace with no dependency install.
- The web GUI renders that deck as a keyed `tool.call.toolview` row (not the details column — see "The canvas and state ownership" above), and an edit to `slides.ts` updates the canvas without a tool call or a user gesture (by page reload, not an in-place hot update — see "The authoring loop").
- The preview works when the browser reaches the Host over a non-loopback authority, not only on the same machine.
- Disposing the deck plugin stops the Vite server and removes both its HTTP route and its upgrade route.
- Replaying a session reconstructs the canvas from the logged tool result, with no new session event type.
- The model receives rendered slide images from `deck_capture` and can act on them within the same turn.
- A deck exports to a self-contained HTML file that opens offline with no external references.

### Status after the final whole-branch review's fix wave (2026-08-21/22)

- **Installs with no further configuration** — partially met. The bundle-patch/package.json dependency mismatch is fixed (Finding 3a), but the plugin still only runs from within an Octodeck checkout: `octodeck/framework` resolves to a fixed path into this repository's `src/framework`, which an installed tarball never has. That now fails loudly at server start, naming the resolved path, instead of silently resolving wrong (Finding 3b) — publishing or bundling the framework itself remains out of scope.
- **Deck creation in the workspace** — met, unaffected by this wave.
- **Canvas renders and updates without a tool call or gesture** — met only after this wave, and by page reload rather than in-place hot update (see "The authoring loop"). Before it, HMR never connected at all (Finding 1: the upgrade route was registered at the base path, not at the path Vite's client actually requests) and the canvas's iframe hash never matched the framework's own router format (Finding 2), so even a connected HMR socket would have updated a deck stuck on slide 1. Both are fixed and covered by tests, including a real `vite-hmr` WebSocket opened through the mounted route.
- **Works over a non-loopback authority** — not independently re-verified live in this wave. Finding 4's fix (narrowing `fs.allow` to `decks/`) removes an unrelated live-verified hole this criterion would otherwise fail on: the entire session workspace was previously readable over `/deck/@fs/...` from any reachable browser.
- **Disposing stops the server and removes both routes** — met, and safer: `close()` rejecting no longer crashes the whole harness process (Finding 5), and the route-removal/server-stop behavior is exercised by "sequences disposal after an in-flight start" rather than the deleted title-only test (Finding 6).
- **Replays from the logged tool result** — met, unaffected by this wave.
- **`deck_capture` renders images to the model** — not met. Not yet built; scoped to a later phase than the walking skeleton this branch covers.
- **Self-contained HTML export** — not met. Not yet built; same as above.

## Risks

**The third-party client build is the decisive unknown.** In the harness tree, a dynamic client package builds through a shared tsdown preset that externalizes the shell-seeded baseline — React, Cordis, `ui-primitives`, `ui-slots`. That preset is not published to npm, so this repository must reproduce its externalization contract. If it cannot, the canvas cannot ship out-of-tree and the plugin falls back to host-only tools with an external browser tab for preview, leaving the canvas to the official track. Phase 0 exists to answer this before anything is built on the assumption.

**The hot-module-replacement upgrade shim is now verified.** The final whole-branch review found it registered the upgrade route at the mounted base itself, while Vite's injected HMR client always requests `path.posix.join(base, hmr.path)` — the base plus a trailing slash plus the `hmr.path` segment — so the socket the browser actually opened never matched, and HMR never connected in practice. Fixed by deriving both the `server.hmr.path` config and the registered route from one shared expression (`hmrUpgradePath` in `src/octodeck/vite-server.ts`), and proven by a test that opens a real `vite-hmr` WebSocket through the mounted route rather than asserting registration shape.

**The Octodeck runtime must ship as raw source, not built output**, because Vite compiles it at preview time. Within this repository the provider consumes the framework source directly, which removes the duplication problem but not the packaging one: the published package's files must still cover the asset tree and exclude it from bundling. This remains unresolved: `startPreviewServer` now checks the resolved framework path at server start and fails loudly, naming the path and stating that this build only runs from within the octodeck repository, rather than silently resolving to a nonexistent path from an installed tarball — but publishing or bundling the framework itself is still open work.

**Headless capture inherits an existing dependency but not an existing budget.** This repository already carries Playwright and skips its browser download in CI, so capture and the PDF and PowerPoint exports have a working pattern to reuse. What is new is that a harness user installing the plugin acquires that weight. Keeping capture in its own package holds the base installation light and makes a missing browser fail loudly at load rather than in the middle of a deck.

**Out-of-tree means no harness gates.** The repository-side verifiers that keep in-tree plugins honest — client package rules, cordis config validation, package invariants — do not run here. This repository owns equivalent checks itself, or it drifts from the contracts it depends on and discovers the drift at a user's install. The final whole-branch review found this was not yet true in practice: `.github/workflows/ci.yml` typechecked and built only the framework, and the canvas artifact test read a gitignored build artifact with no `pretest` producing it, so a clean checkout's test run failed outright. CI now typechecks and builds the plugin and runs its test suite (`npm test --workspaces --if-present`), and the package's `pretest` runs `tsdown` before its tests.

**The dev server previously granted `fs.allow` over the whole session workspace, not just `decks/`.** Confirmed live by the final whole-branch review: any file in the session workspace was readable over `/deck/@fs/...`, a remote read of the user's project once the design's own non-loopback deployment target is reached. `fs.allow` is now `[RUNTIME_ROOT, <workspace>/decks]`.

**Harness compatibility is unpinned.** The plugin depends on slot names, service shapes, and the bundle contract of a project in active pre-release development, which states it will rename and repackage freely. Declare a supported harness range and expect to track it.

**`runtime/entry.ts`'s browser-facing paths do not honor the mounted base, confirmed live.** Task 8's live verification (a real browser hitting a running harness `web` profile, config `base: '/deck'`, a deck scaffolded on disk) shows `packages/dsh-deck/runtime/entry.ts`'s `import(/* @vite-ignore */ '/@dsh-deck/${name}/slides.ts')` and `fetch('/@dsh-deck/${name}/deck.json')` both 404: they resolve as literal browser requests to `http://<host>/@dsh-deck/<name>/...` off the page origin root, never through `http://<host>/deck/@dsh-deck/<name>/...`. Vite's dev server `base` (`${options.base}/`, set in `src/octodeck/vite-server.ts`) and its `resolve.alias` for `/^\/@dsh-deck\//` both apply only to specifiers Vite's own transform/resolution pipeline sees; `@vite-ignore` deliberately opts the dynamic `import()` out of that pipeline, and a plain `fetch()` was never in it. Every other asset on the page (the Vite client, `entry.ts` itself, the framework/theme modules) loaded correctly under the `/deck/` prefix — only these two runtime-constructed absolute paths miss it. This was previously verified only through `ssrLoadModule` and static transform (neither issues a real browser-origin request), so the gap went undetected until this task's live check. Fix belongs in `packages/dsh-deck/runtime/entry.ts` — likely prefixing both paths with `import.meta.env.BASE_URL` — and is out of Task 8's file scope (canvas registration only); tracked here for the phase that owns that file.
