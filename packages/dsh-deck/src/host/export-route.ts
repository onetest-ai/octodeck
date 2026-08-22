import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { decodeDeckKey, isDeckDirectory } from '../definition.ts'
import type { PreviewHostContext } from './preview-route.ts'

/** A validated export target: the deck's directory and its bare name. */
export interface ExportTarget {
  readonly directory: string
  readonly name: string
}

/**
 * Validate a URL key down to a real deck directory.
 *
 * Identical containment to the preview server's: decode, then require the
 * result to name a `<workspace>/.deck/<name>` directory, so a crafted key
 * cannot walk out to an arbitrary path. That matters more here than it does
 * for preview, because this route *writes*.
 * @param key - the `{key}` path segment, as produced by `deckKey`.
 * @returns the target, or null when the key does not name a deck.
 */
export function resolveExportTarget(key: string): ExportTarget | null {
  const directory = decodeDeckKey(key)
  if (directory === undefined || !isDeckDirectory(directory)) return null
  return { directory, name: basename(directory) }
}

/**
 * Where an exported artifact lands.
 *
 * Inside the deck directory rather than a workspace-level output folder, so a
 * deck stays one self-contained thing the model can list and reference. The
 * theme is part of the filename because the same deck exports differently per
 * theme, and overwriting would lose the comparison the switcher exists to
 * make possible.
 * @param directory - the deck directory.
 * @param name - the deck name.
 * @param theme - the theme the export was rendered in.
 * @param extension - `html`, `pdf`, or `pptx`.
 * @returns the absolute artifact path.
 */
export function exportPath(directory: string, name: string, theme: string, extension: string): string {
  return join(directory, 'export', `${name}-${theme}.${extension}`)
}

/** The three formats this route serves, with the content type each downloads as. */
const CONTENT_TYPE: Record<string, string> = {
  html: 'text/html',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

/** One parsed export request. */
export interface ParsedExportUrl {
  readonly key: string
  readonly format: string
  readonly query: URLSearchParams
}

/**
 * Parse `{key}/{format}` out of a request path under the export prefix.
 *
 * Exactly two segments and a known format: anything else is a 404 rather than
 * a guess, so a typo cannot be answered with some other deck's file.
 * @param url - the incoming request's `req.url`.
 * @param prefix - `${base}/@export`.
 * @returns the key, format, and query, or null when the shape does not match.
 */
export function parseExportUrl(url: string, prefix: string): ParsedExportUrl | null {
  if (!url.startsWith(prefix)) return null
  const [path, search = ''] = url.slice(prefix.length).split('?', 2)
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '')
  if (trimmed === '') return null
  const segments = trimmed.split('/')
  if (segments.length !== 2) return null
  const [key, format] = segments
  if (!Object.hasOwn(CONTENT_TYPE, format)) return null
  return { key, format, query: new URLSearchParams(search) }
}

/**
 * Read a JSON request body, bounded so a runaway post cannot exhaust memory.
 * @param req - the incoming request.
 * @param limit - the largest body accepted, in bytes.
 * @returns the parsed body.
 * @throws {Error} when the body exceeds `limit` or is not valid JSON.
 */
async function readJsonBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new Error(`export body exceeds ${limit} bytes`)
    chunks.push(chunk as Buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * The three format producers, injected so the route is testable without
 * running a real Vite build or loading the vendored pptx pipeline.
 */
export interface ExportProducers {
  html(directory: string, theme: string, mode: string): Promise<Buffer>
  pptx(raw: unknown[][], theme: string): Promise<Buffer>
  pdf(raw: unknown[][], theme: string): Promise<Buffer>
}

/**
 * Handle one export request, independently of how it was routed.
 *
 * Separated from {@link mountExportRoute} so the whole request path — parsing,
 * containment, the producer call, the write, the response — can be exercised
 * against plain request and response doubles.
 * @param req - the incoming request.
 * @param res - the response to write.
 * @param prefix - `${base}/@export`.
 * @param producers - the three format producers.
 * @param onError - reports a failure for logging; the response is still written.
 */
export async function handleExport(
  req: IncomingMessage,
  res: ServerResponse,
  prefix: string,
  producers: ExportProducers,
  onError?: (error: unknown) => void,
): Promise<void> {
  const parsed = parseExportUrl(req.url ?? '', prefix)
  if (parsed === null) { res.statusCode = 404; res.end(); return }
  const target = resolveExportTarget(parsed.key)
  if (target === null) { res.statusCode = 404; res.end(); return }

  const theme = parsed.query.get('theme') ?? 'midnight'
  const mode = parsed.query.get('mode') ?? 'dark'
  try {
    let bytes: Buffer
    if (parsed.format === 'html') {
      bytes = await producers.html(target.directory, theme, mode)
    } else {
      const body = await readJsonBody(req)
      if (typeof body !== 'object' || body === null || !Array.isArray((body as { raw?: unknown }).raw)) {
        res.statusCode = 400
        res.end('export body must be { raw: unknown[][], theme, mode }')
        return
      }
      const raw = (body as { raw: unknown[][] }).raw
      bytes = parsed.format === 'pptx'
        ? await producers.pptx(raw, theme)
        : await producers.pdf(raw, theme)
    }
    // Written *and* streamed: the write is what lets the model see and
    // reference the artifact on disk, the stream is what gets it to the
    // reader without a file hunt.
    const out = exportPath(target.directory, target.name, theme, parsed.format)
    await mkdir(join(target.directory, 'export'), { recursive: true })
    await writeFile(out, bytes)
    res.statusCode = 200
    res.setHeader('Content-Type', CONTENT_TYPE[parsed.format])
    res.setHeader('Content-Disposition', `attachment; filename="${target.name}-${theme}.${parsed.format}"`)
    res.end(bytes)
  } catch (error) {
    onError?.(error)
    res.statusCode = 500
    res.end(error instanceof Error ? error.message : 'export failed')
  }
}

/**
 * Mount the three export endpoints under `${base}/@export`.
 *
 * A separate prefix route rather than a branch inside the preview handler:
 * the harness dispatches longest-prefix-wins, so this claims its own space
 * without the preview route having to know that export exists. The `@` is
 * load bearing — `export` is a legal deck name under the name pattern, so a
 * bare `export` prefix would shadow a real deck.
 * @param ctx - the plugin context, injecting `webServer`.
 * @param options - the mounted base path.
 * @param producers - the three format producers.
 */
export function mountExportRoute(
  ctx: PreviewHostContext,
  options: { readonly base: string },
  producers: ExportProducers,
): void {
  const prefix = `${options.base}/@export`
  ctx.effect(async () => ctx.webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      await handleExport(req, res, prefix, producers, (error) => {
        ctx.logger.warn('deck export failed: %s', error)
      })
    },
  }))
}
