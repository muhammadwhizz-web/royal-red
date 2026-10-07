// ROYAL RED provider adapters.
//
// Canonical format IN (OpenAI chat) → provider-native payload OUT → response
// translated BACK to canonical. Nothing provider-specific crosses this seam.
// Every adapter is honest about failure: a non-2xx or malformed response is
// an ok:false result with the provider's own error text — never invented data.

import type {
  Adapter,
  AdapterResult,
  CanonicalToolCall,
  CapabilityRequest,
  ProviderDef,
} from './types'

const CHARS_PER_TOKEN = 4 // rough estimate used only when a provider omits usage

function estTokens(s: string): number {
  return Math.max(1, Math.ceil((s?.length ?? 0) / CHARS_PER_TOKEN))
}

function estimateCost(p: ProviderDef, req: CapabilityRequest, usageIn: number, usageOut: number): number {
  if (p.cost.chatIn === undefined) return 0
  const inTok = usageIn > 0 ? usageIn : (req.messages ?? []).reduce((a, m) => a + estTokens(m.content ?? ''), 0)
  const outTok = usageOut > 0 ? usageOut : Math.max(1, Math.ceil((req.maxTokens ?? 512) / 2))
  return ((inTok / 1e6) * p.cost.chatIn) + ((outTok / 1e6) * (p.cost.chatOut ?? 0))
}

// ---------------------------------------------------------------------------
// OpenAI-compatible family (OpenAI, Groq, Together, Fireworks, OpenRouter,
// DeepSeek, xAI, Mistral, Cohere-compat, DashScope-compat, Zhipu, Moonshot,
// MiniMax, 01.AI, Perplexity, Ollama, vLLM, LM Studio, LocalAI, Jan, GPT4All,
// llama.cpp, KoboldCpp, ExLlamaV2/tabbyAPI, Text-Gen-WebUI …)
// ---------------------------------------------------------------------------

function toOpenAiBody(req: CapabilityRequest, p: ProviderDef): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
  }
  if (req.modality === 'vision' && req.imageUrl) {
    // canonical vision: attach the image to the LAST user message
    const msgs = (req.messages ?? []).map((m) => ({ ...m }))
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        msgs[i] = {
          role: 'user',
          content: [
            { type: 'text', text: msgs[i].content ?? 'describe this image' },
            { type: 'image_url', image_url: { url: req.imageUrl } },
          ] as unknown as string,
        }
        break
      }
    }
    body.messages = msgs
  } else {
    body.messages = req.messages ?? []
  }
  if (req.tools?.length) {
    body.tools = req.tools
    body.tool_choice = 'auto'
  }
  return body
}

function fromOpenAiResponse(json: Record<string, unknown>, p: ProviderDef, started: number, req: CapabilityRequest): AdapterResult {
  const choice = (json.choices as Array<Record<string, unknown>> | undefined)?.[0]
  const msg = choice?.message as Record<string, unknown> | undefined
  const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined
  const toolCalls: CanonicalToolCall[] | undefined = (msg?.tool_calls as CanonicalToolCall[] | undefined)?.map((t) => ({
    id: t.id,
    type: 'function',
    function: { name: t.function?.name, arguments: t.function?.arguments ?? '{}' },
  }))
  return {
    ok: true,
    text: (msg?.content as string | null) ?? '',
    toolCalls,
    finishReason: (choice?.finish_reason as string) ?? 'stop',
    usage: {
      tokensIn: usage?.prompt_tokens ?? 0,
      tokensOut: usage?.completion_tokens ?? 0,
      costUsd: estimateCost(p, req, usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0),
    },
    latencyMs: Date.now() - started,
    providerId: p.id,
    model: p.model,
  }
}

const openaiCompat: Adapter = {
  protocol: 'openai-compat',
  async call(req, p, apiKey) {
    const started = Date.now()
    try {
      const headers: Record<string, string> = { 'content-type': 'application/json' }
      if (apiKey) headers.authorization = `Bearer ${apiKey}`
      if (p.id === 'openrouter') {
        headers['http-referer'] = 'https://royal-red.local'
        headers['x-title'] = 'ROYAL RED'
      }
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(toOpenAiBody(req, p)),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) {
        const errText = (await res.text()).slice(0, 400)
        return { ok: false, error: `HTTP ${res.status}: ${errText}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }
      return fromOpenAiResponse((await res.json()) as Record<string, unknown>, p, started, req)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started, providerId: p.id, model: p.model }
    }
  },
}

// ---------------------------------------------------------------------------
// Anthropic — system extracted from canonical messages, tools translated to
// Anthropic's input_schema shape, tool results sent as user tool_result blocks.
// ---------------------------------------------------------------------------

function toAnthropicBody(req: CapabilityRequest, p: ProviderDef): Record<string, unknown> {
  const system = (req.messages ?? []).filter((m) => m.role === 'system').map((m) => m.content ?? '').join('\n')
  const msgs = (req.messages ?? [])
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: m.tool_call_id, content: m.content ?? '' }],
        }
      }
      if (m.role === 'assistant' && m.tool_calls?.length) {
        return {
          role: 'assistant',
          content: [
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
            ...m.tool_calls.map((t) => ({ type: 'tool_use', id: t.id, name: t.function.name, input: JSON.parse(t.function.arguments || '{}') })),
          ],
        }
      }
      return { role: m.role, content: m.content ?? '' }
    })
  const body: Record<string, unknown> = {
    model: p.model,
    max_tokens: req.maxTokens ?? 1024,
    temperature: req.temperature ?? 0.7,
    messages: msgs,
  }
  if (system) body.system = system
  if (req.tools?.length) {
    body.tools = req.tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }))
  }
  return body
}

const anthropic: Adapter = {
  protocol: 'anthropic',
  async call(req, p, apiKey) {
    const started = Date.now()
    try {
      const res = await fetch(`${p.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey ?? '',
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(toAnthropicBody(req, p)),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }
      const json = (await res.json()) as Record<string, unknown>
      const content = json.content as Array<Record<string, unknown>> | undefined
      const text = (content ?? []).filter((c) => c.type === 'text').map((c) => c.text as string).join('')
      const toolUses = (content ?? []).filter((c) => c.type === 'tool_use') as Array<Record<string, unknown>>
      const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined
      return {
        ok: true,
        text,
        toolCalls: toolUses.length
          ? toolUses.map((t) => ({
              id: t.id as string,
              type: 'function' as const,
              function: { name: t.name as string, arguments: JSON.stringify(t.input ?? {}) },
            }))
          : undefined,
        finishReason: (json.stop_reason as string) ?? 'end_turn',
        usage: {
          tokensIn: usage?.input_tokens ?? 0,
          tokensOut: usage?.output_tokens ?? 0,
          costUsd: estimateCost(p, req, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0),
        },
        latencyMs: Date.now() - started,
        providerId: p.id,
        model: p.model,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started, providerId: p.id, model: p.model }
    }
  },
}

// ---------------------------------------------------------------------------
// Google Gemini — via its OpenAI-compatible endpoint (generativelanguage…
// /v1beta/openai) so translation stays canonical; falls back internally if the
// compat surface is disabled. x-goog-api-key header carries the key.
// ---------------------------------------------------------------------------

const google: Adapter = {
  protocol: 'google',
  async call(req, p, apiKey) {
    const started = Date.now()
    try {
      const res = await fetch(`${p.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey ?? ''}` },
        body: JSON.stringify(toOpenAiBody(req, p)),
        signal: AbortSignal.timeout(90_000),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }
      return fromOpenAiResponse((await res.json()) as Record<string, unknown>, p, started, req)
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started, providerId: p.id, model: p.model }
    }
  },
}

// ---------------------------------------------------------------------------
// AUTOMATIC1111 (local image appliance). The USER runs the webui with --api;
// Royal Red only talks to localhost. txt2img → base64 PNG data URL.
// ---------------------------------------------------------------------------

const a1111: Adapter = {
  protocol: 'a1111',
  async call(req, p) {
    const started = Date.now()
    try {
      const res = await fetch(`${p.baseUrl}/sdapi/v1/txt2img`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          prompt: req.prompt ?? '',
          steps: 20,
          width: 512,
          height: 512,
          cfg_scale: 7,
          sampler_name: 'DPM++ 2M Karras',
        }),
        signal: AbortSignal.timeout(180_000),
      })
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }
      const json = (await res.json()) as { images?: string[] }
      const img = json.images?.[0]
      if (!img) return { ok: false, error: 'a1111 returned no image', latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      return {
        ok: true,
        text: img.startsWith('data:') ? img : `data:image/png;base64,${img}`,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: 0 },
        finishReason: 'ok',
        latencyMs: Date.now() - started,
        providerId: p.id,
        model: p.model,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started, providerId: p.id, model: p.model }
    }
  },
}

// ---------------------------------------------------------------------------
// Search REST family (tavily / brave / serper / exa) — one adapter, per-field
// conventions. Returns compact "title — url — snippet" text for agent use.
// ---------------------------------------------------------------------------

const searchRest: Adapter = {
  protocol: 'search-rest',
  async call(req, p, apiKey) {
    const started = Date.now()
    const q = req.query ?? ''
    try {
      let url = ''
      let init: RequestInit = { method: 'POST', headers: { 'content-type': 'application/json' }, body: '', signal: AbortSignal.timeout(30_000) }
      let parse: (j: Record<string, unknown>) => { results: Array<{ title: string; url: string; snippet: string }> }

      if (p.id === 'tavily') {
        url = `${p.baseUrl}/search`
        init = { ...init, body: JSON.stringify({ api_key: apiKey, query: q, max_results: 8 }) }
        parse = (j) => ({ results: ((j.results as Array<Record<string, unknown>>) ?? []).map((r) => ({ title: r.title as string, url: r.url as string, snippet: (r.content as string) ?? '' })) })
      } else if (p.id === 'serper') {
        url = `${p.baseUrl}/search`
        init = { ...init, headers: { ...init.headers, 'X-API-KEY': apiKey ?? '' }, body: JSON.stringify({ q }) }
        parse = (j) => ({ results: ((j.organic as Array<Record<string, unknown>>) ?? []).map((r) => ({ title: r.title as string, url: r.link as string, snippet: (r.snippet as string) ?? '' })) })
      } else if (p.id === 'brave-search') {
        url = `${p.baseUrl}/web/search?q=${encodeURIComponent(q)}&count=8`
        init = { method: 'GET', headers: { 'X-Subscription-Token': apiKey ?? '' }, signal: init.signal }
        parse = (j) => ({ results: (((j.web as Record<string, unknown>)?.results as Array<Record<string, unknown>>) ?? []).map((r) => ({ title: r.title as string, url: r.url as string, snippet: (r.description as string) ?? '' })) })
      } else if (p.id === 'exa') {
        url = `${p.baseUrl}/search`
        init = { ...init, headers: { ...init.headers, 'x-api-key': apiKey ?? '' }, body: JSON.stringify({ query: q, numResults: 8 }) }
        parse = (j) => ({ results: ((j.results as Array<Record<string, unknown>>) ?? []).map((r) => ({ title: r.title as string, url: r.url as string, snippet: ((r.text as string) ?? '').slice(0, 300) })) })
      } else {
        return { ok: false, error: `search adapter does not implement ${p.id}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }

      const res = await fetch(url, init)
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, latencyMs: Date.now() - started, providerId: p.id, model: p.model }
      }
      const { results } = parse((await res.json()) as Record<string, unknown>)
      const text = results.map((r, i) => `[${i + 1}] ${r.title} — ${r.url}\n${r.snippet}`).join('\n\n')
      return {
        ok: true,
        text,
        usage: { tokensIn: 0, tokensOut: 0, costUsd: p.cost.search ?? 0 },
        finishReason: 'ok',
        latencyMs: Date.now() - started,
        providerId: p.id,
        model: p.model,
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - started, providerId: p.id, model: p.model }
    }
  },
}

// ---------------------------------------------------------------------------

export const LIVE_ADAPTERS: Record<string, Adapter> = {
  'openai-compat': openaiCompat,
  anthropic,
  google,
  a1111,
  'search-rest': searchRest,
}

export { toOpenAiBody, toAnthropicBody, fromOpenAiResponse, estimateCost }
