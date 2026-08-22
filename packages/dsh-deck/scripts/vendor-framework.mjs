/**
 * Copy the Octodeck framework and theme sources into this package so a
 * published copy is self-contained.
 *
 * The preview server serves the framework from disk at request time (Vite
 * compiles it), so the package cannot merely depend on compiled output — it
 * needs the sources. Reaching back into a checkout by relative depth only
 * works from inside this repository; an installed copy computes a path under
 * the consumer's own tree and finds nothing there.
 *
 * The two directories are copied as siblings under `vendor/src/` because the
 * theme modules import the framework by relative path (`../framework/theme`,
 * `../../framework/theme`). Flattening them would break those imports.
 */
import { cp, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = new URL('../', import.meta.url)
const repoSource = new URL('../../src/', packageRoot)
const vendorRoot = new URL('vendor/src/', packageRoot)

await rm(fileURLToPath(vendorRoot), { recursive: true, force: true })
await mkdir(fileURLToPath(vendorRoot), { recursive: true })
for (const directory of ['framework', 'themes']) {
  await cp(
    fileURLToPath(new URL(`${directory}/`, repoSource)),
    fileURLToPath(new URL(`${directory}/`, vendorRoot)),
    { recursive: true },
  )
}
console.log(`vendored framework + themes into ${fileURLToPath(vendorRoot)}`)

/**
 * The pptx pipeline is vendored for the same reason the framework is: the
 * export producers import it at runtime, and reaching back into this checkout
 * by relative depth only resolves from inside this repository.
 *
 * `themes.resolved.json`, `fonts/`, and `backdrops/` come along because they
 * are what let `pptx:themes` and `pptx:bake` — both of which need a browser —
 * stay build-time steps in this repository rather than runtime steps in a
 * user's harness. That is what makes deck export browser-free.
 */
const pptxSource = new URL('../../scripts/pptx/', packageRoot)
const pptxVendor = new URL('vendor/pptx/', packageRoot)

await rm(fileURLToPath(pptxVendor), { recursive: true, force: true })
await mkdir(fileURLToPath(pptxVendor), { recursive: true })
for (const file of ['color.ts', 'ir.ts', 'ooxml.ts', 'theme.ts', 'extract.ts', 'themes.resolved.json']) {
  await cp(fileURLToPath(new URL(file, pptxSource)), fileURLToPath(new URL(file, pptxVendor)))
}
for (const directory of ['fonts', 'backdrops']) {
  const from = fileURLToPath(new URL(`${directory}/`, pptxSource))
  try {
    await cp(from, fileURLToPath(new URL(`${directory}/`, pptxVendor)), { recursive: true })
  } catch (cause) {
    // `pretest` runs this step, so a bare ENOENT here surfaces as an
    // unexplained test-suite failure. Name what is missing and how to
    // rebuild it instead: backdrops come from `npm run pptx:bake` (which
    // needs `npm run dev` running), fonts are committed.
    throw new Error(
      `cannot vendor ${directory}: ${from} is missing. `
      + (directory === 'backdrops'
        ? 'Rebuild it with `npm run dev` in one shell and `npm run pptx:bake` in another.'
        : 'It should be committed to this repository; restore it from git.'),
      { cause },
    )
  }
}
console.log(`vendored pptx pipeline into ${fileURLToPath(pptxVendor)}`)
