# Project Worklog — "12 Agent Codebases" Analysis & Merge Plan

---
Task ID: 1-3
Agent: main orchestrator (Z.ai Code)
Task: Environment check, download 580MB wormhole.app payload, extract + inventory 12 archives

Work Log:
- Probed wormhole.app protocol; reverse-engineered full receiver flow from public clients (trumank/wormhole-cli Rust, Mimickal/wormhole-cli, webtorrent/wormhole-crypto)
- Wrote clean-room downloader `/home/z/wh-work/whget.mjs` (Bun + WebCrypto): HKDF-SHA256 key derivation (info="authentication"/"metadata"), AES-128-GCM metadata decrypt, bencode parse, B2 chunk download from bucket `socket-dev-prod`, RFC 8188 aes128gcm stream decrypt (21-byte header, seq-XOR nonces, delimiter unpadding)
- Downloaded + decrypted all 122 chunks (~580MB) → 12 zip files → extracted to `/home/z/wh-work/extracted/<name>/<name>-main/`
- Built inventory: file counts, extension distribution, manifests

Stage Summary:
- Payload = 12 GitHub `main.zip` snapshots of AI-agent / computer-use open-source projects:
  1. agent-browser (Vercel Labs; Rust+TS browser CLI, Apache-2.0) — 11MB/457 files
  2. Agent-S (simular-ai; Python computer-use agent) — 4.5MB/123 files
  3. aider (Python AI pair programmer, Apache-2.0) — 77MB/675 files
  4. awesome-computer-use (curated list, 2 md files)
  5. browser-harness (browser-use team; Python CDP harness) — 4.2MB/178 files
  6. browser-use (Python browser automation) — 9.9MB/492 files
  7. bytebot (TS monorepo desktop computer-use platform) — 26MB/313 files
  8. cline (VS Code coding agent, TS) — 79MB/3895 files
  9. continue (VS Code/JetBrains assistant, TS+Kotlin) — 280MB/2881 files
  10. cua (trycua; Python+Rust+Go+TS computer-use w/ VMs) — 314MB/4755 files
  11. daytona (NOTE: snapshot is just README+2 pngs; repo emptied June 2026, moved private)
  12. dev-browser (Do Browser; Bun+Puppeteer persistent browser CLI) — 1.1MB/93 files
- Next: parallel deep analysis (Tasks 4-a..4-e), then synthesis report (Tasks 6,7)

---
Task ID: 4-c
Agent: ide-agent-analyst
Task: Deep-dive analysis of cline (v4.1.20 SDK monorepo) and continue (v1.3.40) — architecture, core algorithms, bugs, reusable assets
Work Log:
- Read worklog; noted assigned snapshot layouts differ from expectations: cline is the NEW bun-workspace monorepo (@cline/packages: sdk/packages/{shared,llms,agents,core,ui} + apps/{vscode,cli,cline-hub,examples}), classic src/core Task/parseAssistantMessage/multi-search-replace/ShadowCheckpointService architecture is GONE (v4 rewrite, gRPC protobus + hostbridge proto)
- cline: read agent-runtime.ts (2566 lines, full agent loop), compaction.ts/basic-compaction.ts (812+711 lines), checkpoint-restore.ts + checkpoint-hooks.ts (git stash/scratch-index design), tool-approval.ts, loop-detection.ts, apply-patch-parser.ts (v4a diff+Levenshtein fuzz), editor.ts (str_replace), bash.ts executor, mcp/manager.ts + client.ts, grpc-handler.ts + registry, FileContextTracker.ts, WebviewProvider.ts
- cline: found key facts: fork provenance comments ("clinee" vs "sdk-re") in agent-runtime; VS Code ext "claude-dev" 4.1.20 Apache-2.0; protobus+hostbridge gRPC between webview/extension/core; checkpoints = synthesized 3-parent stash commits w/ scratch GIT_INDEX_FILE for untracked files
- continue: mapped monorepo (core/, gui/, extensions/{vscode,intellij,cli}, binary/, packages/{config-yaml,config-types,openai-adapters,continue-sdk,llm-info,fetch,terminal-security}); no root LICENSE file (pkg Apache-2.0)
- continue: read core.ts (Core class), streamChat.ts, refreshIndex.ts (SqliteDb + tag_catalog/global_cache + IndexLock), CodebaseIndexer.ts, LanceDbIndex.ts, chunk.ts, CompletionProvider.ts + GeneratorReuseManager + templating, tools/callTool.ts + parseArgs.ts + runTerminalCommand.ts, findSearchMatch.ts (fuzzy matcher disabled), ConfigHandler.ts, messageIde.ts, conversationCompaction.ts, GUI agent loop (streamNormalInput/callToolById thunks)
- Inventoried non-code assets both repos; appended findings below
Stage Summary:
- cline snapshot is the 2026 restructure: AgentRuntime loop (AI-SDK-style streamed tool-call assembly, sequential/parallel exec, provider-retry w/ backoff, overflow-recovery compaction), context compaction (agentic+basic, char-estimator scaled by provider-reported tokens), checkpoints via git stash commits + untracked third parent, v4a apply_patch parser, file-based desktop approval IPC, gRPC protobus
- continue architecture: Core class in extension host "core" process; agent loop lives in the GUI (Redux thunks) — core only exposes llm/streamChat + tools/call; indexing = SQLite tag_catalog/global_cache + LanceDB per-tag tables + tree-sitter chunker; autocomplete FIM w/ debounce, LRU cache, generator reuse, postfix filters; config via config.yaml + agents dir + rules
- 20+ concrete bugs catalogued with file:line (see report): cline — per-delta full-conversation deep clone, nested-JSON chunk-boundary tool-input truncation, Windows MCP spawn shell:true injection, editor absolute-path escape, approval-file sessionId traversal, stale cline-edit flag suppressing user-edit detection, dead cleanupStaleRequests, CSP unsafe-eval; continue — chunk index race, oversized-chunk silent drop, autocomplete cache key asymmetry, suffix-blind generator reuse, unbounded terminal output, no agent-loop step cap, stub clipboard, index-warning overwrite, compaction w/o abort

---
Task ID: 4-a
Agent: browser-tools-analyst
Task: Deep-dive analysis of 3 browser-agent codebases (agent-browser, dev-browser, browser-harness): identity, architecture, core algorithms, Linux notes, bugs, reusable assets, non-code audit
Work Log:
- Read worklog; inventoried P1 agent-browser (11MB/473 files), P2 dev-browser (1.1MB/93), P3 browser-harness (4.2MB/178)
- P1: read bin/agent-browser.js, daemon.rs (full), connection.rs (full), snapshot.rs, element.rs (RefMap), cdp/client.rs, chrome.rs launch/Xvfb paths, state.rs, main.rs dispatch/actions.rs dispatch, stream bind, chat/mcp/postinstall
- P2: read bin shim, protocol.ts, daemon/main.ts (full), run.ts (full: RunGate/vm sandbox), browsers.ts (full: profile reclaim), paths.ts, chrome.ts, client.ts (full), transform.ts (full), snapshot/snapshot.ts, extend.ts (full)
- P3: read pyproject, daemon.py (full), _ipc.py (full), run.py (full), helpers.py (full), admin.py ensure_daemon section, paths.py, telemetry.py; sampled domain-skills + tests
- Verified no prebuilt binaries/wasm in any snapshot; `file`-checked axe.min.js, installHook.js, header.png, browser-harness wrapper; audited P2 SHA256 binary downloader
- Compiled bug lists (10 P1 / 8 P2 / 8 P3) with file:line citations; wrote reusable-asset and non-code inventories
Stage Summary:
- agent-browser (Vercel, v0.38.1, Apache-2.0): Rust+tokio daemon per session (Unix socket/TCP on Windows) owning Chrome via CDP; AX-tree snapshots with durable backendNodeId-backed refs; key bugs: socket dir perms (no 0600), plaintext 0644 cookie state, close-all SIGKILL PID-reuse risk, non-idempotent command retry, snapshot DOM pollution (data-__ab-ci), concurrent-start socket unlink race. Assets: vendored axe-core/React hook/CDP schemas, doctor, policy engine
- dev-browser (Do Browser, v1.0.0-rc.3, MIT): Bun daemon executing agent-authored Puppeteer scripts in vm sandbox with per-run gate proxies; named pages, snapshot refs via isolated-world handler, front-lock for background tabs; bugs: killOnIdle SIGKILLs whole daemon (concurrent runs), sync-loop wedges daemon, tracked-snapshot memory growth, private-API reliance. Assets: RunGate design, LCS incremental snapshots, profile lock classifier, checksum-verified installer
- browser-harness (browser-use, v0.1.13, MIT): Python asyncio daemon attaching CDP to user's REAL browser (DevToolsActivePort discovery, Chrome 144+ Allow-popup flow), AF_UNIX 0600 IPC, one-shot NDJSON, helpers.py thin CDP wrappers, agent-editable helpers + 99 domain-skills; bugs: 64KB asyncio readline limit breaks big requests, tab-marker task GC, socket unlink TOCTOU, unlocked non-local spawn, telemetry ON by default ships stdout tails. Assets: permission-recovery state machine, domain-skills pack, video pipeline, SKILL.md contract
- Next: tasks 4-b..4-e for remaining codebases, then synthesis (Tasks 6/7)

---
Task ID: 4-b
Agent: python-core-analyst (worklog appended by orchestrator; agent returned findings in final message only)
Task: Deep analysis of aider + browser-use Python cores

Work Log:
- Read aider core: coders/edit formats (wholefile, editblock w/ flexible matchers, search_replace RelativeIndenter+dmp pipeline, patch_coder apply_patch port), repomap.py (PageRank + tree-sitter tags, sqlite diskcache), ChatSummary, Linter (tree-sitter ERROR scan + flake8 fatal), watch.py, model-settings, oslex quoting
- Read browser-use core: CDP-only control (no playwright), DOMSnapshot+AX fusion DOM build, paint-order filtering, backendNodeId selector map + collision allocation, event-bus + watchdogs, secrets/TOTP, compaction, multi_act page-change guards, loop detection, token cost service

Stage Summary:
- aider reusable: edit-format parsers, RepoMap (PageRank+tree-sitter), summarizer, linter, watch mode, model settings
- browser-use reusable: raw-CDP session mgmt, DOM fusion serializer, registry/actions, secrets, loop safety
- browser-use bugs (file:line): agent fallback 'done' parse premature stop; dom/service.py:887 KeyError on parent lookup (no .get fallback); :407 ready_state dead CDP call; session.py:1042 url.split('/')[2] host check wrong for file://; session.py:2496 vs :2546 session-id mismatch in cached selector map (coordinate clicks degrade); :829 asserts in prod paths (breaks python -O); tools/registry/service.py:218-243 duplicated dead branches; agent/service.py:2756 empty action dump -> 'unknown' action error; cancelled CDP tasks still in-flight; think-tag strip can delete legit content
- Linux: aider pure CLI (tree-sitter wheels linux x86_64/aarch64, sounddevice optional); browser-use needs Chromium, --no-sandbox in Docker/root, screeninfo on Linux, cdp-use client, docker files included

---
Task ID: 4-e
Agent: smalls-and-binaries-analyst
Task: Deep-dive Agent-S (P1), awesome-computer-use digest (P2), daytona verdict (P3), global non-code/binary sweep (P4)
Work Log:
- Agent-S: read README/setup.py (gui-agents v0.3.2, Apache-2.0 classifier, no LICENSE file in snapshot); mapped 4 generations s1→s2→s2_5→s3 (~7.2k LOC py)
- Agent-S s3 deep read: agent_s.py, worker.py (agent loop+reflection+flush), grounding.py (OSWorldACI: UI-TARS coords, pytesseract text-span, 13 @agent_action primitives emitting pyautogui code strings), code_agent.py+local_env.py (budgeted CodeAgent), common_utils.py (eval-based action dispatch, format-retry loop), formatters.py, mllm.py+engine.py (8 provider adapters), procedural_memory.py (prompt library), bbon/ (BehaviorNarrator+ComparativeJudge), cli_app.py, osworld_setup/s3 (bBoN offline pipeline), s2 manager.py (DAG planner-executor), s1 LinuxOSACI.py (pyatspi a11y tree, wmctrl)
- Verified 12 bugs with file:line incl. cli_app.py:186 substring done/fail, double-exec via CODE_VALID_FORMATTER eval, no python timeout, drag_start_width/height swap, highlight missing resize_coordinates, UBUNTU_APP_SETUP unbound window_id, dead max_new_tokens, Anthropic content[0]/[1] indexing
- awesome-computer-use: read full README (22 categories, ~140 entries, leaderboard); daytona: README only + 2 logotype pngs
- P4 sweep: rg --files 14,686 files; extension census; binary-candidate scan (1,084 non-text) with file(1) on 30 largest + all zip/wasm/jar/sqlite/pb/onnx; credential-pattern audit (.env.example/helm secrets/npmrc/keys-route-plan all clean); aider mp3 mystery solved via _includes/recording.js; scm/lock/Dataset inventories per project
Stage Summary:
- Agent-S3 = flattened Worker (+reflection) over OSWorldACI grounding (UI-TARS ref-expr→coords, resized to screen); no set-of-marks in s3 (s1 MacOS ACI had SoM, s1 Linux used AT-SPI a11y tree); planner-executor exists only in s1/s2 (Manager→DAG); s3 replaces planning with parallel rollouts + bBoN comparative judge (offline: generate_facts.py per-step narration → run_judge.py picks best of N); accuracy story: 66%→72.6% OSWorld via bBoN
- 12 Agent-S bugs (cli_app.py:186 done/fail substring high; format-check eval double-executes side-effecting actions incl. call_code_agent high; run_python_script no timeout high; narrator drag coord swap med; highlight no resize med; window_id NameError med; OpenAI max_new_tokens dead med; Anthropic thinking block indexing med; OCR id bounds/first-2-numbers parse med; flush delete-while-iterating low; dead permission dialog + executor_plan key low; CLI 15-step cap low); security: hardcoded osworld sudo password in prompts/generated code, unrepr'd LLM strings in hotkey gen, eval-based dispatch by design
- Linux: first-class (wmctrl app-switch, UNO/LibreOffice soffice-2002 automation, pyatspi, apt auto-install in generated code, OSWorld Ubuntu harness); needs X11+pyautogui+tesseract+wmctrl+xclip, single monitor, no Wayland path
- Reusable: PROCEDURAL_MEMORY prompt library + agent_action introspection auto-doc, bBoN pipeline, CodeAgent budget pattern, 8-engine LMMAgent adapter, eval sets, WAA/OSWorld docs, openclaw SKILL wrapper
- awesome-computer-use: 22 categories (desktop/browser/mobile agents, grounding models, capture, OCR, automation libs, RPA, MCP servers, sandboxing, voice, memory, orchestration, eval, games, data tools, screen understanding, extensions, assistants, IDE agents, papers, leaderboard); top-15 Linux-first picks: Agent S, Cua, Bytebot, E2B Open Computer Use, E2B Desktop, Agent Sandbox (agent-infra), Browser-Use, Skyvern, UI-TARS, OmniParser, PyAutoGUI, DesktopCommanderMCP, OpenCUA, ScaleCUA, ScreenSuite (+VNC-Use/OS-Atlas/OSWorld hon.)
- daytona: NO CODE — README.md + 2 logotype pngs only; notice: repo unmaintained, June 2026 core dev moved private, LICENSE stays Apache at v0.190.0 tag; was AI code-run sandbox infra (90ms sandboxes, SDKs py/ts/rb/go/java, control/compute planes); nothing to analyze beyond docs
- Binary sweep: 14,686 files; 1,084 binary-format candidates; file(1) on 30 largest all match declared types (gif/png/mp4/jpeg/onnx-data); ZERO ELF/PE/Mach-O executables; only wasm=continue tree-sitter.wasm, zips=gradle-wrapper/cn-check.zip/cua.mcpb/lottie, sqlite fixture, cline descriptor_set.pb; no real credentials anywhere (17 .env.example templates, templated helm secrets); junk = 6 .DS_Store; aider 111 mp3 + 37 jpg + 5 mp4 = aider.chat website/blog audio-narration recordings (4 posts, transcript-synced via recording.js) — no CLI/runtime value, biggest deletion win; valuable IP: 127 .scm (aider 58 dual query packs, continue 68 tag queries), MiniLM ONNX 21.9MB, cua session.jsonl fixtures+DOS fonts, axe.min.js vendored, Agent-S evaluation_sets

---
Task ID: 4-d
Agent: desktop-cua-analyst
Task: Deep-dive analysis of bytebot (TS desktop-agent platform in Debian/Ubuntu container) and cua (trycua multi-lang computer-use w/ VMs) — architecture, algorithms, Linux relevance, bugs, assets
Work Log:
- Read worklog; inventoried bytebot (313 files, 6 packages) and cua (4755 files, libs/{python,typescript,lume,fleet,cua-driver,...})
- bytebot: read all 6 package manifests, docker-compose ×4, bytebot-desktop.Dockerfile + bytebotd Dockerfile, supervisord.conf, lightdm autologin; read bytebotd src fully (nut.service, computer-use.service/controller/DTOs/pipe, input-tracking service/gateway/controller, mcp tools + compressor, main.ts); read bytebot-agent src (agent.processor runIteration, agent.computer-use HTTP tool calls, input-capture, tasks.service/controller, agent.scheduler, messages.service, agent.constants prompt, main.ts, prisma schema); read bytebot-ui server.ts proxy + VncViewer
- cua: read pyproject/package.json + all 15 python lib versions + 6 TS package versions + lume VERSION/Package.swift; read computer libs: interface/base.py (full), generic.py (full 1341 ln), linux.py (full), base.py handlers (full), macos/windows drag+screenshot sections, computer.py run()/providers, docker+lumier+lume_api providers; read computer-server main.py (auth manager, routes, PTY), session_manager.py (mcp-server); read agent.py run loop + _predict_step_with_retry + loops/anthropic.py action mapping; skimmed TS computer (macos.ts base, linux/windows = 14-ln subclasses of macos), TS agent client (http/peerjs), lume Swift (VZVirtualizationService, HTTP handlers, clone-only no snapshots), fleet Go+Rust workspace, cua-driver (Rust MCP-over-stdio, Hyprland/KWin Linux helpers), qemu-docker/kasm/xfce Dockerfiles
- Audited non-code: file-checked images, evidence/, clusters/, cua-bench datasets, cua-sandbox-apps session.jsonl; searched binaries (none: no .node/.wasm/.onnx/.dylib)
- Compiled bug lists (12 bytebot / 15 cua) with file:line; appended below
Stage Summary:
- bytebot = fastest Linux-native reference: privileged Ubuntu22.04 container (Xvfb :0 1280x960x24 -ac, xfce4, x11vnc 5900 no-passwd → websockify → bytebotd 9990 proxy/noVNC), input via @nut-tree-fork/nut-js (libnut XTEST), xclip, wmctrl, human-takeover via uiohook→socket.io→UserAction messages, NestJS agent w/ anthropic/openai/gemini/litellm-proxy + 75%-context summarization + Postgres; all endpoints unauthenticated (9990/9991/9992 published, CORS *), critical pre-auth root RCE via shell-interpolated write_file/read_file paths (sudo NOPASSWD), fetch() without response.ok in tool exec (silent failures), holdKeys/mouse-button stuck on error, takeover/resume double-loop race, stale taskId closure in input capture
- cua = layered: cua-computer (Computer class + 60-op BaseComputerInterface → GenericComputerInterface REST+WS to computer-server daemon; per-OS server handlers: pynput+PIL linux, pynput+pywin32 windows, pynput macOS) + providers (docker, lume=Swift/Virtualization.framework macOS14+, lumier=lume-in-docker, qemu-docker KVM, cloud/fleet K8s Go) + cua-agent (ComputerAgent.run while-loop w/ NO max-iteration cap, 20+ model loops incl anthropic w/ screenshot downscale+coordinate upscaling, callbacks: image-retention/PII/budget) + mcp-server (FastMCP, session pool w/ stub cleanup) + lume VM clone (no live snapshots); telemetry PostHog default-ON; Linux: works today on X11/Xvfb only (pynput/ImageGrab), Wayland only via cua-driver Hyprland/KWin helpers, Linux AX tree returns FAKE success tree, drag = press/release per segment (linux+windows; macOS correct), macOS screenshot downsized vs get_screen_size mismatch, auth off unless CONTAINER_NAME set (default creds lume/lume, cua:cua, kasm-user:password)
- Reusable for god product: bytebot container recipe + takeover-replay design; cua interface abstraction + FastAPI computer-server (runs on any Linux desktop), provider factory, agent-loop callback architecture, cua-bench datasets, cua-driver Rust+UniFFI

---
Task ID: 5-7
Agent: main orchestrator (Z.ai Code)
Task: Synthesis — consolidated bug list, license map, merge/rewrite architecture, Linux-only roadmap, market strategy

Work Log:
- Consolidated findings from Tasks 4-a..4-e (all 12 projects analyzed)
- Identified critical security bugs (bytebot pre-auth RCE, agent-browser socket/cookie perms, etc.)
- Built license compatibility map (Apache-2.0 / MIT / AGPL-3.0 exception)
- Designed merged "Linux Agent Kernel" architecture + phased roadmap + market strategy
- Delivered full report to user in chat

Stage Summary:
- All 12 codebases deep-analyzed; ~80 concrete bugs documented with file:line
- Verdict: payload = nearly complete open "agentic computer" stack (browser layer, desktop layer, coding layer, grounding, memory, eval)
- daytona snapshot empty (repo emptied June 2026, code moved private) — nothing to merge
- AGPL warning: cua-som is AGPL-3.0 — must be license-isolated in any merged product

---
Task ID: 8
Agent: main orchestrator (Z.ai Code)
Task: Build AWON v0.1 - the agent OS console (user's product vision)

Work Log:
- Designed and built AWON v0.1 in the Next.js project: terminal-style agent console, text-only signature (no logo per user)
- Prisma schema: AwonSession, AwonMessage, AwonArtifact, AwonAccount, AwonAudit (db pushed)
- Backend agent runtime (src/server/awon/): agent.ts (directive JSON loop, max 14 iterations, loop memory via assistant messages, malformed-JSON repair, incremental artifact merging, file_chunk append protocol for large files, fix-pass counter max 4, honest scoring anti-cheat), prompts.ts (4 modes: BUILDER/RESEARCH/SYSTEM/ASSIST + build quality bar: unique palette, fonts, dark/light inside built site, CMS panel, no em dashes, 10+ site benchmark, 10/10 verify loop), tools.ts (whitelisted shell, web_search via z-ai SDK, workspace fs, account tools, system_report), workspace.ts (sandboxed artifact dir, path traversal guards)
- API routes: /api/awon/session (list/create), session/[id] (detail/delete), chat (SSE streaming), accounts (consent-gated CRUD), pc (whitelisted diagnostics + audit), preview/[id]/[...path] (artifact file server, MIME map), artifact-file/[id] (files with content)
- Frontend: store.ts (zustand + SSE reader), signature/boot-overlay/chat-stream (typewriter, event rows, markdown)/composer (mode chips)/right-panel (PREVIEW iframe sandbox + FILES viewer + SYSTEM console) components; dark default theme + light toggle; scanlines, caret blink, custom scrollbars; responsive (panels on desktop, chip+new-tab preview on mobile); sticky footer
- Fixed during testing: (1) big-JSON output truncation -> file_chunk chunked delivery; (2) loop without memory -> assistant raw pushed to chat; (3) score-gaming -> anti-lowball + fix-pass cap; (4) lint setState-in-effect -> typewriter rework
- Verified via agent-browser: boot screen, INITIALIZE, live chat (ASSIST mode), mode chips, SYSTEM tab (nova[admin] account + audit), light mode, mobile 390px; dev.log clean; lint clean

Stage Summary:
- AWON v0.1 LIVE: builder (multi-turn chunked site builds w/ CMS panel + 10/10 self-verify), research (web search), system (accounts/diagnostics/audit), assist; all sandboxed + audited
- E2E tested: account ops, site build (score 8 -> incremental fix loop), preview server 200 text/html
- Known gaps for next iterations: web_search live test in-loop, image gen/VLM logo verification, video understanding, real browser control, resume-from-history artifact state (files refetch), streaming token display

---
Task ID: 9 (cron review round 1)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: QA pass + bug fixes + feature round (stop, ZIP export, mode sync) + styling polish

Work Log:
- Reviewed worklog; dev server healthy; ran agent-browser QA: boot, chat, live research command (web_search tool verified LIVE in-loop: multiple searches, sourced answer)
- BUG FOUND+FIXED (mode mismatch): header badge stayed BUILDER during research commands; server only auto-detected mode for slash prefixes. Fix: auto-correct to research/pc when default BUILDER chip is active + new SSE 'mode' event syncs the UI badge live (verified in browser)
- BUG FOUND+FIXED (ZIP export): initial EOCD wrote post-central-directory offset into "offset of central directory" field -> invalid zip; fixed with centralStart capture; validated with python zipfile (integrity OK)
- BUG FOUND+FIXED (Turbopack panic): lightningcss alpha-68 parse_css panic (color.rs:441 unwrap) triggered by nested oklch() inside color-mix() inside background-image gradients + color-mix(currentColor, transparent) patterns; replaced ALL color-mix uses in globals.css with static rgba; server recovered to 200
- FEATURES ADDED: (1) Stop button - aborts the SSE stream mid-turn, "stopped by user" event (ok status, not error), composer shows red square while streaming; (2) artifact ZIP export via dependency-free ZIP writer route /api/awon/artifact-download/[id] (store method, CRC32 table, UTF-8 names, attachment header) + download button in preview header; (3) elapsed seconds timer on phase line; (4) per-tool icons in event rows (globe/terminal/users/shield/file)
- STYLING: engineering grid + vignette background on chat column, top scroll fade mask, SYSTEM ONLINE pulse-dot status strip, hover lift + glow on suggestion cards
- Verified: lint clean, page 200, browser screenshots (console + stop flow), ZIP integrity OK

Stage Summary:
- v0.1.1: research/system auto-mode routing live, streaming is stoppable, artifacts exportable as real ZIPs, console styling upgraded
- Unresolved/next: typewriter may race long markdown (acceptable), streaming token display (still per-iteration), web_search results panel, image-gen tool for logos + VLM verify, video understanding, resume artifact state edge (files refetch works via session detail), plan auto-check progression (model marks done itself)

---
Task ID: 10 (cron review round 2)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: QA pass via agent-browser + bug fixes + AWON eyes (image gen + VLM verify) + UX/styling round

Work Log:
- Reviewed worklog + all AWON sources; dev server healthy (200)
- agent-browser QA: boot, chat loop (ask), SYSTEM tab diagnostics, light/dark, builder E2E
- BUG FOUND+FIXED (malformed-directive abort): a mid-turn malformed JSON killed the whole turn even after partial delivery ("AWON hit a malformed directive..." seen live during a build). Now: 2 repair retries with shrinking budget, and if an artifact was already delivered the turn degrades gracefully ("Partial progress is saved. Send continue to resume.")
- BUG FOUND+FIXED (binary asset routing): generated images landed in the first artifact only; a later artifact referencing assets/logo.png 404ed in preview (confirmed in dev.log). Fix: agent.ts carries binary assets forward from prior artifacts of the session into any newly created artifact dir + registers tombstones; preview route serves binaries as Buffers; ZIP export reads image tombstones from disk (validated: gallery.zip integrity OK, assets/logo.png 32318B inside)
- BUG FIXED (styling): SYSTEM diagnostics pre overflow -> whitespace-pre-wrap break-words; artifact review block wraps too
- FEATURE: generate_image tool (z-ai SDK images.generations; size whitelist; safe path under assets/; saves binary to artifact dir + tombstone in DB; returns artifactPatch that agent emits as artifact event)
- FEATURE: analyze_image tool (VLM via zai.chat.completions.createVision; reads artifact image / workspace file / http(s) URL as base64 data URL; 8MB cap). BUILDER prompt now mandates the LOOK loop: generate -> vision check -> critique -> regenerate (max 2) -> ship best
- FEATURE: expandable OUTPUT panel on event rows (web search results, vision analyses readable in full; chevron rotate + slide animation)
- FEATURE: copy button on assistant messages (hover reveal, check feedback); FILES tab per-file copy + download + char count; image files render in viewer on checkerboard backdrop
- FEATURE: plan rail progress (done/total + animated bar); boot overlay now lists vision core line (and h-40 for 7 lines)
- STYLING: awon-rise entrance animation for chat rows/cards (reduced-motion safe), awon-detail slide, awon-score-glow pulse on 10/10 pill, stagger delays on suggestion cards, focus-visible rings; mobile footer shortened to one line, artifact chip moved to bottom-36 with truncate+backdrop
- E2E VERIFIED (agent-browser): logo build for warp9 ran the full loop: image gen 73KB -> vision check (found double-layered V, regenerated) -> second check (gradients, regenerated) -> third check -> honest call ("proceed with best available") -> dark gallery page embedding assets/logo.png; preview 200 for png; FILES (2); image viewer; ZIP with PNG valid
- Verified: lint clean, page 200, dark restored, browser closed

Stage Summary:
- v0.2: AWON now has EYES: generate_image + analyze_image (VLM) wired into the builder loop with mandatory visual verification; binary artifact pipeline (disk + tombstones + preview + ZIP) solid
- Loop reliability: malformed directives no longer lose partial work; repair passes doubled
- Known gaps / next: image-gen loop is iteration-hungry (a 3-regen logo build consumed the 14-iteration budget before scoring; consider raising MAX_ITERATIONS for build mode or cheaper check cadence); web_search results clickable links inside OUTPUT panel; video understanding; session-scoped artifact switcher; resume-plan auto-progression still model-driven (plan showed 2/4 after done)

---
Task ID: 11 (cron review round 3)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + fixes (panel tab, stale plan, build budget) + features (artifact switcher, video understanding, clickable outputs, code copy, / shortcut) + styling round

Work Log:
- Read worklog; dev server healthy (200); full source review of src/server/awon + src/components/awon
- agent-browser QA pass: boot overlay, console, live ASSIST chat round-trip, SYSTEM tab diagnostics (kernel output + audit rows), sessions sheet, snapvault session load (plan rail 2/3 + artifact + binaries intact), PREVIEW render (SCORE 9/10 pill + review strip), light mode toggle. Verdict: stable, no blocking bugs
- BUG FIXED (panel tab persistence): loading a session with an artifact left the right panel stuck on SYSTEM; panelTab is now store state (setPanelTab), loadSession switches to PREVIEW when an artifact exists, artifact events pull SYSTEM back to PREVIEW
- BUG FIXED (stale plan rail): after a finished build the rail kept unchecked items (was 2/3 on a shipped artifact); agent.ts now tracks lastPlan, and an honest score >= 10 marks every plan item done (UI event + persisted meta so reloads agree)
- BUG FIXED (tool output never reached UI): tool_end emitted only the one-line summary, so web_search URLs were invisible; event now carries full output (summary + detail), OUTPUT expander shows it with DetailText
- RESEARCH PROMPT hardened: models were baking stale dates/versions into search queries ("latest kernel November 2023" -> 2023 answer); RESEARCH_RULES now forbid guessed dates, require neutral query first + cross-check, and trust search over training memory
- BUILD BUDGET: MAX_ITERATIONS 14 global -> 22 for build mode (image-gen + vision-check cycles are iteration hungry; a 3-regen logo build previously drained the budget before scoring)
- FEATURE (video understanding): analyze_video tool; v1 (video_url content) failed - the vision endpoint rejects video (API 400 code 1210); v2 = download (48MB cap, 60s timeout, content-type guard) -> ffprobe duration -> ffmpeg samples 3-6 evenly spaced 640px JPEG frames -> one multi-image createVision request with [FRAME k (t=..s)] interleaved labels; tmp dir cleaned in finally; verified LIVE: "watched 10s via 5 frames" + correct Big Buck Bunny scene description; note gtv-videos-bucket sample URLs now return AccessDenied, test-videos.co.uk works
- FEATURE (artifact switcher): store gains artifacts[] + selectArtifact; Layers dropdown in PREVIEW header lists every session artifact with score pill + check on current; round-trip verified (snapvault-gallery 9/10 <-> awon-visuals logo on checkerboard)
- FEATURE (session restore): loadSession now rebuilds tool event rows from message meta.tools with friendly TOOL_LABELS (moved to client-safe types.ts, prompts.ts re-exports) - reloaded sessions keep their audit trail
- FEATURE (clickable outputs): DetailText linkifies http(s) URLs in event rows (truncated to 64 chars, emerald underline, stopPropagation so expand toggle does not swallow clicks)
- FEATURE (code copy): MarkdownBody pre -> CodeBlock wrapper with hover copy button (per-block, clipboard verified on /ask bash one-liner)
- FEATURE ("/" shortcut): global keydown focuses the composer textarea unless already typing (vi style); placeholder updated
- STYLING: sessions sheet rows get mode-colored dots (build=emerald, research=amber, pc=violet, ask=sky) + group hover + focus ring; suggestion cards now have per-capability icons (Hammer/Eye/Kanban/Video/Search) and a new WATCH A VIDEO starter; boot overlay v0.3.0 with "linking video core" line (h-44); footer bumped to AWON V0.3
- Verified E2E via agent-browser: / shortcut focus, live research with expanded OUTPUT links (kernel.org, phoronix...), video watch turn, artifact switcher round-trip, session reload with tool rows, code copy click, composer disabled states; lint clean; dev.log FATAL panics checked = historical (pre-fix lines 373/385 of 11k, lightningcss alpha68 color.rs:441 from Task 9 era), current build healthy

Stage Summary:
- v0.3: AWON now EARS+EYES+MEMORY: video understanding (ffmpeg frame sampling into VLM), full-artifact switcher, searchable/clickable tool outputs, restored audit trails, plan rail that never lies about completion, bigger build budget
- Known gaps / next: video tool is URL-based only (artifact-hosted videos would need upload flow); research answers can still drift from search results when model over-trusts memory (prompt now mitigates, worth watching); event OUTPUT expander does not store output in meta (restored rows show summary only) - consider persisting detail; sessions sheet fetch could dedupe; image-gen loop cost could still be cut by batching generate+check in one tool array (model does this sometimes)
---
Task ID: 12 (cron review round 4)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + persistence fix + upload pipeline (drag/drop/attach) + video path support + styling round (v0.4)

Work Log:
- Read worklog; dev server healthy (200); full source review of agent.ts, tools.ts, workspace.ts, prompts.ts, store.ts, composer.tsx, chat-stream.tsx, chat route
- agent-browser QA pass: boot overlay (v0.4 lines), INITIALIZE, live ASSIST round-trip, SYSTEM tab (accounts/diagnostics/audit), sessions sheet, snapvault session restore (plan rail 2/3, artifact 9/10, preview render). Verdict: stable, no blocking bugs found in existing features
- BUG FIXED (restored OUTPUT empty): tool event rows only persisted summary in message meta, so reloaded sessions showed one-line summaries with no expandable OUTPUT. Fix: agent.ts persists full output (summary + detail, capped 4000 chars) in meta.tools[].output; store.ts loadSession restores it into event rows. Verified: reloaded session now shows expandable OUTPUT with the full vision analysis (emerald left-accent panel)
- BUG FIXED (restored "(working)" bubbles): assistant turns that only ran tools persisted content "(working)" and rendered as a pointless bubble after reload; loadSession now skips it (tool rows carry the audit trail)
- BUG FIXED (stop button confusion): the red stop square was permanently rendered (disabled at idle), reading as broken. Composer idle slot now shows the PAPERCLIP attach button; while streaming it swaps to the red stop square (same slot, zero layout shift). Verified both states live
- FEATURE (upload pipeline): POST /api/awon/upload (multipart, kind detection image/video/file, caps: video 48MB, image 12MB, other 4MB); workspace.saveUpload() writes sanitized name into awon-workspace/files/uploads/<stamp>-<name> so every existing tool (read_file, analyze_image, list_files) sees uploads as normal workspace paths automatically
- FEATURE (analyze_video path arg): tool now accepts url OR workspace path (uploads/clip.mp4); local branch stats file (64MB cap), copies into tmp, same ffprobe/ffmpeg frame-sampling pipeline into one multi-image VLM request; detail labels source as workspace:<path>
- FEATURE (composer attachments): paperclip opens multi-file picker; drag-and-drop onto the whole composer with dashed-emerald "DROP FILES INTO THE WORKSPACE" overlay; pending chips row with kind-colored icons (image=emerald, video=violet, file=sky), size labels, remove buttons, live "transferring N..." counter, inline upload errors; send appends [attachments: uploads/...] to the command text; user bubbles render attachments as emerald chips instead of raw text
- FEATURE (prompts): global USER ATTACHMENTS rule in modeRules base (always inspect attachments with the right tool before answering; builder may copy uploads into artifact assets); DIRECTIVE_PROTOCOL schema documents analyze_video path variant; RESEARCH/ASSIST rules mention workspace-path videos
- FEATURE: new "EXAMINE AN ATTACHMENT" starter card (FolderOpen icon)
- STYLING: expanded OUTPUT panel gets emerald left-accent border; upload chips per-kind colors; drop overlay uses awon-breathe; boot overlay adds "mounting upload bus: drag drop attach ok" line (h-48) and bumps to v0.4.0; footer bumped to AWON V0.4
- E2E VERIFIED via agent-browser: (1) test PNG upload -> chip in composer -> vision check ran on workspace:uploads/... -> correct "solid bright red" answer; (2) ffmpeg-generated 6s test mp4 upload -> video watch ran "watched 6s via 3 frames" -> correct test-pattern description (color bars, countdown timer); (3) session reload keeps chips + expandable OUTPUT; (4) /ask streaming shows stop-swap + auto mode sync; (5) light mode renders all new UI correctly
- Verified: lint clean, dev.log error scan shows only historical (pre-fix) lines, dark mode restored, browser closed

Stage Summary:
- v0.4: AWON can now ingest user files: drag/drop or paperclip -> sandboxed uploads -> eyes (analyze_image), ears (analyze_video with local paths), and file reads all work on them; tool outputs survive session reloads in full; composer swaps attach/stop smartly
- Known gaps / next: video tool still caps at 48-64MB and samples max 6 frames (deeper understanding = more frames or scene detection); uploads are session-agnostic (all sessions share the workspace; fine for single-user AWON); artifact-hosted videos (agent-generated) still not a thing; image-gen loop budget could batch generate+check per turn; suggestion grid now 6 cards (2x3 on sm+)
---
Task ID: 13 (cron review round 5)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + 5 bug fixes + read_page tool + session management + workspace browser + styling round (v0.5)

Work Log:
- Read worklog; dev server healthy (200); full source review of agent.ts, tools.ts, prompts.ts, workspace.ts, store.ts, page.tsx, chat-stream.tsx, composer.tsx, right-panel.tsx, all api/awon routes
- agent-browser QA pass: boot overlay (v0.4), INITIALIZE, live /ask round trip (mode chip auto-sync BUILDER->ASSIST), sessions sheet, snapvault session restore (plan rail 2/3, tool rows with OUTPUT, artifact 9/10 preview), light mode. Core loop verdict: stable
- QA CONFIRMED BUG #1 (critical): sessions sheet infinite refetch loop - useEffect depended on [sessionsOpen, sessions], set sessions -> effect re-runs -> fetch -> set... measured 348 GET /api/awon/session requests in 5s while the sheet was open. Fixed: fetch only on open (deps [sessionsOpen]) + explicit refreshList() after mutations. Re-verified: 1 request in 5s
- QA CONFIRMED BUG #2: TOOL_ICONS keyed by snake_case tool names ("web_search") but event rows carry friendly TOOL_LABELS ("web search"), so the lookup ALWAYS missed and every event row fell back to the generic Terminal icon. Fixed: normalize label -> key via toolIconKey (lowercase, spaces to underscores); added read_page: Newspaper icon
- QA CONFIRMED BUG #3: mobile artifact chip rendered score as " / 910" (template ` / ${score}10`); fixed to " / 9/10"
- QA CONFIRMED BUG #4: stop button only aborted the client fetch; the server loop kept burning LLM iterations after disconnect. Fixed: chat route passes req.signal into runAwonTurn; agent loop checks stopped() at iteration start, after callLlm, around tools, and before fix passes; aborted mid-turn persists "(stopped by user mid-turn; partial work is saved)" for history coherence; client stop() also flips lingering 'run' event rows to err "interrupted by user". Verified live: /research stop -> POST /api/awon/chat completed in 4.2s (previously would keep running)
- QA CONFIRMED BUG #5: runShell rejected relative workspace script paths (python3 files/x.py) because the arg check demanded the literal 'awon-workspace/' prefix; fixed by resolving relative args against WORKSPACE_ROOT and requiring the resolved path to stay inside it; also allows python3 -c / node -e / bun -e inline eval (cwd pinned to workspace; same trust level as workspace scripts)
- FEATURE (read_page tool): z-ai page_reader function; http(s) only; HTML -> readable text (strip script/style, tags to newlines, entity decode, whitespace collapse), 6000 char cap, returns title + url + publishedTime; DIRECTIVE_PROTOCOL schema documents it; RESEARCH rules now mandate opening 1-3 top results with read_page instead of trusting snippets; ASSIST rules mention it. Verified LIVE: "read \"Example Domain\" (932 chars extracted)" + verbatim first sentence
- FEATURE (session management): PATCH /api/awon/session/[id] renames (title cap 120); sessions sheet rows get hover controls (Pencil -> inline rename input, enter saves / esc cancels; Trash -> DELETE, spinner in place); deleting the open session resets the console; DELETE route now also rm -rf's the session's artifact dirs on disk and writes an audit row. E2E verified: renamed a session to "vision core sanity check" (API confirmed), deleted it (list confirmed gone)
- FEATURE (workspace browser): FILES tab now has ARTIFACT | WORKSPACE scope toggle; WORKSPACE view lists the user-files half of the sandbox (uploads + agent write_file outputs) via GET /api/awon/workspace; per-kind colored icons (image=emerald, video/code accents, data=sky), size labels, hover download (GET /api/awon/workspace/file?path=... renders inline for media/text, attachment otherwise, 64MB cap, path-jail via resolveUserFile) and delete (DELETE /api/awon/workspace?path=... audit-logged, files/ jail). Empty state points at the composer drop zone. E2E verified with 4 real files
- STYLING round: right-panel tabs get emerald active state (data-[state=active]:bg-emerald-500/10 + shadow); plan rail items are now pill chips (done = emerald border + strikethrough, pending = card bg + slow-spinning dashed circle) with gradient progress bar and awon-rail hairline top glow; composer mode chips are per-mode colored (build=emerald, research=amber, pc=violet, ask=sky) matching session dots; event detail lines strip markdown emphasis (was showing literal **asterisks** from model output); session rows show relative time ("7m ago") + active-session ring; checkerboard comment on image viewer; boot overlay v0.5.0 with "linking web reader" line (h-52); footer AWON V0.5; firefox thin scrollbars + pre-scoped webkit scrollbar polish
- Verified: lint clean; dev.log FATAL panics are historical (lines 373/385 of 17k, pre-fix era, panic log 11:25 < this round); dark restored, browser closed

Stage Summary:
- v0.5: AWON gains a real WEB READER (search -> open pages -> cite), full SESSION MANAGEMENT (rename/delete with disk cleanup), and a WORKSPACE FILE BROWSER (uploads + agent files: list/download/delete). Five real bugs fixed including a network-flooding refetch loop and a stop button that never actually stopped the server
- Known gaps / next: read_page detail capped at 6000 chars (long pages truncated; could chunk-follow if needed); session list is unpaginated (fine at 23, revisit at 100+); workspace browser has no folder tree (flat list, fine while uploads stay shallow); image-gen loop budget still batching candidate; video still max 8 frames; artifact-hosted video generation not a thing yet; consider artifact diff view in FILES tab
---
Task ID: 14 (cron review round 6)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + v0.6 feature round (command history, auto titles, session search, workspace zip, retry) + styling round

Work Log:
- Read worklog (v0.5 baseline); dev server healthy (200); agent-browser QA baseline: boot overlay, INITIALIZE, live /ask round trip (correct answer citing web_search + read_page), FILES tab WORKSPACE scope (4 files render). Verdict: stable, no blocking bugs -> this round = features
- REFACTOR: dependency-free ZIP builder extracted from the artifact-download route into src/server/awon/zip.ts (single source of truth); artifact-download route now imports it (behavior unchanged)
- FEATURE (workspace zip export): GET /api/awon/workspace/zip streams the entire user-files workspace as awon-workspace-<date>.zip (128MB total cap, skips unreadable); Archive button added to the WORKSPACE browser header (disabled when empty). Validated: 4 entries, python zipfile testzip integrity OK
- FEATURE (command history): terminal-style ArrowUp/ArrowDown in the composer walks a module-level command history (last 100, dedupes consecutive); in-progress draft is preserved and restored; history only engages when the caret is on the first/last line so multiline editing still works naturally; caret pinned to end on recall. Verified live: ArrowUp recalled the last command, ArrowDown restored the draft
- FEATURE (auto session titles): chat route marks brand-new sessions; after runAwonTurn completes (post-'done', so the UI is already responsive) a tiny LLM call generates a 3-6 word Title Case title from the first command + first reply; db updated and a second `session` SSE event renames it live; aborts and failures degrade silently (keep the command-slice title). Verified live: "/ask Give me a two sentence tip..." -> session titled "Writing Effective Release Notes" in the db and sheet
- FEATURE (retry on error): store tracks lastCommand (cleared on reset); hard error events (label 'error': link failures, model errors) render as a dedicated ErrorRow with red left-accent panel + one-click RETRY chip that re-sends the last command (hidden while streaming). Tool-level errors keep their plain rows
- FEATURE (session search): sessions sheet gains a filter input (search icon + mono style); client-side title match, "3 of 26 sessions" counter, empty-match state. Verified live with query "video" -> exactly the 3 video sessions
- STYLING: ErrorRow red-accent treatment; composer helper line now shows kbd chips (up/down history, / focus) on the right; EmptyState gained a keyboard-hints strip (/ focus, up/down history, enter send, shift+enter newline) with styled <kbd> chips; boot overlay v0.6.0 with "wiring session memory: titles history retry ok" line (h-56); footer AWON V0.6
- Verified: lint clean; workspace zip integrity OK; auto-title, history, filter, chat round trip all E2E green; dev.log error scan shows only the transient "Input is not defined" from the window between the filter edit and its import fix (same minute, fixed before E2E); dark mode intact, browser closed

Stage Summary:
- v0.6: AWON remembers: command history with terminal arrow navigation, auto-generated session titles, session search, one-click retry after hard failures, and full workspace zip export. ZIP builder now shared by both exporters
- Known gaps / next: retry re-sends the raw last command (attachment suffix is part of it, which is correct); auto-title only fires for brand-new sessions (pre-existing sessions keep their slice titles until renamed manually - acceptable); artifact diff view in FILES tab still open (needs file version history, schema change); image-gen loop batching candidate still open; video still 8 frames; session list pagination at 100+; ErrorRow retry not keyboard-focus-trapped (minor a11y, tab order still reaches it)
---
Task ID: 15 (cron review round 7)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + v0.7 feature round (pinning, export, palette, turn stats, header chip) + styling round

Work Log:
- Read worklog (v0.6 baseline); lint clean; agent-browser QA baseline: boot overlay v0.6 renders, INITIALIZE, live /ask round trip (SSE loop healthy, mode auto-sync BUILDER->ASSIST), sessions sheet (auto-titles, mode dots, relative times), FILES tab ARTIFACT/WORKSPACE toggle, light mode. Verdict: stable, no blocking bugs -> feature round
- BUG/GAP FIXED (session title never rendered): store tracked sessionTitle but nothing displayed it; now a truncated mono chip in the header (emerald dot + max-w truncate, title attr, hidden < sm)
- FEATURE (session pinning): AwonSession.pinned Boolean @default(false) via db:push; GET /api/awon/session orders [pinned desc, updatedAt desc] and returns pinned; PATCH accepts {pinned} alongside {title} (400 when both missing); sessions sheet: PINNED section label at the first pinned row, pin/unpin hover button (Pin/PinOff, emerald when pinned), sort handled server-side
- FEATURE (transcript export): GET /api/awon/session/[id]/export streams markdown (title header, mode/exported/messages/artifact list with scores, per-message USER/AWON sections with timestamps, tool audit lines from meta.tools via TOOL_LABELS, slug filename awon-<title>.md, Content-Disposition attachment); Download hover button on every session row
- FEATURE (command palette): Ctrl+K / Cmd+K + header terminal button; CommandDialog (shadcn) with ACTIONS (new session, open history, toggle theme, export current session), MODES (4 modes with active marker), RECENT SESSIONS (top 8 + see all); pure client, zero server changes; hints added to EmptyState kbd strip + composer helper line (ctrl+k palette)
- FEATURE (turn stats): store tracks turnStart/turnToolCount client-side (module vars, zero agent.ts changes); on done -> turnStats {secs (0.1s precision), tools}; TurnStatsLine renders centered mono line "turn complete / Xs / N tools" after each finished turn; cleared on next send; aborted turns never report
- STYLING round: assistant bubbles now have emerald left accent (border-l-2 border-l-emerald-600/50) distinguishing agent speech; markdown tables wrapped in overflow-x-auto rounded border with mono header row (bg-muted/60) + striped rows (odd:bg-muted/20); boot overlay v0.7.0 with "pinning session index: pin export palette ok" line (h-60); footer AWON V0.7
- Verified: lint clean after all edits; Prisma client regenerated and confirmed working in a fresh bun process (pinned query OK)

# INCIDENT: dev server down, restart requires platform
- Root cause chain: db:push regenerated the Prisma client (new pinned field) but the long-running next-server (booted 08:56) kept the old client in memory; GET /api/awon/session 500 "Unknown argument pinned"
- Decision: restarted the dev server chain (backup dev.log first). Confirmed there is NO runtime supervisor (single boot banner ever, /start.sh only starts it at boot; bun run dev is orphaned to init with PPID 1)
- CRITICAL FINDING: every process spawned from agent tool sessions is reaped between tool calls (tested: setsid/nohup/disown sleep, python http.server listener, plain & children of the persistent shell - all dead by the next tool call). Therefore `bun run dev` CANNOT be restarted persistently from inside any agent session; only the platform (boot flow or a new session start) can bring it up
- Two relaunch attempts served 200s briefly then were reaped; Turbopack cache was invalidated once (warning seen, harmless)
- RECOVERY SAFETY NET WRITTEN: /home/sync/repo.tar (6.5MB, 856 entries; src, prisma, db/custom.db WITH pinned migration, awon-workspace artifacts, .zscripts, package.json; excludes node_modules/.next/skills/upload/dev.log). If the platform rebuilds the instance, /start.sh will restore from this tar and .zscripts/dev.sh will bun install + db:push + start the dev server automatically. Work is fully protected; git also has commit "v0.7: session pinning + markdown export + command palette + turn stats + styling round"
- Attempted platform cron tool to schedule a recovery check: not available from this session type

Stage Summary:
- v0.7 features all coded and lint-clean: session pinning (schema + API + sheet UI), markdown transcript export, Ctrl+K command palette, turn stats line, header session chip, plus styling round (assistant accent, table polish, boot v0.7)
- UNVERIFIED IN BROWSER (blocked): dev server down at end of round; E2E of v0.7 features pending the platform restarting bun run dev (new session start or instance rebuild). QA of v0.6 features was green before the incident
- NEXT SESSION PRIORITY: (1) confirm dev server up (curl :3000), (2) agent-browser E2E of pin/export/palette/turn-stats/header chip, (3) any fixes, (4) then proceed to next features (image-gen batch, artifact diff view, video frame count)
- Lessons: never kill the dev server for a Prisma client swap; instead prefer schema-additive changes with raw SQL fallback, or request platform restart. If a restart is ever needed again, write /home/sync/repo.tar FIRST
---
Task ID: 16 (cron review round 8)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + v0.7 E2E verification (was blocked) + v0.8 feature round (local command line, workspace editor, stats, device frames) + styling round

Work Log:
- Read worklog (v0.7 baseline, E2E was blocked by dev server death); dev server was down again this round (platform booted it at 13:10, reaped before 13:20). CONFIRMED ENV CONSTRAINT: every process (including platform-started dev server) is reaped between tool calls; sudo unavailable. Mitigation: ALL QA now runs as single-invocation bash marathons (server start + API smoke + agent-browser flows + screenshots in ONE call). Reusable harness: qa/qa-v07b.sh, qa/qa-v08.sh, qa/qa-v08c.sh
- v0.7 E2E VERIFIED (was pending since Task 15): boot overlay v0.7 lines, INITIALIZE real-click dismissal (hit-target proof via CSS selector button.awon-glow; lesson from run 1: text= selectors silently failed and console checks behind the overlay were false positives), live /ask SSE round trip + turn stats line, sessions sheet open/pin/unpin (PINNED label + API pinned count 0 after restore), markdown export (curl: title header + USER/AWON sections), Ctrl+K palette ACTIONS/MODES/RECENT SESSIONS, header session chip with auto-title, light mode + dark restore via palette action and header toggle
- QA harness bugfixes worth remembering: placeholder text is NOT in body.innerText (attribute only - false FAILs); rg here rejects -E flag (use default regex); boot overlay exit animation needs ~2.5s before "overlay gone" assertion; HMR full reload (new npm dep) can resurrect the overlay mid-run - retest with fresh page
- BUG FIXED (pre-existing, exposed by /help): markdown tables rendered as raw pipe text - react-markdown has no GFM by default and the v0.7 table styling was never actually reachable. Fix: bun add remark-gfm + remarkPlugins={[remarkGfm]} in MarkdownBody. Verified: /help table now renders as real striped table with mono header
- FEATURE (local command line, client-side only, SSE loop untouched): store.send() intercepts slash commands before fetch - /help (markdown cheat sheet rendered in chat), /new (reset + toast), /sessions (sheet), /theme (flips via new ThemeCommandBridge in page.tsx because zustand has no React context for next-themes), /export (markdown transcript, degrades to err row without session), /files /system /preview (right panel jumps), bare /build /research /pc /ask (instant mode switch + event row); mode words WITH args fall through to server unchanged; unknown /cmd gets a local err row ("type /help") and never reaches the model
- FEATURE (workspace file editor): PUT /api/awon/workspace/file (text-only ext allowlist mirrored client/server, 512KB cap, files/ path jail, audit row workspace.file.edit); WorkspaceFileDialog in FILES>WORKSPACE scope: images render on checkerboard, text files open in mono textarea with dirty-tracking + save/revert + char count + toast, binaries get download-only panel. E2E: API round trip create->update->read-back PASS, ".." jail PASS, dialog edit persisted to disk and confirmed via GET
- FEATURE (preview device frames): PREVIEW tab gains desktop/tablet(768px)/mobile(390px) segmented toggle; non-desktop renders iframe inside a device-chrome frame (rounded border, shadow, MOBILE / 390PX status bar) centered on muted backdrop; desktop unchanged full-bleed. E2E: tablet + mobile frame labels verified on the snapvault-gallery artifact
- FEATURE (workspace stats): GET /api/awon/workspace?stats=1 returns files/bytes/byKind/kindBytes; SYSTEM tab WORKSPACE widget with per-kind color bars (image=emerald, media=violet, code=sky, data=amber) + refresh button. E2E verified with 5 real files
- STYLING round: boot overlay v0.8.0 with "loading local command line: /help /new /theme /export ok" line (h-64), footer AWON V0.8, EmptyState kbd strip gains "/help local commands" chip, /help bubble uses the styled GFM table
- Verified: lint clean; git commit "v0.8: ..."; /home/sync/repo.tar refreshed (9.3MB, 919 entries, includes bun.lock for the new remark-gfm dep + qa/ harness); dev.log error scan clean; chat SSE + artifact preview + auto-title all regression-green; dark and light mode verified

Stage Summary:
- v0.8: AWON feels like an OS: a real local command line over the console (8 commands + 4 mode words), an inline workspace file editor (view/edit/save inside the sandbox), workspace stats in SYSTEM, and responsive device frames for the artifact preview - the website-builder vision now has its verification surface
- Known gaps / next: /files lands on ARTIFACT scope (workspace is one click away - could deep-link the scope); theme via /theme toggles blindly (event row text is static, could report actual new theme); video tool still caps 48-64MB / max 6 frames (scene detection + more frames still open); artifact diff view needs file version history (schema change); image-gen loop batching candidate still open; session list pagination at 100+; ErrorRow retry keyboard-trap a11y minor; consider /pdf /sheet style exporter commands next
---
Task ID: 17 (cron review round 9)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + v0.9 feature round (stats card, files deep-link, theme report, session filters + date groups, smart scroll) + styling round

Work Log:
- Read worklog (v0.8 baseline); dev server up (200, fresh platform boot; one harmless EADDRINUSE boot-race line in dev.log - the surviving instance serves everything); lint baseline clean
- agent-browser QA baseline (qa/qa-v09-baseline.sh): boot overlay + INITIALIZE click, empty state + suggestion cards, LIVE /ask SSE round trip (turn complete / 0.8s), mode chip auto-sync, sessions sheet (30 rows, no refetch flood), artifact preview + device toggle, light/dark round trip. Verdict: STABLE, no blocking bugs -> feature round
- FEATURE (/stats): new local command renders a console telemetry card as a real GFM table in chat (sessions on record, current session, console mode, plan progress, artifacts + latest score, workspace file count/bytes via GET /api/awon/workspace?stats=1, per-kind workspace mix); the run row ("gathering console telemetry...") is replaced in place by the assistant card when the async fetch lands (explicit ChatItem return type keeps zustand item mapping type-safe); added to /help table and the command palette (ACTIONS -> console stats, Gauge icon)
- FEATURE (/files workspace deep-link): FILES tab scope (artifact|workspace) lifted from FilesTab local state into the store (filesScope + setFilesScope, reset on /new); "/files workspace" (or "ws") / "/files artifact" now open the FILES tab directly on that scope; /help documents it
- FEATURE (/theme honest report): store pushes a "theme switching..." placeholder row; ThemeCommandBridge in page.tsx performs the toggle via next-themes AND rewrites the row detail to the actual result ("console surface switched to light mode"); verified flip true->false + row text
- FEATURE (sessions mode filter): chip row under the search input (ALL/BUILD/RESEARCH/PC/ASK, per-mode colors matching composer accents, aria-pressed); combines with the text filter; counter shows "N of M sessions" when either filter is active; verified research filter -> counter + row subset, ALL -> 30 rows back
- FEATURE (sessions date groups): rows grouped under hairline GroupLabels - PINNED (n) / TODAY / YESTERDAY / THIS WEEK / EARLIER - computed client-side from updatedAt; row renderer extracted into renderRow closure; pinned section keeps its dedicated group
- FEATURE (smart scroll): ChatStream tracks atBottom (within 90px); autoscroll only while the reader is at the bottom, so scrolling up to read during a stream no longer yanks the view down; a JUMP TO LATEST pill (emerald, backdrop-blur, awon-rise) appears when scrolled away and smooth-scrolls back; pill hides at bottom. Verified: appears on scroll-up, returns to bottom, hides
- STYLING round: preview iframe loading skeleton (RENDERING PREVIEW + spinner on blurred backdrop, desktop and device-frame variants, derived from loadedKey!==previewKey so no effect/setState-in-effect - lint rule compliant); running tool rows now pulse their tool icon in emerald; TOOL_ICONS coverage for local command rows (stats=Gauge, theme=SunMoon, export=Download, panel=PanelRight, mode=ArrowLeftRight); emerald ::selection (light 28% / dark 40%); boot overlay v0.9.0 with "console telemetry: /stats mode filters date groups ok" line (h-72 for 14 lines); footer AWON V0.9
- PROMPTS: BUILDER_RULES gains an EFFICIENCY line - batch generate_image + analyze_image in the SAME tools array instead of burning separate turns (the known loop-cost candidate)
- CLEANUP: removed dead exports from right-panel.tsx (PanelToggleButton null stub + Plus/Download re-export)
- E2E VERIFIED (agent-browser, qa/qa-v09.sh + qa/qa-v09b.sh): boot v0.9 lines; /stats card renders as table; /files workspace lands on WORKSPACE scope (aria-pressed true + SANDBOXED header); /theme flips surface AND reports the actual new theme; /help lists new commands; /ask round trip green after all changes; date groups render; 5 sheet chips sheet-scoped; mode filter counter; research filter 0 rows -> ALL restores 30; jump pill full cycle; device frames + preview iframe intact; screenshots saved
- Verified: lint clean (fixed one react-hooks/set-state-in-effect error by switching the preview skeleton to derived state); git commit 3af90a1; /home/sync/repo.tar refreshed (1.6MB, 172 entries: src 111, prisma 4, db/custom.db, awon-workspace 35, qa 8, .zscripts 10, package.json + bun.lock); dev.log scan clean (only the historical EADDRINUSE boot-race line)
- QA harness lessons this round: aria-pressed returns a QUOTED string via eval (compare against '"true"' or use String() + contains); querySelectorAll('button') spans the whole document - scope sheet queries to '[role="dialog"]' or the composer's identically-named mode buttons shadow them; the jump pill can only be tested on a session tall enough to scroll (short sessions correctly never show it)

Stage Summary:
- v0.9: AWON reads like a real OS surface: a telemetry card (/stats), deep-linkable panel scopes, an honest theme toggle, a filterable + date-grouped session index, and reader-respecting smart scroll with a jump-to-latest pill. Builder loop gets an efficiency nudge (batch gen+look)
- Known gaps / next: artifact diff view still needs file version history (schema change); video tool still caps 48-64MB / max 6-8 frames; session list unpaginated (30 now, fine); /stats workspace fetch is uncacheable per invocation (cheap enough); ErrorRow retry keyboard-trap a11y minor still open; image-gen batching now prompted - worth observing actual loop cost on the next logo build; consider /pdf /sheet exporter commands and artifact-hosted videos next
---
Task ID: 18 (cron review round 10)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Status assessment + agent-browser QA + v1.0 milestone round (multi-format export with dependency-free PDF writer, artifact diff view, workspace search/sort, panel-focus keyboard shortcuts, /plan /about) + styling round

Work Log:
- Read worklog (v0.9 baseline); dev server up (200); lint baseline clean
- agent-browser QA baseline (qa/qa-v09-baseline.sh): boot overlay + INITIALIZE, empty state, LIVE /ask SSE round trip (turn complete / 0.9s / 0 tools, mode chip auto-sync), sessions sheet (30 rows, no refetch flood), artifact preview + device toggle, light/dark round trip. Verdict: STABLE, no blocking bugs -> feature round (v1.0 milestone)
- FEATURE (dependency-free PDF writer, src/server/awon/pdf.ts): PDF 1.4 with Helvetica-Bold headings + Courier 9pt body (exact 92-col wrap math), automatic pagination (~59 lines/page), per-page footer "AWON TRANSCRIPT / PAGE N OF M / AWON V1.0", WinAnsi sanitization (smart quotes/dashes/ellipsis folded to ASCII, rest -> '?'), full string escaping, hand-built xref table with byte-exact offsets, single-byte latin1 encoding throughout (no UTF-8/WinAnsi mismatch). UNIT TESTED standalone: qpdf --check clean (after fixing a real object-ordering bug: page dicts and content streams must interleave so obj numbers match the Kids/Contents refs), startxref verified, all 47 xref offsets land on their objects, pdftotext extracts correct text, 21-page stress test
- FEATURE (export route formats): /api/awon/session/[id]/export?format=md|pdf|csv (md default, legacy path unchanged); csv is RFC 4180 (quote+doubling+CRLF) with timestamp/role/content/tools columns plus artifact score rows; pdf builds title -> dim meta line -> per-message USER/AWON sections with wrapped tool audit lines. Smoke-tested against live sessions: 1-page and 2-page PDFs, csv quoting, md byte-compatible with previous behavior
- FEATURE (local commands): /export now takes an arg (md|pdf|csv), plus /pdf and /csv aliases (shared exportTranscript helper; honest err row when no session exists, success row with format label otherwise); /plan renders the current execution plan as a GFM table (done/pending per step); /about renders a capabilities card (kernel, shape, modes, senses, hands, memory). /help table extended for all of them
- FEATURE (artifact diff view): FILES tab ARTIFACT scope gains a DIFF VS PREV toggle (visible when the session has a previous artifact and the active file is text); on open it lazily fetches /api/awon/artifact-file/<prevId> (or reuses known content), runs an LCS line diff (bounded at 1200 lines, Int32 DP table ~5.7MB max) and renders a unified view: +N/-N summary pills, per-row old/new line-number gutters, red/green tinted rows with +/- markers, 2 lines of context around changes, "..." separators; identical files report "identical to the previous artifact"; missing-file case degrades to a friendly error panel. Diff state carries its own artifact+path key so switching files/artifacts invalidates by comparison (no setState-in-effect)
- FEATURE (workspace search + sort): WORKSPACE scope gains a filter input (shown when >3 files; header shows "N OF M FILES" while filtering) and a name/size sort toggle (ArrowDownAZ / ArrowDownWideNarrow); empty-match state
- FEATURE (panel focus): Ctrl+B / Cmd+B toggles the right preview panel (panelHidden in store; ResizablePanelGroup gets stable ids, chat fills full width, header shows PanelRightOpen/Close with aria-pressed); Ctrl+J / Cmd+J toggles the sessions sheet; both documented in /help, EmptyState kbd strip and the composer helper line (ctrl+b panel chip)
- FEATURE (palette): "export current session as pdf" (FileDown, emerald) and "toggle preview panel (ctrl+b)" actions added
- STYLING round: boot overlay v1.0.0 with two new lines ("export engines: markdown pdf csv diff view ok", "console focus: panel toggle workspace search ok") and h-[348px]; footer AWON V1.0; diff rows emerald/red treatments with tabular line-number gutters; workspace search input matches the sessions-filter mono style; header panel button; assistant /plan /about cards reuse the striped GFM table styling
- E2E VERIFIED (agent-browser, qa/qa-v10.sh, ALL 17 CHECKS PASS): boot v1.0 lines; INITIALIZE; /about card; /plan empty state; /pdf no-session err row; ctrl+b hide + restore (aria-pressed); ctrl+j sessions sheet; diff button on a real 2-artifact session + diff view renders (+679/-1 badges verified on the snapvault gallery session, screenshots saved); workspace search input + "N OF M FILES" counter (".html" -> 0 OF 4 + empty state); live /ask round trip green after all changes; /pdf success row with session; light mode all-new UI correct; dark restored
- QA harness lessons this round: (1) Radix TabsTrigger activates on MOUSEDOWN - synthetic el.click() never switches tabs, use a real click (agent-browser find text ... click); (2) aria-pressed via eval returns a QUOTED string ("true"), compare against "\"true\"" or String(); (3) /pdf-style export checks need a session to exist first - assert the honest no-session err row separately
- Verified: lint clean (0 errors, 0 warnings); dev.log clean; chat SSE loop + artifact preview + auto-title regression-green; /home/sync/repo.tar refreshed (1.7MB, 175 entries incl. new pdf.ts + qa-v10.sh); git commit 094de5a

Stage Summary:
- v1.0 milestone: AWON's transcripts leave the console three ways (markdown, a real paginated PDF from a hand-rolled dependency-free PDF engine, RFC 4180 CSV), the builder's iterations become inspectable (artifact diff view vs previous with LCS red/green rendering), the workspace browser got search + sort, and the console reads like an OS with ctrl+b focus mode and ctrl+j session recall. 17/17 E2E checks green, zero regressions to the SSE loop or preview system
- Known gaps / next: diff compares against the previous ARTIFACT only (true file version history still needs a schema change - avoid db:push, remember the v0.7 incident); video tool still caps 48-64MB / max 6-8 frames; session list unpaginated (34 now); ErrorRow retry keyboard-trap a11y minor still open; image-gen batching prompted but unobserved on a fresh build; /export from the sessions sheet row is markdown-only (composer covers pdf/csv); PDF writer is text-only (no images/links - fine for transcripts); artifact-hosted videos still not a thing

---
Task ID: 19 (master directive round: payload acquisition + Phase 1 complete)
Agent: main orchestrator (Z.ai Code, webDevReview cron)
Task: Download new 418MB wormhole payload (6 competitor codebases), execute Phase 1 of the master directive (all six Tier-1 gaps), E2E verify, commit

Work Log:
- SANDBOX RESET DISCOVERED: /home/z/wh-work (old whget.mjs + 12 extracted repos) was wiped; /home/z/my-project survived. Rebuilt the wormhole downloader as /home/z/wh-work/whget2.mjs (clean-room, Bun + WebCrypto), re-deriving the protocol from public reference (trumank/wormhole-cli, Apache-2.0, fetched from GitHub master)
- Protocol v2 (corrected): GET /api/room/{id}/salt -> HKDF-SHA256(masterKey, salt) 16B keys ("authentication" auth token in "Bearer sync-v1 <b64>" header; "metadata" key AES-128-GCM, iv = first 16B of encryptedTorrentFile) -> bencoded torrent (files[].length = ENCRYPTED stream lengths; 20B piece hashes; pieceLength=5013504) -> POST b2/auth-download -> pieces at {downloadUrl}/file/socket-dev-prod/{room}/{i}?Authorization= -> EACH FILE is its own RFC 8188 aes128gcm stream routed by encrypted-length offsets
- TWO hard-won protocol lessons recorded: (1) wormhole's header rs = FULL ciphertext record length (tag included), NOT the RFC 8188 plaintext size - verified against live bytes (rs=65536 records decrypt to 65520B); record nonce = base XOR seq into LAST 4 BYTES (u32 BE), not 8. (2) v1 died from OOM holding 440MB in RAM: v2.1 spools pieces to disk (payload/.pieces/piece-N, resume-safe by expected size) and streams each file's byte range across piece boundaries via a PieceReader (fd-per-piece, record-by-record decrypt to a write stream) - 418MB downloaded in 32s, all 6 zips pass python zipfile integrity
- PAYLOAD: zed-main.zip (25.8MB), cline-main.zip (40.9MB, monorepo w/ apps/), OpenJarvis-main.zip (42.3MB), OSWorld-V2-main.zip (62.9MB, desktop_env + evaluation_examples), agents-main.zip (3.9MB = LiveKit Agents), PersonalJarvis-main.zip (243MB) -> extracted to /home/z/wh-work/extracted/ (938MB total). Deep analysis = next cron rounds (Phase 2+ prep)
- P1-1 (version history): DB BACKED UP first (db/custom.db.backup-v1.0-20261005-051944). New model AwonArtifactVersion (artifactId FK cascade, version int, files snapshot, note, @@unique([artifactId,version])); kernel helper src/server/awon/versions.ts (avoids agent<->tools import cycle) called at ALL 5 artifact mutation sites (artifact merge/create, file_chunk update/create, generate_image); backfill script scripts/backfill-versions.ts (13 artifacts -> v1 snapshots); APIs GET /api/awon/artifact-versions/[id] (session-wide timeline) + GET /api/awon/artifact-version/[versionId]?path= (immutable content); FILES tab: DIFF VS PREV replaced by HISTORY DIFF button -> lazy version fetch -> native select ("DIFF VS...", options "v{n} . name . note") -> LCS DiffView with label; default target = newest snapshot that is not the current artifact's latest
- P1-2: src/app/manifest.ts (Next Metadata API) serves /manifest.webmanifest 200 with AWON metadata; PWA-install groundwork for Phase 7 packaging
- P1-3 (video): scene detection via ffmpeg select='gt(scene,0.25)'+showinfo (pts_time parse, dedupe 0.1s); adaptive frame budget 8/12/18/24 by duration (was hard 8); scenes spread evenly when they exceed budget, else merged with even samples (0.75s min gap); artifact-hosted videos resolve latest session artifact first (mirrors analyze_image), then workspace; prompts updated (DIRECTIVE_PROTOCOL + research/ask rules)
- P1-4 (pagination): /api/awon/session GET rewritten: pinned always lead page 0 (cap 100), unpinned cursor-paginated by compound updatedAt|id cursor (50/page, last-URI-encoded), bad cursor -> 400; store gains sessionsCursor/sessionsHasMore/sessionsLoadingMore + refreshSessions/loadMoreSessions actions; sheet: sentinel div + IntersectionObserver (root = radix scroll viewport, 240px margin, getState reads) renders "scroll for older sessions"/spinner; warm effect uses store action
- P1-5: sheet row export button -> DropdownMenu MARKDOWN/PDF/CSV (FileText/FileDown/FileSpreadsheet) opening /export?format=
- P1-6: ErrorRow gains role="alert" + aria-live="polite"
- BUG FIXED (pre-existing, found during QA): generate_image created awon-visuals artifacts with placeholder entry assets/visual-1.png but never updated the row's entry -> preview 404 "artifact file not found"; kernel now sets entry=relPath on create, and 4 stale rows repaired via one-off script
- E2E VERIFIED (agent-browser, qa/qa-v11.sh + interactive follow-ups): manifest 200; cursor API pages walk backward + bogus cursor 400; version timeline + content APIs green; LIVE /build two-iteration run produced 5 immutable snapshots (initial build, merges, file_chunks) and the version select lists all of them; diff vs v3 renders red/green with +/- pills; live analyze_video: "watched 9s via 8 frames (2 scene cuts)" -> "Red, Blue, Green" exactly right on a synthetic 3-color clip; /ask SSE round trip green; light mode clean; lint 0/0; dev.log error scan clean
- Verified: git commit (v1.1); /home/sync/repo.tar refreshed (80.8MB incl. .pieces? no - repo only); dev server restarted once to pick up regenerated Prisma client (stale client caused a transient 500 on artifact-versions: db.awonArtifactVersion undefined)

Stage Summary:
- v1.1: Phase 1 of the master directive is DONE - all six Tier-1 gaps closed with zero regressions to the SSE loop or preview system. AWON's diff view now reads immutable version history (every artifact write snapshots), the session index paginates, transcripts export three ways from the sheet, videos are watched at their actual scene cuts, and the console is PWA-installable
- New payload on disk: 6 competitor codebases (zed, cline monorepo, OpenJarvis, OSWorld-V2, LiveKit agents, PersonalJarvis) awaiting the Phase 2-7 pattern analysis (OpenJarvis flagged "most architecturally important" by the directive)
- Known gaps / next: Phase 2 (Verification 2.0: adversarial self-critique, constraint ledger, visual regression, 10-site benchmark, CMS login verification, honest score dashboard) is the moat - start next round; OSWorld-V2 harness after Phase 3 browser hands; the old 12-repo analysis (Task 1-7) still valid but those snapshots were lost in the sandbox reset - re-download only if needed for file:line re-checks; DB backup retention: keep custom.db.backup-v1.0-* until v1.2 is stable

---
Task ID: 20 (Phase 4 build: Permitted PC Control complete, Section 1 done)
Agent: main orchestrator (Z.ai Code)
Task: Finish the cut-off DESKTOP panel by building the entire Phase 4 stack it controls (4.1-4.7), stop UI coding at first successful render

Work Log:
- AUDIT FIRST: found Phase 2/3 intact (verify/* + osworld harness + qa-v12 scripts, v1.2) but ZERO Phase 4 artifacts (no consent/undo/kill/box code anywhere). Git history reset to initial commit (sandbox event); worklog entries 20+ lost in a session cutoff. DB backed up (custom.db.backup-v1.2-20261006-054353) BEFORE schema change
- SCHEMA (additive, db:push clean): AwonRun (plan hash + actions counters), AwonConsent (tier, status incl. frozen, typed ruleText, expiresAt), AwonConsentRule (typed-rule overrides, no checkbox anywhere), AwonUndoEntry (write-ahead journal, seq-ordered, undone flag)
- 4.1 src/server/awon/box/prison.ts: HONEST path prison - mount table (emulated home rw, host FS absent), traversal rejection, realpath containment (symlink-escape blocked), BOX_ROOT=/home/z/my-project/awon-box, VIRTUAL_HOME=/home/awon
- 4.1 runtime.ts: pluggable BoxRuntime (ContainerRuntime probes podman/docker - absent here; PathPrisonRuntime active, describes itself honestly in the panel), supervised child process table for the kill switch + leak tests
- 4.1 box.ts: shell-less exec (tokenizeCommand rejects ;|&<>`$(){}[]!*?~\n), binary whitelist WITHOUT rm/mv/cp (file lifecycle only via primitives so journal/consent cannot be bypassed), 15s timeout, output caps, cwd=box home, registerChild
- 4.2 dryrun.ts: the planner never mutates. Classifies (junk/installers/documents/images/archives/code/data), flags junk, refuses what cannot be proposed (missing source, target collision, in-plan duplicate targets, prison escape), dir-into moves resolve to dir/basename, planHash=sha256(steps). cleanupPlanFor = default Downloads policy. Pending-plan cache carries write-content post-approval (cards show bytes, not 4MB of text)
- 4.3 screen.ts: Xvfb lifecycle (supervised, 1280x800x24, -nolisten tcp), ffmpeg x11grab screenshots, dependency-free grid+variance segmentation with clamped confidence (labeled heuristic, not a model), inputBackendAvailable()=false -> click/type FAIL CLOSED with honest error
- 4.4 consent.ts: kernel TRUE PAUSE (promise per request resolved by POST /api/awon/desktop/consent/[id]), 120s fail-closed expiry, FIFO queue w/ per-request timers (head expiry never auto-decides later ones), freezeAllPending for the kill switch, typed-rule storage + glob matching
- 4.5+4.6 ops.ts: executor obeys ABORT > plan-hash > write-ahead journal > per-step audit (desktop_step SSE + AwonAudit row) > trash-only deletion. executePlan refuses hash mismatch (approved dry-run must be the executed one). undoRun replays journal newest-first (panel-initiated undo = the user's click IS the consent, audited). triggerAbort: SIGTERM all supervised children + freeze pendings + mark runs aborted + audit + 30s global refuse window
- 4.7 primitives.ts: EXACTLY 13 agent-facing primitives (box_list/box_read T1, box_plan free-by-construction, box_write/box_mkdir/box_move/box_copy T2 plan cards, box_trash T3 per-action never batched, box_undo T2, shell_exec T3 EXTREME typed-rule, screen_shot T1 virtual-only, screen_click/screen_type T3 fail-closed). Wired into tools.ts dispatch (requires live emit; refuses when aborted)
- prompts.ts: PC_RULES gains the BOX protocol (13 primitives, job protocol for "clean up my Downloads", never claim unreported actions); detectMode routes cleanup/tidy/organize commands to SYSTEM
- API: /api/awon/desktop/state (mission-control JSON), /consent/[id] (decide), /abort (kill switch, un-gated by design), /undo (panel-initiated)
- CONSOLE: SSE events consent_request/consent_result/desktop_plan/desktop_step/desktop_run; ConsentCard in chat (tier badges, live countdown, plan table w/ FLAG marks, T2 four-option approve/modify/type-a-rule/deny, T3 per-action + typed rule input, T1 approve-read, status badges incl. FROZEN BY KILL SWITCH); store answerConsent w/ honest revert on late answers; /desktop command + /help row
- DESKTOP PANEL (desktop-tab.tsx, Section 1 deliverable): ACTIVE RUN w/ always-visible red ABORT + confirm dialog (states exactly what it does), AWON BOX honest identity card, mounts table, trash stats (7-day TTL, manual purge), CONSENT QUEUE (FIFO), RECENT RUNS+UNDO buttons, VIRTUAL SCREEN (input honestly NOT INSTALLED), supervised processes, audit tail. 2.5s polling. Rendered + screenshot-verified dark AND light (qa/phase4-desktop-*.png). /desktop lands on it; boot overlay v1.3 with 6 Phase-4 lines; footer V1.3
- BUGS FOUND+FIXED during build: (1) planner refused moves INTO existing directories - now resolves to dir/basename w/ collision check (dryrun.ts planOne); (2) spawnSupervised imported from wrong module (runtime.ts -> box.ts) broke the state route boot; (3) propposable typo in dry-run dup-check silently disabled in-plan collision refusal; (4) start-stop-daemon needed for the dev server after the platform instance was killed (sandbox reaps session children)
- UNIT TESTED: scripts/test-phase4.ts 47/47 (prison escapes incl. symlink, classification, refusals, hash discipline, T3 kernel true-pause PROVEN (fs untouched while pending), trash->.awon-trash->undo roundtrip, hash-mismatch refusal, kill switch freezes a live consent waiter, shell tokenizer rejects chaining/redirection/substitution/globs, typed-rule glob matching)
- Verified: lint 0/0; dev server healthy (start-stop-daemon); state API JSON correct; DESKTOP tab renders all sections (agent-browser); screenshots saved

Stage Summary:
- Phase 4 4.1-4.7 built and unit-proven; the DESKTOP mission-control panel renders (Section 1 of the continuation directive COMPLETE; UI coding stopped per directive). ~ = emulated home; host FS not mounted; rm does not exist in the box. Next: four honesty answers, then the 9-step acceptance test

---
Task ID: 20.2 (Section 2: the four honesty questions, answered BEFORE acceptance testing)
Agent: main orchestrator (Z.ai Code)
Task: Answer the four honesty questions in plain English, from the actual code, no guessing

Work Log:
- ANSWER 1 - "What is the container actually doing?"
  It is NOT a container and AWON never calls it one. There is no docker/podman in this environment (probed: no binaries, no socket), so there are no kernel namespaces, no cgroups, no seccomp, and nothing is "isolated" at the OS level. What actually runs is a USERLAND PATH PRISON (src/server/awon/box/prison.ts + runtime.ts): (a) every agent path is normalized and matched against an explicit mount table that maps an emulated home (/home/awon/*) to a real directory inside the project (awon-box/home/awon); (b) realpath containment checks block symlink escape; (c) every child process is registered in a supervised table; (d) the runtime module ADVERTISES this in the DESKTOP panel verbatim: "path-prison emulation (mount table + containment + supervised processes). NOT a container: no kernel namespaces, no cgroups, same uid as the console." A real container runtime can be plugged in later through the same BoxRuntime interface - that is why the emulation layer is honest about its name.
- ANSWER 2 - "What does rootless emulation prevent, and what does it NOT prevent?"
  PREVENTS: agent reads/writes outside awon-box/ (path prison on every operation); access to the real host home (NOT mounted - not even read-only - by default); ../ traversal and symlink escape (realpath containment); un-journaled deletion (rm is not whitelisted anywhere and cannot be consented into existence - the only "delete" is a move into .awon-trash); shell chaining/redirection/substitution in shell_exec (tokenizeCommand rejects metacharacters); un-consented action (all 13 primitives tier-gated, kernel-enforced regardless of model behavior); executing anything the user did not see (plan-hash discipline: the executed batch must be byte-identical to the approved dry-run).
  DOES NOT PREVENT: attacks at the kernel level; a compromised Node/Next.js process (the prison is enforced BY that same process - if the process is compromised the prison is compromised with it); kernel-level resource exhaustion (no cgroups - only wall-clock timeouts and output caps); side channels; encryption at rest (trash files are plain files). The DESKTOP panel states this in the runtime description line rather than burying it.
- ANSWER 3 - "Is ~/Downloads in the Phase 4 test the user's real home directory or a virtual one?"
  It is a VIRTUAL emulated home INSIDE the box: awon-box/home/awon/Downloads. The real /home/z/Downloads is never mounted, never read, never written by any Phase 4 code path (the mount table has no entry for it and the prison refuses /home/z/* by construction - unit-tested: 'statVirtual outside box is an escape'). The agent's ~ resolves to the emulated home. Nothing about the acceptance test touches the user's real Downloads folder.
- ANSWER 4 - "Confirm Xvfb touches nothing real."
  Confirmed, from code: all grounding runs on Xvfb virtual displays (screen.ts) - private framebuffers with no connection to any physical output. There is no /dev/input access anywhere in the codebase; xdotool/xinput are not even installed, and the click/type primitives FAIL CLOSED with an honest "input backend unavailable" error instead of pretending (unit-testable via inputBackendAvailable()=false). Screenshots come from ffmpeg x11grab against the virtual display only. No Phase 4 test moves the host pointer, presses host keys, or reads the host screen.

Stage Summary:
- Four honesty answers locked into the record: honest emulation naming, real protection boundaries (incl. what it does NOT protect), virtual Downloads (real home untouched, proven by the prison + tests), and zero host-input/display contact. Ready for the 9-step acceptance test.

---
Task ID: 20.3 (Section 3: the 9-step acceptance test - ALL PASS)
Agent: main orchestrator (Z.ai Code)
Task: Run the 9-step acceptance test ("Clean up my Downloads folder.") through the real console + kernel, report pass/fail per step

Work Log:
- Fixtures: 8 files seeded in the EMULATED box home (awon-box/home/awon/Downloads): pdf, jpg, deb, crdownload, Thumbs.db, zip, txt, mystery.xyz. Real /home/z/Downloads untouched (zero code paths reach it)
- qa/qa-phase4.sh drives the REAL UI (agent-browser) against the REAL kernel: no mocks, no test backdoors. Result: 19/19 checks green, all 9 steps pass
- Step results: (1) T1 read-consent card rendered+approved PASS; (2) approve honored by kernel PASS; (3) dry-run plan card rendered (7 actions, step table, FLAG marks) PASS; (4) four options present APPROVE|MODIFY|TYPE A RULE|DENY PASS; (5) plan approved PASS; (6) Tier 3 asked PER ACTION (3 separate trash dialogs - batching is structurally impossible) + 7 per-action audit rows + disk layout exact (2 docs, 1 image, 1 archive, 3 in .awon-trash, mystery.xyz untouched) PASS; (7) write-ahead journal recorded all 7 entries (from->to, seq, ts) PASS; (8) "undo the cleanup." -> undo card -> approved -> all 8 files restored, 7 undo audit rows PASS; (9) second run ABORTED mid-execution via the DESKTOP panel ABORT: run marked aborted 1/7, desktop.abort audit row, pending T3 card FROZEN BY KILL SWITCH (visible on the card), consent queue drained, and the agent honestly reported "cleanup was partially executed... interrupted after trashing Thumbs.db but before processing big-download.crdownload" - screenshot qa/phase4-step9-abort.png
- Kernel state after the test (DB): run1 done 7/7, run2 aborted 1/7 with abortReason "kill switch pressed on the DESKTOP panel", 1 frozen consent, 8 journal entries
- TEST HARNESS bugs found+fixed (the kernel had ZERO of the failures): (a) agent-browser eval returns double-JSON-encoded strings - single json.loads yields a string, causing silent case-match failures (the qa-v10 aria-lesson strikes again, now recorded properly: decode twice); (b) the script's own reset fired the kill switch whose 30s refuse window then rejected the test's own box_list - now waits it out; (c) wait_idle must probe the composer with a character (the send button is disabled when EMPTY, not just when streaming); (d) DB reset used bash-expanded \$disconnect and silently no-op'd; (e) the ABORT button lives on the DESKTOP tab - the script must open the tab first
- KERNEL bugs found+fixed by this test: (f) the model ended its turn after box_list instead of proposing the plan - prompt protocol now REQUIRES box_plan in the same turn + box_list's result carries a contextual nudge; (g) hot-reload could orphan in-flight in-memory consent waiters (dev-only, but real) - requestConsent now polls its DB row every 2s as a durability net (the DB is the source of truth); (h) an abort landing between the executor's loop check and a T3 consent row insert left a pending row forever - requestConsent now re-checks abort before AND after the row insert and freezes instantly; (i) freeze now BROADCASTS consent_result through registered session emitters so cards flip to FROZEN live
- Verified: lint 0/0; server flow re-proven via raw SSE (mode pc -> say -> box_list -> consent_request); screenshots: phase4-desktop-dark.png, phase4-desktop-light.png, phase4-step9-abort.png

Stage Summary:
- The 9-step acceptance test is GREEN end to end through the real console: consent gating (T1 batch, T2 plan card with 4 options, T3 per-action), dry-run-is-the-product, write-ahead journal, single-command undo, and a kill switch that stops the queue, freezes pendings forever, and makes the agent report honestly. Step 6/8/9 all pass - by the directive's own standard, Phase 4 is complete.

---
Task ID: 20.4 (Section 4: the four Phase 3 soft spots CLOSED with permanent regressions)
Agent: main orchestrator (Z.ai Code)
Task: leak regression, consent stacking, loop-death sweep, Cedar & Leaf as permanent

Work Log:
- #1 LEAK REGRESSION (qa/qa-softspots.sh suite 1, scripts/test-phase4-leak.ts) 6/6: browser daemon 10 scoped cycles -> process count 14->14, RSS 1404MB->1407MB (flat, +0.2%); box subsystem 10 exec cycles -> supervised table returns to ZERO, zero OS orphans; Xvfb spawn -> registered -> kill-switch SIGTERM -> table zero + OS process gone
- #2 CONSENT STACKING (scripts/test-phase4-stacking.ts) 14/14: 2xT1 + 1xT3 concurrent -> all stack pending; queue FIFO by request order; T3 (queue #3) answerable while T1s wait - cards are independent; head-expiry fail-closes ONLY its own request (the one behind keeps its own clock); kill-switch freeze resolves all waiters FROZEN and a frozen card can NEVER be answered afterwards. ANSWER TO THE DIRECTIVE'S UX QUESTION: the user sees every request as a separate card in chat + a FIFO queue with tier badges on the DESKTOP panel; answering order is free; each card has its own 120s fail-closed clock; a timeout never auto-decides the requests behind it; ABORT freezes everything pending instantly and permanently
- #3 LOOP-DEATH SWEEP (scripts/test-phase4-loopdeath.ts) 9/9: (a) empty tools array parses + dispatches + turn ends cleanly; (b) unknown tool AND unknown box primitive -> graceful ok=false refusals; (c) critic hanging on an unreachable provider -> bounded ~60s AbortController -> honest 'unverified' receipt (returned in exactly 60.0s); (d) SSE mid-stream drop -> turn stops, rows stabilize (no zombie loop)
- #4 CEDAR & LEAF PERMANENT (scripts/test-cedar-leaf.ts) 13/13: the 7/10 builder + 7/10 critic scenario -> honest 7, disagreement 0 (delta 0), kernel verdicts win the labeled merge; disagreement edges honest (9v7 fires, null builder never, unverified critic never); visual regression deterministic; receipt row persisted so the VERIFY tab shows the regression ran
- qa/qa-softspots.sh runs all four as ONE suite: 4/4 green (42 checks total) - run every round from now on
- REAL KERNEL BUGS THE NEW REGRESSIONS CAUGHT + FIXED:
  (j) SECURITY: decideConsent resolved the in-process waiter with a HARDCODED 'approved' status - a DENIED action would have EXECUTED ANYWAY. Now resolves with the actual outcome (consent.ts)
  (k) FIFO race: concurrent requestConsent calls raced row creation -> queue order undefined. Fixed with a per-session creation chain (consent.ts)
  (l) DURABLE deadline: the 120s fail-closed clock existed only in-memory; the DB poll-back now also enforces the row's own expiresAt (survives hot-reload/multi-process)
  (m) ZOMBIE LOOP: a client disconnecting mid-turn did NOT stop the agent loop (req.signal does not fire reliably for cancelled streams) - the chat route now runs the turn on its own AbortController bridged from BOTH req.signal AND the stream cancel() path (chat/route.ts)

Stage Summary:
- All four Phase 3 soft spots are closed with permanent, repeatable regressions (qa/qa-softspots.sh, 42 checks). The new tests immediately paid for themselves: one security bug (deny-as-approve), one FIFO race, one durability gap, and one zombie-loop bug found and fixed before ship.

---
Task ID: 20.5 (Section 5: OSWorld 352-task roadmap)
Agent: main orchestrator (Z.ai Code)
Task: deliver the roadmap table for all 352 tasks (Task ID | Bucket | Blocker | Fix | Cost)

Work Log:
- DATA PROVENANCE STATED PLAINLY: the OSWorld-V2 payload (/home/z/wh-work/extracted/OSWorld-V2-main) was WIPED by the sandbox reset; loadOsworldIndex() honestly returns available:false with that reason. Per-task row data cannot be regenerated from nothing, and the directive's own rules forbid inflation - so the roadmap ships at bucket+blocker granularity with a scripted regeneration path
- DELIVERED docs/osworld-roadmap.md: A(323) split A1 no-input-backend 128 / A2 no-desktop-apps 96 / A3 file-manager class 71 - UNLOCKABLE TODAY by the Phase 4 Box / A4 deep-OS 28 (17 rewrites + 11 honest non-runs); B(25) evaluator app-state; D(4) bot-walls = permanent honest non-run. Cost table: ~16 eng-days to cover the reachable set once an appliance image exists; A3 is pilotable now
- The Xvfb-unlockable subset is stated EXACTLY: screenshots+segmentation unlock grounding reads only; input primitives fail closed (no xdotool, no root) - documented as such rather than faked

Stage Summary:
- 23.1% now has a starting line: a bucket table with costs, a today-pilotable A3 class covered by the Box, and a one-command regeneration path for the full row-level sheet once the payload returns

---
Task ID: 20.6 (PHASE 4 COMPLETE - final verification battery + ship)
Agent: main orchestrator (Z.ai Code)
Task: final verification, commit, recovery snapshot, standing cron

Work Log:
- FINAL BATTERY: lint 0/0; phase2 unit 28/28 (osworld payload-absent branch now SKIPS with the harness's honest reason instead of failing - env, not code); phase4 kernel unit 47/47; soft-spot suite 4/4 (42 checks); acceptance 19/19 (9/9 steps); dev.log scan clean; artifact preview pipeline regression-green (preview + artifact-file 200); chat SSE proven end-to-end by the acceptance run itself
- SHIPPED: git commit v1.3 (Phase 4 + regressions + roadmap); /home/sync/repo.tar refreshed (2.5MB, 210 entries incl. box kernel, qa suites, docs); standing webDevReview cron created (every 15 min, runs qa/qa-softspots.sh first)
- Phase 4 acceptance criteria from the directive: step 6 (per-action audit) PASS, step 8 (undo) PASS, step 9 (kill switch) PASS -> Phase 4 is COMPLETE by the directive's own standard

Stage Summary:
- AWON v1.3: Permitted PC Control is real, consented, journaled, undoable, and abortable - with the honesty labels a user can audit (path-prison, no input backend, virtual home, heuristic segmentation). All six prohibitions held. Next: Phase 5 multi-agent orchestration (preconditions listed in the final report).

---
Task ID: git-protection (weekly drill, Job ID 440107, 2026-10-06)
Agent: cron git-protection drill
Task: weekly commit / push / tarball / prune / record

Work Log:
- Pushed commit b56239b (chore: capture tool-results artifact [worklog.md Task ID 20.6]) to /home/sync/awon-remote.git main (fast-forward, no force; remote protections held)
- Tarball /home/sync/awon-git-20261006-135224.tgz (8,795,418 bytes, non-empty OK); retention kept newest 2 (<=6), 1 prior tarball from earlier run today

Stage Summary:
- REMOTE OK, TARBALL OK — /home/sync write path healthy; git history protected this cycle (HEAD b56239b)
