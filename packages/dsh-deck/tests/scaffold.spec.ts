import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DECK_DIRECTORY, resolveDeck } from '../src/definition.ts'
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

  it.skipIf(process.getuid?.() === 0)(
    'rethrows a non-EEXIST failure instead of calling it a name collision',
    async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
      const spec = resolveDeck({ name: 'launch' }, workspace)
      const decksPath = join(workspace, DECK_DIRECTORY)
      // Create the parent directory, then make it read-only to force EACCES
      // on the inner mkdir(spec.directory, { recursive: false })
      await mkdir(decksPath)
      try {
        await chmod(decksPath, 0o555)
        // Attempting to scaffold should fail with EACCES from the deck directory mkdir,
        // not the wrapped "deck already exists" message (which only wraps EEXIST)
        await expect(scaffoldDeck(spec)).rejects.toMatchObject({ code: 'EACCES' })
      } finally {
        // Restore permissions so the temp directory can be cleaned up
        await chmod(decksPath, 0o755)
      }
    }
  )
})
