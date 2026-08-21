import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeck, viewDeck } from '../src/tools/deck-create.ts'

describe('deck_create', () => {
  it('returns a canonical value the canvas can render from', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const value = await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(value).toEqual({
      deckId: 'launch',
      directory: join(workspace, 'decks', 'launch'),
      slidesPath: join(workspace, 'decks', 'launch', 'slides.ts'),
      route: '/deck/launch/',
      theme: 'midnight',
    })
  })

  it('leaves an editable slides module on disk', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const value = await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(await readFile(value.slidesPath, 'utf8')).toContain('export const slides')
  })
})

describe('deck_view', () => {
  it('reports the slide count and theme of a deck on disk', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await createDeck({ name: 'launch' }, { workspace, base: '/deck' })
    const value = await viewDeck({ name: 'launch' }, { workspace, base: '/deck' })
    expect(value).toEqual({ deckId: 'launch', route: '/deck/launch/', slideCount: 1, theme: 'midnight' })
  })

  it('fails loudly for a deck that does not exist', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await expect(viewDeck({ name: 'ghost' }, { workspace, base: '/deck' })).rejects.toThrow(/ghost/)
  })
})
