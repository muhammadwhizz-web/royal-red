import { db } from '@/lib/db'
async function main() {
  const a = await db.awonArtifact.findUnique({ where: { id: 'awon_1255b7dd-3fe' }, select: { files: true } })
  const files = JSON.parse(a!.files) as { path: string; content: string }[]
  const cms = files.find((f) => /cms/.test(f.path))
  console.log('path:', cms?.path, 'len:', cms?.content.length)
  // show buttons and forms
  const buttons = [...cms!.content.matchAll(/<button[^>]*>([\s\S]{0,60}?)<\/button>/gi)].map((m) => m[1].replace(/\s+/g, ' ').trim())
  console.log('buttons:', JSON.stringify(buttons.slice(0, 12)))
  console.log('has form:', /<form/.test(cms!.content), 'has input:', /<input/.test(cms!.content))
  console.log('has password:', /password/.test(cms!.content))
  console.log('add/new/create words:', /add|new|create/i.test(cms!.content))
  await db.$disconnect()
}
main()
