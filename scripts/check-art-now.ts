import { db } from '@/lib/db'
async function main() {
  const a = await db.royalRedArtifact.findUnique({ where: { id: 'awon_1255b7dd-3fe' }, select: { files: true } })
  const files = JSON.parse(a!.files) as { path: string }[]
  console.log('files now:', files.map((f) => f.path).join(', '))
  await db.$disconnect()
}
main()
