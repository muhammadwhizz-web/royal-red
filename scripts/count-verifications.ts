// count verification rows directly in the DB
import { db } from '@/lib/db'
async function main() {
  const rows = await db.royalRedVerification.findMany({
    where: { sessionId: 'cmutpxqwm000oplwi86k0i8e8' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, status: true, createdAt: true, artifactId: true },
  })
  console.log('DB rows:', rows.length)
  for (const r of rows) {
    console.log(r.createdAt.toISOString().slice(11, 19), r.kind, r.status, r.artifactId)
  }
  await db.$disconnect()
}
main()
