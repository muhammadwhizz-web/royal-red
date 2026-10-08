// ROYAL RED provider matrix — canonical types.
//
// Every operation in Royal Red is expressed as a CAPABILITY REQUEST, never a
// hardcoded provider call. The router picks the provider; adapters speak to
// providers. Canonical message format is OpenAI chat — every adapter
// translates, nothing provider-specific leaks between layers.

export type Modality = 'chat' | 'vision' | 'image' | 'audio' | 'search' | 'embedding' | 'video' | 'rerank'

export type QualityTier = 'small' | 'mid' | 'frontier'

export type AdapterProtocol =
  | 'openai-compat' // openai, groq, together, fireworks, openrouter, deepseek, xai, mistral, ollama, vllm, lmstudio, localai, ...
  | 'anthropic'
  | 'google' // Gemini via its OpenAI-compat surface
  | 'google-native' // Gemini AI Studio v1beta generateContent (native)
  | 'cohere-native' // Cohere v2 chat / v2 embed / v1 rerank (native)
  | 'cloudflare' // Cloudflare Workers AI /ai/run REST (native)
  | 'a1111' // AUTOMATIC1111 /sdapi/v1 (local image appliance)
  | 'search-rest' // tavily / brave / serper / exa POST conventions
  | 'none' // registry entry only, execution adapter not built (fail closed)

// Canonical chat message (OpenAI format). Adapters translate FROM this.
export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: CanonicalToolCall[]
  tool_call_id?: string
  name?: string
}

export interface CanonicalToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface CanonicalToolDef {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

// ---------- capability request / decision ----------

export interface RoutingPolicy {
  allowPaid: boolean
  maxCostUsd: number
  preferLocal: boolean
  allowedProviders?: string[]
  deniedProviders?: string[]
}

export const DEFAULT_POLICY: RoutingPolicy = {
  allowPaid: true,
  maxCostUsd: 0.5,
  preferLocal: false,
}

export interface CapabilityRequest {
  modality: Modality
  operation: string // e.g. 'flashcards.generate'
  messages?: CanonicalMessage[]
  tools?: CanonicalToolDef[]
  prompt?: string // image/audio single-shot
  imageUrl?: string // vision attachment (data or https url)
  query?: string // search
  maxTokens?: number
  temperature?: number
  minTier?: QualityTier
  policy?: Partial<RoutingPolicy>
  stream?: boolean
  /** test seam: replace the live adapter set (no network in unit tests) */
  adaptersOverride?: Record<string, Adapter>
  /** test seam: override health/breaker view */
  breakerOverride?: Record<string, boolean>
}

export interface RouteCandidate {
  providerId: string
  model: string
  estimatedCostUsd: number
  tier: QualityTier
  local: boolean
  reason: string
  blocked?: string // why this candidate would not run (dry-run transparency)
}

export interface RouteDecision {
  operation: string
  modality: Modality
  chosen: RouteCandidate | null
  candidates: RouteCandidate[]
  dryRun: boolean
  policy: RoutingPolicy
  notes: string[]
}

export interface UsageReport {
  tokensIn: number
  tokensOut: number
  costUsd: number
}

export interface AdapterResult {
  ok: boolean
  text?: string
  toolCalls?: CanonicalToolCall[]
  usage?: UsageReport
  finishReason?: string
  error?: string
  latencyMs: number
  providerId: string
  model: string
  /** set when a stream dropped mid-response and partial text was captured */
  partial?: boolean
}

export interface Adapter {
  protocol: AdapterProtocol
  /** execute a chat-shaped capability request against one provider */
  call(req: CapabilityRequest, p: ProviderDef, apiKey: string | null): Promise<AdapterResult>
  /** stream variant; may throw MidStreamDrop with partial text attached */
  stream?(req: CapabilityRequest, p: ProviderDef, apiKey: string | null, onDelta: (t: string) => void): Promise<AdapterResult>
}

export class MidStreamDrop extends Error {
  constructor(public partialText: string, public providerId: string) {
    super(`stream dropped mid-response on ${providerId}`)
  }
}

// ---------- provider definition (the matrix rows) ----------

export interface ProviderDef {
  id: string
  label: string
  protocol: AdapterProtocol
  modalities: Modality[] // which modalities this provider serves
  baseUrl: string
  /** default model id used when the request doesn't pin one */
  model: string
  tier: QualityTier
  local: boolean
  /** per-1M-unit prices in USD — approximate public list prices, editable */
  cost: {
    chatIn?: number
    chatOut?: number
    image?: number // per image
    audio?: number // per 1k chars
    search?: number // per call
    embedding?: number // per 1M tokens
    video?: number // per second
    rerank?: number // per 1k queries
  }
  priceNote?: string
  /** env var name checked when no BYO key is stored for this provider */
  envKey?: string
  requiresKey: boolean
  supportsTools?: boolean
  supportsStreaming?: boolean
  /** honest endpoint note: shown in Settings when the URL needs user setup */
  endpointNote?: string
  /** provider publishes a usable free tier (router: free-tier preference) */
  freeTier?: boolean
  /** hosting region the provider itself constrains (router: region-aware) */
  region?: 'eu' | 'us' | 'any'
  /** config key in the RoyalRedProviderConfig table this provider binds to */
  credProviderId?: string
}
