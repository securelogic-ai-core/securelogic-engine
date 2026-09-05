# Staging walkthrough-org fixture cleanup — 2026-09-05

Performed under explicit owner authorization ahead of WA-4 validation.
**Staging only.** No production data was queried or modified.

Org: `[SEED] Walkthrough Org` (`295b989a-89d6-49ec-a7ed-deb04489d068`),
database `securelogic_staging`, cap `max_monitored_entities = 75`.
Mechanism: `scripts/validation/cleanup-walkthrough-fixtures.mjs`
(dry run first, then `--apply`), executed as a Render job on
`securelogic-engine-staging`.

## Before

| | count |
|---|---|
| vendors | **74** |
| ai_systems | **1** |
| **monitored entities used / cap** | **75 / 75 — at the ceiling** |

The org could not have accepted one more entity; WA-4's first journey run would
have failed on `entity_limit_reached` before asserting anything.

## The fixture-selection rule (exact)

A vendor was selected **iff all five held**, with guards 3–5 re-evaluated inside
the deleting transaction rather than only at selection time:

1. `organization_id` is exactly the staging walkthrough seed org — the script
   refuses to run if that id is not named `[SEED] Walkthrough Org`;
2. `name` matches this anchored pattern:
   ```
   ^(WA1 journey|WA2 journey|Walkthrough Payments) [0-9]{8}T[0-9]{6}$
   |^WA3 (issued|draft) [0-9]{8}T[0-9]{6}$
   |^WA3 corrected-corpus [0-9]{13}$
   |^WA3 journey harness$
   ```
3. the name is not on the ambiguous-exclusion list (below);
4. it was created after the WA-3 freeze instant `2026-08-28T18:06:54Z` **and**
   owns no engagement created before it — so it cannot intersect the frozen
   historical corpus;
5. it carries **no** finding, **no** `vendor_assessments` row and **no**
   `vendor_reviews` row.

### Why the rule cannot select a legitimate record

Every prefix is a **string literal lifted from a journey script**, not a guess:
`wa1-…journey.mjs:66`, `wa2-…journey.mjs:64`, `wa3-…journey.mjs:97,118`,
`assessment-composition-staging-journey.mjs:41`. Every alternative but the one
fixed harness constant requires a **trailing machine timestamp** —
`YYYYMMDDTHHMMSS` from `new Date().toISOString()`, or a 13-digit epoch — anchored
with `$`. A human-entered vendor name cannot satisfy that, and a real vendor
(`Stripe`, `Microsoft`, `Cisco`, `Harbourline Data Services`, `SecureLogic AI`)
cannot match any prefix.

**The rule is deliberately not age-based and not creation-order-based**, as
instructed. Proof it does not over-reach: run against the whole database, it
matched **0 rows in every other organization** (`rule_outside_org` returned an
empty set across the other 18 orgs).

Guard results at apply time: `wrong_org 0`, `predates_freeze 0`,
`consequential 0`.

## Intentionally preserved because fixture status was ambiguous

Three vendors **matched the rule and were still not deleted**. Each owns an
engagement whose id is cited by name in a signed-off validation record. The
citations are illustrative rather than load-bearing, but a record named in a
signed-off document is ambiguous, and ambiguous records are not deleted.

| vendor | cited engagement | citation |
|---|---|---|
| `Walkthrough Payments 20260904T145113` | `57d4d327` | `wa3-historical-corpus-determination-2026-09-05.md:127` |
| `Walkthrough Payments 20260904T150050` | `7c317105` | same line |
| `Walkthrough Payments 20260904T175500` | `d7173d50` | `assessment-composition-v1-2026-09-04.md:22` (hydration probe) |

The check that found them was mechanical: every selected vendor's id, engagement
ids and relationship ids were tested against **all 688 distinct 8-hex tokens
appearing anywhere in `docs/`, `BUILD_SEQUENCE.md` and the root `*.md` files**.
Those three were the only collisions.

Also preserved — synthetic, but from **other** packages' runs and outside the
authorized WA-1/2/3 scope, so left alone rather than swept up: 7× `VO2 E2E
Payments …`, 4× `AC1 E2E Payments …`, `VO2 contact-repro 0904a`,
`GAP contact-probe …`, `WA1 size-probe …`, `EXCL probe …`, `CAPCHECK2 …`.
And `[VA-E2E] Northwind Cloud Ltd`, which alone holds **27 of the 27**
`vendor_engagement` findings on staging — it is the evidence base for several
prior validation records and must not be touched.

## A correction to the briefed figures

The brief stated *38 of 74 vendors are journey fixtures — WA-1: 9, WA-2: 17,
WA-3: 12.* Measured:

| | briefed | measured |
|---|---|---|
| WA-1 | 9 | **8** (`WA1 journey <stamp>`) |
| WA-2 | 17 | 17 ✓ |
| WA-3 | 12 | 12 ✓ |
| Composition journey (`Walkthrough Payments <stamp>`) | not listed | **15** |
| **total synthetic journey fixtures** | 38 | **52** |

The ninth "WA-1" is `WA1 size-probe 20260904T223401Z`, a manual capacity probe
rather than a journey fixture; the strict rule does not match it and it was
preserved. The larger gap is the composition journey's 15, which the brief did
not account for. The briefed 38 therefore **undercounted** the synthetic
population.

## Deleted

52 matched the rule; 3 were excluded as ambiguous; **49 were deleted.**

| table | rows removed |
|---|---|
| `vendors` | **49** |
| `vendor_engagements` | 65 |
| `vendor_relationships` | 85 |
| `vendor_contacts` | 65 |
| `vendor_engagement_scope_items` (cascade) | 3,693 |
| `requirement_responses` (cascade) | 376 |
| `vendor_assurance_documents` / `signal_vendor_links` / `ai_system_vendor_dependencies` | 0 / 0 / 0 |

The 376 responses were journey-generated answers on fixture engagements. They
are stated here rather than passed over silently: no real vendor's answers were
touched, and the guard proving it is `consequential = 0` plus the 25-row
survivor list below.

Deletion order mirrors the already-approved teardown in
`seed-walkthrough-org.ts`, including its transaction-scoped WORM-trigger
disable. Two ordering defects were found and fixed by **failing closed** rather
than by force — each aborted run rolled back with nothing deleted:
1. `engagement_applicability` carries a WORM trigger that RAISEs on cascade
   delete and was missing from the disable list. The list is now **derived** by
   querying `pg_trigger` for every DELETE-event row trigger in the FK cascade
   closure, not enumerated by hand.
2. Nulling `vendor_relationships.classification_intake_id` to clear the RESTRICT
   violates `CHECK vendor_relationships_classification_provenance`. The intake
   may only leave through its relationship's own cascade — which is the correct
   order and is now what the script does.

## After

| | count |
|---|---|
| vendors | **25** |
| ai_systems | 1 |
| **monitored entities used / cap** | **26 / 75** |
| **remaining capacity** | **49** |

Survivors are exactly the 22 non-matching plus the 3 ambiguous exclusions.

### Post-conditions verified after commit
- all six WORM triggers re-enabled (`tgenabled = 'O'`);
- **other organizations untouched** — 20 vendors elsewhere, unchanged;
- the frozen historical corpus intact — 129 scope items on pre-freeze
  engagements still bound to question version 1;
- the owner's own walkthrough engagement `f27c87ae` (Stripe, `submitted`) intact.

## What this does NOT close

The underlying product defect — a vendor's monitored-entity slot can never be
released, because `entityLimit.ts` counts rows and no vendor DELETE route
exists. Retained as
`docs/backlog/FIXTURE-LIFECYCLE-1-monitored-entity-exhaustion.md`. This cleanup
is staging maintenance and is **not** justification for raising or weakening the
75-entity cap.
