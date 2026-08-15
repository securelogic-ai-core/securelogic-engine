# BL-3 — Full suite verification on the promotion SHA

**Produced**: 2026-08-15. **Read-only.** No code was changed to produce this
document. The working tree was verified clean at the promotion SHA before every
run recorded here.

**Ruling: BL-3 CLEARED, with one stated limitation (§5).**

---

## 1. The SHA these results belong to

| | |
|---|---|
| **Promotion SHA** | **`59d85b18ac5c11d851ee47d76bff787879e4a3b2`** (`59d85b18`) |
| Subject | `fix(ask): the app typecheck has been red for nine commits behind a red audit` |
| Branch | `develop` |
| `git status` at run time | clean — no tracked modifications |
| Node / npm | v20.20.2 (matches `.nvmrc`: 20) / npm 10.8.2 |

**These results attach to `59d85b18` and to no other commit.** Any later commit —
including the `runMigrations.ts` lock-timeout hardening queued behind this
document — requires its own run. Do not carry these numbers forward.

The immediately preceding commit is why this gate mattered: the app typecheck had
been red for nine commits. It is green here.

---

## 2. Results — all eight CI jobs, reproduced locally

`.github/workflows/ci.yml` defines eight jobs. Every one was executed.

| CI job | Command | Result | Exit |
|---|---|---|---|
| `typecheck` (engine) | `npm run typecheck` | no diagnostics | **0** |
| `typecheck` (app) | `cd app && npm run typecheck` | no diagnostics | **0** |
| `lint` | `npm run lint` | **0 errors**, 1 warning (unused eslint-disable directive) | **0** |
| `url-drift` | `node scripts/check-env-url-drift.mjs` | no staging→production URL drift | **0** |
| `test` (engine) | `npx vitest run` | **495 files / 8,052 passed, 3 skipped, 0 failed** | **0** |
| `test` (app) | `cd app && npx vitest run` | **133 files / 1,738 passed, 0 failed** | **0** |
| `build` (engine) | `npm run build` | dist emitted | **0** |
| `build` (intelligence-worker) | `npx tsc -p services/intelligence-worker/tsconfig.json` | clean | **0** |
| `cross-org-isolation` | `npm run test:isolation` (fresh Docker Postgres 16) | **149 files / 1,158 passed, 0 failed** | **0** |
| `tenant-coverage` | `bash scripts/check-tenant-coverage.sh` | 260 warnings, **warn-only by design** | **0** |
| `audit` | `npm audit --audit-level=high` | **7 high — RED** | **1** |

Isolation count `1,158` matches the LC-5b validation figure exactly, which is the
expected number for this SHA.

---

## 3. The audit red — verified inherited, not introduced

The gate accepts an audit red **only** if it is inherited. That was checked, not
assumed:

| Package | Version | Path | On `main`? | Changed by this delta? |
|---|---|---|---|---|
| `undici` | 7.28.0 | direct dependency | **yes, same version** | **no** |
| `postcss` | 8.5.15 | dev-only, `vitest → vite → postcss` | **yes, same version** | **no** |

`git diff main..develop -- package-lock.json` contains **no line** adding either
package at any version. Both are present in `main`'s lockfile. **`main` audits red
today for the same 7 advisories.** Promotion neither introduces nor worsens this.

It is still real debt (`undici` is a direct runtime dependency, and the advisories
include response desynchronization and cross-user information disclosure). It
belongs in its own dependency-bump change, not in this promotion — and not
silently, either. It is not a promotion blocker; it is not thereby resolved.

---

## 4. Two earlier runs were DISCARDED — disclosed, not hidden

A first pass produced failures that were **environmental, not product**. The
numbers in §2 come from clean re-runs. The discarded runs are recorded here
because a validation record that hides a thrown-away run is not evidence.

**Root cause: the host filesystem reached 100% (0 bytes free).**

| Discarded run | Apparent failure | Actual cause |
|---|---|---|
| Engine suite | 2 failed / 8,050 passed | `ENOSPC: no space left on device, write` in `src/reporting/ReportExporter.ts:14` — both failures |
| Isolation suite | **140 of 149 files failed** | The harness Postgres **died**: `could not extend file "base/16384/20401": No space left on device` during WAL redo, then `shutting down due to startup process failure`. Tests saw `Connection terminated unexpectedly` |

Remediation: cleared the npm cache (2.8 GB) and pruned 10 orphaned anonymous
Docker volumes (6.85 GB) → 71% used, 8.8 GB free. The crashed harness container
and its corrupted volume were destroyed and recreated fresh. Both suites were
then re-run **alone** (this host has 2 cores; the original three-way parallel run
contributed to the exhaustion). Post-run disk: 74% used, 8.0 GB free, zero ENOSPC
in any log.

The app suite overlapped the full-disk window and still passed **1,738/1,738 with
zero disk errors**. Disk exhaustion produces failures, not false passes, so that
result stands as run; it was not re-executed.

**Cross-check on the discarded isolation run:** its failure mode is the same
"~39 files fake-fail on a reused database" trap this harness is known for — but
the cause here was disk, confirmed from the container's own log, not schema
reuse. Both are fixed by the same remedy: a genuinely fresh database.

---

## 5. The limitation — what this evidence is NOT

**This is local reproduction of every CI job on the promotion SHA. It is not the
GitHub Actions run for that SHA.** The `gh` CLI is not installed in this session,
so the actual CI run status on `59d85b18` could not be read.

That distinction is worth stating plainly:

- What **is** proven: every command CI executes, run against the exact tree at
  `59d85b18`, on the Node version `.nvmrc` pins, passes — except `audit`, which is
  inherited red.
- What is **not** proven: that GitHub's runners agree. Known divergences: CI runs
  `npm ci` from a clean lockfile install (this session reused existing
  `node_modules`), and CI provisions Postgres as a service container rather than
  via `scripts/harness-db-up.sh`.

An operator with `gh` access can close this residue in one command:
`gh run list --branch develop --json headSha,conclusion`. Until then BL-3 rests on
local evidence — strong, reproducible, but one inference short of "CI was green."

---

## 6. What BL-3 does not clear

BL-2 (staging walkthrough §1–§3 legs unexecuted — operator-owed, requires a human
signed in to a browser, including under `RISK_WORKSPACE_ENABLED=false`) and BL-4
(Vendor Assurance navigation decision) remain **OPEN**. BL-1 was cleared
separately by `docs/validation/bl1-migration-lock-exposure.md` (ruling GO,
~220 ms of `ACCESS EXCLUSIVE` total, valid only while production stays empty).

**Promotion verdict remains NO-GO on BL-2 and BL-4.** Two of four blockers are now
clear; the two that remain need a human, not a test run.
