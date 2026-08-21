import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { startPreviewServer, type PreviewServer } from '../octodeck/vite-server.ts'

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
  /** Register a disposable side effect; the returned disposer undoes it. */
  effect(fn: () => () => void): void
  /** The harness's browser HTTP carrier: named route and upgrade-route registries. */
  webServer: PreviewHostWebServer
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
 * HTTP and one upgrade route for hot module replacement, both as effects so
 * disposing the plugin removes them and stops the server.
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
 * If `startPreviewServer` itself fails, no routes are registered — a plugin
 * that looks mounted while answering nothing is worse than one that visibly
 * failed to start — so the failure is rethrown from a queued microtask,
 * surfacing as an uncaught exception rather than vanishing as a silently
 * unhandled rejection. The internal `ready` promise itself always resolves
 * (to the started server, or to `undefined` on failure) so a later disposal
 * never awaits an already-rejected promise and can never hang.
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - session workspace root and the base path to serve under.
 */
export function mountPreviewRoute(
  ctx: PreviewHostContext,
  options: { readonly workspace: string, readonly base: string },
): void {
  const ready: Promise<PreviewServer | undefined> = startPreviewServer(options).then(
    (started) => {
      ctx.effect(() => {
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
            path: options.base,
            handler: (req, socket, head) => { started.handleUpgrade(req, socket, head) },
          }),
        ]
        return () => { for (const dispose of routes) dispose() }
      })
      return started
    },
    (error: unknown) => {
      queueMicrotask(() => { throw error })
      return undefined
    },
  )
  ctx.effect(() => () => { void ready.then(async (started) => { await started?.close() }) })
}
