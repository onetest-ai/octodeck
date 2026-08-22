# Deck Export and Theme Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three export buttons (HTML, PDF, PPTX) and a theme switcher to the `@onetest/dsh-deck` canvas header, rendering through the browser that already displays the deck.

**Architecture:** Export splits at one line — what only a browser can know (measured layout of the live DOM, via a hidden 1280×720 same-origin iframe) versus what only Node should do (file assembly and workspace writes, behind a new `{base}/@export` route). No headless browser is launched anywhere.

**Tech Stack:** TypeScript, Vite 6 (middleware mode + programmatic build), React 18, cordis plugin context, vitest + jsdom + @testing-library/react, `node:zlib` for ZIP.

**Spec:** `docs/design/2026-08-22-deck-export-and-theme-switcher.md`

## Global Constraints

- **Node only.** No `python3`, no Playwright, no system-browser discovery, no bundled Chromium at plugin runtime. Playwright remains a devDependency of the *root* repo for its existing CLI scripts only.
- **Package root for all plugin work:** `packages/dsh-deck/`. Run `npm test`, `npm run typecheck`, `npm run build` from there.
- **Canvas units:** the deck canvas is 1280×720 **CSS pixels**. IR coordinates are design pixels. PDF pages are **960×540 pt** (1280×720 px ÷ 96dpi × 72).
- **Containment rule, unchanged:** every route that addresses a deck must go `decodeDeckKey(key)` → `isDeckDirectory(dir)` before touching disk. Both are in `packages/dsh-deck/src/definition.ts`.
- **Route prefix is `@export`**, never `export` — `export` is a legal deck name under `/^[a-z0-9][a-z0-9-]*$/`.
- **Theme switching is preview-only.** Never write `deck.json` from the canvas.
- **Export follows the displayed theme**, not `deck.json`'s theme. All three formats take `theme` and `mode` as inputs.
- **Existing suite must stay green:** 75 tests pass today from a bare `npm test` in `packages/dsh-deck`.
- **Style:** match surrounding code — TSDoc on exported symbols explaining *why*, `readonly` on interface fields, no hardcoded colours in client CSS (use `var(--dsw-color-*, fallback)`).

## Refinement over the spec

The spec says the client produces `SlideIR[]`. Reading `scripts/pptx/extract.ts` shows the boundary sits one step earlier: `WALKER()` produces **raw items**, and `mapItem()`/`fontFace()` convert those to `SlideIR` using `color.ts` — pure Node code. So the client ships **only `WALKER`** and posts raw items; the server maps. This honours the spec's stated split ("what only a browser can know") more exactly and keeps `color.ts` out of the browser bundle.

## File structure

**New in `packages/dsh-deck/`:**

| file | responsibility |
|---|---|
| `src/export/zip.ts` | virtual file map → ZIP bytes (`node:zlib`) |
| `src/export/html.ts` | deck + theme → self-contained HTML |
| `src/export/pptx.ts` | raw items + theme → `.pptx` bytes |
| `src/export/pdf/objects.ts` | PDF object/xref/stream primitives |
| `src/export/pdf/font.ts` | TTF → embedded CID font objects |
| `src/export/pdf/index.ts` | `SlideIR[]` → PDF bytes |
| `src/export/fonts.ts` | locate vendored TTFs; fetch-or-warn for Cabinet Grotesk |
| `src/host/export-route.ts` | three endpoints, containment, write + stream |
| `src/client/extract-deck.ts` | hidden-iframe driver → raw items per slide |
| `src/client/export-actions.ts` | client-side export orchestration + POST |

**Modified:**

| file | change |
|---|---|
| `scripts/pptx/extract.ts` | `WALKER(doc)` parameterized; export `WALKER` and `slidesFromRaw` |
| `scripts/pptx/build.ts` | drop `python3`, use the new zip writer |
| `packages/dsh-deck/scripts/vendor-framework.mjs` | also vendor the pptx pipeline, fonts, backdrops |
| `packages/dsh-deck/runtime/entry.ts` | register all six themes |
| `packages/dsh-deck/src/client/canvas-state.ts` | export status + selected theme; `MIN_WIDTH` 320→420 |
| `packages/dsh-deck/src/client/canvas-controller.ts` | writes for the above |
| `packages/dsh-deck/src/client/DeckOverlay.tsx` | theme select + Export menu + progress |
| `packages/dsh-deck/src/host/preview-route.ts` | mount the export route alongside |

---

### Task 1: ZIP writer, and delete the `python3` dependency

**Files:**
- Create: `packages/dsh-deck/src/export/zip.ts`
- Create: `packages/dsh-deck/tests/zip.spec.ts`
- Modify: `scripts/pptx/build.ts:55-70` (replace the `execFileSync('python3', …)` block)

**Interfaces:**
- Consumes: nothing.
- Produces: `zipSync(files: Record<string, string | Uint8Array>): Buffer` — deflates each entry, `[Content_Types].xml` forced first.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dsh-deck/tests/zip.spec.ts
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { zipSync } from '../src/export/zip.ts'

/** Minimal central-directory reader: enough to assert order and payloads. */
function readZip(buf: Buffer) {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const entries: { name: string, data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const method = buf.readUInt16LE(local + 8)
    const compSize = buf.readUInt32LE(local + 18)
    const lNameLen = buf.readUInt16LE(local + 26)
    const lExtraLen = buf.readUInt16LE(local + 28)
    const start = local + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(start, start + compSize)
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : raw })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

describe('zipSync', () => {
  it('round-trips every entry byte-for-byte', () => {
    const entries = readZip(zipSync({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }))
    const byName = new Map(entries.map(e => [e.name, e.data]))
    expect(byName.get('[Content_Types].xml')?.toString('utf8')).toBe('<Types/>')
    expect(byName.get('ppt/presentation.xml')?.toString('utf8')).toBe('<p:presentation/>')
    expect([...(byName.get('ppt/media/image1.png') ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('places [Content_Types].xml first whatever the insertion order', () => {
    const entries = readZip(zipSync({
      'ppt/presentation.xml': '<p:presentation/>',
      '[Content_Types].xml': '<Types/>',
    }))
    expect(entries[0].name).toBe('[Content_Types].xml')
  })

  it('records a CRC32 that matches the uncompressed bytes', () => {
    const buf = zipSync({ '[Content_Types].xml': 'hello' })
    // CRC32 of "hello" is 0x3610a686
    expect(buf.readUInt32LE(14)).toBe(0x3610a686)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/zip.spec.ts`
Expected: FAIL — `Failed to resolve import "../src/export/zip.ts"`

- [ ] **Step 3: Implement the writer**

```ts
// packages/dsh-deck/src/export/zip.ts
import { deflateRawSync } from 'node:zlib'

/**
 * The OPC part every consumer reads first. PowerPoint tolerates a lot, but it
 * wants the content-type map at the front of the archive, so it is written
 * first regardless of the order the caller built the map in.
 */
const CONTENT_TYPES = '[Content_Types].xml'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * CRC32 as ZIP specifies it: reflected, initial and final xor of 0xffffffff.
 * @param bytes - the uncompressed entry payload.
 * @returns the checksum, unsigned.
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Package a virtual file map into a ZIP archive, entirely in memory.
 *
 * `buildPptx` already returns exactly such a map, so this replaces both the
 * `python3` zipfile call the CLI export shelled out to and the
 * `dist-pptx/unpacked` disk staging that existed only to feed it. A plugin
 * cannot assume a Python interpreter, and no dependency is needed for a
 * format this small.
 *
 * Everything is stored deflated with no ZIP64 and no data descriptors: the
 * parts of a deck export are far below the 4GB field limits, and keeping the
 * writer to one shape keeps it auditable.
 * @param files - part name (POSIX path, no leading slash) to its contents.
 * @returns the complete archive.
 */
export function zipSync(files: Record<string, string | Uint8Array>): Buffer {
  const names = Object.keys(files).sort((a, b) =>
    a === CONTENT_TYPES ? -1 : b === CONTENT_TYPES ? 1 : a < b ? -1 : a > b ? 1 : 0)

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const name of names) {
    const value = files[name]
    const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
    const deflated = deflateRawSync(body)
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(body)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(0, 10) // mod time — fixed, so output is deterministic
    local.writeUInt16LE(0x21, 12) // mod date — 1980-01-01
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    nameBytes.copy(local, 30)
    locals.push(local, deflated)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0x21, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(0, 42) // external attrs
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)

    offset += local.length + deflated.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}
```

Note: the central-directory header writes `offset` at byte 42; remove the stray `writeUInt32LE(0, 42)` above it if the implementer copies verbatim — external attributes belong at byte 38. Correct layout: `writeUInt32LE(0, 36)` internal+external attrs region, `writeUInt32LE(offset, 42)`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/zip.spec.ts`
Expected: 3 passing.

- [ ] **Step 5: Replace the `python3` call in the CLI export**

In `scripts/pptx/build.ts`, delete the `unpacked` staging loop and the `execFileSync('python3', …)` block, and replace with:

```ts
import { zipSync } from '../../packages/dsh-deck/src/export/zip.ts'

mkdirSync('dist-pptx', { recursive: true })
const out = `dist-pptx/${deck}-${themeId}.pptx`
writeFileSync(out, zipSync(files as Record<string, string | Uint8Array>))
console.log(`built ${out} · deck=${deck} · theme=${themeId} · ${slides.length} slides`)
```

Also remove the now-unused `execFileSync`, `rmSync`, and `dirname` imports.

- [ ] **Step 6: Verify the CLI export still produces a valid file**

Run: `npm run dev` in one shell, then in another:
`npm run build:pptx -- octo-glass --deck <an existing deck>`
Expected: writes `dist-pptx/<deck>-octo-glass.pptx`. Open it in PowerPoint or Keynote and confirm it renders.
If no deck exists: `npm run new:deck -- exporttest` first.

- [ ] **Step 7: Commit**

```bash
git add packages/dsh-deck/src/export/zip.ts packages/dsh-deck/tests/zip.spec.ts scripts/pptx/build.ts
git commit -m "feat(dsh-deck): in-memory ZIP writer, removing the python3 dependency"
```

---

### Task 2: Vendor the pptx pipeline, fonts, and backdrops into the package

**Files:**
- Modify: `packages/dsh-deck/scripts/vendor-framework.mjs`
- Modify: `packages/dsh-deck/package.json` (`files` array)
- Create: `packages/dsh-deck/tests/vendor.spec.ts`
- Create: `scripts/pptx/fonts/Inter-*.ttf` (downloaded, OFL)

**Interfaces:**
- Consumes: nothing.
- Produces: `packages/dsh-deck/vendor/pptx/{color,ir,ooxml,theme,extract}.ts`, `vendor/pptx/themes.resolved.json`, `vendor/pptx/fonts/*.ttf`, `vendor/pptx/backdrops/*.png`.

- [ ] **Step 1: Bake the backdrops once, in this repo**

Run: `npm run dev` in one shell, then:
```bash
npm run pptx:bake
```
Expected: writes `scripts/pptx/backdrops/<theme>.png` for each rich theme. Confirm with `ls scripts/pptx/backdrops`.

These PNGs are committed — they are per-theme and deck-independent, which is what removes the runtime browser dependency.

- [ ] **Step 2: Add Inter TTFs**

Download Inter (OFL) static TTFs and place `Inter-Regular.ttf`, `Inter-Medium.ttf`, `Inter-SemiBold.ttf`, `Inter-Bold.ttf` in `scripts/pptx/fonts/`. Append Inter's OFL text to `scripts/pptx/fonts/OFL.txt` (it already carries Geist's).

Then extend the `FONT_VARIANTS` table in `scripts/pptx/build.ts`:

```ts
'Inter': [['Inter', 'Inter-Regular.ttf'], ['Inter Medium', 'Inter-Medium.ttf'], ['Inter SemiBold', 'Inter-SemiBold.ttf'], ['Inter Bold', 'Inter-Bold.ttf']],
```

- [ ] **Step 3: Write the failing test**

```ts
// packages/dsh-deck/tests/vendor.spec.ts
import { access, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const vendor = new URL('../vendor/pptx/', import.meta.url)
const at = (name: string) => fileURLToPath(new URL(name, vendor))

describe('vendored pptx pipeline', () => {
  it('carries every Node-side module the export producers import', async () => {
    for (const file of ['color.ts', 'ir.ts', 'ooxml.ts', 'theme.ts', 'extract.ts']) {
      await expect(access(at(file))).resolves.toBeUndefined()
    }
  })

  it('carries the resolved-theme snapshot so pptx:themes never runs at export time', async () => {
    await expect(access(at('themes.resolved.json'))).resolves.toBeUndefined()
  })

  it('carries the fonts the three export formats embed', async () => {
    const fonts = await readdir(at('fonts'))
    expect(fonts).toEqual(expect.arrayContaining([
      'Geist-Regular.ttf', 'Switzer-Regular.ttf', 'Inter-Regular.ttf',
    ]))
  })

  it('carries baked backdrops so pptx:bake never runs at export time', async () => {
    const baked = await readdir(at('backdrops'))
    expect(baked.some(f => f.endsWith('.png'))).toBe(true)
  })
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/vendor.spec.ts`
Expected: FAIL — ENOENT on `vendor/pptx/color.ts`.

- [ ] **Step 5: Extend the vendor script**

Append to `packages/dsh-deck/scripts/vendor-framework.mjs`, before the final `console.log`:

```js
/**
 * The pptx pipeline is vendored for the same reason the framework is: the
 * export producers import it at runtime, and reaching back into this
 * checkout by relative depth only resolves from inside this repository.
 *
 * `themes.resolved.json`, `fonts/`, and `backdrops/` come along because they
 * are what let `pptx:themes` and `pptx:bake` — both of which need a browser —
 * stay build-time steps in this repo rather than runtime steps in a user's
 * harness.
 */
const pptxSource = new URL('../../scripts/pptx/', packageRoot)
const pptxVendor = new URL('vendor/pptx/', packageRoot)
await rm(fileURLToPath(pptxVendor), { recursive: true, force: true })
await mkdir(fileURLToPath(pptxVendor), { recursive: true })
for (const file of ['color.ts', 'ir.ts', 'ooxml.ts', 'theme.ts', 'extract.ts', 'themes.resolved.json']) {
  await cp(fileURLToPath(new URL(file, pptxSource)), fileURLToPath(new URL(file, pptxVendor)))
}
for (const directory of ['fonts', 'backdrops']) {
  await cp(
    fileURLToPath(new URL(`${directory}/`, pptxSource)),
    fileURLToPath(new URL(`${directory}/`, pptxVendor)),
    { recursive: true },
  )
}
console.log(`vendored pptx pipeline into ${fileURLToPath(pptxVendor)}`)
```

- [ ] **Step 6: Run the vendor step and the test**

Run: `cd packages/dsh-deck && npm run vendor && npx vitest run tests/vendor.spec.ts`
Expected: 4 passing.

- [ ] **Step 7: Confirm the package ships it**

`packages/dsh-deck/package.json` already lists `vendor/**` in `files`, so no change is needed — verify with:
Run: `cd packages/dsh-deck && npm pack --dry-run 2>&1 | grep -c "vendor/pptx"`
Expected: a non-zero count.

- [ ] **Step 8: Run the whole suite and commit**

Run: `cd packages/dsh-deck && npm test`
Expected: all previous tests plus the 4 new ones pass.

```bash
git add scripts/pptx/fonts scripts/pptx/backdrops scripts/pptx/build.ts \
        packages/dsh-deck/scripts/vendor-framework.mjs packages/dsh-deck/tests/vendor.spec.ts
git commit -m "build(dsh-deck): vendor the pptx pipeline, fonts, and baked backdrops"
```

---

### Task 3: The export route, with HTML as its first producer

**Files:**
- Create: `packages/dsh-deck/src/export/html.ts`
- Create: `packages/dsh-deck/src/host/export-route.ts`
- Create: `packages/dsh-deck/tests/export-route.spec.ts`
- Create: `packages/dsh-deck/tests/export-html.spec.ts`
- Modify: `packages/dsh-deck/src/host/preview-route.ts` (mount the export route)
- Modify: `packages/dsh-deck/package.json` (add `vite-plugin-singlefile`)

**Interfaces:**
- Consumes: `zipSync` (Task 1), `decodeDeckKey`/`isDeckDirectory` from `src/definition.ts`.
- Produces:
  - `exportHtml(directory: string, theme: string, mode: string): Promise<Buffer>`
  - `mountExportRoute(ctx: PreviewHostContext, options: { base: string }): void`
  - Route shapes: `GET {base}/@export/{key}/html?theme=&mode=`; `POST {base}/@export/{key}/pptx`; `POST {base}/@export/{key}/pdf`, both with body `{ raw: unknown[][], theme: string, mode: string }`.
  - Written artifact path: `<deckDir>/export/<name>-<theme>.<ext>`.

- [ ] **Step 1: Write the failing route test**

```ts
// packages/dsh-deck/tests/export-route.spec.ts
import { mkdtemp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { deckKey } from '../src/definition.ts'
import { exportPath, resolveExportTarget } from '../src/host/export-route.ts'

describe('resolveExportTarget', () => {
  it('accepts a key naming a real deck directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const directory = join(workspace, '.deck', 'launch')
    await mkdir(directory, { recursive: true })
    expect(resolveExportTarget(deckKey(directory))).toEqual({ directory, name: 'launch' })
  })

  it('rejects a key that decodes outside a .deck directory', () => {
    expect(resolveExportTarget(deckKey('/etc'))).toBeNull()
  })

  it('rejects a malformed key rather than decoding it', () => {
    expect(resolveExportTarget('not a key!!')).toBeNull()
  })
})

describe('exportPath', () => {
  it('names the artifact by deck and theme, inside the deck directory', () => {
    expect(exportPath('/w/.deck/launch', 'launch', 'radiant', 'pdf'))
      .toBe('/w/.deck/launch/export/launch-radiant.pdf')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/export-route.spec.ts`
Expected: FAIL — cannot resolve `../src/host/export-route.ts`.

- [ ] **Step 3: Implement the route module's pure helpers plus the handler**

```ts
// packages/dsh-deck/src/host/export-route.ts
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { decodeDeckKey, isDeckDirectory } from '../definition.ts'
import type { PreviewHostContext } from './preview-route.ts'

/** A validated export target: the deck's directory and its bare name. */
export interface ExportTarget {
  readonly directory: string
  readonly name: string
}

/**
 * Validate a URL key down to a real deck directory.
 *
 * Identical containment to the preview server's: decode, then require the
 * result to name a `<workspace>/.deck/<name>` directory. A crafted key
 * cannot walk out to an arbitrary path, which matters more here than for
 * preview because this route *writes*.
 * @param key - the `{key}` path segment, as produced by `deckKey`.
 * @returns the target, or null when the key does not name a deck.
 */
export function resolveExportTarget(key: string): ExportTarget | null {
  const directory = decodeDeckKey(key)
  if (directory === undefined || !isDeckDirectory(directory)) return null
  return { directory, name: basename(directory) }
}

/**
 * Where an exported artifact lands.
 *
 * Inside the deck directory rather than a workspace-level output folder, so a
 * deck stays one self-contained thing the model can list and reference; the
 * theme is in the filename because the same deck exports differently per
 * theme and overwriting would lose the comparison.
 * @param directory - the deck directory.
 * @param name - the deck name.
 * @param theme - the theme the export was rendered in.
 * @param extension - `html`, `pdf`, or `pptx`.
 * @returns the absolute artifact path.
 */
export function exportPath(directory: string, name: string, theme: string, extension: string): string {
  return join(directory, 'export', `${name}-${theme}.${extension}`)
}

/** The three formats this route serves, with their download content types. */
const CONTENT_TYPE: Record<string, string> = {
  html: 'text/html',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/**
 * Parse `{key}/{format}` out of a request path under the export prefix.
 * @param url - the request URL.
 * @param prefix - `${base}/@export`.
 * @returns the key and format, or null when the shape does not match.
 */
export function parseExportUrl(url: string, prefix: string): { key: string, format: string, query: URLSearchParams } | null {
  if (!url.startsWith(prefix)) return null
  const [path, search = ''] = url.slice(prefix.length).split('?', 2)
  const segments = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  if (segments.length !== 2) return null
  const [key, format] = segments
  if (!(format in CONTENT_TYPE)) return null
  return { key, format, query: new URLSearchParams(search) }
}

/** Read a JSON request body, bounded so a runaway post cannot exhaust memory. */
async function readJsonBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error(`export body exceeds ${limit} bytes`)
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Producers, injected so the route is testable without a real Vite build. */
export interface ExportProducers {
  html(directory: string, theme: string, mode: string): Promise<Buffer>
  pptx(raw: unknown[][], theme: string): Promise<Buffer>
  pdf(raw: unknown[][], theme: string): Promise<Buffer>
}

/**
 * Mount the three export endpoints under `${base}/@export`.
 *
 * A separate prefix route rather than a branch inside the preview handler:
 * the harness dispatches longest-prefix-wins, so this claims its own space
 * without the preview route having to know export exists. The `@` is load
 * bearing — `export` is a legal deck name, so a bare `export` prefix would
 * shadow a real deck.
 *
 * Each artifact is both written into the deck directory and streamed back as
 * a download: the write is what lets the model see the file, the stream is
 * what gets it to the user without a file hunt.
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - the mounted base path.
 * @param producers - the three format producers.
 */
export function mountExportRoute(
  ctx: PreviewHostContext,
  options: { readonly base: string },
  producers: ExportProducers,
): void {
  const prefix = `${options.base}/@export`
  ctx.effect(async () => ctx.webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      const parsed = parseExportUrl(req.url ?? '', prefix)
      if (parsed === null) { res.statusCode = 404; res.end(); return }
      const target = resolveExportTarget(parsed.key)
      if (target === null) { res.statusCode = 404; res.end(); return }
      try {
        const theme = parsed.query.get('theme') ?? 'midnight'
        const mode = parsed.query.get('mode') ?? 'dark'
        let bytes: Buffer
        if (parsed.format === 'html') {
          bytes = await producers.html(target.directory, theme, mode)
        } else {
          const body = await readJsonBody(req)
          if (typeof body !== 'object' || body === null || !Array.isArray((body as { raw?: unknown }).raw)) {
            res.statusCode = 400
            res.end('export body must be { raw: unknown[][], theme, mode }')
            return
          }
          const { raw, theme: bodyTheme } = body as { raw: unknown[][], theme?: string }
          const chosen = bodyTheme ?? theme
          bytes = parsed.format === 'pptx'
            ? await producers.pptx(raw, chosen)
            : await producers.pdf(raw, chosen)
        }
        const out = exportPath(target.directory, target.name, theme, parsed.format)
        await mkdir(join(target.directory, 'export'), { recursive: true })
        await writeFile(out, bytes)
        res.statusCode = 200
        res.setHeader('Content-Type', CONTENT_TYPE[parsed.format])
        res.setHeader('Content-Disposition', `attachment; filename="${target.name}-${theme}.${parsed.format}"`)
        res.end(bytes)
      } catch (error) {
        ctx.logger.warn('deck export failed: %s', error)
        res.statusCode = 500
        res.end(error instanceof Error ? error.message : 'export failed')
      }
    },
  }))
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/export-route.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Write the failing HTML producer test**

```ts
// packages/dsh-deck/tests/export-html.spec.ts
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { exportHtml } from '../src/export/html.ts'

describe('exportHtml', () => {
  it('builds one self-contained file with no external script or style refs', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const spec = resolveDeck({ name: 'launch', theme: 'midnight' }, workspace)
    await scaffoldDeck(spec)
    const html = (await exportHtml(spec.directory, 'midnight', 'dark')).toString('utf8')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).not.toMatch(/<script[^>]+src="\.?\//)
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="\.?\//)
    // the deck's own seeded title survives into the bundle
    expect(html).toContain('Launch')
  }, 120_000)
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/export-html.spec.ts`
Expected: FAIL — cannot resolve `../src/export/html.ts`.

- [ ] **Step 7: Add the dependency**

Run: `cd packages/dsh-deck && npm install --save vite-plugin-singlefile@^2.3.3`

- [ ] **Step 8: Implement the HTML producer**

```ts
// packages/dsh-deck/src/export/html.ts
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

const VENDORED_SOURCE = new URL('../../vendor/src/', import.meta.url)

/**
 * Build a deck into one self-contained HTML file.
 *
 * The deck's own `runtime/entry.ts` cannot be the build input: it loads
 * slides through `@vite-ignore` dynamic imports, which Rollup deliberately
 * does not follow, so a build over it produces a page that still requests
 * `/@dsh-deck/...` at view time and 404s offline. This generates an entry
 * that imports the deck's modules *statically*, by absolute path, so the
 * bundler can see them. That also means no `/@dsh-deck/` alias is needed —
 * `fs.allow` is a dev-server concern, not a build one — and containment
 * stays where the route already enforces it.
 *
 * Theme and mode come from the caller, not from `deck.json`, so the export
 * matches whatever the canvas is displaying. Exactly one theme is registered:
 * a single file has no switcher to serve, and registering one keeps one
 * theme's fonts inlined rather than all six.
 * @param directory - the deck directory.
 * @param theme - the theme id to render in.
 * @param mode - `light` or `dark`.
 * @returns the complete HTML file.
 */
export async function exportHtml(directory: string, theme: string, mode: string): Promise<Buffer> {
  const staging = await mkdtemp(join(tmpdir(), 'dsh-deck-html-'))
  try {
    const entry = join(staging, 'entry.ts')
    const page = join(staging, 'index.html')
    await writeFile(entry, `
import { deck } from ${JSON.stringify(fileURLToPath(new URL('framework/index.ts', VENDORED_SOURCE)))}
import { getTheme } from ${JSON.stringify(fileURLToPath(new URL('themes/index.ts', VENDORED_SOURCE)))}
import { slides } from ${JSON.stringify(join(directory, 'slides.ts'))}
const theme = ${JSON.stringify(theme)}
deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  themes: [getTheme(theme)],
  theme,
  mode: ${JSON.stringify(mode)},
}).start()
`, 'utf8')
    await writeFile(page, `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Deck</title></head>
<body><div id="deck"></div><script type="module" src="./entry.ts"></script></body></html>`, 'utf8')

    const outDir = join(staging, 'dist')
    await build({
      root: staging,
      logLevel: 'silent',
      plugins: [viteSingleFile()],
      build: { outDir, cssCodeSplit: false, assetsInlineLimit: 100_000_000, rollupOptions: { input: page } },
    })
    return await readFile(join(outDir, 'index.html'))
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
```

- [ ] **Step 9: Run the HTML test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/export-html.spec.ts`
Expected: 1 passing (may take 30-60s — a real Vite build runs).

- [ ] **Step 10: Mount the route**

In `packages/dsh-deck/src/host/preview-route.ts`, inside `mountPreviewRoute`'s effect (after `startPreviewServer`), add the export route registration by calling `mountExportRoute` from `src/index.ts` instead — keep `preview-route.ts` unchanged and add to `apply()` in `src/index.ts`:

```ts
import { mountExportRoute } from './host/export-route.ts'
import { exportHtml } from './export/html.ts'

// …inside apply(), after mountPreviewRoute(ctx, { workspace, base: config.base }):
mountExportRoute(ctx, { base: config.base }, {
  html: exportHtml,
  pptx: async () => { throw new Error('pptx export not yet implemented') },
  pdf: async () => { throw new Error('pdf export not yet implemented') },
})
```

- [ ] **Step 11: Typecheck, test, commit**

Run: `cd packages/dsh-deck && npm run typecheck && npm test`
Expected: all green.

```bash
git add packages/dsh-deck/src/export/html.ts packages/dsh-deck/src/host/export-route.ts \
        packages/dsh-deck/src/index.ts packages/dsh-deck/tests/export-route.spec.ts \
        packages/dsh-deck/tests/export-html.spec.ts packages/dsh-deck/package.json packages/dsh-deck/package-lock.json
git commit -m "feat(dsh-deck): export route with self-contained HTML export"
```

---

### Task 4: Theme switcher on the canvas

**Files:**
- Modify: `packages/dsh-deck/runtime/entry.ts`
- Modify: `packages/dsh-deck/src/client/canvas-state.ts`
- Modify: `packages/dsh-deck/src/client/canvas-controller.ts`
- Modify: `packages/dsh-deck/src/client/DeckOverlay.tsx`
- Modify: `packages/dsh-deck/tests/canvas-store.spec.ts`
- Create: `packages/dsh-deck/tests/deck-overlay-theme.spec.tsx`

**Interfaces:**
- Consumes: `CanvasState` from Task 0 (existing).
- Produces:
  - `CanvasState.theme: string | null` (displayed theme; null = the deck's authored theme)
  - `CanvasState.mode: 'light' | 'dark'`
  - `CanvasController.setTheme(theme: string): void`, `setMode(mode: 'light' | 'dark'): void`
  - `MIN_WIDTH` becomes 420.
  - `THEME_IDS: readonly string[]` exported from `canvas-state.ts` for the select.

- [ ] **Step 1: Write the failing state test**

Append to `packages/dsh-deck/tests/canvas-store.spec.ts`:

```ts
import { createCanvasController } from '../src/client/canvas-controller.ts'

describe('theme selection', () => {
  const view = { deckId: 'launch', route: '/deck/k/', slideCount: 3, theme: 'midnight' }
  const viewport = () => ({ width: 1600, height: 900 })

  it('starts with no override, so the deck shows its authored theme', () => {
    const c = createCanvasController(viewport)
    c.show(view)
    expect(c.store.getSnapshot().theme).toBeNull()
  })

  it('records a chosen theme without touching the deck value', () => {
    const c = createCanvasController(viewport)
    c.show(view)
    c.setTheme('radiant')
    const state = c.store.getSnapshot()
    expect(state.theme).toBe('radiant')
    expect(state.view?.theme).toBe('midnight')
  })

  it('keeps the chosen theme when the canvas is retargeted to another deck', () => {
    const c = createCanvasController(viewport)
    c.show(view)
    c.setTheme('radiant')
    c.show({ ...view, deckId: 'other', theme: 'commit' })
    expect(c.store.getSnapshot().theme).toBe('radiant')
  })

  it('defaults the mode to dark and records a change', () => {
    const c = createCanvasController(viewport)
    expect(c.store.getSnapshot().mode).toBe('dark')
    c.setMode('light')
    expect(c.store.getSnapshot().mode).toBe('light')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/canvas-store.spec.ts`
Expected: FAIL — `theme` is undefined, `setTheme` is not a function.

- [ ] **Step 3: Extend the state**

In `packages/dsh-deck/src/client/canvas-state.ts`:

```ts
/** The six themes the framework ships, in the order the switcher lists them. */
export const THEME_IDS = ['midnight', 'protocol', 'primer', 'radiant', 'commit', 'octo-glass'] as const

/** Light or dark, as the framework's theme contract defines them. */
export type CanvasMode = 'light' | 'dark'
```

Add to the `CanvasState` interface:

```ts
  /**
   * The theme the reader picked, or null to show the deck's authored one.
   *
   * Preview-only: this never writes `deck.json`, so a casual click cannot
   * silently rewrite what the agent authored. Exports follow this value, so
   * the reader can compare all six and export the one they chose.
   */
  theme: string | null
  /** Light or dark, applied on top of whichever theme is showing. */
  mode: CanvasMode
```

Update `initialCanvas`:

```ts
export function initialCanvas(): CanvasState {
  return { view: null, open: false, geometry: { x: 0, y: 0, width: 0, height: 0 }, theme: null, mode: 'dark' }
}
```

Change `MIN_WIDTH`:

```ts
/**
 * Smallest useful canvas. Raised from 320 when the header gained a theme
 * switcher and an export menu: 320 was already marginal for a readable 16:9
 * frame and cannot hold five controls.
 */
export const MIN_WIDTH = 420
```

- [ ] **Step 4: Add the controller writes**

In `packages/dsh-deck/src/client/canvas-controller.ts`, add to the `CanvasController` interface and the returned object:

```ts
  setTheme: (theme: string) => void
  setMode: (mode: CanvasMode) => void
```

```ts
    setTheme: (theme) => { commit((draft) => { draft.theme = theme }) },
    setMode: (mode) => { commit((draft) => { draft.mode = mode }) },
```

Import `CanvasMode` alongside the existing imports.

- [ ] **Step 5: Run the state test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/canvas-store.spec.ts`
Expected: all passing, including the 4 new ones.

- [ ] **Step 6: Register all six themes in the deck runtime**

In `packages/dsh-deck/runtime/entry.ts`, change the import and the `deck(...)` options:

```ts
import { getTheme, themeList } from 'octodeck/themes'
```

```ts
deck(slides, {
  mount: '#deck',
  hashRouting: true,
  showProgress: true,
  // All six are registered, not just the authored one, so the canvas header
  // can switch between them. This costs nothing: a theme's CSS is loaded
  // lazily on first use (`load: () => import(...)` in src/themes/index.ts),
  // so an unselected theme never fetches its stylesheet or its fonts.
  // `deck.ts` reads `?theme=` and `?mode=` from the URL at startup, which is
  // how both the canvas and the export extractor select one.
  themes: themeList,
  theme: meta.theme,
}).start()
```

Note `getTheme` is no longer used — remove it from the import if the linter flags it.

- [ ] **Step 7: Write the failing overlay test**

```tsx
// packages/dsh-deck/tests/deck-overlay-theme.spec.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { DeckOverlay } from '../src/client/DeckOverlay.tsx'
import { initialCanvas, type CanvasState } from '../src/client/canvas-state.ts'

function harness(overrides: Partial<CanvasState> = {}) {
  const state: CanvasState = {
    ...initialCanvas(),
    open: true,
    view: { deckId: 'launch', route: '/deck/k/', slideCount: 3, theme: 'midnight' },
    geometry: { x: 0, y: 0, width: 800, height: 500 },
    ...overrides,
  }
  return { state, useDeckCanvas: <S,>(select: (s: CanvasState) => S) => select(state) }
}

describe('DeckOverlay theme switcher', () => {
  it('lists all six themes and preselects the deck’s authored one', () => {
    const { useDeckCanvas } = harness()
    render(<DeckOverlay useDeckCanvas={useDeckCanvas} close={vi.fn()} place={vi.fn()}
      setTheme={vi.fn()} setMode={vi.fn()} startExport={vi.fn()} />)
    const select = screen.getByLabelText('Theme') as HTMLSelectElement
    expect(select.value).toBe('midnight')
    expect(select.options).toHaveLength(6)
  })

  it('reports a chosen theme', () => {
    const setTheme = vi.fn()
    const { useDeckCanvas } = harness()
    render(<DeckOverlay useDeckCanvas={useDeckCanvas} close={vi.fn()} place={vi.fn()}
      setTheme={setTheme} setMode={vi.fn()} startExport={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Theme'), { target: { value: 'radiant' } })
    expect(setTheme).toHaveBeenCalledWith('radiant')
  })

  it('drives the frame through ?theme= and ?mode= so the deck applies it', () => {
    const { useDeckCanvas } = harness({ theme: 'radiant', mode: 'light' })
    render(<DeckOverlay useDeckCanvas={useDeckCanvas} close={vi.fn()} place={vi.fn()}
      setTheme={vi.fn()} setMode={vi.fn()} startExport={vi.fn()} />)
    const frame = screen.getByTitle('launch') as HTMLIFrameElement
    expect(frame.src).toContain('theme=radiant')
    expect(frame.src).toContain('mode=light')
  })
})
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/deck-overlay-theme.spec.tsx`
Expected: FAIL — no element labelled `Theme`.

- [ ] **Step 9: Add the switcher to the overlay**

In `packages/dsh-deck/src/client/DeckOverlay.tsx`, extend `DeckOverlayProps`:

```ts
  readonly setTheme: (theme: string) => void
  readonly setMode: (mode: CanvasMode) => void
  readonly startExport: (format: 'html' | 'pdf' | 'pptx') => void
```

Read the new facts and compute the frame URL:

```tsx
  const theme = useDeckCanvas(state => state.theme)
  const mode = useDeckCanvas(state => state.mode)
```

```tsx
  const shown = theme ?? view.theme
  // The deck reads `?theme=` and `?mode=` at startup (src/framework/deck.ts),
  // so changing them re-renders the frame in the chosen theme with no
  // message channel between the canvas and the deck.
  const frameSrc = `${view.route}?theme=${encodeURIComponent(shown)}&mode=${mode}`
```

Insert into the title bar, before `Open in tab`:

```tsx
        <select
          style={SELECT}
          aria-label="Theme"
          value={shown}
          onPointerDown={stopDrag}
          onChange={event => { setTheme(event.target.value) }}
        >
          {THEME_IDS.map(id => <option key={id} value={id}>{id}</option>)}
        </select>
```

and use `frameSrc` for the iframe's `src`. Add the style:

```ts
const SELECT: CSSProperties = {
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6,
  color: 'inherit',
  font: 'inherit',
  padding: '2px 4px',
  maxWidth: 110,
}
```

Also give `TITLE` an ellipsis so a long deck name yields space to the controls:

```ts
const TITLE: CSSProperties = {
  flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  color: 'var(--dsw-color-text-primary, #e6e9ef)', fontWeight: 500,
}
```

Import `THEME_IDS` and `CanvasMode` from `./canvas-state.ts`.

- [ ] **Step 10: Wire the new callbacks in the client registration**

In `packages/dsh-deck/src/client/index.ts`, extend the overlay's `inject`:

```ts
    inject: () => ({
      hooks: { deckCanvas: canvas.store },
      close: canvas.close,
      place: canvas.place,
      setTheme: canvas.setTheme,
      setMode: canvas.setMode,
      startExport: exportActions.start,
    }),
```

For this task, define a temporary no-op so the registration typechecks; Task 6 replaces it:

```ts
const exportActions = { start: (_format: 'html' | 'pdf' | 'pptx') => {} }
```

- [ ] **Step 11: Run the overlay test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/deck-overlay-theme.spec.tsx`
Expected: 3 passing.

- [ ] **Step 12: Typecheck, full suite, commit**

Run: `cd packages/dsh-deck && npm run typecheck && npm test`
Expected: all green.

```bash
git add packages/dsh-deck/runtime/entry.ts packages/dsh-deck/src/client packages/dsh-deck/tests
git commit -m "feat(dsh-deck): theme switcher on the canvas header"
```

---

### Task 5: Parameterize WALKER and build the hidden-iframe extractor

**Files:**
- Modify: `scripts/pptx/extract.ts` (parameterize `WALKER`, export it and a new `slidesFromRaw`)
- Create: `packages/dsh-deck/src/client/extract-deck.ts`
- Create: `packages/dsh-deck/tests/extract-deck.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `WALKER(doc: Document): unknown[]` — exported from `scripts/pptx/extract.ts` (and its vendored copy)
  - `slidesFromRaw(raw: unknown[][], bg: Paint): SlideIR[]` — exported from the same file
  - `extractDeckRaw(options: ExtractOptions): Promise<unknown[][]>` in the client, where
    `ExtractOptions = { route: string, slideCount: number, theme: string, mode: string, signal?: AbortSignal, onProgress?: (done: number, total: number) => void, container?: HTMLElement }`

- [ ] **Step 1: Parameterize `WALKER` in `scripts/pptx/extract.ts`**

Change the signature at line 20 and every global DOM reference inside it:

```ts
/**
 * Browser-side walker. Self-contained (no closures) — Playwright stringifies
 * it, and the harness canvas calls it directly against a same-origin iframe's
 * document. The document is a parameter for exactly that second caller: in an
 * iframe the *parent's* `document` is the wrong one, and reaching it through
 * `contentWindow.eval` would be both an eval and CSP-fragile.
 * @param doc - the document to measure.
 * @returns a neutral, JSON-serializable item tree.
 */
export function WALKER(doc: Document): any[] {
```

Inside the body, replace:
- `document.querySelectorAll` → `doc.querySelectorAll`
- `document.createRange()` → `doc.createRange()`
- `getComputedStyle(` → `doc.defaultView!.getComputedStyle(`

There are three `getComputedStyle` call sites (in `textItems`, `emitBox`, and the SVG branch) — change all of them. Search with `grep -n "getComputedStyle\|document\." scripts/pptx/extract.ts` and confirm none remain unqualified inside `WALKER`.

- [ ] **Step 2: Update the Playwright call site**

At line 258, change:

```ts
    const raw = await page.evaluate(WALKER)
```
to
```ts
    const raw = await page.evaluate(WALKER, undefined)
```

Playwright stringifies the function and calls it with the passed argument; since `document` is not serializable, wrap instead:

```ts
    const raw = await page.evaluate(`(${WALKER.toString()})(document)`)
```

- [ ] **Step 3: Extract the Node-side mapping into a reusable export**

Add to `scripts/pptx/extract.ts`:

```ts
/**
 * Convert raw walker items into Scene IR.
 *
 * Split out from {@link extractDeck} because the harness plugin runs the
 * walker in the browser it already has and posts the raw items to Node — the
 * mapping is not browser knowledge, and keeping it here keeps `color.ts` out
 * of a browser bundle.
 * @param raw - one array of walker items per slide, in slide order.
 * @param bg - the resolved theme background, applied to every slide.
 * @returns one `SlideIR` per input slide.
 */
export function slidesFromRaw(raw: unknown[][], bg: Paint): SlideIR[] {
  return raw.map((items, i) => ({
    name: `Slide ${i + 1}`,
    bg,
    shapes: (items as any[]).map(mapItem).filter(Boolean) as Shape[],
  }))
}
```

and rewrite the tail of `extractDeck` to use it:

```ts
  const raw: unknown[][] = []
  for (let n = 1; n <= count; n++) {
    await page.goto(`${deckUrl}?theme=${themeId}&_=${n}#/${n}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document as any).fonts.ready)
    await page.waitForTimeout(350)
    raw.push(await page.evaluate(`(${WALKER.toString()})(document)`) as unknown[])
  }
  await browser.close()
  return slidesFromRaw(raw, bg)
```

- [ ] **Step 4: Verify the CLI export is unchanged in behaviour**

Run: `npm run dev` in one shell, then:
`npm run build:pptx -- octo-glass --deck exporttest`
Expected: same slide count and a file that opens correctly — this refactor must not change output.

- [ ] **Step 5: Re-vendor**

Run: `cd packages/dsh-deck && npm run vendor`
Expected: `vendor/pptx/extract.ts` now carries the parameterized `WALKER`.

- [ ] **Step 6: Write the failing extractor test**

```ts
// packages/dsh-deck/tests/extract-deck.spec.ts
import { describe, expect, it, vi } from 'vitest'
import { extractDeckRaw } from '../src/client/extract-deck.ts'

/**
 * jsdom does not load iframe content, so the driver is exercised with a
 * stubbed walker and a container whose appended iframes are resolved
 * immediately. The walker itself has no layout in jsdom (every rect is zero),
 * so its correctness is verified by looking at real exports, not here.
 */
function fakeContainer() {
  const container = document.createElement('div')
  const observer = new MutationObserver(() => {})
  // Resolve each iframe's load as soon as its src is assigned.
  const patch = (frame: HTMLIFrameElement) => {
    Object.defineProperty(frame, 'contentDocument', {
      configurable: true,
      get: () => ({ fonts: { ready: Promise.resolve() } }),
    })
    queueMicrotask(() => frame.dispatchEvent(new Event('load')))
  }
  const original = container.appendChild.bind(container)
  container.appendChild = ((node: Node) => {
    const result = original(node)
    if (node instanceof HTMLIFrameElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')?.set
      Object.defineProperty(node, 'src', {
        configurable: true,
        set(value: string) { setter?.call(node, value); patch(node) },
        get: () => '',
      })
    }
    return result
  }) as typeof container.appendChild
  observer.disconnect()
  return container
}

describe('extractDeckRaw', () => {
  it('walks every slide once, in order', async () => {
    const walker = vi.fn((_doc: Document) => [{ t: 'rect' }])
    const raw = await extractDeckRaw({
      route: '/deck/k/', slideCount: 3, theme: 'radiant', mode: 'dark',
      container: fakeContainer(), walker, settleMs: 0,
    })
    expect(raw).toHaveLength(3)
    expect(walker).toHaveBeenCalledTimes(3)
  })

  it('reports progress for each completed slide', async () => {
    const onProgress = vi.fn()
    await extractDeckRaw({
      route: '/deck/k/', slideCount: 2, theme: 'radiant', mode: 'dark',
      container: fakeContainer(), walker: () => [], settleMs: 0, onProgress,
    })
    expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
  })

  it('removes the iframe even when the walker throws', async () => {
    const container = fakeContainer()
    await expect(extractDeckRaw({
      route: '/deck/k/', slideCount: 1, theme: 'radiant', mode: 'dark',
      container, walker: () => { throw new Error('boom') }, settleMs: 0,
    })).rejects.toThrow('boom')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('fails with a named cause when the frame is cross-origin', async () => {
    const container = document.createElement('div')
    const original = container.appendChild.bind(container)
    container.appendChild = ((node: Node) => {
      const result = original(node)
      if (node instanceof HTMLIFrameElement) {
        Object.defineProperty(node, 'contentDocument', { configurable: true, get: () => null })
        Object.defineProperty(node, 'src', { configurable: true, set() { queueMicrotask(() => node.dispatchEvent(new Event('load'))) }, get: () => '' })
      }
      return result
    }) as typeof container.appendChild
    await expect(extractDeckRaw({
      route: '/deck/k/', slideCount: 1, theme: 'radiant', mode: 'dark',
      container, walker: () => [], settleMs: 0,
    })).rejects.toThrow(/cross-origin/i)
  })

  it('stops early when the caller aborts', async () => {
    const controller = new AbortController()
    const walker = vi.fn(() => { controller.abort(); return [] })
    await expect(extractDeckRaw({
      route: '/deck/k/', slideCount: 5, theme: 'radiant', mode: 'dark',
      container: fakeContainer(), walker, settleMs: 0, signal: controller.signal,
    })).rejects.toThrow(/abort/i)
    expect(walker).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/extract-deck.spec.ts --environment jsdom`
Expected: FAIL — cannot resolve `../src/client/extract-deck.ts`.

- [ ] **Step 8: Implement the driver**

```ts
// packages/dsh-deck/src/client/extract-deck.ts

/** What the extractor needs to walk one deck. */
export interface ExtractOptions {
  /** The deck's preview route, e.g. `/deck/<key>/`. */
  readonly route: string
  readonly slideCount: number
  readonly theme: string
  readonly mode: string
  /** Cancels the run between slides. */
  readonly signal?: AbortSignal
  /** Called after each slide is walked. */
  readonly onProgress?: (done: number, total: number) => void
  /** Where the hidden frame is mounted; defaults to `document.body`. */
  readonly container?: HTMLElement
  /** The walker; injected so the driver is testable without layout. */
  readonly walker?: (doc: Document) => unknown[]
  /** Settle delay after fonts resolve, matching the proven CLI extractor. */
  readonly settleMs?: number
}

/**
 * The deck's design canvas. The frame must be exactly this size: the deck
 * scales itself by `min(innerWidth/1280, innerHeight/720)`
 * (src/framework/deck.ts), and the walker measures `getBoundingClientRect()`,
 * so any other size yields a silently scaled — and therefore wrong — IR.
 */
const CANVAS_WIDTH = 1280
const CANVAS_HEIGHT = 720

/**
 * Walk every slide of a deck through a hidden, exactly-sized iframe.
 *
 * This is the whole reason the export needs no headless browser: the deck is
 * already rendering in a browser, and the canvas iframe is same-origin, so
 * the live DOM can be measured directly. The visible canvas is deliberately
 * not used — it is whatever size the reader dragged it to, which would scale
 * every measurement.
 *
 * One reload per slide rather than hash navigation: a hash change re-runs
 * neither entry animations nor font settling, and the CLI extractor this
 * mirrors has always reloaded.
 * @param options - the deck, the theme to render in, and the driver's seams.
 * @returns one array of raw walker items per slide, in slide order.
 * @throws {Error} when the frame is cross-origin, the caller aborts, or the walker throws.
 */
export async function extractDeckRaw(options: ExtractOptions): Promise<unknown[][]> {
  const { route, slideCount, theme, mode, signal, onProgress } = options
  const container = options.container ?? document.body
  const walk = options.walker ?? defaultWalker()
  const settleMs = options.settleMs ?? 350

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    `width:${CANVAS_WIDTH}px`, `height:${CANVAS_HEIGHT}px`,
    'opacity:0', 'pointer-events:none', 'border:0', 'z-index:-1',
  ].join(';')
  container.appendChild(frame)

  try {
    const raw: unknown[][] = []
    for (let n = 1; n <= slideCount; n++) {
      signal?.throwIfAborted()
      const loaded = new Promise<void>((resolve, reject) => {
        frame.addEventListener('load', () => { resolve() }, { once: true })
        frame.addEventListener('error', () => { reject(new Error(`slide ${n} failed to load`)) }, { once: true })
      })
      // A cache-busting param per slide, matching the CLI extractor: without
      // it a same-URL assignment with only the hash changed does not reload.
      frame.src = `${route}?theme=${encodeURIComponent(theme)}&mode=${encodeURIComponent(mode)}&_=${n}#/${n}`
      await loaded
      const doc = frame.contentDocument
      if (doc === null) {
        throw new Error(
          'deck frame is cross-origin, so its slides cannot be measured for export. '
          + 'Export renders the deck the browser is already showing, which requires the '
          + 'deck route and the harness UI to share an origin.',
        )
      }
      await doc.fonts?.ready
      if (settleMs > 0) await new Promise(resolve => setTimeout(resolve, settleMs))
      signal?.throwIfAborted()
      raw.push(walk(doc))
      onProgress?.(n, slideCount)
    }
    return raw
  } finally {
    frame.remove()
  }
}

/**
 * Resolve the real walker lazily, so importing this module in a test (or in
 * any environment without the vendored pipeline) costs nothing.
 * @returns the vendored `WALKER`.
 */
function defaultWalker(): (doc: Document) => unknown[] {
  // Bundled by tsdown into the client artifact; see tsdown.config.ts's
  // alwaysBundle rule for anything outside the shell's module table.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WALKER } = require('../../vendor/pptx/extract.ts') as { WALKER: (doc: Document) => unknown[] }
  return WALKER
}
```

Note: if `require` is unavailable in the client bundle format, replace `defaultWalker` with a top-level `import { WALKER } from '../../vendor/pptx/extract.ts'` and pass it through — verify which works when the bundle builds in Step 10.

- [ ] **Step 9: Run the extractor test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/extract-deck.spec.ts --environment jsdom`
Expected: 5 passing.

- [ ] **Step 10: Verify the client bundle still builds**

Run: `cd packages/dsh-deck && npx tsdown`
Expected: writes `lib/client.js` with no unresolved-import errors. If `require` failed, switch to the static import as noted and re-run.

- [ ] **Step 11: Typecheck, full suite, commit**

Run: `cd packages/dsh-deck && npm run typecheck && npm test`

```bash
git add scripts/pptx/extract.ts packages/dsh-deck/src/client/extract-deck.ts \
        packages/dsh-deck/tests/extract-deck.spec.ts packages/dsh-deck/vendor
git commit -m "feat(dsh-deck): parameterize WALKER and add the hidden-iframe extractor"
```

---

### Task 6: PPTX export, end to end

**Files:**
- Create: `packages/dsh-deck/src/export/pptx.ts`
- Create: `packages/dsh-deck/src/export/fonts.ts`
- Create: `packages/dsh-deck/src/client/export-actions.ts`
- Create: `packages/dsh-deck/tests/export-pptx.spec.ts`
- Modify: `packages/dsh-deck/src/index.ts` (wire the real producer)
- Modify: `packages/dsh-deck/src/client/index.ts` (real export actions)
- Modify: `packages/dsh-deck/src/client/canvas-state.ts` + `canvas-controller.ts` (export status)
- Modify: `packages/dsh-deck/src/client/DeckOverlay.tsx` (Export menu + progress)

**Interfaces:**
- Consumes: `zipSync` (Task 1), vendored pipeline (Task 2), `ExportProducers` (Task 3), `extractDeckRaw` (Task 5).
- Produces:
  - `exportPptx(raw: unknown[][], theme: string): Promise<Buffer>`
  - `embeddableFonts(themeId: string): Promise<{ fonts: EmbedFont[], warning: string | null }>`
  - `CanvasState.exportStatus: { format: string, done: number, total: number } | null`
  - `CanvasState.exportError: string | null`
  - `CanvasController.startExport(format)`, `.exportProgress(done, total)`, `.exportDone(error?)`

- [ ] **Step 1: Write the failing pptx test**

```ts
// packages/dsh-deck/tests/export-pptx.spec.ts
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { exportPptx } from '../src/export/pptx.ts'

function entryNames(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28)
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'))
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return names
}

/** One slide with a single text item, in the shape WALKER emits. */
const RAW = [[{
  t: 'text', x: 100, y: 80, w: 400, h: 40,
  text: 'Hello', font: 'Geist', sizePx: 32, weight: 600, color: 'rgb(255, 255, 255)', italic: false, spacingPx: 0,
}]]

describe('exportPptx', () => {
  it('packages a presentation with one slide part per input slide', async () => {
    const names = entryNames(await exportPptx(RAW, 'octo-glass'))
    expect(names[0]).toBe('[Content_Types].xml')
    expect(names).toContain('ppt/presentation.xml')
    expect(names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toHaveLength(1)
  })

  it('carries the slide text into the OOXML', async () => {
    const buf = await exportPptx(RAW, 'octo-glass')
    const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
    let at = buf.readUInt32LE(eocd + 16)
    const count = buf.readUInt16LE(eocd + 10)
    let found = ''
    for (let i = 0; i < count; i++) {
      const nameLen = buf.readUInt16LE(at + 28)
      const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
      const local = buf.readUInt32LE(at + 42)
      if (name === 'ppt/slides/slide1.xml') {
        const compSize = buf.readUInt32LE(local + 18)
        const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
        found = inflateRawSync(buf.subarray(start, start + compSize)).toString('utf8')
      }
      at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
    }
    expect(found).toContain('Hello')
  })

  it('rejects an unknown theme rather than exporting a mis-themed deck', async () => {
    await expect(exportPptx(RAW, 'no-such-theme')).rejects.toThrow(/theme/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/export-pptx.spec.ts`
Expected: FAIL — cannot resolve `../src/export/pptx.ts`.

- [ ] **Step 3: Implement font resolution**

```ts
// packages/dsh-deck/src/export/fonts.ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { EmbedFont } from '../../vendor/pptx/ooxml.ts'

const FONT_DIR = new URL('../../vendor/pptx/fonts/', import.meta.url)

/**
 * Which TTF files back each family, named exactly as `extract.ts`'s
 * `fontFace` names the run's typeface, so PowerPoint picks the real weight
 * instead of synthesizing a too-heavy bold.
 */
const VARIANTS: Record<string, [string, string][]> = {
  'Geist': [['Geist', 'Geist-Regular.ttf'], ['Geist Medium', 'Geist-Medium.ttf'], ['Geist SemiBold', 'Geist-SemiBold.ttf']],
  'Geist Mono': [['Geist Mono', 'GeistMono-Regular.ttf'], ['Geist Mono Medium', 'GeistMono-Medium.ttf']],
  'Switzer': [['Switzer', 'Switzer-Regular.ttf'], ['Switzer Medium', 'Switzer-Medium.ttf'], ['Switzer Semibold', 'Switzer-Semibold.ttf'], ['Switzer Bold', 'Switzer-Bold.ttf']],
  'Inter': [['Inter', 'Inter-Regular.ttf'], ['Inter Medium', 'Inter-Medium.ttf'], ['Inter SemiBold', 'Inter-SemiBold.ttf'], ['Inter Bold', 'Inter-Bold.ttf']],
}

/**
 * Load the embeddable faces a theme asks for.
 *
 * A face with no vendored TTF does not fail the export — the deck still
 * exports, with the consumer substituting a fallback — but the caller gets a
 * warning naming it, because a silently substituted typeface is the kind of
 * defect nobody notices until a presentation is on a projector. Cabinet
 * Grotesk is the known gap: it is Fontshare-licensed, so it is not
 * redistributed here.
 * @param embed - the family names the resolved theme wants embedded.
 * @returns the loaded faces and a warning naming any that were unavailable.
 */
export async function embeddableFonts(embed: readonly string[]): Promise<{ fonts: EmbedFont[], warning: string | null }> {
  const fonts: EmbedFont[] = []
  const missing: string[] = []
  for (const family of embed) {
    const variants = VARIANTS[family]
    if (variants === undefined) { missing.push(family); continue }
    for (const [typeface, file] of variants) {
      try {
        fonts.push({ typeface, regular: await readFile(fileURLToPath(new URL(file, FONT_DIR))) })
      } catch {
        missing.push(typeface)
      }
    }
  }
  return {
    fonts,
    warning: missing.length === 0
      ? null
      : `not embedded (no bundled TTF): ${missing.join(', ')} — viewers will substitute a fallback face`,
  }
}
```

- [ ] **Step 4: Implement the pptx producer**

```ts
// packages/dsh-deck/src/export/pptx.ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { slidesFromRaw } from '../../vendor/pptx/extract.ts'
import { buildPptx } from '../../vendor/pptx/ooxml.ts'
import { resolveTheme } from '../../vendor/pptx/theme.ts'
import { embeddableFonts } from './fonts.ts'
import { zipSync } from './zip.ts'

const BACKDROPS = new URL('../../vendor/pptx/backdrops/', import.meta.url)

/**
 * Build a `.pptx` from raw walker items.
 *
 * The browser measured the deck and posted the items; everything from here is
 * pure Node. Backdrops for "rich" themes are pre-baked PNGs shipped in the
 * package rather than screenshots taken now — that is what keeps this path
 * free of a headless browser.
 * @param raw - one array of walker items per slide, in slide order.
 * @param themeId - the theme the deck was displayed in.
 * @returns the packaged presentation.
 * @throws {Error} when `themeId` is not a theme the snapshot knows.
 */
export async function exportPptx(raw: unknown[][], themeId: string): Promise<Buffer> {
  let theme: ReturnType<typeof resolveTheme>
  try {
    theme = resolveTheme(themeId)
  } catch (cause) {
    throw new Error(`unknown theme ${JSON.stringify(themeId)}`, { cause })
  }
  const slides = slidesFromRaw(raw, theme.color.bg)
  const backdrop = theme.backdrop.rich
    ? await readFile(fileURLToPath(new URL(`${themeId}.png`, BACKDROPS))).catch(() => undefined)
    : undefined
  const { fonts } = await embeddableFonts(theme.font.embed)
  return zipSync(buildPptx(slides, theme, backdrop, fonts) as Record<string, string | Uint8Array>)
}
```

Note: confirm `resolveTheme` throws on an unknown id; if it silently falls back, add an explicit guard against the snapshot's keys before calling it.

- [ ] **Step 5: Run the pptx test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/export-pptx.spec.ts`
Expected: 3 passing.

- [ ] **Step 6: Add export status to the canvas state**

In `canvas-state.ts`, add to `CanvasState`:

```ts
  /** The export in flight, or null when none is running. */
  exportStatus: { format: string, done: number, total: number } | null
  /** The last export failure, shown in the header until the next attempt. */
  exportError: string | null
```

and to `initialCanvas()`: `exportStatus: null, exportError: null`.

In `canvas-controller.ts`, add:

```ts
    startExport: (format: string, total: number) => {
      commit((draft) => { draft.exportStatus = { format, done: 0, total }; draft.exportError = null })
    },
    exportProgress: (done: number, total: number) => {
      commit((draft) => {
        if (draft.exportStatus !== null) draft.exportStatus = { ...draft.exportStatus, done, total }
      })
    },
    exportDone: (error?: string) => {
      commit((draft) => { draft.exportStatus = null; draft.exportError = error ?? null })
    },
```

with matching entries on the `CanvasController` interface.

- [ ] **Step 7: Implement the client export actions**

```ts
// packages/dsh-deck/src/client/export-actions.ts
import type { CanvasController } from './canvas-controller.ts'
import { extractDeckRaw } from './extract-deck.ts'
import type { DeckViewData } from './deck-view.ts'

/** The formats the header offers. */
export type ExportFormat = 'html' | 'pdf' | 'pptx'

/**
 * Hand the finished bytes to the browser as a download.
 *
 * The route also writes the artifact into the deck directory — this is the
 * other half of the delivery, so the reader does not have to go find it.
 * @param blob - the response body.
 * @param filename - the name to save under.
 */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * Run one export from the canvas.
 *
 * HTML needs no measurement, so it is a plain navigation to the route and
 * works even while an extraction is running. PPTX and PDF walk the deck in a
 * hidden frame first, then post the raw items — the browser measures, Node
 * assembles.
 * @param controller - the canvas controller, for progress and errors.
 * @param view - the deck being exported.
 * @param theme - the displayed theme, which the export follows.
 * @param mode - the displayed light/dark mode.
 * @param format - which file to produce.
 */
export async function runExport(
  controller: CanvasController,
  view: DeckViewData,
  theme: string,
  mode: string,
  format: ExportFormat,
): Promise<void> {
  // `route` is `${base}/${key}/`; the export route is a sibling of the deck
  // key under the same base, at `${base}/@export/${key}/${format}`.
  const trimmed = view.route.replace(/\/+$/, '')
  const key = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const base = trimmed.slice(0, trimmed.lastIndexOf('/'))
  const query = `theme=${encodeURIComponent(theme)}&mode=${encodeURIComponent(mode)}`
  const endpoint = `${base}/@export/${key}/${format}?${query}`

  controller.startExport(format, view.slideCount)
  try {
    let response: Response
    if (format === 'html') {
      response = await fetch(endpoint)
    } else {
      const raw = await extractDeckRaw({
        route: view.route,
        slideCount: view.slideCount,
        theme,
        mode,
        onProgress: (done, total) => { controller.exportProgress(done, total) },
      })
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw, theme, mode }),
      })
    }
    if (!response.ok) throw new Error(await response.text() || `export failed (${response.status})`)
    download(await response.blob(), `${view.deckId}-${theme}.${format}`)
    controller.exportDone()
  } catch (error) {
    controller.exportDone(error instanceof Error ? error.message : String(error))
  }
}
```

- [ ] **Step 8: Add the Export menu to the header**

In `DeckOverlay.tsx`, read the two new facts and render either the menu or the progress:

```tsx
  const exportStatus = useDeckCanvas(state => state.exportStatus)
  const exportError = useDeckCanvas(state => state.exportError)
  const [menuOpen, setMenuOpen] = useState(false)
```

Replace the space before `Open in tab` with:

```tsx
        {exportStatus !== null
          ? <span style={PROGRESS}>{exportStatus.format.toUpperCase()} · slide {exportStatus.done}/{exportStatus.total}</span>
          : (
            <span style={{ position: 'relative' }}>
              <button type="button" style={BUTTON} aria-label="Export" aria-expanded={menuOpen}
                onPointerDown={stopDrag} onClick={() => { setMenuOpen(open => !open) }}>Export</button>
              {menuOpen && (
                <span style={MENU} role="menu">
                  {(['html', 'pdf', 'pptx'] as const).map(format => (
                    <button key={format} type="button" role="menuitem" style={MENU_ITEM}
                      onPointerDown={stopDrag}
                      onClick={() => { setMenuOpen(false); startExport(format) }}>
                      {format.toUpperCase()}
                    </button>
                  ))}
                </span>
              )}
            </span>
          )}
```

and after the iframe, an error line:

```tsx
      {exportError !== null && <div style={ERROR} role="alert">{exportError}</div>}
```

Styles:

```ts
const PROGRESS: CSSProperties = { fontVariantNumeric: 'tabular-nums', opacity: 0.85 }

const MENU: CSSProperties = {
  position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 1,
  display: 'flex', flexDirection: 'column', minWidth: 90,
  background: 'var(--dsw-color-bg-elevated, #14161a)',
  border: '1px solid var(--dsw-color-border, #2a2e35)',
  borderRadius: 6, overflow: 'hidden',
  boxShadow: '0 8px 24px rgb(0 0 0 / 35%)',
}

const MENU_ITEM: CSSProperties = {
  background: 'transparent', border: 0, color: 'inherit', font: 'inherit',
  cursor: 'pointer', padding: '6px 12px', textAlign: 'left',
}

const ERROR: CSSProperties = {
  padding: '6px 12px', fontSize: 12,
  color: 'var(--dsw-color-text-danger, #f87171)',
  borderTop: '1px solid var(--dsw-color-border, #2a2e35)',
}
```

Import `useState` from react.

- [ ] **Step 9: Wire the real actions and producer**

In `src/client/index.ts`, replace the Task 4 placeholder:

```ts
    inject: () => ({
      hooks: { deckCanvas: canvas.store },
      close: canvas.close,
      place: canvas.place,
      setTheme: canvas.setTheme,
      setMode: canvas.setMode,
      startExport: (format: ExportFormat) => {
        const state = canvas.store.getSnapshot()
        if (state.view === null) return
        void runExport(canvas, state.view, state.theme ?? state.view.theme, state.mode, format)
      },
    }),
```

In `src/index.ts`, replace the pptx thrower:

```ts
  pptx: exportPptx,
```

- [ ] **Step 10: Typecheck, full suite, commit**

Run: `cd packages/dsh-deck && npm run typecheck && npm test`

```bash
git add packages/dsh-deck/src packages/dsh-deck/tests
git commit -m "feat(dsh-deck): PPTX export from the canvas"
```

- [ ] **Step 11: Verify by looking**

Start the harness with the plugin mounted, create a deck, open the canvas, and export PPTX in two different themes. Open both files. Confirm: correct slide count, text is real text, the theme's background and colours match the live deck.

---

### Task 7: PDF writer — object primitives

**Files:**
- Create: `packages/dsh-deck/src/export/pdf/objects.ts`
- Create: `packages/dsh-deck/tests/pdf-objects.spec.ts`

**Interfaces:**
- Produces:
  - `class PdfBuilder { add(body: string | Buffer): number; stream(dict: string, data: Buffer | string): number; build(rootRef: number): Buffer }`
  - `pdfString(text: string): string` — escapes `(`, `)`, `\` for literal strings.

- [ ] **Step 1: Write the failing test**

```ts
// packages/dsh-deck/tests/pdf-objects.spec.ts
import { describe, expect, it } from 'vitest'
import { PdfBuilder, pdfString } from '../src/export/pdf/objects.ts'

describe('pdfString', () => {
  it('escapes the three characters a literal string cannot carry raw', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)')
  })
})

describe('PdfBuilder', () => {
  it('numbers objects from 1 and reports each reference', () => {
    const pdf = new PdfBuilder()
    expect(pdf.add('<< /Type /Catalog >>')).toBe(1)
    expect(pdf.add('<< /Type /Pages >>')).toBe(2)
  })

  it('emits a header, a trailer, and a startxref pointing at the table', () => {
    const pdf = new PdfBuilder()
    const root = pdf.add('<< /Type /Catalog >>')
    const out = pdf.build(root).toString('latin1')
    expect(out.startsWith('%PDF-1.7')).toBe(true)
    expect(out).toContain(`/Root ${root} 0 R`)
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true)
    const startxref = Number(/startxref\s+(\d+)/.exec(out)?.[1])
    expect(out.slice(startxref, startxref + 4)).toBe('xref')
  })

  it('writes a stream with a Length matching its payload', () => {
    const pdf = new PdfBuilder()
    const ref = pdf.stream('<< /Type /Test >>', 'hello')
    const out = pdf.build(pdf.add(`<< /Type /Catalog /X ${ref} 0 R >>`)).toString('latin1')
    expect(out).toContain('/Length 5')
    expect(out).toContain('hello')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/pdf-objects.spec.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Implement**

```ts
// packages/dsh-deck/src/export/pdf/objects.ts

/**
 * Escape a PDF literal string.
 *
 * Only three characters are special inside `( … )`; everything else,
 * including UTF-8 bytes, passes through. Text drawn through an embedded CID
 * font uses hex strings instead, so this is for names and metadata.
 * @param text - the raw text.
 * @returns the parenthesised, escaped literal.
 */
export function pdfString(text: string): string {
  return `(${text.replace(/[\\()]/g, ch => `\\${ch}`)})`
}

/**
 * Assemble a PDF file: indirect objects, a cross-reference table, a trailer.
 *
 * Hand-rolled rather than taken from a library because the whole writer needs
 * only these primitives, and the export path is deliberately dependency-light
 * — the point of this feature is that a deck exports without dragging a
 * browser or a document toolkit into a harness install.
 *
 * Bodies are latin1-encoded on the way out: PDF syntax is byte-oriented, and
 * binary payloads (font programs, compressed streams) must survive unchanged.
 */
export class PdfBuilder {
  private readonly objects: Buffer[] = []

  /**
   * Append an indirect object.
   * @param body - the object's body, without the `N 0 obj` wrapper.
   * @returns the object number, for use in a `N 0 R` reference.
   */
  add(body: string | Buffer): number {
    this.objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body)
    return this.objects.length
  }

  /**
   * Append a stream object, filling in `/Length` from the payload.
   * @param dict - the stream dictionary, without `/Length` and without the closing `>>`… supply a complete `<< … >>`; `/Length` is spliced in.
   * @param data - the stream payload.
   * @returns the object number.
   */
  stream(dict: string, data: Buffer | string): number {
    const payload = typeof data === 'string' ? Buffer.from(data, 'latin1') : data
    const withLength = `${dict.replace(/>>\s*$/, '')} /Length ${payload.length} >>`
    return this.add(Buffer.concat([
      Buffer.from(`${withLength}\nstream\n`, 'latin1'),
      payload,
      Buffer.from('\nendstream', 'latin1'),
    ]))
  }

  /**
   * Serialise the whole file.
   * @param rootRef - the object number of the document catalogue.
   * @returns the complete PDF.
   */
  build(rootRef: number): Buffer {
    const header = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')
    const chunks: Buffer[] = [header]
    const offsets: number[] = []
    let at = header.length
    this.objects.forEach((body, index) => {
      const chunk = Buffer.concat([
        Buffer.from(`${index + 1} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ])
      offsets.push(at)
      chunks.push(chunk)
      at += chunk.length
    })
    const count = this.objects.length + 1
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
    for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`
    xref += `trailer\n<< /Size ${count} /Root ${rootRef} 0 R >>\nstartxref\n${at}\n%%EOF\n`
    chunks.push(Buffer.from(xref, 'latin1'))
    return Buffer.concat(chunks)
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/pdf-objects.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-deck/src/export/pdf/objects.ts packages/dsh-deck/tests/pdf-objects.spec.ts
git commit -m "feat(dsh-deck): PDF object and xref primitives"
```

---

### Task 8: PDF writer — font embedding

**Files:**
- Create: `packages/dsh-deck/src/export/pdf/font.ts`
- Create: `packages/dsh-deck/tests/pdf-font.spec.ts`

**Interfaces:**
- Consumes: `PdfBuilder` (Task 7).
- Produces: `embedFont(pdf: PdfBuilder, ttf: Buffer, psName: string): EmbeddedFont` where
  `EmbeddedFont = { ref: number, widths: Map<number, number>, unitsPerEm: number, glyphFor(code: number): number, encode(text: string): string }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dsh-deck/tests/pdf-font.spec.ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PdfBuilder } from '../src/export/pdf/objects.ts'
import { embedFont } from '../src/export/pdf/font.ts'

const TTF = fileURLToPath(new URL('../vendor/pptx/fonts/Geist-Regular.ttf', import.meta.url))

describe('embedFont', () => {
  it('produces a Type0 font backed by the raw font program', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await readFile(TTF), 'Geist')
    const out = pdf.build(pdf.add(`<< /Type /Catalog /F ${font.ref} 0 R >>`)).toString('latin1')
    expect(out).toContain('/Subtype /Type0')
    expect(out).toContain('/Encoding /Identity-H')
    expect(out).toContain('/FontFile2')
  })

  it('maps characters to glyph ids through the font cmap', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await readFile(TTF), 'Geist')
    // 'A' must resolve to a real glyph, not the .notdef at index 0
    expect(font.glyphFor('A'.codePointAt(0)!)).toBeGreaterThan(0)
  })

  it('encodes text as big-endian glyph ids in a hex string', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await readFile(TTF), 'Geist')
    const hex = font.encode('A')
    expect(hex).toMatch(/^<[0-9A-F]{4}>$/)
    expect(parseInt(hex.slice(1, 5), 16)).toBe(font.glyphFor('A'.codePointAt(0)!))
  })

  it('reports advance widths in font units', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await readFile(TTF), 'Geist')
    expect(font.unitsPerEm).toBeGreaterThan(0)
    expect(font.widths.get(font.glyphFor('A'.codePointAt(0)!))).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/pdf-font.spec.ts`
Expected: FAIL — cannot resolve `../src/export/pdf/font.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/dsh-deck/src/export/pdf/font.ts
import type { PdfBuilder } from './objects.ts'

/** A font embedded in a document, with what the content stream needs to use it. */
export interface EmbeddedFont {
  /** The `/Type0` font object's number. */
  readonly ref: number
  /** Advance width per glyph id, in font units. */
  readonly widths: Map<number, number>
  /** The font's design units per em, for scaling widths to text space. */
  readonly unitsPerEm: number
  /** Glyph id for a Unicode code point; 0 (.notdef) when unmapped. */
  glyphFor(code: number): number
  /** Encode text as a hex string of big-endian glyph ids. */
  encode(text: string): string
}

/** Read the TrueType table directory. */
function tables(ttf: Buffer): Map<string, { offset: number, length: number }> {
  const count = ttf.readUInt16BE(4)
  const found = new Map<string, { offset: number, length: number }>()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    found.set(ttf.subarray(at, at + 4).toString('latin1'), {
      offset: ttf.readUInt32BE(at + 8),
      length: ttf.readUInt32BE(at + 12),
    })
  }
  return found
}

/**
 * Parse a format 4 `cmap` subtable into a code-point → glyph map.
 *
 * Format 4 is what every desktop TrueType font ships for the BMP, which is
 * the whole range a slide deck's text uses. Format 12 fonts would need a
 * second reader; none of the bundled faces is one.
 */
function readCmap(ttf: Buffer, offset: number): Map<number, number> {
  const map = new Map<number, number>()
  const count = ttf.readUInt16BE(offset + 2)
  let best = -1
  for (let i = 0; i < count; i++) {
    const at = offset + 4 + i * 8
    const platform = ttf.readUInt16BE(at)
    const encoding = ttf.readUInt16BE(at + 2)
    const sub = offset + ttf.readUInt32BE(at + 4)
    // Windows Unicode BMP, or Unicode platform — either is a BMP cmap.
    if ((platform === 3 && encoding === 1) || platform === 0) best = sub
  }
  if (best < 0 || ttf.readUInt16BE(best) !== 4) return map
  const segX2 = ttf.readUInt16BE(best + 6)
  const ends = best + 14
  const starts = ends + segX2 + 2
  const deltas = starts + segX2
  const ranges = deltas + segX2
  for (let s = 0; s < segX2 / 2; s++) {
    const end = ttf.readUInt16BE(ends + s * 2)
    const start = ttf.readUInt16BE(starts + s * 2)
    const delta = ttf.readInt16BE(deltas + s * 2)
    const rangeOffset = ttf.readUInt16BE(ranges + s * 2)
    if (start === 0xffff) continue
    for (let code = start; code <= end && code !== 0x10000; code++) {
      let glyph: number
      if (rangeOffset === 0) glyph = (code + delta) & 0xffff
      else {
        const at = ranges + s * 2 + rangeOffset + (code - start) * 2
        if (at + 1 >= ttf.length) continue
        const raw = ttf.readUInt16BE(at)
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
      }
      if (glyph !== 0) map.set(code, glyph)
    }
  }
  return map
}

/**
 * Embed a TrueType font as a CID-keyed Type0 font.
 *
 * The whole font program is embedded rather than a subset. Subsetting would
 * shrink the file, but it means rewriting `loca`, `glyf`, and `cmap`, and a
 * deck's handful of faces at roughly 100-300KB each is not the size problem
 * that would justify the risk of emitting a malformed font.
 *
 * Identity-H encoding means the content stream addresses glyphs directly by
 * id, which is why {@link EmbeddedFont.encode} exists: text has to be mapped
 * through the cmap before it is written, not after.
 * @param pdf - the document being assembled.
 * @param ttf - the font program.
 * @param psName - the PostScript name to register it under.
 * @returns the embedded font's reference and metrics.
 */
export function embedFont(pdf: PdfBuilder, ttf: Buffer, psName: string): EmbeddedFont {
  const dir = tables(ttf)
  const head = dir.get('head')
  const hhea = dir.get('hhea')
  const hmtx = dir.get('hmtx')
  const maxp = dir.get('maxp')
  const cmapTable = dir.get('cmap')
  if (!head || !hhea || !hmtx || !maxp || !cmapTable) {
    throw new Error(`${psName}: font is missing a required table (head/hhea/hmtx/maxp/cmap)`)
  }

  const unitsPerEm = ttf.readUInt16BE(head.offset + 18)
  const numGlyphs = ttf.readUInt16BE(maxp.offset + 4)
  const numHMetrics = ttf.readUInt16BE(hhea.offset + 34)

  const widths = new Map<number, number>()
  let last = 0
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHMetrics) last = ttf.readUInt16BE(hmtx.offset + g * 4)
    widths.set(g, last)
  }

  const cmap = readCmap(ttf, cmapTable.offset)
  const scale = 1000 / unitsPerEm

  const fileRef = pdf.stream(`<< /Length1 ${ttf.length} >>`, ttf)
  const descriptorRef = pdf.add([
    '<< /Type /FontDescriptor',
    `/FontName /${psName.replace(/\s+/g, '')}`,
    '/Flags 4',
    `/FontBBox [ ${Math.round(ttf.readInt16BE(head.offset + 36) * scale)} ${Math.round(ttf.readInt16BE(head.offset + 38) * scale)} ${Math.round(ttf.readInt16BE(head.offset + 40) * scale)} ${Math.round(ttf.readInt16BE(head.offset + 42) * scale)} ]`,
    '/ItalicAngle 0',
    `/Ascent ${Math.round(ttf.readInt16BE(hhea.offset + 4) * scale)}`,
    `/Descent ${Math.round(ttf.readInt16BE(hhea.offset + 6) * scale)}`,
    '/CapHeight 700 /StemV 80',
    `/FontFile2 ${fileRef} 0 R >>`,
  ].join(' '))

  // /W maps glyph id to advance width in 1/1000 em, one entry per glyph.
  const w = [...widths.entries()]
    .filter(([, value]) => value > 0)
    .map(([glyph, value]) => `${glyph} [${Math.round(value * scale)}]`)
    .join(' ')

  const cidRef = pdf.add([
    '<< /Type /Font /Subtype /CIDFontType2',
    `/BaseFont /${psName.replace(/\s+/g, '')}`,
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>',
    `/FontDescriptor ${descriptorRef} 0 R`,
    '/DW 1000',
    `/W [ ${w} ]`,
    '/CIDToGIDMap /Identity >>',
  ].join(' '))

  const ref = pdf.add([
    '<< /Type /Font /Subtype /Type0',
    `/BaseFont /${psName.replace(/\s+/g, '')}`,
    '/Encoding /Identity-H',
    `/DescendantFonts [ ${cidRef} 0 R ] >>`,
  ].join(' '))

  const glyphFor = (code: number): number => cmap.get(code) ?? 0
  return {
    ref,
    widths,
    unitsPerEm,
    glyphFor,
    encode: (text: string) => `<${[...text]
      .map(ch => glyphFor(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0'))
      .join('')}>`,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/pdf-font.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-deck/src/export/pdf/font.ts packages/dsh-deck/tests/pdf-font.spec.ts
git commit -m "feat(dsh-deck): TrueType embedding for the PDF writer"
```

---

### Task 9: PDF writer — shapes, pages, and wiring

**Files:**
- Create: `packages/dsh-deck/src/export/pdf/index.ts`
- Create: `packages/dsh-deck/tests/export-pdf.spec.ts`
- Modify: `packages/dsh-deck/src/index.ts` (wire the real producer)

**Interfaces:**
- Consumes: `PdfBuilder` (Task 7), `embedFont` (Task 8), `slidesFromRaw`/`resolveTheme` (Task 2), `embeddableFonts` (Task 6).
- Produces: `exportPdf(raw: unknown[][], themeId: string): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/dsh-deck/tests/export-pdf.spec.ts
import { describe, expect, it } from 'vitest'
import { exportPdf } from '../src/export/pdf/index.ts'

const RAW = [
  [{ t: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: 'rgb(10, 10, 12)' },
   { t: 'text', x: 100, y: 80, w: 400, h: 40, text: 'Hello', font: 'Geist', sizePx: 32, weight: 600, color: 'rgb(255,255,255)', italic: false, spacingPx: 0 }],
  [{ t: 'text', x: 60, y: 60, w: 300, h: 30, text: 'Second', font: 'Geist', sizePx: 24, weight: 400, color: 'rgb(255,255,255)', italic: false, spacingPx: 0 }],
]

describe('exportPdf', () => {
  it('writes one page per slide at 960x540 pt', async () => {
    const out = (await exportPdf(RAW, 'octo-glass')).toString('latin1')
    expect(out.startsWith('%PDF-1.7')).toBe(true)
    expect((out.match(/\/Type \/Page[^s]/g) ?? [])).toHaveLength(2)
    expect(out).toContain('/MediaBox [ 0 0 960 540 ]')
  })

  it('embeds a font program rather than relying on the reader', async () => {
    const out = (await exportPdf(RAW, 'octo-glass')).toString('latin1')
    expect(out).toContain('/FontFile2')
    expect(out).toContain('/Subtype /Type0')
  })

  it('emits text-showing operators, so the text stays real text', async () => {
    const out = (await exportPdf(RAW, 'octo-glass')).toString('latin1')
    expect(out).toMatch(/BT[\s\S]*Tj[\s\S]*ET/)
  })

  it('rejects an unknown theme', async () => {
    await expect(exportPdf(RAW, 'no-such-theme')).rejects.toThrow(/theme/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/dsh-deck && npx vitest run tests/export-pdf.spec.ts`
Expected: FAIL — cannot resolve `../src/export/pdf/index.ts`.

- [ ] **Step 3: Implement**

```ts
// packages/dsh-deck/src/export/pdf/index.ts
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { slidesFromRaw } from '../../../vendor/pptx/extract.ts'
import { resolveTheme } from '../../../vendor/pptx/theme.ts'
import type { Paint } from '../../../vendor/pptx/theme.ts'
import type { Shape, SlideIR, Run } from '../../../vendor/pptx/ir.ts'
import { PdfBuilder } from './objects.ts'
import { embedFont, type EmbeddedFont } from './font.ts'

/**
 * The deck canvas in CSS pixels, and the same page in PDF points.
 *
 * PDF's unit is 1/72 inch and CSS pixels are 1/96 inch, so the page is
 * 960x540pt and every coordinate is scaled by 0.75. The IR stays in design
 * pixels — converting here keeps one conversion in one place.
 */
const PX_TO_PT = 72 / 96
const PAGE_WIDTH = 1280 * PX_TO_PT
const PAGE_HEIGHT = 720 * PX_TO_PT

const FONT_DIR = new URL('../../../vendor/pptx/fonts/', import.meta.url)

/** Which TTF backs each typeface `extract.ts` can name. */
const FONT_FILES: Record<string, string> = {
  'Geist': 'Geist-Regular.ttf',
  'Geist Medium': 'Geist-Medium.ttf',
  'Geist SemiBold': 'Geist-SemiBold.ttf',
  'Geist Mono': 'GeistMono-Regular.ttf',
  'Geist Mono Medium': 'GeistMono-Medium.ttf',
  'Switzer': 'Switzer-Regular.ttf',
  'Switzer Medium': 'Switzer-Medium.ttf',
  'Switzer Semibold': 'Switzer-Semibold.ttf',
  'Switzer Bold': 'Switzer-Bold.ttf',
  'Inter': 'Inter-Regular.ttf',
  'Inter Medium': 'Inter-Medium.ttf',
  'Inter SemiBold': 'Inter-SemiBold.ttf',
  'Inter Bold': 'Inter-Bold.ttf',
}

/** PDF colour operator operands from an IR paint. */
function rgb(paint: Paint): string {
  const value = parseInt(paint.hex, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map(channel => (channel / 255).toFixed(4)).join(' ')
}

/** The three channels of a paint as PDF function values. */
function channels(paint: Paint): string {
  return rgb(paint)
}

/**
 * Build an axial (Type 2) shading for one IR gradient, clipped to a rect.
 *
 * The IR gives stops at 0..1 along an angle in degrees, which PDF expresses
 * as two endpoint coordinates plus a stitching function over the stops. Two
 * stops need only a single exponential function; more need a Type 3 stitch,
 * so both are emitted from the same walk.
 * @param grad - the IR gradient.
 * @param x - rect left, in points.
 * @param y - rect bottom, in points.
 * @param w - rect width, in points.
 * @param h - rect height, in points.
 * @returns the shading dictionary, inline (no indirect object needed).
 */
function shading(grad: { stops: { pos: number, color: Paint }[], angle: number }, x: number, y: number, w: number, h: number): string {
  const stops = [...grad.stops].sort((a, b) => a.pos - b.pos)
  if (stops.length === 0) return ''
  if (stops.length === 1) return ''
  const radians = (grad.angle * Math.PI) / 180
  // Project the gradient axis across the rect's centre.
  const cx = x + w / 2
  const cy = y + h / 2
  const half = (Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h) / 2
  const x0 = cx - Math.cos(radians) * half
  const y0 = cy + Math.sin(radians) * half
  const x1 = cx + Math.cos(radians) * half
  const y1 = cy - Math.sin(radians) * half

  const pair = (a: Paint, b: Paint): string =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [${channels(a)}] /C1 [${channels(b)}] /N 1 >>`

  let fn: string
  if (stops.length === 2) {
    fn = pair(stops[0].color, stops[1].color)
  } else {
    const functions = stops.slice(0, -1).map((stop, i) => pair(stop.color, stops[i + 1].color))
    const span = stops[stops.length - 1].pos - stops[0].pos || 1
    const bounds = stops.slice(1, -1)
      .map(stop => ((stop.pos - stops[0].pos) / span).toFixed(4)).join(' ')
    const encode = functions.map(() => '0 1').join(' ')
    fn = `<< /FunctionType 3 /Domain [0 1] /Functions [ ${functions.join(' ')} ] /Bounds [ ${bounds} ] /Encode [ ${encode} ] >>`
  }
  return `<< /ShadingType 2 /ColorSpace /DeviceRGB `
    + `/Coords [ ${x0.toFixed(2)} ${y0.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)} ] `
    + `/Function ${fn} /Extend [ true true ] >>`
}

/** PDF y grows upward; IR y grows downward from the slide's top edge. */
const flip = (y: number): number => PAGE_HEIGHT - y * PX_TO_PT

/** Emit one shape's operators into the content stream. */
function emit(shape: Shape, out: string[], fonts: Map<string, EmbeddedFont>, names: Map<string, string>, shadings: Map<string, string>): void {
  switch (shape.kind) {
    case 'group':
      for (const child of shape.children) emit(child, out, fonts, names, shadings)
      return
    case 'rect': {
      const x = shape.x * PX_TO_PT
      const y = flip(shape.y + shape.h)
      const w = shape.w * PX_TO_PT
      const h = shape.h * PX_TO_PT
      if (shape.grad !== undefined) {
        // Clip to the rect, then paint the shading across it: `sh` fills the
        // whole clip region, which is why the clip rather than a fill op is
        // what bounds a gradient. `sh` takes a *named* resource, so the
        // dictionary is registered on the page and referenced by name.
        const dict = shading(shape.grad, x, y, w, h)
        if (dict !== '') {
          const name = `Sh${shadings.size}`
          shadings.set(name, dict)
          out.push(`q ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re W n /${name} sh Q`)
        }
      } else if (shape.fill !== undefined) {
        out.push(`q ${rgb(shape.fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f Q`)
      }
      if (shape.line !== undefined) {
        out.push(`q ${rgb(shape.line.color)} RG ${(shape.line.w * PX_TO_PT).toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q`)
      }
      if (shape.runs !== undefined) emitRuns(shape.runs, shape.x, shape.y + shape.h * 0.72, out, fonts, names)
      return
    }
    case 'line':
      out.push(`q ${rgb(shape.color)} RG ${(shape.w * PX_TO_PT).toFixed(2)} w `
        + `${(shape.x1 * PX_TO_PT).toFixed(2)} ${flip(shape.y1).toFixed(2)} m `
        + `${(shape.x2 * PX_TO_PT).toFixed(2)} ${flip(shape.y2).toFixed(2)} l S Q`)
      return
    case 'path': {
      const ops = shape.segs.map(seg => seg.c === 'C'
        ? `${(seg.x1 * PX_TO_PT).toFixed(2)} ${flip(seg.y1).toFixed(2)} ${(seg.x2 * PX_TO_PT).toFixed(2)} ${flip(seg.y2).toFixed(2)} ${(seg.x * PX_TO_PT).toFixed(2)} ${flip(seg.y).toFixed(2)} c`
        : `${(seg.x * PX_TO_PT).toFixed(2)} ${flip(seg.y).toFixed(2)} ${seg.c === 'M' ? 'm' : 'l'}`)
      if (ops.length === 0) return
      const paint = shape.fill !== undefined
        ? `${rgb(shape.fill)} rg ${shape.closed === true ? 'f' : 'f'}`
        : shape.line !== undefined ? `${rgb(shape.line.color)} RG ${(shape.line.w * PX_TO_PT).toFixed(2)} w S` : 'n'
      out.push(`q ${ops.join(' ')} ${shape.closed === true ? 'h ' : ''}${paint} Q`)
      return
    }
    case 'text':
      if (shape.runs !== undefined) emitRuns(shape.runs, shape.x, shape.y + shape.h * 0.72, out, fonts, names)
      return
  }
}

/** Emit a run sequence as one text object on a shared baseline. */
function emitRuns(runs: Run[], x: number, baseline: number, out: string[], fonts: Map<string, EmbeddedFont>, names: Map<string, string>): void {
  let cursor = x
  for (const run of runs) {
    const font = fonts.get(run.font) ?? fonts.get('Geist')
    const name = names.get(run.font) ?? names.get('Geist')
    if (font === undefined || name === undefined) continue
    const sizePt = run.sizePt
    out.push(`q BT ${rgb(run.color)} rg /${name} ${sizePt.toFixed(2)} Tf `
      + `${(cursor * PX_TO_PT).toFixed(2)} ${flip(baseline).toFixed(2)} Td `
      + `${font.encode(run.text)} Tj ET Q`)
    const advance = [...run.text]
      .reduce((sum, ch) => sum + (font.widths.get(font.glyphFor(ch.codePointAt(0) ?? 0)) ?? 0), 0)
    cursor += (advance / font.unitsPerEm) * sizePt / PX_TO_PT
  }
}

/**
 * Build a PDF from raw walker items.
 *
 * Vector throughout: text is drawn with embedded fonts rather than
 * rasterised, so the result is selectable, searchable, and roughly a tenth
 * the size of a screenshot-per-slide export — and it needs no browser, which
 * is the point.
 * @param raw - one array of walker items per slide, in slide order.
 * @param themeId - the theme the deck was displayed in.
 * @returns the complete PDF.
 * @throws {Error} when `themeId` is not a theme the snapshot knows.
 */
export async function exportPdf(raw: unknown[][], themeId: string): Promise<Buffer> {
  let theme: ReturnType<typeof resolveTheme>
  try {
    theme = resolveTheme(themeId)
  } catch (cause) {
    throw new Error(`unknown theme ${JSON.stringify(themeId)}`, { cause })
  }
  const slides: SlideIR[] = slidesFromRaw(raw, theme.color.bg)
  const pdf = new PdfBuilder()

  // Load every face the slides actually reference, once.
  const used = new Set<string>()
  const collect = (shape: Shape): void => {
    if (shape.kind === 'group') { for (const c of shape.children) collect(c); return }
    if ('runs' in shape && shape.runs !== undefined) for (const r of shape.runs) used.add(r.font)
  }
  for (const slide of slides) for (const shape of slide.shapes) collect(shape)
  used.add('Geist') // fallback face, always present

  const fonts = new Map<string, EmbeddedFont>()
  const names = new Map<string, string>()
  let index = 0
  for (const family of used) {
    const file = FONT_FILES[family]
    if (file === undefined) continue
    const bytes = await readFile(fileURLToPath(new URL(file, FONT_DIR))).catch(() => null)
    if (bytes === null) continue
    fonts.set(family, embedFont(pdf, bytes, family))
    names.set(family, `F${index++}`)
  }

  const fontResource = `/Font << ${[...names.entries()]
    .map(([family, name]) => `/${name} ${fonts.get(family)!.ref} 0 R`).join(' ')} >>`

  const pageRefs: number[] = []
  const contentRefs: number[] = []
  const pageResources: string[] = []
  for (const slide of slides) {
    const out: string[] = [
      `q ${rgb(slide.bg)} rg 0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)} re f Q`,
    ]
    const shadings = new Map<string, string>()
    for (const shape of slide.shapes) emit(shape, out, fonts, names, shadings)
    contentRefs.push(pdf.stream('<< >>', out.join('\n')))
    // Shadings are per page: each is named in the order it was met on that page.
    pageResources.push(shadings.size === 0
      ? `<< ${fontResource} >>`
      : `<< ${fontResource} /Shading << ${[...shadings.entries()].map(([name, dict]) => `/${name} ${dict}`).join(' ')} >> >>`)
  }

  // The pages node must be referenced by each page, so its number is reserved
  // by adding a placeholder that is rewritten below — instead, compute it:
  // pages is added after the page objects, so each page needs its number in
  // advance. PdfBuilder numbers sequentially, so it is (current + pages + 1).
  const pagesRef = pdf.add('<< >>') // placeholder, replaced by build order below
  contentRefs.forEach((contentRef, i) => {
    pageRefs.push(pdf.add(
      `<< /Type /Page /Parent ${pagesRef} 0 R `
      + `/MediaBox [ 0 0 ${Math.round(PAGE_WIDTH)} ${Math.round(PAGE_HEIGHT)} ] `
      + `/Resources ${pageResources[i]} /Contents ${contentRef} 0 R >>`,
    ))
  })
  // Rewrite the reserved pages object now that every page number is known.
  pdf.replace(pagesRef, `<< /Type /Pages /Count ${pageRefs.length} /Kids [ ${pageRefs.map(r => `${r} 0 R`).join(' ')} ] >>`)
  const root = pdf.add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`)
  return pdf.build(root)
}
```

This needs one addition to `PdfBuilder` — add it to `src/export/pdf/objects.ts`:

```ts
  /**
   * Replace a previously added object's body.
   *
   * A `/Pages` node and its `/Page` children reference each other, so one of
   * the two must be reserved before its contents are known. Reserving the
   * parent and filling it in afterwards keeps object numbering sequential.
   * @param ref - the object number returned by {@link add}.
   * @param body - the replacement body.
   */
  replace(ref: number, body: string | Buffer): void {
    this.objects[ref - 1] = typeof body === 'string' ? Buffer.from(body, 'latin1') : body
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/dsh-deck && npx vitest run tests/export-pdf.spec.ts`
Expected: 4 passing.

- [ ] **Step 5: Wire the producer**

In `packages/dsh-deck/src/index.ts`, replace the pdf thrower:

```ts
  pdf: exportPdf,
```

with the matching import.

- [ ] **Step 6: Typecheck, full suite, commit**

Run: `cd packages/dsh-deck && npm run typecheck && npm test`

```bash
git add packages/dsh-deck/src packages/dsh-deck/tests
git commit -m "feat(dsh-deck): vector PDF export from the canvas"
```

- [ ] **Step 7: Verify by looking**

Export a real multi-slide deck to PDF in at least two themes, one flat and one rich. Open both. Confirm: one page per slide, correct page size, text selectable, colours match the live deck, nothing clipped.

---

### Task 10: Documentation and skill regeneration

**Files:**
- Modify: `packages/dsh-deck/README.md`
- Modify: `CLAUDE.md`
- Modify: `docs/design/2026-08-22-dsh-deck-handoff.md`

- [ ] **Step 1: Document the export endpoints and buttons in the package README**

Add a section covering: the three formats, that export follows the displayed theme, where artifacts land (`.deck/<name>/export/<name>-<theme>.<ext>`), and that export is client-initiated so there is no model-callable `deck_export`.

- [ ] **Step 2: Update the handoff's "not proven" list**

`deck_export`/`deck_capture` are listed as "Not built. Phases 3 and 4." Replace with what now exists (HTML, PPTX, PDF export buttons; theme switcher) and what remains unproven (non-loopback deployments, session replay of an export, two concurrent sessions).

- [ ] **Step 3: Update `CLAUDE.md`'s dsh-deck line**

The `packages/dsh-deck/` entry describes "deck tools, a middleware-mode Vite preview server, the floating canvas, and the Deck creator agent preset". Add export and theme switching.

- [ ] **Step 4: Regenerate the bundled skill template**

Run: `npm run skill:assets && npm run skill:validate`
Expected: both succeed. CI fails if the bundled template is stale.

- [ ] **Step 5: Full verification and commit**

Run from the repo root: `npm run build`
Run from the package: `cd packages/dsh-deck && npm run typecheck && npm test`
Expected: all green.

```bash
git add -A
git commit -m "docs(dsh-deck): document canvas export and theme switching"
```

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: the `@export` route and containment (Task 3), hidden-iframe extraction and the `WALKER(doc)` change (Task 5), the three producers (Tasks 3, 6, 7-9), `zip.ts` and the `python3` removal (Task 1), vendored backdrops and fonts (Task 2), the Inter/Cabinet font decision (Tasks 2 and 6), theme switching preview-only (Task 4), delivery as write-plus-download (Task 3), failure modes (Tasks 3, 5, 6), and the test plan (throughout).

**Known risks flagged inline, not hidden:**

1. **Task 1, Step 3** — the central-directory layout has a deliberate correction note; the implementer must place external attributes at byte 36-40 and the local-header offset at byte 42. The test in Step 1 will not catch a wrong offset field, so verify against a real `.pptx` opening in PowerPoint at Step 6.
2. **Task 5, Step 8** — whether `require` or a static import reaches the vendored walker depends on the tsdown bundle format; Step 10 is the check, with the fallback stated.
3. **Task 6, Step 4** — `resolveTheme`'s behaviour on an unknown id is unverified; the note says to add an explicit guard if it falls back silently rather than throwing.
4. **Task 9** — `emitRuns` advances the cursor by summed glyph widths, which ignores kerning. The IR emits one text item per measured line, so runs are typically single-line and single-run; if real exports show drift, the fix is one text object per IR item rather than per run.
5. **Task 9** — gradients are emitted as Type 2 axial shadings, stitched with a Type 3 function when a gradient has more than two stops. Two details are easy to get wrong and are worth checking at Step 7: `sh` takes a *named* resource (the dictionary is registered per page under `/Shading`, never inline), and the gradient axis is projected across the rect's centre, so a rotated gradient on a very non-square rect may band differently from CSS. Radial gradients are not in the IR, so none is emitted.
6. **Task 9** — `grad` on a `path` shape is not emitted (only on `rect`); a gradient-filled freeform path falls back to its solid `fill` or goes unpainted. The IR permits it but the themes are not known to produce one. Confirm at Step 7.
