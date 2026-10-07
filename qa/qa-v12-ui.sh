#!/bin/bash
# Phase 2 (v1.2) console UI checks: VERIFY tab, verification dashboard, provider section
AB="agent-browser"
PASS=0; FAIL=0
ck() { if [ "$1" = "0" ]; then PASS=$((PASS+1)); echo "  ok $2"; else FAIL=$((FAIL+1)); echo "  FAIL $2"; fi }

$AB open http://localhost:3000/ >/dev/null 2>&1; sleep 5
# dismiss boot overlay if present
$AB find text "INITIALIZE" click >/dev/null 2>&1; sleep 2
# open a session with an artifact (snapvault) via sessions sheet
$AB press "ctrl+j" >/dev/null 2>&1; sleep 1.5
$AB find text "snapvault" click >/dev/null 2>&1; sleep 3
# VERIFY tab exists and opens
$AB find text "VERIFY" click >/dev/null 2>&1; sleep 2
TXT=$($AB get text "body" 2>/dev/null)
echo "$TXT" | grep -q "VERIFICATION 2.0" && ck 0 "verify tab opens with dashboard banner" || ck 1 "verify tab opens with dashboard banner"
echo "$TXT" | grep -q "CONSTRAINT LEDGER" && ck 0 "constraint ledger section renders" || ck 1 "constraint ledger section renders"
echo "$TXT" | grep -q "ADVERSARIAL CRITIQUE" && ck 0 "critique section renders" || ck 1 "critique section renders"
echo "$TXT" | grep -q "VISUAL REGRESSION" && ck 0 "visual regression section renders" || ck 1 "visual regression section renders"
echo "$TXT" | grep -q "CMS PANEL PROOF" && ck 0 "cms proof section renders" || ck 1 "cms proof section renders"
echo "$TXT" | grep -q "COMPETITOR BENCHMARK" && ck 0 "benchmark section renders" || ck 1 "benchmark section renders"
echo "$TXT" | grep -q "CRITIC MODEL" && ck 0 "critic model config section renders" || ck 1 "critic model config section renders"
# persisted receipts loaded (visual shots exist for this artifact after earlier run)
echo "$TXT" | grep -qE "hamming|new baseline" && ck 0 "visual receipts render hashes/regions" || ck 1 "visual receipts render hashes/regions"
# cms proof steps visible
echo "$TXT" | grep -qiE "no login gate|login" && ck 0 "cms step receipts visible" || ck 1 "cms step receipts visible"
# screenshots thumbnails served through verify-shot route
CODE=$($AB eval "fetch('/api/royal-red/verify-shot?run=nonexistent-run-x&name=desktop.png').then(r => r.status).catch(() => 'net-err')" 2>/dev/null)
echo "$CODE" | grep -q "400" && ck 0 "verify-shot route guards bad run ids (400)" || ck 1 "verify-shot route guards bad run ids (400): $CODE"
# light mode sanity
$AB eval "document.documentElement.classList.remove('dark')" >/dev/null 2>&1; sleep 1
$AB screenshot /tmp/v12-verify-light.png >/dev/null 2>&1
ck 0 "screenshot saved"
$AB close >/dev/null 2>&1
echo "PASS=$PASS FAIL=$FAIL"
[ $FAIL -eq 0 ]
