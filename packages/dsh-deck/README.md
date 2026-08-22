# @onetest/dsh-deck

Render [Octodeck](../../README.md) presentation decks inside a DeepSeek Harness session. The model creates a deck, edits its slides as ordinary TypeScript, and the deck updates in the browser while you watch.

Two packages ship together:

| Package | Half |
|---|---|
| `@onetest/dsh-deck` | Host: the deck capability, a Vite preview server mounted on the harness's own HTTP server, and the `deck_create` / `deck_view` tools |
| `@onetest/dsh-deck-canvas` | Browser: the deck card rendered in the harness transcript |

## Status

This is a **walking skeleton**, developed against DeepSeek Harness `0.1.1-rc.2`. The deck pipeline works end to end and is verified in a real browser. Installing it into a `dsh` profile does **not** work yet — see [Known limitations](#known-limitations) for the exact blockers.

## Requirements

- Node `^22.19 || >=24`
- A checkout of this repository. The plugin resolves the Octodeck framework from `src/framework` and `src/themes` in the repository root; it is not bundled or published, so the plugin cannot currently run from an installed tarball. It fails loudly at server start when the framework source is absent, naming the path it looked for.

## Build

```bash
npm install
npm run build --workspace @onetest/dsh-deck
npm run bundle --workspace @onetest/dsh-deck-canvas
```

## Run the preview server directly

This is the supported path today, and the one verified end to end. It boots the real plugin code — the same `mountPreviewRoute` a harness would call — against an HTTP server whose upgrade dispatch matches the harness contract.

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

Open `http://127.0.0.1:4599/deck/launch/`. Edit `decks/launch/slides.ts` and the browser updates without any tool call.

## What a deck looks like

`deck_create` writes only deck-owned files into the workspace — the framework, the Vite config, and `node_modules` stay inside the plugin:

```
<workspace>/decks/<name>/
  deck.json     title and theme
  slides.ts     the deck; edit this
  deck.css      deck-local styles
```

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

## Configuration

The bundle's cordis patch sets one field, validated at load — a malformed value fails the plugin's fiber rather than passing silently:

```yaml
- id: deck
  name: '@onetest/dsh-deck'
  config:
    base: /deck        # must be a non-empty string beginning with '/'
```

## Known limitations

**Installing into a `dsh` profile does not work yet.** `dsh plugin --profile web add @onetest/dsh-deck` fails, for three independent reasons, each observed directly:

1. Neither package is published, so the registry returns 404.
2. The dependency closure includes harness packages that are not on the public registry (`@deepseek-ai/dsh-type-meta`), so even a `file:` install cannot resolve.
3. The plugin links against the published `@deepseek-ai/cordis`, while the harness runs a **vendored** copy of the same version that exports symbols the published one does not (`FiberState`). Loading the plugin into a source-run harness therefore fails with `SyntaxError: The requested module '@deepseek-ai/cordis' does not provide an export named 'FiberState'`. Resolving this needs the plugin and the harness to share one cordis identity.

**Updates are a page reload, not an in-place hot update.** A deck's `slides.ts` is reached through a dynamic `import()` the transform pipeline does not rewrite, so it never enters Vite's hot-update graph and Vite reloads the page instead. The deck updates, but returns to slide 1 each time.

**The workspace is the Host process's working directory.** Decks are created relative to wherever `dsh` was started, not per session. A Host serving sessions with different working directories would put every deck in the same place.

**Deck files are written with `node:fs` directly**, bypassing the harness's filesystem capability and its sandbox and approval policy. Every other file-writing tool in the harness goes through that seam.

**Not built yet:** headless slide capture, and PDF / PowerPoint / self-contained HTML export. The design covers them as later phases.

## Design

[docs/design/2026-08-21-deck-capability-and-canvas.md](../../docs/design/2026-08-21-deck-capability-and-canvas.md) records the architecture, the alternatives that were rejected, and per-criterion acceptance status.
