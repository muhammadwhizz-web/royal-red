// check the bookbinding session's artifacts and cms file presence
import { db } from '@/lib/db'
async function main() {
  const sid = 'cmutpxqwm000oplwi86k0i8e8'
  const arts = await db.awonArtifact.findMany({
    where: { sessionId: sid },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, files: true, createdAt: true },
  })
  for (const a of arts) {
    const files = JSON.parse(a.files) as { path: string }[]
    console.log(a.id, '|', a.name, '|', files.map((f) => f.path).join(','), '|', a.createdAt.toISOString().slice(0, 19))
  }
  await db.$disconnect()
}
main()
