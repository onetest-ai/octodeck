import { readFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { slidesFromRaw } from '../../../vendor/pptx/ir-from-raw.js'
import type { Paint, Run, Shape, SlideIR } from '../../../vendor/pptx/ir.js'
import { resolveTheme } from '../../../vendor/pptx/theme.js'
import { VENDORED_FACES } from '../fonts.ts'
import { embedFont, type EmbeddedFont } from './font.ts'
import { PdfBuilder } from './objects.ts'
import { decodePng } from './png.ts'

/**
 * The deck canvas is 1280x720 CSS pixels; PDF's unit is the point (1/72in)
 * and CSS pixels are 1/96in, so the page is 960x540pt and every coordinate
 * scales by 0.75. The IR stays in design pixels — this is the one conversion.
 */
const PX_TO_PT = 72 / 96
const PAGE_WIDTH = 1280 * PX_TO_PT
const PAGE_HEIGHT = 720 * PX_TO_PT

/** The fallback face, always embedded so no run is left without a font. */
const FALLBACK = 'Geist'

const FONT_DIR = new URL('../../../vendor/pptx/fonts/', import.meta.url)
const BACKDROPS = new URL('../../../vendor/pptx/backdrops/', import.meta.url)

/**
 * Which TTF backs each typeface `ir-from-raw.ts`'s `fontFace` can name.
 *
 * Derived from the shared face table rather than restated, so a font added for
 * one export format cannot go missing in another.
 */
const FONT_FILES: Record<string, string> = Object.fromEntries(
  Object.values(VENDORED_FACES).flatMap(faces => faces.map(face => [face.typeface, face.file])),
)

/** PDF colour operands from an IR paint. */
function rgb(paint: Paint): string {
  const value = parseInt(paint.hex, 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map(channel => (channel / 255).toFixed(4))
    .join(' ')
}

/** PDF's y axis grows upward; the IR's grows downward from the slide's top. */
const flipY = (y: number): number => PAGE_HEIGHT - y * PX_TO_PT
const pt = (px: number): string => (px * PX_TO_PT).toFixed(2)

/** A gradient as the IR carries it. */
interface IrGrad { stops: { pos: number, color: Paint }[], angle: number }

/**
 * Build an axial (Type 2) shading covering a rectangle.
 *
 * The IR gives stops in 0..1 along an angle in degrees; PDF wants two endpoint
 * coordinates plus a function over that axis. Two stops need one exponential
 * function, more need a Type 3 stitch across consecutive pairs.
 * @param grad - the IR gradient.
 * @param x - rect left, in points.
 * @param y - rect bottom, in points.
 * @param w - rect width, in points.
 * @param h - rect height, in points.
 * @returns the shading dictionary, or '' when there is nothing to paint.
 */
function shadingDict(grad: IrGrad, x: number, y: number, w: number, h: number): string {
  const stops = [...grad.stops].sort((a, b) => a.pos - b.pos)
  if (stops.length < 2) return ''
  const radians = (grad.angle * Math.PI) / 180
  // The axis runs through the rect's centre, long enough to span it at any
  // angle, so the gradient covers the whole shape rather than banding short.
  const cx = x + w / 2
  const cy = y + h / 2
  const half = (Math.abs(Math.cos(radians)) * w + Math.abs(Math.sin(radians)) * h) / 2
  const x0 = cx - Math.cos(radians) * half
  const y0 = cy + Math.sin(radians) * half
  const x1 = cx + Math.cos(radians) * half
  const y1 = cy - Math.sin(radians) * half

  const pair = (a: Paint, b: Paint): string =>
    `<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(a)}] /C1 [${rgb(b)}] /N 1 >>`

  let fn: string
  if (stops.length === 2) {
    fn = pair(stops[0].color, stops[1].color)
  } else {
    const functions = stops.slice(0, -1).map((stop, i) => pair(stop.color, stops[i + 1].color))
    const span = stops[stops.length - 1].pos - stops[0].pos || 1
    const bounds = stops.slice(1, -1)
      .map(stop => ((stop.pos - stops[0].pos) / span).toFixed(4))
      .join(' ')
    const encode = functions.map(() => '0 1').join(' ')
    fn = `<< /FunctionType 3 /Domain [0 1] /Functions [ ${functions.join(' ')} ]`
      + ` /Bounds [ ${bounds} ] /Encode [ ${encode} ] >>`
  }
  return `<< /ShadingType 2 /ColorSpace /DeviceRGB`
    + ` /Coords [ ${x0.toFixed(2)} ${y0.toFixed(2)} ${x1.toFixed(2)} ${y1.toFixed(2)} ]`
    + ` /Function ${fn} /Extend [ true true ] >>`
}

/** What an emitter writes into, for one page. */
interface PageSink {
  readonly ops: string[]
  readonly fonts: Map<string, EmbeddedFont>
  readonly names: Map<string, string>
  /** Shading resources met on this page, named in encounter order. */
  readonly shadings: Map<string, string>
  /** Alpha graphics states met on this page, keyed by their name. */
  readonly alphas: Map<string, number>
}

/**
 * Name the graphics state for one paint's opacity, registering it if new.
 *
 * PDF has no per-operation alpha: transparency is a graphics-state parameter,
 * so a translucent fill needs an ExtGState resource selected with `gs` before
 * it is painted. Ignoring this is not subtle — every glass panel in a theme
 * renders as flat opaque grey, which is what the first PDF export did.
 * @param paint - the paint whose alpha is wanted (0..100000, as OOXML counts).
 * @param sink - the page being written.
 * @returns the `gs` operator to emit, or '' when the paint is opaque.
 */
function alphaState(paint: Paint, sink: PageSink): string {
  const alpha = paint.alpha / 100000
  if (alpha >= 1) return ''
  const name = `GS${Math.round(alpha * 1000)}`
  sink.alphas.set(name, alpha)
  return `/${name} gs `
}

/**
 * Emit a run sequence as one text object on a shared baseline.
 *
 * The cursor advances by summed glyph widths, which ignores kerning. The
 * walker emits one text item per *measured line*, so runs are effectively
 * single-run and the drift never accumulates across a wrap.
 * @param runs - the IR runs.
 * @param x - left edge, in design pixels.
 * @param baseline - baseline y, in design pixels.
 * @param sink - the page being written.
 */
function emitRuns(runs: readonly Run[], x: number, baseline: number, sink: PageSink): void {
  let cursor = x
  for (const run of runs) {
    const font = sink.fonts.get(run.font) ?? sink.fonts.get(FALLBACK)
    const name = sink.names.get(run.font) ?? sink.names.get(FALLBACK)
    if (font === undefined || name === undefined) continue
    sink.ops.push(
      `q ${alphaState(run.color, sink)}BT ${rgb(run.color)} rg /${name} ${run.sizePt.toFixed(2)} Tf `
      + `${pt(cursor)} ${flipY(baseline).toFixed(2)} Td `
      + `${font.encode(run.text)} Tj ET Q`,
    )
    const advance = [...run.text]
      .reduce((sum, ch) => sum + (font.widths.get(font.glyphFor(ch.codePointAt(0) ?? 0)) ?? 0), 0)
    cursor += ((advance / font.unitsPerEm) * run.sizePt) / PX_TO_PT
  }
}

/**
 * A rectangle's path, with rounded corners when the IR asks for them.
 *
 * PDF has no rounded-rect primitive, so the corners are quarter Béziers. The
 * magic constant is the usual circle approximation: a control point at
 * 0.5523 of the radius puts the curve within a fraction of a percent of a
 * true arc. Emitting a plain `re` instead leaves every card and diagram node
 * visibly square against a deck that rounds them.
 * @param x - left, in points.
 * @param y - bottom, in points.
 * @param w - width, in points.
 * @param h - height, in points.
 * @param r - corner radius, in points.
 * @returns the path operators, without a paint operator.
 */
function rectPath(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h / 2)
  if (radius <= 0.01) return `${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re`
  const k = radius * 0.5523
  const n = (v: number): string => v.toFixed(2)
  const right = x + w
  const top = y + h
  return [
    `${n(x + radius)} ${n(y)} m`,
    `${n(right - radius)} ${n(y)} l`,
    `${n(right - radius + k)} ${n(y)} ${n(right)} ${n(y + radius - k)} ${n(right)} ${n(y + radius)} c`,
    `${n(right)} ${n(top - radius)} l`,
    `${n(right)} ${n(top - radius + k)} ${n(right - radius + k)} ${n(top)} ${n(right - radius)} ${n(top)} c`,
    `${n(x + radius)} ${n(top)} l`,
    `${n(x + radius - k)} ${n(top)} ${n(x)} ${n(top - radius + k)} ${n(x)} ${n(top - radius)} c`,
    `${n(x)} ${n(y + radius)} l`,
    `${n(x)} ${n(y + radius - k)} ${n(x + radius - k)} ${n(y)} ${n(x + radius)} ${n(y)} c`,
    'h',
  ].join(' ')
}

/** Paint a rect's fill, preferring a gradient when the IR carries one. */
function emitRectFill(shape: Extract<Shape, { kind: 'rect' }>, sink: PageSink): void {
  const x = shape.x * PX_TO_PT
  const y = flipY(shape.y + shape.h)
  const w = shape.w * PX_TO_PT
  const h = shape.h * PX_TO_PT
  const radius = (shape.rx ?? 0) * PX_TO_PT
  if (shape.grad !== undefined) {
    const dict = shadingDict(shape.grad as IrGrad, x, y, w, h)
    if (dict !== '') {
      // `sh` fills the current clip region and takes a *named* resource, so
      // the rect is applied as a clip and the dictionary is registered on the
      // page rather than written inline.
      const name = `Sh${sink.shadings.size}`
      sink.shadings.set(name, dict)
      sink.ops.push(`q ${rectPath(x, y, w, h, radius)} W n /${name} sh Q`)
      return
    }
  }
  if (shape.fill !== undefined) {
    sink.ops.push(`q ${alphaState(shape.fill, sink)}${rgb(shape.fill)} rg ${rectPath(x, y, w, h, radius)} f Q`)
  }
}

/** Emit one shape's operators. */
function emit(shape: Shape, sink: PageSink): void {
  switch (shape.kind) {
    case 'group':
      for (const child of shape.children) emit(child, sink)
      return
    case 'rect': {
      emitRectFill(shape, sink)
      if (shape.line !== undefined) {
        sink.ops.push(
          `q ${alphaState(shape.line.color, sink)}${rgb(shape.line.color)} RG ${pt(shape.line.w)} w `
          + `${rectPath(shape.x * PX_TO_PT, flipY(shape.y + shape.h), shape.w * PX_TO_PT, shape.h * PX_TO_PT, (shape.rx ?? 0) * PX_TO_PT)} S Q`,
        )
      }
      // Vertically centred in the box, as the OOXML backend places it.
      if (shape.runs !== undefined) emitRuns(shape.runs, shape.x, shape.y + shape.h * 0.72, sink)
      return
    }
    case 'line':
      sink.ops.push(
        `q ${alphaState(shape.color, sink)}${rgb(shape.color)} RG ${pt(shape.w)} w `
        + `${pt(shape.x1)} ${flipY(shape.y1).toFixed(2)} m `
        + `${pt(shape.x2)} ${flipY(shape.y2).toFixed(2)} l S Q`,
      )
      return
    case 'path': {
      if (shape.segs.length === 0) return
      const ops = shape.segs.map(seg => seg.c === 'C'
        ? `${pt(seg.x1)} ${flipY(seg.y1).toFixed(2)} ${pt(seg.x2)} ${flipY(seg.y2).toFixed(2)} `
          + `${pt(seg.x)} ${flipY(seg.y).toFixed(2)} c`
        : `${pt(seg.x)} ${flipY(seg.y).toFixed(2)} ${seg.c === 'M' ? 'm' : 'l'}`)
      const close = shape.closed === true ? ' h' : ''
      if (shape.fill !== undefined) {
        sink.ops.push(`q ${alphaState(shape.fill, sink)}${rgb(shape.fill)} rg ${ops.join(' ')}${close} f Q`)
      }
      if (shape.line !== undefined) {
        sink.ops.push(`q ${alphaState(shape.line.color, sink)}${rgb(shape.line.color)} RG ${pt(shape.line.w)} w ${ops.join(' ')}${close} S Q`)
      }
      return
    }
    case 'text':
      if (shape.runs !== undefined) emitRuns(shape.runs, shape.x, shape.y + shape.h * 0.72, sink)
  }
}

/** Every typeface the slides actually reference. */
function facesUsed(slides: readonly SlideIR[]): Set<string> {
  const used = new Set<string>([FALLBACK])
  const walk = (shape: Shape): void => {
    if (shape.kind === 'group') { for (const child of shape.children) walk(child); return }
    if ('runs' in shape && shape.runs !== undefined) for (const run of shape.runs) used.add(run.font)
  }
  for (const slide of slides) for (const shape of slide.shapes) walk(shape)
  return used
}

/**
 * Build a PDF from raw walker items.
 *
 * Vector throughout: text is drawn with embedded fonts rather than rasterised,
 * so the result is selectable, searchable, and a fraction of the size of a
 * screenshot-per-slide export — and it needs no browser, which is the point.
 *
 * Unlike PPTX, PDF font embedding is honoured by every reader on every
 * platform, so this is the format that renders identically everywhere.
 * @param raw - one array of walker items per slide, in slide order.
 * @param themeId - the theme the deck was displayed in.
 * @returns the complete PDF.
 * @throws {Error} when `themeId` is not a theme the snapshot knows.
 */
export async function exportPdf(raw: unknown[][], themeId: string): Promise<Buffer> {
  const theme = resolveTheme(themeId)
  const slides: SlideIR[] = slidesFromRaw(raw, theme.color.bg)
  const pdf = new PdfBuilder()

  // A "rich" theme's background is a multi-layer gradient the IR never
  // carries: PPTX gets it from a pre-baked PNG, and so does this. Painting
  // only the solid `slide.bg` instead flattens the deck's whole backdrop.
  // PDF cannot embed a PNG, so it is decoded to raw samples and re-deflated.
  let backdropRef: number | null = null
  if (theme.backdrop.rich) {
    const file = await readFile(fileURLToPath(new URL(`${themeId}.png`, BACKDROPS))).catch(() => null)
    if (file !== null) {
      const image = decodePng(file)
      backdropRef = pdf.stream(
        `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height}`
        + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode >>',
        deflateSync(image.rgb),
      )
    }
  }

  const fonts = new Map<string, EmbeddedFont>()
  const names = new Map<string, string>()
  let index = 0
  for (const typeface of facesUsed(slides)) {
    const file = FONT_FILES[typeface]
    if (file === undefined) continue
    const bytes = await readFile(fileURLToPath(new URL(file, FONT_DIR))).catch(() => null)
    if (bytes === null) continue
    fonts.set(typeface, embedFont(pdf, bytes, typeface))
    names.set(typeface, `F${index++}`)
  }
  const fontResource = `/Font << ${[...names.entries()]
    .map(([typeface, name]) => `/${name} ${fonts.get(typeface)!.ref} 0 R`)
    .join(' ')} >>`

  const contentRefs: number[] = []
  const pageResources: string[] = []
  for (const slide of slides) {
    const sink: PageSink = { ops: [], fonts, names, shadings: new Map(), alphas: new Map() }
    sink.ops.push(`q ${rgb(slide.bg)} rg 0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)} re f Q`)
    if (backdropRef !== null) {
      // Full-bleed, under everything: the image's own space is the unit
      // square, so the CTM scales it to the page.
      sink.ops.push(`q ${PAGE_WIDTH.toFixed(2)} 0 0 ${PAGE_HEIGHT.toFixed(2)} 0 0 cm /Backdrop Do Q`)
    }
    for (const shape of slide.shapes) emit(shape, sink)
    contentRefs.push(pdf.stream('<< >>', sink.ops.join('\n')))
    const shadingResource = sink.shadings.size === 0
      ? ''
      : ` /Shading << ${[...sink.shadings.entries()].map(([name, dict]) => `/${name} ${dict}`).join(' ')} >>`
    // Both /ca (fill) and /CA (stroke) so one state serves either operator.
    const alphaResource = sink.alphas.size === 0
      ? ''
      : ` /ExtGState << ${[...sink.alphas.entries()]
        .map(([name, alpha]) => `/${name} << /ca ${alpha.toFixed(3)} /CA ${alpha.toFixed(3)} >>`)
        .join(' ')} >>`
    const imageResource = backdropRef === null ? '' : ` /XObject << /Backdrop ${backdropRef} 0 R >>`
    pageResources.push(`<< ${fontResource}${shadingResource}${alphaResource}${imageResource} >>`)
  }

  // Reserved before the pages exist, because each page names its parent.
  const pagesRef = pdf.add('<< >>')
  const pageRefs = contentRefs.map((contentRef, i) => pdf.add(
    `<< /Type /Page /Parent ${pagesRef} 0 R `
    + `/MediaBox [ 0 0 ${Math.round(PAGE_WIDTH)} ${Math.round(PAGE_HEIGHT)} ] `
    + `/Resources ${pageResources[i]} /Contents ${contentRef} 0 R >>`,
  ))
  pdf.replace(pagesRef, `<< /Type /Pages /Count ${pageRefs.length} /Kids [ ${pageRefs.map(r => `${r} 0 R`).join(' ')} ] >>`)
  return pdf.build(pdf.add(`<< /Type /Catalog /Pages ${pagesRef} 0 R >>`))
}
