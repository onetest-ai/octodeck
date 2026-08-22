# @onetest/dsh-deck

Render [Octodeck](../../README.md) presentation decks inside a DeepSeek Harness session. The model creates a deck, edits its slides as ordinary TypeScript, and the deck updates in the browser while you watch.

One package carries both halves. Its node half mounts the deck capability, a Vite preview server on the harness's own HTTP server, the `deck_create` / `deck_view` tools, and the export route; its `dsh.client` half ships the browser bundle that renders the deck card in the transcript and the floating canvas, with its theme switcher and export buttons. The harness's client scanner reads `dsh.client` independently of `dsh.bundle`, so a single Loader row contributes both — there is no second package to publish or keep in version lockstep.

## Status

Developed against DeepSeek Harness `0.1.1-rc.2`, and verified end to end in a real harness: installed into a profile, mounted by the loader, driven by a local model through Ollama, and rendering its deck on the canvas.

## Requirements

- Node `^22.19 || >=24`
- A checkout of this repository. The plugin resolves the Octodeck framework from `src/framework` and `src/themes` in the repository root; it is not bundled or published, so the plugin cannot currently run from an installed tarball. It fails loudly at server start when the framework source is absent, naming the path it looked for.

## Build

```bash
npm install
npm run build  --workspace @onetest/dsh-deck   # node half -> lib/, and vendors the framework
npm run bundle --workspace @onetest/dsh-deck   # browser half -> lib/client.js
npm run typecheck --workspace @onetest/dsh-deck
npm test --workspace @onetest/dsh-deck
```

`build` runs `scripts/vendor-framework.mjs` first, copying `src/framework` and `src/themes` from the repository root into `vendor/src/`. The preview server compiles those at request time, so they must be present — a package built without that step fails loudly at server start rather than serving a broken deck.

## Install into a harness

```bash
npm run build  --workspace @onetest/dsh-deck   # node half + vendored framework
npm run bundle --workspace @onetest/dsh-deck   # browser half

dsh plugin --profile web add file:/path/to/octodeck/packages/dsh-deck
# append "@onetest/dsh-deck" to dsh.profile.bundles in $DSH_HOME/profiles/web/package.json
cp -r packages/dsh-deck/presets/deck-creator "$DSH_HOME/.agent-presets/"
dsh --profile web
```

Pick **Deck creator** in the agent-preset selector, then ask for a deck. The deck lands in the session's selected workspace under `.deck/<name>/`, and a compact row in the transcript opens it on the canvas.

## Run the preview server directly

Useful for working on the plugin itself without a harness. It boots the real plugin code — the same `mountPreviewRoute` a harness would call — against an HTTP server whose upgrade dispatch matches the harness contract.

```js
import { createServer } from 'node:http'
import { URL } from 'node:url'
import { resolveDeck } from '@onetest/dsh-deck/lib/definition.js'
import { scaffoldDeck } from '@onetest/dsh-deck/lib/octodeck/scaffold.js'
import { mountPreviewRoute } from '@onetest/dsh-deck/lib/host/preview-route.js'

const workspace = process.cwd()
await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))

const routes = []
const upgrades = new Map()
const ctx = {
  logger: console,
  effect(fn) {
    const result = fn()
    if (result instanceof Promise) result.then(dispose => routes.push(dispose))
    else routes.push(result)
  },
  webServer: {
    register(route) { routes.push(route); return () => {} },
    registerUpgrade(route) { upgrades.set(route.path, route.handler); return () => {} },
  },
}
mountPreviewRoute(ctx, { workspace, base: '/deck' })
await new Promise(resolve => setTimeout(resolve, 1500))

const page = routes.find(route => route && route.kind === 'prefix')
const server = createServer((req, res) => page.handler(req, res))
// The harness dispatches upgrades by exact pathname; mirror that or HMR will not connect.
server.on('upgrade', (req, socket, head) => {
  const handler = upgrades.get(new URL(req.url, 'http://x').pathname)
  if (handler) handler(req, socket, head)
  else socket.destroy()
})
server.listen(4599)
```

`deck_create`'s returned `route` is the URL to open. Edit the deck's `slides.ts` and the browser updates without any tool call.

## What a deck looks like

`deck_create` writes only deck-owned files into the workspace — the framework, the Vite config, and `node_modules` stay inside the plugin:

```
<selected workspace>/.deck/<name>/
  deck.json     title and theme
  slides.ts     the deck; edit this
  deck.css      deck-local styles
```

The workspace is the one the session selected, read from its session header per call — so one Host serves sessions rooted in different directories.

Slides are plain TypeScript, so the full framework is available:

```ts
import { TitleSlide, HeaderSlide, Bullets } from 'octodeck/framework'
import type { Slide } from 'octodeck/framework'

export const slides: Slide[] = [
  () => TitleSlide({ title: 'Q3 Review', subtitle: 'Revenue and roadmap' }),
  () => HeaderSlide({ title: 'Highlights' }, Bullets(['Up 40%', 'Two launches'])),
]
```

## Tools the model sees

| Tool | Arguments | Returns |
|---|---|---|
| `deck_create` | `name` (required, lowercase letters, digits, dashes), `theme`, `title` | `deckId`, `directory`, `slidesPath`, `route`, `theme` |
| `deck_view` | `name` (required) | `deckId`, `route`, `slideCount`, `theme` |

Themes: `midnight` (default), `protocol`, `primer`, `radiant`, `commit`, `octo-glass`.

## Exporting a deck

The canvas header carries a theme switcher and an **Export** menu offering three formats. All three are produced without launching a browser: the deck is already rendering in one, so the canvas measures it in a hidden 1280×720 same-origin iframe and posts the measurements to the node half, which assembles the file.

| Format | Produced by | Needs the canvas open |
|---|---|---|
| HTML | a Vite single-file build, server-side | no |
| PPTX | measured slides → OOXML | yes |
| PDF | measured slides → vector PDF | yes |

Each artifact is both written to `<deck>/export/<name>-<theme>.<ext>` and downloaded, so the model can reference the file on disk and you get it without a file hunt.

**Export follows the theme the canvas is showing**, not the one in `deck.json`. Switching themes in the header is preview-only — it never rewrites what the model authored — so you can compare all six and export whichever you prefer.

### Which format renders faithfully where

| | macOS | Windows |
|---|---|---|
| PDF | fonts embedded, exact | fonts embedded, exact |
| HTML | fonts inlined, exact | fonts inlined, exact |
| PPTX | **fonts substituted** | fonts embedded, exact |

PowerPoint for Mac ignores embedded fonts entirely — a platform limitation, not an export defect. The file does carry them, and Windows PowerPoint uses them. **Prefer PDF when the deck must look right on any machine.**

The routes, if you want to drive them yourself, are `GET {base}/@export/{key}/html?theme=&mode=` and `POST {base}/@export/{key}/{pptx|pdf}` with a `{ raw, theme, mode }` body. `@export` rather than `export` because `export` is a legal deck name and would otherwise shadow a real deck.

## Configuration

The bundle's cordis patch sets one field, validated at load — a malformed value fails the plugin's fiber rather than passing silently:

```yaml
- id: deck
  name: '@onetest/dsh-deck'
  config:
    base: /deck        # must be a non-empty string beginning with '/'
```

## Known limitations

**Registering the bundle is a manual step.** `dsh plugin --profile web add` installs the package but does not add it to the profile's bundle list; append `"@onetest/dsh-deck"` to `dsh.profile.bundles` in `$DSH_HOME/profiles/web/package.json` yourself.

**The preset is copied, not registered.** `presets/deck-creator/` ships in the package; copy it to `$DSH_HOME/.agent-presets/` to make it appear in the preset picker. A plugin cannot add a preset root without restating the `agent-presets` row's whole config, which would fight the deployment's own shipped root.

**`tool-todo` is absent from the preset.** Mounting it from a user-root preset failed to apply, and it is not load-bearing for authoring a deck, so it was left out rather than shipped broken.

**Updates are a page reload, not an in-place hot update.** A deck's `slides.ts` is reached through a dynamic `import()` the transform pipeline does not rewrite, so it never enters Vite's hot-update graph and Vite reloads the page instead. The deck updates, but returns to slide 1 each time.

**A `dsh plugin add` install must be run from a directory whose parent chain reaches this repository**, for the same framework-path reason.

**Deck files are written with `node:fs` directly**, bypassing the harness's filesystem capability and its sandbox and approval policy. Every other file-writing tool in the harness goes through that seam.

**Export is client-initiated; there is no `deck_export` tool.** PPTX and PDF need the deck measured in a browser, and the server has no renderer of its own — that is the direct cost of exporting without shipping a headless browser. The model can read an exported file, but cannot produce one unattended.

**PPTX fonts substitute on macOS.** Embedded fonts in a `.pptx` are a Windows PowerPoint feature; see the table above.

**Cabinet Grotesk is not bundled**, so `primer`'s display face falls back in exports. It is Fontshare-licensed and not redistributable here. Geist, Geist Mono, Inter, and Switzer are bundled and cover the other five themes.

**PDF connector arrowheads are not drawn.** Diagram nodes, connectors, and labels all export; the small arrow markers on connector ends do not.

**Not built yet:** headless slide capture. The design covers it as a later phase.

## Publishing

```bash
npm run build  --workspace @onetest/dsh-deck
npm run bundle --workspace @onetest/dsh-deck
npm test       --workspace @onetest/dsh-deck

cd packages/dsh-deck
npm pack --dry-run          # inspect the payload before it leaves
npm publish                 # publishConfig.access is already "public"
```

Check the dry run lists all four of these, because each is something a consumer cannot work without and none is produced by `tsc`:

| Path | Why it must ship |
|---|---|
| `vendor/src/framework/**`, `vendor/src/themes/**` | The framework sources the preview server compiles. Absent, every deck fails to render. |
| `runtime/**` | The deck host page and its entry module. |
| `cordis.patch.yml` | The bundle patch; without it the package is not installable as a bundle. |
| `presets/**` | The Deck creator agent preset. |

`prepack` re-runs the vendor step, so a publish from a clean checkout still carries the framework.

Publishing needs an authenticated npm session with rights to the `@onetest` scope (`npm whoami` should answer). Bump `version` first — npm refuses to overwrite a published version.

## Design

[docs/design/2026-08-21-deck-capability-and-canvas.md](../../docs/design/2026-08-21-deck-capability-and-canvas.md) records the architecture, the alternatives that were rejected, and per-criterion acceptance status.

[docs/design/2026-08-22-dsh-deck-handoff.md](../../docs/design/2026-08-22-dsh-deck-handoff.md) is the working handoff: what is proven versus assumed, the non-obvious constraints already discovered, and what was deliberately deferred. Read it before changing this package.
