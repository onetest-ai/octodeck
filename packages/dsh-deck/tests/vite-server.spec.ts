import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { mkdtemp, realpath, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DECK_DIRECTORY, deckKey } from '../src/definition.ts'
import { DECK_DIRECTORY } from '../src/definition.ts'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { startPreviewServer } from '../src/octodeck/vite-server.ts'

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

/** One GET over a real socket to the wrapped HTTP server, status and body only. */
function rawGet(port: number, path: string): Promise<{ statusCode: number, body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

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
    const html = await server.render(`/deck/${deckKey(join(workspace, DECK_DIRECTORY, 'launch'))}/`)
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

  it('closing actually stops the server from serving requests', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server // afterEach rescues this on any failure path below

    const html = await server.render(`/deck/${deckKey(join(workspace, DECK_DIRECTORY, 'launch'))}/`)
    const entrySrc = html.match(/<script type="module" src="([^"]+entry\.ts)"><\/script>/)?.[1]
    expect(entrySrc).toBeDefined()

    const http = createHttpServer(server.middleware)
    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }

    // A real request over the wrapped HTTP server, one prior to close and one
    // after, distinguishes an actually-stopped server from one that merely
    // reports `close()` resolved: before close the middleware serves the
    // transformed entry module (200, real JavaScript); after close, Vite's own
    // connect stack answers with a synthetic 504 and no body — it no longer
    // forwards to a live dev server. `middlewareMode` never binds a port, so a
    // second `createServer` succeeding (the assertion above) cannot show this;
    // only a request through the middleware itself can.
    try {
      const before = await rawGet(port, entrySrc as string)
      expect(before.statusCode).toBe(200)

      await server.close()
      open = undefined // deliberately closed; afterEach must not close it again

      const after = await rawGet(port, entrySrc as string)
      expect(after.statusCode).not.toBe(200)
      expect(after.body).not.toContain('deck(')
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()))
    }
  })

  it('rewrites the host page entry script to carry the base', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server
    const html = await server.render(`/deck/${deckKey(join(workspace, DECK_DIRECTORY, 'launch'))}/`)
    expect(html).toContain('src="/deck/entry.ts"')
    expect(html).not.toContain('src="/entry.ts"')
  })

  it('serves the entry module as real JavaScript over a real HTTP connection', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
    const server = await startPreviewServer({ workspace, base: '/deck' })
    open = server

    const html = await server.render(`/deck/${deckKey(join(workspace, DECK_DIRECTORY, 'launch'))}/`)
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

  describe('fs.allow narrowing (Finding 4)', () => {
    it('refuses a workspace file outside the deck directory over @fs', async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
      await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
      // A file that lives in the session workspace but outside the deck directory — the
      // reviewer verified live that the pre-fix `fs.allow: [RUNTIME_ROOT,
      // workspace]` served exactly this kind of file over `/deck/@fs/...`,
      // a remote read of the user's project on a non-loopback deployment.
      const realWorkspace = await realpath(workspace)
      const secretPath = join(realWorkspace, 'secret.txt')
      await writeFile(secretPath, 'do not serve me over the deck route')

      const server = await startPreviewServer({ workspace, base: '/deck' })
      open = server
      const http = createHttpServer(server.middleware)
      await new Promise<void>(resolve => http.listen(0, resolve))
      const { port } = http.address() as { port: number }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/deck/@fs${secretPath}`)
        expect(response.status).not.toBe(200)
        const body = await response.text()
        expect(body).not.toContain('do not serve me')
      } finally {
        await new Promise<void>(resolve => http.close(() => resolve()))
      }
    })

    it('still serves a scaffolded deck file under the deck directory', async () => {
      const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
      await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))
      const realWorkspace = await realpath(workspace)
      const slidesPath = join(realWorkspace, DECK_DIRECTORY, 'launch', 'slides.ts')

      const server = await startPreviewServer({ workspace, base: '/deck' })
      open = server
      const http = createHttpServer(server.middleware)
      await new Promise<void>(resolve => http.listen(0, resolve))
      const { port } = http.address() as { port: number }

      try {
        const response = await fetch(`http://127.0.0.1:${port}/deck/@fs${slidesPath}`)
        expect(response.status).toBe(200)
      } finally {
        await new Promise<void>(resolve => http.close(() => resolve()))
      }
    })
  })
})

describe('framework source presence check (Finding 3b)', () => {
  it('fails loudly, naming the resolved path, when the Octodeck framework source is missing', async () => {
    // `octodeck/framework` resolves to a fixed monorepo-relative depth into
    // this repository's own src/framework — a path an installed tarball of
    // this package can never satisfy (the framework source is neither in
    // `files` nor a declared dependency). Simulating that absence by mocking
    // `stat` (the only call this module makes to it) rather than deleting
    // real framework source from this checkout.
    vi.resetModules()
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...actual,
        stat: async (path: unknown) => {
          if (typeof path === 'string' && path.includes(`${join('src', 'framework', 'index.ts')}`)) {
            throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: 'ENOENT' })
          }
          return actual.stat(path as never)
        },
      }
    })
    try {
      const { startPreviewServer: startWithMissingFramework } = await import('../src/octodeck/vite-server.ts')
      const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
      await expect(startWithMissingFramework({ workspace, base: '/deck' })).rejects.toThrow(
        /Octodeck framework source not found at .*src[/\\]framework[/\\]index\.ts.*only runnable from within the octodeck repository/s,
      )
    } finally {
      vi.doUnmock('node:fs/promises')
      vi.resetModules()
    }
  })
})
