// ROYAL RED WordPress builder API (Round 6, Section 6).
// POST /api/royal-red/wordpress
// body: { prompt, brand?, tagline?, industry?, package?: 'theme' | 'full' }
//
// Generates the theme, runs the static Theme-Check-style audit, packages the
// zip into the sandboxed workspace under files/wp-themes/ (visible in the
// FILES panel, downloadable through the workspace file API), writes an audit
// row attributed to the WordPress Builder role, and appends an event. The
// receipt label is always "verification pending real WordPress" because this
// environment has no PHP runtime; nothing here fakes a live pass.

import { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { WORKSPACE_ROOT, ensureWorkspace } from '@/server/royal-red/workspace'
import { generateWpTheme, packageWpTheme } from '@/server/royal-red/wordpress'
import { appendEvent } from '@/server/royal-red/event-log'

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as
    | { prompt?: string; brand?: string; tagline?: string; industry?: string; package?: string; sessionId?: string }
    | null

  const prompt = body?.prompt?.trim()
  if (!prompt || prompt.length < 4) {
    return Response.json({ error: 'prompt required (describe the site you want a theme for)' }, { status: 400 })
  }
  const mode = body?.package === 'full' ? 'full' : 'theme'

  const report = generateWpTheme({
    prompt,
    brand: body?.brand,
    tagline: body?.tagline,
    industry: body?.industry,
    package: mode,
  })

  // package + land in the workspace file area (browse + download from FILES)
  ensureWorkspace()
  const zip = packageWpTheme(report, mode)
  const outDir = path.join(WORKSPACE_ROOT, 'files', 'wp-themes', report.slug)
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of report.files) {
    const p = path.join(outDir, f.path)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, f.content)
  }
  const zipName = `${report.slug}-${mode}.zip`
  const zipPath = path.join(outDir, zipName)
  fs.writeFileSync(zipPath, zip)
  const relZip = `files/wp-themes/${report.slug}/${zipName}`

  // kernel attribution: the WordPress Builder role did this
  await db.royalRedAudit
    .create({
      data: {
        action: 'wordpress.theme.generated',
        detail: `slug=${report.slug} mode=${mode} files=${report.files.length} audit=${report.checks.filter((c) => c.pass).length}/${report.checks.length} label="${report.verificationLabel}"`,
        ok: report.status === 'static-audit-pass',
        agentRole: 'WordPress Builder',
      },
    })
    .catch(() => {})
  if (body?.sessionId) {
    void appendEvent({
      sessionId: body.sessionId,
      type: 'artifact/written',
      payload: { name: report.themeName, kind: 'wordpress-theme', files: report.files.map((f) => f.path), zip: relZip },
    })
  }

  return Response.json({
    ok: true,
    slug: report.slug,
    themeName: report.themeName,
    mode,
    files: report.files.map((f) => f.path),
    checks: report.checks,
    status: report.status,
    verificationLabel: report.verificationLabel,
    summary: report.summary,
    zipRelPath: relZip,
    zipBytes: zip.length,
  })
}
