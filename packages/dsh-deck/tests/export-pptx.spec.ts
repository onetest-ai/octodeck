import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { exportPptx } from '../src/export/pptx.ts'

/** Read one part out of a packaged archive. */
function readPart(buf: Buffer, want: string): string | null {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const local = buf.readUInt32LE(at + 42)
    if (name === want) {
      const compSize = buf.readUInt32LE(local + 18)
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      return inflateRawSync(buf.subarray(start, start + compSize)).toString('utf8')
    }
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return null
}

/** Every part name, in archive order. */
function entryNames(buf: Buffer): string[] {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28)
    names.push(buf.subarray(at + 46, at + 46 + nameLen).toString('utf8'))
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32)
  }
  return names
}

/** Two slides of walker items, in the shape WALKER actually emits. */
const RAW: unknown[][] = [
  [
    { t: 'rect', x: 0, y: 0, w: 1280, h: 720, fill: 'rgb(10, 10, 12)' },
    {
      t: 'text', x: 100, y: 80, w: 400, h: 40, text: 'Hello',
      font: 'Geist', sizePx: 32, weight: 600, color: 'rgb(255, 255, 255)', italic: false, spacingPx: 0,
    },
  ],
  [{
    t: 'text', x: 60, y: 60, w: 300, h: 30, text: 'Second',
    font: 'Geist', sizePx: 24, weight: 400, color: 'rgb(255, 255, 255)', italic: false, spacingPx: 0,
  }],
]

describe('exportPptx', () => {
  it('packages a presentation with one slide part per input slide', async () => {
    const names = entryNames(await exportPptx(RAW, 'octo-glass'))
    expect(names[0]).toBe('[Content_Types].xml')
    expect(names).toContain('ppt/presentation.xml')
    expect(names.filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(2)
  })

  it('carries each slide’s text into its own part, in order', async () => {
    const buf = await exportPptx(RAW, 'octo-glass')
    expect(readPart(buf, 'ppt/slides/slide1.xml')).toContain('Hello')
    expect(readPart(buf, 'ppt/slides/slide2.xml')).toContain('Second')
  })

  it('embeds the theme’s fonts, so the deck is not left to a substituted face', async () => {
    const names = entryNames(await exportPptx(RAW, 'octo-glass'))
    expect(names.filter(name => name.startsWith('ppt/fonts/')).length).toBeGreaterThan(0)
  })

  it('embeds a baked backdrop for a rich theme', async () => {
    // Rich themes paint a gradient the OOXML fill cannot express, so the
    // export carries a pre-baked image instead. A missing one would silently
    // flatten the deck's background.
    const names = entryNames(await exportPptx(RAW, 'octo-glass'))
    expect(names.some(name => name.startsWith('ppt/media/'))).toBe(true)
  })

  it('uses a native solid fill for a flat theme, with no image part', async () => {
    const names = entryNames(await exportPptx(RAW, 'midnight'))
    expect(names.some(name => name.startsWith('ppt/media/'))).toBe(false)
  })

  it('rejects an unknown theme rather than exporting a mis-themed deck', async () => {
    await expect(exportPptx(RAW, 'no-such-theme')).rejects.toThrow(/theme/i)
  })

  it('exports an empty deck without throwing', async () => {
    const names = entryNames(await exportPptx([], 'midnight'))
    expect(names[0]).toBe('[Content_Types].xml')
  })
})
