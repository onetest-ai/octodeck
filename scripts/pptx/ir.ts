// Scene IR — a renderer-agnostic shape tree. Coordinates are DESIGN pixels on the
// 1280×720 canvas; the OOXML backend converts px→EMU. Colours are resolved Paint
// (hex+alpha) — the theme adapter does that resolution upstream.
import type { Paint, ResolvedTheme } from './theme.ts'

// Re-exported because this module's own exported shapes (Rect, Line, Run, ...)
// are typed in terms of it, so a consumer importing them cannot name the type
// without it.
export type { Paint } from './theme.ts'
import { parseColor, toHex, alphaVal, mixOklab } from './color.ts'

export interface Run { text: string; font: string; sizePt: number; color: Paint; bold?: boolean; italic?: boolean; spacingPt?: number }
/** A paragraph inside a text body — enables multi-line text and bullets. */
export interface Para { runs: Run[]; bullet?: boolean; align?: 'l' | 'c' | 'r'; spaceAfterPt?: number; linePct?: number }
export type Prst = 'roundRect' | 'rect' | 'diamond' | 'ellipse'
/** A linear gradient fill. `angle` in degrees (0 = left→right). */
export interface Grad { stops: { pos: number; color: Paint }[]; angle: number }
export interface Stroke { color: Paint; w: number; dash?: boolean; arrow?: boolean }
export interface Rect {
  kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number; prst?: Prst
  fill?: Paint; grad?: Grad; line?: Stroke
  runs?: Run[]; paras?: Para[]; align?: 'l' | 'c' | 'r'; valign?: 't' | 'm' | 'b'; pad?: number; tight?: boolean
}
export interface Line { kind: 'line'; x1: number; y1: number; x2: number; y2: number; color: Paint; w: number; dash?: boolean; arrow?: boolean }
export interface Text { kind: 'text'; x: number; y: number; w: number; h: number; runs?: Run[]; paras?: Para[]; align?: 'l' | 'c' | 'r'; valign?: 't' | 'm' | 'b'; pad?: number; tight?: boolean }
/** A freeform path in design px. Segments: M/L (one pt) or C (cubic: x1,y1,x2,y2,x,y). */
export type Seg = { c: 'M' | 'L'; x: number; y: number } | { c: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
export interface Path { kind: 'path'; segs: Seg[]; closed?: boolean; fill?: Paint; grad?: Grad; line?: Stroke }
export interface Group { kind: 'group'; name: string; children: Shape[] }
export type Shape = Rect | Line | Text | Path | Group
export interface SlideIR { name: string; bg: Paint; shapes: Shape[] }

// ── colour helpers built on the theme ────────────────────────────────────────
export const lit = (hex: string, alpha = 100000): Paint => ({ hex, alpha })
/** Resolve any CSS colour string to a concrete Paint (hex + alpha). */
export const paintOf = (css: string): Paint => { const c = parseColor(css); return { hex: toHex(c), alpha: alphaVal(c) } }
/** A tint of a CSS colour mixed `pct` over the theme background (matches CSS color-mix over bg). */
export function tintOverBg(css: string, pct: number, t: ResolvedTheme): Paint {
  const bg = parseColor('#' + t.color.bg.hex)
  const mixed = mixOklab(parseColor(css), pct, bg, 1 - pct)
  return { hex: toHex(mixed), alpha: alphaVal(mixed) }
}
/** A CSS colour at `pct` alpha (mix over transparent) — matches color-mix(x pct%, transparent). */
export function tintAlpha(css: string, pct: number): Paint {
  const m = mixOklab(parseColor(css), pct, parseColor('transparent'), 1 - pct)
  return { hex: toHex(m), alpha: alphaVal(m) }
}
/** Mix CSS colour a `pct` into CSS colour b (both opaque) — for jewel-on-fg blends. */
export function mix(aCss: string, pct: number, bCss: string): Paint {
  const m = mixOklab(parseColor(aCss), pct, parseColor(bCss), 1 - pct)
  return { hex: toHex(m), alpha: alphaVal(m) }
}
