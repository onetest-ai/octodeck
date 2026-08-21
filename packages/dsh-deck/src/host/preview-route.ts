import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { hmrUpgradePath, startPreviewServer } from '../octodeck/vite-server.ts'

/** The `webServer` surface this package consumes, duck-typed against the harness contract. */
interface PreviewHostWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
  registerUpgrade(route: {
    path: string
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  }): () => void
}

/**
 * The plugin-context surface {@link mountPreviewRoute} needs. Structural
 * rather than `@deepseek-ai/cordis`'s `Context` import so this leaf package
 * makes no global module augmentation of a third-party module — the real
 * harness `Context` (which carries a real `webServer`) satisfies this
 * interface structurally at the call site, with no declaration merge.
 */
export interface PreviewHostContext {
  /**
   * Register a disposable side effect. cordis awaits an async body before
   * treating the effect as settled: a disposal that arrives while the body
   * is still in flight waits for it to finish, then runs the disposer it
   * returned — so a resource's setup and teardown live in one effect with
   * no separate promise bookkeeping for the race between them. A rejection
   * is reported through the owning fiber rather than thrown into the
   * process (`vendor/cordis/src/fiber.ts`'s `effect()`: the settled `task`
   * gets one `.catch` that disposes whatever partial cleanup exists and
   * logs the error through `ctx.logger`).
   */
  effect(fn: () => Promise<() => void>): void
  /** The harness's browser HTTP carrier: named route and upgrade-route registries. */
  webServer: PreviewHostWebServer
  /** cordis's structured logger, used to report a disposal-time failure that must not become an unhandled rejection. */
  logger: { warn(format: unknown, ...param: unknown[]): void }
}

/**
 * A page request is the base plus exactly one further path segment (the deck
 * name), with or without a trailing slash, and no file extension. Everything
 * else under the base — module transforms, `@vite/client`, `@fs` paths, the
 * entry module itself — is a Vite-served asset.
 * @param url - the incoming request's `req.url`.
 * @param base - the mounted prefix, no trailing slash.
 * @returns whether `url` names a deck page rather than an asset.
 */
function isDeckPageRequest(url: string, base: string): boolean {
  if (!url.startsWith(base)) return false
  const pathname = url.slice(base.length).split(/[?#]/, 1)[0]
  const segment = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  return segment !== '' && !segment.includes('/') && !segment.includes('.')
}

/**
 * Mount the deck preview on the harness's own web server: one prefix route for
 * HTTP and one upgrade route for hot module replacement, registered from a
 * single async `ctx.effect` alongside starting the preview server itself, so
 *
 * The upgrade route is registered at {@link hmrUpgradePath}`(options.base)`,
 * not at `options.base` itself: the harness dispatches upgrades by exact
 * pathname, and Vite's injected HMR client always requests
 * `path.posix.join(base-with-trailing-slash, hmr.path)` — `${base}/hmr`, not
 * bare `base`. Registering at `base` alone means the socket the browser
 * actually opens never matches any route, and the harness destroys it.
 *
 * cordis owns the whole lifecycle — start, route registration, and teardown
 * — as one unit. Disposing the plugin removes both routes and stops the
 * server; a disposal that lands while the server is still starting is
 * sequenced by cordis after this effect's body settles, so the server it
 * started is never left running unreferenced.
 *
 * The prefix route splits two ways: a deck page request (base plus one deck
 * name segment, e.g. `/deck/launch` or `/deck/launch/`) is answered with
 * `render(url)`'s transformed HTML; every other request — asset transforms,
 * `@vite/client`, `@fs` paths, the entry module — is delegated to the preview
 * server's middleware. A page request without a trailing slash is normalized
 * to one before rendering: the host page's relative module URLs resolve
 * against the request URL, and `render` is only exercised with a trailing
 * slash by the preview server's own tests.
 *
 * If `startPreviewServer` itself fails, the effect body rejects before any
 * route is registered — a plugin that looks mounted while answering nothing
 * is worse than one that visibly failed to start — and cordis reports that
 * failure through the owning fiber instead of the routes silently never
 * appearing.
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - session workspace root and the base path to serve under.
 */
export function mountPreviewRoute(
  ctx: PreviewHostContext,
  options: { readonly workspace: string, readonly base: string },
): void {
  ctx.effect(async () => {
    const started = await startPreviewServer(options)
    const routes = [
      ctx.webServer.register({
        kind: 'prefix',
        path: options.base,
        handler: async (req, res) => {
          const url = req.url ?? options.base
          if (isDeckPageRequest(url, options.base)) {
            const renderUrl = url.endsWith('/') ? url : `${url}/`
            const html = await started.render(renderUrl)
            res.statusCode = 200
            res.setHeader('Content-Type', 'text/html')
            res.end(html)
            return
          }
          started.middleware(req, res, () => { res.statusCode = 404; res.end() })
        },
      }),
      ctx.webServer.registerUpgrade({
        path: hmrUpgradePath(options.base),
        handler: (req, socket, head) => { started.handleUpgrade(req, socket, head) },
      }),
    ]
    return () => {
      for (const dispose of routes) dispose()
      // A rejecting `close()` here is not the effect body's rejection cordis
      // reports through the owning fiber (this runs later, from the
      // disposer) — Node's default `--unhandled-rejections=throw` would
      // otherwise take down the whole harness process for a plugin
      // disposal. Report it and move on: nothing downstream awaits this
      // teardown succeeding.
      started.close().catch((error: unknown) => {
        ctx.logger.warn('deck preview server failed to close cleanly: %s', error)
      })
    }
  })
}
