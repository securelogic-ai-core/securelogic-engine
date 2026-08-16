# BL-3 — Full suite verification on the promotion SHA

**Produced**: 2026-08-15. **Read-only.** No code was changed to produce this
document. The working tree was verified clean at the promotion SHA before every
run recorded here.

**Ruling: BL-3 CLEARED, with one stated limitation (§5).**

> **Re-cleared at `7692c9e6` — see §7.** The candidate moved twice after this
> document was written. §1–§6 belong to `59d85b18`; §7 is the independent re-run
> at the current candidate and is the section to read before promoting.

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

---

## 7. Re-verification at `7692c9e6` — the current promotion candidate

**Produced**: 2026-08-15, later the same day. §1 forbids carrying the `59d85b18`
numbers to any other commit, and the candidate has moved twice since:
`b363e144` (migration lock/statement-timeout hardening) and `7692c9e6` (the
`20260522_alert_preferences.sql` → `20260417_…` rename plus its fresh-database
regression test). Both touch the migration runner — the single least forgiving
thing in this promotion — so the suite was re-run in full rather than inferred.

| | |
|---|---|
| **Promotion SHA** | **`7692c9e6f65c6b41f9e19bfcca8e8bb6b973471b`** (`7692c9e6`) |
| Subject | `fix(migrations): the migration set must rebuild an empty database` |
| Branch | `develop` — **5 commits ahead of `origin/develop`, unpushed** |
| `git status` at run time | clean — no tracked modifications |
| Node / npm | v20.20.2 (matches `.nvmrc`: 20) / npm 10.8.2 |

### Results — all eight CI jobs, re-executed

| CI job | Command | Result | Exit | vs `59d85b18` |
|---|---|---|---|---|
| `typecheck` (engine) | `npm run typecheck` | no diagnostics | **0** | same |
| `typecheck` (app) | `cd app && npm run typecheck` | no diagnostics | **0** | same |
| `lint` | `npm run lint` | **0 errors**, 1 warning (unused eslint-disable directive) | **0** | same |
| `url-drift` | `node scripts/check-env-url-drift.mjs` | no staging→production URL drift | **0** | same |
| `test` (engine) | `npx vitest run` | **496 files / 8,074 passed, 3 skipped, 0 failed** (210s) | **0** | **+1 file, +22 tests** |
| `test` (app) | `cd app && npx vitest run` | **133 files / 1,738 passed, 0 failed** (251s) | **0** | identical |
| `build` (engine) | `npm run build` | dist emitted | **0** | same |
| `build` (intelligence-worker) | `npx tsc -p services/intelligence-worker/tsconfig.json` | clean | **0** | same |
| `cross-org-isolation` | `npm run test:isolation` (fresh Docker Postgres 16) | **151 files / 1,169 passed, 0 failed** (1,052s) | **0** | **+2 files, +11 tests** |
| `tenant-coverage` | `bash scripts/check-tenant-coverage.sh` | 260 warnings, warn-only by design | **0** | identical |
| `audit` | `npm audit --audit-level=high` | **7 high — RED** | **1** | same count, §7.2 |

The engine delta is fully accounted for: `src/api/lib/__tests__/migrationRunner.test.ts`
is the one new file, contributing the 22 additional tests. No test was removed,
skipped or retitled to achieve green.

### 7.1 Harness provisioning — deliberately destroyed first

The stale `securelogic-harness-pg` container **and its anonymous volume** were
removed (`docker rm -f` + `docker volume rm`) and recreated before the isolation
run. A reused harness database is the known cause of ~39 files fake-failing, and
§4 above records disk exhaustion producing a 140-file fake failure on this same
host. Disk was checked before and during: 74% used, 8.0 GB free throughout, and
the run log contains **zero** `ENOSPC`, `no space left` or
`Connection terminated` occurrences. The other two stopped Postgres containers
on the host were left untouched.

### 7.2 The audit red — §3's account was under-inclusive, now corrected

§3 named `undici` and `postcss`. That is not the whole set. `npm audit` reports
**seven** high advisories, and one of the omitted packages is a **direct**
dependency:

| Package | Direct? | HEAD version | `main` version |
|---|---|---|---|
| `brace-expansion` | no | 1.1.16 / 2.1.2 / 5.0.7 | 1.1.14 / 2.1.0 / 5.0.6 |
| `fast-uri` | no | 3.1.2 | 3.1.2 |
| `ip-address` | no | 10.2.0 | 10.2.0 |
| **`js-yaml`** | **yes** | 4.3.0 / 5.2.1 | 4.3.0 / 5.2.0 |
| `nanoid` | no | 3.3.12 | 3.3.12 |
| `postcss` | no | 8.5.15 | 8.5.15 |
| **`undici`** | **yes** | 7.28.0 | 7.28.0 |

Inheritance was therefore re-established a stronger way than package-by-package
comparison: `main`'s own `package.json` + `package-lock.json` were extracted to a
scratch directory and audited with `npm audit --package-lock-only`. **`main`
returns the identical seven high advisories** (11 total: 1 low, 3 moderate, 7
high), exit 1.

Two packages *were* bumped by this delta — `brace-expansion` 1.1.14 → 1.1.16 and
`js-yaml` 5.2.0 → 5.2.1 — but both remain **inside the advisory's vulnerable
range** (`<=1.1.17`, `5.0.0 - 5.2.1`). The delta neither introduces a new
vulnerable package nor resolves an existing one. The red is inherited; the ruling
in §3 stands, but the debt is larger than §3 described and now includes a second
direct runtime dependency.

### 7.3 `cross-org-isolation` — landed

| | |
|---|---|
| Command | `npm run test:isolation` (`vitest run --config vitest.isolation.config.ts`) |
| Database | freshly created `securelogic-harness-pg` (Postgres 16-alpine), per §7.1 |
| Result | **151 files / 1,169 passed, 0 failed, 0 skipped** |
| Exit | **0** |
| Duration | 1,051.91 s (17 m 32 s), started 15:35:00 Z |
| vs `59d85b18` | 149 files / 1,158 tests → **+2 files, +11 tests** |

**The delta is fully accounted for, not assumed.** The two new files were then
run alone against the same harness:

```
npx vitest run --config vitest.isolation.config.ts \
  test/isolation/migrationFilenameOrder.test.ts \
  test/isolation/migrationRunnerTimeouts.test.ts
→ Test Files 2 passed (2) | Tests 11 passed (11) | 13.20s | exit 0
```

**2 files, 11 tests — exactly the increase.** Nothing elsewhere in the suite was
lost, renamed or skipped to absorb it.

**No file was silently skipped**: `test/isolation/` contains **151** `*.test.ts`
files on disk and vitest reported **151** test files. The run log contains zero
occurrences of `FAIL`, `ENOSPC`, `no space left` or `Connection terminated`.
Disk stayed between 74% and 76% used (7.2–8.1 GB free) for the whole run.

**One discarded attempt, disclosed.** A first invocation was killed at exactly
10 minutes by the tool-level command timeout — **not** by any test failure and
not by the harness. No results were read from it. The container and its volume
were destroyed and recreated again (§7.1) and the run was re-executed in the
background, which is the run recorded above.

**One limitation on this subsection specifically:** the isolation reporter
suppresses test-level console output, so the
`[migration-order] 222/222 migrations applied …` line quoted in
`docs/validation/migrate-from-scratch-defect.md` does not appear in this run's
log. The assertion passing is the evidence here; that console line is not
re-quoted from a run that did not print it.

### 7.4 Ruling at `7692c9e6`

**BL-3 CLOSED at `7692c9e6`.** All eight CI jobs re-executed; every one passes
except `audit`, red and verified inherited by §7.2. The §5 limitation carries
over unchanged and is not weakened by this re-run: this is local reproduction of
every command CI runs, on the Node version `.nvmrc` pins, with `node_modules`
reused rather than a clean `npm ci`, and with the harness provisioned by
`scripts/harness-db-up.sh` rather than a GitHub service container. It is not the
GitHub Actions run for this SHA — and it cannot be, because the SHA is not
pushed. **`gh run list --branch develop --json headSha,conclusion` after the push
is what converts this into "CI was green."**
