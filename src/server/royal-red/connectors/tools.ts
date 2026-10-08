// ROYAL RED connector tools.
//
// For each BUILT connector this module ships one fast authenticated health
// check and three to six REAL tools against the service's public REST API:
// correct endpoints, correct auth headers, correct request shapes, plain fetch.
//
// Trust seam: tools receive the DECRYPTED credential string and the parsed
// non-secret config (storeUrl, siteUrl, appId, spaceId, propertyId, ...) as
// parameters. This module never reads the database, never logs, and redacts
// the credential out of any error text before it escapes. Every call carries
// an AbortSignal timeout (10s health, 20s tools) and every failure is honest:
// ok:false with the service's own error text, never invented data.
//
// Credential shapes: oauth2 connectors take the pasted access token (no
// server-side redirect dance this round); api_key/pat take the raw token;
// telegram takes the bot token (it is part of the path by API design);
// wordpress takes user:application-password, sent as HTTP basic auth.

import { CONNECTOR_CATALOG } from './catalog'

export type ToolResult = { ok: boolean; summary: string; data?: unknown; error?: string }

export interface ConnectorTool {
  name: string // 'github_list_repos' (connectorId_prefix_action)
  description: string
  permission: 'read-only' | 'write' | 'destructive'
  schema: Record<string, unknown> // JSON schema for the args
  run(cred: string, config: Record<string, string>, args: Record<string, unknown>): Promise<ToolResult>
}

// --- shared plumbing ------------------------------------------------------

const HEALTH_TIMEOUT = 10_000
const TOOL_TIMEOUT = 20_000
const USER_AGENT = 'royal-red-connectors'
const DATA_SLICE = 4000 // max chars of file bodies returned in a tool payload

const enc = encodeURIComponent

async function apiRaw(url: string, init: RequestInit = {}, timeoutMs: number = TOOL_TIMEOUT): Promise<{ status: number; text: string; json: unknown; headers: Headers }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
  const text = await res.text()
  let json: unknown
  try { json = text ? JSON.parse(text) : undefined } catch { json = undefined } // raw file bodies and empty 201s stay text
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return { status: res.status, text, json, headers: res.headers }
}

async function apiJson(url: string, init: RequestInit = {}, timeoutMs: number = TOOL_TIMEOUT): Promise<unknown> {
  return (await apiRaw(url, init, timeoutMs)).json
}

async function apiText(url: string, init: RequestInit = {}, timeoutMs: number = TOOL_TIMEOUT): Promise<string> {
  return (await apiRaw(url, init, timeoutMs)).text
}

function bearer(cred: string): Record<string, string> {
  return { authorization: `Bearer ${cred}` }
}

function jsonInit(method: 'POST' | 'PUT' | 'PATCH', body: unknown, headers: Record<string, string> = {}): RequestInit {
  return { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }
}

function record(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function list(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// success result helper: every tool body returns ok(summary, data) on the
// happy path; failures surface through the tool() wrapper as honest errors
function ok(summary: string, data?: unknown): ToolResult {
  return { ok: true, summary, data }
}

function dig(v: unknown, ...path: string[]): unknown {
  let cur = v
  for (const key of path) cur = record(cur)[key]
  return cur
}

function argStr(args: Record<string, unknown>, key: string): string {
  return str(args[key]).trim()
}

function requireArg(args: Record<string, unknown>, key: string, hint: string): string {
  const v = argStr(args, key)
  if (!v) throw new Error(`missing required argument: ${key} (${hint})`)
  return v
}

function requireCfg(config: Record<string, string>, key: string, hint: string): string {
  const v = (config[key] ?? '').trim().replace(/\/+$/, '')
  if (!v) throw new Error(`missing config.${key} (${hint})`)
  return v
}

function trim(text: string, max = 400): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`
}

// short list summary: "5 repositories: a, b, c, d, e, +2 more"
function names(label: string, items: unknown[], nameOf: (item: Record<string, unknown>) => string): string {
  if (!items.length) return `0 ${label}s`
  const shown = items.slice(0, 5).map((it) => nameOf(record(it)))
  const more = items.length > 5 ? `, +${items.length - 5} more` : ''
  return trim(`${items.length} ${label}${items.length === 1 ? '' : 's'}: ${shown.join(', ')}${more}`)
}

function redact(text: string, cred: string): string {
  return cred ? text.split(cred).join('[redacted]') : text
}

// wraps a tool body so every failure becomes an honest ToolResult, with the
// credential stripped from anything that might echo back (URLs in fetch errors)
function tool(def: Omit<ConnectorTool, 'run'>, fn: (cred: string, config: Record<string, string>, args: Record<string, unknown>) => Promise<ToolResult>): ConnectorTool {
  return { ...def, run: async (cred, config, args) => {
    try { return await fn(cred, config, args) } catch (e) { return { ok: false, summary: '', error: redact(e instanceof Error ? e.message : String(e), cred) } }
  } }
}

// --- github (pat): REST v3 -------------------------------------------------

function ghHeaders(cred: string): Record<string, string> {
  return { ...bearer(cred), accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': USER_AGENT }
}

const GITHUB_TOOLS: ConnectorTool[] = [
  tool({
    name: 'github_list_repos',
    description: 'List the authenticated GitHub user repositories, most recently updated first.',
    permission: 'read-only',
    schema: { type: 'object', properties: { visibility: { type: 'string', enum: ['all', 'public', 'private'], description: 'Visibility filter, default all.' } } },
  }, async (cred, _config, args) => {
    const visibility = argStr(args, 'visibility') || 'all'
    const items = list(await apiJson(`https://api.github.com/user/repos?per_page=10&sort=updated&visibility=${enc(visibility)}`, { headers: ghHeaders(cred) }))
    return ok(names('repository', items, (r) => str(r.full_name)), { repositories: items.slice(0, 10).map((raw) => { const r = record(raw); return { name: str(r.name), fullName: str(r.full_name), private: r.private === true, stars: num(r.stargazers_count), url: str(r.html_url) } }) })
  }),
  tool({
    name: 'github_create_issue',
    description: 'Create a GitHub issue in owner/repo with a title, optional markdown body and labels.',
    permission: 'write',
    schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, title: { type: 'string' }, body: { type: 'string', description: 'Issue body, markdown.' }, labels: { type: 'array', items: { type: 'string' } } }, required: ['owner', 'repo', 'title'] },
  }, async (cred, _config, args) => {
    const owner = requireArg(args, 'owner', 'repository owner login')
    const repo = requireArg(args, 'repo', 'repository name')
    const body: Record<string, unknown> = { title: requireArg(args, 'title', 'issue title') }
    const text = argStr(args, 'body')
    if (text) body.body = text
    const labels = list(args.labels).map((l) => str(l)).filter(Boolean)
    if (labels.length) body.labels = labels
    const d = record(await apiJson(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}/issues`, jsonInit('POST', body, ghHeaders(cred))))
    return { ok: true, summary: `Issue #${num(d.number)} created in ${owner}/${repo}: ${str(d.title)}`, data: { number: num(d.number), url: str(d.html_url) } }
  }),
  tool({
    name: 'github_read_file',
    description: 'Read one file from a GitHub repository as raw text (text files, not binaries).',
    permission: 'read-only',
    schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string', description: 'File path inside the repo, e.g. src/index.ts.' }, ref: { type: 'string', description: 'Branch, tag or commit sha, defaults to the default branch.' } }, required: ['owner', 'repo', 'path'] },
  }, async (cred, _config, args) => {
    const owner = requireArg(args, 'owner', 'repository owner login')
    const repo = requireArg(args, 'repo', 'repository name')
    const path = requireArg(args, 'path', 'file path inside the repository')
    const ref = argStr(args, 'ref')
    const seg = path.split('/').map(enc).join('/') // encode each segment, keep the separators
    const qs = ref ? `?ref=${enc(ref)}` : ''
    const text = await apiText(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}/contents/${seg}${qs}`, { headers: { ...ghHeaders(cred), accept: 'application/vnd.github.raw' } })
    return { ok: true, summary: trim(`${owner}/${repo}/${path} (${text.length} bytes)`), data: { path, bytes: text.length, content: text.slice(0, DATA_SLICE), truncated: text.length > DATA_SLICE } }
  }),
  tool({
    name: 'github_comment_on_pr',
    description: 'Post a comment on a GitHub pull request (a PR timeline is the issue timeline).',
    permission: 'write',
    schema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, number: { type: 'string', description: 'Pull request number.' }, body: { type: 'string' } }, required: ['owner', 'repo', 'number', 'body'] },
  }, async (cred, _config, args) => {
    const owner = requireArg(args, 'owner', 'repository owner login')
    const repo = requireArg(args, 'repo', 'repository name')
    const number = requireArg(args, 'number', 'pull request number')
    const body = requireArg(args, 'body', 'comment text')
    const d = record(await apiJson(`https://api.github.com/repos/${enc(owner)}/${enc(repo)}/issues/${enc(number)}/comments`, jsonInit('POST', { body }, ghHeaders(cred))))
    return { ok: true, summary: `Comment posted on PR #${number} in ${owner}/${repo}`, data: { commentId: num(d.id), url: str(d.html_url) } }
  }),
]

// --- slack (oauth2 bot token): Web API -------------------------------------

function slackOk(json: unknown): Record<string, unknown> {
  const d = record(json)
  if (d.ok === false) throw new Error(`slack API error: ${str(d.error) || 'unknown'}`)
  return d
}

const SLACK_TOOLS: ConnectorTool[] = [
  tool({
    name: 'slack_list_channels',
    description: 'List Slack channels the bot can see, public and private, newest activity first.',
    permission: 'read-only',
    schema: { type: 'object', properties: { cursor: { type: 'string', description: 'Pagination cursor from the previous page.' } } },
  }, async (cred, _config, args) => {
    const qs = new URLSearchParams({ limit: '20', types: 'public_channel,private_channel' })
    const cursor = argStr(args, 'cursor')
    if (cursor) qs.set('cursor', cursor)
    const d = slackOk(await apiJson(`https://slack.com/api/conversations.list?${qs}`, { headers: bearer(cred) }))
    const items = list(d.channels)
    return { ok: true, summary: names('channel', items, (c) => `#${str(c.name)}`), data: { channels: items.slice(0, 20).map((raw) => { const c = record(raw); return { id: str(c.id), name: str(c.name) } }), nextCursor: str(record(d.response_metadata).next_cursor) } }
  }),
  tool({
    name: 'slack_send_message',
    description: 'Send a message to a Slack channel or user (chat.postMessage).',
    permission: 'write',
    schema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel id like C123ABC, or a user id.' }, text: { type: 'string' } }, required: ['channel', 'text'] },
  }, async (cred, _config, args) => {
    const channel = requireArg(args, 'channel', 'channel id like C123ABC')
    const text = requireArg(args, 'text', 'message text')
    const d = slackOk(await apiJson('https://slack.com/api/chat.postMessage', jsonInit('POST', { channel, text }, bearer(cred))))
    return { ok: true, summary: trim(`Message sent to ${channel}: "${text}"`), data: { ts: str(d.ts), channel: str(d.channel) } }
  }),
  tool({
    name: 'slack_read_channel',
    description: 'Read the 10 most recent messages from a Slack channel (conversations.history).',
    permission: 'read-only',
    schema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel id like C123ABC.' } }, required: ['channel'] },
  }, async (cred, _config, args) => {
    const channel = requireArg(args, 'channel', 'channel id like C123ABC')
    const d = slackOk(await apiJson(`https://slack.com/api/conversations.history?channel=${enc(channel)}&limit=10`, { headers: bearer(cred) }))
    const items = list(d.messages)
    const latest = items.length ? str(record(items[0]).text).slice(0, 120) : ''
    return ok(trim(`${items.length} messages in ${channel}, latest: ${latest}`), { messages: items.slice(0, 10).map((raw) => { const m = record(raw); return { ts: str(m.ts), user: str(m.user), text: str(m.text).slice(0, 500) } }) })
  }),
]

// --- google-drive (oauth2 access token): Drive v3 --------------------------

const DRIVE = 'https://www.googleapis.com/drive/v3'

const DRIVE_TOOLS: ConnectorTool[] = [
  tool({
    name: 'drive_list_files',
    description: 'List the 10 most recent files in the connected Google Drive (files.list).',
    permission: 'read-only',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional Drive q filter, e.g. name contains \'report\'.' } } },
  }, async (cred, _config, args) => {
    const qs = new URLSearchParams({ pageSize: '10', fields: 'files(id,name,mimeType,modifiedTime)' })
    const q = argStr(args, 'query')
    if (q) qs.set('q', q)
    const d = record(await apiJson(`${DRIVE}/files?${qs}`, { headers: bearer(cred) }))
    const items = list(d.files)
    return { ok: true, summary: names('file', items, (f) => str(f.name)), data: { files: items.slice(0, 10).map((raw) => { const f = record(raw); return { id: str(f.id), name: str(f.name), mimeType: str(f.mimeType), modifiedTime: str(f.modifiedTime) } }) } }
  }),
  tool({
    name: 'drive_read_file',
    description: 'Download one Google Drive file as text (alt=media). Works for text-like files.',
    permission: 'read-only',
    schema: { type: 'object', properties: { fileId: { type: 'string' } }, required: ['fileId'] },
  }, async (cred, _config, args) => {
    const fileId = requireArg(args, 'fileId', 'Drive file id')
    const text = await apiText(`${DRIVE}/files/${enc(fileId)}?alt=media`, { headers: bearer(cred) })
    return { ok: true, summary: `Read Drive file ${fileId} (${text.length} bytes)`, data: { fileId, bytes: text.length, content: text.slice(0, DATA_SLICE), truncated: text.length > DATA_SLICE } }
  }),
  tool({
    name: 'drive_upload_text',
    description: 'Create a new Google Drive text file from the given content (multipart upload).',
    permission: 'write',
    schema: { type: 'object', properties: { name: { type: 'string', description: 'File name in Drive.' }, content: { type: 'string', description: 'Text content to store.' } }, required: ['name', 'content'] },
  }, async (cred, _config, args) => {
    const name = requireArg(args, 'name', 'file name in Drive')
    const content = requireArg(args, 'content', 'text content to upload')
    const boundary = 'royalred-connector-multipart'
    const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', JSON.stringify({ name, mimeType: 'text/plain' }), `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', content, `--${boundary}--`].join('\r\n')
    const d = record(await apiJson('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...bearer(cred), 'content-type': `multipart/related; boundary=${boundary}` }, body }))
    return { ok: true, summary: `Uploaded "${name}" to Google Drive (file id ${str(d.id)})`, data: { fileId: str(d.id), name: str(d.name) } }
  }),
]

// --- notion (integration token): API 2022-06-28 ----------------------------

const NOTION = 'https://api.notion.com/v1'

function notionHeaders(cred: string): Record<string, string> {
  return { ...bearer(cred), 'notion-version': '2022-06-28' }
}

function notionTitle(v: unknown): string {
  const d = record(v)
  if (str(d.object) === 'page') {
    const props = record(d.properties)
    for (const key of Object.keys(props)) {
      const prop = record(props[key])
      if (prop.type === 'title') return str(list(prop.title).map((t) => str(record(t).plain_text)).join(''))
    }
  }
  if (str(d.object) === 'database' || str(d.object) === 'data_source') return str(list(d.title).map((t) => str(record(t).plain_text)).join(''))
  return ''
}

const NOTION_TOOLS: ConnectorTool[] = [
  tool({
    name: 'notion_search',
    description: 'Search Notion pages and databases shared with the integration (search endpoint).',
    permission: 'read-only',
    schema: { type: 'object', properties: { query: { type: 'string', description: 'Free text query, empty lists everything.' }, type: { type: 'string', enum: ['page', 'database'] } } },
  }, async (cred, _config, args) => {
    const body: Record<string, unknown> = { page_size: 10 }
    const q = argStr(args, 'query')
    if (q) body.query = q
    const type = argStr(args, 'type')
    if (type === 'page' || type === 'database') body.filter = { property: 'object', value: type }
    const d = record(await apiJson(`${NOTION}/search`, jsonInit('POST', body, notionHeaders(cred))))
    const items = list(d.results)
    return { ok: true, summary: names('result', items, (r) => notionTitle(r) || str(r.id)), data: { results: items.slice(0, 10).map((raw) => { const r = record(raw); return { id: str(r.id), object: str(r.object), title: notionTitle(r), url: str(r.url) } }) } }
  }),
  tool({
    name: 'notion_create_page',
    description: 'Create a Notion page under a parent page or database, with optional paragraph content.',
    permission: 'write',
    schema: { type: 'object', properties: { parentPageId: { type: 'string', description: 'Parent page id, exactly one parent id is required.' }, parentDatabaseId: { type: 'string' }, title: { type: 'string' }, content: { type: 'string', description: 'One paragraph of page content.' } }, required: ['title'] },
  }, async (cred, _config, args) => {
    const title = requireArg(args, 'title', 'page title')
    const parentPageId = argStr(args, 'parentPageId')
    const parentDatabaseId = argStr(args, 'parentDatabaseId')
    if (!parentPageId === !parentDatabaseId) throw new Error('provide exactly one of parentPageId or parentDatabaseId')
    const body: Record<string, unknown> = {
      parent: parentPageId ? { page_id: parentPageId } : { database_id: parentDatabaseId },
      properties: { title: { title: [{ text: { content: title } }] } },
    }
    const content = argStr(args, 'content')
    if (content) body.children = [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content } }] } }]
    const d = record(await apiJson(`${NOTION}/pages`, jsonInit('POST', body, notionHeaders(cred))))
    return { ok: true, summary: `Created Notion page "${title}" (id ${str(d.id)})`, data: { pageId: str(d.id), url: str(d.url) } }
  }),
  tool({
    name: 'notion_read_page',
    description: 'Read one Notion page object: title, url and timestamps (pages retrieve).',
    permission: 'read-only',
    schema: { type: 'object', properties: { pageId: { type: 'string', description: 'Page id, dashes optional.' } }, required: ['pageId'] },
  }, async (cred, _config, args) => {
    const pageId = requireArg(args, 'pageId', 'Notion page id (uuid, dashes optional)')
    const d = record(await apiJson(`${NOTION}/pages/${enc(pageId)}`, { headers: notionHeaders(cred) }))
    return { ok: true, summary: trim(`Page "${notionTitle(d)}" (id ${str(d.id)})`), data: { id: str(d.id), title: notionTitle(d), url: str(d.url), createdTime: str(d.created_time), lastEditedTime: str(d.last_edited_time), archived: d.archived === true } }
  }),
]

// --- gitlab (pat): REST v4 -------------------------------------------------

const GITLAB = 'https://gitlab.com/api/v4'

const GITLAB_TOOLS: ConnectorTool[] = [
  tool({
    name: 'gitlab_list_projects',
    description: 'List GitLab projects the token can access, most recently active first.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const items = list(await apiJson(`${GITLAB}/projects?membership=true&per_page=10&order_by=last_activity_at`, { headers: bearer(cred) }))
    return { ok: true, summary: names('project', items, (p) => str(p.path_with_namespace)), data: { projects: items.slice(0, 10).map((raw) => { const p = record(raw); return { id: num(p.id), path: str(p.path_with_namespace), url: str(p.web_url), stars: num(p.star_count) } }) } }
  }),
  tool({
    name: 'gitlab_create_issue',
    description: 'Create a GitLab issue in a project (numeric id or namespace/path).',
    permission: 'write',
    schema: { type: 'object', properties: { projectId: { type: 'string', description: 'Numeric project id or URL-encodable path like group/repo.' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['projectId', 'title'] },
  }, async (cred, _config, args) => {
    const projectId = requireArg(args, 'projectId', 'project id or namespace/path')
    const body: Record<string, unknown> = { title: requireArg(args, 'title', 'issue title') }
    const description = argStr(args, 'description')
    if (description) body.description = description
    const d = record(await apiJson(`${GITLAB}/projects/${enc(projectId)}/issues`, jsonInit('POST', body, bearer(cred))))
    return { ok: true, summary: `Issue #${num(d.iid)} created in project ${projectId}: ${str(d.title)}`, data: { iid: num(d.iid), url: str(d.web_url) } }
  }),
  tool({
    name: 'gitlab_read_file',
    description: 'Read one file from a GitLab repository (base64 content decoded to text).',
    permission: 'read-only',
    schema: { type: 'object', properties: { projectId: { type: 'string' }, filePath: { type: 'string' }, ref: { type: 'string', description: 'Branch, tag or commit sha, defaults to main.' } }, required: ['projectId', 'filePath'] },
  }, async (cred, _config, args) => {
    const projectId = requireArg(args, 'projectId', 'project id or namespace/path')
    const filePath = requireArg(args, 'filePath', 'path of the file inside the repository')
    const ref = argStr(args, 'ref') || 'main'
    const d = record(await apiJson(`${GITLAB}/projects/${enc(projectId)}/repository/files/${enc(filePath)}?ref=${enc(ref)}`, { headers: bearer(cred) }))
    if (str(d.encoding) !== 'base64') throw new Error(`unexpected file encoding: ${str(d.encoding) || 'none'}`)
    const text = Buffer.from(str(d.content), 'base64').toString('utf8')
    return { ok: true, summary: trim(`Read ${str(d.file_path)} @ ${ref} in project ${projectId} (${text.length} bytes)`), data: { path: str(d.file_path), ref, bytes: text.length, content: text.slice(0, DATA_SLICE), truncated: text.length > DATA_SLICE } }
  }),
]

// --- discord (bot token): REST v10 -----------------------------------------

const DISCORD = 'https://discord.com/api/v10'

function botHeaders(cred: string): Record<string, string> {
  return { authorization: `Bot ${cred}` }
}

const DISCORD_TOOLS: ConnectorTool[] = [
  tool({
    name: 'discord_list_guilds',
    description: 'List the Discord guilds (servers) the bot is a member of.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const items = list(await apiJson(`${DISCORD}/users/@me/guilds?limit=20`, { headers: botHeaders(cred) }))
    return { ok: true, summary: names('guild', items, (g) => str(g.name)), data: { guilds: items.slice(0, 20).map((raw) => { const g = record(raw); return { id: str(g.id), name: str(g.name) } }) } }
  }),
  tool({
    name: 'discord_send_message',
    description: 'Send a message to a Discord text channel (create message).',
    permission: 'write',
    schema: { type: 'object', properties: { channelId: { type: 'string' }, content: { type: 'string' } }, required: ['channelId', 'content'] },
  }, async (cred, _config, args) => {
    const channelId = requireArg(args, 'channelId', 'text channel id')
    const content = requireArg(args, 'content', 'message text')
    const d = record(await apiJson(`${DISCORD}/channels/${enc(channelId)}/messages`, jsonInit('POST', { content }, botHeaders(cred))))
    return { ok: true, summary: trim(`Message sent to channel ${channelId}: "${content}"`), data: { messageId: str(d.id), channelId: str(d.channel_id) } }
  }),
  tool({
    name: 'discord_read_messages',
    description: 'Read the 10 most recent messages from a Discord text channel.',
    permission: 'read-only',
    schema: { type: 'object', properties: { channelId: { type: 'string' } }, required: ['channelId'] },
  }, async (cred, _config, args) => {
    const channelId = requireArg(args, 'channelId', 'text channel id')
    const items = list(await apiJson(`${DISCORD}/channels/${enc(channelId)}/messages?limit=10`, { headers: botHeaders(cred) }))
    const latest = items.length ? str(record(items[0]).content).slice(0, 120) : ''
    return ok(trim(`${items.length} messages in ${channelId}, latest: ${latest}`), { messages: items.slice(0, 10).map((raw) => { const m = record(raw); return { id: str(m.id), author: str(dig(m, 'author', 'username')), content: str(m.content).slice(0, 500), timestamp: str(m.timestamp) } }) })
  }),
]

// --- gmail (oauth2 access token): Gmail API v1 -----------------------------

const GMAIL = 'https://gmail.googleapis.com/gmail/v1'

function b64urlDecode(v: unknown): string {
  const s = str(v)
  return s ? Buffer.from(s, 'base64url').toString('utf8') : ''
}

// Gmail nests the body: payload.body.data or text/plain inside payload.parts
function gmailBodyText(payload: Record<string, unknown>): string {
  const direct = b64urlDecode(record(payload.body).data)
  if (direct) return direct
  const parts = list(payload.parts)
  const part = parts.find((raw) => str(record(raw).mimeType) === 'text/plain') ?? parts[0] // fall back to the first child part (html-only mail)
  return b64urlDecode(record(record(part).body).data)
}

const GMAIL_TOOLS: ConnectorTool[] = [
  tool({
    name: 'gmail_list_messages',
    description: 'List the 10 most recent Gmail message ids in the mailbox (messages.list).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${GMAIL}/users/me/messages?maxResults=10`, { headers: bearer(cred) }))
    const items = list(d.messages)
    return { ok: true, summary: `${items.length} message ids in the mailbox (use gmail_get_message for content)`, data: { messages: items.slice(0, 10).map((raw) => { const m = record(raw); return { id: str(m.id), threadId: str(m.threadId) } }), resultSizeEstimate: num(d.resultSizeEstimate) } }
  }),
  tool({
    name: 'gmail_get_message',
    description: 'Read one Gmail message with headers and decoded plain text body (messages.get, format=full).',
    permission: 'read-only',
    schema: { type: 'object', properties: { messageId: { type: 'string' } }, required: ['messageId'] },
  }, async (cred, _config, args) => {
    const messageId = requireArg(args, 'messageId', 'Gmail message id')
    const d = record(await apiJson(`${GMAIL}/users/me/messages/${enc(messageId)}?format=full`, { headers: bearer(cred) }))
    const payload = record(d.payload)
    const header = (name: string): string => str(list(payload.headers).map((x) => record(x)).find((x) => str(x.name).toLowerCase() === name.toLowerCase())?.value)
    return ok(trim(`From ${header('From')}: ${header('Subject')}`), { id: str(d.id), threadId: str(d.threadId), from: header('From'), to: header('To'), subject: header('Subject'), date: header('Date'), snippet: str(d.snippet), body: gmailBodyText(payload).slice(0, 2000) })
  }),
  tool({
    name: 'gmail_send',
    description: 'Send an email from the connected Gmail account (messages.send, raw base64url MIME).',
    permission: 'write',
    schema: { type: 'object', properties: { to: { type: 'string', description: 'Recipient email address.' }, subject: { type: 'string' }, body: { type: 'string', description: 'Plain text body.' } }, required: ['to', 'subject', 'body'] },
  }, async (cred, _config, args) => {
    const to = requireArg(args, 'to', 'recipient email address')
    const subject = requireArg(args, 'subject', 'email subject')
    const body = requireArg(args, 'body', 'plain text body')
    const mime = [`To: ${to}`, `Subject: ${subject}`, 'Content-Type: text/plain; charset="UTF-8"', '', body].join('\r\n')
    const d = record(await apiJson(`${GMAIL}/users/me/messages/send`, jsonInit('POST', { raw: Buffer.from(mime).toString('base64url') }, bearer(cred))))
    return { ok: true, summary: trim(`Email sent to ${to}: "${subject}"`), data: { id: str(d.id), threadId: str(d.threadId) } }
  }),
]

// --- google-calendar (oauth2 access token): Calendar API v3 ----------------

const GCAL = 'https://www.googleapis.com/calendar/v3'

const GCAL_TOOLS: ConnectorTool[] = [
  tool({
    name: 'calendar_list_events',
    description: 'List the next 10 events on the primary Google calendar (events.list, singleEvents).',
    permission: 'read-only',
    schema: { type: 'object', properties: { timeMin: { type: 'string', description: 'ISO 8601 lower bound, defaults to now.' }, timeMax: { type: 'string', description: 'Optional ISO 8601 upper bound.' } } },
  }, async (cred, _config, args) => {
    const qs = new URLSearchParams({ maxResults: '10', singleEvents: 'true', orderBy: 'startTime', timeMin: argStr(args, 'timeMin') || new Date().toISOString() })
    const timeMax = argStr(args, 'timeMax')
    if (timeMax) qs.set('timeMax', timeMax)
    const d = record(await apiJson(`${GCAL}/calendars/primary/events?${qs}`, { headers: bearer(cred) }))
    const items = list(d.items)
    return ok(names('upcoming event', items, (e) => `${str(e.summary) || '(untitled)'} @ ${str(record(e.start).dateTime || record(e.start).date)}`), { events: items.slice(0, 10).map((raw) => { const e = record(raw); return { id: str(e.id), summary: str(e.summary), start: str(record(e.start).dateTime || record(e.start).date), end: str(record(e.end).dateTime || record(e.end).date), link: str(e.htmlLink) } }) })
  }),
  tool({
    name: 'calendar_create_event',
    description: 'Create an event on the primary Google calendar (events.insert).',
    permission: 'write',
    schema: { type: 'object', properties: { summary: { type: 'string' }, start: { type: 'string', description: 'Start, ISO 8601 datetime.' }, end: { type: 'string', description: 'End, ISO 8601, defaults to start plus one hour.' }, description: { type: 'string' } }, required: ['summary', 'start'] },
  }, async (cred, _config, args) => {
    const summary = requireArg(args, 'summary', 'event title')
    const start = requireArg(args, 'start', 'start time as ISO 8601 datetime')
    const end = argStr(args, 'end') || new Date(new Date(start).getTime() + 3_600_000).toISOString()
    const body: Record<string, unknown> = { summary, start: { dateTime: start }, end: { dateTime: end } }
    const description = argStr(args, 'description')
    if (description) body.description = description
    const d = record(await apiJson(`${GCAL}/calendars/primary/events`, jsonInit('POST', body, bearer(cred))))
    return { ok: true, summary: `Event "${str(d.summary)}" created (${start} to ${end})`, data: { eventId: str(d.id), htmlLink: str(d.htmlLink) } }
  }),
  tool({
    name: 'calendar_list_calendars',
    description: 'List the Google calendars on the account calendar list.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${GCAL}/users/me/calendarList?maxResults=20`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('calendar', items, (c) => `${str(c.summary)}${c.primary === true ? ' (primary)' : ''}`), data: { calendars: items.slice(0, 20).map((raw) => { const c = record(raw); return { id: str(c.id), summary: str(c.summary), primary: c.primary === true } }) } }
  }),
]

// --- stripe (secret key): REST, form-encoded requests ----------------------

const STRIPE = 'https://api.stripe.com/v1'

function chargeLabel(c: Record<string, unknown>): string {
  return `${str(c.id)} ${(num(c.amount) / 100).toFixed(2)} ${str(c.currency)}`
}

const STRIPE_TOOLS: ConnectorTool[] = [
  tool({
    name: 'stripe_list_charges',
    description: 'List the 10 most recent Stripe charges (amounts in major currency units).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${STRIPE}/charges?limit=10`, { headers: bearer(cred) }))
    const items = list(d.data)
    return { ok: true, summary: names('charge', items, chargeLabel), data: { charges: items.slice(0, 10).map((raw) => { const c = record(raw); return { id: str(c.id), amount: num(c.amount) / 100, currency: str(c.currency), status: str(c.status), customer: str(c.customer), created: num(c.created) } }) } }
  }),
  tool({
    name: 'stripe_list_customers',
    description: 'List the 10 most recent Stripe customers.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${STRIPE}/customers?limit=10`, { headers: bearer(cred) }))
    const items = list(d.data)
    return { ok: true, summary: names('customer', items, (c) => str(c.email) || str(c.name) || str(c.id)), data: { customers: items.slice(0, 10).map((raw) => { const c = record(raw); return { id: str(c.id), email: str(c.email), name: str(c.name), created: num(c.created) } }) } }
  }),
  tool({
    name: 'stripe_create_customer',
    description: 'Create a Stripe customer (form-encoded POST /customers, as the Stripe API requires).',
    permission: 'write',
    schema: { type: 'object', properties: { email: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' } }, description: 'Provide at least one field.' },
  }, async (cred, _config, args) => {
    const email = argStr(args, 'email')
    const name = argStr(args, 'name')
    const description = argStr(args, 'description')
    if (!email && !name && !description) throw new Error('provide at least one of email, name or description')
    const form = new URLSearchParams()
    if (email) form.set('email', email)
    if (name) form.set('name', name)
    if (description) form.set('description', description)
    const d = record(await apiJson(`${STRIPE}/customers`, { method: 'POST', headers: { ...bearer(cred), 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }))
    return { ok: true, summary: `Customer ${str(d.id)} created (${email || name || description})`, data: { id: str(d.id), email: str(d.email), name: str(d.name) } }
  }),
]

// --- shopify (admin access token): Admin REST 2024-01, store URL in config -

function shopBase(config: Record<string, string>): string {
  return `${requireCfg(config, 'storeUrl', 'the store base, e.g. https://your-store.myshopify.com')}/admin/api/2024-01`
}

function shopHeaders(cred: string): Record<string, string> {
  return { 'x-shopify-access-token': cred }
}

const SHOPIFY_TOOLS: ConnectorTool[] = [
  tool({
    name: 'shopify_list_products',
    description: 'List the first 10 products of the connected Shopify store.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const d = record(await apiJson(`${shopBase(config)}/products.json?limit=10`, { headers: shopHeaders(cred) }))
    const items = list(d.products)
    return { ok: true, summary: names('product', items, (p) => str(p.title)), data: { products: items.slice(0, 10).map((raw) => { const p = record(raw); return { id: num(p.id), title: str(p.title), handle: str(p.handle), status: str(p.status) } }) } }
  }),
  tool({
    name: 'shopify_get_shop',
    description: 'Read the connected Shopify shop profile (shop.json).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const s = record(record(await apiJson(`${shopBase(config)}/shop.json`, { headers: shopHeaders(cred) })).shop)
    return { ok: true, summary: `Shop "${str(s.name)}" (${str(s.domain)}), currency ${str(s.currency)}`, data: { id: num(s.id), name: str(s.name), domain: str(s.domain), myshopifyDomain: str(s.myshopify_domain), currency: str(s.currency), planName: str(s.plan_display_name) } }
  }),
  tool({
    name: 'shopify_update_product',
    description: 'Update a Shopify product title, description or status (PUT products/{id}.json).',
    permission: 'write',
    schema: { type: 'object', properties: { productId: { type: 'string' }, title: { type: 'string' }, bodyHtml: { type: 'string', description: 'Product description, HTML.' }, status: { type: 'string', enum: ['active', 'draft', 'archived'] } }, required: ['productId'] },
  }, async (cred, config, args) => {
    const productId = requireArg(args, 'productId', 'numeric product id')
    const update: Record<string, unknown> = { id: num(productId) }
    const title = argStr(args, 'title')
    const bodyHtml = argStr(args, 'bodyHtml')
    const status = argStr(args, 'status')
    if (title) update.title = title
    if (bodyHtml) update.body_html = bodyHtml
    if (status) update.status = status
    if (!title && !bodyHtml && !status) throw new Error('provide at least one of title, bodyHtml or status')
    const d = record(await apiJson(`${shopBase(config)}/products/${enc(productId)}.json`, jsonInit('PUT', { product: update }, shopHeaders(cred))))
    const p = record(d.product)
    return { ok: true, summary: `Product ${productId} updated: "${str(p.title)}"`, data: { id: num(p.id), title: str(p.title), status: str(p.status) } }
  }),
]

// --- wordpress (user:application-password, basic auth): WP REST v2 ---------

function wpBase(config: Record<string, string>): string {
  let site = requireCfg(config, 'siteUrl', 'the site base, e.g. https://your-site.com')
  if (site.endsWith('/wp-json')) site = site.slice(0, -'/wp-json'.length) // tolerate a pasted REST root
  return `${site}/wp-json/wp/v2`
}

function wpHeaders(cred: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(cred).toString('base64')}` }
}

const WORDPRESS_TOOLS: ConnectorTool[] = [
  tool({
    name: 'wp_list_posts',
    description: 'List the 10 most recent posts on the connected WordPress site.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const items = list(await apiJson(`${wpBase(config)}/posts?per_page=10`, { headers: wpHeaders(cred) }))
    return { ok: true, summary: names('post', items, (p) => str(record(p.title).rendered) || str(p.id)), data: { posts: items.slice(0, 10).map((raw) => { const p = record(raw); return { id: num(p.id), title: str(record(p.title).rendered), status: str(p.status), date: str(p.date), link: str(p.link) } }) } }
  }),
  tool({
    name: 'wp_create_post',
    description: 'Create a WordPress post (draft by default, basic auth with the application password).',
    permission: 'write',
    schema: { type: 'object', properties: { title: { type: 'string' }, content: { type: 'string', description: 'Post content, HTML.' }, status: { type: 'string', enum: ['draft', 'publish', 'pending', 'private'] } }, required: ['title'] },
  }, async (cred, config, args) => {
    const title = requireArg(args, 'title', 'post title')
    const body: Record<string, unknown> = { title, status: argStr(args, 'status') || 'draft' }
    const content = argStr(args, 'content')
    if (content) body.content = content
    const d = record(await apiJson(`${wpBase(config)}/posts`, jsonInit('POST', body, wpHeaders(cred))))
    return { ok: true, summary: `Post "${str(record(d.title).rendered)}" created (status ${str(d.status)}, id ${num(d.id)})`, data: { id: num(d.id), link: str(d.link), status: str(d.status) } }
  }),
  tool({
    name: 'wp_list_pages',
    description: 'List the 10 most recent pages on the connected WordPress site.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const items = list(await apiJson(`${wpBase(config)}/pages?per_page=10`, { headers: wpHeaders(cred) }))
    return { ok: true, summary: names('page', items, (p) => str(record(p.title).rendered) || str(p.id)), data: { pages: items.slice(0, 10).map((raw) => { const p = record(raw); return { id: num(p.id), title: str(record(p.title).rendered), status: str(p.status), link: str(p.link) } }) } }
  }),
]

// --- contentful (management token): Content Management API -----------------

const CONTENTFUL = 'https://api.contentful.com'

const CONTENTFUL_TOOLS: ConnectorTool[] = [
  tool({
    name: 'contentful_list_spaces',
    description: 'List the Contentful spaces the management token can access.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${CONTENTFUL}/spaces?limit=20`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('space', items, (s) => str(s.name)), data: { spaces: items.slice(0, 20).map((raw) => { const s = record(raw); return { id: str(dig(s, 'sys', 'id')), name: str(s.name) } }) } }
  }),
  tool({
    name: 'contentful_list_entries',
    description: 'List the 10 most recent entries of a Contentful space (space id from config).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const spaceId = requireCfg(config, 'spaceId', 'the Contentful space id')
    const d = record(await apiJson(`${CONTENTFUL}/spaces/${enc(spaceId)}/entries?limit=10`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('entry', items, (e) => `${str(dig(e, 'sys', 'contentType', 'sys', 'id'))}:${str(dig(e, 'sys', 'id'))}`), data: { entries: items.slice(0, 10).map((raw) => { const e = record(raw); return { id: str(dig(e, 'sys', 'id')), contentType: str(dig(e, 'sys', 'contentType', 'sys', 'id')), fieldNames: Object.keys(record(e.fields)) } }) } }
  }),
  tool({
    name: 'contentful_create_entry',
    description: 'Create a Contentful entry of a given content type (fields values are localized, e.g. { title: { "en-US": "Hi" } }).',
    permission: 'write',
    schema: { type: 'object', properties: { contentTypeId: { type: 'string' }, fields: { type: 'object', description: 'Field name to localized value map.' } }, required: ['contentTypeId', 'fields'] },
  }, async (cred, config, args) => {
    const spaceId = requireCfg(config, 'spaceId', 'the Contentful space id')
    const contentTypeId = requireArg(args, 'contentTypeId', 'content type id, e.g. blogPost')
    const fields = record(args.fields)
    if (!Object.keys(fields).length) throw new Error('fields must map field names to localized values, e.g. { title: { "en-US": "Hello" } }')
    const init: RequestInit = { method: 'POST', headers: { ...bearer(cred), 'content-type': 'application/vnd.contentful.management.v1+json', 'x-contentful-content-type': contentTypeId }, body: JSON.stringify({ fields }) }
    const d = record(await apiJson(`${CONTENTFUL}/spaces/${enc(spaceId)}/entries`, init))
    return { ok: true, summary: `Entry ${str(dig(d, 'sys', 'id'))} created (type ${contentTypeId}, space ${spaceId})`, data: { entryId: str(dig(d, 'sys', 'id')), version: num(dig(d, 'sys', 'version')) } }
  }),
]

// --- google-analytics (service account token): Data + Admin API ------------

const GA_DATA = 'https://analyticsdata.googleapis.com/v1beta'
const GA_ADMIN = 'https://analyticsadmin.googleapis.com/v1beta'

function gaPropertyId(config: Record<string, string>, args: Record<string, unknown>): string {
  const id = argStr(args, 'propertyId') || (config.propertyId ?? '').trim()
  if (!id) throw new Error('missing GA property id: pass args.propertyId or set config.propertyId')
  return id.replace(/^properties\//, '')
}

const GA_TOOLS: ConnectorTool[] = [
  tool({
    name: 'ga_run_report',
    description: 'Run a Google Analytics 4 report (one dimension by one metric, last 7 days by default).',
    permission: 'read-only',
    schema: { type: 'object', properties: { propertyId: { type: 'string', description: 'Defaults to config.propertyId.' }, dimension: { type: 'string', description: 'Dimension apiName, default date.' }, metric: { type: 'string', description: 'Metric apiName, default activeUsers.' }, startDate: { type: 'string', description: 'Default 7daysAgo.' }, endDate: { type: 'string', description: 'Default today.' } } },
  }, async (cred, config, args) => {
    const propertyId = gaPropertyId(config, args)
    const dim = argStr(args, 'dimension') || 'date'
    const met = argStr(args, 'metric') || 'activeUsers'
    const body = { dateRanges: [{ startDate: argStr(args, 'startDate') || '7daysAgo', endDate: argStr(args, 'endDate') || 'today' }], dimensions: [{ name: dim }], metrics: [{ name: met }], limit: 10 }
    const d = record(await apiJson(`${GA_DATA}/properties/${enc(propertyId)}:runReport`, jsonInit('POST', body, bearer(cred))))
    const dimNames = list(d.dimensionHeaders).map((h) => str(record(h).name))
    const metNames = list(d.metricHeaders).map((h) => str(record(h).name))
    const rows = list(d.rows).map((raw) => {
      const r = record(raw)
      const row: Record<string, unknown> = {}
      list(r.dimensionValues).forEach((v, i) => { row[dimNames[i] ?? `dim${i}`] = str(record(v).value) })
      list(r.metricValues).forEach((v, i) => { row[metNames[i] ?? `metric${i}`] = str(record(v).value) })
      return row
    })
    return { ok: true, summary: trim(`Report for properties/${propertyId} (${met} by ${dim}): ${rows.length} rows${rows.length ? `, first: ${JSON.stringify(rows[0])}` : ''}`), data: { propertyId, rowCount: num(d.rowCount), rows } }
  }),
  tool({
    name: 'ga_list_account_summaries',
    description: 'List Google Analytics accounts and their GA4 properties (admin accountSummaries).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${GA_ADMIN}/accountSummaries?pageSize=20`, { headers: bearer(cred) }))
    const items = list(d.accountSummaries)
    return { ok: true, summary: names('account summary', items, (a) => str(a.displayName) || str(a.name)), data: { accounts: items.slice(0, 20).map((raw) => { const a = record(raw); return { name: str(a.name), displayName: str(a.displayName), properties: list(a.propertySummaries).map((p) => str(record(p).name)) } }) } }
  }),
  tool({
    name: 'ga_list_metadata',
    description: 'List the dimensions and metrics available on a GA4 property (data API metadata).',
    permission: 'read-only',
    schema: { type: 'object', properties: { propertyId: { type: 'string', description: 'Defaults to config.propertyId.' } } },
  }, async (cred, config, args) => {
    const propertyId = gaPropertyId(config, args)
    const d = record(await apiJson(`${GA_DATA}/properties/${enc(propertyId)}/metadata`, { headers: bearer(cred) }))
    const dims = list(d.dimensions).map((x) => str(record(x).apiName))
    const mets = list(d.metrics).map((x) => str(record(x).apiName))
    return { ok: true, summary: `Schema for properties/${propertyId}: ${dims.length} dimensions, ${mets.length} metrics`, data: { dimensions: dims.slice(0, 30), metrics: mets.slice(0, 30) } }
  }),
]

// --- posthog (personal api key): REST, project id from config --------------

const POSTHOG = 'https://app.posthog.com'

function posthogProjectId(config: Record<string, string>): string {
  const id = (config.projectId ?? '').trim()
  if (!id) throw new Error('missing config.projectId (PostHog project id, the number in the project URL)')
  return id
}

const POSTHOG_TOOLS: ConnectorTool[] = [
  tool({
    name: 'posthog_list_projects',
    description: 'List the PostHog projects the API key can access.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${POSTHOG}/api/projects/`, { headers: bearer(cred) }))
    const items = list(d.results)
    return { ok: true, summary: names('project', items, (p) => `${str(p.name)} (#${num(p.id)})`), data: { projects: items.slice(0, 20).map((raw) => { const p = record(raw); return { id: num(p.id), name: str(p.name), organization: str(dig(p, 'organization', 'name')) } }) } }
  }),
  tool({
    name: 'posthog_list_insights',
    description: 'List the 10 most recent saved insights of a PostHog project.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const projectId = posthogProjectId(config)
    const d = record(await apiJson(`${POSTHOG}/api/projects/${enc(projectId)}/insights/?limit=10`, { headers: bearer(cred) }))
    const items = list(d.results)
    return { ok: true, summary: names('insight', items, (i) => str(i.name) || str(i.derived_name) || str(i.id)), data: { insights: items.slice(0, 10).map((raw) => { const i = record(raw); return { id: num(i.id), name: str(i.name), createdAt: str(i.created_at) } }) } }
  }),
  tool({
    name: 'posthog_list_events',
    description: 'List the 10 most recent captured events of a PostHog project.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const projectId = posthogProjectId(config)
    const d = record(await apiJson(`${POSTHOG}/api/projects/${enc(projectId)}/events/?limit=10`, { headers: bearer(cred) }))
    const items = list(d.results)
    return { ok: true, summary: `${items.length} events, latest: ${items.length ? str(record(items[0]).event) : 'none'}`, data: { events: items.slice(0, 10).map((raw) => { const e = record(raw); return { id: str(e.id), event: str(e.event), distinctId: str(e.distinct_id), timestamp: str(e.timestamp) } }) } }
  }),
]

// --- sentry (user auth token): REST API v0, org slug from config -----------

const SENTRY = 'https://sentry.io/api/0'

function sentryOrg(config: Record<string, string>): string {
  const org = (config.org ?? '').trim()
  if (!org) throw new Error('missing config.org (Sentry organization slug)')
  return org
}

const SENTRY_TOOLS: ConnectorTool[] = [
  tool({
    name: 'sentry_list_orgs',
    description: 'List the Sentry organizations the token can access.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const items = list(await apiJson(`${SENTRY}/organizations/`, { headers: bearer(cred) }))
    return { ok: true, summary: names('organization', items, (o) => str(o.slug)), data: { organizations: items.slice(0, 20).map((raw) => { const o = record(raw); return { id: num(o.id), slug: str(o.slug), name: str(o.name) } }) } }
  }),
  tool({
    name: 'sentry_list_issues',
    description: 'List the 10 most recent unresolved issues of a Sentry organization.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const org = sentryOrg(config)
    const items = list(await apiJson(`${SENTRY}/organizations/${enc(org)}/issues/?per_page=10&query=${enc('is:unresolved')}`, { headers: bearer(cred) }))
    return { ok: true, summary: names('unresolved issue', items, (i) => `${str(i.shortId) || str(i.id)} ${str(i.title)}`), data: { issues: items.slice(0, 10).map((raw) => { const i = record(raw); return { id: str(i.id), shortId: str(i.shortId), title: str(i.title), level: str(i.level), count: str(i.count), link: str(i.permalink) } }) } }
  }),
  tool({
    name: 'sentry_list_projects',
    description: 'List the projects of a Sentry organization.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const org = sentryOrg(config)
    const items = list(await apiJson(`${SENTRY}/organizations/${enc(org)}/projects/`, { headers: bearer(cred) }))
    return { ok: true, summary: names('project', items, (p) => str(p.slug)), data: { projects: items.slice(0, 20).map((raw) => { const p = record(raw); return { id: num(p.id), slug: str(p.slug), name: str(p.name) } }) } }
  }),
]

// --- algolia (admin api key, app id from config): Search API ---------------

function algoliaAppId(config: Record<string, string>): string {
  const appId = (config.appId ?? '').trim()
  if (!appId) throw new Error('missing config.appId (Algolia application id)')
  return appId
}

function algoliaHeaders(appId: string, cred: string): Record<string, string> {
  return { 'x-algolia-application-id': appId, 'x-algolia-api-key': cred }
}

const ALGOLIA_TOOLS: ConnectorTool[] = [
  tool({
    name: 'algolia_list_indices',
    description: 'List the Algolia indices of the application (write host, listIndexes).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred, config) => {
    const appId = algoliaAppId(config)
    const d = record(await apiJson(`https://${appId}.algolia.net/1/indexes?page=0`, { headers: algoliaHeaders(appId, cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('index', items, (i) => str(i.name)), data: { indices: items.slice(0, 20).map((raw) => { const i = record(raw); return { name: str(i.name), entries: num(i.entries), updatedAt: str(i.updatedAt) } }) } }
  }),
  tool({
    name: 'algolia_search',
    description: 'Search one Algolia index (search host, query endpoint with urlencoded params).',
    permission: 'read-only',
    schema: { type: 'object', properties: { indexName: { type: 'string' }, query: { type: 'string', description: 'Empty query lists the first hits.' } }, required: ['indexName'] },
  }, async (cred, config, args) => {
    const appId = algoliaAppId(config)
    const indexName = requireArg(args, 'indexName', 'index to search')
    const query = argStr(args, 'query')
    const d = record(await apiJson(`https://${appId}-dsn.algolia.net/1/indexes/${enc(indexName)}/query`, jsonInit('POST', { params: new URLSearchParams({ query, hitsPerPage: '10' }).toString() }, algoliaHeaders(appId, cred))))
    const hits = list(d.hits)
    return { ok: true, summary: `${num(d.nbHits)} hits for "${query}" in ${indexName}, showing ${hits.length}`, data: { nbHits: num(d.nbHits), hits: hits.slice(0, 10) } }
  }),
  tool({
    name: 'algolia_add_object',
    description: 'Add one object to an Algolia index (write host, auto-generated object id).',
    permission: 'write',
    schema: { type: 'object', properties: { indexName: { type: 'string' }, object: { type: 'object', description: 'The record to index.' } }, required: ['indexName', 'object'] },
  }, async (cred, config, args) => {
    const appId = algoliaAppId(config)
    const indexName = requireArg(args, 'indexName', 'target index')
    const object = record(args.object)
    if (!Object.keys(object).length) throw new Error('object must be a JSON object to index')
    const d = record(await apiJson(`https://${appId}.algolia.net/1/indexes/${enc(indexName)}`, jsonInit('POST', object, algoliaHeaders(appId, cred))))
    return { ok: true, summary: `Object saved to ${indexName} (objectID ${str(d.objectID)})`, data: { objectID: str(d.objectID), taskId: num(d.taskID) } }
  }),
]

// --- x (oauth2 access token): Twitter API v2 -------------------------------

const X_API = 'https://api.twitter.com/2'

const X_TOOLS: ConnectorTool[] = [
  tool({
    name: 'x_get_me',
    description: 'Get the authenticated X user (users/me).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const me = record(record(await apiJson(`${X_API}/users/me`, { headers: bearer(cred) })).data)
    if (!me.id) throw new Error('unexpected users/me response')
    return { ok: true, summary: `Authenticated as @${str(me.username)} (${str(me.name)})`, data: { id: str(me.id), name: str(me.name), username: str(me.username) } }
  }),
  tool({
    name: 'x_post_tweet',
    description: 'Post a tweet as the authenticated X user (max 280 characters).',
    permission: 'write',
    schema: { type: 'object', properties: { text: { type: 'string', description: 'Tweet text, max 280 characters.' } }, required: ['text'] },
  }, async (cred, _config, args) => {
    const text = requireArg(args, 'text', 'tweet text (max 280 characters)')
    if (text.length > 280) throw new Error(`tweet text is ${text.length} characters, the limit is 280`)
    const d = record(await apiJson(`${X_API}/tweets`, jsonInit('POST', { text }, bearer(cred))))
    return { ok: true, summary: trim(`Tweet posted: "${text}"`), data: { tweetId: str(record(d.data).id) } }
  }),
  tool({
    name: 'x_search_recent',
    description: 'Search recent X tweets from the last 7 days (query supports the X operators).',
    permission: 'read-only',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }, async (cred, _config, args) => {
    const query = requireArg(args, 'query', 'search query, supports X query operators')
    const d = record(await apiJson(`${X_API}/tweets/search/recent?query=${enc(query)}&max_results=10`, { headers: bearer(cred) }))
    const items = list(d.data)
    return { ok: true, summary: `${num(dig(d, 'meta', 'result_count'))} recent tweets for "${query}"`, data: { tweets: items.slice(0, 10).map((raw) => { const t = record(raw); return { id: str(t.id), authorId: str(t.author_id), text: str(t.text).slice(0, 200) } }) } }
  }),
]

// --- linkedin (oauth2 access token): userinfo + versioned Posts API --------

const LINKEDIN_VERSION = '202405'

function linkedinRestHeaders(cred: string): Record<string, string> {
  return { ...bearer(cred), 'linkedin-version': LINKEDIN_VERSION, 'x-restli-protocol-version': '2.0.0' }
}

async function linkedinSub(cred: string, timeoutMs: number = TOOL_TIMEOUT): Promise<string> {
  const d = record(await apiJson('https://api.linkedin.com/v2/userinfo', { headers: bearer(cred) }, timeoutMs))
  const sub = str(d.sub)
  if (!sub) throw new Error('unexpected userinfo response: no sub claim')
  return sub
}

const LINKEDIN_TOOLS: ConnectorTool[] = [
  tool({
    name: 'linkedin_get_me',
    description: 'Get the authenticated LinkedIn member (OpenID Connect userinfo).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson('https://api.linkedin.com/v2/userinfo', { headers: bearer(cred) }))
    return { ok: true, summary: `LinkedIn member ${str(d.name)} (sub ${str(d.sub)})`, data: { sub: str(d.sub), name: str(d.name), givenName: str(d.given_name), familyName: str(d.family_name), email: str(d.email), locale: str(dig(d, 'locale', 'language')) } }
  }),
  tool({
    name: 'linkedin_create_post',
    description: 'Create a LinkedIn feed post as the authenticated member (versioned Posts API).',
    permission: 'write',
    schema: { type: 'object', properties: { text: { type: 'string', description: 'Post commentary text.' }, visibility: { type: 'string', enum: ['PUBLIC', 'CONNECTIONS', 'LOGGED_IN'] } }, required: ['text'] },
  }, async (cred, _config, args) => {
    const text = requireArg(args, 'text', 'post commentary text')
    const visibility = argStr(args, 'visibility') || 'PUBLIC'
    const sub = await linkedinSub(cred) // the author urn needs the member sub claim
    const body = { author: `urn:li:person:${sub}`, commentary: text, visibility, distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED' }
    const res = await apiRaw('https://api.linkedin.com/rest/posts', jsonInit('POST', body, linkedinRestHeaders(cred)))
    const postId = res.headers.get('x-restli-id') ?? str(record(res.json).id)
    return { ok: true, summary: trim(`LinkedIn post created${postId ? ` (id ${postId})` : ''}: "${text}"`), data: { postId } }
  }),
  tool({
    name: 'linkedin_list_my_posts',
    description: 'List recent feed posts authored by the authenticated LinkedIn member.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const sub = await linkedinSub(cred)
    const d = record(await apiJson(`https://api.linkedin.com/rest/posts?q=author&author=${enc(`urn:li:person:${sub}`)}`, { headers: linkedinRestHeaders(cred) }))
    const items = list(d.elements)
    return { ok: true, summary: `${items.length} posts by the authenticated member`, data: { posts: items.slice(0, 10).map((raw) => { const p = record(raw); return { id: str(p.id), commentary: str(p.commentary).slice(0, 200), createdAt: num(p.createdAt) } }) } }
  }),
]

// --- youtube (oauth2 access token): Data API v3 ----------------------------

const YT = 'https://www.googleapis.com/youtube/v3'

const YOUTUBE_TOOLS: ConnectorTool[] = [
  tool({
    name: 'youtube_list_channels',
    description: 'List the YouTube channels of the authenticated user with snippet and statistics.',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const d = record(await apiJson(`${YT}/channels?part=snippet,statistics&mine=true`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('channel', items, (c) => str(record(c.snippet).title)), data: { channels: items.slice(0, 10).map((raw) => { const c = record(raw); return { id: str(c.id), title: str(record(c.snippet).title), subscribers: num(dig(c, 'statistics', 'subscriberCount')), videos: num(dig(c, 'statistics', 'videoCount')) } }) } }
  }),
  tool({
    name: 'youtube_search',
    description: 'Search YouTube videos (search.list, type=video).',
    permission: 'read-only',
    schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  }, async (cred, _config, args) => {
    const query = requireArg(args, 'query', 'search string')
    const d = record(await apiJson(`${YT}/search?part=snippet&type=video&q=${enc(query)}&maxResults=10`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('video result', items, (r) => str(dig(r, 'snippet', 'title'))), data: { videos: items.slice(0, 10).map((raw) => { const r = record(raw); return { videoId: str(dig(r, 'id', 'videoId')), title: str(dig(r, 'snippet', 'title')), channel: str(dig(r, 'snippet', 'channelTitle')) } }) } }
  }),
  tool({
    name: 'youtube_list_playlistitems',
    description: 'List the first 10 videos of a YouTube playlist (playlistItems.list).',
    permission: 'read-only',
    schema: { type: 'object', properties: { playlistId: { type: 'string', description: 'Playlist id, e.g. the uploads playlist id.' } }, required: ['playlistId'] },
  }, async (cred, _config, args) => {
    const playlistId = requireArg(args, 'playlistId', 'playlist id')
    const d = record(await apiJson(`${YT}/playlistItems?part=snippet&maxResults=10&playlistId=${enc(playlistId)}`, { headers: bearer(cred) }))
    const items = list(d.items)
    return { ok: true, summary: names('playlist item', items, (r) => str(dig(r, 'snippet', 'title'))), data: { items: items.slice(0, 10).map((raw) => { const r = record(raw); return { videoId: str(dig(r, 'snippet', 'resourceId', 'videoId')), title: str(dig(r, 'snippet', 'title')) } }) } }
  }),
]

// --- telegram (bot token in the path, by API design): Bot API --------------

function tgUrl(cred: string, method: string): string {
  return `https://api.telegram.org/bot${cred}/${method}`
}

function tgOk(json: unknown): unknown {
  const d = record(json)
  if (d.ok !== true) throw new Error(`telegram API error: ${str(d.description) || 'unknown'}`)
  return d.result
}

const TELEGRAM_TOOLS: ConnectorTool[] = [
  tool({
    name: 'telegram_get_me',
    description: 'Get the Telegram bot identity (getMe).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const me = record(tgOk(await apiJson(tgUrl(cred, 'getMe'))))
    return { ok: true, summary: `Bot @${str(me.username)} (${str(me.first_name)})`, data: { id: num(me.id), username: str(me.username), name: str(me.first_name) } }
  }),
  tool({
    name: 'telegram_send_message',
    description: 'Send a text message to a Telegram chat (sendMessage via GET, as the Bot API allows).',
    permission: 'write',
    schema: { type: 'object', properties: { chatId: { type: 'string', description: 'Chat id (number) or @channelusername.' }, text: { type: 'string' }, parseMode: { type: 'string', enum: ['HTML', 'MarkdownV2', 'Markdown'] } }, required: ['chatId', 'text'] },
  }, async (cred, _config, args) => {
    const chatId = requireArg(args, 'chatId', 'chat id (number) or @channelusername')
    const text = requireArg(args, 'text', 'message text')
    const qs = new URLSearchParams({ chat_id: chatId, text })
    const parseMode = argStr(args, 'parseMode')
    if (parseMode) qs.set('parse_mode', parseMode)
    const m = record(tgOk(await apiJson(`${tgUrl(cred, 'sendMessage')}?${qs}`)))
    return { ok: true, summary: trim(`Message sent to ${chatId}: "${text}"`), data: { messageId: num(m.message_id), chatId: str(dig(m, 'chat', 'id')) } }
  }),
  tool({
    name: 'telegram_get_updates',
    description: 'Get the latest pending updates sent to the Telegram bot (getUpdates).',
    permission: 'read-only',
    schema: { type: 'object' },
  }, async (cred) => {
    const items = list(tgOk(await apiJson(`${tgUrl(cred, 'getUpdates')}?limit=10`)))
    return { ok: true, summary: `${items.length} pending updates`, data: { updates: items.slice(0, 10).map((raw) => { const u = record(raw); const msg = record(u.message); return { updateId: num(u.update_id), from: str(dig(msg, 'from', 'username')), text: str(msg.text).slice(0, 200) } }) } }
  }),
]

// --- health checks: one fast authenticated call per built connector --------

type HealthFn = (cred: string, config: Record<string, string>) => Promise<void>

const HEALTH: Record<string, HealthFn> = {
  // GET /user proves the token and returns the login
  github: async (cred) => {
    const d = record(await apiJson('https://api.github.com/user', { headers: ghHeaders(cred) }, HEALTH_TIMEOUT))
    if (!d.login) throw new Error('unexpected /user response: no login field')
  },
  // POST auth.test: cheap, purpose-built token check; slack answers 200 ok:false on failure
  slack: async (cred) => {
    const d = slackOk(await apiJson('https://slack.com/api/auth.test', { method: 'POST', headers: bearer(cred), body: '{}' }, HEALTH_TIMEOUT))
    if (!d.user_id && !d.user) throw new Error('unexpected auth.test response')
  },
  // GET about?fields=user proves the oauth token and its drive scope
  'google-drive': async (cred) => {
    const d = record(await apiJson(`${DRIVE}/about?fields=user`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!str(dig(d, 'user', 'emailAddress'))) throw new Error('unexpected about response: no user.emailAddress')
  },
  // GET users/me proves the integration token and its notion-version
  notion: async (cred) => {
    const d = record(await apiJson(`${NOTION}/users/me`, { headers: notionHeaders(cred) }, HEALTH_TIMEOUT))
    if (d.object !== 'user') throw new Error('unexpected users/me response: check the integration token')
  },
  gitlab: async (cred) => {
    const d = record(await apiJson(`${GITLAB}/user`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!d.username) throw new Error('unexpected /user response: no username field')
  },
  discord: async (cred) => {
    const d = record(await apiJson(`${DISCORD}/users/@me`, { headers: botHeaders(cred) }, HEALTH_TIMEOUT))
    if (!d.id) throw new Error('unexpected bot user response')
  },
  gmail: async (cred) => {
    const d = record(await apiJson(`${GMAIL}/users/me/profile`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (d.historyId === undefined && d.messagesTotal === undefined) throw new Error('unexpected profile response')
  },
  'google-calendar': async (cred) => {
    const d = record(await apiJson(`${GCAL}/users/me/calendarList?maxResults=1`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!Array.isArray(d.items)) throw new Error('unexpected calendarList response')
  },
  stripe: async (cred) => {
    const d = record(await apiJson(`${STRIPE}/charges?limit=1`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (d.object !== 'list') throw new Error('unexpected charges response')
  },
  shopify: async (cred, config) => {
    const s = record(record(await apiJson(`${shopBase(config)}/shop.json`, { headers: shopHeaders(cred) }, HEALTH_TIMEOUT)).shop)
    if (!s.id && !s.name) throw new Error('unexpected shop response: check the token and config.storeUrl')
  },
  wordpress: async (cred, config) => {
    const d = record(await apiJson(`${wpBase(config)}/users/me`, { headers: wpHeaders(cred) }, HEALTH_TIMEOUT))
    if (d.id === undefined) throw new Error('unexpected users/me response: check the user:application-password credential')
  },
  contentful: async (cred) => {
    const d = record(await apiJson(`${CONTENTFUL}/spaces?limit=1`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (d.total === undefined && !Array.isArray(d.items)) throw new Error('unexpected spaces response')
  },
  // runReport would be heavy; accountSummaries is the light authenticated probe
  'google-analytics': async (cred) => {
    await apiJson(`${GA_ADMIN}/accountSummaries?pageSize=1`, { headers: bearer(cred) }, HEALTH_TIMEOUT)
  },
  posthog: async (cred) => {
    const d = record(await apiJson(`${POSTHOG}/api/users/@me/`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!d.distinct_id && !d.email) throw new Error('unexpected @me response')
  },
  sentry: async (cred) => {
    if (!Array.isArray(await apiJson(`${SENTRY}/organizations/`, { headers: bearer(cred) }, HEALTH_TIMEOUT))) throw new Error('unexpected organizations response')
  },
  algolia: async (cred, config) => {
    const appId = algoliaAppId(config)
    const d = record(await apiJson(`https://${appId}.algolia.net/1/indexes?page=0`, { headers: algoliaHeaders(appId, cred) }, HEALTH_TIMEOUT))
    if (!Array.isArray(d.items)) throw new Error('unexpected indexes response: check config.appId and the admin key')
  },
  x: async (cred) => {
    const d = record(await apiJson(`${X_API}/users/me`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!str(record(d.data).id)) throw new Error('unexpected users/me response')
  },
  linkedin: async (cred) => {
    await linkedinSub(cred, HEALTH_TIMEOUT)
  },
  youtube: async (cred) => {
    const d = record(await apiJson(`${YT}/channels?part=snippet&mine=true`, { headers: bearer(cred) }, HEALTH_TIMEOUT))
    if (!Array.isArray(d.items)) throw new Error('unexpected channels response')
  },
  telegram: async (cred) => {
    const me = record(tgOk(await apiJson(tgUrl(cred, 'getMe'), {}, HEALTH_TIMEOUT)))
    if (!me.username) throw new Error('unexpected getMe response: check the bot token')
  },
}

// --- public API ------------------------------------------------------------

const TOOLS_BY_CONNECTOR: Record<string, ConnectorTool[]> = {
  github: GITHUB_TOOLS,
  slack: SLACK_TOOLS,
  'google-drive': DRIVE_TOOLS,
  notion: NOTION_TOOLS,
  gitlab: GITLAB_TOOLS,
  discord: DISCORD_TOOLS,
  gmail: GMAIL_TOOLS,
  'google-calendar': GCAL_TOOLS,
  stripe: STRIPE_TOOLS,
  shopify: SHOPIFY_TOOLS,
  wordpress: WORDPRESS_TOOLS,
  contentful: CONTENTFUL_TOOLS,
  'google-analytics': GA_TOOLS,
  posthog: POSTHOG_TOOLS,
  sentry: SENTRY_TOOLS,
  algolia: ALGOLIA_TOOLS,
  x: X_TOOLS,
  linkedin: LINKEDIN_TOOLS,
  youtube: YOUTUBE_TOOLS,
  telegram: TELEGRAM_TOOLS,
}

export function toolsForConnector(connectorId: string): ConnectorTool[] {
  const def = CONNECTOR_CATALOG.find((c) => c.id === connectorId)
  if (!def || !def.built) return [] // definition-only connectors ship no tools
  return TOOLS_BY_CONNECTOR[connectorId] ?? []
}

export async function connectorHealth(connectorId: string, cred: string, config: Record<string, string> = {}): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const def = CONNECTOR_CATALOG.find((c) => c.id === connectorId)
  const fn = def?.built ? HEALTH[connectorId] : undefined
  if (!fn) return { ok: false, latencyMs: 0, error: 'connector not yet implemented: definition only' }
  const key = (cred ?? '').trim()
  if (!key) return { ok: false, latencyMs: 0, error: 'no credential stored for this connector' }
  const started = Date.now()
  try {
    await fn(key, config ?? {})
    return { ok: true, latencyMs: Date.now() - started }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - started, error: redact(e instanceof Error ? e.message : String(e), key) }
  }
}
