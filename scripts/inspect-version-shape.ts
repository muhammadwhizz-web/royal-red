import { db } from '@/lib/db'
async function main() {
  const v = await db.awonArtifactVersion.findFirst({ orderBy: { createdAt: 'desc' } })
  const f = JSON.parse(v!.files as string)
  console.log('top-level keys:', Object.keys(f))
  const asJson = JSON.stringify(f, null, 1)
  console.log(asJson.slice(0, 1200))
  await db.$disconnect()
}
main()
