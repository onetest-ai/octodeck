import { deflateRawSync } from 'node:zlib'

/**
 * The OPC part every consumer reads first. PowerPoint tolerates a great deal
 * in an archive's ordering, but it wants the content-type map at the front,
 * so it is written first regardless of the order the caller built the map in.
 */
const CONTENT_TYPES = '[Content_Types].xml'

/**
 * A fixed DOS timestamp (1980-01-01 00:00) stamped on every entry.
 *
 * Real mtimes would make two exports of an unchanged deck differ byte for
 * byte, which defeats caching and makes "did this actually change?" harder to
 * answer than it needs to be.
 */
const DOS_TIME = 0
const DOS_DATE = 0x0021

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

/**
 * CRC32 as ZIP specifies it: reflected, with an initial and final xor of
 * 0xffffffff.
 * @param bytes - the uncompressed entry payload.
 * @returns the checksum, unsigned.
 */
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/**
 * Package a virtual file map into a ZIP archive, entirely in memory.
 *
 * `buildPptx` already returns exactly such a map, so this replaces both the
 * `python3` zipfile call the CLI export shelled out to and the
 * `dist-pptx/unpacked` disk staging that existed only to feed it. A plugin
 * cannot assume a Python interpreter is on the host, and a format this small
 * does not justify a dependency.
 *
 * Everything is stored deflated, with no ZIP64 and no data descriptors: the
 * parts of a deck export are far below the 4GB field limits, and keeping the
 * writer to a single shape keeps it auditable.
 * @param files - part name (POSIX path, no leading slash) to its contents.
 * @returns the complete archive.
 */
export function zipSync(files: Record<string, string | Uint8Array>): Buffer {
  const names = Object.keys(files).sort((a, b) => {
    if (a === CONTENT_TYPES) return -1
    if (b === CONTENT_TYPES) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })

  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const name of names) {
    const value = files[name]
    const body = typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value)
    const deflated = deflateRawSync(body)
    const nameBytes = Buffer.from(name, 'utf8')
    const sum = crc32(body)

    const local = Buffer.alloc(30 + nameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0, 6) // general purpose flags
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(sum, 14)
    local.writeUInt32LE(deflated.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    nameBytes.copy(local, 30)
    locals.push(local, deflated)

    // Central directory header. The field offsets matter and are easy to get
    // subtly wrong: internal attributes at 36, external at 38, and the local
    // header's offset at 42 — not at 38, which is where a misread of the
    // spec commonly puts it.
    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed to extract
    central.writeUInt16LE(0, 8) // general purpose flags
    central.writeUInt16LE(8, 10) // deflate
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(sum, 16)
    central.writeUInt32LE(deflated.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30) // extra field length
    central.writeUInt16LE(0, 32) // file comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal file attributes
    central.writeUInt32LE(0, 38) // external file attributes
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)

    offset += local.length + deflated.length
  }

  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4) // this disk
  end.writeUInt16LE(0, 6) // disk with the central directory
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20) // comment length
  return Buffer.concat([...locals, directory, end])
}
