// Pixel-tight extractor: load the real rendered deck at 1:1 (1280×720) and
// transcribe each slide's DOM to Scene IR by MEASURING it — never re-deriving
// layout. HTML boxes come from computed styles; text from per-line client rects
// (so wrapping is identical by construction); SVG is translated to native vector
// (paths→freeform curves, gradients→gradient fills, markers→arrowheads).
//   npm run dev   # the deck at :9001
//   used by build.ts
import { chromium } from 'playwright'
import { WALKER } from './walker.ts'
import { parseColor, toHex, alphaVal } from './color.ts'
import type { SlideIR, Shape, Seg, Grad, Paint } from './ir.ts'

const TEXT_DY = 0 // vertical nudge for text baseline alignment (calibrated by render)

// ─────────────────────────────────────────────────────────────────────────────
// Node-side: map the neutral tree to Scene IR (resolve colours to Paint).
// ─────────────────────────────────────────────────────────────────────────────
const PT = (px: number) => +(px * 0.75).toFixed(2)
const toPaint = (css: string): Paint => { const c = parseColor(css); return { hex: toHex(c), alpha: alphaVal(c) } }
const toGrad = (g: any): Grad => ({ angle: g.angle, stops: g.stops.map((s: any) => ({ pos: s.pos, color: toPaint(s.color) })) })
// Map a CSS font stack + weight to a precise installed/embeddable face. For Geist
// we name the exact weight family (so the renderer can't synthesize a too-heavy
// bold); for system stacks we fall back to a safe face + the bold flag.
function fontFace(family: string, weight: number): { name: string; bold: boolean } {
  const first = (family.split(',')[0] || '').trim().replace(/^["']|["']$/g, '')
  if (/geist mono/i.test(first)) return { name: weight >= 500 ? 'Geist Mono Medium' : 'Geist Mono', bold: false }
  if (/geist/i.test(first)) return { name: weight >= 600 ? 'Geist SemiBold' : weight >= 500 ? 'Geist Medium' : 'Geist', bold: false }
  if (/switzer/i.test(first)) return { name: weight >= 700 ? 'Switzer Bold' : weight >= 600 ? 'Switzer Semibold' : weight >= 500 ? 'Switzer Medium' : 'Switzer', bold: false }
  if (/inter/i.test(first)) return { name: 'Inter', bold: weight >= 600 }
  if (/mono|consol|menlo|courier|cascadia/i.test(family)) return { name: 'Consolas', bold: weight >= 600 }
  return { name: 'Calibri', bold: weight >= 600 }
}
const stroke = (s: any) => (s ? { color: toPaint(s.color), w: s.w, dash: !!s.dash, arrow: !!s.arrow } : undefined)

function mapItem(it: any): Shape | null {
  switch (it.t) {
    case 'group': { const children = it.children.map(mapItem).filter(Boolean) as Shape[]; return children.length ? { kind: 'group', name: it.name, children } : null }
    case 'rect': return { kind: 'rect', x: it.x, y: it.y, w: it.w, h: it.h, rx: Math.min(it.rx || 0, Math.min(it.w, it.h) / 2), fill: it.fill ? toPaint(it.fill) : undefined, grad: it.grad ? toGrad(it.grad) : undefined, line: stroke(it.stroke) }
    case 'ellipse': return { kind: 'rect', prst: 'ellipse', x: it.x, y: it.y, w: it.w, h: it.h, fill: it.fill ? toPaint(it.fill) : undefined, grad: it.grad ? toGrad(it.grad) : undefined, line: stroke(it.stroke) }
    case 'line': return { kind: 'line', x1: it.x1, y1: it.y1, x2: it.x2, y2: it.y2, color: toPaint(it.color), w: it.w, dash: !!it.dash, arrow: !!it.arrow }
    case 'path': return { kind: 'path', segs: it.segs as Seg[], closed: !!it.closed, fill: it.fill ? toPaint(it.fill) : undefined, grad: it.grad ? toGrad(it.grad) : undefined, line: stroke(it.stroke) }
    case 'text': {
      if (!it.text.trim()) return null
      const f = fontFace(it.font, it.weight)
      return { kind: 'text', x: it.x, y: it.y + TEXT_DY, w: it.w + 6, h: it.h, tight: true, align: 'l', valign: 'm',
        runs: [{ text: it.text, font: f.name, sizePt: PT(it.sizePx), color: toPaint(it.color), bold: f.bold, italic: !!it.italic, spacingPt: it.spacingPx ? PT(it.spacingPx) : undefined }] }
    }
  }
  return null
}

/** Read the deck's slide count from its progress counter (".octo-counter" → "1 / N"). */
async function detectCount(page: any, deckUrl: string, themeId: string): Promise<number> {
  await page.goto(`${deckUrl}?theme=${themeId}`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(300)
  const n = await page.evaluate(() => {
    const m = (document.querySelector('.octo-counter')?.textContent || '').match(/\/\s*(\d+)/)
    return m ? +m[1] : 0
  })
  return n || 10
}

/**
 * Convert raw walker items into Scene IR.
 *
 * Split out of {@link extractDeck} because the harness plugin runs the walker
 * in the browser it already has and posts the raw items to Node: the mapping
 * is not browser knowledge, and keeping it here keeps `color.ts` out of a
 * browser bundle.
 * @param raw - one array of walker items per slide, in slide order.
 * @param bg - the resolved theme background, applied to every slide.
 * @returns one `SlideIR` per input slide.
 */
export function slidesFromRaw(raw: unknown[][], bg: Paint): SlideIR[] {
  return raw.map((items, i) => ({
    name: `Slide ${i + 1}`,
    bg,
    shapes: (items as any[]).map(mapItem).filter(Boolean) as Shape[],
  }))
}

export async function extractDeck(deckUrl: string, themeId: string, bg: Paint, count = 0): Promise<SlideIR[]> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  if (!count) count = Number(process.env.SLIDES) || await detectCount(page, deckUrl, themeId)
  const raw: unknown[][] = []
  for (let n = 1; n <= count; n++) {
    await page.goto(`${deckUrl}?theme=${themeId}&_=${n}#/${n}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document as any).fonts.ready)
    await page.waitForTimeout(350)
    // Stringified with an explicit `document`: WALKER now takes the document
    // to measure, and a Document is not serializable across the Playwright
    // boundary, so it is applied inside the page instead of passed in.
    raw.push(await page.evaluate(`(${WALKER.toString()})(document)`) as unknown[])
  }
  await browser.close()
  return slidesFromRaw(raw, bg)
}
