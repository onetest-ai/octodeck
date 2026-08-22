import { describe, expect, it } from 'vitest'
import { DECK_DIRECTORY, resolveDeck } from '../src/definition.ts'
import { workspaceFor } from '../src/tools/deck-create.ts'

const options = { workspace: '/mount/time/fallback', base: '/deck' }

describe('workspaceFor', () => {
  it("uses the calling session's own selected workspace", () => {
    const exec = { agent: { session: { header: { cwd: '/home/me/project' } } } }
    expect(workspaceFor(exec, options)).toBe('/home/me/project')
  })

  it('keeps two sessions in different workspaces apart', () => {
    const a = { agent: { session: { header: { cwd: '/work/alpha' } } } }
    const b = { agent: { session: { header: { cwd: '/work/beta' } } } }
    expect(resolveDeck({ name: 'launch' }, workspaceFor(a, options)).directory)
      .toBe(`/work/alpha/${DECK_DIRECTORY}/launch`)
    expect(resolveDeck({ name: 'launch' }, workspaceFor(b, options)).directory)
      .toBe(`/work/beta/${DECK_DIRECTORY}/launch`)
  })

  it('falls back to the mount-time root when a call carries no session', () => {
    expect(workspaceFor(undefined, options)).toBe('/mount/time/fallback')
    expect(workspaceFor({ agent: { session: { header: {} } } }, options)).toBe('/mount/time/fallback')
  })

  it('puts decks in a dotted folder so they do not clutter the workspace root', () => {
    expect(DECK_DIRECTORY).toBe('.deck')
  })
})
