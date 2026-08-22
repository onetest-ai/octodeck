import { describe, expect, it } from 'vitest'
import { deckKey } from '../src/definition.ts'
import { deckPageSegment, describeUnknownDeckSegment } from '../src/host/preview-route.ts'

describe('deckPageSegment', () => {
  const base = '/deck'

  it('reads the segment of a deck page request', () => {
    expect(deckPageSegment('/deck/abc123/', base)).toBe('abc123')
    expect(deckPageSegment('/deck/abc123', base)).toBe('abc123')
    expect(deckPageSegment('/deck/abc123/?theme=radiant', base)).toBe('abc123')
  })

  it('is not a page request for assets, nested paths, or the bare base', () => {
    expect(deckPageSegment('/deck/', base)).toBeNull()
    expect(deckPageSegment('/deck/@vite/client', base)).toBeNull()
    expect(deckPageSegment('/deck/abc/slides.ts', base)).toBeNull()
    expect(deckPageSegment('/elsewhere/abc/', base)).toBeNull()
  })
})

describe('describeUnknownDeckSegment', () => {
  it('says nothing for a segment that names a real deck', () => {
    // A valid key must be served, not explained.
    expect(describeUnknownDeckSegment(deckKey('/w/.deck/launch'))).toBeNull()
  })

  it('explains a bare deck name, which is the mistake people actually make', () => {
    // Rendering the host page here is what produced a blank deck and a
    // console 404 — indistinguishable from a broken build.
    const message = describeUnknownDeckSegment('launch')
    expect(message).toMatch(/launch/)
    expect(message).toMatch(/name/i)
    expect(message).toMatch(/deck_view/)
  })

  it('explains a key that decodes outside a .deck directory', () => {
    expect(describeUnknownDeckSegment(deckKey('/etc'))).toMatch(/does not name a deck/i)
  })

  it('explains a segment that is not a key at all', () => {
    expect(describeUnknownDeckSegment('not-a-key!!')).toMatch(/does not name a deck/i)
  })
})
