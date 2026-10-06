import { db } from '@/lib/db'
async function main() {
  const arts = await db.awonArtifact.findMany({ orderBy: { createdAt: 'desc' }, take: 14, select: { id: true, sessionId: true, name: true, files: true, score: true } })
  for (const a of arts) {
    const files = JSON.parse(a.files) as { path: string }[]
    const paths = files.map((f) => f.path).join(', ')
    if (/cms/i.test(paths)) console.log(`${a.id} session=${a.sessionId} name=${a.name} score=${a.score} files=${paths.slice(0, 120)}`)
  }
  await db.$disconnect()
}
main()
