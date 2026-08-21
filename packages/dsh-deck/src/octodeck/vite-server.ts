import { EventEmitter } from 'node:events'
import { realpath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'

/** The preview surface a host route mounts. */
export interface PreviewServer {
  /** Connect-style middleware serving every deck under the configured base. */
  readonly middleware: (req: IncomingMessage, res: ServerResponse, next: () => void) => void
  /** Hand one upgraded socket to Vite's hot server. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void
  /** Transform the deck host page for one preview URL. */
  render(url: string): Promise<string>
  /** Stop the server and release its watchers. */
  close(): Promise<void>
}

/** Where the packaged runtime lives, independent of the caller's cwd. */
const RUNTIME_ROOT = fileURLToPath(new URL('../../runtime/', import.meta.url))

/**
 * Start the shared deck preview server in middleware mode.
 *
 * Vite attaches its hot server to an object it can call `.on('upgrade')` on.
 * The harness owns the real HTTP server, so an emitter stands in and
 * {@link PreviewServer.handleUpgrade} feeds it the sockets the harness routes.
 * @param options - session workspace root and the base path the harness mounts.
 * @returns the running preview server.
 */
export async function startPreviewServer(
  options: { readonly workspace: string, readonly base: string },
): Promise<PreviewServer> {
  const upgrades = new EventEmitter()
  // Vite's dev-server `fs.allow` containment check compares a request's
  // resolved absolute path against this list byte-for-byte; it does not
  // resolve symlinks on either side. `options.workspace` is a caller-supplied
  // path that may still contain one (a macOS `mkdtemp(os.tmpdir())` result is
  // `/var/folders/...`, a symlink to `/private/var/folders/...` — every fs
  // operation on the actual deck files below it resolves through that
  // symlink, so an unresolved allow entry never matches and every `/@dsh-deck/`
  // request 404s, independent of the alias itself resolving correctly).
  // Resolving once here keeps the alias replacement and the allow entry
  // consistent with what the filesystem actually reports.
  const workspace = await realpath(options.workspace)
  const vite: ViteDevServer = await createServer({
    root: RUNTIME_ROOT,
    base: `${options.base}/`,
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: { server: upgrades as unknown as import('node:http').Server },
      fs: { allow: [RUNTIME_ROOT, workspace] },
    },
    resolve: {
      alias: [
        // Workspace decks, reached from the host page and from a deck's own imports.
        { find: /^\/@dsh-deck\//, replacement: `${workspace}/decks/` },
        // `octodeck/framework` and `octodeck/themes` resolve to the framework
        // source in this repository. The root package publishes no such
        // subpaths, so the alias — not an exports map — is what makes the
        // specifier work, in the seeded slides.ts and in the host entry alike.
        { find: 'octodeck/framework', replacement: fileURLToPath(new URL('../../../../src/framework/index.ts', import.meta.url)) },
        { find: 'octodeck/themes', replacement: fileURLToPath(new URL('../../../../src/themes/index.ts', import.meta.url)) },
      ],
    },
  })
  return {
    middleware: vite.middlewares,
    handleUpgrade(req, socket, head) { upgrades.emit('upgrade', req, socket, head) },
    async render(url) {
      const { readFile } = await import('node:fs/promises')
      const html = await readFile(join(RUNTIME_ROOT, 'index.html'), 'utf8')
      return vite.transformIndexHtml(url, html)
    },
    async close() { await vite.close() },
  }
}
