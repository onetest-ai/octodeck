import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countSlides, createDeck, viewDeck } from '../src/tools/deck-create.ts'

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

describe('countSlides', () => {
  it('counts a multi-line entry once instead of once per bracket line', () => {
    const source = `export const slides: Slide[] = [
  () => TitleSlide({
    title: 'Launch',
    subtitle: 'Q3 plan',
  }),
  () => BulletSlide({
    title: 'Agenda',
    bullets: ['one', 'two'],
  }),
]
`
    expect(countSlides(source)).toBe(2)
  })

  it('ignores a bracket inside a string literal', () => {
    const source = `export const slides: Slide[] = [
  () => TitleSlide({ title: 'Q3 [draft]' }),
]
`
    expect(countSlides(source)).toBe(1)
  })

  it('ignores a bracket inside a template literal', () => {
    const source = 'export const slides: Slide[] = [\n' +
      '  () => TitleSlide({ title: `Q3 [draft]` }),\n' +
      ']\n'
    expect(countSlides(source)).toBe(1)
  })

  it('ignores a bracket and comma inside a line comment', () => {
    const source = `export const slides: Slide[] = [
  // a stray ] and , that must not be counted
  () => TitleSlide({ title: 'Launch' }),
]
`
    expect(countSlides(source)).toBe(1)
  })

  it('ignores a bracket and comma inside a block comment', () => {
    const source = `export const slides: Slide[] = [
  /* a stray ] and , that must not be counted */
  () => TitleSlide({ title: 'Launch' }),
]
`
    expect(countSlides(source)).toBe(1)
  })

  it('does not add a phantom entry for a trailing comma', () => {
    const withTrailing = `export const slides: Slide[] = [
  () => TitleSlide({ title: 'A' }),
  () => TitleSlide({ title: 'B' }),
]
`
    const withoutTrailing = `export const slides: Slide[] = [
  () => TitleSlide({ title: 'A' }),
  () => TitleSlide({ title: 'B' })
]
`
    expect(countSlides(withTrailing)).toBe(2)
    expect(countSlides(withoutTrailing)).toBe(2)
  })

  it('reports an empty array as zero', () => {
    expect(countSlides('export const slides: Slide[] = []\n')).toBe(0)
  })

  it('counts the seeded single-slide deck scaffoldDeck writes', () => {
    const source = `import { TitleSlide } from 'octodeck/framework'
import type { Slide } from 'octodeck/framework'

export const slides: Slide[] = [
  () => TitleSlide({ title: "Launch", subtitle: 'Edit slides.ts to build this deck' }),
]
`
    expect(countSlides(source)).toBe(1)
  })
})
