# Example: a worked doc-sync reconciliation

A reproducible reconciliation (the 2026-06-25 pass). The point is the **method**, not the
specific findings — re-run the commands; the state moves.

## 1. Detect drift
```bash
git log -1 --format='%ci %h' -- BUILD_SEQUENCE.md   # froze ~2026-06-24, ~step 6/7 of Pillar 1
git log --oneline -30                                # ~25 commits merged PAST that freeze
```
**Conflict (VERIFIED):** `BUILD_SEQUENCE.md` still names `pillar1-vendor-assurance-worker` as
Active with "do NOT flip the prod flag," yet later work merged and the package's own scope
guard was crossed.

## 2. Verify the active package's completion against ITS criteria
```bash
git log --oneline --grep='Pillar 1' -i
# #229 job_type migration · #230 worker core · #231 service · #232 enqueue route flip ·
# #233 premium gate · #234 render.yaml blocks · #235 queue-depth alerting
git log --oneline --grep='soak' -i                  # a8ce6de8 "§E Part 1 staging soak PASS (5/5)"
```
- **VERIFIED:** steps 1–7 shipped; route flip confirmed in `vendorAssuranceDocuments.ts:316`
  (`INSERT INTO jobs … 'vendor_assurance_extract'`); render.yaml has both worker blocks.
- Acceptance for THIS package = **staging soak green** (NOT the Phase-1 30-SOC/3-auditor gate,
  which belongs to a different package). Soak PASS recorded `a8ce6de8` → **mark Complete.**

## 3. Check "merged vs. stranded branch" before claiming anything done
```bash
git branch -a --contains a8ce6de8   # → develop, main  → VERIFIED merged
git branch -a --contains dcd09f2a   # → feat/vendor-surface-premium-completion ONLY
```
**Correction:** the step-5 deferred follow-up (3 vendor routes → premium, `dcd09f2a`) is **NOT
merged** → it stays OPEN. (This is exactly the trap that prevents a false "Complete.")

## 4. Distinguish repo-verifiable from operator-only
- Part 2 Phase 2A claim-gate merged (#241→#242→#243) → **VERIFIED.**
- Full prod enablement (prod R2 + ANTHROPIC moved to worker + the prod flag flip): committed
  `render.yaml` carries `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` on **staging engine only**
  (HEAD:render.yaml:285). Prod flip = dashboard → **UNKNOWN from repo, manual confirm.**

## 5. Classify the post-freeze merges (for the Completed section)
Each with a citation: signal engine to prod (#342 `4a709334`, VERIFIED commit / prod runtime
INFERRED), matcher GAP-3 + telemetry (#354/#355), alerting + weekly-brief (#347/#348/#349),
feed maintenance (#351/#352/#338), website rebuild (#356–#360), GDPR reaper flag-gated/inert
(#341), seat cap (#340), A04-G1 RLS ~22 tables (#312–#337, in-flight infra).

## 6. Recommend the next active package (+ risks)
- **Recommended:** `external-signal-architecture` (Priority 3) — docs/design, zero prod risk,
  timely now that the signal engine is live, unblocks P4/P5 (the weakest layer), respects the
  fixed order (P1 satisfied by this sync; P2 standard written; enforcement is in-flight A04-G1).
- **Risks of choosing differently:** jumping to P4 → adapter improvisation; pulling
  tenant-isolation-enforcement → collides with in-flight A04-G1; a Brief/UI package → violates
  "signal quality before presentation polish"; treating the RLS flip as a product package →
  miscategorizes in-flight infra.

## 7. Stop for approval; then docs only
Present the proposed markdown diff + rationale + open items + recommendation. **Wait for
operator approval.** On approval, edit **only** `BUILD_SEQUENCE.md` (and other governing docs as
needed) — never application code.

## The reusable rules this illustrates
- Re-read the doc; don't trust memory for the active package.
- `git branch --contains` before any "Complete" (stranded-branch trap).
- Acceptance = the package's OWN criteria; prod/dashboard config is UNKNOWN from the repo.
- Recommend, don't decide, the next active package — selection is the operator's call.
