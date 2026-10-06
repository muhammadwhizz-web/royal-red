#!/bin/bash
# PHASE 4 SOFT-SPOT REGRESSION SUITE - run every round before shipping.
# 1. leak regression (browser daemon + box subsystem, 10x cycles each)
# 2. consent stacking (2xT1 + 1xT3 concurrent, FIFO, timeout independence, freeze)
# 3. loop-death sweep (empty tools, ghost tool, critic hang, SSE drop)
# 4. Cedar & Leaf permanent verification regression (7/7 honest, no disagreement)
cd /home/z/my-project
PASS=0; FAIL=0
run() { echo "== $2 =="; timeout 300 bun --env-file=.env "$1" 2>&1 | grep -v prisma | tail -2 | sed 's/^/  /'; }
L1=$(timeout 300 bun --env-file=.env scripts/test-phase4-leak.ts 2>&1 | grep -v prisma | tail -1)
echo "== leak regression =="
echo "  $L1"
[[ "$L1" == *"0 failed"* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
L2=$(timeout 120 bun --env-file=.env scripts/test-phase4-stacking.ts 2>&1 | grep -v prisma | tail -1)
echo "== consent stacking =="
echo "  $L2"
[[ "$L2" == *"0 failed"* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
L3=$(timeout 260 bun --env-file=.env scripts/test-phase4-loopdeath.ts 2>&1 | grep -v prisma | tail -1)
echo "== loop-death sweep =="
echo "  $L3"
[[ "$L3" == *"0 failed"* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
L4=$(timeout 60 bun --env-file=.env scripts/test-cedar-leaf.ts 2>&1 | grep -v prisma | tail -1)
echo "== cedar & leaf (permanent) =="
echo "  $L4"
[[ "$L4" == *"0 failed"* ]] && PASS=$((PASS+1)) || FAIL=$((FAIL+1))
echo ""
echo "== SOFT-SPOT SUITE: $PASS/4 suites green =="
[ $FAIL = 0 ]
