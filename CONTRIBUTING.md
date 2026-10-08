# Contributing to Royal Red

Thank you for wanting to improve Royal Red. This project has a small number
of hard laws. A change that breaks one of them is a change that will be sent
back, no matter how good the rest of it is.

## The project laws

1. No emojis, anywhere: not in code, not in the UI, not in docs, not in
   terminal output, not in generated artifacts. The kernel enforces this at
   the event seam (src/server/royal-red/text-law.ts).
2. No em dashes and no en dashes, for the same reason. Use a comma or a
   plain hyphen.
3. No overlapping layout elements, in the UI and in every generated PDF,
   poster, and page. The engines refuse overlap by construction; do not add
   a code path that can violate it.
4. Honest receipts: never render a verification seal for something that was
   not verified. A missing seal is information, not a failure to hide.
5. Every claim in the README and the docs must be true at the time of the
   commit. If something is not shipped, it does not appear.

## How to work

1. Fork, then create a branch for your change.
2. Run the test battery before you open a pull request:

```
bun run lint
bun --env-file=.env scripts/test-phase2.ts
bun --env-file=.env scripts/test-royalred-router.ts
bun --env-file=.env scripts/test-docs-engine.ts
bun --env-file=.env scripts/test-arch-invariants.ts
bun --env-file=.env scripts/test-build-integrity.ts
```

The full suite list lives in the worklog and in each script's header. All
suites must be green; report the honest counts.

3. If your change touches the installer, the launcher, or the Dockerfile,
   test it on a fresh environment (a container is fine) and paste the
   commands you ran and their output into the pull request description.

4. If your change adds a user-visible surface, add a screenshot to the pull
   request and verify it at 1440, 768, and 390 pixel widths.

## Code style

- TypeScript strict. No any.
- The kernel owns all side effects; UI components stay presentational where
  possible.
- Comments explain why, not what.

## Reporting bugs

Include: your OS and version, the output of `royal-red --version`, the last
50 lines of `~/.royal-red/logs/server.log`, and what you expected versus
what happened. Redact anything private; the log contains file paths from
your machine only.
