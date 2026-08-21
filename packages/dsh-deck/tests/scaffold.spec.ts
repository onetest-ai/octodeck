import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'

async function scaffoldInTemp() {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
  const spec = resolveDeck({ name: 'launch' }, workspace)
  return { spec, written: await scaffoldDeck(spec) }
}

describe('scaffoldDeck', () => {
  it('writes exactly the deck-owned files, no framework or config copy', async () => {
    const { spec, written } = await scaffoldInTemp()
    expect(written.map(p => p.slice(spec.directory.length + 1))).toEqual([
      'deck.json', 'slides.ts', 'deck.css',
    ])
  })

  it('records the resolved theme and title where the provider can read them back', async () => {
    const { spec } = await scaffoldInTemp()
    const meta = JSON.parse(await readFile(join(spec.directory, 'deck.json'), 'utf8'))
    expect(meta).toEqual({ title: 'Launch', theme: 'midnight' })
  })

  it('seeds a slides module that already renders one titled slide', async () => {
    const { spec } = await scaffoldInTemp()
    const slides = await readFile(join(spec.directory, 'slides.ts'), 'utf8')
    expect(slides).toContain('export const slides: Slide[]')
    expect(slides).toContain('Launch')
  })

  it('refuses to overwrite an existing deck', async () => {
    const { spec } = await scaffoldInTemp()
    await expect(scaffoldDeck(spec)).rejects.toThrow(/exists/)
  })

  it('fails loudly when the parent path is a file, not a directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const spec = resolveDeck({ name: 'launch' }, workspace)
    // Create a file at the decks parent path to block directory creation
    const decksPath = join(workspace, 'decks')
    await writeFile(decksPath, 'blocking file')
    // Attempting to scaffold should fail with the system error (EEXIST from mkdir),
    // not the wrapped "deck already exists" message (which only wraps EEXIST from deck dir mkdir)
    await expect(scaffoldDeck(spec)).rejects.toThrow(/EEXIST.*mkdir/)
  })
})
