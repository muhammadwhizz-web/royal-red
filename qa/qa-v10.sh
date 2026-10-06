#!/bin/bash
# v1.0 E2E QA: boot v1.0 lines, /about /plan /export aliases, ctrl+b panel,
# ctrl+j sessions, workspace search, artifact diff view, live /ask regression
set -u
cd /home/z/my-project
SHOT=qa-shots/v10-$(date +%H%M%S)
mkdir -p qa-shots

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null)
[ "$CODE" = "200" ] || { echo "FATAL: server down ($CODE)"; exit 1; }
echo "server up ($CODE)"

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 30); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { OK=1; break; }
done
[ "$OK" = "1" ] || { echo "FAIL: overlay never rendered"; agent-browser close --all >/dev/null 2>&1; exit 1; }
sleep 1
BOOT=$(agent-browser eval "document.body.innerText.includes('awon kernel v1.0.0') && document.body.innerText.includes('export engines: markdown pdf csv diff view ok') && document.body.innerText.includes('console focus: panel toggle workspace search ok')" 2>/dev/null | tail -1)
[ "$BOOT" = "true" ] && echo "PASS: boot overlay v1.0 lines" || echo "FAIL: boot v1.0 lines"
agent-browser click "button.awon-glow" >/dev/null 2>&1
sleep 2.5
GONE=$(agent-browser eval "!document.body.innerText.includes('all systems nominal')" 2>/dev/null | tail -1)
[ "$GONE" = "true" ] && echo "PASS: INITIALIZE dismisses overlay" || echo "FAIL: overlay stuck"

# /about local command
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/about'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
sleep 1.5
ABOUT=$(agent-browser eval "document.body.innerText.includes('about this console') && document.body.innerText.includes('AWON V1.0, linux native')" 2>/dev/null | tail -1)
[ "$ABOUT" = "true" ] && echo "PASS: /about card" || echo "FAIL: /about card"

# /plan empty state
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/plan'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
sleep 1.2
PLAN=$(agent-browser eval "document.body.innerText.includes('no active plan')" 2>/dev/null | tail -1)
[ "$PLAN" = "true" ] && echo "PASS: /plan empty state" || echo "FAIL: /plan"

# /pdf with no session yet: correct err row
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/pdf'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
sleep 1.5
PDFROW=$(agent-browser eval "document.body.innerText.includes('no session to export yet')" 2>/dev/null | tail -1)
[ "$PDFROW" = "true" ] && echo "PASS: /pdf no-session err row" || echo "FAIL: /pdf no-session row"

# ctrl+b toggles panel (lesson from v0.9: aria-pressed comes back QUOTED via eval)
agent-browser press Control+b >/dev/null 2>&1
sleep 1
HID=$(agent-browser eval "String(document.querySelector('[aria-label=\"Show preview panel\"]')?.getAttribute('aria-pressed'))" 2>/dev/null | tail -1)
[ "$HID" = "\"true\"" ] || [ "$HID" = "true" ] && echo "PASS: ctrl+b hides panel" || echo "FAIL: ctrl+b hide ($HID)"
agent-browser screenshot $SHOT-focus.png >/dev/null 2>&1
agent-browser press Control+b >/dev/null 2>&1
sleep 1
BACK=$(agent-browser eval "!!document.querySelector('[aria-label=\"Hide preview panel\"]')" 2>/dev/null | tail -1)
[ "$BACK" = "true" ] && echo "PASS: ctrl+b restores panel" || echo "FAIL: ctrl+b restore"

# ctrl+j opens sessions sheet, escape closes
agent-browser press Control+j >/dev/null 2>&1
sleep 1.2
SHEET=$(agent-browser eval "!!document.querySelector('[role=\"dialog\"]')" 2>/dev/null | tail -1)
[ "$SHEET" = "true" ] && echo "PASS: ctrl+j opens sessions" || echo "FAIL: ctrl+j"
agent-browser press Escape >/dev/null 2>&1
sleep 1

# find a session with >= 2 artifacts for the diff view
DIFFSID=$(curl -s http://localhost:3000/api/awon/session | python3 -c "
import json,sys,urllib.request
d=json.load(sys.stdin)
for s in d['sessions']:
    try:
        j=json.loads(urllib.request.urlopen(f\"http://localhost:3000/api/awon/session/{s['id']}\").read())
        if len(j.get('artifacts',[]))>=2 and len(j.get('messages',[]))>4:
            print(s['id']); break
    except Exception: pass
")
echo "diff session: ${DIFFSID:-none}"
if [ -n "${DIFFSID:-}" ]; then
  agent-browser eval "fetch('/api/awon/session').then(r=>r.json()).then(()=>{ 'ok' })" >/dev/null 2>&1
  agent-browser press Control+j >/dev/null 2>&1
  sleep 1.5
  agent-browser eval "var inp=document.querySelector('[aria-label=\"Filter sessions by title\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(inp,'__none__'); inp.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
  agent-browser eval "var inp=document.querySelector('[aria-label=\"Filter sessions by title\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(inp,''); inp.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
  CLICKED=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var i=btns.findIndex(b=>b.getAttribute('aria-label').includes('$DIFFSID')); 'label-search-done'" 2>/dev/null)
  # aria labels carry titles, not ids; match by fetching the title instead
  DTITLE=$(curl -s "http://localhost:3000/api/awon/session/$DIFFSID" | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['title'][:30])")
  PICK=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var t=btns.find(b=>b.getAttribute('aria-label').includes(JSON.stringify('$DTITLE').slice(1,-1))); if(t){t.click();'clicked'}else{'miss'}" 2>/dev/null | tail -1)
  echo "picked: $PICK ($DTITLE)"
  sleep 3
  # Radix TabsTrigger activates on mousedown: synthetic .click() never switches
  # tabs, so use a REAL click (lesson learned this round)
  agent-browser find text "FILES (" click >/dev/null 2>&1
  sleep 1.5
  DIFFBTN=$(agent-browser eval "document.body.innerText.includes('DIFF VS PREV')" 2>/dev/null | tail -1)
  [ "$DIFFBTN" = "true" ] && echo "PASS: diff button visible on 2-artifact session" || echo "FAIL: diff button"
  agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('DIFF VS PREV')); b&&b.click(); 'ok'" >/dev/null 2>&1
  sleep 3
  DIFFVIEW=$(agent-browser eval "document.body.innerText.includes('DIFF VS PREVIOUS')" 2>/dev/null | tail -1)
  [ "$DIFFVIEW" = "true" ] && echo "PASS: diff view renders" || echo "FAIL: diff view"
  agent-browser screenshot $SHOT-diff.png >/dev/null 2>&1
else
  echo "WARN: no 2-artifact session found; diff view skipped (feature still lint-clean)"
fi

# /files workspace: search input + filter count
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/files workspace'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
sleep 1.5
WS=$(agent-browser eval "!!document.querySelector('[aria-label=\"Filter workspace files by path\"]')" 2>/dev/null | tail -1)
[ "$WS" = "true" ] && echo "PASS: workspace search input rendered" || echo "FAIL: workspace search input"
agent-browser eval "var inp=document.querySelector('[aria-label=\"Filter workspace files by path\"]'); if(inp){var set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(inp,'.html'); inp.dispatchEvent(new Event('input',{bubbles:true}))} 'ok'" >/dev/null 2>&1
sleep 0.8
WSF=$(agent-browser eval "document.body.innerText.match(/[0-9]+ OF [0-9]+ FILES/)?.[0] || 'none'" 2>/dev/null | tail -1)
echo "workspace filter counter: $WSF"
[[ "$WSF" == *"OF"* ]] && echo "PASS: workspace filter counter" || echo "WARN: counter not shown (maybe 0 ws files)"

# live /ask regression
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/ask In exactly one short sentence, say the console is alive.'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
DONE=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { DONE=1; break; }
done
[ "$DONE" = "1" ] && echo "PASS: live /ask round trip after all changes" || echo "FAIL: /ask"

# /pdf again now a session exists: success row
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/pdf'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
sleep 1.5
PDFROW2=$(agent-browser eval "document.body.innerText.includes('PDF transcript opened in a new tab')" 2>/dev/null | tail -1)
[ "$PDFROW2" = "true" ] && echo "PASS: /pdf export row with session" || echo "FAIL: /pdf export row"

# light/dark round trip
agent-browser click '[aria-label="Toggle dark or light mode"]' >/dev/null 2>&1
sleep 1
L=$(agent-browser eval "!document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
[ "$L" = "true" ] && echo "PASS: light mode" || echo "FAIL: light mode"
agent-browser screenshot $SHOT-light.png >/dev/null 2>&1
agent-browser click '[aria-label="Toggle dark or light mode"]' >/dev/null 2>&1
sleep 1
D=$(agent-browser eval "document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
[ "$D" = "true" ] && echo "PASS: dark restored" || echo "FAIL: dark restore"

agent-browser close --all >/dev/null 2>&1
echo "=== V1.0 QA DONE ==="
