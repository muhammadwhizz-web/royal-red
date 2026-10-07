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
    id: 'mistral', label: 'Mistral', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', tier: 'mid', local: false,
    cost: { chatIn: 0.2, chatOut: 0.6 }, priceNote: 'mistral-small list, 2025', envKey: 'MISTRAL_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'cohere', label: 'Cohere', protocol: 'openai-compat', modalities: ['chat', 'embedding'],
    baseUrl: 'https://api.cohere.ai/compatibility/v1', model: 'command-r-08-2024', tier: 'mid', local: false,
    cost: { chatIn: 0.15, chatOut: 0.6, embedding: 0.1 }, priceNote: 'command-r list, 2025', envKey: 'COHERE_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
  }),
  P({
    id: 'groq', label: 'Groq', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', tier: 'mid', local: false,
    cost: { chatIn: 0.59, chatOut: 0.79 }, priceNote: 'llama-3.3-70b list, 2025', envKey: 'GROQ_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
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
    id: 'openrouter', label: 'OpenRouter', protocol: 'openai-compat', modalities: ['chat', 'vision'],
    baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', tier: 'mid', local: false,
    cost: { chatIn: 1, chatOut: 2 }, priceNote: 'auto-routing blended estimate, 2025', envKey: 'OPENROUTER_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
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
    id: 'zhipu', label: 'Zhipu GLM', protocol: 'openai-compat', modalities: ['chat'],
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash', tier: 'small', local: false,
    cost: { chatIn: 0, chatOut: 0 }, priceNote: 'glm-4-flash free tier, 2025', envKey: 'ZHIPU_API_KEY',
    requiresKey: true, supportsTools: true, supportsStreaming: true,
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
]

export const REGISTRY_VERSION = 'royal-red-matrix-v1'

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
