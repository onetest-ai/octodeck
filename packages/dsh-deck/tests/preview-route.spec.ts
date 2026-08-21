import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { mountPreviewRoute } from '../src/host/preview-route.ts'

function harness() {
  const disposers: Array<() => void> = []
  const webServer = {
    register: vi.fn(() => () => {}),
    registerUpgrade: vi.fn(() => () => {}),
  }
  const ctx = { webServer, effect: vi.fn((fn: () => () => void) => { disposers.push(fn()) }) }
  return { ctx, webServer, disposers }
}

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

describe('mountPreviewRoute', () => {
  it('registers one prefix route and one upgrade route under the base', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { ctx, webServer } = harness()
    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(webServer.register).toHaveBeenCalledTimes(1))
    expect(webServer.register.mock.calls[0][0]).toMatchObject({ kind: 'prefix', path: '/deck' })
    expect(webServer.registerUpgrade.mock.calls[0][0]).toMatchObject({ path: '/deck' })
  })

  it('registers through ctx.effect so disposal removes both routes', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { ctx } = harness()
    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(ctx.effect).toHaveBeenCalled())
  })

  it('serves a real deck page and delegates asset requests to the preview server', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))

    let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined
    const disposers: Array<() => void> = []
    const webServer = {
      register: vi.fn((route: { handler: typeof handler }) => { handler = route.handler; return () => {} }),
      registerUpgrade: vi.fn((_route: { handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }) => () => {}),
    }
    const ctx = { webServer, effect: vi.fn((fn: () => () => void) => { disposers.push(fn()) }) }

    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(handler).toBeDefined())

    const http = createHttpServer((req, res) => { void handler!(req, res) })
    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }

    // Task 5's afterEach-rescue pattern: register the cleanup before any
    // assertion can throw, covering both the http server and the preview
    // server (stopped through the same disposers mountPreviewRoute pushed).
    open = {
      async close() {
        await new Promise<void>(resolve => http.close(() => resolve()))
        for (const dispose of disposers) dispose()
      },
    }

    const page = await rawRequest(port, '/deck/launch/')
    expect(page.statusCode).toBe(200)
    expect(page.headers['content-type']).toContain('text/html')
    expect(page.body).toContain('<div id="deck">')

    const entrySrc = page.body.match(/<script type="module" src="([^"]+entry\.ts)"><\/script>/)?.[1]
    expect(entrySrc).toBeDefined()
    expect(entrySrc).toMatch(/^\/deck\//)

    const asset = await rawRequest(port, entrySrc as string)
    expect(asset.statusCode).toBe(200)
    expect(asset.headers['content-type']).toContain('javascript')
    expect(asset.body).toContain('deck(')
  })

  it('surfaces a startPreviewServer failure instead of silently mounting nothing', async () => {
    // Vite's `createServer` validates `workspace`/`base` extremely
    // leniently — a nonexistent, unwritable, oversized, or non-directory
    // workspace path, and even a non-absolute `base`, all still resolve
    // successfully (verified by hand before writing this test; none of them
    // reject `startPreviewServer`). The one deterministic, non-mocked
    // failure found is a `workspace` value whose string coercion throws:
    // `vite-server.ts` interpolates `options.workspace` into the alias
    // replacement template before `createServer` is ever called, so this is
    // a real synchronous throw inside the real function, not a stubbed
    // module.
    const workspace = { toString() { throw new Error('workspace-tostring-boom') } } as unknown as string
    const { ctx, webServer, disposers } = harness()

    const uncaught = vi.fn()
    const unhandledRejection = vi.fn()
    process.once('uncaughtException', uncaught)
    process.once('unhandledRejection', unhandledRejection)

    mountPreviewRoute(ctx as never, { workspace, base: '/deck' })

    // Let startPreviewServer's rejection propagate through `.then`'s
    // rejection handler and the resulting queueMicrotask throw.
    await new Promise(resolve => setImmediate(resolve))

    expect(uncaught).toHaveBeenCalledTimes(1)
    expect(uncaught.mock.calls[0][0]).toMatchObject({ message: 'workspace-tostring-boom' })
    expect(unhandledRejection).not.toHaveBeenCalled()
    // No routes were ever registered: a plugin that failed to start must not
    // look mounted while answering nothing.
    expect(webServer.register).not.toHaveBeenCalled()
    expect(webServer.registerUpgrade).not.toHaveBeenCalled()

    // Disposal must neither hang nor throw, and must not produce a second
    // unhandled rejection from `ready.then(...)` inside the disposer.
    const secondUncaught = vi.fn()
    const secondUnhandledRejection = vi.fn()
    process.once('uncaughtException', secondUncaught)
    process.once('unhandledRejection', secondUnhandledRejection)
    expect(() => { for (const dispose of disposers) dispose() }).not.toThrow()
    await new Promise(resolve => setImmediate(resolve))
    expect(secondUncaught).not.toHaveBeenCalled()
    expect(secondUnhandledRejection).not.toHaveBeenCalled()

    process.removeListener('uncaughtException', secondUncaught)
    process.removeListener('unhandledRejection', secondUnhandledRejection)
  })
})

/** One GET over a real socket, status/headers/body only. */
function rawRequest(
  port: number,
  path: string,
): Promise<{ statusCode: number, headers: Record<string, string | string[] | undefined>, body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method: 'GET' }, res => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}
