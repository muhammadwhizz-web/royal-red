import { db } from '@/lib/db'
async function main() {
  const sid = 'cmuuss99l000emoucbbo17dll'
  const arts = await db.awonArtifact.findMany({ where: { sessionId: sid }, select: { id: true, name: true, score: true } })
  console.log(sid, '->', JSON.stringify(arts))
  const msgs = await db.awonMessage.count({ where: { sessionId: sid } })
  console.log('messages:', msgs)
  await db.$disconnect()
}
main()
