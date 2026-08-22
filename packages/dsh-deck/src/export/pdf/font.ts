import type { PdfBuilder } from './objects.ts'

/** A font embedded in a document, with what the content stream needs to use it. */
export interface EmbeddedFont {
  /** The `/Type0` font object's number. */
  readonly ref: number
  /** Advance width per glyph id, in font units. */
  readonly widths: ReadonlyMap<number, number>
  /** The font's design units per em, for scaling widths into text space. */
  readonly unitsPerEm: number
  /** Glyph id for a Unicode code point; 0 (.notdef) when unmapped. */
  glyphFor: (code: number) => number
  /** Encode text as a hex string of big-endian glyph ids. */
  encode: (text: string) => string
}

/** Read the TrueType table directory. */
function tables(ttf: Buffer): Map<string, { offset: number, length: number }> {
  if (ttf.length < 12) return new Map()
  const count = ttf.readUInt16BE(4)
  const found = new Map<string, { offset: number, length: number }>()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    if (at + 16 > ttf.length) break
    found.set(ttf.subarray(at, at + 4).toString('latin1'), {
      offset: ttf.readUInt32BE(at + 8),
      length: ttf.readUInt32BE(at + 12),
    })
  }
  return found
}

/**
 * Parse a format 4 `cmap` subtable into a code point → glyph map.
 *
 * Format 4 is what every desktop TrueType font ships for the Basic
 * Multilingual Plane, which covers everything a slide deck's text uses. A
 * format 12 font would need a second reader; none of the bundled faces is one.
 * @param ttf - the font program.
 * @param offset - the `cmap` table's offset.
 * @returns the mapping, empty when no usable subtable is present.
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
    // Windows Unicode BMP, or the Unicode platform — either is a BMP cmap.
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
    for (let code = start; code <= end && code < 0x10000; code++) {
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
 * deck's handful of faces at roughly 100-400KB each is not a size problem
 * worth the risk of emitting a malformed font.
 *
 * Identity-H means the content stream addresses glyphs directly by id, which
 * is why {@link EmbeddedFont.encode} exists: text has to go through the cmap
 * before it is written, not after.
 * @param pdf - the document being assembled.
 * @param ttf - the font program.
 * @param psName - the name to register it under; spaces are stripped, since a
 * PDF name cannot carry them.
 * @returns the embedded font's reference and metrics.
 * @throws {Error} when `ttf` lacks a table the writer needs.
 */
export function embedFont(pdf: PdfBuilder, ttf: Buffer, psName: string): EmbeddedFont {
  const dir = tables(ttf)
  const head = dir.get('head')
  const hhea = dir.get('hhea')
  const hmtx = dir.get('hmtx')
  const maxp = dir.get('maxp')
  const cmapTable = dir.get('cmap')
  if (!head || !hhea || !hmtx || !maxp || !cmapTable) {
    throw new Error(`${psName}: not a usable TrueType font (missing head/hhea/hmtx/maxp/cmap)`)
  }

  const name = psName.replace(/\s+/g, '')
  const unitsPerEm = ttf.readUInt16BE(head.offset + 18)
  const numGlyphs = ttf.readUInt16BE(maxp.offset + 4)
  const numHMetrics = ttf.readUInt16BE(hhea.offset + 34)

  // `hmtx` stores full metrics for the first numHMetrics glyphs, then reuses
  // the last advance for every remaining glyph — monospaced tails rely on it.
  const widths = new Map<number, number>()
  let last = 0
  for (let glyph = 0; glyph < numGlyphs; glyph++) {
    if (glyph < numHMetrics) last = ttf.readUInt16BE(hmtx.offset + glyph * 4)
    widths.set(glyph, last)
  }

  const cmap = readCmap(ttf, cmapTable.offset)
  // PDF text space is 1/1000 em regardless of the font's own grid.
  const scale = 1000 / unitsPerEm
  const em = (value: number): number => Math.round(value * scale)

  const fileRef = pdf.stream(`<< /Length1 ${ttf.length} >>`, ttf)
  const descriptorRef = pdf.add([
    '<< /Type /FontDescriptor',
    `/FontName /${name}`,
    '/Flags 4',
    `/FontBBox [ ${em(ttf.readInt16BE(head.offset + 36))} ${em(ttf.readInt16BE(head.offset + 38))}`
    + ` ${em(ttf.readInt16BE(head.offset + 40))} ${em(ttf.readInt16BE(head.offset + 42))} ]`,
    '/ItalicAngle 0',
    `/Ascent ${em(ttf.readInt16BE(hhea.offset + 4))}`,
    `/Descent ${em(ttf.readInt16BE(hhea.offset + 6))}`,
    '/CapHeight 700',
    '/StemV 80',
    `/FontFile2 ${fileRef} 0 R >>`,
  ].join(' '))

  // /W maps glyph id to advance width; /DW covers everything omitted.
  const w = [...widths.entries()]
    .filter(([, value]) => value > 0)
    .map(([glyph, value]) => `${glyph}[${em(value)}]`)
    .join(' ')

  const cidRef = pdf.add([
    '<< /Type /Font /Subtype /CIDFontType2',
    `/BaseFont /${name}`,
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >>',
    `/FontDescriptor ${descriptorRef} 0 R`,
    '/DW 1000',
    `/W [ ${w} ]`,
    '/CIDToGIDMap /Identity >>',
  ].join(' '))

  const ref = pdf.add([
    '<< /Type /Font /Subtype /Type0',
    `/BaseFont /${name}`,
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
