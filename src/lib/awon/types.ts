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
  // Phase 4 - the 13 permitted desktop primitives (kernel enforces the tiers)
  | { name: 'box_list'; args: { path?: string } }
  | { name: 'box_read'; args: { path: string } }
  | { name: 'box_plan'; args: { kind?: string; path?: string; ops?: unknown[] } }
  | { name: 'box_write'; args: { path: string; content: string } }
  | { name: 'box_mkdir'; args: { path: string } }
  | { name: 'box_move'; args: { items?: { from: string; to: string }[]; from?: string; to?: string } }
  | { name: 'box_copy'; args: { items?: { from: string; to: string }[]; from?: string; to?: string } }
  | { name: 'box_trash'; args: { path?: string; paths?: string[] } }
  | { name: 'box_undo'; args: { runId?: string } }
  | { name: 'shell_exec'; args: { command: string } }
  | { name: 'screen_shot'; args: { analyze?: boolean } }
  | { name: 'screen_click'; args: { x?: number; y?: number } }
  | { name: 'screen_type'; args: { text?: string } }

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
  // Phase 4 - permitted PC control
  | { type: 'consent_request'; id: string; tier: number; title: string; detail?: string; payload?: unknown; createdAt: string; expiresAt: string }
  | { type: 'consent_result'; id: string; status: string }
  | { type: 'desktop_plan'; planId: string; toolName: string; summary: { total: number; proposable: number; refused: number; flagged: number; byClass: Record<string, number>; bytes: number }; steps: unknown[] }
  | { type: 'desktop_step'; runId: string; seq: number; op: string; detail: string; ok: boolean }
  | { type: 'desktop_run'; runId: string; status: string; total: number; executed?: number }
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
  // Phase 4: a kernel consent request rendered as an interactive card
  | {
      kind: 'consent'
      id: string // consent id (con_...)
      tier: number
      title: string
      detail?: string
      payload?: ConsentPayload
      status: 'pending' | 'approved' | 'denied' | 'expired' | 'frozen'
      decision?: string
      expiresAt?: string
    }

// the payload shapes the consent card knows how to render
export interface ConsentPayload {
  kind: 'plan' | 'single' | 'shell' | 'undo' | 'list' | 'read' | 'screen_shot'
  plan?: {
    planId: string
    summary: { total: number; proposable: number; refused: number; flagged: number; byClass: Record<string, number>; bytes: number }
    steps: {
      seq: number
      op: string
      from: string
      to: string
      class?: string
      flagged?: boolean
      reason?: string
      proposable: boolean
    }[]
  }
  step?: { seq: number; op: string; from: string; to: string; class?: string; flagged?: boolean; reason?: string }
  steps?: string[]
  command?: string
  op?: string
  path?: string
}

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
  // Phase 4 desktop primitives
  box_list: 'box list',
  box_read: 'box read',
  box_plan: 'dry-run plan',
  box_write: 'box write',
  box_mkdir: 'box mkdir',
  box_move: 'box move',
  box_copy: 'box copy',
  box_trash: 'box trash',
  box_undo: 'undo run',
  shell_exec: 'box shell',
  screen_shot: 'screen shot',
  screen_click: 'screen click',
  screen_type: 'screen type',
}

export function isMode(v: string): v is AwonMode {
  return v === 'build' || v === 'research' || v === 'pc' || v === 'ask'
}
