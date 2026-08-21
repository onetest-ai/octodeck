# Design: Octodeck deck capability with a live preview canvas

Status: proposed. Date: 2026-08-21.

## Problem

Octodeck (`onetest-ai/octodeck`) is a TypeScript and Vite framework for presentation decks. Its slides are plain `(ctx) => HTMLElement` components rendered on a fixed 1280x720 canvas that scales to the viewport, themed entirely through a `--octo-*` CSS variable contract, with six shipped themes and export paths to self-contained HTML, PDF, and PowerPoint. It already ships its authoring methodology as a skill.

Building a deck with it today means driving a checkout by hand and watching the result in a separate browser tab. DeepSeek Harness has no notion of a deck, so nothing in a session can create one, look at one, or hand one back to the user.

Two consequences matter. First, deck authoring gains nothing from the harness — no tools, no skill guidance, no session record of what was produced. Second, and more damaging, the model cannot see what it wrote. Generated slides fail visually far more often than they fail logically: text overflows the frame, columns collide, content clips at the 16:9 edge. Octodeck's own methodology names verifying by looking as the practice that separates a correct deck from a plausible one, and a model with no rendering surface cannot practice it.

## Proposal

Ship a `deck` capability for DeepSeek Harness as an independently installable plugin bundle, provided by a packaged Octodeck runtime, and put the rendered deck on a canvas inside the harness web GUI so the user watches the deck take shape while the model writes it.

The model creates a deck, authors slides as ordinary TypeScript files, screenshots its own output to find visual defects, and exports the result — all inside one session. The user sees every change land on the canvas without asking for it, because the deck is served through a Vite dev server whose hot module replacement repaints the canvas on each save.

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
| `@onetest/dsh-deck` | The installable bundle: `cordis.patch.yml`, the `deck` Service Definition, the Octodeck Service Provider with its bundled framework assets and Vite server, the `deck_create` / `deck_view` / `deck_export` tool Consumers, the host preview route, and the bundled authoring skill. |
| `@onetest/dsh-deck-canvas` | The browser half: the deck tool card and the canvas panel. Separate because a dynamic client package needs its own `dsh.client` manifest and `./client` export. |
| `@onetest/dsh-deck-capture` | Optional headless slide capture. Separate so the base installation carries no browser download. |

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

The canvas adds no shell layout. It uses two registration points the client stack already provides: a keyed tool view filling `tool.call.toolview`, where the conversation card shows deck name, theme, slide count, and a thumbnail of the current slide; and a registration into `conversation.details.tool`, where the right-hand details column carries the full canvas — an iframe on the deck's preview route, previous and next controls, a slide counter, a theme switcher, and a filmstrip.

Because Octodeck already scales its fixed frame to the viewport, the panel only has to give the iframe a 16:9 box. Dragging the details boundary rescales the deck with no further code.

No new session event is introduced. The `deck_view` canonical value carries the deck id, the preview route, the slide count, and the theme, and it is persisted as a tool result, so the canvas derives everything it renders from the session snapshot and replays correctly. The current slide index and the panel's view state are transient viewing state in a store declared at registration — how-to-draw facts, which the harness keeps out of the session log. The model-visible rule is satisfied because every model-visible input here is a tool call or a tool result, both already logged.

## The authoring loop

`deck_create` scaffolds a deck and returns its paths and preview route. The model then edits `slides.ts` with the harness's ordinary file tools, and hot module replacement pushes each save to the canvas.

Slides stay plain TypeScript rather than moving behind typed slide tools. This keeps Octodeck's full expressive range, including interactive slides and custom components, adds no schema to every request, and reuses file-editing behavior the model is already good at.

`deck_capture` renders slides headlessly off the running server and returns images to the model, so the model finds its own overflow and clipping. The bundled skill supplies the layout, design, and QA guidance so the model composes from the shipped templates and layout components instead of inventing slide structure. `deck_export` wraps Octodeck's three export paths: self-contained HTML needs no browser, while PDF and PowerPoint both render the live DOM through one, and PowerPoint additionally requires the theme-token snapshot and backdrop-bake steps to be ported.

## Phasing

0. **Spike: the third-party client build.** Prove a dynamic client package built outside the harness repository produces a `lib/client.js` the module table accepts, externalizing the shell-seeded baseline. This single fact decides whether the canvas can ship out-of-tree, so it precedes all feature work.
1. **Walking skeleton**: the Service Definition, the provider with its bundled runtime and Vite middleware server, `deck_create` and `deck_view`, the host preview route, and — if the spike passed — the canvas in the details column. The end state is that a request for a deck produces a deck the user watches appear.
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

**A dedicated full-width canvas surface** replacing the conversation column. Rejected for the walking skeleton: it requires new shell layout work in the harness's own layout package, where the existing details column already provides a drag-resizable panel that rescales the deck for free.

## Acceptance criteria

- `dsh plugin --profile web add @onetest/dsh-deck` installs the bundle, and the deck tools appear in a session with no further configuration.
- A session can create a deck, and the deck's files appear under `decks/<name>/` in the session workspace with no dependency install.
- The web GUI renders that deck in the details column, and an edit to `slides.ts` repaints the canvas without a tool call or a user gesture.
- The preview works when the browser reaches the Host over a non-loopback authority, not only on the same machine.
- Disposing the deck plugin stops the Vite server and removes both its HTTP route and its upgrade route.
- Replaying a session reconstructs the canvas from the logged tool result, with no new session event type.
- The model receives rendered slide images from `deck_capture` and can act on them within the same turn.
- A deck exports to a self-contained HTML file that opens offline with no external references.

## Risks

**The third-party client build is the decisive unknown.** In the harness tree, a dynamic client package builds through a shared tsdown preset that externalizes the shell-seeded baseline — React, Cordis, `ui-primitives`, `ui-slots`. That preset is not published to npm, so this repository must reproduce its externalization contract. If it cannot, the canvas cannot ship out-of-tree and the plugin falls back to host-only tools with an external browser tab for preview, leaving the canvas to the official track. Phase 0 exists to answer this before anything is built on the assumption.

**The hot-module-replacement upgrade shim is unverified.** Forwarding the harness's upgrade route into Vite's hot server is expected to work but is unproven against the shipped Vite version. It is contained: a timeboxed spike, and the child-process alternative above as the fallback.

**Headless capture inherits an existing dependency but not an existing budget.** This repository already carries Playwright and skips its browser download in CI, so capture and the PDF and PowerPoint exports have a working pattern to reuse. What is new is that a harness user installing the plugin acquires that weight. Keeping capture in its own package holds the base installation light and makes a missing browser fail loudly at load rather than in the middle of a deck.

**The Octodeck runtime must ship as raw source, not built output**, because Vite compiles it at preview time. Within this repository the provider consumes the framework source directly, which removes the duplication problem but not the packaging one: the published package's files must still cover the asset tree and exclude it from bundling.

**Out-of-tree means no harness gates.** The repository-side verifiers that keep in-tree plugins honest — client package rules, cordis config validation, package invariants — do not run here. This repository owns equivalent checks itself, or it drifts from the contracts it depends on and discovers the drift at a user's install.

**Harness compatibility is unpinned.** The plugin depends on slot names, service shapes, and the bundle contract of a project in active pre-release development, which states it will rename and repackage freely. Declare a supported harness range and expect to track it.
