#!/bin/bash
# focused retest: INITIALIZE click, sessions sheet artifact load, device toggle
set -u
cd /home/z/my-project
SHOT=qa-shots/v08c-$(date +%H%M%S)

setsid nohup bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
CODE=000
for i in $(seq 1 40); do
  sleep 3
  CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://localhost:3000/ 2>/dev/null)
  if [ "$CODE" = "200" ]; then echo "server up"; break; fi
done
[ "$CODE" = "200" ] || { echo "FATAL: no server"; exit 1; }

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
for i in $(seq 1 40); do
  sleep 3
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  if [ "$R" = "true" ]; then echo "overlay ready (waited ~$((i*3))s)"; break; fi
done
sleep 1   # let hydration settle
agent-browser click "button.awon-glow" 2>&1 | head -1
sleep 2.5  # cover the exit animation
GONE=$(agent-browser eval "!document.body.innerText.includes('all systems nominal')" 2>/dev/null | tail -1)
[ "$GONE" = "true" ] && echo "PASS: INITIALIZE dismisses overlay" || echo "FAIL: overlay still up"

agent-browser click '[aria-label="Session history"]' 2>&1 | head -1
sleep 1
# wait until session buttons actually render
OKB=0
for i in $(seq 1 10); do
  N=$(agent-browser eval "[...document.querySelectorAll('[aria-label^=\"Open session\"]')].length" 2>/dev/null | tail -1)
  if [ "$N" != "0" ] && [ -n "$N" ]; then OKB=1; echo "sessions rendered: $N rows"; break; fi
  sleep 1.5
done
if [ "$OKB" = "1" ]; then
  LOADED=$(agent-browser eval "var btns=[...document.querySelectorAll('[aria-label^=\"Open session\"]')]; var t=btns.find(b=>/logo|kanban|website|coffee/i.test(b.getAttribute('aria-label'))) || btns[0]; if(t) t.click(); t? t.getAttribute('aria-label').slice(0,60) : 'none'" 2>/dev/null | tail -1)
  echo "loaded: $LOADED"
  sleep 2.5
  TOG=$(agent-browser eval "!!document.querySelector('[aria-label=\"Preview device width\"]')" 2>/dev/null | tail -1)
  [ "$TOG" = "true" ] && echo "PASS: device toggle rendered" || echo "FAIL: device toggle"
  agent-browser click '[aria-label="Tablet width (768px)"]' >/dev/null 2>&1
  sleep 1.2
  TAB=$(agent-browser eval "document.body.innerText.includes('TABLET / 768PX')" 2>/dev/null | tail -1)
  [ "$TAB" = "true" ] && echo "PASS: tablet frame label" || echo "FAIL: tablet frame"
  agent-browser click '[aria-label="Mobile width (390px)"]' >/dev/null 2>&1
  sleep 1.2
  MOB=$(agent-browser eval "document.body.innerText.includes('MOBILE / 390PX')" 2>/dev/null | tail -1)
  [ "$MOB" = "true" ] && echo "PASS: mobile frame label" || echo "FAIL: mobile frame"
  agent-browser click '[aria-label="Desktop width"]' >/dev/null 2>&1
  sleep 1
  agent-browser screenshot $SHOT-artifact-desktop.png >/dev/null 2>&1
  echo "PASS: screenshots saved"
else
  echo "FAIL: session rows never rendered"
fi
agent-browser close --all >/dev/null 2>&1
echo "=== FOCUSED RETEST DONE ==="
