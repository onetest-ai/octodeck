import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** Where the vendored TTFs live, shared by every export format. */
const FONT_DIR = new URL('../../vendor/pptx/fonts/', import.meta.url)

/** One concrete font file: the CSS weight it serves and the OOXML typeface it is. */
export interface FaceFile {
  /** The file inside the vendored font directory. */
  readonly file: string
  /** CSS `font-weight` this file provides. */
  readonly weight: number
  /**
   * The typeface name PowerPoint embeds it under. `extract.ts`'s `fontFace`
   * names the precise weight family (e.g. "Geist SemiBold") so a renderer
   * cannot synthesize a too-heavy bold, and these must agree with it.
   */
  readonly typeface: string
}

/**
 * The faces this package redistributes, by CSS family name.
 *
 * The family key is what a theme's CSS writes in `font-family`, which is what
 * an inlined `@font-face` has to match. Cabinet Grotesk is deliberately absent:
 * it is Fontshare-licensed and not redistributed here, so a theme naming it
 * degrades with a warning rather than failing.
 */
export const VENDORED_FACES: Record<string, readonly FaceFile[]> = {
  'Geist': [
    { file: 'Geist-Regular.ttf', weight: 400, typeface: 'Geist' },
    { file: 'Geist-Medium.ttf', weight: 500, typeface: 'Geist Medium' },
    { file: 'Geist-SemiBold.ttf', weight: 600, typeface: 'Geist SemiBold' },
    { file: 'Geist-Bold.ttf', weight: 700, typeface: 'Geist Bold' },
  ],
  'Geist Mono': [
    { file: 'GeistMono-Regular.ttf', weight: 400, typeface: 'Geist Mono' },
    { file: 'GeistMono-Medium.ttf', weight: 500, typeface: 'Geist Mono Medium' },
  ],
  'Switzer': [
    { file: 'Switzer-Regular.ttf', weight: 400, typeface: 'Switzer' },
    { file: 'Switzer-Medium.ttf', weight: 500, typeface: 'Switzer Medium' },
    { file: 'Switzer-Semibold.ttf', weight: 600, typeface: 'Switzer Semibold' },
    { file: 'Switzer-Bold.ttf', weight: 700, typeface: 'Switzer Bold' },
  ],
  'Inter': [
    { file: 'Inter-Regular.ttf', weight: 400, typeface: 'Inter' },
    { file: 'Inter-Medium.ttf', weight: 500, typeface: 'Inter Medium' },
    { file: 'Inter-SemiBold.ttf', weight: 600, typeface: 'Inter SemiBold' },
    { file: 'Inter-Bold.ttf', weight: 700, typeface: 'Inter Bold' },
  ],
}

/**
 * Font hosts the shipped themes `@import` from.
 *
 * A self-contained export must carry no reference to any of them: a file that
 * still imports a font stylesheet renders with a substituted face when opened
 * offline, which is exactly the failure the format exists to prevent.
 */
export const REMOTE_FONT_HOSTS = ['fonts.googleapis.com', 'rsms.me', 'api.fontshare.com'] as const

/** Read one vendored face, or null when it is not bundled. */
async function readFace(file: string): Promise<Buffer | null> {
  return readFile(fileURLToPath(new URL(file, FONT_DIR))).catch(() => null)
}

/**
 * Build `@font-face` rules carrying each requested family as a data URI.
 *
 * TTF rather than WOFF2 because TTF is what this package redistributes for
 * PowerPoint and PDF embedding, and carrying one copy of each face serves all
 * three formats. It costs size — the rules are large — but the alternative is
 * a second set of files for one format.
 * @param families - CSS family names to inline.
 * @returns the CSS, plus a warning naming any family that is not bundled.
 */
export async function fontFaceCss(
  families: readonly string[],
): Promise<{ css: string, missing: string[] }> {
  const rules: string[] = []
  const missing: string[] = []
  for (const family of families) {
    const faces = VENDORED_FACES[family]
    if (faces === undefined) { missing.push(family); continue }
    for (const face of faces) {
      const bytes = await readFace(face.file)
      if (bytes === null) { missing.push(face.typeface); continue }
      rules.push(
        '@font-face{'
        + `font-family:'${family}';`
        + `font-weight:${face.weight};`
        + 'font-style:normal;font-display:block;'
        + `src:url(data:font/ttf;base64,${bytes.toString('base64')}) format('truetype')`
        + '}',
      )
    }
  }
  return { css: rules.join(''), missing }
}

/**
 * Which vendored families a stylesheet actually references.
 *
 * Read from the built CSS rather than from a per-theme table so the answer
 * follows what the theme really asks for: a theme that changes its stack does
 * not also need this list updated, and no export carries a megabyte of a face
 * its slides never use.
 * @param css - the bundled stylesheet text.
 * @returns the bundled family names it mentions, in declaration order.
 */
export function familiesUsedIn(css: string): string[] {
  // Longest first, so "Geist Mono" is matched before "Geist" and does not get
  // shadowed by the shorter name that prefixes it.
  const known = Object.keys(VENDORED_FACES).sort((a, b) => b.length - a.length)
  const used: string[] = []
  for (const family of known) {
    if (css.includes(family) && !used.includes(family)) used.push(family)
  }
  return used
}
