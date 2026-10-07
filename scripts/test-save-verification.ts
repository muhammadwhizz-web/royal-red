import { db } from '@/lib/db'
async function main() {
  try {
    const r = await db.royalRedVerification.create({
      data: { sessionId: 'cmutpxqwm000oplwi86k0i8e8', artifactId: 'awon_1255b7dd-3fe', kind: 'ledger', status: 'pass', score: null, data: JSON.stringify({ test: true }) },
    })
    console.log('created ok', r.id)
    await db.royalRedVerification.delete({ where: { id: r.id } })
    console.log('cleanup ok')
  } catch (e) {
    console.log('SAVE FAILED:', (e as Error).message.slice(0, 300))
  }
  await db.$disconnect()
}
main()
