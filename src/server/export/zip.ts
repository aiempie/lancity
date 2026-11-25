/**
 * Minimal ZIP reader and writer on Web streams (`CompressionStream('deflate-raw')`), so exports and XLSX files
 * need no dependency. Replaces Python `zipfile` (PD-1131). ZIP64 and encryption are not supported.
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()
/** Upper bound of one inflated entry, a guard against decompression bombs. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024

export type ZipInput = { name: string; data: string | Uint8Array }

const crcTable = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter()
  const [, buffer] = await Promise.all([
    writer.write(data as unknown as BufferSource).then(() => writer.close()),
    new Response(stream.readable).arrayBuffer()
  ])
  return new Uint8Array(buffer)
}

const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate-raw'))
const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate-raw'))

function dosDateTime(date: Date): { time: number; date: number } {
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
    date: (Math.max(date.getUTCFullYear() - 1980, 0) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/** PD-1131 `create_zip_file`: ZIP_DEFLATED archive of `(filename, content)` pairs. */
export async function createZipFile(files: ZipInput[], now = new Date()): Promise<Uint8Array> {
  const stamp = dosDateTime(now)
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const file of files) {
    const name = encoder.encode(file.name)
    const raw = typeof file.data === 'string' ? encoder.encode(file.data) : file.data
    const packed = raw.length ? await deflate(raw) : raw
    const method = raw.length ? 8 : 0
    const crc = crc32(raw)
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, 0x0800, true) // UTF-8 names
    local.setUint16(8, method, true)
    local.setUint16(10, stamp.time, true)
    local.setUint16(12, stamp.date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, packed.length, true)
    local.setUint32(22, raw.length, true)
    local.setUint16(26, name.length, true)
    parts.push(new Uint8Array(local.buffer), name, packed)
    const entry = new DataView(new ArrayBuffer(46))
    entry.setUint32(0, 0x02014b50, true)
    entry.setUint16(4, 20, true)
    entry.setUint16(6, 20, true)
    entry.setUint16(8, 0x0800, true)
    entry.setUint16(10, method, true)
    entry.setUint16(12, stamp.time, true)
    entry.setUint16(14, stamp.date, true)
    entry.setUint32(16, crc, true)
    entry.setUint32(20, packed.length, true)
    entry.setUint32(24, raw.length, true)
    entry.setUint16(28, name.length, true)
    entry.setUint32(42, offset, true)
    central.push(new Uint8Array(entry.buffer), name)
    offset += 30 + name.length + packed.length
  }
  const directory = concat(central)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, files.length, true)
  end.setUint16(10, files.length, true)
  end.setUint32(12, directory.length, true)
  end.setUint32(16, offset, true)
  return concat([...parts, directory, new Uint8Array(end.buffer)])
}

/** Read every entry of a ZIP archive into a map of name to bytes. Throws on malformed or oversized input. */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0) throw new Error('Not a ZIP archive')
  const count = view.getUint16(end + 10, true)
  let pos = view.getUint32(end + 16, true)
  const entries = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) throw new Error('Corrupt ZIP directory')
    const method = view.getUint16(pos + 10, true)
    const packedSize = view.getUint32(pos + 20, true)
    const size = view.getUint32(pos + 24, true)
    const nameLength = view.getUint16(pos + 28, true)
    const extraLength = view.getUint16(pos + 30, true)
    const commentLength = view.getUint16(pos + 32, true)
    const localOffset = view.getUint32(pos + 42, true)
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength))
    pos += 46 + nameLength + extraLength + commentLength
    if (size > MAX_ENTRY_BYTES) throw new Error(`ZIP entry ${name} is too large`)
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('Corrupt ZIP entry')
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true)
    const packed = bytes.subarray(start, start + packedSize)
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP method ${method}`)
    const data = method === 0 ? packed : await inflate(packed)
    if (data.length > MAX_ENTRY_BYTES) throw new Error(`ZIP entry ${name} is too large`)
    entries.set(name, data)
  }
  return entries
}
