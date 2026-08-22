import { inflateSync } from 'node:zlib'

/** A decoded image: 8-bit RGB samples, row-major, no alpha. */
export interface RgbImage {
  readonly width: number
  readonly height: number
  /** `width * height * 3` bytes. */
  readonly rgb: Buffer
}

/** Undo one scanline's PNG filter, in place. */
function unfilter(type: number, line: Buffer, previous: Buffer, bpp: number): void {
  switch (type) {
    case 0: return
    case 1:
      for (let i = bpp; i < line.length; i++) line[i] = (line[i] + line[i - bpp]) & 0xff
      return
    case 2:
      for (let i = 0; i < line.length; i++) line[i] = (line[i] + previous[i]) & 0xff
      return
    case 3:
      for (let i = 0; i < line.length; i++) {
        const left = i >= bpp ? line[i - bpp] : 0
        line[i] = (line[i] + ((left + previous[i]) >> 1)) & 0xff
      }
      return
    case 4:
      for (let i = 0; i < line.length; i++) {
        const a = i >= bpp ? line[i - bpp] : 0
        const b = previous[i]
        const c = i >= bpp ? previous[i - bpp] : 0
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
      return
    default:
      throw new Error(`unsupported PNG filter type ${type}`)
  }
}

/**
 * Decode a PNG to raw RGB samples.
 *
 * PDF cannot embed a PNG: its image XObjects carry raw samples under a filter
 * PDF itself knows, and PNG's per-scanline prediction is not one of them. So
 * the backdrop has to be decoded here and re-compressed as a Flate image.
 *
 * Deliberately narrow — 8-bit non-interlaced truecolour, with or without
 * alpha, which is what a Chromium screenshot produces and therefore what
 * `pptx:bake` writes. Anything else fails loudly rather than rendering wrong.
 * Alpha is dropped: a backdrop is painted first and full-bleed, so it composites
 * against nothing.
 * @param png - the PNG file.
 * @returns the decoded image.
 * @throws {Error} when the file is not a PNG this decoder supports.
 */
export function decodePng(png: Buffer): RgbImage {
  if (png.length < 8 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')

  let width = 0
  let height = 0
  let colorType = -1
  const idat: Buffer[] = []
  let at = 8
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at)
    const type = png.subarray(at + 4, at + 8).toString('latin1')
    const body = png.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const bitDepth = body[8]
      colorType = body[9]
      const interlace = body[12]
      if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`)
      if (interlace !== 0) throw new Error('interlaced PNG is not supported')
      if (colorType !== 2 && colorType !== 6) {
        throw new Error(`unsupported PNG colour type ${colorType} (need truecolour)`)
      }
    } else if (type === 'IDAT') {
      idat.push(Buffer.from(body))
    } else if (type === 'IEND') {
      break
    }
    at += 12 + length
  }
  if (width === 0 || height === 0) throw new Error('PNG has no IHDR')

  const channels = colorType === 6 ? 4 : 3
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const rgb = Buffer.alloc(width * height * 3)
  let previous = Buffer.alloc(stride)
  let source = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[source]
    const line = Buffer.from(raw.subarray(source + 1, source + 1 + stride))
    source += 1 + stride
    unfilter(filter, line, previous, channels)
    for (let x = 0; x < width; x++) {
      const from = x * channels
      const to = (y * width + x) * 3
      rgb[to] = line[from]
      rgb[to + 1] = line[from + 1]
      rgb[to + 2] = line[from + 2]
    }
    previous = line
  }
  return { width, height, rgb }
}
