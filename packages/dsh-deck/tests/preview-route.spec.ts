import { createServer as createHttpServer, request as httpRequest } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDeck } from '../src/definition.ts'
import { scaffoldDeck } from '../src/octodeck/scaffold.ts'
import { mountPreviewRoute, type PreviewHostContext } from '../src/host/preview-route.ts'

/**
 * A `PreviewHostContext` stub whose `effect` mimics only the part of real
 * cordis semantics this suite depends on: `execute` runs immediately
 * (synchronously starting the async body, exactly like
 * `vendor/cordis/src/fiber.ts`'s `effect()` calling `runner.execute.call(this)`
 * eagerly), and once the body settles its disposer is collected. Deferred:
 * this collects disposers FIFO, where real cordis unwinds them LIFO — left
 * alone per review ruling.
 */
function harness() {
  const disposers: Array<() => void> = []
  const webServer = {
    register: vi.fn(() => () => {}),
    registerUpgrade: vi.fn(() => () => {}),
  }
  const logger = { warn: vi.fn() }
  const ctx: PreviewHostContext = {
    webServer,
    logger,
    effect: (fn) => {
      void fn().then(
        (dispose) => { disposers.push(dispose) },
        // A rejected effect body is cordis's to report (vendor/cordis/src/fiber.ts
        // logs it through the owning fiber); this stub has no logger to hand
        // it to, so tests that exercise a rejection capture it themselves by
        // awaiting the effect body directly instead of relying on this catch.
        () => {},
      )
    },
  }
  return { ctx, webServer, disposers, logger }
}

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

describe('mountPreviewRoute', () => {
  it('registers one prefix route and one upgrade route under the base', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { ctx, webServer, disposers } = harness()
    mountPreviewRoute(ctx, { workspace, base: '/deck' })
    await vi.waitFor(() => expect(webServer.register).toHaveBeenCalledTimes(1))

    // Register cleanup before any assertion below can throw: the single
    // async effect also starts a real Vite dev server (watchers included),
    // and a thrown `toMatchObject` must not skip releasing it.
    await vi.waitFor(() => expect(disposers.length).toBeGreaterThan(0))
    open = { close: async () => { for (const dispose of disposers) dispose() } }

    expect(webServer.register.mock.calls[0][0]).toMatchObject({ kind: 'prefix', path: '/deck' })
    // Finding 1: the upgrade route must sit at the path Vite's HMR client
    // actually requests (`${base}/hmr`), not at the bare base — see
    // hmrUpgradePath's doc in src/octodeck/vite-server.ts.
    expect(webServer.registerUpgrade.mock.calls[0][0]).toMatchObject({ path: '/deck/hmr' })
  })

  // Finding 6: a test titled "registers through a single async ctx.effect so
  // disposal removes both routes and stops the server" used to live here,
  // asserting only `disposers.length > 0` — never disposing, never checking
  // a route was removed, never checking the server stopped. That behavior
  // is genuinely covered below, by "sequences disposal after an in-flight
  // start": it disposes for real, then proves the server actually stopped
  // by requesting `/deck/entry.ts` after `dispose()` and asserting it no
  // longer serves the live module. Deleted rather than given a body that
  // would just duplicate that test.

  it('serves a real deck page and delegates asset requests to the preview server', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))

    let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined
    const disposers: Array<() => void> = []
    const webServer = {
      register: vi.fn((route: { handler: typeof handler }) => { handler = route.handler; return () => {} }),
      registerUpgrade: vi.fn((_route: { handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void }) => () => {}),
    }
    const ctx: PreviewHostContext = {
      webServer,
      logger: { warn: vi.fn() },
      effect: (fn) => { void fn().then((dispose) => { disposers.push(dispose) }) },
    }

    mountPreviewRoute(ctx, { workspace, base: '/deck' })
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

    // entry.ts requests its slides/meta prefixed with
    // `import.meta.env.BASE_URL` rather than a bare `/@dsh-deck/...` path
    // (see runtime/entry.ts's own comment): Vite's dev server injects a live
    // `import.meta.env` object (BASE_URL: '/deck/', confirmed below) rather
    // than inlining a literal at transform time, so the served module keeps
    // the property access and the base-prefixed template, never the bare
    // path template the pre-fix version served.
    expect(asset.body).toContain('"BASE_URL": "/deck/"')
    expect(asset.body).toContain('import.meta.env.BASE_URL')
    expect(asset.body).toContain('`${base}@dsh-deck/${name}/slides.ts`')
    expect(asset.body).toContain('`${base}@dsh-deck/${name}/deck.json?import`')
    expect(asset.body).not.toContain('`/@dsh-deck/${name}/slides.ts`')
    expect(asset.body).not.toContain('`/@dsh-deck/${name}/deck.json`')

    // The requests entry.ts actually issues at runtime: both must resolve
    // through the mounted route (the harness webserver only forwards
    // `/deck/*` to this middleware), not 404 the way a bare `/@dsh-deck/...`
    // path would (this is the regression this test now guards against).
    const slidesModule = await rawRequest(port, '/deck/@dsh-deck/launch/slides.ts')
    expect(slidesModule.statusCode).toBe(200)
    expect(slidesModule.headers['content-type']).toContain('javascript')

    // `deck.json` needs the `?import` marker: Vite's transform middleware
    // recognizes `.ts`/`.js` by extension alone, but a non-JS-extension file
    // requested outside Vite's own static import analysis (this dynamic
    // import is `@vite-ignore`) falls through to static file serving without
    // it — which does not know this package's `/@dsh-deck/` alias and 404s,
    // confirmed by the assertion right below.
    const deckJsonBare = await rawRequest(port, '/deck/@dsh-deck/launch/deck.json')
    expect(deckJsonBare.statusCode).toBe(404)

    const deckJson = await rawRequest(port, '/deck/@dsh-deck/launch/deck.json?import')
    expect(deckJson.statusCode).toBe(200)
    expect(deckJson.headers['content-type']).toContain('javascript')
    expect(deckJson.body).toContain('midnight')
  })

  it('sequences disposal after an in-flight start: no server survives, no unhandled rejection', async () => {
    // Finding 1's race: a disposal that arrives while `startPreviewServer`
    // is still resolving must not run against a half-started resource, and
    // must not leak the server that does eventually start. Real cordis
    // sequences this itself (`disposeAfter(waitForSetup())` in
    // `vendor/cordis/src/fiber.ts`'s `effect()`: a disposal mid-flight waits
    // for the async body to settle, then runs the disposer it returned).
    // This test reproduces exactly that sequencing against the real
    // `mountPreviewRoute`/`startPreviewServer`, without a real cordis fiber,
    // by capturing the effect body cordis would have awaited and awaiting it
    // the same way before disposing.
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    await scaffoldDeck(resolveDeck({ name: 'launch' }, workspace))

    let handler: ((req: IncomingMessage, res: ServerResponse) => void | Promise<void>) | undefined
    const webServer = {
      register: vi.fn((route: { handler: typeof handler }) => { handler = route.handler; return () => {} }),
      registerUpgrade: vi.fn(() => () => {}),
    }
    let bodyPromise: Promise<() => void> | undefined
    const ctx: PreviewHostContext = { webServer, logger: { warn: vi.fn() }, effect: (fn) => { bodyPromise = fn() } }

    const unhandledRejection = vi.fn()
    process.once('unhandledRejection', unhandledRejection)

    mountPreviewRoute(ctx, { workspace, base: '/deck' })
    // The body is captured synchronously (cordis calls `execute()` eagerly);
    // `startPreviewServer` inside it is still unresolved here — the race
    // window Finding 1 describes.
    expect(bodyPromise).toBeDefined()

    const dispose = await bodyPromise!
    dispose()

    expect(handler).toBeDefined()
    const http = createHttpServer((req, res) => { void handler!(req, res) })
    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }
    try {
      // `render()`'s transformed HTML can still succeed after `vite.close()`
      // — it's largely string manipulation, not a live-module request — so,
      // like vite-server.spec.ts's own "closing actually stops the server"
      // test, prove closure through the entry module instead: that request
      // needs the live module graph, and only fails once the server is
      // genuinely stopped. `/deck/entry.ts` is the known rewritten path from
      // the "rewrites the host page entry script to carry the base" test.
      const after = await rawRequest(port, '/deck/entry.ts')
      expect(after.statusCode).not.toBe(200)
      expect(after.body).not.toContain('deck(')
    } finally {
      await new Promise<void>(resolve => http.close(() => resolve()))
    }

    await new Promise(resolve => setImmediate(resolve))
    expect(unhandledRejection).not.toHaveBeenCalled()
  })

  it('rejects the effect body on a startPreviewServer failure instead of registering routes', async () => {
    // Vite's `createServer` validates `workspace`/`base` extremely
    // leniently — a nonexistent, unwritable, oversized, or non-directory
    // workspace path, and even a non-absolute `base`, all still resolve
    // successfully (verified by hand; none of them reject
    // `startPreviewServer`). The one deterministic, non-mocked failure found
    // is a `workspace` value `node:fs/promises`'s `realpath` rejects:
    // `vite-server.ts` resolves `options.workspace` through `realpath` before
    // `createServer` is ever called (so the alias replacement and the
    // `fs.allow` entry agree on a symlink-resolved path — see that file's own
    // comment), which is a real rejection inside the real function, not a
    // stubbed module. This replaces a prior version of this test that relied
    // on a `workspace` value whose string coercion threw: `realpath` now
    // validates its argument's type before ever reaching a `.toString()`
    // call, so that failure mode no longer reaches this function first.
    //
    // This test's assertions changed from the prior round: that version
    // asserted a process-wide `uncaughtException`, which was how the
    // now-removed `queueMicrotask` rethrow surfaced a startup failure.
    // Surfacing a failed effect is cordis's job now (`vendor/cordis/src/fiber.ts`
    // reports it through the owning fiber), so the only thing left for this
    // package's own code to guarantee is what's asserted below: the
    // rejection actually reaches the effect body cordis awaits, and no
    // route was registered before that rejection. See the fix-round-2
    // report for the ruling this is pending.
    const workspace = { notAPath: true } as unknown as string
    const webServer = {
      register: vi.fn(() => () => {}),
      registerUpgrade: vi.fn(() => () => {}),
    }
    let bodyPromise: Promise<() => void> | undefined
    const ctx: PreviewHostContext = { webServer, logger: { warn: vi.fn() }, effect: (fn) => { bodyPromise = fn() } }

    mountPreviewRoute(ctx, { workspace, base: '/deck' })

    await expect(bodyPromise).rejects.toThrow(/path.*argument/i)
    expect(webServer.register).not.toHaveBeenCalled()
    expect(webServer.registerUpgrade).not.toHaveBeenCalled()
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
