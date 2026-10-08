// whverify2.mjs - clean-room wormhole.app receiver (round-trip verifier for whput2.mjs)
// Fetches the room via the same API the web client uses, downloads every piece
// from Backblaze B2, verifies each piece sha1 against the torrent metadata,
// reassembles and decrypts, then compares sha256 with the source file.
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Keychain } from 'wormhole-crypto'
import parseTorrent from 'parse-torrent'

const BASE = 'https://wormhole.app'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const COMMON = {
  'content-type': 'application/json',
  accept: 'application/json',
  origin: BASE,
  referer: `${BASE}/`,
  'user-agent': UA,
}
const log = (...a) => console.error('[whverify]', ...a)

function parseLink(link) {
  const m = link.match(/https:\/\/wormhole\.app\/([^#]+)#(.+)/)
  if (!m) throw new Error('not a wormhole.app link: ' + link)
  return { roomId: m[1], keyB64: m[2] }
}

async function jget(url, auth) {
  const res = await fetch(url, { headers: { ...COMMON, ...(auth ? { authorization: auth } : {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}
async function jpost(url, body, auth) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...COMMON, ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body ?? {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

export async function whverify(link, outPath, expectedSha256) {
  const { roomId, keyB64 } = parseLink(link)
  log(`room ${roomId}`)

  const { salt } = await jget(`${BASE}/api/room/${roomId}/salt`)
  const keychain = new Keychain(keyB64, salt)
  const auth = () => keychain.authHeader()

  const room = await jget(`${BASE}/api/room/${roomId}`, await auth())
  log(`cloudState: ${room.cloudState}  multiFile: ${room.multiFile}`)
  if (room.cloudState !== 'uploaded') throw new Error(`cloud not uploaded, state: ${room.cloudState}`)

  const encTorrent = Buffer.from(room.encryptedTorrentFile, 'base64')
  const torrentBuf = Buffer.from(await keychain.decryptMeta(encTorrent))
  const t = await parseTorrent(torrentBuf)
  const numPieces = t.pieces.length
  log(`infoHash: ${t.infoHash}  pieces: ${numPieces}  pieceLength: ${t.pieceLength}  length: ${t.length}`)

  const dl = await jpost(`${BASE}/api/room/${roomId}/b2/auth-download`, {}, await auth())
  if (!dl?.downloadUrl || !dl?.authorizationToken) throw new Error(`auth-download failed: ${JSON.stringify(dl).slice(0, 200)}`)

  const encPath = outPath + '.enc'
  const out = fs.openSync(encPath, 'w')
  let written = 0
  for (let i = 0; i < numPieces; i++) {
    const len = Math.min(t.pieceLength, t.length - i * t.pieceLength)
    const url = `${dl.downloadUrl}/file/socket-dev-prod/${encodeURIComponent(roomId)}/${i}?Authorization=${encodeURIComponent(dl.authorizationToken)}`
    const res = await fetch(url)
    if (!res.ok) {
      fs.closeSync(out)
      fs.rmSync(encPath, { force: true })
      throw new Error(`piece ${i} download failed: HTTP ${res.status}`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length !== len) {
      fs.closeSync(out)
      fs.rmSync(encPath, { force: true })
      throw new Error(`piece ${i} size mismatch: got ${buf.length}, want ${len}`)
    }
    const sha1 = createHash('sha1').update(buf).digest()
    if (sha1.toString('hex') !== t.pieces[i]) {
      fs.closeSync(out)
      fs.rmSync(encPath, { force: true })
      throw new Error(`piece ${i} sha1 mismatch: got ${sha1.toString('hex')}, want ${t.pieces[i]}`)
    }
    fs.writeSync(out, buf, 0, len, i * t.pieceLength)
    written += len
    if ((i + 1) % 20 === 0 || i === numPieces - 1) log(`pieces ${i + 1}/${numPieces}`)
  }
  fs.closeSync(out)
  if (written !== t.length) throw new Error(`total size mismatch: ${written} != ${t.length}`)

  // decrypt: encrypted blob -> plaintext, streaming
  let outSize = null
  const src = Readable.toWeb(fs.createReadStream(encPath))
  const dec = await keychain.decryptStream(src)
  let outSha = ''
  if (outPath === '-') {
    // hash-only mode: no plaintext file hits the disk
    const h = createHash('sha256')
    await pipeline(
      Readable.fromWeb(dec),
      async function* (dsrc) {
        for await (const chunk of dsrc) {
          h.update(chunk)
          yield chunk
        }
      },
      async function* (sink) {
        for await (const _ of sink) {
          // drain
        }
      },
    )
    outSha = h.digest('hex')
    outSize = null
  } else {
    await pipeline(Readable.fromWeb(dec), fs.createWriteStream(outPath))
    const outSize2 = fs.statSync(outPath).size
    outSha = createHash('sha256').update(fs.readFileSync(outPath)).digest('hex')
    outSize = outSize2
  }
  fs.rmSync(encPath, { force: true })

  const ok = expectedSha256 ? outSha === expectedSha256 : true
  log(`decrypted ${outSize ?? 'stream'} bytes  sha256: ${outSha}`)
  return { ok, outSize, outSha, infoHash: t.infoHash, pieces: numPieces }
}

// CLI: bun whverify2.mjs <link> <outfile> [expectedSha256]
if (import.meta.main) {
  const [link, out, sha] = process.argv.slice(2)
  if (!link || !out) {
    console.error('usage: bun whverify2.mjs <wormhole-link> <outfile> [expectedSha256]')
    process.exit(1)
  }
  const result = await whverify(link, out, sha)
  console.log(JSON.stringify(result, null, 2))
  if (!result.ok) process.exit(2)
}
