import { describe, expect, it } from 'vitest'
import { parseColor, whitePointOf } from '../../../scripts/pptx/color.ts'

/** The white each space's channels resolve to, as XYZ. */
const WHITE = {
  d65: [0.9504559270516716, 1, 1.0890577507598784],
  d50: [0.9642956764295677, 1, 0.8251046025104602],
} as const

/**
 * Assert two colours match within a rounding tolerance.
 * @param actual - the parsed colour.
 * @param expected - the colour it should equal.
 */
function sameColor(actual: ReturnType<typeof parseColor>, expected: ReturnType<typeof parseColor>): void {
  for (const channel of ['r', 'g', 'b', 'a'] as const) {
    expect(actual[channel], channel).toBeCloseTo(expected[channel], 2)
  }
}

describe('parseColor of color()', () => {
  // reason: this exact string came off a themed deck and failed the export
  // outright. Chromium emits it for a resolved `color-mix()`, which is how
  // every Octodeck theme states its translucent tokens.
  it('reads the sRGB form a themed deck produces', () => {
    sameColor(
      parseColor('color(srgb 0.121569 0.137255 0.156863 / 0.12)'),
      parseColor('rgb(31 35 40 / 0.12)'),
    )
  })

  // reason: the alpha heuristic was written for `rgb(r g b a)`, where a fourth
  // argument is alpha. In `color()` the first argument names the space, so a
  // fourth argument is the blue channel — which the heuristic took for alpha,
  // leaving every opaque colour with no blue and a nonsense opacity.
  it('does not mistake the blue channel for an alpha', () => {
    const white = parseColor('color(srgb 1 1 1)')
    // Both halves of the old failure: blue was taken as the alpha, so it read
    // as zero and the colour came out fully transparent-ish yellow.
    expect(white.b).toBeCloseTo(1, 5)
    expect(white.a).toBe(1)
    sameColor(white, parseColor('white'))
  })

  it('reads an alpha only after the slash', () => {
    sameColor(parseColor('color(srgb 0 0 0 / 50%)'), parseColor('rgb(0 0 0 / 0.5)'))
    sameColor(parseColor('color(srgb 0 0 0 / 0.5)'), parseColor('rgb(0 0 0 / 0.5)'))
  })

  it('reads percentage channels', () => {
    sameColor(parseColor('color(srgb 20% 40% 60%)'), parseColor('rgb(51 102 153)'))
  })

  // reason: CSS lets a component be `none`, which resolves to zero here.
  it('reads a missing component as zero', () => {
    sameColor(parseColor('color(srgb none none none / 0.5)'), parseColor('rgb(0 0 0 / 0.5)'))
  })

  it.each([
    'srgb',
    'srgb-linear',
    'display-p3',
    'a98-rgb',
    'rec2020',
    'prophoto-rgb',
  ])('renders white as white in %s', (space) => {
    sameColor(parseColor(`color(${space} 1 1 1)`), parseColor('white'))
  })

  it.each(['srgb', 'display-p3', 'rec2020', 'prophoto-rgb'])('renders black as black in %s', (space) => {
    sameColor(parseColor(`color(${space} 0 0 0)`), parseColor('black'))
  })

  it('reads XYZ under either white point', () => {
    sameColor(parseColor('color(xyz-d65 0.9505 1 1.0891)'), parseColor('white'))
    sameColor(parseColor('color(xyz 0.9505 1 1.0891)'), parseColor('white'))
    sameColor(parseColor('color(xyz-d50 0.9643 1 0.8251)'), parseColor('white'))
  })

  it('names the space it cannot read', () => {
    expect(() => parseColor('color(hsl 1 2 3)')).toThrow(/unsupported colour space in color\(\): hsl/)
  })
})

// reason: a to-XYZ matrix has a property worth checking — its rows sum to the
// space's own white point — and a mistyped digit shifts every colour in a way
// no rendered deck makes obvious. A composed to-sRGB matrix would not.
describe('the colour space matrices', () => {
  it.each([
    'srgb',
    'srgb-linear',
    'display-p3',
    'a98-rgb',
    'rec2020',
    'prophoto-rgb',
  ])('carries the white point %s claims', (space) => {
    const found = whitePointOf(space)
    expect(found).toBeDefined()
    const expected = WHITE[found?.white ?? 'd65']
    for (const axis of [0, 1, 2]) {
      expect(found?.xyz[axis], `axis ${String(axis)}`).toBeCloseTo(expected[axis], 3)
    }
  })

  it('has no white point for a space it does not define', () => {
    expect(whitePointOf('hsl')).toBeUndefined()
  })
})

// reason: `color()` support is an addition; the forms the exporter already
// read have to keep reading the same.
describe('the forms that already worked', () => {
  it.each([
    ['#1f2328', 'rgb(31 35 40)'],
    ['rgba(31,35,40,0.12)', 'rgb(31 35 40 / 0.12)'],
    ['rgb(31 35 40 / 12%)', 'rgb(31 35 40 / 0.12)'],
    ['transparent', 'rgb(0 0 0 / 0)'],
  ])('still reads %s', (input, equivalent) => {
    sameColor(parseColor(input), parseColor(equivalent))
  })
})
