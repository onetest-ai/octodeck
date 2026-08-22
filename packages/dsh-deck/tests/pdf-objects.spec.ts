import { describe, expect, it } from 'vitest'
import { PdfBuilder, pdfString } from '../src/export/pdf/objects.ts'

describe('pdfString', () => {
  it('escapes the three characters a literal string cannot carry raw', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)')
  })

  it('leaves ordinary text alone', () => {
    expect(pdfString('Slide 1')).toBe('(Slide 1)')
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

  it('points every xref entry at the byte where its object starts', () => {
    const pdf = new PdfBuilder()
    pdf.add('<< /Type /Pages >>')
    const root = pdf.add('<< /Type /Catalog >>')
    const out = pdf.build(root).toString('latin1')
    const table = out.slice(out.indexOf('xref'))
    const offsets = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]))
    expect(offsets).toHaveLength(2)
    offsets.forEach((offset, index) => {
      // A reader seeks here and expects "<n> 0 obj"; a wrong offset is the
      // classic way to produce a file that opens blank.
      expect(out.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`))
    })
  })

  it('writes a stream with a Length matching its payload', () => {
    const pdf = new PdfBuilder()
    const ref = pdf.stream('<< /Type /Test >>', 'hello')
    const out = pdf.build(pdf.add(`<< /Type /Catalog /X ${ref} 0 R >>`)).toString('latin1')
    expect(out).toContain('/Length 5')
    expect(out).toContain('hello')
  })

  it('carries binary stream payloads through unchanged', () => {
    const pdf = new PdfBuilder()
    const bytes = Buffer.from([0x00, 0x01, 0x00, 0x00, 0xff, 0xfe])
    const ref = pdf.stream('<< >>', bytes)
    const out = pdf.build(pdf.add(`<< /Type /Catalog /F ${ref} 0 R >>`))
    // An embedded font program is binary; any re-encoding corrupts it.
    expect(out.includes(bytes)).toBe(true)
  })

  it('replaces a reserved object, so a parent can be referenced before it is known', () => {
    const pdf = new PdfBuilder()
    const pages = pdf.add('<< >>')
    const page = pdf.add(`<< /Type /Page /Parent ${pages} 0 R >>`)
    pdf.replace(pages, `<< /Type /Pages /Kids [ ${page} 0 R ] /Count 1 >>`)
    const out = pdf.build(pdf.add(`<< /Type /Catalog /Pages ${pages} 0 R >>`)).toString('latin1')
    expect(out).toContain('/Type /Pages')
    expect(out).toContain(`/Kids [ ${page} 0 R ]`)
  })
})
