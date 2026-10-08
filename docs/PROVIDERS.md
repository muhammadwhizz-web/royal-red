# PROVIDERS.md

The Royal Red provider catalog, generated from src/server/royal-red/providers/registry.ts. 66 provider entries across 7 modalities (chat, vision, embedding, image, search, audio, video). All keys are encrypted at rest with AES-256-GCM. Manage keys in the PROVIDERS panel of the console.

| Provider | Protocol | Modalities | Default model | Tier | Price note |
|---|---|---|---|---|---|
| OpenAI (openai) | openai-compat | chat, vision, embedding | gpt-4o-mini | frontier | gpt-4o-mini list, 2025 |
| OpenAI GPT-4o (openai-frontier) | openai-compat | chat, vision | gpt-4o | frontier | gpt-4o list, 2025 |
| Anthropic (anthropic) | anthropic | chat, vision | claude-3-5-haiku-latest | frontier | claude-3-5-haiku list, 2025 |
| Anthropic Sonnet (anthropic-frontier) | anthropic | chat, vision | claude-3-5-sonnet-latest | frontier | claude-3-5-sonnet list, 2025 |
| Google Gemini (google) | google | chat, vision | gemini-1.5-flash | mid | gemini-1.5-flash list, 2025 |
| Mistral (mistral) | openai-compat | chat, embedding | mistral-small-latest | mid | mistral-small list, 2025 |
| Cohere (cohere) | openai-compat | chat, embedding | command-r-08-2024 | mid | command-r list, 2025 |
| Groq (groq) | openai-compat | chat | llama-3.3-70b-versatile | mid | llama-3.3-70b list, 2025 |
| Groq Llama 8B (groq-small) | openai-compat | chat | llama-3.1-8b-instant | small | 8b-instant list, 2025 |
| Together AI (together) | openai-compat | chat, embedding | meta-llama/Llama-3.3-70B-Instruct-Turbo | mid | llama-3.3-70b turbo list, 2025 |
| Fireworks AI (fireworks) | openai-compat | chat | accounts/fireworks/models/llama-v3p3-70b-instruct | mid | llama-3.3-70b list, 2025 |
| OpenRouter (openrouter) | openai-compat | chat, vision | openrouter/auto | mid | auto-routing blended estimate, 2025 |
| xAI Grok (xai) | openai-compat | chat, vision | grok-2-latest | frontier | grok-2 list, 2025 |
| DeepSeek (deepseek) | openai-compat | chat | deepseek-chat | mid | deepseek-chat standard list, 2025 |
| DeepSeek R1 (deepseek-reasoner) | openai-compat | chat | deepseek-reasoner | frontier | deepseek-reasoner list, 2025 |
| Qwen (DashScope) (qwen) | openai-compat | chat, vision | qwen-plus | mid | qwen-plus list, 2025 |
| Zhipu GLM (zhipu) | openai-compat | chat | glm-4-flash | small | glm-4-flash free tier, 2025 |
| Moonshot Kimi (moonshot) | openai-compat | chat | moonshot-v1-8k | mid | moonshot-v1-8k list, 2025 |
| MiniMax (minimax) | openai-compat | chat | abab6.5s-chat | mid | abab6.5s list, 2025 |
| 01.AI Yi (01ai) | openai-compat | chat | yi-large | mid | yi-large list, 2025 |
| Perplexity (perplexity) | openai-compat | chat | sonar | mid | sonar list, 2025 (web-grounded) |
| Ollama (local) (ollama) | openai-compat | chat, vision, embedding | llama3.2 | local | local compute only |
| vLLM (local) (vllm) | openai-compat | chat, embedding | served-model | local | local compute only |
| LM Studio (local) (lmstudio) | openai-compat | chat, embedding | local-model | local | local compute only |
| LocalAI (local) (localai) | openai-compat | chat, image, embedding | gpt-4 | local | local compute only |
| Jan (local) (jan) | openai-compat | chat | jan-local | local | local compute only |
| GPT4All (local) (gpt4all) | openai-compat | chat, embedding | gpt4all-local | local | local compute only |
| Text Generation WebUI (local) (textgen-webui) | openai-compat | chat | local | local | local compute only |
| KoboldCpp (local) (koboldcpp) | openai-compat | chat | kobold | local | local compute only |
| llama.cpp server (local) (llamacpp-server) | openai-compat | chat, embedding | local | local | local compute only |
| ExLlamaV2 (local) (exllama) | openai-compat | chat | exllama | local | local compute only (tabbyAPI openai-compat) |
| OpenAI Images (openai-image) | openai-compat | image | gpt-image-1 | frontier | gpt-image-1 low/medium blended, 2025 |
| Stability AI (stability) | none | image | sd3.5-large | mid | sd3.5-large list, 2025 |
| Flux (Replicate) (flux-replicate) | none | image | black-forest-labs/flux-schnell | mid | flux-schnell list, 2025 |
| AUTOMATIC1111 (local) (a1111) | a1111 | image | sd-local | local | local GPU only; user runs the webui with --api |
| ComfyUI (local) (comfyui) | none | image | comfy-local | local | local GPU only |
| Recraft (recraft) | none | image | recraftv3 | mid | recraftv3 list, 2025 |
| Tavily (tavily) | search-rest | search | tavily-basic | small | basic search list, 2025 |
| Brave Search (brave-search) | search-rest | search | web-search | small | web search list, 2025 |
| Serper (serper) | search-rest | search | search | small | search list, 2025 |
| Exa (exa) | search-rest | search | exa-search | small | search list, 2025 |
| Bing Web Search (bing-search) | none | search | web-search | small | Bing list, 2025 |
| Google Custom Search (google-cse) | none | search | cse | small | $5/1k queries list, 2025 |
| You.com (youcom) | none | search | search | small | list, 2025 |
| Kagi (kagi) | none | search | search | small | list, 2025 |
| SearXNG (self-hosted) (searxng) | none | search | searxng | local | self-hosted |
| Voyage AI (voyage) | none | embedding | voyage-3 | small | voyage-3 list, 2025 |
| Jina (jina) | none | embedding | jina-embeddings-v3 | small | list, 2025 |
| Nomic (nomic) | none | embedding | nomic-embed-text-v1.5 | small | list, 2025 |
| ElevenLabs (elevenlabs) | none | audio | eleven_turbo_v2_5 | mid | turbo per 1k chars, 2025 |
| OpenAI TTS/Whisper (openai-audio) | none | audio | tts-1 | small | tts-1 per 1k chars, 2025 |
| PlayHT (playht) | none | audio | playht-turbo | mid | approx list, 2025 |
| Cartesia (cartesia) | none | audio | sonic-2 | mid | approx list, 2025 |
| Deepgram (deepgram) | none | audio | nova-2 | small | nova-2 per minute, 2025 |
| AssemblyAI (assemblyai) | none | audio | universal | small | per minute list, 2025 |
| Azure Speech (azure-speech) | none | audio | azure-neural | small | neural per 1k chars, 2025 |
| Google Speech (google-speech) | none | audio | chirp-3 | small | approx list, 2025 |
| Coqui (local) (coqui-local) | none | audio | coqui-xtts | local | local compute only |
| Piper (local) (piper-local) | none | audio | piper | local | local compute only |
| whisper.cpp (local) (whispercpp-local) | none | audio | whisper-local | local | local compute only |
| Bark (local) (bark-local) | none | audio | bark | local | local compute only |
| Runway (runway) | none | video | gen4_turbo | frontier | per-second credit equivalent, 2025 |
| Pika (pika) | none | video | pika-2 | mid | approx list, 2025 |
| Luma Dream Machine (luma) | none | video | ray-2 | frontier | ray-2 approx list, 2025 |
| Kling (kling) | none | video | kling-v2 | frontier | approx list, 2025 |
| Replicate Video (replicate-video) | none | video | minimax/video-01 | mid | approx list, 2025 |
