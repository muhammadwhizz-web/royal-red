#!/bin/bash
# QA batch runner v0.7 E2E take 2 — CSS selectors + boot-overlay-gone assertions
set -u
cd /home/z/my-project
mkdir -p qa-shots
SHOT=qa-shots/v07b-$(date +%H%M%S)

echo "=== [1] dev server ==="
setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
CODE=000
for i in $(seq 1 40); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "server up after ~$((i*3))s"; break; fi
done
[ "$CODE" = "200" ] || { echo "FATAL: server never came up"; exit 1; }

echo "=== [2] browser: boot overlay ==="
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then OK=1; echo "boot overlay ready after ~$((i*3))s"; break; fi
done
[ "$OK" = "1" ] || { echo "FAIL: INITIALIZE never appeared"; exit 1; }

echo "=== [3] INITIALIZE real click (hit-target proof) ==="
agent-browser click "button.awon-glow" 2>&1 | head -2
sleep 1.5
GONE=$(agent-browser eval "!document.body.innerText.includes('all systems nominal')" 2>/dev/null | tail -1)
[ "$GONE" = "true" ] && echo "PASS: boot overlay dismissed by click" || echo "FAIL: boot overlay still visible"
agent-browser screenshot $SHOT-console.png >/dev/null 2>&1

echo "=== [4] console shell checks ==="
V=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$V" | rg -q "AWON V0.7 / SANDBOXED" && echo "PASS: footer v0.7" || echo "FAIL: footer"
echo "$V" | rg -q "command AWON" && echo "PASS: composer placeholder visible" || echo "FAIL: composer"
echo "$V" | rg -q "EXAMINE AN ATTACHMENT\|ASK ABOUT\|BUILD" && echo "PASS: starter area" || echo "INFO: starter cards state unclear"

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
[ "$DONE" = "1" ] && echo "PASS: turn stats line" || echo "FAIL: no turn stats"
PAGE=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$PAGE" | rg -q "AWON ONLINE" && echo "PASS: assistant replied" || echo "WARN: reply variance"

echo "=== [6] sessions sheet via CSS aria selector ==="
agent-browser click '[aria-label="Session history"]' 2>&1 | head -2
sleep 1.5
SH=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$SH" | rg -q "NEW SESSION" && echo "PASS: sessions sheet open" || echo "FAIL: sheet did not open"
echo "$SH" | rg -q "filter sessions" && echo "PASS: filter input present" || echo "FAIL: filter missing"
agent-browser screenshot $SHOT-sessions.png >/dev/null 2>&1
# pin newest via real DOM click (row hover controls are opacity-0 until hover)
agent-browser eval "var b=document.querySelector('[aria-label^=\"Pin session\"]'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1.5
SH2=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$SH2" | rg -q "PINNED" && echo "PASS: PINNED label appears" || echo "FAIL: pin failed"
agent-browser screenshot $SHOT-pinned.png >/dev/null 2>&1
agent-browser eval "var b=document.querySelector('[aria-label^=\"Unpin session\"]'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1
PCOUNT=$(curl -s --max-time 20 http://localhost:3000/api/awon/session | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for s in d['sessions'] if s['pinned']))" 2>/dev/null)
echo "pinned count after unpin (API): $PCOUNT"
agent-browser press Escape >/dev/null 2>&1
sleep 1

echo "=== [7] palette + theme via palette action ==="
agent-browser press Control+k >/dev/null 2>&1
sleep 1
agent-browser keyboard type "light" >/dev/null 2>&1
sleep 0.5
agent-browser press Enter >/dev/null 2>&1
sleep 1.5
THEME=$(agent-browser eval "document.documentElement.className" 2>/dev/null | tail -1)
echo "html class after palette light switch: $THEME"
echo "$THEME" | rg -q "dark" && echo "FAIL: still dark" || echo "PASS: light mode active"
agent-browser screenshot $SHOT-light.png >/dev/null 2>&1
# back to dark via header toggle real click
agent-browser click '[aria-label="Toggle dark or light mode"]' 2>&1 | head -1
sleep 1
THEME2=$(agent-browser eval "document.documentElement.className" 2>/dev/null | tail -1)
echo "html class after toggle back: $THEME2"
echo "$THEME2" | rg -q "dark" && echo "PASS: dark restored" || echo "FAIL: dark not restored"
agent-browser screenshot $SHOT-dark-final.png >/dev/null 2>&1

echo "=== [8] session chip in header ==="
CHIP=$(agent-browser eval "var s=document.querySelector('header span[title]'); s? s.getAttribute('title') : 'none'" 2>/dev/null | tail -1)
echo "header chip title: $CHIP"

echo "=== [9] cleanup + log scan ==="
agent-browser close --all >/dev/null 2>&1
tail -60 dev.log | rg -i "error|panic|unhandled" | rg -v "GET |POST " | head -8 || echo "no errors in dev.log tail"
echo "=== QA2 COMPLETE ==="
ls qa-shots/ | tail -8
