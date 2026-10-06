#!/bin/bash
# QA batch runner v0.7 E2E — runs entirely inside one invocation because the
# sandbox reaps processes between tool calls (dev server + browser included).
set -u
cd /home/z/my-project
mkdir -p qa-shots
SHOT=qa-shots/v07-$(date +%H%M%S)

echo "=== [1] dev server ==="
setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
CODE=000
for i in $(seq 1 40); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "server up after ~$((i*3))s"; break; fi
done
if [ "$CODE" != "200" ]; then echo "FATAL: server never came up"; tail -20 dev.log; exit 1; fi

echo "=== [2] API smoke ==="
SESSIONS=$(curl -s --max-time 20 http://localhost:3000/api/awon/session)
echo "$SESSIONS" | head -c 500; echo
echo "$SESSIONS" | rg -q '"pinned"' && echo "PASS: sessions API has pinned field" || echo "FAIL: pinned field missing"
NEWEST=$(echo "$SESSIONS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessions'][0]['id'] if d.get('sessions') else '')" 2>/dev/null)
echo "newest session id: $NEWEST"
if [ -n "$NEWEST" ]; then
  EXP=$(curl -s --max-time 20 "http://localhost:3000/api/awon/session/$NEWEST/export")
  echo "$EXP" | head -c 300; echo
  echo "$EXP" | rg -q '^# ' && echo "PASS: export markdown has title header" || echo "FAIL: export markdown malformed"
fi

echo "=== [3] browser: boot overlay ==="
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then OK=1; echo "boot overlay ready after ~$((i*3))s"; break; fi
done
if [ "$OK" != "1" ]; then echo "FAIL: INITIALIZE never appeared"; agent-browser screenshot $SHOT-boot-fail.png; exit 1; fi
agent-browser screenshot $SHOT-boot.png >/dev/null 2>&1
BOOT=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$BOOT" | rg -q "pinning session index" && echo "PASS: boot line v0.7 present" || echo "FAIL: v0.7 boot line missing"
echo "$BOOT" | rg -q "all systems nominal" && echo "PASS: boot completes" || echo "FAIL: boot incomplete"

echo "=== [4] INITIALIZE + console shell ==="
agent-browser click "text=INITIALIZE" >/dev/null 2>&1
sleep 2
SHELL=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$SHELL" | rg -q "OS WITHIN OS" && echo "PASS: header signature visible" || echo "FAIL: header missing"
echo "$SHELL" | rg -q "AWON V0.7" && echo "PASS: footer v0.7" || echo "FAIL: footer version wrong"
echo "$SHELL" | rg -q "BUILD" && echo "PASS: mode chips visible" || echo "FAIL: mode chips missing"

echo "=== [5] live chat round trip (SSE + turn stats) ==="
agent-browser fill "textarea" "/ask Reply with exactly: AWON ONLINE" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 2
DONE=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then DONE=1; echo "turn completed after ~$((i*3))s"; break; fi
done
if [ "$DONE" = "1" ]; then
  echo "PASS: turn stats line rendered"
  STATS=$(agent-browser eval "var el=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&/turn complete/.test(e.textContent)); el?el.textContent:'none'" 2>/dev/null | tail -1)
  echo "stats line: $STATS"
else
  echo "FAIL: no turn stats line within 120s"
  agent-browser screenshot $SHOT-chat-stuck.png >/dev/null 2>&1
fi
PAGE=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$PAGE" | rg -q "AWON ONLINE" && echo "PASS: assistant replied" || echo "WARN: reply text not found (model variance)"
echo "$PAGE" | rg -q "web_search|web search" && echo "INFO: tool rows present" || echo "INFO: no tool rows"

echo "=== [6] header session chip + auto title ==="
CHIP=$(agent-browser eval "!!document.querySelector('header span[title]')" 2>/dev/null | tail -1)
echo "header chip present: $CHIP"
sleep 8   # auto-title fires post-done
T=$(curl -s --max-time 20 http://localhost:3000/api/awon/session | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['sessions'][0]['title'] if d.get('sessions') else '')" 2>/dev/null)
echo "newest session title: $T"

echo "=== [7] command palette (Ctrl+K) ==="
agent-browser press Control+k >/dev/null 2>&1
sleep 1
PAL=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$PAL" | rg -q "ACTIONS" && echo "PASS: palette ACTIONS section" || echo "FAIL: palette missing ACTIONS"
echo "$PAL" | rg -q "RECENT SESSIONS" && echo "PASS: palette RECENT SESSIONS" || echo "FAIL: palette missing sessions"
agent-browser screenshot $SHOT-palette.png >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1

echo "=== [8] sessions sheet: pin / export / filter ==="
agent-browser click "aria-label=Session history" >/dev/null 2>&1
sleep 1.5
SHEET=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$SHEET" | rg -q "NEW SESSION" && echo "PASS: sessions sheet open" || echo "FAIL: sheet missing"
# pin the first (newest) session
agent-browser eval "var b=document.querySelector('[aria-label^=\"Pin session\"]'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1.5
SHEET2=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$SHEET2" | rg -q "PINNED" && echo "PASS: PINNED section label appears" || echo "FAIL: pin did not apply"
agent-browser screenshot $SHOT-sessions-pinned.png >/dev/null 2>&1
# restore: unpin
agent-browser eval "var b=document.querySelector('[aria-label^=\"Unpin session\"]'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1
PINNED_API=$(curl -s --max-time 20 http://localhost:3000/api/awon/session | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for s in d['sessions'] if s['pinned']))" 2>/dev/null)
echo "pinned count after unpin: $PINNED_API"
agent-browser press Escape >/dev/null 2>&1

echo "=== [9] theme toggle (light mode) ==="
agent-browser click "aria-label=Toggle dark or light mode" >/dev/null 2>&1
sleep 1.5
agent-browser screenshot $SHOT-light.png >/dev/null 2>&1
THEME=$(agent-browser eval "document.documentElement.className" 2>/dev/null | tail -1)
echo "html class after toggle: $THEME"
agent-browser click "aria-label=Toggle dark or light mode" >/dev/null 2>&1
sleep 1
agent-browser screenshot $SHOT-dark-final.png >/dev/null 2>&1

echo "=== [10] cleanup ==="
agent-browser close --all >/dev/null 2>&1

echo "=== [11] dev.log error scan (this run) ==="
tail -80 dev.log | rg -i "error|panic|fail" | rg -v "GET|POST" | head -10 || echo "no recent errors in dev.log"

echo "=== QA RUN COMPLETE ==="
ls -la qa-shots/ | tail -8
