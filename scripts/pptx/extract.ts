// Pixel-tight extractor: load the real rendered deck at 1:1 (1280×720) and
// transcribe each slide's DOM to Scene IR by MEASURING it — never re-deriving
// layout. HTML boxes come from computed styles; text from per-line client rects
// (so wrapping is identical by construction); SVG is translated to native vector
// (paths→freeform curves, gradients→gradient fills, markers→arrowheads).
//   npm run dev   # the deck at :9001
//   used by build.ts
import { chromium } from 'playwright'
import { parseColor, toHex, alphaVal } from './color.ts'
import type { SlideIR, Shape, Seg, Grad, Paint } from './ir.ts'

const TEXT_DY = 0 // vertical nudge for text baseline alignment (calibrated by render)

// ─────────────────────────────────────────────────────────────────────────────
// Browser-side walker. Self-contained (no closures) — Playwright stringifies it.
// Returns a neutral, JSON-serializable tree; colours stay as CSS strings and are
// resolved to Paint on the Node side.
// ─────────────────────────────────────────────────────────────────────────────
/* eslint-disable */
function WALKER(): any[] {
  const NONE = /^(transparent|rgba?\(0,\s*0,\s*0,\s*0\))$/
  const slides = Array.from(document.querySelectorAll('.octo-slide')) as HTMLElement[]
  const root = slides[slides.length - 1]
  if (!root) return []
  const sb = root.getBoundingClientRect()
  const OX = sb.left, OY = sb.top
  const num = (v: string) => parseFloat(v) || 0
  const has = (c: string) => !!c && !NONE.test(c.replace(/\s+/g, m => m))
  const hasCol = (c: string) => !!c && c !== 'transparent' && c !== 'none' && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(c)

  // — text: split a text node into per-line rectangles via char ranges —
  function textItems(node: Text, parent: Element, out: any[]) {
    const s = node.nodeValue || ''
    if (!s.trim()) return
    const cs = getComputedStyle(parent)
    const range = document.createRange()
    type L = { top: number; left: number; right: number; bottom: number; text: string }
    const lines: L[] = []
    let cur: L | null = null
    for (let c = 0; c < s.length; c++) {
      range.setStart(node, c); range.setEnd(node, c + 1)
      const r = range.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) { if (cur) cur.text += s[c]; continue }
      if (!cur || Math.abs(cur.top - r.top) > 3) { cur = { top: r.top, left: r.left, right: r.right, bottom: r.bottom, text: s[c] }; lines.push(cur) }
      else { cur.right = Math.max(cur.right, r.right); cur.left = Math.min(cur.left, r.left); cur.bottom = Math.max(cur.bottom, r.bottom); cur.text += s[c] }
    }
    const sizePx = num(cs.fontSize), weight = parseInt(cs.fontWeight) || 400
    const italic = cs.fontStyle.indexOf('italic') >= 0
    const spacingPx = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing)
    const tt = cs.textTransform
    const cast = (s: string) => tt === 'uppercase' ? s.toUpperCase() : tt === 'lowercase' ? s.toLowerCase() : tt === 'capitalize' ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s
    for (const L of lines) {
      const text = cast(L.text.replace(/\s+$/, ''))
      if (!text) continue
      out.push({ t: 'text', x: L.left - OX, y: L.top - OY, w: L.right - L.left, h: L.bottom - L.top,
        text, font: cs.fontFamily, sizePx, weight, color: cs.color, italic, spacingPx })
    }
  }

  function emitBox(el: Element, out: any[]) {
    const cs: any = getComputedStyle(el), r = el.getBoundingClientRect()
    if (r.width < 0.5 || r.height < 0.5) return
    const bg = cs.backgroundColor, solidBg = hasCol(bg)
    // read each border side independently (cells often have only a bottom rule)
    const S = ['Top', 'Right', 'Bottom', 'Left'].map((d) => ({ w: num(cs['border' + d + 'Width']), c: cs['border' + d + 'Color'], s: cs['border' + d + 'Style'] }))
    const vis = S.map((b) => b.w > 0 && hasCol(b.c) && b.s !== 'none')
    const uniform = vis.every(Boolean) && S.every((b) => b.w === S[0].w && b.c === S[0].c)
    const radius = num(cs.borderTopLeftRadius)
    if (solidBg || (uniform && vis[0]))
      out.push({ t: 'rect', x: r.left - OX, y: r.top - OY, w: r.width, h: r.height, rx: radius,
        fill: solidBg ? bg : null, stroke: uniform && vis[0] ? { color: S[0].c, w: S[0].w, dash: S[0].s === 'dashed' } : null })
    if (!uniform) { // emit each visible side as a line (bottom-only dividers, etc.)
      const x0 = r.left - OX, y0 = r.top - OY, x1 = r.right - OX, y1 = r.bottom - OY
      const seg = (a: number, b: number, c: number, d: number, bd: any) => out.push({ t: 'line', x1: a, y1: b, x2: c, y2: d, color: bd.c, w: bd.w, dash: bd.s === 'dashed', arrow: false })
      if (vis[0]) seg(x0, y0, x1, y0, S[0])
      if (vis[1]) seg(x1, y0, x1, y1, S[1])
      if (vis[2]) seg(x0, y1, x1, y1, S[2])
      if (vis[3]) seg(x0, y0, x0, y1, S[3])
    }
  }

  // — SVG → native shapes —
  function collectGrads(svg: Element): Record<string, any> {
    const map: Record<string, any> = {}
    svg.querySelectorAll('linearGradient').forEach((g) => {
      const stops = Array.from(g.querySelectorAll('stop')).map((st) => {
        const o = st.getAttribute('offset') || '0'
        const pos = o.indexOf('%') >= 0 ? parseFloat(o) / 100 : parseFloat(o)
        return { pos: pos || 0, color: getComputedStyle(st).stopColor }
      })
      const x1 = num(g.getAttribute('x1') || '0'), y1 = num(g.getAttribute('y1') || '0')
      const x2 = g.getAttribute('x2') != null ? num(g.getAttribute('x2')!) : 1, y2 = num(g.getAttribute('y2') || '0')
      map['#' + g.id] = { stops, angle: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI }
    })
    return map
  }
  function gradOf(fillStr: string, grads: Record<string, any>) {
    const m = fillStr && fillStr.match(/url\(["']?(#[^"')]+)["']?\)/)
    return m ? grads[m[1]] || null : null
  }
  function parsePath(d: string): any[] {
    const segs: any[] = []
    const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g
    let m: RegExpExecArray | null, cx = 0, cy = 0, sx = 0, sy = 0
    while ((m = re.exec(d))) {
      const cmd = m[1]
      const a = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number)
      const up = cmd.toUpperCase(), rel = cmd !== up
      let i = 0
      const X = (v: number) => (rel ? cx + v : v), Y = (v: number) => (rel ? cy + v : v)
      if (up === 'M') { cx = X(a[0]); cy = Y(a[1]); sx = cx; sy = cy; segs.push({ c: 'M', x: cx, y: cy }); for (i = 2; i < a.length; i += 2) { cx = X(a[i]); cy = Y(a[i + 1]); segs.push({ c: 'L', x: cx, y: cy }) } }
      else if (up === 'L') { for (i = 0; i < a.length; i += 2) { cx = X(a[i]); cy = Y(a[i + 1]); segs.push({ c: 'L', x: cx, y: cy }) } }
      else if (up === 'H') { for (i = 0; i < a.length; i++) { cx = X(a[i]); segs.push({ c: 'L', x: cx, y: cy }) } }
      else if (up === 'V') { for (i = 0; i < a.length; i++) { cy = Y(a[i]); segs.push({ c: 'L', x: cx, y: cy }) } }
      else if (up === 'C') { for (i = 0; i + 5 < a.length; i += 6) { const p = { c: 'C', x1: X(a[i]), y1: Y(a[i + 1]), x2: X(a[i + 2]), y2: Y(a[i + 3]), x: X(a[i + 4]), y: Y(a[i + 5]) }; cx = p.x; cy = p.y; segs.push(p) } }
      else if (up === 'Z') { segs.push({ c: 'Z' }); cx = sx; cy = sy }
    }
    return segs
  }
  function svgEl(el: Element, m: DOMMatrix, grads: Record<string, any>, out: any[]) {
    const cs = getComputedStyle(el)
    const tp = (x: number, y: number) => ({ x: m.a * x + m.c * y + m.e - OX, y: m.b * x + m.d * y + m.f - OY })
    const sc = Math.hypot(m.a, m.b) || 1
    const fillStr = cs.fill, strokeStr = cs.stroke
    const fill = hasCol(fillStr) && fillStr.indexOf('url') < 0 ? fillStr : null
    const grad = gradOf(fillStr, grads)
    const sw = num(cs.strokeWidth) * sc
    const stroke = hasCol(strokeStr) && sw > 0 ? { color: strokeStr, w: sw, dash: cs.strokeDasharray !== 'none', arrow: !!el.getAttribute('marker-end') } : null
    const tag = el.tagName.toLowerCase()
    if (tag === 'rect') {
      const p = tp(num(el.getAttribute('x') || '0'), num(el.getAttribute('y') || '0'))
      out.push({ t: 'rect', x: p.x, y: p.y, w: num(el.getAttribute('width') || '0') * sc, h: num(el.getAttribute('height') || '0') * sc, rx: num(el.getAttribute('rx') || '0') * sc, fill, grad, stroke })
    } else if (tag === 'circle' || tag === 'ellipse') {
      const cx = num(el.getAttribute('cx') || '0'), cy = num(el.getAttribute('cy') || '0')
      const rx = num(el.getAttribute('r') || el.getAttribute('rx') || '0'), ry = num(el.getAttribute('r') || el.getAttribute('ry') || '0')
      const p = tp(cx - rx, cy - ry)
      out.push({ t: 'ellipse', x: p.x, y: p.y, w: rx * 2 * sc, h: ry * 2 * sc, fill, grad, stroke })
    } else if (tag === 'line') {
      if (!hasCol(strokeStr) || sw <= 0) return
      const a = tp(num(el.getAttribute('x1') || '0'), num(el.getAttribute('y1') || '0'))
      const b = tp(num(el.getAttribute('x2') || '0'), num(el.getAttribute('y2') || '0'))
      out.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: strokeStr, w: sw, dash: cs.strokeDasharray !== 'none', arrow: !!el.getAttribute('marker-end') })
    } else if (tag === 'path' || tag === 'polygon' || tag === 'polyline') {
      let raw: any[]
      if (tag === 'path') raw = parsePath(el.getAttribute('d') || '')
      else { const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number); raw = []; for (let i = 0; i < pts.length; i += 2) raw.push({ c: i === 0 ? 'M' : 'L', x: pts[i], y: pts[i + 1] }); if (tag === 'polygon') raw.push({ c: 'Z' }) }
      const segs: any[] = []
      let closed = false
      for (const g of raw) {
        if (g.c === 'Z') { closed = true; continue }
        if (g.c === 'C') { const p1 = tp(g.x1, g.y1), p2 = tp(g.x2, g.y2), p = tp(g.x, g.y); segs.push({ c: 'C', x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, x: p.x, y: p.y }) }
        else { const p = tp(g.x, g.y); segs.push({ c: g.c, x: p.x, y: p.y }) }
      }
      if (segs.length) out.push({ t: 'path', segs, closed, fill, grad, stroke })
    } else if (tag === 'text') {
      const r = (el as any).getBoundingClientRect()
      if (r.width < 0.5) return
      out.push({ t: 'text', x: r.left - OX, y: r.top - OY, w: r.width, h: r.height, text: el.textContent || '',
        font: cs.fontFamily, sizePx: num(cs.fontSize), weight: parseInt(cs.fontWeight) || 400, color: hasCol(fillStr) ? fillStr : cs.color, italic: false, spacingPx: cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing) })
    }
  }
  function emitSvg(svg: Element, out: any[]) {
    const grads = collectGrads(svg)
    const kids: any[] = []
    const all = svg.querySelectorAll('rect, circle, ellipse, line, path, polygon, polyline, text')
    all.forEach((el) => {
      if (el.closest('defs') || el.closest('marker')) return
      // The native-shape query must not reach inside a foreignObject: that
      // subtree is ordinary HTML, measured below by the HTML walker rather
      // than through the SVG transform path.
      if (el.closest('foreignObject')) return
      const m = (el as any).getScreenCTM(); if (m) svgEl(el, m, grads, kids)
    })
    // A foreignObject holds HTML, which the SVG translator cannot express —
    // Octodeck's diagram nodes are `div.octo-dnode` inside one. Walking them
    // through `step` is what keeps them in the export; without it a diagram
    // exports as bare connectors with every node box silently missing, which
    // looks like a rendering bug rather than an extraction gap.
    svg.querySelectorAll('foreignObject').forEach((fo) => {
      fo.childNodes.forEach((n) => { if (n.nodeType === 1) step(n as Element, kids) })
    })
    if (kids.length) out.push({ t: 'group', name: 'diagram', children: kids })
  }

  const BOUNDARY = '.octo-slide-header, .fx-foot, .octo-card, .fx-cmp, .fx-uw-card, .fx-team-lane, .fx-fm-fg, .fx-fm-band, .fx-stack-band, .fx-stack-tier, .fx-stack-factories, .fx-team-conn'
  function label(el: Element) { return (el.className && typeof el.className === 'string' ? el.className.split(' ')[0] : el.tagName.toLowerCase()) }
  function visible(el: Element) { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity !== 0 }
  function step(el: Element, out: any[]) {
    if (!visible(el)) return
    if (el.tagName.toLowerCase() === 'svg') { emitSvg(el, out); return }
    const boundary = (el as any).matches && el.matches(BOUNDARY)
    const target = boundary ? [] : out
    emitBox(el, target)
    // synthesize the ::marker bullet (a pseudo-element, not in the DOM)
    if (el.tagName === 'LI') {
      const cs = getComputedStyle(el), rr = (el as any).getClientRects()[0]
      if (rr && cs.listStyleType !== 'none' && cs.listStylePosition !== 'inside') {
        const ch = cs.listStyleType === 'disc' || cs.listStyleType === 'circle' ? '•' : ''
        if (ch) target.push({ t: 'text', x: rr.left - OX - 16, y: rr.top - OY, w: 14, h: rr.height, text: ch,
          font: cs.fontFamily, sizePx: num(cs.fontSize), weight: 400, color: cs.color, italic: false, spacingPx: 0 })
      }
    }
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) textItems(n as Text, el, target)
      else if (n.nodeType === 1) step(n as Element, target)
    })
    if (boundary) out.push({ t: 'group', name: label(el), children: target })
  }

  const out: any[] = []
  root.childNodes.forEach((n) => { if (n.nodeType === 1) step(n as Element, out) })
  return out
}
/* eslint-enable */

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

export async function extractDeck(deckUrl: string, themeId: string, bg: Paint, count = 0): Promise<SlideIR[]> {
  const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch({ channel: 'msedge' })).catch(() => chromium.launch())
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  if (!count) count = Number(process.env.SLIDES) || await detectCount(page, deckUrl, themeId)
  const slides: SlideIR[] = []
  for (let n = 1; n <= count; n++) {
    await page.goto(`${deckUrl}?theme=${themeId}&_=${n}#/${n}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => (document as any).fonts.ready)
    await page.waitForTimeout(350)
    const raw = await page.evaluate(WALKER)
    slides.push({ name: `Slide ${n}`, bg, shapes: (raw as any[]).map(mapItem).filter(Boolean) as Shape[] })
  }
  await browser.close()
  return slides
}
