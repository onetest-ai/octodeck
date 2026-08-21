import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deckViewTool } from '../src/index.ts'
import { createDeck } from '../src/tools/deck-create.ts'

describe('deckViewTool', () => {
  it('projects the canonical DeckView value onto output.presentationMeta, verbatim', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const options = { workspace, base: '/deck' }
    await createDeck({ name: 'launch' }, options)

    const tool = deckViewTool(options)
    const value = await tool.execute({ name: 'launch' }, { signal: undefined } as never)
    const meta = tool.output.presentationMeta?.({ name: 'launch' }, value)

    // This is exactly the value the deck-canvas keyed `tool.call.toolview`
    // registration (@onetest/dsh-deck-canvas) reads off `block.meta` — the
    // one path that reaches the canonical value at all (see that package's
    // DeckToolview.tsx for why neither slot exposes `value` directly).
    expect(meta).toEqual(value)
    expect(meta).toEqual({ deckId: 'launch', route: '/deck/launch/', slideCount: 1, theme: 'midnight' })
  })

  it('declares a presentationMeta projector at all', () => {
    // A regression that dropped the `presentationMeta` field entirely would
    // leave `tool.output.presentationMeta` undefined — no `meta` would ever
    // reach the tool/result event, and the canvas would render nothing with
    // no signal why. Asserted separately from the value-equality test above
    // so a future refactor that silently loses the field fails here first.
    const tool = deckViewTool({ workspace: '/does-not-matter', base: '/deck' })
    expect(typeof tool.output.presentationMeta).toBe('function')
  })
})
