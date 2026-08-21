import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { startPreviewServer, type PreviewServer } from '../octodeck/vite-server.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /**
     * The harness's browser HTTP carrier: named route and upgrade-route
     * registries. This package consumes only `register`/`registerUpgrade`;
     * the owning `@deepseek-ai/dsh-host-webserver` service composes the rest.
     */
    webServer: PreviewHostWebServer
  }
}

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
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - session workspace root and the base path to serve under.
 */
export function mountPreviewRoute(
  ctx: Context,
  options: { readonly workspace: string, readonly base: string },
): void {
  let server: PreviewServer | undefined
  const ready = startPreviewServer(options).then((started) => {
    server = started
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
  })
  ctx.effect(() => () => { void ready.then(async () => { await server?.close() }) })
}
