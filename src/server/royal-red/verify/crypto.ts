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
