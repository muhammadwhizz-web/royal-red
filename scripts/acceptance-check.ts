// acceptance test follow-up: what did the long turn produce?
import { db } from '@/lib/db'
async function main() {
  const s = await db.awonSession.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { id: true, title: true, createdAt: true },
  })
  if (!s) return console.log('no session')
  console.log('session:', s.id, '|', s.title)
  const arts = await db.awonArtifact.findMany({
    where: { sessionId: s.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true, score: true, files: true },
  })
  for (const a of arts) {
    const files = JSON.parse(a.files) as { path: string }[]
    console.log('artifact:', a.id, '|', a.name, '| score', a.score, '|', files.map((f) => f.path).join(','))
  }
  const cons = await db.awonConstraint.findMany({ where: { sessionId: s.id } })
  console.log('constraints:', cons.map((c) => `${c.cid}(${c.category})`).join(' '))
  const vers = await db.awonVerification.findMany({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' } })
  console.log('verification rows:', vers.map((v) => `${v.kind}:${v.status}`).join(' ') || '(none)')
  const msgs = await db.awonMessage.count({ where: { sessionId: s.id } })
  console.log('messages:', msgs)
  await db.$disconnect()
}
main()
