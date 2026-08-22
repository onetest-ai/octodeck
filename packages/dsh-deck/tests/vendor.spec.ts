import { access, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The pptx pipeline is vendored for the same reason the framework is: the
 * export producers import it at runtime, and reaching back into this checkout
 * by relative depth only resolves from inside this repository. These tests are
 * the loud failure a build that skipped `npm run vendor` would otherwise turn
 * into a module-not-found from deep inside an export.
 */
const vendor = new URL('../vendor/pptx/', import.meta.url)
const at = (name: string): string => fileURLToPath(new URL(name, vendor))

describe('vendored pptx pipeline', () => {
  it('carries every Node-side module the export producers import, compiled', async () => {
    // Compiled in place rather than into `lib/`: `theme.js` reads
    // `themes.resolved.json` relative to its own module URL, so moving the
    // code away from its data would break it.
    for (const file of ['color.js', 'ir.js', 'ooxml.js', 'theme.js', 'ir-from-raw.js', 'walker.js']) {
      await expect(access(at(file))).resolves.toBeUndefined()
    }
  })

  it('keeps declarations beside the compiled output, so src can import it typed', async () => {
    for (const file of ['ooxml.d.ts', 'theme.d.ts', 'ir-from-raw.d.ts', 'walker.d.ts']) {
      await expect(access(at(file))).resolves.toBeUndefined()
    }
  })

  it('leaves no TypeScript sources behind', async () => {
    // TypeScript resolves an import of `./ooxml.js` back to `ooxml.ts`
    // whenever both exist, which drags the vendored sources into the `src`
    // program and fails its rootDir.
    const left = (await readdir(at('.'))).filter(name => name.endsWith('.ts') && !name.endsWith('.d.ts'))
    expect(left).toEqual([])
  })

  it('does not vendor the Playwright-driven extractor', async () => {
    // extract.ts drives Playwright, a devDependency of the repository root
    // and not of this package; only its pure mapping half is vendored.
    await expect(access(at('extract.js'))).rejects.toThrow()
  })

  it('carries the resolved-theme snapshot so pptx:themes never runs at export time', async () => {
    await expect(access(at('themes.resolved.json'))).resolves.toBeUndefined()
  })

  it('carries the fonts the export formats embed', async () => {
    const fonts = await readdir(at('fonts'))
    expect(fonts).toEqual(expect.arrayContaining([
      'Geist-Regular.ttf', 'Switzer-Regular.ttf', 'Inter-Regular.ttf',
    ]))
  })

  it('carries baked backdrops so pptx:bake never runs at export time', async () => {
    const baked = await readdir(at('backdrops'))
    // radiant and octo-glass are the themes whose backdrop is a gradient;
    // flat themes use a native solid fill and need no image.
    expect(baked.filter(name => name.endsWith('.png'))).toEqual(
      expect.arrayContaining(['radiant.png', 'octo-glass.png']),
    )
  })
})
