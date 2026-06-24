/**
 * Diagram — a deterministic, theme-aware diagram component.
 *
 * Unlike Mermaid (which auto-lays-out and can shift between renders), you place
 * every node on an explicit grid cell; edges auto-route orthogonally between
 * them. Rendered as a single responsive SVG using the contract's colors, so it
 * matches whatever theme is active.
 *
 *   Diagram({
 *     cols: 3, rows: 3,
 *     nodes: {
 *       client: { at: [0, 1], label: 'Client', shape: 'pill' },
 *       api:    { at: [1, 1], label: 'API', accent: true },
 *       db:     { at: [2, 0], label: 'Database' },
 *       cache:  { at: [2, 2], label: 'Cache' },
 *     },
 *     edges: [
 *       { from: 'client', to: 'api', label: 'HTTP' },
 *       { from: 'api', to: 'db' },
 *       { from: 'api', to: 'cache', dashed: true },
 *     ],
 *   })
 */

export interface DiagramNode {
  /** Grid cell as [col, row], zero-based. */
  at: [number, number]
  /** Column span. Default: 1. */
  w?: number
  /** Row span. Default: 1. */
  h?: number
  label: string
  /** Box (default) or a fully-rounded pill. */
  shape?: 'box' | 'pill'
  /** Tint the node with the accent color (highlight the focal node). */
  accent?: boolean
}

export interface DiagramEdge {
  from: string
  to: string
  label?: string
  dashed?: boolean
  /** Draw an arrowhead at the target. Default: true. */
  arrow?: boolean
}

export interface DiagramSpec {
  cols: number
  rows: number
  nodes: Record<string, DiagramNode>
  edges?: DiagramEdge[]
}

// viewBox units (the SVG scales to fit the slide; absolute values are arbitrary).
const CELL_W = 230
const CELL_H = 118
const BASE_GAP = 56
const PAD = 34       // viewBox breathing room so node shadows aren't clipped
const SHADOW_ROOM = 26  // padding inside each node's foreignObject for its shadow
const LABEL_FS = 19  // edge-label font size (viewBox units)

const SVGNS = 'http://www.w3.org/2000/svg'
let uid = 0

interface Rect { x: number; y: number; w: number; h: number }

/** Estimated label chip width in viewBox units. */
function labelWidth(label: string): number {
  return label.length * (LABEL_FS * 0.62) + 24
}

export function Diagram(spec: DiagramSpec): HTMLElement {
  const id = `octo-arrow-${uid++}`

  // Adaptive gaps: a labeled edge widens the gap between its boxes so the label
  // fits cleanly in the open space — never crammed onto the box faces.
  let gapX = BASE_GAP
  let gapY = BASE_GAP
  for (const edge of spec.edges ?? []) {
    if (!edge.label) continue
    const a = spec.nodes[edge.from]
    const b = spec.nodes[edge.to]
    if (!a || !b) continue
    const horizontal = Math.abs(b.at[0] - a.at[0]) >= Math.abs(b.at[1] - a.at[1])
    if (horizontal) gapX = Math.max(gapX, labelWidth(String(edge.label)) + 16)
    else gapY = Math.max(gapY, LABEL_FS + 30)
  }

  const vbW = spec.cols * (CELL_W + gapX) - gapX
  const vbH = spec.rows * (CELL_H + gapY) - gapY

  const svg = s('svg', {
    viewBox: `${-PAD} ${-PAD} ${vbW + PAD * 2} ${vbH + PAD * 2}`,
    preserveAspectRatio: 'xMidYMid meet',
  })

  const marker = s('marker', {
    id, markerWidth: 12, markerHeight: 12, refX: 9, refY: 5,
    orient: 'auto-start-reverse', markerUnits: 'userSpaceOnUse',
  }, s('path', { d: 'M0,0 L10,5 L0,10 z' }))
  svg.append(s('defs', {}, marker))

  const rects = new Map<string, Rect>()
  for (const [key, node] of Object.entries(spec.nodes)) rects.set(key, rectOf(node, gapX, gapY))

  // Three layers, drawn back-to-front: edge lines, then nodes, then edge labels
  // (labels last so node boxes never clip them).
  const labels: SVGElement[] = []
  for (const edge of spec.edges ?? []) {
    const a = rects.get(edge.from)
    const b = rects.get(edge.to)
    if (!a || !b) continue
    const r = route(a, b)
    svg.append(s('path', {
      class: 'octo-dedge' + (edge.dashed ? ' is-dashed' : ''),
      d: r.d,
      'marker-end': edge.arrow === false ? null : `url(#${id})`,
    }))
    if (edge.label) {
      const str = String(edge.label)
      const w = str.length * 12 + 22
      const hgt = 34
      const g = s('g', {})
      g.append(s('rect', { class: 'octo-dedge-chip', x: r.lx - w / 2, y: r.ly - hgt / 2, width: w, height: hgt, rx: 9 }))
      g.append(s('text', { class: 'octo-dedge-label', x: r.lx, y: r.ly }, text(str)))
      labels.push(g)
    }
  }

  // Nodes as foreignObject HTML boxes — themed, with wrapping labels. The
  // foreignObject is inflated by SHADOW_ROOM (and the node re-inset with
  // padding) so the box-shadow isn't clipped at the foreignObject edge.
  const m = SHADOW_ROOM
  for (const [key, node] of Object.entries(spec.nodes)) {
    const r = rects.get(key)!
    const fo = s('foreignObject', { x: r.x - m, y: r.y - m, width: r.w + m * 2, height: r.h + m * 2 })
    const wrap = document.createElement('div')
    wrap.style.cssText = `box-sizing:border-box;width:100%;height:100%;padding:${m}px;`
    const box = document.createElement('div')
    box.className = 'octo-dnode'
      + (node.shape === 'pill' ? ' is-pill' : '')
      + (node.accent ? ' is-accent' : '')
    box.textContent = node.label
    wrap.append(box)
    fo.append(wrap)
    svg.append(fo)
  }

  for (const label of labels) svg.append(label)

  return el('div', 'octo-diagram', svg)
}

// ── geometry ────────────────────────────────────────────────────────────────

function rectOf(n: DiagramNode, gapX: number, gapY: number): Rect {
  const w = n.w ?? 1
  const h = n.h ?? 1
  return {
    x: n.at[0] * (CELL_W + gapX),
    y: n.at[1] * (CELL_H + gapY),
    w: w * CELL_W + (w - 1) * gapX,
    h: h * CELL_H + (h - 1) * gapY,
  }
}

/** Orthogonal (Z-elbow) route between two node rects, plus a label anchor. */
function route(a: Rect, b: Rect): { d: string; lx: number; ly: number } {
  const ax = a.x + a.w / 2, ay = a.y + a.h / 2
  const bx = b.x + b.w / 2, by = b.y + b.h / 2
  const dx = bx - ax, dy = by - ay

  if (Math.abs(dx) >= Math.abs(dy)) {
    const sx = dx >= 0 ? a.x + a.w : a.x
    const ex = dx >= 0 ? b.x : b.x + b.w
    const mx = (sx + ex) / 2
    return { d: `M${sx},${ay} L${mx},${ay} L${mx},${by} L${ex},${by}`, lx: mx, ly: (ay + by) / 2 }
  }
  const sy = dy >= 0 ? a.y + a.h : a.y
  const ey = dy >= 0 ? b.y : b.y + b.h
  const my = (sy + ey) / 2
  return { d: `M${ax},${sy} L${ax},${my} L${bx},${my} L${bx},${ey}`, lx: (ax + bx) / 2, ly: my }
}

// ── tiny SVG builder ──────────────────────────────────────────────────────────

function s(tag: string, attrs: Record<string, unknown> = {}, ...children: (Node | null)[]): SVGElement {
  const node = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) node.setAttribute(k, String(v))
  for (const c of children) if (c) node.append(c)
  return node as SVGElement
}

function text(t: string): Text {
  return document.createTextNode(t)
}

function el(tag: string, className: string, ...children: Node[]): HTMLElement {
  const node = document.createElement(tag)
  node.className = className
  node.append(...children)
  return node
}
