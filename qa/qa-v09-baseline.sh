#!/bin/bash
# v0.9 baseline QA: boot, live /ask SSE round trip, sessions sheet, artifact preview, light mode
set -u
cd /home/z/my-project
SHOT=qa-shots/v09-base-$(date +%H%M%S)
mkdir -p qa-shots

# guard: server must be up (never restart a healthy one)
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null)
if [ "$CODE" != "200" ]; then
  echo "server down ($CODE), starting..."
  setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
  for i in $(seq 1 40); do
    sleep 3
    CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
    [ "$CODE" = "200" ] && break
  done
fi
[ "$CODE" = "200" ] || { echo "FATAL: no server"; exit 1; }
echo "server up ($CODE)"

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 30); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { OK=1; echo "overlay ready (~$((i*2))s)"; break; }
done
[ "$OK" = "1" ] || { echo "FAIL: overlay never rendered"; agent-browser close --all >/dev/null 2>&1; exit 1; }
sleep 1
agent-browser click "button.royalred-glow" >/dev/null 2>&1
sleep 2.5
GONE=$(agent-browser eval "!document.body.innerText.includes('all systems nominal')" 2>/dev/null | tail -1)
[ "$GONE" = "true" ] && echo "PASS: INITIALIZE dismisses overlay" || echo "FAIL: overlay stuck"

SUGG=$(agent-browser eval "document.body.innerText.includes('BUILD A COMPLETE WEBSITE') && document.body.innerText.includes('SYSTEM ONLINE')" 2>/dev/null | tail -1)
[ "$SUGG" = "true" ] && echo "PASS: empty state + suggestion cards" || echo "FAIL: empty state"

# live /ask round trip (SSE loop health)
agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"ROYAL RED command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'/ask In exactly one short sentence, what is ROYAL RED?'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'typed'" >/dev/null 2>&1
agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
echo "sent /ask..."
DONE=0
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { DONE=1; echo "turn complete (~$((i*3))s)"; break; }
done
if [ "$DONE" = "1" ]; then
  STATS=$(agent-browser eval "var m=document.body.innerText.match(/turn complete \\/ ([0-9.]+)s \\/ ([0-9]+) tools?/); m? m[0] : 'none'" 2>/dev/null | tail -1)
  echo "PASS: live /ask round trip ($STATS)"
  MODECHIP=$(agent-browser eval "document.body.innerText.includes('ASSIST')" 2>/dev/null | tail -1)
  [ "$MODECHIP" = "true" ] && echo "PASS: mode chip auto-sync visible" || echo "WARN: mode chip not spotted"
else
  echo "FAIL: /ask turn never completed"
fi

# sessions sheet
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.2
ROWS=0
for i in $(seq 1 8); do
  N=$(agent-browser eval "[...document.querySelectorAll('[aria-label^=\"Open session\"]')].length" 2>/dev/null | tail -1)
  [ -n "$N" ] && [ "$N" != "0" ] && { ROWS=$N; break; }
  sleep 1.5
done
echo "sessions rows: $ROWS"
[ "$ROWS" != "0" ] && echo "PASS: sessions sheet renders" || echo "FAIL: sessions sheet empty"
agent-browser press Escape >/dev/null 2>&1
sleep 1

# artifact preview: load a session known to have an artifact
LOADED=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; " 2>/dev/null)
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.5
PICK=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var t=btns.find(b=>/gallery|logo|kanban|website|coffee/i.test(b.getAttribute('aria-label'))); if(t){t.click(); t.getAttribute('aria-label').slice(0,70)}else{'none'}" 2>/dev/null | tail -1)
echo "picked session: $PICK"
sleep 3
FRAME=$(agent-browser eval "!!document.querySelector('[aria-label=\"Preview device width\"]')" 2>/dev/null | tail -1)
[ "$FRAME" = "true" ] && echo "PASS: preview device toggle rendered" || echo "FAIL: preview device toggle"
IFR=$(agent-browser eval "!!document.querySelector('iframe[title=\"ROYAL RED artifact preview\"]')" 2>/dev/null | tail -1)
[ "$IFR" = "true" ] && echo "PASS: preview iframe present" || echo "FAIL: preview iframe"
agent-browser screenshot $SHOT-preview.png >/dev/null 2>&1

# light mode round trip
agent-browser click '[aria-label="Toggle dark or light mode"]' >/dev/null 2>&1
sleep 1
LIGHT=$(agent-browser eval "document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
[ "$LIGHT" = "false" ] && echo "PASS: light mode applied" || echo "FAIL: light mode"
agent-browser screenshot $SHOT-light.png >/dev/null 2>&1
agent-browser click '[aria-label="Toggle dark or light mode"]' >/dev/null 2>&1
sleep 1
DARK=$(agent-browser eval "document.documentElement.classList.contains('dark')" 2>/dev/null | tail -1)
[ "$DARK" = "true" ] && echo "PASS: dark restored" || echo "FAIL: dark restore"

agent-browser close --all >/dev/null 2>&1
echo "=== BASELINE QA DONE ==="
