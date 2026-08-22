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
