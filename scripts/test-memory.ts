// ROYAL RED ROUND 6 - MEMORY STORE TEST (Section 2 acceptance, kernel level).
//
// Contract under test:
//   1. parseRememberCommand: "remember that X" -> {key, value}; non-commands -> null
//   2. writeMemory: upsert dedupe on (scope, scopeRef, key); re-save updates, never duplicates
//   3. relevantMemories: global + session scopes load; expired memories never load;
//      the char budget caps the injection; relevance scoring is deterministic
//   4. memoryBlockForPrompt: null on empty, plain-English block otherwise
//   5. auditMemory: every write lands an audit row with agentRole "Memory Keeper"
//   6. privacy: nothing in the module calls any network path (static check)
//
// Run: bun --env-file=.env scripts/test-memory.ts
import { db } from '../src/lib/db'
import {
  parseRememberCommand,
  writeMemory,
  relevantMemories,
  memoryBlockForPrompt,
  memoryInjection,
  MEMORY_CHAR_BUDGET,
} from '../src/server/royal-red/memory'

let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log(`  ok ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${extra ? ` - ${extra}` : ''}`)
  }
}

async function main() {
  console.log('ROYAL RED memory store test')
  const tag = `mt-${Date.now()}`

  // 1. parser
  const r1 = parseRememberCommand('remember that I prefer royal red in dark mode')
  check('parser: basic remember-that', !!r1 && r1.value === 'I prefer royal red in dark mode', JSON.stringify(r1))
  const r2 = parseRememberCommand('Remember I like tea')
  check('parser: without that, capitalized', !!r2 && r2.value === 'I like tea', JSON.stringify(r2))
  const r3 = parseRememberCommand('please remember that deployments go to the staging box first')
  check('parser: please-variant', !!r3, JSON.stringify(r3))
  check('parser: key is short and lowercase', !!r3 && r3.key === r3.key.toLowerCase() && r3.key.length <= 80, r3?.key)
  check('parser: normal sentence is not a memory', parseRememberCommand('build me a landing page for a coffee shop') === null)
  check('parser: remember alone is not a memory', parseRememberCommand('remember') === null)

  // 2. upsert dedupe
  const scopeRef = tag // session-scoped rows use a synthetic session ref
  const a = await writeMemory({ scope: 'session', scopeRef, key: 'theme preference', value: 'royal red in dark mode' })
  const b = await writeMemory({ scope: 'session', scopeRef, key: 'theme preference', value: 'royal red in dark mode, gold accents' })
  check('upsert: same scope+key updates, no duplicate', a.id === b.id)
  const count = await db.royalRedMemory.count({ where: { key: 'theme preference', scopeRef } })
  check('upsert: exactly one row exists', count === 1, `got ${count}`)

  // 3. read path
  const userSession = `sess-${Date.now()}`
  await writeMemory({ scope: 'global', key: `${tag} global fact`, value: 'the royal seal is gold and only gold' })
  await writeMemory({ scope: 'session', scopeRef: userSession, key: `${tag} session fact`, value: 'this session is about coffee brands' })
  await writeMemory({
    scope: 'session',
    scopeRef: userSession,
    key: `${tag} expired fact`,
    value: 'this memory has expired',
    expiresAt: new Date(Date.now() - 1000),
  })

  const mems = await relevantMemories('what theme do I prefer for the coffee brands page', userSession)
  check('read: global scope loads', mems.some((m) => m.key === `${tag} global fact`))
  check('read: session scope loads', mems.some((m) => m.key === `${tag} session fact`))
  check('read: expired memory never loads', !mems.some((m) => m.key === `${tag} expired fact`))

  // the theme memory lives in THIS session's scope for the relevance check
  // (the upsert test above wrote it under the synthetic dedupe ref)
  await writeMemory({ scope: 'session', scopeRef: userSession, key: 'theme preference', value: 'royal red in dark mode, gold accents' })
  const themeMems = await relevantMemories('what theme do I prefer', userSession)
  const first = themeMems[0]
  check('read: relevance puts the theme memory first', !!first && first.key === 'theme preference', first?.key)

  // budget: a flood of large memories must not exceed MEMORY_CHAR_BUDGET
  for (let i = 0; i < 60; i++) {
    await writeMemory({ scope: 'session', scopeRef: `${userSession}-flood`, key: `flood ${i}`, value: 'x'.repeat(200) })
  }
  const flood = await relevantMemories('', `${userSession}-flood`)
  const totalChars = flood.reduce((n, m) => n + m.key.length + m.value.length + 12, 0)
  check('read: char budget caps the injection', totalChars <= MEMORY_CHAR_BUDGET, `got ${totalChars}`)

  // 4. prompt block
  check('block: null on empty', memoryBlockForPrompt([]) === null)
  const block = memoryBlockForPrompt([{ ...a, tags: [] }])
  check('block: renders scope + key + value', !!block && block.includes('[session]') && block.includes('theme preference'))
  const injection = await memoryInjection('what theme do I prefer', userSession)
  check('injection: returns a string for a populated store', typeof injection === 'string')

  // 5. audit attribution
  const audits = await db.royalRedAudit.findMany({ where: { agentRole: 'Memory Keeper' }, orderBy: { createdAt: 'desc' }, take: 10 })
  check('audit: writes carry the Memory Keeper role', audits.length >= 3, `got ${audits.length}`)

  // 6. privacy (static): no fetch/http in the memory module
  const { readFileSync } = await import('fs')
  const src = readFileSync(new URL('../src/server/royal-red/memory.ts', import.meta.url), 'utf8')
  check('privacy: no network calls in the memory module', !/\bfetch\(|http(s)?:\/\//.test(src))

  // cleanup the test rows
  await db.royalRedMemory.deleteMany({ where: { OR: [{ scopeRef: { contains: tag } }, { scopeRef: { contains: userSession } }, { key: { contains: tag } }] } })
  await db.royalRedMemory.deleteMany({ where: { scopeRef: { startsWith: `${userSession}-flood` } } })

  console.log(`\nRESULT: ${pass} passed, ${fail} failed`)
  if (fail > 0) process.exit(1)
  process.exit(0)
}

main().catch((e) => {
  console.error('fatal:', e)
  process.exit(1)
})
