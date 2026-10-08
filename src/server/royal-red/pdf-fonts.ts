// ROYAL RED PDF engine, Phase A: TrueType font embedding.
//
// Parses a TTF (sfnt) file, maps characters to glyph ids through the cmap,
// builds a glyph subset, and returns every structure the PDF writer needs to
// embed the font as a CIDFontType2 with Identity-H encoding:
//   - the FontFile2 program (head, hhea, maxp, hmtx, loca, glyf, rebuilt)
//   - per-CID widths (from hmtx) and per-CID unicode (for the ToUnicode CMap)
//   - real text measurement (advance widths in font units) for exact layout
//
// No dependencies, same spirit as the rest of the kernel. Composite glyphs
// are followed recursively and their component glyph indices are remapped
// into the subset's new numbering.

import fs from 'fs'
import path from 'path'

export interface TTFParseResult {
  unitsPerEm: number
  ascent: number
  descent: number
  capHeight: number
  bbox: [number, number, number, number] // 1000-unit space
  italicAngle: number
  numGlyphs: number
  // char code -> glyph id (from the best unicode cmap subtable)
  charToGid: Map<number, number>
  // glyph id -> advance width (font units)
  advances: number[]
}

interface SfntTable {
  offset: number
  length: number
}

function readTables(d: Buffer): Map<string, SfntTable> {
  const numTables = d.readUInt16BE(4)
  const tables = new Map<string, SfntTable>()
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16
    const tag = d.toString('latin1', rec, rec + 4)
    tables.set(tag, { offset: d.readUInt32BE(rec + 8), length: d.readUInt32BE(rec + 12) })
  }
  return tables
}

// parse the (3,1) format 4 subtable, with a (3,0) symbol fallback and
// format 0 byte-encoding as a last resort
function parseCmap(d: Buffer, t: SfntTable): Map<number, number> {
  const base = t.offset
  const n = d.readUInt16BE(base + 2)
  let best: { off: number; score: number } | null = null
  for (let i = 0; i < n; i++) {
    const rec = base + 4 + i * 8
    const pid = d.readUInt16BE(rec)
    const eid = d.readUInt16BE(rec + 2)
    const off = base + d.readUInt32BE(rec + 4)
    // (3,1) BMP unicode wins, then (0,x), then (3,0) symbol
    const score = pid === 3 && eid === 1 ? 3 : pid === 0 ? 2 : pid === 3 && eid === 0 ? 1 : 0
    if (score > 0 && (!best || score > best.score)) best = { off, score }
  }
  const out = new Map<number, number>()
  if (!best) return out
  const fmt = d.readUInt16BE(best.off)
  if (fmt === 4) {
    const segX2 = d.readUInt16BE(best.off + 6)
    const segs = segX2 / 2
    const endBase = best.off + 14
    const startBase = endBase + segX2 + 2
    const deltaBase = startBase + segX2
    const rangeBase = deltaBase + segX2
    for (let s = 0; s < segs; s++) {
      const end = d.readUInt16BE(endBase + s * 2)
      const start = d.readUInt16BE(startBase + s * 2)
      const delta = d.readInt16BE(deltaBase + s * 2)
      const rangeOff = d.readUInt16BE(rangeBase + s * 2)
      if (start === 0xffff) continue
      for (let c = start; c <= end && c !== 0x10000; c++) {
        let gid: number
        if (rangeOff === 0) {
          gid = (c + delta) & 0xffff
        } else {
          const gi = rangeBase + s * 2 + rangeOff + (c - start) * 2
          gid = d.readUInt16BE(gi)
          if (gid !== 0) gid = (gid + delta) & 0xffff
        }
        if (gid !== 0) out.set(c, gid)
      }
    }
  } else if (fmt === 0) {
    for (let c = 0; c < 256; c++) {
      const gid = d.readUInt8(best.off + 6 + c)
      if (gid !== 0) out.set(c, gid)
    }
  }
  return out
}

export function parseTTF(d: Buffer): TTFParseResult {
  const tables = readTables(d)
  const need = ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'loca', 'glyf']
  for (const tag of need) {
    if (!tables.has(tag)) throw new Error(`font missing table ${tag}`)
  }
  const head = tables.get('head')!
  const unitsPerEm = d.readUInt16BE(head.offset + 18)
  const indexToLoc = d.readInt16BE(head.offset + 50)
  const bboxRaw: [number, number, number, number] = [
    d.readInt16BE(head.offset + 36),
    d.readInt16BE(head.offset + 38),
    d.readInt16BE(head.offset + 40),
    d.readInt16BE(head.offset + 42),
  ]
  const hhea = tables.get('hhea')!
  const ascent = d.readInt16BE(hhea.offset + 4)
  const descent = d.readInt16BE(hhea.offset + 6)
  const numHMetrics = d.readUInt16BE(hhea.offset + 34)
  const maxp = tables.get('maxp')!
  const numGlyphs = d.readUInt16BE(maxp.offset + 4)
  const hmtx = tables.get('hmtx')!
  const advances: number[] = new Array(numGlyphs).fill(0)
  let last = 0
  for (let g = 0; g < numGlyphs; g++) {
    if (g < numHMetrics) last = d.readUInt16BE(hmtx.offset + g * 4)
    advances[g] = last
  }
  const cmap = parseCmap(d, tables.get('cmap')!)
  const italicAngle = 0
  const capHeight = 700 // safe default; exact value only affects descriptor metadata
  const scale = 1000 / unitsPerEm
  const bbox: [number, number, number, number] = [
    Math.round(bboxRaw[0] * scale),
    Math.round(bboxRaw[1] * scale),
    Math.round(bboxRaw[2] * scale),
    Math.round(bboxRaw[3] * scale),
  ]
  void indexToLoc
  return { unitsPerEm, ascent, descent, capHeight, bbox, italicAngle, numGlyphs, charToGid: cmap, advances }
}

// walk a glyph's data; for composites, invoke cb with each component gid
function walkGlyph(d: Buffer, glyf: SfntTable, loca: number[], gid: number, cb: (componentGid: number) => void): void {
  const start = loca[gid]
  const end = loca[gid + 1]
  if (start === end) return // empty glyph
  const g = glyf.offset + start
  const numContours = d.readInt16BE(g)
  if (numContours >= 0) return // simple glyph, no components
  // composite: iterate components
  let p = g + 10
  for (;;) {
    const flags = d.readUInt16BE(p)
    const compGid = d.readUInt16BE(p + 2)
    cb(compGid)
    p += 4
    p += flags & 0x0001 ? 4 : 2 // ARG_1_AND_2_ARE_WORDS
    if (flags & 0x0008) p += 2 // WE_HAVE_A_SCALE
    else if (flags & 0x0040) p += 4 // X_AND_Y_SCALE
    else if (flags & 0x0080) p += 8 // 2x2 TRANSFORM
    if (!(flags & 0x0020)) break // MORE_COMPONENTS
  }
}

export interface SubsetResult {
  // new gid (== cid) -> old gid
  cidToOldGid: number[]
  // old gid -> new cid (-1 when dropped)
  oldToCid: number[]
  // per-cid advance in 1000-unit space
  widths: number[]
  // per-cid unicode codepoint (first mapped char), for the ToUnicode CMap
  cidUnicode: (number | null)[]
  // the rebuilt FontFile2 program
  fontFile: Buffer
  descriptor: {
    ascent: number
    descent: number
    capHeight: number
    bbox: [number, number, number, number]
    unitsPerEm: number
  }
}

const CUTOFF_ALIGN = 4 // long loca output wants 4-byte-ish alignment padding

export function buildSubset(d: Buffer, parsed: TTFParseResult, usedChars: Set<number>): SubsetResult {
  const tables = readTables(d)
  const glyf = tables.get('glyf')!
  const head = tables.get('head')!
  const indexToLoc = d.readInt16BE(head.offset + 50)

  // loca: glyph start offsets
  const locaT = tables.get('loca')!
  const loca: number[] = []
  if (indexToLoc === 0) {
    for (let i = 0; i <= parsed.numGlyphs; i++) loca.push(d.readUInt16BE(locaT.offset + i * 2) * 2)
  } else {
    for (let i = 0; i <= parsed.numGlyphs; i++) loca.push(d.readUInt32BE(locaT.offset + i * 4))
  }

  // 1. collect used glyphs (chars -> gids), then composites transitively
  const usedGids = new Set<number>([0]) // .notdef always
  const charGid: [number, number][] = []
  for (const c of usedChars) {
    const g = parsed.charToGid.get(c)
    if (g !== undefined && !usedGids.has(g)) {
      usedGids.add(g)
      charGid.push([c, g])
    }
  }
  const queue = [...usedGids]
  while (queue.length) {
    const gid = queue.shift()!
    walkGlyph(d, glyf, loca, gid, (comp) => {
      if (!usedGids.has(comp)) {
        usedGids.add(comp)
        queue.push(comp)
      }
    })
  }

  // 2. new numbering: keep ascending old order for determinism
  const kept = [...usedGids].sort((a, b) => a - b)
  const oldToCid = new Array<number>(parsed.numGlyphs).fill(-1)
  kept.forEach((g, i) => (oldToCid[g] = i))

  // 3. copy + remap glyf data, rebuild loca
  const glyfChunks: Buffer[] = []
  const newLoca: number[] = [0]
  let cursor = 0
  for (const oldGid of kept) {
    const start = loca[oldGid]
    const end = loca[oldGid + 1]
    let len = end - start
    if (len > 0) {
      const chunk = Buffer.from(d.subarray(glyf.offset + start, glyf.offset + end))
      // composite? remap component glyph indices in place
      const nc = chunk.readInt16BE(0)
      if (nc < 0) {
        let p = 10
        for (;;) {
          const flags = chunk.readUInt16BE(p)
          const compGid = chunk.readUInt16BE(p + 2)
          chunk.writeUInt16BE(oldToCid[compGid] >= 0 ? oldToCid[compGid] : 0, p + 2)
          p += 4
          p += flags & 0x0001 ? 4 : 2
          if (flags & 0x0008) p += 2
          else if (flags & 0x0040) p += 4
          else if (flags & 0x0080) p += 8
          if (!(flags & 0x0020)) break
        }
      }
      glyfChunks.push(chunk)
      cursor += len
    } else {
      len = 0
    }
    // pad glyph records so offsets stay even (some rasterizers require it)
    const pad = (CUTOFF_ALIGN - (cursor % CUTOFF_ALIGN)) % CUTOFF_ALIGN
    if (pad && len > 0) {
      glyfChunks.push(Buffer.alloc(pad))
      cursor += pad
    }
    newLoca.push(cursor)
  }
  const glyfBuf = Buffer.concat(glyfChunks)
  const locaBuf = Buffer.alloc(newLoca.length * 4)
  newLoca.forEach((o, i) => locaBuf.writeUInt32BE(o, i * 4))

  // 4. rebuild the tables
  const newHead = Buffer.from(d.subarray(head.offset, head.offset + 54))
  newHead.writeInt16BE(1, 50) // long loca
  newHead.writeUInt32BE(0, 8) // checkSumAdjustment recomputed below

  const newHhea = Buffer.from(d.subarray(tables.get('hhea')!.offset, tables.get('hhea')!.offset + 36))
  newHhea.writeUInt16BE(kept.length, 34) // numberOfHMetrics = all

  const newMaxp = Buffer.from(d.subarray(tables.get('maxp')!.offset, tables.get('maxp')!.offset + 32))
  newMaxp.writeUInt16BE(kept.length, 4)

  const newHmtx = Buffer.alloc(kept.length * 4)
  kept.forEach((g, i) => {
    newHmtx.writeUInt16BE(parsed.advances[g], i * 4)
    newHmtx.writeUInt16BE(0, i * 4 + 2) // lsb, unused by the PDF writer
  })

  // 5. assemble the sfnt with a 4-byte-aligned table directory
  const tableDefs: { tag: string; data: Buffer }[] = [
    { tag: 'glyf', data: glyfBuf },
    { tag: 'head', data: newHead },
    { tag: 'hhea', data: newHhea },
    { tag: 'hmtx', data: newHmtx },
    { tag: 'loca', data: locaBuf },
    { tag: 'maxp', data: newMaxp },
  ]
  tableDefs.sort((a, b) => (a.tag < b.tag ? -1 : 1))
  const searchRange = 16 * Math.floor(Math.log2(tableDefs.length))
  const sfntHead = Buffer.alloc(12)
  sfntHead.writeUInt32BE(0x00010000, 0)
  sfntHead.writeUInt16BE(tableDefs.length, 4)
  sfntHead.writeUInt16BE(searchRange, 6)
  sfntHead.writeUInt16BE(Math.log2(tableDefs.length) | 0, 8)
  sfntHead.writeUInt16BE(tableDefs.length * 16 - searchRange, 10)
  const dirChunks: Buffer[] = [sfntHead]
  const dataChunks: Buffer[] = []
  let off = 12 + tableDefs.length * 16
  for (const td of tableDefs) {
    const rec = Buffer.alloc(16)
    rec.write(td.tag, 0, 'latin1')
    rec.writeUInt32BE(checkSum(td.data), 4)
    rec.writeUInt32BE(off, 8)
    rec.writeUInt32BE(td.data.length, 12)
    dirChunks.push(rec)
    const pad = (4 - (td.data.length % 4)) % 4
    dataChunks.push(td.data, Buffer.alloc(pad))
    off += td.data.length + pad
  }
  const fontFile = Buffer.concat([...dirChunks, ...dataChunks])
  // checkSumAdjustment: 0xB1B0AFBA - checksum(whole font with adjustment = 0)
  fontFile.writeUInt32BE(0, 8)
  const total = checkSum(fontFile)
  fontFile.writeUInt32BE((0xb1b0afba - total) >>> 0, 8)

  // 6. widths + unicode per cid
  const scale = 1000 / parsed.unitsPerEm
  const widths = kept.map((g) => Math.round(parsed.advances[g] * scale))
  const gidToChar = new Map<number, number>()
  for (const [c, g] of charGid) if (!gidToChar.has(g)) gidToChar.set(g, c)
  const cidUnicode = kept.map((g) => gidToChar.get(g) ?? null)

  return {
    cidToOldGid: kept,
    oldToCid,
    widths,
    cidUnicode,
    fontFile,
    descriptor: {
      ascent: Math.round(parsed.ascent * scale),
      descent: Math.round(parsed.descent * scale),
      capHeight: Math.round(parsed.capHeight * scale),
      bbox: parsed.bbox,
      unitsPerEm: parsed.unitsPerEm,
    },
  }
}

function checkSum(buf: Buffer): number {
  let sum = 0
  const n = buf.length
  const full = n - (n % 4)
  for (let i = 0; i < full; i += 4) sum = (sum + buf.readUInt32BE(i)) >>> 0
  if (n % 4) {
    let last = 0
    for (let i = full; i < n; i++) last |= buf[i] << (24 - 8 * (i - full))
    sum = (sum + last) >>> 0
  }
  return sum
}

// ---- loaded font registry used by the PDF writer ----

export interface EmbeddedFont {
  name: string // BaseFont /PostScript name
  parsed: TTFParseResult
  subset: SubsetResult | null // null until the writer freezes the used set
  measure: (text: string, size: number) => number
}

const fontCache = new Map<string, EmbeddedFont>()

export function loadFont(file: string): EmbeddedFont {
  const cached = fontCache.get(file)
  if (cached) return cached
  const buf = fs.readFileSync(file)
  const parsed = parseTTF(buf)
  const name = path.basename(file, '.ttf')
  const font: EmbeddedFont = {
    name,
    parsed,
    subset: null,
    measure(text: string, size: number) {
      let units = 0
      for (const ch of text) {
        const g = parsed.charToGid.get(ch.codePointAt(0) ?? 0)
        units += g !== undefined ? parsed.advances[g] : parsed.unitsPerEm * 0.5
      }
      return (units / parsed.unitsPerEm) * size
    },
  }
  fontCache.set(file, font)
  return font
}
