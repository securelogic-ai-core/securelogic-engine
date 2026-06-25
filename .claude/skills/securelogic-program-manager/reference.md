# Reference — Program Manager

Evidence-gathering commands, the package-state model, and the technical-debt register.
**VERIFIED** unless tagged.

## 1. Evidence-gathering commands (read-only)
```bash
# When did the build doc last change vs. what merged after?
git log -1 --format='%ci %h' -- BUILD_SEQUENCE.md
git log --oneline -30                              # recent merges (current branch)
git log --oneline --grep='<package-keyword>' -i    # has X already shipped?

# Is a commit ACTUALLY merged, or only on a feature branch? (critical for "Complete")
git branch -a --contains <sha>                     # expect develop and/or main

# Is develop ahead of main (un-promoted work)?
git log --oneline origin/develop..origin/main      # empty after a --merge promote
git log --oneline origin/main..origin/develop      # what is staged but not in prod

# Acceptance evidence
git log --oneline --grep='soak\|acceptance\|PASS' -i
```
Never trust memory or a prior summary for the active package — re-read `BUILD_SEQUENCE.md`.

## 2. Package-state model
| State | Criteria (evidence required) |
|---|---|
| **Active** | Named in `BUILD_SEQUENCE.md` "Active package", operator-confirmed. One at a time. |
| **Complete** | ITS acceptance criteria met + commits merged to the target branch (`git branch --contains`). Prod-enablement that's dashboard-only = separate, UNKNOWN-from-repo item. |
| **In-flight infrastructure** | Parallel hardening (A04-G1 RLS) with its own rollout plan; NOT in the one-at-a-time queue. |
| **Deferred / candidate** | Named with a prerequisite; selecting it is a fresh active-package decision. |
| **Parked** | Blocked on an external decision (e.g. price labels behind a Stripe decision). Do not touch. |

## 3. Fixed priority order (VERIFIED — `BUILD_SEQUENCE.md`)
1 docs-product-alignment · 2 tenant-isolation-standard / `tenant-isolation-enforcement` (R1–R11)
· 3 external-signal-architecture · 4 signal-ingestion-hardening · 5 signal-to-platform-linkage ·
6 brief-premiumization · 7 platform-context-surfaces · 8 customer-distribution-and-isolation ·
9 securelogic-internal-controls. Parallel: A04-G1 RLS rollout.

## 4. Technical-debt register (cite when sequencing)
- **Tenant isolation:** no central enforcement; RLS inert pre-flip (R1/R8). A04-G1 flip pending
  (~22 tables done). Highest-leverage safety item.
- **R-register (security):** R2 (26 routes unclassified), R3 (JWT actor attribution), R4
  (entitlement vocab collision), R5 (worker→brief filtering unverified), R6 (LLM batching
  unaudited), R7 (audit coverage), R9 (API-key role bypass), R11 (no upload quota).
- **Dead code mass:** ~40% of `src/` excluded but present (`_frozen_prod`, `_excluded_prod`,
  `*_DISABLED`, `src/signals`, `src/ingestion`, `_quarantine`, `packages/_legacy_engine_core`);
  root scratch files. Comprehension + review-noise drag.
- **Pricing drift:** 3 conflicting price sets (parked behind a Stripe decision).
- **Cross-region workers:** posture + data-rights (prod) in Oregon → Virginia DB.
- **Multiple contracts locations:** `packages/contracts` (authoritative for external) vs
  `src/contracts` / `src/engine/contracts` (local types). Reconcile.
- **Frontend drift:** app React 18 vs website React 19; zero shared components.
- **Framework depth (UNKNOWN):** README claims ISO 27001; crosswalk has iso_42001. Reconcile.

## 5. Deferred / parked items (NOT authorized without a fresh decision)
GDPR tails (export-delivery email PR #4, deletion-reaper enablement — shipped flag-gated/inert
#341, org_full intake + admin authz, export-file purge) · tenant-isolation-enforcement sweep ·
A04-G1 `app_request` flip · Pillar-1 later tasks (concentration risk, nth-party cascade,
inherent/residual split) · entitlement-vocabulary consolidation (R4) · per-API-key role scoping
(R9) · Oregon→Virginia worker re-provision · in-app price-label fix.

## 6. Standing process rules (VERIFIED)
- `BUILD_SEQUENCE.md` is the live build doc; `SEQUENCED_BUILD_PLAN.md` is deprecated (halt if
  asked to edit it for sequencing).
- One package/commit; no commit without authorization; present exact scope and stop.
- Branch-sync promotes use `--merge` (not squash) — see **securelogic-release-pr-reviewer**.
- A stale governing doc → stop, request a doc-sync decision before major package work.

## Cross-references
Architecture sequencing judgment → **securelogic-enterprise-architect** (`roadmap-assumptions.md`).
Release/promotion mechanics → **securelogic-release-pr-reviewer**. Security debt detail →
**securelogic-security-reviewer**.
