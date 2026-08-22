# dsh-deck Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A DeepSeek Harness session can create an Octodeck deck and the user watches it render live on a canvas in the harness web GUI.

**Architecture:** Three npm workspace packages inside the Octodeck repository. `@onetest/dsh-deck` is an installable dsh bundle carrying the `deck` capability seam (Service Definition, Octodeck Service Provider, tool Consumers) plus a host route that mounts a middleware-mode Vite server onto the harness's own web server. `@onetest/dsh-deck-canvas` is the browser half, registering a tool card and a details-column canvas through the harness slot system. `@onetest/dsh-deck-capture` is out of scope for this plan.

**Tech Stack:** TypeScript (ESM), Vite 6 (middleware mode), tsdown (client bundle), Cordis (`@deepseek-ai/cordis`, peer), vitest, npm workspaces, Node ^22.19 || >=24.

**Spec:** `docs/design/2026-08-21-deck-capability-and-canvas.md`

## Global Constraints

- Node engines: `^22.19 || >=24`. The repository CI already pins Node 22.
- ESM everywhere: every package sets `"type": "module"`.
- `@deepseek-ai/cordis` is a **peerDependency and devDependency** of every plugin package, never a regular dependency.
- Package names: `@onetest/dsh-deck`, `@onetest/dsh-deck-canvas`. The npm scope `@onetest` is owned; `octodeck` names stay with the framework.
- The framework at the repository root keeps its identity: `npm run dev`, `npm run build`, `npm run new:deck`, `npm run skill:assets` must behave exactly as before this plan.
- Registrations are effects: every contribution goes through `ctx.effect()` / a registry `register()` that returns a disposer. Disposing the plugin must remove it.
- No hardcoded deployment tunables in plugin bodies — ports, roots, and limits are validated `Config` fields.
- The client bundle artifact contract (Task 1 proves it) is: `format: 'cjs'`, `platform: 'browser'`, output file exactly `lib/client.js`, banner `window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {`, footer `return module.exports; } });`, intro `var module = { exports: {} }; var exports = module.exports;`.
- Baseline module-table externals that a client bundle must NOT inline: `react`, `react/jsx-runtime`, `react-dom`, `react-dom/client`, `@deepseek-ai/cordis`, `@deepseek-ai/dsh-client-ui-slots`, `@deepseek-ai/dsh-client-ui-primitives`, `@deepseek-ai/dsh-client-runtime/client`. Everything else must be inlined.
- The harness under test is the local checkout at `<deepseek-harness>`. Treat its APIs as a moving target and pin a supported range in `@onetest/dsh-deck`'s README before publishing.

## File Structure

```
package.json                          root: gains "workspaces": ["packages/*"]  (framework otherwise unchanged)
packages/dsh-deck/
  package.json                        bundle manifest: dsh.bundle.patch, exports, files
  cordis.patch.yml                    the installable patch: host rows + the dsh.client row
  tsconfig.json
  src/index.ts                        plugin body: mounts the seam
  src/definition.ts                   Service Definition: DeckService, DeckId, DeckSpec, resolve()
  src/octodeck/provider.ts            Service Provider: implements DeckService over Octodeck
  src/octodeck/scaffold.ts            writes decks/<name>/ into the workspace
  src/octodeck/vite-server.ts         lazy middleware-mode Vite server + HMR upgrade shim
  src/host/preview-route.ts           mounts middleware + upgrade route on ctx.webServer
  src/tools/deck-create.ts            deck_create Consumer
  src/tools/deck-view.ts              deck_view Consumer
  src/runtime/                        Octodeck deck host page: index.html + entry that imports the workspace deck
  tests/*.spec.ts
packages/dsh-deck-canvas/
  package.json                        dsh.client manifest, ./client export
  tsdown.config.ts                    reproduces the harness client-bundle artifact contract
  tsconfig.json
  src/index.ts                        node half (empty apply)
  src/client/index.ts                 browser half: slot registrations
  src/client/DeckCanvas.tsx           the canvas panel
  src/client/DeckCard.tsx             the conversation tool card
  tests/*.spec.ts
```

`definition.ts` holds only types and the `resolve` step; `provider.ts` holds Octodeck knowledge; `vite-server.ts` holds server lifetime and nothing about decks. Splitting this way keeps each file reviewable on its own and makes the eventual upstream move a file move.

---

### Task 1: Spike — prove a third-party dynamic client bundle loads

This task is a **spike**. Its output is an answer plus one throwaway package that either graduates into Task 8 or is deleted. Do not build features on top of it before Step 8 records the verdict.

**Files:**
- Create: `packages/dsh-deck-canvas/package.json`
- Create: `packages/dsh-deck-canvas/tsdown.config.ts`
- Create: `packages/dsh-deck-canvas/src/index.ts`
- Create: `packages/dsh-deck-canvas/src/client/index.ts`
- Create: `packages/dsh-deck-canvas/tests/artifact.spec.ts`
- Modify: root `package.json` (add the `workspaces` field)
- Create: `docs/design/2026-08-21-client-bundle-spike.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the verdict consumed by Task 8, and (if green) the `@onetest/dsh-deck-canvas` package skeleton with a working `tsdown.config.ts`.

- [ ] **Step 1: Make the repository a workspace**

Edit the root `package.json`, adding one field. Change nothing else — no script, dependency, or name edits.

```json
{
  "name": "octodeck",
  "workspaces": ["packages/*"]
}
```

- [ ] **Step 2: Verify the framework still builds unchanged**

Run: `npm install && npm run build`
Expected: PASS, same output as before. If `npm run skill:assets` is affected, stop — the generated skill template must not sweep `packages/`.

Run: `npm run skill:assets && git diff --stat skills/`
Expected: no changes to `skills/octodeck-presentations/assets/template/`.

- [ ] **Step 3: Write the canvas package manifest**

Create `packages/dsh-deck-canvas/package.json`:

```json
{
  "name": "@onetest/dsh-deck-canvas",
  "version": "0.0.0",
  "description": "Deck preview canvas for DeepSeek Harness: tool card and details-column panel",
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
    "./package.json": "./package.json"
  },
  "dsh": { "client": { "platform": "web" } },
  "scripts": { "bundle": "tsdown", "test": "vitest run" },
  "files": ["lib/index.js", "lib/client.js", "lib/types/**/*.d.ts"],
  "peerDependencies": { "@deepseek-ai/cordis": "*" },
  "devDependencies": {
    "@deepseek-ai/cordis": "*",
    "@types/react": "~18.3.1",
    "react": "^18.2.0",
    "tsdown": "^0.9.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Write the tsdown config reproducing the harness artifact contract**

The harness preset (`packages/client/tsdown.client.ts` in the harness checkout) cannot be imported: it globs `packages/*/*/package.json` under the harness repository root. Reproduce its contract instead.

Create `packages/dsh-deck-canvas/tsdown.config.ts`:

```ts
import { defineConfig } from 'tsdown'

/** Module specifiers the harness shell shares through its frozen module table. */
const MODULE_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

const ID = '@onetest/dsh-deck-canvas'
const isShared = (specifier: string): boolean => MODULE_TABLE.has(specifier)

export default defineConfig([
  {
    name: ID,
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    dts: false,
    clean: false,
    sourcemap: true,
    deps: {
      neverBundle: isShared,
      alwaysBundle: (specifier: string) => !isShared(specifier),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
```

- [ ] **Step 5: Write the failing artifact test**

Create `packages/dsh-deck-canvas/tests/artifact.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const artifact = (): string => readFileSync(resolve(import.meta.dirname, '../lib/client.js'), 'utf8')

describe('client bundle artifact', () => {
  it('hands the factory to the harness module loader under its package id', () => {
    expect(artifact()).toContain('window.__ModuleLoader__.load({ id: "@onetest/dsh-deck-canvas", factory: (require) => {')
  })

  it('closes the factory by returning the CommonJS exports', () => {
    expect(artifact().trimEnd().endsWith('return module.exports; } });')).toBe(true)
  })

  it('leaves shared modules as requires the module table answers', () => {
    expect(artifact()).toContain('require("@deepseek-ai/cordis")')
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck-canvas`
Expected: FAIL — `ENOENT` on `lib/client.js`, because nothing has been built.

- [ ] **Step 7: Write the minimal plugin halves and build**

Create `packages/dsh-deck-canvas/src/index.ts`:

```ts
/** Node half. The browser half carries this package's whole contribution. */
export function apply(): void {}
```

Create `packages/dsh-deck-canvas/src/client/index.ts`. The marker is deliberately crude: the spike asks whether the factory executes at all, not whether slots work.

```ts
import type { Context } from '@deepseek-ai/cordis'

/** Browser half. Spike marker only — replaced by real slot registrations in Task 8. */
export function apply(ctx: Context): void {
  const marker = document.createElement('div')
  marker.dataset.dshDeckCanvasSpike = 'loaded'
  marker.style.display = 'none'
  document.body.appendChild(marker)
  console.info('[dsh-deck-canvas] client factory executed')
  ctx.effect(() => () => { marker.remove() })
}
```

Run: `npm run bundle --workspace @onetest/dsh-deck-canvas`
Then: `npm test --workspace @onetest/dsh-deck-canvas`
Expected: PASS on all three assertions.

- [ ] **Step 8: Load it into a running harness and record the verdict**

Create a scratch profile patch that adds the row, then start the harness web surface from the local checkout:

```bash
pnpm install && pnpm dsh --profile web
```

Register the package into that profile (from the harness checkout, with the canvas package linked or installed by path):

```bash
pnpm dsh plugin --profile web add @onetest/dsh-deck-canvas
```

In the opened browser, confirm both markers:
- the console line `[dsh-deck-canvas] client factory executed`
- `document.querySelector('[data-dsh-deck-canvas-spike]')` returns a node

Write `docs/design/2026-08-21-client-bundle-spike.md` recording, in this order: the exact commands run, whether the factory executed, any loader error text verbatim, and the verdict — **green** (Task 8 proceeds as written) or **red** (Task 8 is replaced by a host-only preview that opens the deck route in an external browser tab, and the spec's canvas sections move to the official track).

- [ ] **Step 9: Commit**

```bash
git add package.json packages/dsh-deck-canvas docs/design/2026-08-21-client-bundle-spike.md
git commit -m "spike: prove a third-party dsh client bundle loads in the module table"
```

---

### Task 2: Bundle package skeleton and its cordis patch

**Files:**
- Create: `packages/dsh-deck/package.json`
- Create: `packages/dsh-deck/tsconfig.json`
- Create: `packages/dsh-deck/cordis.patch.yml`
- Create: `packages/dsh-deck/src/index.ts`
- Create: `packages/dsh-deck/tests/manifest.spec.ts`

**Interfaces:**
- Consumes: the workspace field added in Task 1 Step 1.
- Produces: package `@onetest/dsh-deck` whose manifest declares `dsh.bundle.patch = "./cordis.patch.yml"`; `apply(ctx: Context): void` as the plugin body.

- [ ] **Step 1: Write the failing manifest test**

Create `packages/dsh-deck/tests/manifest.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const manifest = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
) as Record<string, any>

describe('bundle manifest', () => {
  it('declares the patch that makes it installable with dsh plugin add', () => {
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
  })

  it('publishes the patch file itself', () => {
    expect(manifest.files).toContain('cordis.patch.yml')
  })

  it('keeps cordis a peer, never a dependency', () => {
    expect(manifest.peerDependencies['@deepseek-ai/cordis']).toBeDefined()
    expect(manifest.dependencies?.['@deepseek-ai/cordis']).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck`
Expected: FAIL — the workspace does not exist yet.

- [ ] **Step 3: Write the manifest**

Create `packages/dsh-deck/package.json`:

```json
{
  "name": "@onetest/dsh-deck",
  "version": "0.0.0",
  "description": "Octodeck deck capability for DeepSeek Harness: deck tools plus a live preview canvas",
  "type": "module",
  "license": "MIT",
  "main": "lib/index.js",
  "types": "lib/types/index.d.ts",
  "exports": {
    ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "files": ["lib/**/*.js", "lib/types/**/*.d.ts", "cordis.patch.yml", "runtime/**"],
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run" },
  "dependencies": { "vite": "^6.0.0" },
  "peerDependencies": { "@deepseek-ai/cordis": "*" },
  "devDependencies": {
    "@deepseek-ai/cordis": "*",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 4: Write the patch**

Create `packages/dsh-deck/cordis.patch.yml`. `insert` appends rows; the `dsh.client` row is what puts the canvas in the browser roster.

```yaml
# The @onetest/dsh-deck bundle patch: the deck capability over the web surface.
# Host rows mount the seam and its preview route; the canvas row joins the
# browser roster the modules node half scans into the boot payload.
- insert:
    - id: deck
      name: '@onetest/dsh-deck'

    - id: deck-canvas
      name: '@onetest/dsh-deck-canvas'
```

- [ ] **Step 5: Write the plugin body**

Create `packages/dsh-deck/src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

/** Plugin body. Later tasks mount the seam's roles here. */
export function apply(_ctx: Context): void {}
```

Create `packages/dsh-deck/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noImplicitAny": true,
    "declaration": true,
    "declarationMap": true,
    "outDir": "lib",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: Run the tests**

Run: `npm install && npm test --workspace @onetest/dsh-deck`
Expected: PASS on all three assertions.

- [ ] **Step 7: Commit**

```bash
git add packages/dsh-deck
git commit -m "feat(dsh-deck): installable bundle skeleton with its cordis patch"
```

---

### Task 3: The deck Service Definition

**Files:**
- Create: `packages/dsh-deck/src/definition.ts`
- Create: `packages/dsh-deck/tests/definition.spec.ts`

**Interfaces:**
- Consumes: `apply` from Task 2.
- Produces:
  - `type DeckId = string & { readonly __brand: 'DeckId' }`
  - `interface DeckSpec { id: DeckId; name: string; theme: string; title: string; directory: string }`
  - `interface DeckRequest { name: string; theme?: string; title?: string }`
  - `function resolveDeck(request: DeckRequest, workspace: string): DeckSpec`
  - `const DEFAULT_THEME = 'midnight'`
  - `const THEMES: readonly string[]` — the six framework theme ids.

- [ ] **Step 1: Write the failing test**

Create `packages/dsh-deck/tests/definition.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, resolveDeck } from '../src/definition.ts'

describe('resolveDeck', () => {
  it('defaults the theme explicitly rather than deep inside the provider', () => {
    const spec = resolveDeck({ name: 'launch' }, '/w')
    expect(spec.theme).toBe(DEFAULT_THEME)
  })

  it('titles the deck from its name when the caller supplies none', () => {
    expect(resolveDeck({ name: 'launch-plan' }, '/w').title).toBe('Launch Plan')
  })

  it('places the deck under decks/<name> in the workspace', () => {
    expect(resolveDeck({ name: 'launch' }, '/w').directory).toBe('/w/decks/launch')
  })

  it('rejects a theme the framework does not ship', () => {
    expect(() => resolveDeck({ name: 'launch', theme: 'neon' }, '/w')).toThrow(/neon/)
  })

  it('rejects a name that would escape the workspace', () => {
    expect(() => resolveDeck({ name: '../etc' }, '/w')).toThrow(/name/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck -- definition`
Expected: FAIL — cannot resolve `../src/definition.ts`.

- [ ] **Step 3: Write the definition**

Create `packages/dsh-deck/src/definition.ts`:

```ts
import { join } from 'node:path'

/** Opaque cross-boundary deck identity; never a bare string at a package edge. */
export type DeckId = string & { readonly __brand: 'DeckId' }

/** Theme ids the Octodeck framework ships. */
export const THEMES = ['midnight', 'protocol', 'primer', 'radiant', 'commit', 'octo-glass'] as const

/** Theme applied when a request names none. */
export const DEFAULT_THEME = 'midnight'

/** A deck as the caller asks for it, before defaulting. */
export interface DeckRequest {
  readonly name: string
  readonly theme?: string
  readonly title?: string
}

/** A fully resolved deck: every field decided, nothing left to a later fallback. */
export interface DeckSpec {
  readonly id: DeckId
  readonly name: string
  readonly theme: string
  readonly title: string
  readonly directory: string
}

/** A deck name is one path segment: lowercase letters, digits, and dashes. */
const NAME = /^[a-z0-9][a-z0-9-]*$/

/** Turn `launch-plan` into `Launch Plan`. */
function titleFrom(name: string): string {
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}

/**
 * Decide every field of a deck from a request. Defaulting lives here, at the
 * definition, so no provider hides a `?? default` inside its own run path.
 * @param request - the caller's deck request.
 * @param workspace - absolute path of the session workspace.
 * @returns the resolved deck.
 * @throws {Error} when the name is not a single safe path segment, or the theme is unknown.
 */
export function resolveDeck(request: DeckRequest, workspace: string): DeckSpec {
  if (!NAME.test(request.name)) {
    throw new Error(`deck name must match ${String(NAME)}, received ${JSON.stringify(request.name)}`)
  }
  const theme = request.theme ?? DEFAULT_THEME
  if (!THEMES.includes(theme as (typeof THEMES)[number])) {
    throw new Error(`unknown theme ${JSON.stringify(theme)}; the framework ships ${THEMES.join(', ')}`)
  }
  return {
    id: request.name as DeckId,
    name: request.name,
    theme,
    title: request.title ?? titleFrom(request.name),
    directory: join(workspace, 'decks', request.name),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @onetest/dsh-deck -- definition`
Expected: PASS, five assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-deck/src/definition.ts packages/dsh-deck/tests/definition.spec.ts
git commit -m "feat(dsh-deck): deck Service Definition with explicit resolve step"
```

---

### Task 4: Deck scaffolding

**Files:**
- Create: `packages/dsh-deck/src/octodeck/scaffold.ts`
- Create: `packages/dsh-deck/tests/scaffold.spec.ts`

**Interfaces:**
- Consumes: `DeckSpec` from Task 3.
- Produces: `async function scaffoldDeck(spec: DeckSpec): Promise<readonly string[]>` returning the absolute paths written, in write order.

- [ ] **Step 1: Write the failing test**

Create `packages/dsh-deck/tests/scaffold.spec.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'

async function scaffoldInTemp() {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
  const spec = resolveDeck({ name: 'launch' }, workspace)
  return { spec, written: await scaffoldDeck(spec) }
}

describe('scaffoldDeck', () => {
  it('writes exactly the deck-owned files, no framework or config copy', async () => {
    const { spec, written } = await scaffoldInTemp()
    expect(written.map(p => p.slice(spec.directory.length + 1))).toEqual([
      'deck.json', 'slides.ts', 'deck.css',
    ])
  })

  it('records the resolved theme and title where the provider can read them back', async () => {
    const { spec } = await scaffoldInTemp()
    const meta = JSON.parse(await readFile(join(spec.directory, 'deck.json'), 'utf8'))
    expect(meta).toEqual({ title: 'Launch', theme: 'midnight' })
  })

  it('seeds a slides module that already renders one titled slide', async () => {
    const { spec } = await scaffoldInTemp()
    const slides = await readFile(join(spec.directory, 'slides.ts'), 'utf8')
    expect(slides).toContain('export const slides: Slide[]')
    expect(slides).toContain('Launch')
  })

  it('refuses to overwrite an existing deck', async () => {
    const { spec } = await scaffoldInTemp()
    await expect(scaffoldDeck(spec)).rejects.toThrow(/exists/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck -- scaffold`
Expected: FAIL — cannot resolve `../src/octodeck/scaffold.ts`.

- [ ] **Step 3: Write the scaffolder**

Create `packages/dsh-deck/src/octodeck/scaffold.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeckSpec } from '../definition.ts'

/** The seed slides module: valid on first render, and a template for the model. */
function slidesModule(spec: DeckSpec): string {
  return `import { TitleSlide } from 'octodeck/framework'
import type { Slide } from 'octodeck/framework'

export const slides: Slide[] = [
  () => TitleSlide({ title: ${JSON.stringify(spec.title)}, subtitle: 'Edit slides.ts to build this deck' }),
]
`
}

/**
 * Write a deck's own files into the workspace. The framework, the Vite config,
 * and node_modules stay in the plugin package; only deck material lands here.
 * @param spec - the resolved deck.
 * @returns absolute paths written, in write order.
 * @throws {Error} when the deck directory already exists.
 */
export async function scaffoldDeck(spec: DeckSpec): Promise<readonly string[]> {
  // The decks/ parent may not exist yet (the first deck in a workspace), so it
  // is created permissively. The deck directory itself is created with
  // `recursive: false` so the create IS the existence check: two concurrent
  // calls cannot both believe they created it.
  await mkdir(dirname(spec.directory), { recursive: true })
  try {
    await mkdir(spec.directory, { recursive: false })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    throw new Error(`deck ${spec.name} already exists at ${spec.directory}`, { cause })
  }
  const files: Array<readonly [string, string]> = [
    ['deck.json', `${JSON.stringify({ title: spec.title, theme: spec.theme }, null, 2)}\n`],
    ['slides.ts', slidesModule(spec)],
    ['deck.css', `/* Deck-local styles for ${spec.title}. Read the --octo-* contract; never hardcode colors. */\n`],
  ]
  const written: string[] = []
  for (const [name, contents] of files) {
    const path = join(spec.directory, name)
    await writeFile(path, contents, 'utf8')
    written.push(path)
  }
  return written
}
```

Note the `mkdir` uses `recursive: false` deliberately: it is the existence check and the create in one step, so two concurrent calls cannot both believe they created the deck.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @onetest/dsh-deck -- scaffold`
Expected: PASS, four assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-deck/src/octodeck/scaffold.ts packages/dsh-deck/tests/scaffold.spec.ts
git commit -m "feat(dsh-deck): scaffold deck-owned files into the session workspace"
```

---

### Task 5: The Vite preview server and its HMR upgrade shim

This task contains the plan's second unproven mechanism. Step 5 is the go/no-go: if the upgrade shim cannot be made to work, switch to the child-process-plus-proxy fallback named in the spec and record that in the design doc before continuing.

**Files:**
- Create: `packages/dsh-deck/src/octodeck/vite-server.ts`
- Create: `packages/dsh-deck/runtime/index.html`
- Create: `packages/dsh-deck/runtime/entry.ts`
- Create: `packages/dsh-deck/tests/vite-server.spec.ts`

**Interfaces:**
- Consumes: `DeckSpec` from Task 3.
- Produces:
  - `interface PreviewServer { middleware: (req, res, next) => void; handleUpgrade(req, socket, head): void; render(url: string): Promise<string>; close(): Promise<void> }`
  - `async function startPreviewServer(options: { workspace: string; base: string }): Promise<PreviewServer>`

- [ ] **Step 1: Write the failing test**

Create `packages/dsh-deck/tests/vite-server.spec.ts`:

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { startPreviewServer } from '../src/octodeck/vite-server.ts'

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

describe('startPreviewServer', () => {
  it('exposes a middleware and an upgrade handler', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    expect(typeof server.middleware).toBe('function')
    expect(typeof server.handleUpgrade).toBe('function')
  })

  it('serves the deck host page for a scaffolded deck', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    const html = await server.render('/deck/launch/')
    expect(html).toContain('<div id="deck">')
  })

  it('closing releases the server so a second start succeeds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const first = await startPreviewServer({ workspace, base: '/deck' })
    await first.close()
    const second = await startPreviewServer({ workspace, base: '/deck' })
    open = second
    expect(typeof second.middleware).toBe('function')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck -- vite-server`
Expected: FAIL — cannot resolve `../src/octodeck/vite-server.ts`.

- [ ] **Step 3: Write the deck host page and entry**

Create `packages/dsh-deck/runtime/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Deck</title>
  </head>
  <body>
    <div id="deck"></div>
    <script type="module" src="/@dsh-deck-entry"></script>
  </body>
</html>
```

Create `packages/dsh-deck/runtime/entry.ts`. The deck name arrives in the URL; the workspace deck resolves through the alias the server installs.

```ts
import { deck } from 'octodeck/framework'
import { getTheme } from 'octodeck/themes'

const name = window.location.pathname.split('/').filter(Boolean).at(-1) ?? ''
const [{ slides }, meta] = await Promise.all([
  import(/* @vite-ignore */ `/@dsh-deck/${name}/slides.ts`),
  fetch(`/@dsh-deck/${name}/deck.json`).then(async r => r.json() as Promise<{ theme: string }>),
])

deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  themes: [getTheme(meta.theme)],
  theme: meta.theme,
}).start()
```

- [ ] **Step 4: Write the server**

Create `packages/dsh-deck/src/octodeck/vite-server.ts`:

```ts
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

/** The preview surface a host route mounts. */
export interface PreviewServer {
  /** Connect-style middleware serving every deck under the configured base. */
  readonly middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  /** Hand one upgraded socket to Vite's hot server. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  /** Transform the deck host page for one preview URL. */
  render(url: string): Promise<string>
  /** Stop the server and release its watchers. */
  close(): Promise<void>
}

/** Where the packaged runtime lives, independent of the caller's cwd. */
const RUNTIME_ROOT = fileURLToPath(new URL('../../runtime/', import.meta.url))

/**
 * Start the shared deck preview server in middleware mode.
 *
 * Vite attaches its hot server to an object it can call `.on('upgrade')` on.
 * The harness owns the real HTTP server, so an emitter stands in and
 * {@link PreviewServer.handleUpgrade} feeds it the sockets the harness routes.
 * @param options - session workspace root and the base path the harness mounts.
 * @returns the running preview server.
 */
export async function startPreviewServer(
  options: { readonly workspace: string, readonly base: string },
): Promise<PreviewServer> {
  const upgrades = new EventEmitter()
  const vite: ViteDevServer = await createServer({
    root: RUNTIME_ROOT,
    base: `${options.base}/`,
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: { server: upgrades as unknown as import('node:http').Server },
      fs: { allow: [RUNTIME_ROOT, options.workspace] },
    },
    resolve: {
      alias: [
        // Workspace decks, reached from the host page and from a deck's own imports.
        { find: /^\/@dsh-deck\//, replacement: `${options.workspace}/decks/` },
        // `octodeck/framework` and `octodeck/themes` resolve to the framework
        // source in this repository. The root package publishes no such
        // subpaths, so the alias — not an exports map — is what makes the
        // specifier work, in the seeded slides.ts and in the host entry alike.
        { find: 'octodeck/framework', replacement: fileURLToPath(new URL('../../../../src/framework/index.ts', import.meta.url)) },
        { find: 'octodeck/themes', replacement: fileURLToPath(new URL('../../../../src/themes/index.ts', import.meta.url)) },
      ],
    },
  })
  return {
    middleware: vite.middlewares,
    handleUpgrade(req, socket, head) { upgrades.emit('upgrade', req, socket, head) },
    async render(url) {
      const { readFile } = await import('node:fs/promises')
      const html = await readFile(new URL('index.html', RUNTIME_ROOT), 'utf8')
      return vite.transformIndexHtml(url, html)
    },
    async close() { await vite.close() },
  }
}
```

- [ ] **Step 5: Run the tests — this is the go/no-go**

Run: `npm test --workspace @onetest/dsh-deck -- vite-server`
Expected: PASS, three assertions.

If the `hmr: { server }` handoff throws or Vite refuses the emitter, do not work around it here. Record the failure in `docs/design/2026-08-21-deck-capability-and-canvas.md` under Risks, switch this file to the child-process-plus-proxy fallback, and keep the same `PreviewServer` interface so no later task changes.

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-deck/src/octodeck/vite-server.ts packages/dsh-deck/runtime packages/dsh-deck/tests/vite-server.spec.ts
git commit -m "feat(dsh-deck): middleware-mode Vite preview server with an HMR upgrade shim"
```

---

### Task 6: Mount the preview on the harness web server

**Files:**
- Create: `packages/dsh-deck/src/host/preview-route.ts`
- Create: `packages/dsh-deck/tests/preview-route.spec.ts`
- Modify: `packages/dsh-deck/src/index.ts`

**Interfaces:**
- Consumes: `startPreviewServer` from Task 5.
- Produces: `function mountPreviewRoute(ctx: Context, options: { workspace: string; base: string }): void`, registering both routes as disposable effects.

- [ ] **Step 1: Write the failing test**

Create `packages/dsh-deck/tests/preview-route.spec.ts`. The harness web server is stubbed to its two registration methods, which is the whole surface this file uses.

```ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mountPreviewRoute } from '../src/host/preview-route.ts'

function harness() {
  const disposers: Array<() => void> = []
  const webServer = {
    register: vi.fn(() => () => {}),
    registerUpgrade: vi.fn(() => () => {}),
  }
  const ctx = { webServer, effect: vi.fn((fn: () => () => void) => { disposers.push(fn()) }) }
  return { ctx, webServer, disposers }
}

describe('mountPreviewRoute', () => {
  it('registers one prefix route and one upgrade route under the base', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { ctx, webServer } = harness()
    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(webServer.register).toHaveBeenCalledTimes(1))
    expect(webServer.register.mock.calls[0][0]).toMatchObject({ kind: 'prefix', path: '/deck' })
    expect(webServer.registerUpgrade.mock.calls[0][0]).toMatchObject({ path: '/deck' })
  })

  it('registers through ctx.effect so disposal removes both routes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { ctx } = harness()
    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(ctx.effect).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck -- preview-route`
Expected: FAIL — cannot resolve `../src/host/preview-route.ts`.

- [ ] **Step 3: Write the route**

Create `packages/dsh-deck/src/host/preview-route.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { startPreviewServer, type PreviewServer } from '../octodeck/vite-server.ts'

/**
 * Mount the deck preview on the harness's own web server: one prefix route for
 * HTTP and one upgrade route for hot module replacement, both as effects so
 * disposing the plugin removes them and stops the server.
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - session workspace root and the base path to serve under.
 */
export function mountPreviewRoute(
  ctx: Context,
  options: { readonly workspace: string, readonly base: string },
): void {
  let server: PreviewServer | undefined
  const ready = startPreviewServer(options).then((started) => {
    server = started
    ctx.effect(() => {
      const routes = [
        ctx.webServer.register({
          kind: 'prefix',
          path: options.base,
          handler: (req, res) => { started.middleware(req, res, () => { res.statusCode = 404; res.end() }) },
        }),
        ctx.webServer.registerUpgrade({
          path: options.base,
          handler: (req, socket, head) => { started.handleUpgrade(req, socket, head) },
        }),
      ]
      return () => { for (const dispose of routes) dispose() }
    })
    return started
  })
  ctx.effect(() => () => { void ready.then(async () => { await server?.close() }) })
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @onetest/dsh-deck -- preview-route`
Expected: PASS, two assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-deck/src/host/preview-route.ts packages/dsh-deck/tests/preview-route.spec.ts
git commit -m "feat(dsh-deck): serve the preview from the harness web server"
```

---

### Task 7: The deck_create and deck_view tools

**Files:**
- Create: `packages/dsh-deck/src/tools/deck-create.ts` (both tool bodies; they share `PreviewOptions` and the deck-path derivation, so splitting them would split one responsibility across two files)
- Create: `packages/dsh-deck/tests/tools.spec.ts`
- Modify: `packages/dsh-deck/src/index.ts`

**Interfaces:**
- Consumes: `resolveDeck` (Task 3), `scaffoldDeck` (Task 4), `mountPreviewRoute` (Task 6).
- Produces: two registered tools whose canonical values are
  - `deck_create` → `{ deckId: string; directory: string; slidesPath: string; route: string; theme: string }`
  - `deck_view` → `{ deckId: string; route: string; slideCount: number; theme: string }`

The canvas reads `deck_view`'s value off the logged tool result, so these field names are a contract Task 8 depends on. Do not rename them without changing Task 8.

- [ ] **Step 1: Write the failing test**

Create `packages/dsh-deck/tests/tools.spec.ts`:

```ts
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeck, viewDeck } from '../src/tools/deck-create.ts'

describe('deck_create', () => {
  it('returns a canonical value the canvas can render from', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const value = await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(value).toEqual({
      deckId: 'launch',
      directory: join(workspace, 'decks', 'launch'),
      slidesPath: join(workspace, 'decks', 'launch', 'slides.ts'),
      route: '/deck/launch/',
      theme: 'midnight',
    })
  })

  it('leaves an editable slides module on disk', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const value = await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(await readFile(value.slidesPath, 'utf8')).toContain('export const slides')
  })
})

describe('deck_view', () => {
  it('reports the slide count and theme of a deck on disk', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    const value = await viewDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(value).toEqual({ deckId: 'launch', route: '/deck/launch/', slideCount: 1, theme: 'midnight' })
  })

  it('fails loudly for a deck that does not exist', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await expect(viewDeck({ name: 'ghost' }, { workspace, base: '/deck' })).rejects.toThrow(/ghost/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck -- tools`
Expected: FAIL — cannot resolve `../src/tools/deck-create.ts`.

- [ ] **Step 3: Write the tool bodies**

Create `packages/dsh-deck/src/tools/deck-create.ts`:

```ts
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveDeck, type DeckRequest } from '../definition.ts'
import { scaffoldDeck } from '../octodeck/scaffold.ts'

/** Where a deck is served, given the mounted base path. */
export interface PreviewOptions {
  readonly workspace: string
  readonly base: string
}

/** The canonical value `deck_create` returns. */
export interface DeckCreated {
  readonly deckId: string
  readonly directory: string
  readonly slidesPath: string
  readonly route: string
  readonly theme: string
}

/** The canonical value `deck_view` returns; the canvas renders from exactly these fields. */
export interface DeckView {
  readonly deckId: string
  readonly route: string
  readonly slideCount: number
  readonly theme: string
}

/**
 * Create a deck in the session workspace.
 * @param request - the caller's deck request.
 * @param options - workspace root and mounted preview base.
 * @returns the created deck's identity, paths, and preview route.
 */
export async function createDeck(request: DeckRequest, options: PreviewOptions): Promise<DeckCreated> {
  const spec = resolveDeck(request, options.workspace)
  await scaffoldDeck(spec)
  return {
    deckId: spec.id,
    directory: spec.directory,
    slidesPath: join(spec.directory, 'slides.ts'),
    route: `${options.base}/${spec.name}/`,
    theme: spec.theme,
  }
}

/**
 * Report an existing deck for preview.
 * @param request - names the deck to view.
 * @param options - workspace root and mounted preview base.
 * @returns the deck's preview route, slide count, and theme.
 * @throws {Error} when the deck is not on disk.
 */
export async function viewDeck(request: DeckRequest, options: PreviewOptions): Promise<DeckView> {
  const spec = resolveDeck(request, options.workspace)
  let meta: { theme: string }
  try {
    meta = JSON.parse(await readFile(join(spec.directory, 'deck.json'), 'utf8')) as { theme: string }
  } catch (cause) {
    throw new Error(`no deck named ${spec.name} in this workspace`, { cause })
  }
  const slides = await readFile(join(spec.directory, 'slides.ts'), 'utf8')
  return {
    deckId: spec.id,
    route: `${options.base}/${spec.name}/`,
    slideCount: countSlides(slides),
    theme: meta.theme,
  }
}

/** Count top-level entries in the exported slides array by their trailing commas. */
function countSlides(source: string): number {
  const body = source.slice(source.indexOf('['), source.lastIndexOf(']'))
  return body.split('\n').filter(line => /^\s{2}\S/.test(line)).length
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @onetest/dsh-deck -- tools`
Expected: PASS, four assertions.

- [ ] **Step 5: Register both tools in the plugin body**

Replace `packages/dsh-deck/src/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { THEMES } from './definition.ts'
import { mountPreviewRoute } from './host/preview-route.ts'
import { createDeck, viewDeck } from './tools/deck-create.ts'

/** Deployment-varying choices, changeable from cordis.yml. */
export interface Config {
  /** Base path the preview is served under. */
  readonly base: string
}

export const inject = ['tools', 'webServer']

/**
 * Mount the deck capability: the preview route plus the two model-facing tools.
 * @param ctx - plugin context.
 * @param config - the row's validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const workspace = process.cwd()
  mountPreviewRoute(ctx, { workspace, base: config.base })
  const options = { workspace, base: config.base }

  ctx.tools.register(defineTool({
    name: 'deck_create',
    description: 'Create a presentation deck in the workspace. Slides are TypeScript; edit slides.ts to author them.',
    parameters: {
      name: { type: 'string', required: true, description: 'Deck name: lowercase letters, digits, and dashes' },
      theme: { type: 'string', description: `One of ${THEMES.join(', ')}` },
      title: { type: 'string', description: 'Deck title; defaults to the name in title case' },
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `Created deck ${value.deckId}; edit ${value.slidesPath}` }],
    },
    execute: async args => createDeck(args, options),
  }))

  ctx.tools.register(defineTool({
    name: 'deck_view',
    description: 'Open a deck on the preview canvas.',
    parameters: { name: { type: 'string', required: true, description: 'Deck name' } },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: `Deck ${value.deckId}: ${value.slideCount} slide(s)` }],
    },
    execute: async args => viewDeck(args, options),
  }))
}
```

Add `- id: deck` config to `cordis.patch.yml`:

```yaml
    - id: deck
      name: '@onetest/dsh-deck'
      config:
        base: /deck
```

- [ ] **Step 6: Commit**

```bash
git add packages/dsh-deck
git commit -m "feat(dsh-deck): deck_create and deck_view tools over the preview route"
```

---

### Task 8: The canvas

Run this task only if Task 1 Step 8 recorded a **green** verdict. On red, replace it with a host-only preview task per that record.

**Files:**
- Modify: `packages/dsh-deck-canvas/src/client/index.ts` (replaces the spike marker)
- Create: `packages/dsh-deck-canvas/src/client/DeckCanvas.tsx`
- Create: `packages/dsh-deck-canvas/tests/deck-canvas.spec.tsx`

**Interfaces:**
- Consumes: the `deck_view` canonical value from Task 7 — `{ deckId, route, slideCount, theme }`.
- Produces: a registration into `conversation.details.tool` rendering the deck.

- [ ] **Step 1: Write the failing component test**

Create `packages/dsh-deck-canvas/tests/deck-canvas.spec.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DeckCanvas } from '../src/client/DeckCanvas.tsx'

const view = { deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' }

describe('DeckCanvas', () => {
  it('frames the deck at the slide the viewer is on', () => {
    render(<DeckCanvas view={view} slide={2} onSlide={() => {}} />)
    expect(screen.getByTitle('launch')).toHaveAttribute('src', '/deck/launch/#2')
  })

  it('shows the viewer where they are in the deck', () => {
    render(<DeckCanvas view={view} slide={2} onSlide={() => {}} />)
    expect(screen.getByText('2 / 4')).toBeInTheDocument()
  })

  it('does not offer a previous control on the first slide', () => {
    render(<DeckCanvas view={view} slide={1} onSlide={() => {}} />)
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --workspace @onetest/dsh-deck-canvas -- deck-canvas`
Expected: FAIL — cannot resolve `../src/client/DeckCanvas.tsx`.

- [ ] **Step 3: Write the component**

Create `packages/dsh-deck-canvas/src/client/DeckCanvas.tsx`:

```tsx
/** The `deck_view` canonical value, as logged on the tool result. */
export interface DeckViewData {
  readonly deckId: string
  readonly route: string
  readonly slideCount: number
  readonly theme: string
}

export interface DeckCanvasProps {
  readonly view: DeckViewData
  readonly slide: number
  readonly onSlide: (slide: number) => void
}

/**
 * The deck canvas: a 16:9 frame on the live preview plus slide navigation.
 * Octodeck scales its fixed frame to whatever box it is given, so the panel
 * only sizes the frame; dragging the details boundary rescales the deck.
 */
export function DeckCanvas({ view, slide, onSlide }: DeckCanvasProps) {
  return (
    <div>
      <div style={{ aspectRatio: '16 / 9', width: '100%' }}>
        <iframe
          title={view.deckId}
          src={`${view.route}#${slide}`}
          style={{ width: '100%', height: '100%', border: 0 }}
        />
      </div>
      <div>
        <button type="button" aria-label="Previous slide" disabled={slide <= 1} onClick={() => { onSlide(slide - 1) }}>←</button>
        <span>{slide} / {view.slideCount}</span>
        <button type="button" aria-label="Next slide" disabled={slide >= view.slideCount} onClick={() => { onSlide(slide + 1) }}>→</button>
      </div>
    </div>
  )
}
```

Add to `packages/dsh-deck-canvas/package.json` devDependencies: `"@testing-library/react": "^16.0.0"`, `"@testing-library/jest-dom": "^6.5.0"`, `"jsdom": "^25.0.0"`.

- [ ] **Step 4: Run the tests**

Run: `npm test --workspace @onetest/dsh-deck-canvas -- deck-canvas`
Expected: PASS, three assertions.

- [ ] **Step 5: Learn the slot's props before writing the container**

`DeckCanvas` takes `view`, `slide`, and `onSlide` — plain data and a callback. A slot registrant does not receive those; it receives the four derived props shares. A container adapts one to the other, and its props type is not guessable: read the authoritative declaration first.

Read, in the harness checkout:
- `packages/client/ui-conversation/src/client/contract/slots.ts` — the exact `conversation.details.tool` props type
- `packages/client/ui-conversation/src/client/skeleton/DetailsPanel.tsx` — the working example of a details registrant deriving its call material from `props.useSession()` and the shared chat store

Record the resolved props type in a comment at the top of the container. If the slot's props do not expose the selected tool call's canonical value, stop: that is a real finding about the harness, and the fallback is a keyed `tool.call.toolview` registration on `deck_view` instead, which owns its own call data.

- [ ] **Step 6: Write the container against that type**

Create `packages/dsh-deck-canvas/src/client/DeckDetails.tsx`. Its one job: find the selected `deck_view` call's canonical value, hold the current slide in component state, and hand both to `DeckCanvas`. Parse defensively at this edge — the value crosses from a logged tool result, which is a durable-format boundary, not a typed same-process one.

```tsx
import { useState } from 'react'
import { DeckCanvas, type DeckViewData } from './DeckCanvas.tsx'

/** Narrow a logged tool-result value to the fields the canvas renders. */
export function asDeckView(value: unknown): DeckViewData | null {
  if (typeof value !== 'object' || value === null) return null
  const { deckId, route, slideCount, theme } = value as Record<string, unknown>
  if (typeof deckId !== 'string' || typeof route !== 'string') return null
  if (typeof slideCount !== 'number' || typeof theme !== 'string') return null
  return { deckId, route, slideCount, theme }
}

/** Props: the slot's own type, as read in Step 5. */
export function DeckDetails(props: { readonly resultValue: unknown }) {
  const [slide, setSlide] = useState(1)
  const view = asDeckView(props.resultValue)
  if (view === null) return null
  return <DeckCanvas view={view} slide={slide} onSlide={setSlide} />
}
```

Write its test alongside — `asDeckView` is the part worth testing, because it is the boundary:

```tsx
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { asDeckView } from '../src/client/DeckDetails.tsx'

describe('asDeckView', () => {
  it('accepts a deck_view canonical value', () => {
    expect(asDeckView({ deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' }))
      .toEqual({ deckId: 'launch', route: '/deck/launch/', slideCount: 4, theme: 'midnight' })
  })

  it('rejects another tool\'s result rather than rendering an empty frame', () => {
    expect(asDeckView({ stdout: 'ok', exitCode: 0 })).toBeNull()
  })

  it('rejects a null value', () => {
    expect(asDeckView(null)).toBeNull()
  })
})
```

Run: `npm test --workspace @onetest/dsh-deck-canvas`
Expected: PASS, six assertions across both files.

- [ ] **Step 7: Register the container into the details column**

Replace `packages/dsh-deck-canvas/src/client/index.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'
import { DeckDetails } from './DeckDetails.tsx'

/**
 * Browser half: fill the conversation's details hole with the deck canvas.
 * `slots.inject` waits for the declaration rather than assuming apply order,
 * and withdraws the contribution if that declaration collapses.
 */
export function apply(ctx: Context): void {
  ctx.slots.inject('conversation.details.tool', () => ctx.slots.register({
    name: 'conversation.details.tool',
  }, DeckDetails))
}
```

- [ ] **Step 8: Verify end to end in a running harness**

Run the harness web surface with the bundle installed, ask it to create a deck, and confirm all four:
- the deck appears under `decks/<name>/` in the workspace
- the details column renders the deck
- editing `slides.ts` repaints the canvas with no tool call
- stopping the harness leaves no orphaned Vite process

Expected: all four. Any failure is a real finding — record it in the design doc's Risks before continuing.

- [ ] **Step 9: Commit**

```bash
git add packages/dsh-deck-canvas
git commit -m "feat(dsh-deck-canvas): deck canvas in the conversation details column"
```

---

## Deferred acceptance criteria

Three of the spec's acceptance criteria are deliberately not covered by this plan, and belong to the phase that can honestly test them:

- **Non-loopback preview.** Task 8 Step 8 verifies the canvas on the development machine only. Reaching the Host over a non-loopback authority needs a second machine or a tunnel; schedule it before any release that claims remote Web support.
- **Replay reconstructs the canvas.** The design derives canvas state from the logged tool result specifically so replay works, but nothing here replays a session. Add it with the snapshot coverage in a later phase.
- **Self-contained HTML export.** Phase 4, out of scope for the walking skeleton.
