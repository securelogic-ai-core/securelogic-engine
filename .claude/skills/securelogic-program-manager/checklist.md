# Checklist — Program Manager

## Before any package starts
- [ ] Re-read `BUILD_SEQUENCE.md` (Active package + Completed + In-Flight) — not memory.
- [ ] Confirmed the work IS the active package (operator-confirmed), not deferred/parked.
- [ ] Searched for prior shipment: `git log --grep`, Completed section, `git branch --contains`
      — not a duplicate.
- [ ] Confirmed it's not in-flight infrastructure (A04-G1) that runs in parallel.
- [ ] Explicit authorization to proceed; exact scope written down.

## Doc-sync (when reconciling drift)
- [ ] Established when `BUILD_SEQUENCE.md` last changed vs. what merged after
      (`git log -- BUILD_SEQUENCE.md` + `git log --oneline`).
- [ ] Each claim tagged **VERIFIED / INFERRED / RECOMMENDED / UNKNOWN** with a commit/PR/file
      citation.
- [ ] Every "Complete" verified against ITS acceptance criteria (not a different package's gate);
      prod-enablement that's dashboard-only marked UNKNOWN / manual.
- [ ] Confirmed each "merged" commit is actually on develop/main (`git branch --contains`), not a
      stranded feature branch.
- [ ] Conflicts between doc and code surfaced explicitly.
- [ ] Next active package recommended with rationale + risks of a different choice.
- [ ] **Operator approval obtained before writing the file.** Only docs edited — no app code.

## Marking a package Complete (BLOCKING gate)
- [ ] Acceptance criteria met OR an explicit, justified case to revise them.
- [ ] Commits merged to the target branch (cited).
- [ ] Remaining open tails/deferred items listed (not silently dropped).

## Sequencing a recommendation
- [ ] Respects the fixed priority order (or justifies a deviation in the doc).
- [ ] Cites the technical-debt register where relevant (tenant isolation, R1–R11, dead code,
      pricing drift, cross-region, contracts, ISO claim).
- [ ] Prefers the smallest correct next step over the biggest wishlist.
- [ ] Doesn't pull in-flight infra (A04-G1) into the product queue.

## Documentation hygiene
- [ ] After any package, governing docs + canonical model + skills reflect shipped reality.
- [ ] No edits to the deprecated `SEQUENCED_BUILD_PLAN.md` for sequencing (halt + surface).
- [ ] No conflicting claims left across docs.
