import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { TOOL_LABELS } from '@/lib/awon/types'
import { buildPdf } from '@/server/awon/pdf'

// GET /api/awon/session/[id]/export?format=md|pdf|csv
// session transcript export. default (and legacy) is markdown.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const format = (req.nextUrl.searchParams.get('format') ?? 'md').toLowerCase()
  const session = await db.awonSession.findUnique({
    where: { id },
    include: {
      messages: { orderBy: { createdAt: 'asc' }, take: 400 },
      artifacts: { orderBy: { createdAt: 'desc' }, take: 10 },
    },
  })
  if (!session) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const slug =
    session.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'session'
  const base = `awon-${slug}`
  const at = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 16)
  const toolSummary = (m: (typeof session.messages)[number]) => {
    const meta = m.meta
      ? (JSON.parse(m.meta) as { tools?: { name: string; ok: boolean; summary: string }[] })
      : null
    return meta?.tools ?? []
  }

  if (format === 'csv') {
    // RFC 4180: quote everything, double embedded quotes, CRLF line endings
    const cell = (v: string) => `"${v.replace(/"/g, '""')}"`
    const rows: string[] = [
      ['timestamp', 'role', 'content', 'tools'].map(cell).join(','),
    ]
    for (const m of session.messages) {
      if (m.role !== 'user' && m.role !== 'assistant') continue
      const content =
        m.role === 'assistant' && (!m.content || m.content === '(working)') ? '' : m.content
      const tools = toolSummary(m)
        .map((t) => `${TOOL_LABELS[t.name] ?? t.name} ${t.ok ? 'ok' : 'FAIL'}: ${t.summary.replace(/\s+/g, ' ').slice(0, 200)}`)
        .join(' | ')
      rows.push([at(m.createdAt), m.role, content, tools].map(cell).join(','))
    }
    for (const a of session.artifacts) {
      rows.push(
        [at(a.createdAt), 'artifact', `${a.name} score ${a.score ?? 'n/a'}/10`, a.entry]
          .map(cell)
          .join(','),
      )
    }
    const body = rows.join('\r\n')
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${base}.csv"`,
        'Content-Length': String(Buffer.byteLength(body)),
      },
    })
  }

  if (format === 'pdf') {
    const lines: { text: string; style: 'title' | 'heading' | 'body' | 'dim' }[] = []
    lines.push({ text: session.title, style: 'title' })
    const artList = session.artifacts.length
      ? ` / Artifacts: ${session.artifacts
          .map((a) => `${a.name}${typeof a.score === 'number' ? ` (${a.score}/10)` : ''}`)
          .join(', ')}`
      : ''
    lines.push({
      text: `Mode: ${session.mode} / Exported: ${new Date().toISOString().replace('T', ' ').slice(0, 16)} / Messages: ${session.messages.length}${artList}`,
      style: 'dim',
    })
    lines.push({ text: '', style: 'body' })
    for (const m of session.messages) {
      if (m.role === 'user') {
        lines.push({ text: `USER / ${at(m.createdAt)}`, style: 'heading' })
        lines.push({ text: m.content, style: 'body' })
        lines.push({ text: '', style: 'body' })
      } else if (m.role === 'assistant') {
        lines.push({ text: `AWON / ${at(m.createdAt)}`, style: 'heading' })
        if (m.content && m.content !== '(working)') {
          lines.push({ text: m.content, style: 'body' })
        }
        for (const t of toolSummary(m)) {
          lines.push({
            text: `- ${TOOL_LABELS[t.name] ?? t.name} ${t.ok ? 'ok' : 'FAIL'}: ${t.summary.replace(/\s+/g, ' ').slice(0, 200)}`,
            style: 'body',
          })
        }
        lines.push({ text: '', style: 'body' })
      }
    }
    const buf = buildPdf(lines)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${base}.pdf"`,
        'Content-Length': String(buf.length),
      },
    })
  }

  // markdown (default)
  const lines: string[] = []
  lines.push(`# ${session.title}`)
  lines.push('')
  lines.push(`- Mode: ${session.mode}`)
  lines.push(`- Exported: ${new Date().toISOString()}`)
  lines.push(`- Messages: ${session.messages.length}`)
  if (session.artifacts.length) {
    lines.push(
      `- Artifacts: ${session.artifacts
        .map((a) => `${a.name}${typeof a.score === 'number' ? ` (${a.score}/10)` : ''}`)
        .join(', ')}`,
    )
  }
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const m of session.messages) {
    if (m.role === 'user') {
      lines.push(`### USER / ${at(m.createdAt)}`)
      lines.push('')
      lines.push(m.content)
      lines.push('')
    } else if (m.role === 'assistant') {
      lines.push(`### AWON / ${at(m.createdAt)}`)
      lines.push('')
      if (m.content && m.content !== '(working)') {
        lines.push(m.content)
        lines.push('')
      }
      for (const t of toolSummary(m)) {
        lines.push(
          `- \`${TOOL_LABELS[t.name] ?? t.name}\` ${t.ok ? 'ok' : 'FAIL'}: ${t.summary.replace(/\s+/g, ' ').slice(0, 200)}`,
        )
      }
      if (toolSummary(m).length) lines.push('')
    }
  }

  const body = lines.join('\n')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${base}.md"`,
      'Content-Length': String(Buffer.byteLength(body)),
    },
  })
}
