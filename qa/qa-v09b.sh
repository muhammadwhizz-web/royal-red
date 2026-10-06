#!/bin/bash
# v0.9 focused retest: sheet-scoped chips + counter, jump pill on a long chat
set -u
cd /home/z/my-project
SHOT=qa-shots/v09b-$(date +%H%M%S)

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 8 http://localhost:3000/ 2>/dev/null)
[ "$CODE" = "200" ] || { echo "FATAL: server down"; exit 1; }

agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:3000 >/dev/null 2>&1
OK=0
for i in $(seq 1 30); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('INITIALIZE')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && { OK=1; break; }
done
[ "$OK" = "1" ] || { echo "FAIL: no overlay"; exit 1; }
sleep 1
agent-browser click "button.awon-glow" >/dev/null 2>&1
sleep 2.5

send_cmd() {
  agent-browser eval "var ta=document.querySelector('textarea[aria-label=\"AWON command input\"]'); var set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set; set.call(ta,'$1'); ta.dispatchEvent(new Event('input',{bubbles:true})); 'ok'" >/dev/null 2>&1
  agent-browser click '[aria-label="Send command"]' >/dev/null 2>&1
}

# build a LONG current session: several /help + /ask turns
send_cmd '/help'; sleep 1.2
send_cmd '/help'; sleep 1.2
send_cmd '/help'; sleep 1.5
send_cmd '/ask Reply with a numbered list of five short sentences about the sea.'
for i in $(seq 1 25); do
  sleep 2
  R=$(agent-browser eval "document.body.innerText.includes('turn complete')" 2>/dev/null | tail -1)
  [ "$R" = "true" ] && break
done
echo "long session ready"

# jump pill test on the current (long) session
agent-browser eval "var el=document.querySelector('[aria-label=\"AWON conversation\"]'); el.scrollTop=0; 'scrolled'" >/dev/null 2>&1
sleep 1
PILL=$(agent-browser eval "!!document.querySelector('[aria-label=\"Jump to the latest message\"]')" 2>/dev/null | tail -1)
[ "$PILL" = "true" ] && echo "PASS: jump pill appears on scroll-up" || echo "FAIL: jump pill"
agent-browser screenshot $SHOT-pill.png >/dev/null 2>&1
agent-browser click '[aria-label="Jump to the latest message"]' >/dev/null 2>&1
sleep 2
ATB=$(agent-browser eval "var el=document.querySelector('[aria-label=\"AWON conversation\"]'); (el.scrollHeight-el.scrollTop-el.clientHeight) < 120" 2>/dev/null | tail -1)
[ "$ATB" = "true" ] && echo "PASS: jump returns to bottom" || echo "FAIL: jump bottom ($ATB)"
PILLGONE=$(agent-browser eval "!document.querySelector('[aria-label=\"Jump to the latest message\"]')" 2>/dev/null | tail -1)
[ "$PILLGONE" = "true" ] && echo "PASS: pill hides at bottom" || echo "WARN: pill still visible"

# auto-scroll regression: while at bottom, new content keeps view pinned (no pill)
agent-browser click '[aria-label="Session history"]' >/dev/null 2>&1
sleep 1.2
# sheet-scoped queries: role=dialog buttons only
CHIPS=$(agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); var b=[...d.querySelectorAll('button')].filter(x=>['ALL','BUILD','RESEARCH','PC','ASK'].includes(x.textContent.trim())); b.length" 2>/dev/null | tail -1)
[ "$CHIPS" = "5" ] && echo "PASS: 5 sheet chips (sheet-scoped)" || echo "FAIL: chips ($CHIPS)"
agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); var b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()==='RESEARCH'); b && b.click(); 'ok'" >/dev/null 2>&1
sleep 1
CNT=$(agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); /[0-9]+ of [0-9]+ sessions/.test(d.textContent)" 2>/dev/null | tail -1)
[ "$CNT" = "true" ] && echo "PASS: counter shows N of M with mode filter" || echo "FAIL: counter"
ROWS=$(agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); [...d.querySelectorAll('[aria-label^=\"Open session\"]')].length" 2>/dev/null | tail -1)
echo "research-filtered rows: $ROWS"
agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); var b=[...d.querySelectorAll('button')].find(x=>x.textContent.trim()==='ALL'); b && b.click(); 'ok'" >/dev/null 2>&1
sleep 0.8
ALLROWS=$(agent-browser eval "var d=document.querySelector('[role=\"dialog\"]'); [...d.querySelectorAll('[aria-label^=\"Open session\"]')].length" 2>/dev/null | tail -1)
echo "all rows after reset: $ALLROWS"
agent-browser press Escape >/dev/null 2>&1
sleep 1

# /files workspace scope check (aria-pressed returns quoted string)
send_cmd '/files workspace'
sleep 2
F=$(agent-browser eval "var b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim().startsWith('WORKSPACE')); b? String(b.getAttribute('aria-pressed')) : 'nobtn'" 2>/dev/null | tail -1)
echo "workspace aria-pressed: $F"
agent-browser close --all >/dev/null 2>&1
echo "=== FOCUSED RETEST DONE ==="
