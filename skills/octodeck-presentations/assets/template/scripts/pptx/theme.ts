// Theme adapter (pure JS, no browser). Consumes the offline snapshot
// (themes.resolved.json) and produces a target-agnostic "resolved theme":
// concrete hex+alpha colours, mapped fonts, sizes in points, panel material,
// and a backdrop strategy. The OOXML backend reads ONLY this.
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { parseColor, toHex, alphaVal } from './color.ts'

const SNAPSHOT = JSON.parse(
  readFileSync(fileURLToPath(new URL('./themes.resolved.json', import.meta.url)), 'utf8'),
)

export interface Paint { hex: string; alpha: number } // alpha 0..100000 (OOXML)
export interface ResolvedTheme {
  id: string
  color: Record<string, Paint>
  font: { heading: string; body: string; mono: string; embed: string[] }
  /** points */
  size: { title: number; h2: number; h3: number; body: number; note: number }
  /** px (→ EMU at render time) */
  px: { radius: number; radiusLg: number; pad: number; cardPad: number; gap: number }
  weightHeading: number
  material: { fill: Paint; line: Paint; radiusPx: number }
  backdrop: { rich: boolean; solid: Paint } // rich → bake an image; else a solid fill
  glass: boolean
}

const paint = (css: string): Paint => { const c = parseColor(css); return { hex: toHex(c), alpha: alphaVal(c) } }
const PX = (s: string) => parseFloat(s)
const PT = (s: string) => +(PX(s) * 0.75).toFixed(2) // 96dpi px → pt

// Map a CSS font stack's first family to a PPTX-safe family; flag web fonts to embed.
const EMBEDDABLE = new Set(['Geist', 'Geist Mono', 'Switzer', 'Inter'])
function mapFont(stack: string): { name: string; embed?: string } {
  const first = stack.split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (EMBEDDABLE.has(first)) return { name: first, embed: first }
  // system stacks (ui-sans-serif, -apple-system, …) → a safe installed font
  if (/mono/i.test(stack)) return { name: 'Consolas' }
  return { name: 'Calibri' }
}

export function resolveTheme(id: string): ResolvedTheme {
  const t = SNAPSHOT[id]
  if (!t) throw new Error(`theme not in snapshot: ${id} (have: ${Object.keys(SNAPSHOT).join(', ')})`)
  const color: Record<string, Paint> = {}
  for (const [k, v] of Object.entries(t.color)) color[k] = paint(v as string)

  const heading = mapFont(t.font['font-heading'])
  const body = mapFont(t.font['font'])
  const mono = mapFont(t.font['font-mono'])
  const embed = [...new Set([heading.embed, body.embed, mono.embed].filter(Boolean) as string[])]

  const rich = /gradient/i.test(t.backdrop || '') // aurora/glow themes → bake
  const glass = /blur/i.test(t.panelBackdrop || '')

  return {
    id,
    color,
    font: { heading: heading.name, body: body.name, mono: mono.name, embed },
    size: { title: PT(t.size['fs-title']), h2: PT(t.size['fs-h2']), h3: PT(t.size['fs-h3']), body: PT(t.size['fs-body']), note: PT(t.size['fs-note']) },
    px: { radius: PX(t.size['radius']), radiusLg: PX(t.size['radius-lg']), pad: PX(t.size['pad']), cardPad: PX(t.size['card-pad']), gap: PX(t.size['gap']) },
    weightHeading: parseInt(t.weightHeading, 10) || 700,
    material: { fill: color['panel-bg'], line: color['border'], radiusPx: PX(t.size['radius']) },
    backdrop: { rich, solid: color['bg'] },
    glass,
  }
}

export const themeIds = (): string[] => Object.keys(SNAPSHOT)
