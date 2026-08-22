import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { decodeDeckKey, isDeckDirectory } from '../definition.ts'
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
 * The deck-page segment of a request, or null when this is not a page request.
 *
 * A page request is the base plus exactly one further path segment, with or
 * without a trailing slash and with no file extension. Everything else under
 * the base — module transforms, `@vite/client`, `@fs` paths, the entry module
 * itself — is a Vite-served asset.
 * @param url - the incoming request's `req.url`.
 * @param base - the mounted prefix, no trailing slash.
 * @returns the single path segment, or null.
 */
export function deckPageSegment(url: string, base: string): string | null {
  if (!url.startsWith(base)) return null
  const pathname = url.slice(base.length).split(/[?#]/, 1)[0]
  const segment = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (segment === '' || segment.includes('/') || segment.includes('.')) return null
  return segment
}

/**
 * Why a page segment does not name a deck, or null when it does.
 *
 * A deck is addressed by its `deckKey` — an encoding of its absolute
 * directory — not by its name. Serving the host page for any single segment
 * meant a wrong URL rendered a *blank deck* with a 404 in the console, because
 * `runtime/entry.ts` builds its module path from that same segment: it reads
 * as a broken build rather than as a bad address. Answering with the reason
 * costs one decode and removes a whole class of misdiagnosis.
 *
 * A bare deck name is called out specifically, because that is the mistake
 * people actually make — the name is what they know, and the key is what the
 * tool returns.
 * @param segment - the single path segment from {@link deckPageSegment}.
 * @returns a human-readable reason, or null when the segment is a real deck.
 */
export function describeUnknownDeckSegment(segment: string): string | null {
  const directory = decodeDeckKey(segment)
  if (directory !== undefined && isDeckDirectory(directory)) return null
  if (DECK_NAME.test(segment)) {
    return `"${segment}" looks like a deck name, but a deck is addressed by its key. `
      + 'Use the route `deck_view` returns for this deck.'
  }
  return `"${segment}" does not name a deck in any workspace this server serves.`
}

/** The deck-name pattern, used only to recognise the common mistake. */
const DECK_NAME = /^[a-z0-9][a-z0-9-]*$/

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
 * The prefix route splits three ways: a deck page request (base plus one
 * segment) whose segment names a real deck is answered with `render(url)`'s
 * transformed HTML; one whose segment does not is answered with a 404 saying
 * why, rather than a host page that renders as a blank deck; every other
 * request — asset transforms,
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
          const segment = deckPageSegment(url, options.base)
          if (segment !== null) {
            // Validate before rendering: the host page derives its module
            // paths from this segment, so serving it for an unknown one
            // produces a blank deck instead of an error.
            const unknown = describeUnknownDeckSegment(segment)
            if (unknown !== null) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'text/plain; charset=utf-8')
              res.end(unknown)
              return
            }
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
