// AWON core shared types (client + server)

export type AwonMode = 'build' | 'research' | 'pc' | 'ask'

export interface PlanItem {
  id: string
  title: string
  done: boolean
}

export interface ArtifactFile {
  path: string
  content: string
}

export interface ArtifactPayload {
  name: string
  kind?: 'site' | 'app' | 'file'
  entry?: string
  files: ArtifactFile[]
}

export interface Directive {
  say?: string
  plan?: PlanItem[]
  tools?: ToolRequest[]
  artifact?: ArtifactPayload
  score?: number
  review?: string
  file_chunk?: { path: string; content: string; done?: boolean }
}

export type ToolRequest =
  | { name: 'web_search'; args: { query: string; num?: number } }
  | { name: 'read_file'; args: { path: string } }
  | { name: 'write_file'; args: { path: string; content: string } }
  | { name: 'list_files'; args: Record<string, never> }
  | { name: 'shell'; args: { command: string } }
  | { name: 'system_report'; args: Record<string, never> }
  | { name: 'create_account'; args: { username: string; role?: string; note?: string } }
  | { name: 'remove_account'; args: { username: string } }
  | { name: 'list_accounts'; args: Record<string, never> }
  | { name: 'generate_image'; args: { prompt: string; path?: string; size?: string } }
  | { name: 'analyze_image'; args: { path?: string; url?: string; question?: string } }
  | { name: 'analyze_video'; args: { url?: string; path?: string; question?: string } }
  | { name: 'read_page'; args: { url: string } }

// constraint ledger item as streamed to the console before a build starts
export interface LedgerItemView {
  cid: string
  category: string
  text: string
  assertion: string
  weight: number
}

// when a tool mutates an artifact (e.g. image gen), the agent emits a fresh artifact event
export interface ArtifactPatch {
  id: string
  name: string
  entry: string
  files: string[]
  created?: boolean
}

export type ToolOutcome = {
  name: string
  ok: boolean
  summary: string
  detail?: string
  artifactPatch?: ArtifactPatch
}

// SSE event wire format
export type AwonSseEvent =
  | { type: 'phase'; value: string }
  | { type: 'mode'; value: AwonMode }
  | { type: 'say'; text: string }
  | { type: 'plan'; plan: PlanItem[] }
  | { type: 'tool_start'; name: string; label: string }
  | { type: 'tool_end'; name: string; ok: boolean; summary: string; output?: string }
  | {
      type: 'artifact'
      id: string
      name: string
      entry: string
      files: string[]
      score?: number
      review?: string
    }
  | { type: 'session'; id: string; title: string }
  | { type: 'constraints'; items: LedgerItemView[] }
  | { type: 'verify'; kind: string; status: string; summary?: string; data?: unknown }
  | { type: 'error'; message: string }
  | { type: 'done' }

// UI chat items
export type ChatItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; fresh?: boolean }
  | {
      kind: 'event'
      id: string
      label: string
      detail?: string
      output?: string
      status: 'run' | 'ok' | 'err'
    }
  | { kind: 'phase'; id: string; value: string }

export interface ArtifactView {
  id: string
  name: string
  entry: string
  files: { path: string; content: string }[]
  score?: number
  review?: string
}

export interface SessionSummary {
  id: string
  title: string
  mode: string
  pinned?: boolean
  updatedAt: string
}

export const MODE_LABELS: Record<AwonMode, string> = {
  build: 'BUILDER',
  research: 'RESEARCH',
  pc: 'SYSTEM',
  ask: 'ASSIST',
}

// human labels for tool event rows (client + server shared)
export const TOOL_LABELS: Record<string, string> = {
  web_search: 'web search',
  read_file: 'read file',
  write_file: 'write file',
  list_files: 'list files',
  shell: 'shell',
  system_report: 'system report',
  create_account: 'create account',
  remove_account: 'remove account',
  list_accounts: 'list accounts',
  generate_image: 'image gen',
  analyze_image: 'vision check',
  analyze_video: 'video watch',
  read_page: 'page read',
}

export function isMode(v: string): v is AwonMode {
  return v === 'build' || v === 'research' || v === 'pc' || v === 'ask'
}
