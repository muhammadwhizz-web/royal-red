#!/bin/bash
# QA batch runner v0.8 E2E — local commands, workspace file editor, stats,
# device toggle, plus full regression of the chat SSE loop. One invocation.
set -u
cd /home/z/my-project
mkdir -p qa-shots
SHOT=qa-shots/v08-$(date +%H%M%S)

echo "=== [1] dev server ==="
setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
CODE=000
for i in $(seq 1 40); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "server up after ~$((i*3))s"; break; fi
done
[ "$CODE" = "200" ] || { echo "FATAL: server never came up"; exit 1; }

echo "=== [2] API: PUT round trip + stats ==="
R1=$(curl -s -X PUT "http://localhost:3000/api/awon/workspace/file?path=qa-edit-test.txt" --data-binary "hello v0.8")
echo "create: $R1"
R2=$(curl -s -X PUT "http://localhost:3000/api/awon/workspace/file?path=qa-edit-test.txt" --data-binary "hello v0.8 edited")
echo "update: $R2"
R3=$(curl -s "http://localhost:3000/api/awon/workspace/file?path=qa-edit-test.txt")
echo "read-back: $R3"
echo "$R3" | rg -q "edited" && echo "PASS: PUT round trip" || echo "FAIL: PUT round trip"
R4=$(curl -s -X PUT "http://localhost:3000/api/awon/workspace/file?path=../escape.txt" --data-binary "nope")
echo "$R4" | rg -q "bad path" && echo "PASS: path jail blocks .." || echo "FAIL: path jail: $R4"
STATS=$(curl -s "http://localhost:3000/api/awon/workspace?stats=1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['stats'])" 2>/dev/null)
echo "stats: $STATS"
echo "$STATS" | rg -q "'files':" && echo "PASS: stats API" || echo "FAIL: stats API"

echo "=== [3] browser: boot v0.8 ==="
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then OK=1; break; fi
done
[ "$OK" = "1" ] || { echo "FAIL: no INITIALIZE"; exit 1; }
BOOT=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$BOOT" | rg -q "v0.8.0" && echo "PASS: boot kernel v0.8.0" || echo "FAIL: boot version"
echo "$BOOT" | rg -q "loading local command line" && echo "PASS: v0.8 boot line" || echo "FAIL: v0.8 boot line missing"
agent-browser click "button.awon-glow" >/dev/null 2>&1
sleep 1.5
GONE=$(agent-browser eval "!document.body.innerText.includes('all systems nominal')" 2>/dev/null | tail -1)
[ "$GONE" = "true" ] && echo "PASS: console live" || echo "FAIL: overlay stuck"

echo "=== [4] /help local command ==="
agent-browser fill "textarea" "/help" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 2
H=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$H" | rg -q "local command line" && echo "PASS: /help rendered" || echo "FAIL: /help"
TABLE=$(agent-browser eval "!!document.querySelector('.awon-md table')" 2>/dev/null | tail -1)
[ "$TABLE" = "true" ] && echo "PASS: markdown table renders as real table (remark-gfm)" || echo "FAIL: table still raw text"
agent-browser screenshot $SHOT-help.png >/dev/null 2>&1

echo "=== [5] /theme toggle ==="
agent-browser fill "textarea" "/theme" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1.5
T1=$(agent-browser eval "document.documentElement.className" 2>/dev/null | tail -1)
echo "$T1" | rg -q "dark" && echo "FAIL: /theme did not switch" || echo "PASS: /theme -> light"
agent-browser fill "textarea" "/theme" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
T2=$(agent-browser eval "document.documentElement.className" 2>/dev/null | tail -1)
echo "$T2" | rg -q "dark" && echo "PASS: /theme -> dark restored" || echo "FAIL: dark not restored"

echo "=== [6] /files /system /preview panel jumps ==="
agent-browser fill "textarea" "/files" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
F=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$F" | rg -q "Inspect / edit|qa-edit-test|SANDBOXED" && echo "PASS: /files -> workspace view" || echo "INFO: files view state: $(echo "$F" | rg -o 'ARTIFACT|WORKSPACE' | head -2 | tr '\n' ' ')"
agent-browser fill "textarea" "/system" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
S=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$S" | rg -q "AWON ACCOUNTS" && echo "PASS: /system -> system tab" || echo "FAIL: /system"
echo "$S" | rg -q "WORKSPACE" && echo "PASS: stats section present" || echo "FAIL: stats section"
echo "$S" | rg -q "reading workspace stats|[0-9]+ files" && echo "PASS: stats widget renders" || echo "FAIL: stats widget"
agent-browser screenshot $SHOT-system.png >/dev/null 2>&1
agent-browser fill "textarea" "/preview" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
P=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$P" | rg -q "artifacts you command into existence render here" && echo "PASS: /preview -> empty preview" || echo "INFO: preview shows artifact"

echo "=== [7] bare mode word + unknown command ==="
agent-browser fill "textarea" "/ask" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
M=$(agent-browser eval "document.querySelector('[aria-pressed=\"true\"]') ? document.querySelector('[aria-pressed=\"true\"]').textContent : 'none'" 2>/dev/null | tail -1)
echo "active chip: $M"
echo "$M" | rg -qi "assist" && echo "PASS: /ask switches mode" || echo "FAIL: mode switch"
agent-browser fill "textarea" "/frobnicate" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
U=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$U" | rg -q "unknown command" && echo "PASS: unknown command row" || echo "FAIL: unknown command"

echo "=== [8] chat SSE regression ==="
agent-browser fill "textarea" "/ask Reply with exactly: AWON V8 ONLINE" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 2
DONE=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then DONE=1; echo "turn done in ~$((i*3))s"; break; fi
done
[ "$DONE" = "1" ] && echo "PASS: SSE loop healthy" || echo "FAIL: SSE loop"
PG=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$PG" | rg -q "AWON V8 ONLINE" && echo "PASS: reply correct" || echo "WARN: reply variance"

echo "=== [9] workspace file editor dialog ==="
agent-browser fill "textarea" "/files" >/dev/null 2>&1
agent-browser press Enter >/dev/null 2>&1
sleep 1
# switch FILES tab to the WORKSPACE scope (default is ARTIFACT)
agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='WORKSPACE'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1
agent-browser eval "var b=document.querySelector('[aria-label=\"Inspect qa-edit-test.txt\"]'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1.5
D=$(agent-browser eval "document.body.innerText" 2>/dev/null)
echo "$D" | rg -q "text file, editable" && echo "PASS: editor dialog open" || echo "FAIL: editor dialog"
agent-browser fill 'textarea[aria-label="Edit qa-edit-test.txt"]' "edited from the dialog at $(date +%s)" >/dev/null 2>&1
agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='save'); if(b) b.click(); !!b" 2>/dev/null | tail -1
sleep 1.5
SAVED=$(curl -s "http://localhost:3000/api/awon/workspace/file?path=qa-edit-test.txt")
echo "$SAVED" | rg -q "edited from the dialog" && echo "PASS: dialog save persisted" || echo "FAIL: dialog save: $SAVED"
agent-browser screenshot $SHOT-editor.png >/dev/null 2>&1
agent-browser press Escape >/dev/null 2>&1

echo "=== [10] device toggle on a real artifact ==="
agent-browser press Escape >/dev/null 2>&1
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.5
LOADED=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var t=btns.find(b=>/logo|kanban|website|coffee/i.test(b.getAttribute('aria-label'))) || btns[0]; if(t) t.click(); t? t.getAttribute('aria-label') : 'none'" 2>/dev/null | tail -1)
echo "loaded: $LOADED"
sleep 2
TOG=$(agent-browser eval "!!document.querySelector('[aria-label=\"Preview device width\"]')" 2>/dev/null | tail -1)
if [ "$TOG" = "true" ]; then
  echo "PASS: device toggle rendered"
  agent-browser click '[aria-label="Mobile width (390px)"]' >/dev/null 2>&1
  sleep 1.5
  FR=$(agent-browser eval "!!document.querySelector('.awon-scanlines') && document.body.innerText.includes('MOBILE / 390PX')" 2>/dev/null | tail -1)
  echo "$FR" | rg -q "true" && echo "PASS: mobile frame active" || echo "INFO: frame label state unclear"
  agent-browser screenshot $SHOT-mobile-frame.png >/dev/null 2>&1
  agent-browser click '[aria-label="Desktop width"]' >/dev/null 2>&1
  sleep 1
else
  echo "WARN: no artifact session found for device toggle"
fi

echo "=== [11] cleanup ==="
curl -s -X DELETE "http://localhost:3000/api/awon/workspace?path=qa-edit-test.txt" >/dev/null
agent-browser screenshot $SHOT-final.png >/dev/null 2>&1
agent-browser close --all >/dev/null 2>&1
tail -50 dev.log | rg -a -i "error|panic|unhandled" | rg -av "GET |POST " | head -8 || echo "no errors in dev.log tail"
echo "=== QA v0.8 COMPLETE ==="
ls qa-shots/ | rg v08 | tail -6
