# PR-C1 branch-state anomaly — 2026-06-01

## STOPPED before PR creation. No PR created. Nothing of mine pushed to remote.

## What happened
Mid-PR-C1 (gap C' RLS adoption, 4 files), the repo state changed underneath the session between turns:

- **Current branch is `feature/health-endpoint`** — I never created this. Tracks `origin/develop`, ahead 1.
- **My commit `56ae3b7e`** ("fix(rls): adopt withTenant for 4 single-org pg.query sites") landed on `feature/health-endpoint`, NOT on `fix/gap-c-rls-adoption`.
  - Content is CORRECT: 4 files, +266/-239 (briefPersonalizationService, findingAlertTrigger, templateLoader, trackApiUsage).
  - Parent = `01d9162a` (CORRECT — current origin/develop tip, PR #117). The earlier "a58c3691" reading was a mangled/cancelled command; the clean re-run confirms parent 01d9162a. Base is GOOD.
- **Local+remote `fix/gap-c-rls-adoption` is at `41a5d174` = "some other work"** — NOT mine. A foreign branch with the same name.
- `git push -u origin fix/gap-c-rls-adoption` reported "Everything up-to-date" because it pushed the local `fix/gap-c-rls-adoption` (41a5d174, foreign) which already matched remote. **My commit was never pushed.**
- `gh pr create` was CANCELLED (parallel-call error) — so NO PR exists. Good: had it run, it would have opened a PR for 41a5d174 (someone else's work), not mine.

## Verified-good facts
- `origin/develop` tip = `01d9162a` (correct, PR #117).
- My 4-file change content is intact in commit `56ae3b7e` and matches the reviewed/authorized PR-C1 diff (typecheck 0, eslint 0 before commit).

## DO NOT (without operator direction)
- Do NOT push `feature/health-endpoint` anywhere.
- Do NOT force/overwrite `fix/gap-c-rls-adoption` (would clobber the foreign 41a5d174 "some other work").
- Do NOT create the PR yet.

## Safe recovery options (operator to choose)
1. Rebase/cherry-pick `56ae3b7e` onto a fresh branch off `origin/develop` (01d9162a) with a non-colliding name (e.g. `fix/gap-c-rls-adoption-c1`), push that, open PR → develop.
2. Investigate why `feature/health-endpoint` exists and why `fix/gap-c-rls-adoption` now points at foreign work (concurrent session? external checkout/reset?).
3. Confirm my commit's true parent (`git log --format='%H %P' -1 56ae3b7e`) before any rebase — the a58c3691 parent line is suspicious.
