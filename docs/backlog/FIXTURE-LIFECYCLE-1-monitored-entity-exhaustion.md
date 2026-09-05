# FIXTURE-LIFECYCLE-1 — a vendor's monitored-entity slot can never be released

**Status:** OPEN. **Retained deliberately by owner instruction (2026-09-05):**
the staging fixture cleanup performed that day is *not* closure of this issue.
**Class:** product defect (metering / lifecycle), with a validation-operations
symptom.
**Severity recommendation:** **P2 — customer-visible billing/metering
correctness, no data-integrity or security exposure.**

---

## The defect

`src/api/lib/entityLimit.ts` defines a monitored entity as **a row that exists**
in `vendors` or `ai_systems`, counted against `organizations.max_monitored_entities`.
Its own doc comment states the intended escape hatch:

> "The rule is intentionally simple and symmetric: a monitored entity is a row
> that exists; **to stop paying for one, delete it.** `vendors.status` is NOT
> part of this count (it keeps its existing archive purpose)."

**There is no `DELETE` route for a vendor.** `src/api/routes/vendors.ts` has no
`router.delete` at all. (`ai_systems.ts:774` does have one — the asymmetry is
the tell.) So the documented way to stop paying for a monitored vendor does not
exist, and the only lifecycle the product offers — archiving — is explicitly
excluded from the count.

**Consequences, in order of who feels them:**
1. **A customer cannot reduce their metered vendor count, ever.** Every vendor
   ever created counts against the cap for the life of the tenant. On a paid
   plan that is a billing-correctness problem, not merely an ergonomic one.
2. **The cap becomes a one-way ratchet.** Once at the cap, the only remedy is an
   operator raising `max_monitored_entities` via `PATCH /admin/organizations/:id`
   — a sales-led action with no self-service path.
3. **Repeated validation journeys exhaust the staging walkthrough org.** This is
   the symptom that surfaced it: WA-1/WA-2/WA-3 and the Assessment Composition
   journey each create a vendor per run, and by 2026-09-05 the org sat at
   **75/75**, so the next journey run would have failed on
   `entity_limit_reached` before asserting anything.

## Why deletion is hard, and why that is the real work

A vendor cannot simply be deleted, and the reasons are legitimate:
- `vendor_engagements.vendor_id`, `vendor_assessments.vendor_id` and
  `vendor_reviews.vendor_id` are **ON DELETE RESTRICT** — assurance history is
  deliberately not disposable;
- five tables in the cascade closure carry **append-only WORM triggers that
  RAISE on DELETE**, and Postgres fires row triggers on FK *cascade* deletes
  too: `engagement_applicability`,
  `vendor_engagement_applicability_challenges`,
  `vendor_engagement_composition_snapshots`,
  `vendor_engagement_relationship_reseeds`, `vendor_relationship_intake`;
- `vendor_relationships.classification_intake_id` is RESTRICT **and**
  `CHECK vendor_relationships_classification_provenance` requires a classified
  relationship to name the intake it was classified from — so the pointer cannot
  be nulled out of the way either. The intake may only leave via the
  relationship's own cascade.

So "add a DELETE route" is the wrong fix. The right fix is a **decommission
lifecycle** that releases the metering slot without destroying assurance
history. Sketch, for whoever picks this up:
- a terminal `decommissioned` vendor state, excluded from
  `enforceEntityLimit`'s count but retaining every historical row;
- refuse the transition while an engagement is live (mirroring the existing
  `SCOPE_MUTABLE_STATES` / `PORTAL_WRITABLE_STATES` discipline);
- decide explicitly whether a decommissioned vendor can be reinstated, and what
  that does to the count;
- this is a **metering** change, so it needs a billing decision, not just an
  engineering one.

Note the same question is open for `ai_systems`, which *can* be deleted — the
two halves of one cap behave differently today.

## The staging symptom, and what was done about it

On 2026-09-05, under explicit owner authorization, 49 synthetic journey fixtures
were removed from the staging walkthrough org, taking it from **75/75 to 26/75**.
That was performed by `scripts/validation/cleanup-walkthrough-fixtures.mjs`, a
targeted, guard-railed, dry-run-by-default mechanism written for the purpose
because no application deletion path exists to use. Full before/after inventory:
`docs/validation/wa4-fixture-cleanup-2026-09-05.md`.

**That is maintenance, not a fix.** The cleanup script:
- is pinned to one hard-coded staging org id and refuses to run elsewhere;
- selects only names matching an anchored harness pattern carrying a machine
  timestamp;
- is not, and must not become, a customer-facing capability.

Every future validation journey still consumes a slot that only that script can
release. The WA-3 journey already works around the ceiling by **reusing** a
vendor rather than creating one per run — that workaround is the pattern new
journeys should copy until this defect is fixed, and it is the reason WA-3's
harness stopped exhausting the org.

## Explicitly NOT closed by the cleanup

- the missing decommission lifecycle;
- the customer's inability to reduce a metered count;
- the vendors/ai_systems asymmetry;
- journeys consuming a permanent slot per run.
