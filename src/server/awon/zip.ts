// Dependency-free ZIP builder (store method, CRC32). Shared by the artifact
// exporter and the workspace exporter.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface ZipEntry {
  name: Buffer
  data: Buffer
  offset: number
  crc: number
  size: number
}

export function buildZip(files: { path: string; content: string; data?: Buffer }[]): Buffer {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  const entries: ZipEntry[] = []
  let offset = 0

  const enc = new TextEncoder()
  for (const f of files) {
    const nameBuf = Buffer.from(enc.encode(f.path))
    const dataBuf = f.data ?? Buffer.from(enc.encode(f.content))
    const crc = crc32(dataBuf)
    const size = dataBuf.length

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // flags: utf8 names
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10) // mod time
    local.writeUInt16LE(0x5683, 12) // mod date
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(size, 18) // compressed
    local.writeUInt32LE(size, 22) // uncompressed
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)

    entries.push({ name: nameBuf, data: dataBuf, offset, crc, size })
    chunks.push(local, nameBuf, dataBuf)
    offset += local.length + nameBuf.length + dataBuf.length
  }

  const centralStart = offset // start of central directory = end of local entries

  for (const e of entries) {
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50, 0) // central dir signature
    c.writeUInt16LE(20, 4) // version made by
    c.writeUInt16LE(20, 6) // version needed
    c.writeUInt16LE(0x0800, 8) // flags utf8
    c.writeUInt16LE(0, 10) // method store
    c.writeUInt16LE(0, 12)
    c.writeUInt16LE(0x5683, 14)
    c.writeUInt32LE(e.crc, 16)
    c.writeUInt32LE(e.size, 20)
    c.writeUInt32LE(e.size, 24)
    c.writeUInt16LE(e.name.length, 28)
    c.writeUInt16LE(0, 30) // extra
    c.writeUInt16LE(0, 32) // comment
    c.writeUInt16LE(0, 34) // disk
    c.writeUInt16LE(0, 36) // internal attrs
    c.writeUInt32LE(0, 38) // external attrs
    c.writeUInt32LE(e.offset, 42)
    central.push(c, e.name)
    offset += c.length + e.name.length
  }

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(offset - centralStart, 12) // size of central directory
  eocd.writeUInt32LE(centralStart, 16) // offset of central directory
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...chunks, ...central, eocd])
}
