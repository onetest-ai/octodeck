import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { startPreviewServer } from '../src/octodeck/vite-server.ts'

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

describe('startPreviewServer', () => {
  it('exposes a middleware and an upgrade handler', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    expect(typeof server.middleware).toBe('function')
    expect(typeof server.handleUpgrade).toBe('function')
  })

  it('serves the deck host page for a scaffolded deck', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    const html = await server.render('/deck/launch/')
    expect(html).toContain('<div id="deck">')
  })

  it('closing releases the server so a second start succeeds', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const first = await startPreviewServer({ workspace, base: '/deck' })
    await first.close()
    const second = await startPreviewServer({ workspace, base: '/deck' })
    open = second
    expect(typeof second.middleware).toBe('function')
  })
})
