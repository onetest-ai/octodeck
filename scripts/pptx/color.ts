// Colour math for the PPTX exporter — parse the colour strings the browser emits
// (rgb / oklch / oklab / hex / transparent), convert to sRGB hex + alpha for OOXML,
// and mix in OKLab (the same space Octodeck's `color-mix(in oklab, …)` uses).
//
// Pure, dependency-free. Run under `node --experimental-strip-types`.

export interface RGBA {
  r: number // 0..1 sRGB
  g: number
  b: number
  a: number // 0..1
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)

// ── sRGB ↔ linear ────────────────────────────────────────────────────────────
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)

// ── linear sRGB ↔ OKLab (Björn Ottosson) ─────────────────────────────────────
function linearToOklab(r: number, g: number, b: number): [number, number, number] {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}
function oklabToLinear(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function toOklab(c: RGBA): { L: number; a: number; b: number; alpha: number } {
  const [L, a, b] = linearToOklab(toLinear(c.r), toLinear(c.g), toLinear(c.b))
  return { L, a, b, alpha: c.a }
}
export function fromOklab(L: number, a: number, b: number, alpha = 1): RGBA {
  const [lr, lg, lb] = oklabToLinear(L, a, b)
  return { r: clamp01(toGamma(lr)), g: clamp01(toGamma(lg)), b: clamp01(toGamma(lb)), a: alpha }
}

// ── parsing ──────────────────────────────────────────────────────────────────
const num = (s: string) => parseFloat(s)
/** Accept a 0..1, a 0..255, or an `N%` alpha/channel token → 0..1 (channel) value. */
const chan = (s: string) => (s.endsWith('%') ? num(s) / 100 : num(s) > 1 ? num(s) / 255 : num(s))
const alphaTok = (s: string | undefined) => (s == null ? 1 : s.endsWith('%') ? num(s) / 100 : num(s))

export function parseColor(input: string): RGBA {
  const s = input.trim().toLowerCase()
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (s === 'white') return { r: 1, g: 1, b: 1, a: 1 }
  if (s === 'black') return { r: 0, g: 0, b: 0, a: 1 }

  // #rgb / #rrggbb / #rrggbbaa
  if (s[0] === '#') {
    let h = s.slice(1)
    if (h.length === 3) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16) / 255
    const g = parseInt(h.slice(2, 4), 16) / 255
    const b = parseInt(h.slice(4, 6), 16) / 255
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    return { r, g, b, a }
  }

  const fn = s.match(/^([a-z]+)\((.*)\)$/)
  if (!fn) throw new Error(`unparseable colour: ${input}`)
  const kind = fn[1]
  // split args on commas or whitespace, pulling an optional "/ alpha"
  const [body, alphaPart] = fn[2].split('/')
  const parts = body.trim().split(/[\s,]+/).filter(Boolean)
  const alpha = alphaTok(alphaPart?.trim() ?? (parts.length === 4 ? parts.pop() : undefined))

  if (kind === 'rgb' || kind === 'rgba') {
    return { r: chan(parts[0]), g: chan(parts[1]), b: chan(parts[2]), a: alpha }
  }
  if (kind === 'oklab') {
    return fromOklab(num(parts[0]), num(parts[1]), num(parts[2]), alpha)
  }
  if (kind === 'oklch') {
    const L = num(parts[0]), C = num(parts[1]), H = (num(parts[2]) * Math.PI) / 180
    return fromOklab(L, C * Math.cos(H), C * Math.sin(H), alpha)
  }
  if (kind === 'lab') return labToRGBA(num(parts[0]), num(parts[1]), num(parts[2]), alpha)
  if (kind === 'lch') {
    const H = (num(parts[2]) * Math.PI) / 180
    return labToRGBA(num(parts[0]), num(parts[1]) * Math.cos(H), num(parts[1]) * Math.sin(H), alpha)
  }
  throw new Error(`unsupported colour function: ${kind} (${input})`)
}

// CSS lab() (CIELab, D50) → sRGB. Combined D50-XYZ→linear-sRGB matrix (Bradford baked in).
function labToRGBA(L: number, a: number, bb: number, alpha = 1): RGBA {
  const e = 216 / 24389, k = 24389 / 27
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200
  const xr = fx ** 3 > e ? fx ** 3 : (116 * fx - 16) / k
  const yr = L > k * e ? ((L + 16) / 116) ** 3 : L / k
  const zr = fz ** 3 > e ? fz ** 3 : (116 * fz - 16) / k
  const X = xr * 0.96422, Y = yr, Z = zr * 0.82521
  const r = 3.1341359569958707 * X - 1.6173863321612538 * Y - 0.4906619460083532 * Z
  const g = -0.978795502912089 * X + 1.916254567259524 * Y + 0.03344273116131949 * Z
  const b2 = 0.07195537988411677 * X - 0.2289768264158322 * Y + 1.405386058324125 * Z
  return { r: clamp01(toGamma(r)), g: clamp01(toGamma(g)), b: clamp01(toGamma(b2)), a: alpha }
}

// ── color-mix(in oklab, c1 p1%, c2 p2%) — CSS semantics incl. alpha premultiply ─
export function mixOklab(c1: RGBA, p1: number, c2: RGBA, p2 = 1 - p1): RGBA {
  const t = p1 + p2 || 1
  const w1 = p1 / t, w2 = p2 / t
  const o1 = toOklab(c1), o2 = toOklab(c2)
  const A = w1 * c1.a + w2 * c2.a
  // premultiply colour by alpha (CSS does the mix on premultiplied colours)
  const a1 = c1.a, a2 = c2.a
  const L = A ? (w1 * o1.L * a1 + w2 * o2.L * a2) / A : 0
  const a = A ? (w1 * o1.a * a1 + w2 * o2.a * a2) / A : 0
  const b = A ? (w1 * o1.b * a1 + w2 * o2.b * a2) / A : 0
  return fromOklab(L, a, b, A)
}

// ── output for OOXML ──────────────────────────────────────────────────────────
/** 'RRGGBB' (uppercase, no #) — DrawingML srgbClr val. */
export function toHex(c: RGBA): string {
  const h = (x: number) => Math.round(clamp01(x) * 255).toString(16).padStart(2, '0')
  return (h(c.r) + h(c.g) + h(c.b)).toUpperCase()
}
/** OOXML alpha is in thousandths of a percent (0..100000). */
export function alphaVal(c: RGBA): number {
  return Math.round(clamp01(c.a) * 100000)
}
