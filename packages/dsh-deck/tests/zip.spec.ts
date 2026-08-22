import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { zipSync } from '../src/export/zip.ts'

/**
 * Minimal central-directory reader: enough to assert entry order, names, and
 * payloads without taking a dependency on an unzip library. Written here
 * rather than in the source because only the tests need to read an archive.
 * @param buf - the archive.
 * @returns each entry's name and inflated contents, in central-directory order.
 */
function readZip(buf: Buffer): { name: string, data: Buffer }[] {
  const eocd = buf.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'))
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const entries: { name: string, data: Buffer }[] = []
  for (let i = 0; i < count; i++) {
    const nameLen = buf.readUInt16LE(at + 28)
    const extraLen = buf.readUInt16LE(at + 30)
    const commentLen = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.subarray(at + 46, at + 46 + nameLen).toString('utf8')
    const method = buf.readUInt16LE(local + 8)
    const compSize = buf.readUInt32LE(local + 18)
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const raw = buf.subarray(start, start + compSize)
    entries.push({ name, data: method === 8 ? inflateRawSync(raw) : Buffer.from(raw) })
    at += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

describe('zipSync', () => {
  it('round-trips every entry byte-for-byte', () => {
    const entries = readZip(zipSync({
      '[Content_Types].xml': '<Types/>',
      'ppt/presentation.xml': '<p:presentation/>',
      'ppt/media/image1.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    }))
    const byName = new Map(entries.map(entry => [entry.name, entry.data]))
    expect(byName.get('[Content_Types].xml')?.toString('utf8')).toBe('<Types/>')
    expect(byName.get('ppt/presentation.xml')?.toString('utf8')).toBe('<p:presentation/>')
    expect([...(byName.get('ppt/media/image1.png') ?? [])]).toEqual([0x89, 0x50, 0x4e, 0x47])
  })

  it('places [Content_Types].xml first whatever the insertion order', () => {
    const entries = readZip(zipSync({
      'ppt/presentation.xml': '<p:presentation/>',
      '[Content_Types].xml': '<Types/>',
    }))
    expect(entries[0].name).toBe('[Content_Types].xml')
  })

  it('records a CRC32 that matches the uncompressed bytes', () => {
    // CRC32 of "hello" is 0x3610a686; byte 14 of the first local header is its crc field.
    expect(zipSync({ '[Content_Types].xml': 'hello' }).readUInt32LE(14)).toBe(0x3610a686)
  })

  it('points each central-directory entry at its own local header', () => {
    const buf = zipSync({ '[Content_Types].xml': '<Types/>', 'ppt/presentation.xml': '<p:presentation/>' })
    // readZip only produces correct payloads if every local-header offset is
    // right, so a wrong offset field surfaces as garbage rather than passing.
    for (const entry of readZip(buf)) {
      expect(entry.data.length).toBeGreaterThan(0)
      expect(entry.data.toString('utf8')).toMatch(/^</)
    }
  })

  it('is deterministic, so the same deck exports byte-identically', () => {
    const files = { '[Content_Types].xml': '<Types/>', 'ppt/slides/slide1.xml': '<p:sld/>' }
    expect(zipSync(files).equals(zipSync(files))).toBe(true)
  })
})
