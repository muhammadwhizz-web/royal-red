#!/usr/bin/env python3
import json, sys

path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/acceptance2.txt'
kinds = {}
constraints = None
verifies = []
says = []
artifact_last = None
phase_seq = []
for line in open(path, encoding='utf-8', errors='replace'):
    line = line.strip()
    if not line.startswith('data: '):
        continue
    try:
        e = json.loads(line[6:])
    except Exception:
        continue
    t = e.get('type')
    kinds[t] = kinds.get(t, 0) + 1
    if t == 'constraints':
        constraints = e.get('items')
    elif t == 'verify':
        verifies.append(e)
    elif t == 'say':
        says.append(e.get('text', ''))
    elif t == 'artifact':
        artifact_last = e
    elif t == 'phase':
        phase_seq.append(e.get('value'))

print('=== event counts:', json.dumps(kinds, indent=0).replace('\n', ' '))
print('\n=== CONSTRAINT LEDGER (streamed before build):')
for c in (constraints or []):
    print(f"  {c['cid']} [{c['category']}{'/MUST' if c.get('weight')==2 else ''}] {c['text'][:70]}")
    print(f"       check: {c['assertion'][:90]}")

print('\n=== VERIFY EVENTS (streamed after build):')
for v in verifies:
    print(f"  [{v.get('kind')}] {v.get('status')}: {str(v.get('summary'))[:150]}")

print('\n=== artifact last:')
if artifact_last:
    print(f"  {artifact_last.get('name')} score={artifact_last.get('score')} files={len(artifact_last.get('files', []))}")
print('\n=== phases:', ' -> '.join(phase_seq[:30]))
