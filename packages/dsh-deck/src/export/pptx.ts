import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { slidesFromRaw } from '../../vendor/pptx/ir-from-raw.js'
import { buildPptx, type EmbedFont } from '../../vendor/pptx/ooxml.js'
import { resolveTheme } from '../../vendor/pptx/theme.js'
import { VENDORED_FACES } from './fonts.ts'
import { zipSync } from './zip.ts'

/** Baked, per-theme backdrop images shipped with the package. */
const BACKDROPS = new URL('../../vendor/pptx/backdrops/', import.meta.url)
const FONT_DIR = new URL('../../vendor/pptx/fonts/', import.meta.url)

/**
 * Load the faces a theme asks to embed.
 *
 * A family with no bundled TTF does not fail the export — the deck still
 * exports, with the consumer substituting a fallback — but the caller is told
 * which, because a silently substituted typeface is the kind of defect nobody
 * notices until a presentation is on a projector.
 * @param embed - the family names the resolved theme wants embedded.
 * @returns the loaded faces, and the names of any that were unavailable.
 */
export async function embeddableFonts(
  embed: readonly string[],
): Promise<{ fonts: EmbedFont[], missing: string[] }> {
  const fonts: EmbedFont[] = []
  const missing: string[] = []
  for (const family of embed) {
    const faces = VENDORED_FACES[family]
    if (faces === undefined) { missing.push(family); continue }
    for (const face of faces) {
      const bytes = await readFile(fileURLToPath(new URL(face.file, FONT_DIR))).catch(() => null)
      if (bytes === null) { missing.push(face.typeface); continue }
      fonts.push({ typeface: face.typeface, regular: bytes })
    }
  }
  return { fonts, missing }
}

/**
 * Build a `.pptx` from raw walker items.
 *
 * The browser measured the deck and posted the items; everything from here is
 * pure Node. Backdrops for "rich" themes are pre-baked PNGs shipped in the
 * package rather than screenshots taken now, and the theme snapshot is
 * committed rather than resolved from a live page — together, that is what
 * keeps this path free of a headless browser.
 * @param raw - one array of walker items per slide, in slide order.
 * @param themeId - the theme the deck was displayed in.
 * @returns the packaged presentation.
 * @throws {Error} when `themeId` is not a theme the snapshot knows.
 */
export async function exportPptx(raw: unknown[][], themeId: string): Promise<Buffer> {
  const theme = resolveTheme(themeId)
  const slides = slidesFromRaw(raw, theme.color.bg)
  const backdrop = theme.backdrop.rich
    ? await readFile(fileURLToPath(new URL(`${themeId}.png`, BACKDROPS))).catch(() => undefined)
    : undefined
  const { fonts } = await embeddableFonts(theme.font.embed)
  return zipSync(buildPptx(slides, theme, backdrop, fonts) as Record<string, string | Uint8Array>)
}
