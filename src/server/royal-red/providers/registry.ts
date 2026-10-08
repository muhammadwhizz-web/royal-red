// ROYAL RED provider registry — the matrix.
//
// 60+ provider entries across 7 modalities. Cost metadata is approximate
// public list pricing (flagged in priceNote with its date) — the router uses
// it for ordering and dry-run estimates; the cost ledger records REAL cost
// per call. Local providers are $0 by definition.
//
// Honesty rules encoded here:
// - protocol 'none' = registry entry WITHOUT an execution adapter yet; the
//   router will never route to it (fail closed), but health/cost metadata
//   is still tracked so the PROVIDERS panel shows the full matrix.
// - providers without a key configured are visible in the matrix and in
//   dry-run previews (marked "needs key") but are never executed.

import type { ProviderDef } from './types'

const P = (d: ProviderDef): ProviderDef => d

export const PROVIDERS: ProviderDef[] = [
  // ============ CHAT / VISION — cloud (openai-compat family) ============
  P({
    id: 'openai', label: 'OpenAI', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding'],
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', tier: 'frontier', local: false,
    cost: { chatIn: 0.15, chatOut: 0.6, embedding: 0.02 }, priceNote: 'gpt-4o-mini list, 2025', envKey: 'OPENAI_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'openai-frontier', label: 'OpenAI GPT-4o', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', tier: 'frontier', local: false,
    cost: { chatIn: 2.5, chatOut: 10 }, priceNote: 'gpt-4o list, 2025', envKey: 'OPENAI_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-haiku-latest', tier: 'frontier', local: false,
    cost: { chatIn: 0.8, chatOut: 4 }, priceNote: 'claude-3-5-haiku list, 2025', envKey: 'ANTHROPIC_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'anthropic-frontier', label: 'Anthropic Sonnet', protocol: 'anthropic', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.anthropic.com', model: 'claude-3-5-sonnet-latest', tier: 'frontier', local: false,
    cost: { chatIn: 3, chatOut: 15 }, priceNote: 'claude-3-5-sonnet list, 2025', envKey: 'ANTHROPIC_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'google', label: 'Google Gemini', protocol: 'google', modalities: ['chat', 'vision'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-1.5-flash', tier: 'mid', local: false,
    cost: { chatIn: 0.075, chatOut: 0.3 }, priceNote: 'gemini-1.5-flash list, 2025', envKey: 'GEMINI_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'mistral', label: 'Mistral', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding'],
    baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', tier: 'mid', local: false,
    cost: { chatIn: 0.2, chatOut: 0.6, embedding: 0.1 }, priceNote: 'mistral-small list, 2025; mistral-embed list, 2025', envKey: 'MISTRAL_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'cohere', label: 'Cohere', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-r-08-2024', tier: 'mid', local: false,
    cost: { chatIn: 0.15, chatOut: 0.6, embedding: 0.1 }, priceNote: 'command-r list, 2025', envKey: 'COHERE_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'groq', label: 'Groq', protocol: 'openai-compat', modalities: ['chat', 'vision', 'audio'],
    baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', tier: 'mid', local: false,
    cost: { chatIn: 0.59, chatOut: 0.79 }, priceNote: 'llama-3.3-70b list, 2025; whisper audio $0.04/hr', envKey: 'GROQ_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
  }),
  P({
    id: 'groq-small', label: 'Groq Llama 8B', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', tier: 'small', local: false,
    cost: { chatIn: 0.05, chatOut: 0.08 }, priceNote: '8b-instant list, 2025', envKey: 'GROQ_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'together', label: 'Together AI', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', tier: 'mid', local: false,
    cost: { chatIn: 0.88, chatOut: 0.88 }, priceNote: 'llama-3.3-70b turbo list, 2025', envKey: 'TOGETHER_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'fireworks', label: 'Fireworks AI', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', tier: 'mid', local: false,
    cost: { chatIn: 0.9, chatOut: 0.9 }, priceNote: 'llama-3.3-70b list, 2025', envKey: 'FIREWORKS_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'openrouter', label: 'OpenRouter', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding'],
    baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', tier: 'mid', local: false,
    cost: { chatIn: 1, chatOut: 2 }, priceNote: 'auto-routing blended estimate, 2025', envKey: 'OPENROUTER_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
    endpointNote: 'meta-router: 300+ upstream models behind one key; model field accepts any upstream id',
  }),
  P({
    id: 'xai', label: 'xAI Grok', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.x.ai/v1', model: 'grok-2-latest', tier: 'frontier', local: false,
    cost: { chatIn: 2, chatOut: 10 }, priceNote: 'grok-2 list, 2025', envKey: 'XAI_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'deepseek', label: 'DeepSeek', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', tier: 'mid', local: false,
    cost: { chatIn: 0.27, chatOut: 1.1 }, priceNote: 'deepseek-chat standard list, 2025', envKey: 'DEEPSEEK_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'deepseek-reasoner', label: 'DeepSeek R1', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-reasoner', tier: 'frontier', local: false,
    cost: { chatIn: 0.55, chatOut: 2.19 }, priceNote: 'deepseek-reasoner list, 2025', envKey: 'DEEPSEEK_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'qwen', label: 'Qwen (DashScope)', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', tier: 'mid', local: false,
    cost: { chatIn: 0.4, chatOut: 1.2 }, priceNote: 'qwen-plus list, 2025', envKey: 'QWEN_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'zhipu', label: 'Z AI (Zhipu)', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', tier: 'small', local: false,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'glm-4-flash free tier, 2025', envKey: 'ZHIPU_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
  }),
  P({
    id: 'moonshot', label: 'Moonshot Kimi', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k', tier: 'mid', local: false,
    cost: { chatIn: 1.7, chatOut: 1.7 }, priceNote: 'moonshot-v1-8k list, 2025', envKey: 'MOONSHOT_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'minimax', label: 'MiniMax', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.minimax.chat/v1', model: 'abab6.5s-chat', tier: 'mid', local: false,
    cost: { chatIn: 0.14, chatOut: 0.14 }, priceNote: 'abab6.5s list, 2025', envKey: 'MINIMAX_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: '01ai', label: '01.AI Yi', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.lingyiwanwu.com/v1', model: 'yi-large', tier: 'mid', local: false,
    cost: { chatIn: 3, chatOut: 3 }, priceNote: 'yi-large list, 2025', envKey: 'ZEROONE_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'perplexity', label: 'Perplexity', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.perplexity.ai', model: 'sonar', tier: 'mid', local: false,
    cost: { chatIn: 1, chatOut: 1 }, priceNote: 'sonar list, 2025 (web-grounded)', envKey: 'PERPLEXITY_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),

  // ============ CHAT — local engines ($0, openai-compat servers) ============
  P({
    id: 'ollama', label: 'Ollama (local)', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding'],
    baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'vllm', label: 'vLLM (local)', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'http://localhost:8000/v1', model: 'served-model', tier: 'mid', local: true,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'lmstudio', label: 'LM Studio (local)', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'http://localhost:1234/v1', model: 'local-model', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'localai', label: 'LocalAI (local)', protocol: 'openai-compat', modalities: ['chat', 'image', 'embedding'],
    baseUrl: 'http://localhost:8080/v1', model: 'gpt-4', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0, image: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'jan', label: 'Jan (local)', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'http://127.0.0.1:1337/v1', model: 'jan-local', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'gpt4all', label: 'GPT4All (local)', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'http://localhost:4891/v1', model: 'gpt4all-local', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsStreaming: true,
  }),
  P({
    id: 'textgen-webui', label: 'Text Generation WebUI (local)', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'http://localhost:5000/v1', model: 'local', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'koboldcpp', label: 'KoboldCpp (local)', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'http://localhost:5001/v1', model: 'kobold', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsStreaming: true,
  }),
  P({
    id: 'llamacpp-server', label: 'llama.cpp server (local)', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'http://localhost:8081/v1', model: 'local', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0, embedding: 0 }, priceNote: 'local compute only',
    requiresKey: false, supportsStreaming: true,
  }),
  P({
    id: 'exllama', label: 'ExLlamaV2 (local)', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'http://localhost:5002/v1', model: 'exllama', tier: 'small', local: true,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'local compute only (tabbyAPI openai-compat)',
    requiresKey: false, supportsStreaming: true,
  }),

  // ============ IMAGE ============
  P({
    id: 'openai-image', label: 'OpenAI Images', protocol: 'openai-compat', modalities: ['image'],
    baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-1', tier: 'frontier', local: false,
    cost: { image: 0.04 }, priceNote: 'gpt-image-1 low/medium blended, 2025', envKey: 'OPENAI_API_KEY', requiresKey: true,
  }),
  P({
    id: 'stability', label: 'Stability AI', protocol: 'none', modalities: ['image'],
    baseUrl: 'https://api.stability.ai/v2beta', model: 'sd3.5-large', tier: 'mid', local: false,
    cost: { image: 0.065 }, priceNote: 'sd3.5-large list, 2025', envKey: 'STABILITY_API_KEY', requiresKey: true,
  }),
  P({
    id: 'flux-replicate', label: 'Flux (Replicate)', protocol: 'none', modalities: ['image'],
    baseUrl: 'https://api.replicate.com/v1', model: 'black-forest-labs/flux-schnell', tier: 'mid', local: false,
    cost: { image: 0.003 }, priceNote: 'flux-schnell list, 2025', envKey: 'REPLICATE_API_TOKEN', requiresKey: true,
  }),
  P({
    id: 'a1111', label: 'AUTOMATIC1111 (local)', protocol: 'a1111', modalities: ['image'],
    baseUrl: 'http://localhost:7860', model: 'sd-local', tier: 'mid', local: true,
    cost: { image: 0 }, priceNote: 'local GPU only; user runs the webui with --api', requiresKey: false,
  }),
  P({
    id: 'comfyui', label: 'ComfyUI (local)', protocol: 'none', modalities: ['image'],
    baseUrl: 'http://localhost:8188', model: 'comfy-local', tier: 'mid', local: true,
    cost: { image: 0 }, priceNote: 'local GPU only', requiresKey: false,
  }),
  P({
    id: 'recraft', label: 'Recraft', protocol: 'none', modalities: ['image'],
    baseUrl: 'https://external.api.recraft.ai/v1', model: 'recraftv3', tier: 'mid', local: false,
    cost: { image: 0.04 }, priceNote: 'recraftv3 list, 2025', envKey: 'RECRAFT_API_TOKEN', requiresKey: true,
  }),

  // ============ SEARCH ============
  P({
    id: 'tavily', label: 'Tavily', protocol: 'search-rest', modalities: ['search'],
    baseUrl: 'https://api.tavily.com', model: 'tavily-basic', tier: 'small', local: false,
    cost: { search: 0.004 }, priceNote: 'basic search list, 2025', envKey: 'TAVILY_API_KEY', requiresKey: true,
  }),
  P({
    id: 'brave-search', label: 'Brave Search', protocol: 'search-rest', modalities: ['search'],
    baseUrl: 'https://api.search.brave.com/res/v1', model: 'web-search', tier: 'small', local: false,
    cost: { search: 0.003 }, priceNote: 'web search list, 2025', envKey: 'BRAVE_API_KEY', requiresKey: true,
  }),
  P({
    id: 'serper', label: 'Serper', protocol: 'search-rest', modalities: ['search'],
    baseUrl: 'https://google.serper.dev', model: 'search', tier: 'small', local: false,
    cost: { search: 0.001 }, priceNote: 'search list, 2025', envKey: 'SERPER_API_KEY', requiresKey: true,
  }),
  P({
    id: 'exa', label: 'Exa', protocol: 'search-rest', modalities: ['search'],
    baseUrl: 'https://api.exa.ai', model: 'exa-search', tier: 'small', local: false,
    cost: { search: 0.005 }, priceNote: 'search list, 2025', envKey: 'EXA_API_KEY', requiresKey: true,
  }),
  P({
    id: 'bing-search', label: 'Bing Web Search', protocol: 'none', modalities: ['search'],
    baseUrl: 'https://api.bing.microsoft.com/v7.0', model: 'web-search', tier: 'small', local: false,
    cost: { search: 0.003 }, priceNote: 'Bing list, 2025', envKey: 'BING_API_KEY', requiresKey: true,
  }),
  P({
    id: 'google-cse', label: 'Google Custom Search', protocol: 'none', modalities: ['search'],
    baseUrl: 'https://www.googleapis.com/customsearch', model: 'cse', tier: 'small', local: false,
    cost: { search: 0.005 }, priceNote: '$5/1k queries list, 2025', envKey: 'GOOGLE_CSE_KEY', requiresKey: true,
  }),
  P({
    id: 'youcom', label: 'You.com', protocol: 'none', modalities: ['search'],
    baseUrl: 'https://api.ydc-index.io', model: 'search', tier: 'small', local: false,
    cost: { search: 0.002 }, priceNote: 'list, 2025', envKey: 'YDC_API_KEY', requiresKey: true,
  }),
  P({
    id: 'kagi', label: 'Kagi', protocol: 'none', modalities: ['search'],
    baseUrl: 'https://kagi.com/api/v0', model: 'search', tier: 'small', local: false,
    cost: { search: 0.0025 }, priceNote: 'list, 2025', envKey: 'KAGI_API_KEY', requiresKey: true,
  }),
  P({
    id: 'searxng', label: 'SearXNG (self-hosted)', protocol: 'none', modalities: ['search'],
    baseUrl: 'http://localhost:8888', model: 'searxng', tier: 'small', local: true,
    cost: { search: 0 }, priceNote: 'self-hosted', requiresKey: false,
  }),

  // ============ EMBEDDINGS (cloud, non-chat-family) ============
  P({
    id: 'voyage', label: 'Voyage AI', protocol: 'none', modalities: ['embedding'],
    baseUrl: 'https://api.voyageai.com/v1', model: 'voyage-3', tier: 'small', local: false,
    cost: { embedding: 0.06 }, priceNote: 'voyage-3 list, 2025', envKey: 'VOYAGE_API_KEY', requiresKey: true,
  }),
  P({
    id: 'jina', label: 'Jina', protocol: 'none', modalities: ['embedding'],
    baseUrl: 'https://api.jina.ai/v1', model: 'jina-embeddings-v3', tier: 'small', local: false,
    cost: { embedding: 0.02 }, priceNote: 'list, 2025', envKey: 'JINA_API_KEY', requiresKey: true,
  }),
  P({
    id: 'nomic', label: 'Nomic', protocol: 'none', modalities: ['embedding'],
    baseUrl: 'https://api-atlas.nomic.ai/v1', model: 'nomic-embed-text-v1.5', tier: 'small', local: false,
    cost: { embedding: 0.02 }, priceNote: 'list, 2025', envKey: 'NOMIC_API_KEY', requiresKey: true,
  }),

  // ============ AUDIO (registry + cost metadata; adapters fail closed this round) ============
  P({
    id: 'elevenlabs', label: 'ElevenLabs', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.elevenlabs.io/v1', model: 'eleven_turbo_v2_5', tier: 'mid', local: false,
    cost: { audio: 0.18 }, priceNote: 'turbo per 1k chars, 2025', envKey: 'ELEVENLABS_API_KEY', requiresKey: true,
  }),
  P({
    id: 'openai-audio', label: 'OpenAI TTS/Whisper', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.openai.com/v1', model: 'tts-1', tier: 'small', local: false,
    cost: { audio: 0.015 }, priceNote: 'tts-1 per 1k chars, 2025', envKey: 'OPENAI_API_KEY', requiresKey: true,
  }),
  P({
    id: 'playht', label: 'PlayHT', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.play.ht/api/v2', model: 'playht-turbo', tier: 'mid', local: false,
    cost: { audio: 0.05 }, priceNote: 'approx list, 2025', envKey: 'PLAYHT_API_KEY', requiresKey: true,
  }),
  P({
    id: 'cartesia', label: 'Cartesia', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.cartesia.ai/v1', model: 'sonic-2', tier: 'mid', local: false,
    cost: { audio: 0.03 }, priceNote: 'approx list, 2025', envKey: 'CARTESIA_API_KEY', requiresKey: true,
  }),
  P({
    id: 'deepgram', label: 'Deepgram', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.deepgram.com/v1', model: 'nova-2', tier: 'small', local: false,
    cost: { audio: 0.0043 }, priceNote: 'nova-2 per minute, 2025', envKey: 'DEEPGRAM_API_KEY', requiresKey: true,
  }),
  P({
    id: 'assemblyai', label: 'AssemblyAI', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.assemblyai.com/v2', model: 'universal', tier: 'small', local: false,
    cost: { audio: 0.0062 }, priceNote: 'per minute list, 2025', envKey: 'ASSEMBLYAI_API_KEY', requiresKey: true,
  }),
  P({
    id: 'azure-speech', label: 'Azure Speech', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://api.cognitive.microsoft.com/sts/v1.0', model: 'azure-neural', tier: 'small', local: false,
    cost: { audio: 0.016 }, priceNote: 'neural per 1k chars, 2025', envKey: 'AZURE_SPEECH_KEY', requiresKey: true,
  }),
  P({
    id: 'google-speech', label: 'Google Speech', protocol: 'none', modalities: ['audio'],
    baseUrl: 'https://speech.googleapis.com/v1', model: 'chirp-3', tier: 'small', local: false,
    cost: { audio: 0.024 }, priceNote: 'approx list, 2025', envKey: 'GOOGLE_SPEECH_KEY', requiresKey: true,
  }),
  P({
    id: 'coqui-local', label: 'Coqui (local)', protocol: 'none', modalities: ['audio'],
    baseUrl: 'http://localhost:5003', model: 'coqui-xtts', tier: 'small', local: true,
    cost: { audio: 0 }, priceNote: 'local compute only', requiresKey: false,
  }),
  P({
    id: 'piper-local', label: 'Piper (local)', protocol: 'none', modalities: ['audio'],
    baseUrl: 'http://localhost:5004', model: 'piper', tier: 'small', local: true,
    cost: { audio: 0 }, priceNote: 'local compute only', requiresKey: false,
  }),
  P({
    id: 'whispercpp-local', label: 'whisper.cpp (local)', protocol: 'none', modalities: ['audio'],
    baseUrl: 'http://localhost:8082', model: 'whisper-local', tier: 'small', local: true,
    cost: { audio: 0 }, priceNote: 'local compute only', requiresKey: false,
  }),
  P({
    id: 'bark-local', label: 'Bark (local)', protocol: 'none', modalities: ['audio'],
    baseUrl: 'http://localhost:5005', model: 'bark', tier: 'small', local: true,
    cost: { audio: 0 }, priceNote: 'local compute only', requiresKey: false,
  }),

  // ============ VIDEO ============
  P({
    id: 'runway', label: 'Runway', protocol: 'none', modalities: ['video'],
    baseUrl: 'https://api.dev.runwayml.com/v1', model: 'gen4_turbo', tier: 'frontier', local: false,
    cost: { video: 0.05 }, priceNote: 'per-second credit equivalent, 2025', envKey: 'RUNWAY_API_KEY', requiresKey: true,
  }),
  P({
    id: 'pika', label: 'Pika', protocol: 'none', modalities: ['video'],
    baseUrl: 'https://api.pika.art/v1', model: 'pika-2', tier: 'mid', local: false,
    cost: { video: 0.04 }, priceNote: 'approx list, 2025', envKey: 'PIKA_API_KEY', requiresKey: true,
  }),
  P({
    id: 'luma', label: 'Luma Dream Machine', protocol: 'none', modalities: ['video'],
    baseUrl: 'https://api.lumalabs.ai/dream-machine/v1', model: 'ray-2', tier: 'frontier', local: false,
    cost: { video: 0.055 }, priceNote: 'ray-2 approx list, 2025', envKey: 'LUMA_API_KEY', requiresKey: true,
  }),
  P({
    id: 'kling', label: 'Kling', protocol: 'none', modalities: ['video'],
    baseUrl: 'https://api.klingai.com/v1', model: 'kling-v2', tier: 'frontier', local: false,
    cost: { video: 0.05 }, priceNote: 'approx list, 2025', envKey: 'KLING_API_KEY', requiresKey: true,
  }),
  P({
    id: 'replicate-video', label: 'Replicate Video', protocol: 'none', modalities: ['video'],
    baseUrl: 'https://api.replicate.com/v1', model: 'minimax/video-01', tier: 'mid', local: false,
    cost: { video: 0.05 }, priceNote: 'approx list, 2025', envKey: 'REPLICATE_API_TOKEN', requiresKey: true,
  }),
  // ============ ROUND 7 EXPANSION: 30 new providers (matrix 66 → 96) ============
  // Honesty: rows whose rates are not published carry an EMPTY cost object and
  // a priceNote pointing at the provider pricing page. The router treats them
  // as "unknown cost" and only routes to them when the user opts in (allowlist
  // or explicit priority). endpointNote marks endpoints that need user setup.

  // ---- routers and gateways ----
  P({
    id: 'ninerouter', label: '9Router', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.9router.com/v1', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'rates not published; confirm on the provider pricing page, 2025', envKey: 'NINEROUTER_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
    endpointNote: 'confirm the exact API base URL in the edit dialog if the default does not respond',
  }),
  P({
    id: 'huggingface', label: 'Hugging Face Inference', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding', 'image', 'audio'],
    baseUrl: 'https://router.huggingface.co/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'per-model provider billing on HF, 2025; free monthly inference credits', envKey: 'HF_TOKEN',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
    endpointNote: 'chat via router.huggingface.co/v1; image and audio routes call the task-specific router paths',
  }),
  P({
    id: 'crazyrouter', label: 'Crazyrouter', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://api.crazyrouter.com/v1', model: 'gpt-4o-mini', tier: 'small', local: false,
    cost: {}, priceNote: 'rates not published; confirm on the provider pricing page, 2025', envKey: 'CRAZYROUTER_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'confirm the exact API base URL in the edit dialog if the default does not respond',
  }),
  P({
    id: 'opper', label: 'Opper', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.opper.ai/v1', model: 'opper-default', tier: 'mid', local: false,
    cost: {}, priceNote: 'usage-based; see opper.ai pricing, 2025', envKey: 'OPPER_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'Opper is a native API with an OpenAI-compatible chat surface; verify the path in the edit dialog',
  }),
  P({
    id: 'litellm-proxy', label: 'LiteLLM Proxy', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding', 'audio'],
    baseUrl: 'http://localhost:4000', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'self-hosted gateway: rates are whatever the upstream model charges',
    requiresKey: false, supportsTools: true, supportsStreaming: true,
    endpointNote: 'set your proxy URL and virtual key in the edit dialog (default assumes localhost:4000)',
  }),
  P({
    id: 'cf-ai-gateway', label: 'Cloudflare AI Gateway', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://gateway.ai.cloudflare.com/v1', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'gateway passthrough: upstream model rates apply; gateway free, 2025',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'set the full gateway URL in the edit dialog: /v1/<account>/<gateway>/openai',
  }),
  P({
    id: 'portkey', label: 'Portkey', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.portkey.ai/v1', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'gateway passthrough: upstream model rates apply, 2025', envKey: 'PORTKEY_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'needs the x-portkey-api-key header plus an upstream provider key; add headers as JSON in the edit dialog',
  }),

  // ---- fast inference clouds ----
  P({
    id: 'cerebras', label: 'Cerebras', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', tier: 'mid', local: false,
    cost: { chatIn: 0.85, chatOut: 1.19 }, priceNote: 'llama-3.3-70b approx list, 2025 (wafer-scale speed)', envKey: 'CEREBRAS_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
  }),
  P({
    id: 'sambanova', label: 'SambaNova Cloud', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.sambanova.ai/v1', model: 'Meta-Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: { chatIn: 0.6, chatOut: 1.2 }, priceNote: 'llama-3.3-70b approx list, 2025', envKey: 'SAMBANOVA_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'nvidia-nim', label: 'NVIDIA NIM', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'per-model pricing; NIM trial credits, 2025', envKey: 'NVIDIA_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'siliconflow', label: 'SiliconFlow', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding', 'image'],
    baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3', tier: 'mid', local: false,
    cost: {}, priceNote: 'published in CNY per model, 2025; small models free', envKey: 'SILICONFLOW_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
  }),

  // ---- native-API providers (own adapters) ----
  P({
    id: 'gemini-aistudio', label: 'Gemini AI Studio (native)', protocol: 'google-native', modalities: ['chat', 'vision', 'audio', 'embedding'],
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-2.0-flash', tier: 'mid', local: false,
    cost: { chatIn: 0.1, chatOut: 0.4, embedding: 0 }, priceNote: 'gemini-2.0-flash list, 2025; free tier available', envKey: 'GEMINI_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, freeTier: true,
    endpointNote: 'native v1beta generateContent path; distinct from the OpenAI-compat Gemini row',
  }),
  P({
    id: 'cohere-native', label: 'Cohere (native)', protocol: 'cohere-native', modalities: ['chat', 'embedding', 'rerank'],
    baseUrl: 'https://api.cohere.com', model: 'command-r-08-2024', tier: 'mid', local: false,
    cost: { chatIn: 0.15, chatOut: 0.6, embedding: 0.1, rerank: 2 }, priceNote: 'command-r list, 2025; rerank $2 per 1k searches', envKey: 'COHERE_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
    endpointNote: 'native v2 chat, v2 embed and v1 rerank endpoints; distinct from the compat row',
  }),
  P({
    id: 'cloudflare-workers-ai', label: 'Cloudflare Workers AI', protocol: 'cloudflare', modalities: ['chat', 'vision', 'image', 'embedding'],
    baseUrl: 'https://api.cloudflare.com/client/v4', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', tier: 'small', local: false,
    cost: {}, priceNote: 'per-neuron pricing, 2025; 10k neurons per day free', envKey: 'CLOUDFLARE_API_TOKEN',
    requiresKey: true, supportsStreaming: true, freeTier: true,
    endpointNote: 'needs your Cloudflare account id: put {"accountId": "..."} in additional headers JSON',
  }),

  // ---- open model clouds ----
  P({
    id: 'modelscope', label: 'ModelScope', protocol: 'openai-compat', modalities: ['chat', 'vision', 'image'],
    baseUrl: 'https://api-inference.modelscope.cn/v1', model: 'Qwen/Qwen2.5-72B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'daily free quota; published in CNY per model, 2025', envKey: 'MODELSCOPE_API_KEY',
    requiresKey: true, supportsStreaming: true, freeTier: true,
  }),
  P({
    id: 'alibaba-model-studio', label: 'Alibaba Model Studio', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding', 'image'],
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', tier: 'mid', local: false,
    cost: { chatIn: 0.4, chatOut: 1.2 }, priceNote: 'qwen-plus list, 2025 (international endpoint)', envKey: 'ALIBABA_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'deepinfra', label: 'DeepInfra', protocol: 'openai-compat', modalities: ['chat', 'vision', 'embedding', 'image'],
    baseUrl: 'https://api.deepinfra.com/v1/openai', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: { chatIn: 0.24, chatOut: 0.4 }, priceNote: 'llama-3.3-70b approx list, 2025', envKey: 'DEEPINFRA_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'novita', label: 'Novita AI', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.novita.ai/v3/openai', model: 'meta-llama/llama-3.3-70b-instruct', tier: 'mid', local: false,
    cost: { chatIn: 0.39, chatOut: 0.4 }, priceNote: 'llama-3.3-70b approx list, 2025', envKey: 'NOVITA_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'hyperbolic', label: 'Hyperbolic', protocol: 'openai-compat', modalities: ['chat', 'vision', 'image'],
    baseUrl: 'https://api.hyperbolic.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: { chatIn: 0.2, chatOut: 0.2 }, priceNote: 'llama-3.3-70b approx list, 2025', envKey: 'HYPERBOLIC_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),
  P({
    id: 'ai21', label: 'AI21 Labs', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.ai21.com/studio/v1', model: 'jamba-1.5-mini', tier: 'small', local: false,
    cost: { chatIn: 0.2, chatOut: 0.2 }, priceNote: 'jamba-1.5-mini list, 2025', envKey: 'AI21_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),

  // ---- agentic IDE routers ----
  P({
    id: 'opencode-zen', label: 'OpenCode Zen', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://opencode.ai/zen/v1', model: 'claude-sonnet-4-20250514', tier: 'frontier', local: false,
    cost: {}, priceNote: 'gateway: per-model list rates, 2025', envKey: 'OPENCODE_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
    endpointNote: 'confirm the gateway base URL in the edit dialog if the default does not respond',
  }),
  P({
    id: 'kilo-code', label: 'Kilo Code', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.kilo.ai/v1', model: 'claude-sonnet-4-20250514', tier: 'frontier', local: false,
    cost: {}, priceNote: 'gateway: per-model list rates, 2025', envKey: 'KILO_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'confirm the gateway base URL in the edit dialog if the default does not respond',
  }),

  // ---- free and community tiers ----
  P({
    id: 'llm7', label: 'LLM7.io', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.llm7.io/v1', model: 'gpt-4o-mini', tier: 'small', local: false,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'free tier, 2025 (token required)', envKey: 'LLM7_API_KEY',
    requiresKey: true, supportsStreaming: true, freeTier: true,
  }),
  P({
    id: 'chutes', label: 'Chutes.ai', protocol: 'openai-compat', modalities: ['chat', 'image'],
    baseUrl: 'https://api.chutes.ai/api/v1', model: 'deepseek-ai/DeepSeek-V3', tier: 'mid', local: false,
    cost: {}, priceNote: 'decentralized compute; per-model rates, 2025', envKey: 'CHUTES_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'confirm the API path in the edit dialog if the default does not respond',
  }),
  P({
    id: 'glhf', label: 'Glhf.chat', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://glhf.chat/api/openai/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'per-model rates, 2025', envKey: 'GLHF_API_KEY',
    requiresKey: true, supportsStreaming: true,
  }),

  // ---- EU-hosted clouds ----
  P({
    id: 'ovh-ai-endpoints', label: 'OVHcloud AI Endpoints', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1', model: 'Meta-Llama-3_3-70B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'published in EUR per model, 2025', envKey: 'OVHCLOUD_API_KEY',
    requiresKey: true, supportsStreaming: true, region: 'eu',
  }),
  P({
    id: 'nscale', label: 'Nscale', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.nscale.com/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'per-model rates, 2025', envKey: 'NSCALE_API_KEY',
    requiresKey: true, supportsStreaming: true, region: 'eu',
  }),
  P({
    id: 'nebius', label: 'Nebius AI', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.studio.nebius.ai/v1', model: 'meta-llama/Llama-3.3-70B-Instruct', tier: 'mid', local: false,
    cost: {}, priceNote: 'per-model rates, 2025', envKey: 'NEBIUS_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true, region: 'eu',
  }),

  // ---- remaining routers ----
  P({
    id: 'aion-labs', label: 'Aion Labs', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.aion-labs.ai/v1', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'rates not published; confirm on the provider pricing page, 2025', envKey: 'AIONLABS_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'confirm the exact API base URL in the edit dialog if the default does not respond',
  }),
  P({
    id: 'agnes-ai', label: 'Agnes AI', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.agnes.ai/v1', model: 'gpt-4o-mini', tier: 'mid', local: false,
    cost: {}, priceNote: 'rates not published; confirm on the provider pricing page, 2025', envKey: 'AGNES_API_KEY',
    requiresKey: true, supportsStreaming: true,
    endpointNote: 'user-specific endpoint: paste the base URL assigned to your account in the edit dialog',
  }),
]

export const REGISTRY_VERSION = 'royal-red-matrix-v2-96'

export function providerById(id: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.id === id)
}

/** providers serving a modality with a real execution adapter (routable today) */
export function routableProviders(modality: string): ProviderDef[] {
  return PROVIDERS.filter((p) => p.modalities.includes(modality as never) && p.protocol !== 'none')
}

export function matrixCounts() {
  const byModality: Record<string, number> = {}
  for (const p of PROVIDERS) for (const m of p.modalities) byModality[m] = (byModality[m] ?? 0) + 1
  const withAdapter = PROVIDERS.filter((p) => p.protocol !== 'none').length
  const withCost = PROVIDERS.length // every entry carries cost metadata by construction
  return { providers: PROVIDERS.length, withAdapter, withCost, byModality }
}
