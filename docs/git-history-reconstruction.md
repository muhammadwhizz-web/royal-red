# Git History Reconstruction — primary-source record

**Event:** sandbox checkpoint restore re-initialized `.git` (fresh `git init` + single
"Initial commit" snapshot at 2026-10-06 04:43:40 UTC, created before the session resumed
~05:35). All pre-v1.3 commit history (v1.0→v1.2 progression, ~80-bug dossier audit trail)
was destroyed with it.

**Diagnosis:** `git reflog` contains only post-reset commit entries (no clone/fetch/reset
events), `git fsck` reports zero dangling objects, no `.git` exists inside the recovery
snapshot `/home/sync/repo.tar` (210 entries, v1.3 tree, refreshed 09:53), no remote was
ever configured, and a filesystem sweep found no `.git` backups anywhere. **The old
history is a loss, not a scar.**

**Method (not fabrication):** each commit below is ONE logical round, dated by primary
sources that survived the reset — file mtimes were preserved (only `.git` was eaten), so
QA script creation dates, DB backup version stamps, and kernel module mtimes anchor every
round. Commit message bodies cite the canonical worklog entry ID. Where evidence is
worklog-only, the commit says so.

**Evidence sources:** `worklog.md` (canonical record), `qa/` script mtimes,
`db/custom.db.backup-v{1.0,1.1,1.2}-*` version stamps, `src/server/awon/**` mtimes,
lost-commit hashes recorded in worklog (`3af90a1` v0.9, `094de5a` v1.0),
`/home/sync/repo.tar` refresh stats in worklog.

## Reconstructed timeline

| Round | Version | When (UTC) | Dated by | Worklog entry |
|---|---|---|---|---|
| 12-repo payload analysis | — | pre-console | worklog only | Task 1-3 … 5-7 |
| console build | v0.1 | worklog-only | worklog only | Task 8 |
| stop/zip/mode-sync | v0.1.1 | worklog-only | worklog only | Task 9 |
| eyes (image-gen + VLM loop) | v0.2 | worklog-only | worklog only | Task 10 |
| video understanding + switcher | v0.3 | worklog-only | worklog only | Task 11 |
| upload pipeline | v0.4 | worklog-only | worklog only | Task 12 |
| web reader + sessions + workspace | v0.5 | worklog-only | worklog only | Task 13 |
| history/titles/retry/zip | v0.6 | worklog-only | worklog only | Task 14 |
| pinning/export/palette/turn-stats | v0.7 | 2026-10-04 ~13:26 | qa-v07.sh mtime | Task 15 |
| local command line + editor + frames | v0.8 | 2026-10-04 ~13:46 | qa-v08*.sh mtimes | Task 16 |
| /stats + filters + smart scroll | v0.9 | 2026-10-04 ~14:06 | qa-v09*.sh mtimes | Task 17 |
| v1.0 export engines + versioned diff | v1.0 | 2026-10-04 ~14:35 | pdf.ts + qa-v10.sh mtimes | Task 18 |
| master directive Phase 1 | v1.1 | 2026-10-05 ~05:55 | versions.ts + qa-v11.sh + db backup stamp | Task 19 |
| Phase 2+3 (Verification 2.0 + browser hands) | v1.2 | 2026-10-05 ~07:13 | verify/*.ts + osworld/harness.ts + qa-v12*.sh mtimes | entry LOST in cutoff — artifact-dated |
| Phase 4 Permitted PC Control | v1.3 | 2026-10-06 09:53:37 | git commit 261bcde (survives) | Task 20–20.6 |
| post-ship residue (fixtures, worklog) | — | 2026-10-06 09:55:05 | git commit aa6fda5 (survives) | — |

**Rule going forward:** every future commit message references its worklog entry ID, is
pushed to the protected remote immediately, and no force-push or branch deletion is
possible (enforced server-side on the bare remote). A weekly tarball of `.git` lands in
`/home/sync/` via a standing scheduled task. Every phase assumes the sandbox can eat
history again.
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
2026-10-04T13:26:00+0000
