/**
 * Drop the vendored pptx TypeScript sources once `tsc -p tsconfig.vendor.json`
 * has compiled them to `.js` + `.d.ts`.
 *
 * They are build inputs, not shipped code. Leaving them beside the emitted
 * output also breaks the build that consumes it: TypeScript resolves an import
 * of `./ooxml.js` back to `ooxml.ts` whenever both exist, which drags the
 * vendored sources into the `src` program and fails its `rootDir`.
 *
 * `vendor/src/` — the framework and themes — keeps its sources on purpose:
 * Vite compiles those from disk at request time.
 */
import { readdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const pptxVendor = new URL('../vendor/pptx/', import.meta.url)
let pruned = 0
for (const entry of await readdir(fileURLToPath(pptxVendor))) {
  if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
    await rm(fileURLToPath(new URL(entry, pptxVendor)))
    pruned++
  }
}
console.log(`pruned ${pruned} vendored pptx sources (compiled output kept)`)
