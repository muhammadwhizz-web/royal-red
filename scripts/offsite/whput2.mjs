// whput2.mjs - clean-room wormhole.app uploader (rebuild #1)
// Protocol reverse-engineered from the wormhole.app web bundle (lazy-5626.js, _app chunk)
// + wormhole-crypto (SocketDev) for the E2E crypto. Round-trip verified by whverify2.mjs.
//
// Flow (sender):
//   1. Keychain() -> random 16B key + 16B salt
//   2. POST /api/room {readerToken, salt} -> {id, writerToken, maxCloudSize, ...}
//   3. stream-encrypt file (RFC 8188 records, rs=16384)
//   4. create-torrent over the encrypted bytes (single-file, private, nonce,
//      announce wss://wormhole.app/websocket, pieceLength per web-app formula)
//   5. encryptMeta(torrentFile); PATCH /api/room/:id {infoHash, encryptedTorrentFile, multiFile, sizeMb}
//   6. B2 cloud upload: one B2 file per torrent piece at <roomId>/<pieceIndex>
//      (POST uploadUrl, X-Bz-Content-Sha1 = piece sha1, X-Bz-File-Name = path)
//   7. POST /api/room/:id/b2/finish-upload {success:true}
//   8. share https://wormhole.app/<id>#<keyB64>
import fs from 'node:fs'
import path from 'node:path'
import { Readable, Writable } from 'node:stream'
import { createHash } from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Keychain, plaintextSize, encryptedSize } from 'wormhole-crypto'
import createTorrent from 'create-torrent'
import parseTorrent from 'parse-torrent'
import pieceLengthOf from 'piece-length'

const BASE = 'https://wormhole.app'
const ANNOUNCE = 'wss://wormhole.app/websocket'
const BUCKET = 'socket-dev-prod'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'
const COMMON = {
  'content-type': 'application/json',
  accept: 'application/json',
  origin: BASE,
  referer: `${BASE}/`,
  'user-agent': UA,
}

const log = (...a) => console.error('[whput]', ...a)

async function apiRetry(fn, tries = 4, base = 800) {
  let err
  for (let i = 0; i < tries; i++) {
    try {
      return await fn()
    } catch (e) {
      err = e
      const status = e?.status
      // do not retry definite auth/validation failures
      if (status === 400 || status === 401 || status === 403) throw e
      log(`attempt ${i + 1}/${tries} failed: ${e.message}; backing off`)
      await new Promise((r) => setTimeout(r, base * 2 ** i))
    }
  }
  throw err
}

async function jres(res) {
  const text = await res.text()
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
    e.status = res.status
    throw e
  }
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const jpost = (url, body, auth) =>
  fetch(url, {
    method: 'POST',
    headers: { ...COMMON, ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }).then(jres)
const jget = (url, auth) =>
  fetch(url, { headers: { ...COMMON, ...(auth ? { authorization: auth } : {}) } }).then(jres)
const jpatch = (url, body, auth) =>
  fetch(url, {
    method: 'PATCH',
    headers: { ...COMMON, ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }).then(jres)

const sha1hex = (buf) => createHash('sha1').update(buf).digest('hex')
async function sha256File(p) {
  const h = createHash('sha256')
  await pipeline(fs.createReadStream(p), async function* (src) {
    for await (const chunk of src) {
      h.update(chunk)
    }
  })
  return h.digest('hex')
}

export async function whput(filePath, { onProgress } = {}) {
  const abs = path.resolve(filePath)
  const stat = fs.statSync(abs)
  const name = path.basename(abs)
  const totalPlain = stat.size
  const totalEnc = encryptedSize(totalPlain)

  // 1) keychain
  const keychain = new Keychain()

  // 2) create room
  log('creating room...')
  const room = await apiRetry(async () =>
    jpost(`${BASE}/api/room`, {
      readerToken: await keychain.authTokenB64(),
      salt: keychain.saltB64,
    }),
  )
  if (!room?.id || !room?.writerToken) throw new Error(`room create failed: ${JSON.stringify(room).slice(0, 200)}`)
  const roomId = room.id
  log(`room id: ${roomId}  maxCloudSize: ${room.maxCloudSize}`)
  keychain.setAuthToken(room.writerToken)
  const auth = () => keychain.authHeader()

  if (totalEnc > room.maxCloudSize) {
    throw new Error(`file too big for wormhole cloud storage: ${totalEnc} > ${room.maxCloudSize}`)
  }

  // 3) stream encrypt to temp file
  const encPath = abs + '.whenc'
  log(`encrypting ${name} (${totalPlain} -> ${totalEnc} bytes)...`)
  {
    const src = Readable.toWeb(fs.createReadStream(abs))
    const enc = await keychain.encryptStream(src)
    await pipeline(Readable.fromWeb(enc), fs.createWriteStream(encPath))
  }
  const encStat = fs.statSync(encPath)
  if (encStat.size !== totalEnc) {
    fs.rmSync(encPath, { force: true })
    throw new Error(`encrypted size mismatch: got ${encStat.size}, expected ${totalEnc}`)
  }

  // 4) torrent metadata over the encrypted bytes
  //    web-app formula: s = min(5e6, totalEnc) rounded up to 16384; pieceLength = max(piece-length(totalEnc), s)
  let s = Math.min(5e6, totalEnc)
  s = 16384 * Math.ceil(s / 16384)
  const pieceLength = Math.max(pieceLengthOf(totalEnc), s)
  log(`pieceLength: ${pieceLength}`)
  const torrentBuf = await new Promise((resolve, reject) => {
    createTorrent(
      [encPath],
      {
        name,
        pieceLength,
        private: true,
        announceList: [[ANNOUNCE]],
        info: { nonce: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString('hex') },
      },
      (err, torrent) => (err ? reject(err) : resolve(torrent)),
    )
  })
  const parsed = await parseTorrent(torrentBuf)
  log(`infoHash: ${parsed.infoHash}  pieces: ${parsed.pieces?.length ?? parsed.length}`)

  // 5) register torrent
  const encryptedTorrentFile = Buffer.from(await keychain.encryptMeta(torrentBuf)).toString('base64')
  await apiRetry(async () =>
    jpatch(
      `${BASE}/api/room/${roomId}`,
      {
        infoHash: parsed.infoHash,
        encryptedTorrentFile,
        multiFile: false,
        sizeMb: Math.round(totalPlain / 1e6),
      },
      await auth(),
    ),
  )
  log('torrent registered')

  // 6) upload pieces to B2 (one file per piece), concurrency 5
  const numPieces = Math.ceil(totalEnc / pieceLength)
  const pieces = fs.openSync(encPath, 'r')
  const usedTokens = []
  let uploaded = 0
  const fail = (e) => {
    throw e
  }
  async function getToken() {
    if (usedTokens.length) return usedTokens.pop()
    const tokens = await apiRetry(async () => jpost(`${BASE}/api/room/${roomId}/b2/auth-upload`, { numTokens: 5 }, await auth()))
    if (!Array.isArray(tokens) || !tokens.length) throw new Error(`auth-upload returned ${JSON.stringify(tokens).slice(0, 200)}`)
    usedTokens.push(...tokens.slice(1))
    return tokens[0]
  }
  async function uploadPiece(i) {
    const len = Math.min(pieceLength, totalEnc - i * pieceLength)
    const buf = Buffer.alloc(len)
    fs.readSync(pieces, buf, 0, len, i * pieceLength)
    const sha1 = sha1hex(buf)
    const expected = parsed.pieces[i]
    if (expected && Buffer.compare(createHash('sha1').update(buf).digest(), Buffer.from(expected, 'hex')) !== 0) {
      fail(new Error(`piece ${i} sha1 mismatch vs torrent metadata`))
    }
    const filePath = [roomId, String(i)].map(encodeURIComponent).join('/')
    let lastErr = 'unknown'
    for (let attempt = 0; attempt < 6; attempt++) {
      let tok = await getToken()
      try {
        const res = await fetch(tok.uploadUrl, {
          method: 'POST',
          credentials: 'include',
          body: buf,
          headers: {
            Authorization: tok.authorizationToken,
            'X-Bz-Content-Sha1': sha1,
            'X-Bz-File-Name': filePath,
            'Content-Type': 'application/octet-stream',
          },
        })
        if (res.ok) {
          lastErr = null
          break
        }
        lastErr = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`
        if (res.status === 401) {
          // token exhausted: drop the pooled tokens so getToken refetches
          usedTokens.length = 0
          continue
        }
        if (res.status !== 408 && res.status !== 429 && res.status < 500) {
          throw new Error(`B2 piece ${i} upload rejected: ${lastErr}`)
        }
      } catch (e) {
        if (e instanceof Error && e.message.startsWith('B2 piece')) throw e
        lastErr = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
        // network-level failure (refused/reset/timeout): the pod may be bad,
        // drop pooled tokens so the next attempt gets a fresh uploadUrl
        usedTokens.length = 0
      }
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)))
    }
    if (lastErr !== null) {
      fs.rmSync(encPath, { force: true })
      throw new Error(`B2 piece ${i} upload failed after retries: ${lastErr}`)
    }
    uploaded++
    onProgress?.(uploaded, numPieces)
  }
  const CONC = 5
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CONC, numPieces) }, async () => {
      for (;;) {
        const i = next++
        if (i >= numPieces) return
        await uploadPiece(i)
      }
    }),
  )
  fs.closeSync(pieces)
  log(`uploaded ${numPieces} pieces to B2`)

  // 7) finish
  await apiRetry(async () => jpost(`${BASE}/api/room/${roomId}/b2/finish-upload`, { success: true }, await auth()))
  fs.rmSync(encPath, { force: true })

  return {
    url: `${BASE}/${roomId}#${keychain.keyB64}`,
    roomId,
    name,
    size: totalPlain,
    pieces: numPieces,
    infoHash: parsed.infoHash,
    expiresAtTimestampMs: room.expiresAtTimestampMs,
    maxDownloads: room.maxDownloads,
    remainingDownloads: room.remainingDownloads,
    sha256OfSource: await sha256File(abs),
  }
}

// CLI
if (import.meta.main) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: bun whput2.mjs <file>')
    process.exit(1)
  }
  const t0 = Date.now()
  const result = await whput(file, {
    onProgress: (done, total) => {
      if (done % 10 === 0 || done === total) log(`pieces ${done}/${total}`)
    },
  })
  console.log(JSON.stringify({ ...result, elapsedMs: Date.now() - t0 }, null, 2))
}
