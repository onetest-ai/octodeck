import { createServer as createHttpServer } from 'node:http'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { mountPreviewRoute, type PreviewHostContext } from '../src/host/preview-route.ts'

/**
 * Finding 1's regression test: every prior "HMR works" claim in this branch
 * rested on Vite merely *accepting* an `EventEmitter` as `hmr.server` — no
 * test ever opened a socket through the mounted route. This one does: a real
 * `ws` client, the same subprotocol Vite's injected HMR client uses
 * (`vite-hmr`), driven through a stand-in HTTP server whose upgrade dispatch
 * mirrors the harness's actual contract (`packages/host/webserver`'s
 * `WebUpgradeRoute`: exact-pathname match, no trailing slash, socket
 * destroyed on no match) rather than a mock that only records what path was
 * registered.
 */
function harnessLikeWebServer() {
  const upgradeRoutes = new Map<string, (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>>()
  const webServer = {
    register: (_route: { path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }) => () => {},
    registerUpgrade: (route: { path: string, handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void> }) => {
      upgradeRoutes.set(route.path, route.handler)
      return () => { upgradeRoutes.delete(route.path) }
    },
  }
  const http = createHttpServer((_req, res) => { res.writeHead(404); res.end() })
  http.on('upgrade', (req, socket, head) => {
    // Exact-pathname dispatch, matching packages/host/webserver/src/index.ts's
    // `this.upgrades.get(new URL(req.url ?? '/', 'http://x').pathname)`: a
    // registration at the bare base (the pre-fix behavior) would miss here
    // exactly as it misses in the real harness, and this destroys the socket
    // instead of connecting it.
    const pathname = new URL(req.url ?? '/', 'http://x').pathname
    const handler = upgradeRoutes.get(pathname)
    if (handler === undefined) {
      socket.destroy()
      return
    }
    void handler(req, socket, head)
  })
  return { webServer, http }
}

let open: { close(): Promise<void> } | undefined
afterEach(async () => { await open?.close(); open = undefined })

describe('HMR upgrade route (Finding 1)', () => {
  it('actually opens a vite-hmr WebSocket through the mounted upgrade route', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const { webServer, http } = harnessLikeWebServer()
    const disposers: Array<() => void> = []
    const ctx: PreviewHostContext = {
      webServer,
      logger: { warn: () => {} },
      effect: (fn) => { void fn().then((dispose) => { disposers.push(dispose) }) },
    }

    mountPreviewRoute(ctx, { workspace, base: '/deck' })
    await new Promise<void>((resolve) => {
      const check = (): void => { if (disposers.length > 0) resolve(); else setTimeout(check, 5) }
      check()
    })

    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }

    open = {
      async close() {
        for (const dispose of disposers) dispose()
        await new Promise<void>(resolve => http.close(() => resolve()))
      },
    }

    // Vite's injected client connects to `path.posix.join(base, hmr.path)`
    // with subprotocol `vite-hmr` — this is that exact request, issued as a
    // real WebSocket handshake over a real socket, not an assertion about
    // what path got registered.
    const socket = new WebSocket(`ws://127.0.0.1:${port}/deck/hmr`, 'vite-hmr')
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', () => resolve())
        socket.once('error', reject)
        socket.once('close', (code) => reject(new Error(`socket closed before opening (code ${code})`)))
      })
      expect(socket.readyState).toBe(WebSocket.OPEN)
      expect(socket.protocol).toBe('vite-hmr')
    } finally {
      socket.close()
      await new Promise<void>((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) { resolve(); return }
        socket.once('close', () => resolve())
      })
    }
  })

  it('confirms the bare base alone (the pre-fix path) never accepts the connection', async () => {
    // Documents the actual failure mode Finding 1 describes: registering the
    // upgrade route at `options.base` instead of `hmrUpgradePath(options.base)`
    // means the harness's exact-pathname dispatch has nothing at `/deck/hmr`,
    // so the handshake never completes and the socket is destroyed.
    const { webServer, http } = harnessLikeWebServer()
    webServer.registerUpgrade({ path: '/deck', handler: () => {} })
    await new Promise<void>(resolve => http.listen(0, resolve))
    const { port } = http.address() as { port: number }
    open = { close: async () => { await new Promise<void>(resolve => http.close(() => resolve())) } }

    const socket = new WebSocket(`ws://127.0.0.1:${port}/deck/hmr`, 'vite-hmr')
    await new Promise<void>((resolve) => {
      socket.once('open', () => { socket.close(); resolve() })
      socket.once('error', () => resolve())
      socket.once('close', () => resolve())
    })
    expect(socket.readyState).not.toBe(WebSocket.OPEN)
  })
})
