import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, resolveDeck } from '../src/definition.ts'

describe('resolveDeck', () => {
  it('defaults the theme explicitly rather than deep inside the provider', () => {
    const spec = resolveDeck({ name: 'launch' }, '/w')
    expect(spec.theme).toBe(DEFAULT_THEME)
  })

  it('titles the deck from its name when the caller supplies none', () => {
    expect(resolveDeck({ name: 'launch-plan' }, '/w').title).toBe('Launch Plan')
  })

  it('places the deck under decks/<name> in the workspace', () => {
    expect(resolveDeck({ name: 'launch' }, '/w').directory).toBe('/w/decks/launch')
  })

  it('rejects a theme the framework does not ship', () => {
    expect(() => resolveDeck({ name: 'launch', theme: 'neon' }, '/w')).toThrow(/neon/)
  })

  it('rejects a name that would escape the workspace', () => {
    expect(() => resolveDeck({ name: '../etc' }, '/w')).toThrow(/name/)
  })
})
