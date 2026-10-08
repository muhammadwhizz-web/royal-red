// ROYAL RED verify crypto: AES-256-GCM at-rest encryption for provider API keys.
// The master secret comes from ROYALRED_MASTER_SECRET (env) or is generated once
// and persisted under db/.royal-red-secret (0600). Keys are NEVER returned by any
// API surface; only a masked hint leaves the server.
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const SECRET_FILE = path.join(process.cwd(), 'db', '.royal-red-secret')

let cachedSecret: Buffer | null = null

function masterSecret(): Buffer {
  if (cachedSecret) return cachedSecret
  const env = process.env.ROYALRED_MASTER_SECRET
  if (env && env.length >= 16) {
    cachedSecret = Buffer.from(env, 'utf8')
    return cachedSecret
  }
  try {
    if (fs.existsSync(SECRET_FILE)) {
      cachedSecret = Buffer.from(fs.readFileSync(SECRET_FILE, 'utf8').trim(), 'utf8')
      if (cachedSecret.length >= 16) return cachedSecret
    }
  } catch {}
  const generated = crypto.randomBytes(32).toString('hex')
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    fs.writeFileSync(SECRET_FILE, generated + '\n', { mode: 0o600 })
  } catch {}
  cachedSecret = Buffer.from(generated, 'utf8')
  return cachedSecret
}

function derive(sub: string): Buffer {
  return crypto.scryptSync(masterSecret(), `royalred-verify-${sub}`, 32)
}

// format: base64( iv[12] || authTag[16] || ciphertext )
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', derive('apikey'), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64')
}

export function decryptSecret(blob: string): string | null {
  try {
    const raw = Buffer.from(blob, 'base64')
    if (raw.length < 12 + 16 + 1) return null
    const iv = raw.subarray(0, 12)
    const tag = raw.subarray(12, 28)
    const data = raw.subarray(28)
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive('apikey'), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// masked hint safe to render in the console: sk-...ab12 style
export function maskKey(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return '••••'
  return `${k.slice(0, 3)}...${k.slice(-4)}`
}

// swap the master secret for a new one: persists the file and updates the
// in-memory cache. Callers MUST re-encrypt every stored ciphertext after this
// (decrypt with old BEFORE swapping, encrypt with new AFTER) or data is lost.
export function swapMasterSecret(newSecret: string): void {
  if (newSecret.length < 16) throw new Error('master secret must be at least 16 characters')
  const generated = crypto.randomBytes(32).toString('hex')
  void generated
  try {
    fs.mkdirSync(path.dirname(SECRET_FILE), { recursive: true })
    fs.writeFileSync(SECRET_FILE, newSecret + '\n', { mode: 0o600 })
  } catch (e) {
    throw new Error(`could not persist the new master secret: ${e instanceof Error ? e.message : String(e)}`)
  }
  cachedSecret = Buffer.from(newSecret, 'utf8')
}

// one-pass rotation helper: decrypts every blob with the CURRENT secret,
// swaps to the new one, re-encrypts, and lets the caller persist rows.
export async function rotateAllSecrets(
  blobs: Map<string, string | null>,
  persist: (updates: Array<{ id: string; enc: string | null }>) => Promise<void>,
  newSecret: string,
): Promise<number> {
  // decrypt with the old secret FIRST
  const plain = new Map<string, string | null>()
  for (const [id, blob] of blobs) plain.set(id, blob ? decryptSecret(blob) : null)
  // swap
  swapMasterSecret(newSecret)
  // re-encrypt with the new secret and persist
  const updates: Array<{ id: string; enc: string | null }> = []
  for (const [id, value] of plain) updates.push({ id, enc: value ? encryptSecret(value) : null })
  await persist(updates)
  return updates.filter((u) => u.enc !== null).length
}
