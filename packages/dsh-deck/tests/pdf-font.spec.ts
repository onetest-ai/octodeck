import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { embedFont } from '../src/export/pdf/font.ts'
import { PdfBuilder } from '../src/export/pdf/objects.ts'

const TTF = fileURLToPath(new URL('../vendor/pptx/fonts/Geist-Regular.ttf', import.meta.url))
const load = async () => readFile(TTF)

describe('embedFont', () => {
  it('produces a Type0 font backed by the raw font program', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await load(), 'Geist')
    const out = pdf.build(pdf.add(`<< /Type /Catalog /F ${font.ref} 0 R >>`)).toString('latin1')
    expect(out).toContain('/Subtype /Type0')
    expect(out).toContain('/Encoding /Identity-H')
    expect(out).toContain('/FontFile2')
    expect(out).toContain('/CIDToGIDMap /Identity')
  })

  it('maps characters to real glyph ids through the font cmap', async () => {
    const font = embedFont(new PdfBuilder(), await load(), 'Geist')
    // 0 is .notdef — a cmap that failed to parse would return it for everything.
    expect(font.glyphFor('A'.codePointAt(0)!)).toBeGreaterThan(0)
    expect(font.glyphFor('g'.codePointAt(0)!)).toBeGreaterThan(0)
    expect(font.glyphFor('A'.codePointAt(0)!)).not.toBe(font.glyphFor('B'.codePointAt(0)!))
  })

  it('encodes text as big-endian glyph ids in a hex string', async () => {
    const font = embedFont(new PdfBuilder(), await load(), 'Geist')
    const hex = font.encode('A')
    expect(hex).toMatch(/^<[0-9A-F]{4}>$/)
    expect(parseInt(hex.slice(1, 5), 16)).toBe(font.glyphFor('A'.codePointAt(0)!))
    expect(font.encode('AB')).toMatch(/^<[0-9A-F]{8}>$/)
  })

  it('reports advance widths in font units', async () => {
    const font = embedFont(new PdfBuilder(), await load(), 'Geist')
    expect(font.unitsPerEm).toBeGreaterThan(0)
    const wide = font.widths.get(font.glyphFor('W'.codePointAt(0)!)) ?? 0
    const narrow = font.widths.get(font.glyphFor('i'.codePointAt(0)!)) ?? 0
    expect(wide).toBeGreaterThan(narrow)
  })

  it('names the font without spaces, which a PDF name cannot carry', async () => {
    const pdf = new PdfBuilder()
    const font = embedFont(pdf, await load(), 'Geist SemiBold')
    const out = pdf.build(pdf.add(`<< /Type /Catalog /F ${font.ref} 0 R >>`)).toString('latin1')
    expect(out).toContain('/GeistSemiBold')
    expect(out).not.toContain('/Geist SemiBold')
  })

  it('rejects a file that is not a usable font, naming it', async () => {
    expect(() => embedFont(new PdfBuilder(), Buffer.alloc(64), 'Broken')).toThrow(/Broken/)
  })
})
