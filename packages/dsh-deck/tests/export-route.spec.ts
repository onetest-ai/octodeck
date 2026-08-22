import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deckKey } from '../src/definition.ts'
import { exportPath, handleExport, parseExportUrl, resolveExportTarget } from '../src/host/export-route.ts'

describe('resolveExportTarget', () => {
  it('accepts a key naming a real deck directory', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const directory = join(workspace, '.deck', 'launch')
    await mkdir(directory, { recursive: true })
    expect(resolveExportTarget(deckKey(directory))).toEqual({ directory, name: 'launch' })
  })

  it('rejects a key that decodes outside a .deck directory', () => {
    // The route writes, so containment matters more here than for preview.
    expect(resolveExportTarget(deckKey('/etc'))).toBeNull()
  })

  it('rejects a malformed key rather than decoding it', () => {
    expect(resolveExportTarget('not a key!!')).toBeNull()
  })
})

describe('exportPath', () => {
  it('names the artifact by deck and theme, inside the deck directory', () => {
    expect(exportPath('/w/.deck/launch', 'launch', 'radiant', 'pdf'))
      .toBe('/w/.deck/launch/export/launch-radiant.pdf')
  })

  it('keeps one artifact per theme, so exports do not overwrite each other', () => {
    const a = exportPath('/w/.deck/launch', 'launch', 'radiant', 'pdf')
    const b = exportPath('/w/.deck/launch', 'launch', 'commit', 'pdf')
    expect(a).not.toBe(b)
  })
})

describe('parseExportUrl', () => {
  const prefix = '/deck/@export'

  it('reads the key, the format, and the query', () => {
    const parsed = parseExportUrl(`${prefix}/abc123/html?theme=radiant&mode=light`, prefix)
    expect(parsed?.key).toBe('abc123')
    expect(parsed?.format).toBe('html')
    expect(parsed?.query.get('theme')).toBe('radiant')
    expect(parsed?.query.get('mode')).toBe('light')
  })

  it('accepts all three formats and nothing else', () => {
    for (const format of ['html', 'pdf', 'pptx']) {
      expect(parseExportUrl(`${prefix}/abc/${format}`, prefix)?.format).toBe(format)
    }
    expect(parseExportUrl(`${prefix}/abc/exe`, prefix)).toBeNull()
  })

  it('rejects a path that is not exactly key/format', () => {
    expect(parseExportUrl(`${prefix}/abc`, prefix)).toBeNull()
    expect(parseExportUrl(`${prefix}/abc/html/extra`, prefix)).toBeNull()
    expect(parseExportUrl('/elsewhere/abc/html', prefix)).toBeNull()
  })
})

/** A minimal ServerResponse double: records what the handler wrote. */
function fakeRes() {
  const headers: Record<string, string> = {}
  return {
    statusCode: 0,
    headers,
    body: undefined as Buffer | string | undefined,
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value },
    end(chunk?: Buffer | string) { this.body = chunk },
  }
}

/** A request double; `body` is streamed when the handler reads it. */
function fakeReq(url: string, body?: unknown) {
  const payload = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
  return {
    url,
    async *[Symbol.asyncIterator]() { yield* payload },
  } as unknown as import('node:http').IncomingMessage
}

describe('handleExport', () => {
  const prefix = '/deck/@export'
  const producers = {
    html: async () => Buffer.from('<!DOCTYPE html>deck'),
    pptx: async (raw: unknown[][]) => Buffer.from(`pptx:${raw.length}`),
    pdf: async () => Buffer.from('%PDF-1.7'),
  }

  async function deckAt() {
    const workspace = await mkdtemp(join(tmpdir(), 'dsh-deck-'))
    const directory = join(workspace, '.deck', 'launch')
    await mkdir(directory, { recursive: true })
    return directory
  }

  it('writes the artifact to disk and streams the same bytes back', async () => {
    const directory = await deckAt()
    const res = fakeRes()
    await handleExport(fakeReq(`${prefix}/${deckKey(directory)}/html?theme=radiant`), res as never, prefix, producers)
    expect(res.statusCode).toBe(200)
    expect(res.body?.toString()).toBe('<!DOCTYPE html>deck')
    const written = await readFile(exportPath(directory, 'launch', 'radiant', 'html'), 'utf8')
    expect(written).toBe('<!DOCTYPE html>deck')
  })

  it('offers the file as a download named for the deck and theme', async () => {
    const directory = await deckAt()
    const res = fakeRes()
    await handleExport(fakeReq(`${prefix}/${deckKey(directory)}/pdf?theme=commit`, { raw: [[]] }), res as never, prefix, producers)
    expect(res.headers['content-type']).toBe('application/pdf')
    expect(res.headers['content-disposition']).toBe('attachment; filename="launch-commit.pdf"')
  })

  it('404s a key that does not name a deck, without calling a producer', async () => {
    const res = fakeRes()
    let called = false
    await handleExport(fakeReq(`${prefix}/${deckKey('/etc')}/html`), res as never, prefix, {
      ...producers,
      html: async () => { called = true; return Buffer.from('') },
    })
    expect(res.statusCode).toBe(404)
    expect(called).toBe(false)
  })

  it('400s a body without a raw array, and writes nothing', async () => {
    const directory = await deckAt()
    const res = fakeRes()
    await handleExport(fakeReq(`${prefix}/${deckKey(directory)}/pptx?theme=radiant`, { nope: 1 }), res as never, prefix, producers)
    expect(res.statusCode).toBe(400)
    await expect(readFile(exportPath(directory, 'launch', 'radiant', 'pptx'))).rejects.toThrow()
  })

  it('reports a producer failure as a 500 carrying its message', async () => {
    const directory = await deckAt()
    const res = fakeRes()
    const errors: unknown[] = []
    await handleExport(fakeReq(`${prefix}/${deckKey(directory)}/html`), res as never, prefix, {
      ...producers,
      html: async () => { throw new Error('no such theme') },
    }, error => errors.push(error))
    expect(res.statusCode).toBe(500)
    expect(res.body?.toString()).toBe('no such theme')
    expect(errors).toHaveLength(1)
  })
})
