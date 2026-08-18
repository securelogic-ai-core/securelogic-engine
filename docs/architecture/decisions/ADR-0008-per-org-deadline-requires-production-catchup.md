# ADR-0008 — A per-org Brief deadline may not be enabled in production until production catch-up is enabled and validated

- **Status:** RATIFIED (2026-08-18). Operator approval of the per-org deadline
  design, with this dependency recorded as an explicit precondition.
- **Date:** 2026-08-18
- **Source:** `docs/investigation/brief-scheduler-per-org-deadline-design.md`,
  built on the measured staging run of 2026-08-18 (`scheduler_cron_complete`,
  engine `srv-d7n0rju8bjmc738jbs7g`: 10.99 h, 13 orgs, 13 published, 0 errors).

---

## The decision

**A per-org processing deadline in the weekly Intelligence Brief scheduler MUST
NOT be enabled in production until `SECURELOGIC_BRIEF_CATCHUP_ENABLED` is `true`
in production AND that catch-up path has been validated there.**

This is a precondition, not a follow-up item.

## Why

A deadline stops an org mid-run and leaves it without a published brief for the
current weekly window. Recovery is not automatic — it is the catch-up path's
job. `briefCatchup` is completeness-based on *published* `intelligence_briefs`
rows for the current window, so a deadline-stopped org is exactly the "missing
tail" it exists to reconcile, and completed orgs are skipped
(`scheduler_org_skipped_already_current`). Email double-delivery is
independently prevented by the `intelligence_brief_sends` idempotency guard.

The flag states are asymmetric:

| environment | `SECURELOGIC_BRIEF_CATCHUP_ENABLED` |
|---|---|
| staging | `true` |
| **production** | **`false`** |

So on production as configured today, enabling a deadline would convert **"this
org is slow"** into **"this org silently missed its weekly edition"** — with no
automatic recovery, no customer-visible signal, and remediation available only
via the next Tuesday run or a manual
`POST /api/admin/briefs/run-scheduler`.

That is a strictly worse customer outcome than the slow run the deadline is
meant to improve on. A reliability control that converts a latency problem into
a silent delivery failure is not a reliability control.

## What "validated" means

Not merely flipping the flag. Before a production deadline may be enabled:

1. Production catch-up is enabled.
2. A catch-up run has been observed in production reconciling at least one
   genuinely missing org, generating exactly once, with no duplicate brief and
   no out-of-window email (the Tuesday send-day gate is unchanged and must hold).
3. The catch-up trigger's own logging confirms the completeness check ran
   against the correct weekly window boundary.

## Scope

This ADR governs **enabling enforcement in production**. It does not block:

- building the deadline behind a default-off control;
- enabling it in staging, where catch-up is already `true`;
- the per-org completion telemetry (`scheduler_org_complete`), which carries no
  enforcement and is a prerequisite of setting any threshold at all.

---

## Companion policy — how the initial threshold is set

**The initial deadline value MUST be derived from at least three weekly cycles
of per-org duration telemetry collected AFTER both the verdict cache and bounded
per-org concurrency are live. It MUST NOT be inherited from the 2026-08-18 run.**

Reasoning:

1. **One run is one sample.** It establishes no distribution, no p99, and cannot
   distinguish a persistent property of a slow org from a one-off.
2. **The profile is about to change materially.** The 2026-08-18 measurement
   predates the verdict cache (`bfe79f78`) and the bounded fan-out
   (PR #808), neither of which staging had at the time. Both change per-org
   cost. A threshold derived from that run would be obsolete on arrival.
3. **The measured run does not support a tight value anyway.** On its numbers a
   30- or 45-minute deadline would have stopped **4 of 13 orgs (31%)** — all
   four of which published successfully, with zero errors and zero enrichment
   fallbacks. They were slow, not broken.

### Note on the superseded figure

The prior working figure for the run has been quoted as ~4.5 hours. The measured
value is **10.99 h sequential** (`durationMs 39624403`), with **6.24 h**
projected at `ORG_CONCURRENCY = 2` over the real per-org durations and a hard
floor of **3.15 h** set by the single longest org. Whichever earlier figure was
in circulation, it is superseded and must not be used to set a threshold — which
is the substance of this policy either way.

### Reassessment trigger

Reassess when all of the following hold:

- verdict cache live in the measured environment;
- bounded per-org concurrency live in the measured environment;
- `scheduler_org_complete` telemetry collected across **≥ 3 weekly cycles**;
- the resulting per-org duration distribution reviewed, with the threshold set
  from an observed upper percentile plus headroom — never from a single maximum.

---

## Consequences

- The deadline package is sequenced behind an operator decision it does not
  control. That is intentional and is the point of this record.
- Per-org completion telemetry is unblocked and ships first, since the threshold
  cannot be chosen without it.
- If production catch-up is judged undesirable, the deadline does not ship to
  production at all; the ingest cost (~5,300 sequential per-signal matcher runs
  per org per week) is then the only lever left for the slow-run problem, and it
  is the larger one regardless.
