// Colour math for the PPTX exporter — parse the colour strings the browser emits
// (rgb / oklch / oklab / lab / lch / color() / hex / transparent), convert to sRGB
// hex + alpha for OOXML, and mix in OKLab (the same space Octodeck's
// `color-mix(in oklab, …)` uses).
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
  // A fourth argument is a legacy comma-form alpha — except in `color()`,
  // whose first argument names the space, so four arguments there are the
  // space and three channels. Popping one would take the blue channel for
  // alpha and leave every colour with none.
  const trailing = kind !== 'color' && parts.length === 4 ? parts.pop() : undefined
  const alpha = alphaTok(alphaPart?.trim() ?? trailing)

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
  if (kind === 'color') return colorFnToRGBA(parts, alpha, input)
  throw new Error(`unsupported colour function: ${kind} (${input})`)
}

/**
 * A predefined `color()` space: how to linearize its channels, and the matrix
 * taking those linear channels to XYZ.
 *
 * Stated as to-XYZ rather than as a direct to-sRGB matrix because a to-XYZ
 * matrix is checkable: its rows must sum to the space's own white point, which
 * is what the colour tests assert. A composed to-sRGB matrix carries no such
 * property, so a mistyped digit in one would shift every colour silently.
 */
interface ColorSpace {
  /** Channel transfer function to linear light. */
  readonly linearize: (c: number) => number
  /** Row-major 3x3 taking this space's linear channels to XYZ. */
  readonly toXYZ: readonly number[]
  /** The white point its XYZ is relative to. */
  readonly white: 'd65' | 'd50'
}

/** A power transfer function, odd-symmetric about zero so negatives survive. */
const gammaTransfer = (exponent: number) => (c: number): number =>
  (c < 0 ? -1 : 1) * Math.abs(c) ** exponent

/** sRGB and Display P3 share this transfer function; only their primaries differ. */
const srgbTransfer = (c: number): number => (c < 0 ? -toLinear(-c) : toLinear(c))

/** sRGB and srgb-linear share primaries; only their transfer functions differ. */
const SRGB_TO_XYZ = [
  0.4123907992659595, 0.3575843393838780, 0.1804807884018343,
  0.2126390058715104, 0.7151686787677559, 0.0721923153607337,
  0.0193308187155918, 0.1191947797946259, 0.9505321522496607,
] as const

/**
 * The predefined spaces `color()` accepts, keyed as CSS spells them.
 *
 * All of them, rather than the one a theme happens to emit today: a space left
 * out fails with the same unhelpful message this fixes, and the alternative to
 * a matrix here is a second bug report later.
 */
const COLOR_SPACES: Record<string, ColorSpace> = {
  'srgb': { linearize: srgbTransfer, toXYZ: SRGB_TO_XYZ, white: 'd65' },
  'srgb-linear': { linearize: (c) => c, toXYZ: SRGB_TO_XYZ, white: 'd65' },
  'display-p3': {
    linearize: srgbTransfer,
    white: 'd65',
    toXYZ: [
      0.4865709486482162, 0.2656676931690931, 0.1982172852343625,
      0.2289745640697488, 0.6917385218365064, 0.0792869417937449,
      0.0000000000000000, 0.0451133818589026, 1.0439443689009757,
    ],
  },
  'a98-rgb': {
    linearize: gammaTransfer(563 / 256),
    white: 'd65',
    toXYZ: [
      0.5766690429101305, 0.1855582379065463, 0.1882286462349947,
      0.2973449752505361, 0.6273635662554661, 0.0752914584939978,
      0.0270313059491580, 0.0706888525581085, 0.9913375368376388,
    ],
  },
  'rec2020': {
    linearize: (c) => {
      const alpha = 1.09929682680944
      const beta = 0.018053968510807
      const abs = Math.abs(c)
      const sign = c < 0 ? -1 : 1
      return abs < beta * 4.5 ? c / 4.5 : sign * ((abs + alpha - 1) / alpha) ** (1 / 0.45)
    },
    white: 'd65',
    toXYZ: [
      0.6369580483012914, 0.1446169035862083, 0.1688809751641721,
      0.2627002120112671, 0.6779980715188708, 0.0593017086214622,
      0.0000000000000000, 0.0280726930490874, 1.0609850577107912,
    ],
  },
  'prophoto-rgb': {
    linearize: (c) => (Math.abs(c) <= 16 / 512 ? c / 16 : gammaTransfer(1.8)(c)),
    white: 'd50',
    toXYZ: [
      0.7977604896723027, 0.1351757162326781, 0.0313534044222198,
      0.2880711282292934, 0.7118432178101014, 0.0000856539616051,
      0.0000000000000000, 0.0000000000000000, 0.8251046025104601,
    ],
  },
}

/**
 * XYZ (D50) to linear sRGB, Bradford adaptation baked in.
 *
 * The same conversion {@link labToRGBA} applies inline: CIELab is a D50 space,
 * as `color(prophoto-rgb …)` and `color(xyz-d50 …)` are.
 */
const XYZ_D50_TO_LINEAR_SRGB = [
  3.1341359569958707, -1.6173863321612538, -0.4906619460083532,
  -0.978795502912089, 1.916254567259524, 0.03344273116131949,
  0.07195537988411677, -0.2289768264158322, 1.405386058324125,
] as const

/** XYZ (D65) to linear sRGB. */
const XYZ_D65_TO_LINEAR_SRGB = [
  3.2409699419045226, -1.5373831775700939, -0.4986107602930034,
  -0.9692436362808796, 1.8759675015077204, 0.0415550574071756,
  0.0556300796969936, -0.2039769588889765, 1.0569715142428786,
] as const

/**
 * Read a `color()` function into sRGB.
 *
 * Chromium emits this form for a resolved `color-mix()`, which is how every
 * Octodeck theme states its translucent tokens — so an exporter that cannot
 * read it cannot export a themed deck at all.
 * @param parts - the arguments, the first naming the colour space.
 * @param alpha - the parsed alpha.
 * @param input - the original string, for the error.
 * @returns the colour in sRGB.
 * @throws {Error} when the space is not one CSS predefines.
 */
function colorFnToRGBA(parts: string[], alpha: number, input: string): RGBA {
  const [space, ...rest] = parts
  // `none` is a missing component, which CSS resolves to zero everywhere this
  // exporter cares about.
  const channels = [0, 1, 2].map((index) => {
    const token = rest[index]
    if (token === undefined || token === 'none') return 0
    return token.endsWith('%') ? num(token) / 100 : num(token)
  })
  if (space === 'xyz' || space === 'xyz-d65') {
    return fromLinear(apply(XYZ_D65_TO_LINEAR_SRGB, channels), alpha)
  }
  if (space === 'xyz-d50') return fromLinear(apply(XYZ_D50_TO_LINEAR_SRGB, channels), alpha)
  const defined = COLOR_SPACES[space]
  if (defined === undefined) throw new Error(`unsupported colour space in color(): ${space} (${input})`)
  const xyz = apply(defined.toXYZ, channels.map(defined.linearize))
  const matrix = defined.white === 'd50' ? XYZ_D50_TO_LINEAR_SRGB : XYZ_D65_TO_LINEAR_SRGB
  return fromLinear(apply(matrix, xyz), alpha)
}

/**
 * The white point a space's channels resolve to, as XYZ.
 *
 * Exported for the check that every matrix above carries the white it claims:
 * a mistyped digit shifts colours in a way no rendered deck makes obvious.
 * @param space - the space name as CSS spells it.
 * @returns its white in XYZ, or undefined when the name is not a predefined space.
 */
export function whitePointOf(space: string): { xyz: number[]; white: 'd65' | 'd50' } | undefined {
  const defined = COLOR_SPACES[space]
  if (defined === undefined) return undefined
  return { xyz: apply(defined.toXYZ, [1, 1, 1]), white: defined.white }
}

/**
 * Multiply a row-major 3×3 by a 3-vector.
 * @param matrix - the row-major matrix.
 * @param vector - the three channels.
 * @returns the product.
 */
function apply(matrix: readonly number[], vector: number[]): number[] {
  return [0, 1, 2].map((row) =>
    matrix[row * 3] * vector[0] + matrix[row * 3 + 1] * vector[1] + matrix[row * 3 + 2] * vector[2])
}

/**
 * Gamma-encode linear sRGB into the range this module stores.
 * @param linear - the three linear-light channels.
 * @param alpha - the alpha to carry through.
 * @returns the colour, clamped into gamut.
 */
function fromLinear(linear: number[], alpha: number): RGBA {
  return {
    r: clamp01(toGamma(linear[0])),
    g: clamp01(toGamma(linear[1])),
    b: clamp01(toGamma(linear[2])),
    a: alpha,
  }
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
