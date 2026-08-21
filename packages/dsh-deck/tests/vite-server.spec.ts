import { createServer as createHttpServer } from 'node:http'
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

  it('rewrites the host page entry script to carry the base', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    const html = await server.render('/deck/launch/')
    expect(html).toContain('src="/deck/entry.ts"')
    expect(html).not.toContain('src="/entry.ts"')
  })

  it('serves the entry module as real JavaScript over a real HTTP connection', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server

    const html = await server.render('/deck/launch/')
    const entrySrc = html.match(/<script type="module" src="([^"]+entry\.ts)"><\/script>/)?.[1]
    expect(entrySrc).toBeDefined()

    const http = createHttpServer(server.middleware)
    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }

    try {
      const response = await fetch(`http://127.0.0.1:${port}${entrySrc}`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('javascript')
      const body = await response.text()
      // The seeded entry calls the framework's `deck(...)` bootstrap; a
      // transformed-but-unminified dev response keeps that identifier, so its
      // presence proves the module actually transformed rather than 404ing
      // or erroring into an HTML/empty response that also happens to be status 200.
      // The rewritten import also proves the `octodeck/framework` alias resolved
      // to the real framework source through Vite's `@fs` filesystem passthrough.
      expect(body).toContain('deck(')
      expect(body).toContain('/deck/@fs/')
      expect(body).toContain('src/framework/index.ts')
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })
})
