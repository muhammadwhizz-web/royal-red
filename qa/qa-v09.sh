#!/bin/bash
# v0.9 E2E: /stats, /files workspace, /theme actual report, /help table,
# sessions mode filter + date groups, jump-to-latest pill, preview skeleton regression
set -u
cd /home/z/my-project
SHOT=qa-shots/v09-$(date +%H%M%S)
mkdir -p qa-shots

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null)
[ "$CODE" = "200" ] || { echo "FATAL: server down ($CODE)"; exit 1; }
echo "server up"

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 30); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { OK=1; break; }
done
[ "$OK" = "1" ] || { echo "FAIL: no overlay"; agent-browser close --all >/dev/null 2>&1; exit 1; }
V9=$(agent-browser eval "document.body.innerText.includes('v0.9.0') && document.body.innerText.includes('console telemetry')" 2>/dev/null | tail -1)
[ "$V9" = "true" ] && echo "PASS: boot overlay v0.9 lines" || echo "FAIL: boot overlay v0.9 lines"
sleep 1
agent-browser click "button.awon-glow" >/dev/null 2>&1
sleep 2.5

# helper: push a command through the composer
send_cmd() {
  agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'$1'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
  agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
}

# --- /stats ---
send_cmd '/stats'
sleep 3
S=$(agent-browser eval "document.body.innerText.includes('console stats') && document.body.innerText.includes('sessions on record') && document.body.innerText.includes('workspace mix')" 2>/dev/null | tail -1)
[ "$S" = "true" ] && echo "PASS: /stats telemetry card" || echo "FAIL: /stats card ($S)"
agent-browser screenshot $SHOT-stats.png >/dev/null 2>&1

# --- /files workspace deep link ---
send_cmd '/files workspace'
sleep 2
F=$(agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('WORKSPACE')); b? b.getAttribute('aria-pressed') : 'nobtn'" 2>/dev/null | tail -1)
[ "$F" = "true" ] && echo "PASS: /files workspace lands on WORKSPACE scope" || echo "FAIL: /files scope ($F)"
WS=$(agent-browser eval "document.body.innerText.includes('SANDBOXED')" 2>/dev/null | tail -1)
[ "$WS" = "true" ] && echo "PASS: workspace browser header visible" || echo "WARN: workspace header text"

# --- /theme actual report ---
BEFORE=$(agent-browser eval "document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
send_cmd '/theme'
sleep 2
AFTER=$(agent-browser eval "document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
[ "$BEFORE" != "$AFTER" ] && echo "PASS: /theme flips surface ($BEFORE->$AFTER)" || echo "FAIL: /theme flip"
if [ "$AFTER" = "false" ]; then EXPECT='light mode'; else EXPECT='dark mode'; fi
T=$(agent-browser eval "document.body.innerText.includes('console surface switched to $EXPECT')" 2>/dev/null | tail -1)
[ "$T" = "true" ] && echo "PASS: /theme row reports actual theme ($EXPECT)" || echo "FAIL: /theme report ($EXPECT)"
agent-browser screenshot $SHOT-theme.png >/dev/null 2>&1
send_cmd '/theme'
sleep 1.5

# --- /help table rows ---
send_cmd '/help'
sleep 1.5
H=$(agent-browser eval "document.body.innerText.includes('/stats') && document.body.innerText.includes('/files workspace')" 2>/dev/null | tail -1)
[ "$H" = "true" ] && echo "PASS: /help lists new commands" || echo "FAIL: /help rows"

# --- /ask regression (SSE loop untouched) ---
send_cmd '/ask Say hi in exactly three words.'
DONE=0
for i in $(seq 1 30); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { DONE=1; break; }
done
[ "$DONE" = "1" ] && echo "PASS: /ask round trip after changes" || echo "FAIL: /ask round trip"

# --- sessions sheet: mode chips + date groups ---
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.5
G=$(agent-browser eval "['PINNED','TODAY','YESTERDAY','THIS WEEK','EARLIER'].some(l=>document.body.innerText.includes(l))" 2>/dev/null | tail -1)
[ "$G" = "true" ] && echo "PASS: date group labels render" || echo "FAIL: date groups"
CHIPS=$(agent-browser eval "var b=[...document.querySelectorAll('button')].filter(x=>['ALL','BUILD','RESEARCH','PC','ASK'].includes(x.textContent.trim())); b.length" 2>/dev/null | tail -1)
[ "$CHIPS" = "5" ] && echo "PASS: mode filter chips (5)" || echo "FAIL: chips ($CHIPS)"
agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='RESEARCH'); b && b.click(); 'ok'" >/dev/null 2>&1
sleep 1
CNT=$(agent-browser eval "document.body.innerText.includes('of') && /of [0-9]+ sessions/.test(document.body.innerText)" 2>/dev/null | tail -1)
[ "$CNT" = "true" ] && echo "PASS: mode filter counter appears" || echo "FAIL: filter counter"
RESETCH=$(agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='ALL'); b && b.click(); 'ok'" >/dev/null 2>&1)
agent-browser press Escape >/dev/null 2>&1
sleep 1

# --- jump to latest pill on a long session ---
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.5
PICK=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var t=btns.find(b=>/gallery|logo|kanban|website|coffee/i.test(b.getAttribute('aria-label'))); if(t){t.click(); t.getAttribute('aria-label').slice(0,60)}else{'none'}" 2>/dev/null | tail -1)
echo "picked: $PICK"
sleep 3
agent-browser eval "var el=document.querySelector('[aria-label=\"AWON conversation\"]'); el.scrollTop=0; 'scrolled'" >/dev/null 2>&1
sleep 1
PILL=$(agent-browser eval "!!document.querySelector('[aria-label=\"Jump to the latest message\"]')" 2>/dev/null | tail -1)
[ "$PILL" = "true" ] && echo "PASS: jump-to-latest pill appears when scrolled up" || echo "FAIL: jump pill"
agent-browser click '[aria-label="Jump to the latest message"]' >/dev/null 2>&1
sleep 2
ATB=$(agent-browser eval "var el=document.querySelector('[aria-label=\"AWON conversation\"]'); (el.scrollHeight-el.scrollTop-el.clientHeight) < 120" 2>/dev/null | tail -1)
[ "$ATB" = "true" ] && echo "PASS: jump scrolls back to bottom" || echo "FAIL: jump scroll"

# --- preview regression: device frames + iframe still fine ---
FRAME=$(agent-browser eval "!!document.querySelector('[aria-label=\"Preview device width\"]')" 2>/dev/null | tail -1)
[ "$FRAME" = "true" ] && echo "PASS: device frames intact" || echo "FAIL: device frames"
IFR=$(agent-browser eval "var f=document.querySelector('iframe[title=\"AWON artifact preview\"]'); f? (f.clientWidth>100) : 'noiframe'" 2>/dev/null | tail -1)
[ "$IFR" = "true" ] && echo "PASS: preview iframe sized and visible" || echo "FAIL: preview iframe ($IFR)"
agent-browser screenshot $SHOT-preview.png >/dev/null 2>&1

agent-browser close --all >/dev/null 2>&1
echo "=== V0.9 E2E DONE ==="
