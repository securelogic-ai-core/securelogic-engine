# ADR-0009 — A vulnerability reappearing does NOT reopen the canonical Finding

- **Status:** ACCEPTED (2026-08-21). Ruled by the product owner on the SL-OCC-2 report.
- **Date:** 2026-08-21
- **Applies to:** `finding_asset_occurrences` (migration `20261034`),
  `vulnerability_observations` (migration `20261035`), `findingLifecycleMachine`,
  `occurrenceLifecycle`, `observationReconciliation`.
- **Related:** ADR-0002 (vulnerability intelligence resolves to canonical Assets),
  ADR-0004 (finding→risk promotion and unified approvals).

---

## Decision

**Recurrence is preserved and surfaced at the OCCURRENCE level. Reopening a Finding
remains an explicit, authorized human governance action.**

The engine must never transition a Finding out of a closed or resolved state because
a scanner reported an exposure again.

---

## Context

SL-OCC-2 introduced recurrence: an occurrence that stopped being reported and is later
reported again. The obvious next step — "if it's back, reopen the finding" — is wrong,
and the reason is already in the code rather than in anyone's preference.

`operational_status` is **DERIVED, not stored**. `findingLifecycleMachine.ts`:

```
if (closure?.decisionState === "resolved") return "closed";
```

A Finding is closed because `decision_state = 'resolved'` — a **governance decision**
recorded by a person, through the closure gate, under separation-of-duties and evidence
requirements. Reopening already exists as a governance transition
(`resolved → needs_review`, audit event `finding.reopened`).

Therefore an automatic reopen driven by an observation would not be "updating a status".
It would be **the engine silently reversing a documented human decision** — overwriting
the output of an approval workflow with an inference drawn from a scanner.

This is the same class of error SL-EXC-1 was created to fix: the platform asserting a
lifecycle state that no human claimed. There, an approved exception wrongly closed a
finding. Here, a scan would wrongly reopen one. Both replace a person's recorded judgement
with machine inference, and both are invisible once written.

## Consequences

**What the engine DOES do:**

- records the recurrence truthfully on the occurrence: `reappeared_count`,
  `last_reappeared_at`, and the original `first_seen_at` **preserved** (an exposure that
  went away and came back is the same exposure with a gap, not a new one);
- flips the occurrence's `presence_status` back to `present`;
- emits `vulnerability_occurrence_reappeared` with the message
  *"finding NOT reopened automatically"*, and an audit event;
- surfaces "Recurring" in the affected-assets rollup so a human can see it.

**What the engine does NOT do:**

- change `decision_state`;
- change `operational_status`;
- re-rate severity, recompute the SLA, or reset the due date;
- close a Finding when every occurrence goes absent — `isClosureEligible()` is
  report-only, inheriting ERIP-AD-11 ("drift is reported, never destructive").

**The asymmetry is deliberate and load-bearing.** A scanner may always tell us something
IS there. It may only tell us something is GONE when it has earned that right (a completed,
scope-declared run that covered the asset — SL-OCC-2). And it may never tell us what a
human decided.

## Why not the alternatives

- **Auto-reopen on recurrence.** Reverses an approval-gated human decision with no human
  in the loop, and would make a closed finding's state depend on scanner uptime.
- **Auto-reopen only if closed recently.** Same defect with an arbitrary threshold, and the
  threshold would become the thing people argue about instead of the principle.
- **A separate "recurred" status on the Finding.** A third value on an axis that is derived,
  not stored — it would have to be understood by every consumer that enumerates the existing
  states, and each one that forgot it would fail silently. Occurrence-level counters carry the
  same information without touching the Finding's vocabulary.

## Enforcement

This decision is asserted in code so it cannot drift accidentally:

- `src/api/__tests__/recurrenceDoesNotReopen.test.ts` — the invariant, named for the ADR.
- `test/isolation/vulnerabilityObservationsRls.test.ts` — "NO FALSE CLOSURE, under any of
  the above": no finding is closed by any scan, absence or reconciliation, and a human's
  remediation survives a later clean scan.
- `src/api/lib/occurrenceLifecycle.ts` — `isClosureEligible()` is report-only by name and
  by contract.
- `src/api/lib/observationReconciliation.ts` — `presenceFromObservations()` never returns a
  Finding state, only a presence.

**If a future package wants automatic reopen, it must supersede this ADR — not quietly add
the behaviour.**
