// ROYAL RED Docker first-boot schema applier (Phase A).
// Applies docker/schema.sql to the SQLite file without the Prisma CLI
// (the runtime image carries no prisma). bun:sqlite is built into bun.
// Usage: bun docker/apply-schema.ts /data/royal-red.db

import { Database } from 'bun:sqlite'
import { readFileSync } from 'fs'

const target = process.argv[2]
if (!target) {
  console.error('apply-schema: missing target path')
  process.exit(1)
}

const sqlPath = new URL('./schema.sql', import.meta.url).pathname
const sql = readFileSync(sqlPath, 'utf8')

const db = new Database(target)
try {
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(sql)
  console.log('apply-schema: schema applied')
} catch (err) {
  console.error('apply-schema failed:', err)
  process.exit(1)
} finally {
  db.close()
}
