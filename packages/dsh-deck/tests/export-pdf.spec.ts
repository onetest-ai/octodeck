import { describe, expect, it } from 'vitest'
import { exportPdf } from '../src/export/pdf/index.ts'

const text = (over: Record<string, unknown> = {}) => ({
  t: 'text', x: 100, y: 80, w: 400, h: 40, text: 'Hello',
  font: 'Geist', sizePx: 32, weight: 600, color: 'rgb(255, 255, 255)', italic: false, spacingPx: 0, ...over,
})

const RAW: unknown[][] = [
  [{ t: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: 'rgb(10, 10, 12)' }, text()],
  [text({ text: 'Second', sizePx: 24, weight: 400 })],
]

describe('exportPdf', () => {
  it('writes one page per slide at 960x540 pt', async () => {
    const out = (await exportPdf(RAW, 'octo-glass')).toString('latin1')
    expect(out.startsWith('%PDF-1.7')).toBe(true)
    // 1280x720 CSS px at 96dpi is 960x540pt; the pixel canvas is not the page box.
    expect(out).toContain('/MediaBox [ 0 0 960 540 ]')
    expect(out.match(/\/Type \/Page[^s]/g)).toHaveLength(2)
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

  it('paints the theme background on every page', async () => {
    const out = (await exportPdf(RAW, 'midnight')).toString('latin1')
    expect(out.match(/0 0 960\.00 540\.00 re f/g)?.length).toBe(2)
  })

  it('registers a gradient as a named page resource, never inline', async () => {
    // `sh` takes a named resource; an inline dictionary does not parse.
    const grad = [[{
      t: 'rect', x: 0, y: 0, w: 1280, h: 720,
      grad: { angle: 90, stops: [{ pos: 0, color: 'rgb(0,0,0)' }, { pos: 1, color: 'rgb(255,255,255)' }] },
    }]]
    const out = (await exportPdf(grad, 'midnight')).toString('latin1')
    expect(out).toContain('/Shading << /Sh0')
    expect(out).toContain('/ShadingType 2')
    expect(out).toMatch(/\/Sh0 sh/)
  })

  it('stitches a multi-stop gradient with a Type 3 function', async () => {
    const grad = [[{
      t: 'rect', x: 0, y: 0, w: 1280, h: 720,
      grad: {
        angle: 0,
        stops: [
          { pos: 0, color: 'rgb(0,0,0)' },
          { pos: 0.5, color: 'rgb(255,0,0)' },
          { pos: 1, color: 'rgb(255,255,255)' },
        ],
      },
    }]]
    const out = (await exportPdf(grad, 'midnight')).toString('latin1')
    expect(out).toContain('/FunctionType 3')
  })

  it('rejects an unknown theme', async () => {
    await expect(exportPdf(RAW, 'no-such-theme')).rejects.toThrow(/theme/i)
  })

  it('exports an empty deck without throwing', async () => {
    const out = (await exportPdf([], 'midnight')).toString('latin1')
    expect(out).toContain('/Count 0')
  })
})

describe('exportPdf shapes', () => {
  it('rounds a rect’s corners with Béziers when the IR asks for a radius', async () => {
    const rounded = [[{ t: 'rect', x: 40, y: 40, w: 200, h: 100, rx: 12, fill: 'rgb(20,20,20)' }]]
    const out = (await exportPdf(rounded, 'midnight')).toString('latin1')
    // A plain `re` would leave every card and diagram node visibly square.
    expect(out).toMatch(/ c\b/)
    expect(out).not.toMatch(/30\.00 [\d.]+ 150\.00 75\.00 re/)
  })

  it('uses a plain rectangle when there is no radius', async () => {
    const square = [[{ t: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: 'rgb(20,20,20)' }]]
    const out = (await exportPdf(square, 'midnight')).toString('latin1')
    expect(out).toContain('re f')
  })

  it('carries a translucent fill as an ExtGState, not as an opaque colour', async () => {
    // rgba at 20% must not render as flat opaque grey, which is what a writer
    // that ignores alpha produces for every glass panel.
    const glass = [[{ t: 'rect', x: 0, y: 0, w: 100, h: 100, fill: 'rgba(255, 255, 255, 0.2)' }]]
    const out = (await exportPdf(glass, 'midnight')).toString('latin1')
    expect(out).toContain('/ExtGState')
    expect(out).toMatch(/\/ca 0\.2\d*/)
    expect(out).toMatch(/\/GS\d+ gs/)
  })

  it('embeds the baked backdrop for a rich theme, as raw samples', async () => {
    // PDF cannot embed a PNG; it must be decoded and re-deflated.
    const out = (await exportPdf([[]], 'octo-glass')).toString('latin1')
    expect(out).toContain('/Subtype /Image')
    expect(out).toContain('/Filter /FlateDecode')
    expect(out).toContain('/Backdrop Do')
  })

  it('paints no backdrop image for a flat theme', async () => {
    const out = (await exportPdf([[]], 'midnight')).toString('latin1')
    expect(out).not.toContain('/Backdrop Do')
  })
})
