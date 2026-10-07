#!/bin/bash
# ROYAL RED v1.2 E2E - Phase 2 Verification 2.0 (constraint ledger, adversarial
# critique, visual regression, cms proof, benchmark harness, provider config)
AB="agent-browser"
PASS=0; FAIL=0
ck() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ok $2"; else FAIL=$((FAIL+1)); echo "  FAIL $2"; fi }
# Radix tabs need the full pointer sequence; single .click() is a no-op
click_tab() {
  $AB eval "var L=document.querySelectorAll('[role=tab]'); var t=null; for(var i=0;i<L.length;i++){ if(L[i].textContent==='$1'){ t=L[i]; break } } if(t){ var r=t.getBoundingClientRect(); var o={bubbles:true,cancelable:true,view:window,clientX:r.x+r.width/2,clientY:r.y+r.height/2}; t.dispatchEvent(new PointerEvent('pointerdown',o)); t.dispatchEvent(new MouseEvent('mousedown',o)); t.dispatchEvent(new PointerEvent('pointerup',o)); t.dispatchEvent(new MouseEvent('mouseup',o)); t.dispatchEvent(new MouseEvent('click',o)); 'dispatched' } else { 'no tab' }" >/dev/null 2>&1
  sleep 2
}

echo "== unit layer =="
bun --env-file=.env scripts/test-phase2.ts > /tmp/v12-unit.txt 2>&1
grep -q "33 passed, 0 failed" /tmp/v12-unit.txt && ck 0 "kernel unit tests 33/33" || ck 1 "kernel unit tests: $(tail -1 /tmp/v12-unit.txt)"

echo "== console boot =="
# NOTE: no `close` here - closing leaves the daemon flaky on relaunch; open
# reuses the running browser instead. Wait for the boot overlay with retries.
$AB open http://localhost:3000/ >/dev/null 2>&1
BOOT=1
for i in 1 2 3 4 5 6; do
  sleep 4
  if $AB read 2>/dev/null | grep -q "royal red kernel v1.2.0"; then BOOT=0; break; fi
  $AB open http://localhost:3000/ >/dev/null 2>&1
done
[ $BOOT = 0 ] && ck 0 "boot overlay shows v1.2.0" || ck 1 "boot overlay v1.2.0"
sleep 5
$AB read 2>/dev/null | grep -q "constraint ledger: extracting testable assertions" && ck 0 "boot line: constraint ledger" || ck 1 "boot line: constraint ledger"
$AB read 2>/dev/null | grep -q "verification 2.0: adversarial critic" && ck 0 "boot line: verification 2.0" || ck 1 "boot line: verification 2.0"
$AB eval "var out='none'; var L=document.querySelectorAll('button'); for(var i=0;i<L.length;i++){var x=L[i]; if(String(x.textContent).toLowerCase().indexOf('initialize')>-1){x.click();out='clicked';break}} out" >/dev/null 2>&1; sleep 2

echo "== verify tab + receipts (tempo session) =="
# open the Tempo session via the sessions sheet (keyboard-free)
$AB eval "var L=document.querySelectorAll('button'); for(var i=0;i<L.length;i++){ if(String(L[i].getAttribute('aria-label')||'').toLowerCase().indexOf('session history')>-1){ L[i].click(); break } } 'ok'" >/dev/null 2>&1; sleep 1.5
$AB eval "var dlg=document.querySelector('[role=dialog]'); var out='nodialog'; if(dlg){ var L=dlg.querySelectorAll('button'); for(var i=0;i<L.length;i++){ if(String(L[i].textContent).toLowerCase().indexOf('pomodoro timer website')>-1){ L[i].click(); out='clicked'; break } } } out" >/dev/null 2>&1; sleep 3.5
click_tab VERIFY
TXT=$($AB read 2>/dev/null)
echo "$TXT" | grep -q "VERIFICATION 2.0" && ck 0 "verify tab dashboard renders" || ck 1 "verify tab dashboard renders"
echo "$TXT" | grep -q "proof-testing tempo-pomodoro-site" && ck 0 "dashboard bound to tempo artifact" || ck 1 "dashboard bound to tempo artifact"
echo "$TXT" | grep -q "honest score 0/10" && ck 0 "honest score = min(builder 0, critic 5) = 0" || ck 1 "honest score 0/10 shown"
echo "$TXT" | grep -qE "[0-9.]+critic" && ck 0 "critic score rendered (vs builder)" || ck 1 "critic score rendered"
echo "$TXT" | grep -q "SAME-FAMILY, FRESH CONTEXT" && ck 0 "critique independence mode labeled honestly" || ck 1 "critique independence mode labeled"
echo "$TXT" | grep -q "constraint ledger" && ck 0 "ledger section renders" || ck 1 "ledger section renders"
echo "$TXT" | grep -qi "no em dashes in copy" && ck 0 "per-constraint receipt visible (C8 kernel check)" || ck 1 "per-constraint receipt C8"
echo "$TXT" | grep -qi "kernel:" && ck 0 "deterministic verdicts labeled 'kernel:'" || ck 1 "deterministic verdicts labeled"
echo "$TXT" | grep -qi "critic:" && ck 0 "semantic verdicts labeled 'critic:'" || ck 1 "semantic verdicts labeled"
echo "$TXT" | grep -qE "hamming|new baseline stored" && ck 0 "visual regression receipts render" || ck 1 "visual regression receipts"
echo "$TXT" | grep -q "this artifact ships no cms page" && ck 0 "cms section honest when absent" || ck 1 "cms honest absence"
echo "$TXT" | grep -q "CRITIC MODEL" && ck 0 "critic model config section" || ck 1 "critic model config section"

echo "== ledger card restored in chat =="
# probe verify-shot imgs BEFORE switching away (probe switches to VERIFY itself)
IMG=$(bun scripts/probe-verify-img.ts 2>/dev/null | tail -1 | tr -d '"')
if [ -n "$IMG" ] && [ "$IMG" != "" ]; then
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${IMG}")
  [ "$CODE" = "200" ] && ck 0 "verify-shot serves stored screenshot (200)" || ck 1 "verify-shot status $CODE"
else
  ck 1 "no verify-shot img found in dashboard"
fi
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000/api/royal-red/verify-shot?run=..%2Fetc&name=desktop.png")
[ "$CODE" = "400" ] && ck 0 "verify-shot rejects traversal (400)" || ck 1 "verify-shot traversal guard: $CODE"

click_tab PREVIEW
$AB read 2>/dev/null | grep -q "constraint ledger (10)" && ck 0 "constraint ledger card restored in chat stream" || ck 1 "constraint ledger card in chat"

echo "== provider config =="
P=$(curl -s -X POST "http://localhost:3000/api/royal-red/providers" -H "content-type: application/json" -d '{"provider":"anthropic","label":"qa-critic","baseUrl":"https://api.anthropic.com","model":"claude-qa","apiKey":"sk-ant-qa-test-9999"}')
echo "$P" | grep -q '"keyHint":"sk-...9999"' && ck 0 "provider key stored + masked hint" || ck 1 "provider masked hint: $P"
echo "$P" | grep -qv '"apiKeyEnc"' && ck 0 "raw key never returned by API" || ck 1 "raw key leaked"
BAD=$(curl -s -X POST "http://localhost:3000/api/royal-red/providers" -H "content-type: application/json" -d '{"provider":"openai","label":"x","baseUrl":"http://evil.example.com","model":"m","apiKey":"k"}')
echo "$BAD" | grep -q "error" && ck 0 "plaintext http baseUrl rejected" || ck 1 "http baseUrl guard"
PID=$(echo "$P" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
curl -s -X DELETE "http://localhost:3000/api/royal-red/providers?id=$PID" | grep -q '"ok":true' && ck 0 "provider delete ok" || ck 1 "provider delete"

echo "== regression sweep =="
click_tab PREVIEW
$AB read 2>/dev/null | grep -qi "Pomodoro Timer Website" && ck 0 "tempo session loaded (header title)" || ck 1 "tempo session loaded"
# /help lists new commands
$AB eval "var I=document.querySelector('textarea, input[placeholder*=command]'); if(I){I.focus()} 'ok'" >/dev/null 2>&1
$AB keyboard type "/help" >/dev/null 2>&1; $AB press Enter >/dev/null 2>&1; sleep 1.5
$AB read 2>/dev/null | grep -q "/verify benchmark" && ck 0 "/help lists /verify + benchmark" || ck 1 "/help lists /verify"
# footer version
$AB read 2>/dev/null | grep -q "ROYAL RED V1.2" && ck 0 "footer shows V1.2" || ck 1 "footer V1.2"
# light mode sanity screenshot
$AB eval "document.documentElement.classList.remove('dark')" >/dev/null 2>&1; sleep 1
$AB screenshot /tmp/v12-final-light.png >/dev/null 2>&1 && ck 0 "light-mode screenshot saved" || ck 1 "screenshot"

echo ""
echo "RESULT: PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
