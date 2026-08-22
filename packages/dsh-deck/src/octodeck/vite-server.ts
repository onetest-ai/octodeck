import { EventEmitter } from 'node:events'
import { readFile, realpath, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Duplex } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createServer, type ViteDevServer } from 'vite'
import { decodeDeckKey, isDeckDirectory } from '../definition.ts'

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
 * The Octodeck framework and theme sources this package carries.
 *
 * Vite compiles them from disk at request time, so the package ships the
 * sources rather than compiled output; `scripts/vendor-framework.mjs` copies
 * them in at build time. Resolving them inside the package — instead of by
 * relative depth into a checkout — is what lets an installed copy serve a
 * deck: the previous path only existed when the package sat in this
 * repository, and from `<profile>/node_modules/@onetest/dsh-deck` it pointed
 * at a directory in the consumer's own tree.
 */
const VENDORED_SOURCE = new URL('../../vendor/src/', import.meta.url)

/**
 * The HMR upgrade path segment, relative to the mounted base. Vite's
 * injected client computes its socket URL as `path.posix.join(config.base,
 * hmr.path)` (`vendor` Vite's `client-inject` transform), which for a
 * trailing-slash base and this segment yields exactly `${base}/hmr` with no
 * trailing slash — the same string {@link hmrUpgradePath} builds. Both the
 * `server.hmr.path` passed to `createServer` below and the harness upgrade
 * route registered in `preview-route.ts` derive from this one constant so
 * they cannot drift apart.
 */
const HMR_PATH_SEGMENT = 'hmr'

/**
 * The exact-match pathname the harness's upgrade-route dispatcher must
 * register to receive Vite's HMR socket. The harness dispatches upgrades by
 * exact pathname with no trailing slash (`packages/host/webserver`'s
 * `WebUpgradeRoute`); Vite's client always includes the base's trailing
 * slash before joining `hmr.path` onto it, so the base alone (as
 * `mountPreviewRoute` used to register) never matches.
 * @param base - the mounted prefix, no trailing slash.
 * @returns the pathname Vite's HMR client will actually request, e.g. `/deck/hmr`.
 */
export function hmrUpgradePath(base: string): string {
  return `${base}/${HMR_PATH_SEGMENT}`
}

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
  const frameworkEntry = fileURLToPath(new URL('framework/index.ts', VENDORED_SOURCE))
  const themesEntry = fileURLToPath(new URL('themes/index.ts', VENDORED_SOURCE))
  // The sources ship inside the package (see VENDORED_SOURCE), so this
  // resolves for an installed copy as readily as from this repository. The
  // check below stays because the copy is a build step: a package built
  // without it would otherwise serve every deck a confusing module-not-found
  // from deep inside Vite; failing here, once, with the
  // resolved path and the actual requirement named, is the only fix in scope
  // until the framework itself is published or bundled.
  const frameworkStat = await stat(frameworkEntry).catch((error: unknown) => {
    throw new Error(
      `Octodeck framework source not found at ${frameworkEntry}. `
      + 'This build resolves "octodeck/framework" to a fixed path inside an Octodeck '
      + 'checkout and is currently only runnable from within the octodeck repository, '
      + 'not from an installed @onetest/dsh-deck package.',
      { cause: error },
    )
  })
  if (!frameworkStat.isFile()) {
    throw new Error(`Octodeck framework source at ${frameworkEntry} is not a file (found ${frameworkStat.isDirectory() ? 'a directory' : 'something else'}).`)
  }
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
    plugins: [{
      /**
       * Resolve `/@dsh-deck/<key>/<file>` to a file inside the deck the key
       * addresses. The key carries the deck's absolute directory, so one
       * server serves decks from every session's own workspace — the previous
       * static alias could only ever reach the single workspace the server was
       * mounted with, which is why a deck created in a session rendered blank.
       *
       * `isDeckDirectory` is the containment rule. Vite's `fs.allow` no longer
       * lists any workspace, so a request reaches exactly what this admits: a
       * name segment directly inside a `.deck` folder. A crafted key cannot
       * walk out to an arbitrary file.
       */
      name: 'dsh-deck-workspace-decks',
      resolveId(source: string) {
        const match = /^\/@dsh-deck\/([^/]+)\/(.+)$/.exec(source)
        if (match === null) return null
        const directory = decodeDeckKey(match[1])
        if (directory === undefined || !isDeckDirectory(directory)) return null
        return join(directory, match[2])
      },
      /**
       * Read deck files here rather than letting Vite serve them from disk.
       * Vite applies `fs.allow` to any path it serves itself, and no workspace
       * is on that list — deliberately, so the preview cannot be walked out
       * into a user's project. Loading the bytes in the plugin keeps the
       * containment rule `isDeckDirectory` above and nothing else: the id was
       * built from a decoded key that had to name a `.deck/<name>` directory.
       */
      async load(id: string) {
        const path = id.split('?')[0]
        if (!isDeckDirectory(dirname(path))) return null
        return readFile(path, 'utf8')
      },
    }],
    server: {
      middlewareMode: true,
      hmr: { path: HMR_PATH_SEGMENT, server: upgrades as unknown as import('node:http').Server },
      // Only the deck directory needs Vite's `@fs` passthrough: the host
      // page and its imports never reach outside `.deck/`. Granting the
      // whole workspace here served arbitrary session-workspace files over
      // `/deck/@fs/...` to any browser that could reach the mounted route —
      // a remote read of the user's project on a non-loopback deployment.
      fs: { allow: [RUNTIME_ROOT, fileURLToPath(VENDORED_SOURCE)] },
    },
    resolve: {
      alias: [
        // `octodeck/framework` and `octodeck/themes` resolve to the framework
        // source in this repository. The root package publishes no such
        // subpaths, so the alias — not an exports map — is what makes the
        // specifier work, in the seeded slides.ts and in the host entry alike.
        { find: 'octodeck/framework', replacement: frameworkEntry },
        { find: 'octodeck/themes', replacement: themesEntry },
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
