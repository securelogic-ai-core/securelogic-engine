# Investigation — why CUEC-promoted findings never reach vendor risk

**Produced:** 2026-08-22. **Investigation only.** No code modified, nothing
merged, production untouched, frozen candidate `65cd3330` unchanged, #826
undisturbed, ADR-0010 **not** settled by this document.

**Trigger:** discovered while building T1-B (PR #861), reported there, deliberately
not fixed.

---

## A. Root cause

**Classification: (4) architectural ambiguity, which produced (2) inconsistent
writer semantics, which surfaces as (1) a resolver bug in three separate readers.
Not (3) — the provenance data exists and is structurally sound.**

`findings.source_id` is a **polymorphic association with no structural
enforcement**. Verified: there is **no foreign key on `findings.source_id`
anywhere in `db/migrations/`**. Its meaning is defined entirely by `source_type`,
by convention, in comments.

The platform-wide convention is *"`source_id` is the id of the row in the
workflow table that produced the finding."* Every writer obeys it — **except the
CUEC promotion**, which writes a `vendors.id` under `source_type='vendor_review'`,
a source type whose other writer writes a `vendor_assessments.id`.

**Why it drifted without anything breaking:** three source types have a partial
unique index keying `source_id` —

```
idx_findings_generated_applicability      (organization_id, source_id) WHERE source_type='applicability_assessment'
idx_findings_intelligence_event_unique    (organization_id, source_id) WHERE source_type='intelligence_event'
uq_findings_engagement_requirement        (organization_id, source_id, requirement_id) WHERE source_type='vendor_engagement'
```

— and **those are exactly the source types whose meaning has not drifted.**
`vendor_review` has no such index. Where the database held an opinion, the
convention held. Where it did not, two writers diverged silently.

**The codebase documents the conflict in contradictory directions**, which is the
strongest evidence this is ambiguity rather than an oversight:

| File | Claim |
|---|---|
| `vendorAssessments.ts:190` | *"source_type = 'vendor_review', source_id = assessmentId **(NOT vendor_id)**"* |
| `vendors.ts:7` | *"Findings originating from vendor reviews reference the vendor via source_type = 'vendor_review' and **source_id = vendors.id**"* |
| `vendorAssuranceDocuments.ts:1676` | *"source_id points at the **VENDOR**"* |

`vendors.ts`'s header contradicts **its own route list** two lines later
(*"findings linked to vendor **via assessments**"*) and its own implementation,
which joins `vendor_assessments`. That header is stale, and it is plausibly what
the CUEC promotion was written against.

## B. Current writer semantics — every writer, and how the meaning is held

Enumerated exhaustively from `INSERT INTO findings` across live code (15 files;
`src/_frozen_prod`, `_excluded`, `_disabled`, `_quarantine` excluded).

| `source_type` | Writer | `source_id` means | Structural | Documented | Tested |
|---|---|---|---|---|---|
| `vendor_review` | `vendorAssessments.ts` | `vendor_assessments.id` | ✗ | **✓ emphatically** | via route tests |
| **`vendor_review`** | **`vendorAssuranceDocuments.ts`** | **`vendors.id`** | ✗ | ✓ (in its own comment) | ✗ **no test asserts which it is** |
| `vendor_cycle_review` | `vendorReviews.ts` | `vendor_reviews.id` | ✗ | ✓ *"(NOT vendor_id)"* | ✓ |
| `vendor_engagement` | `vendorEngagements.ts` | `vendor_engagements.id` | **✓ partial unique index** | ✓ | ✓ |
| `applicability_assessment` | `applicabilityWorkflowDispatcher.ts` | `applicability_assessments.id` | **✓ index** | ✓ | ✓ |
| `intelligence_event` | `eventFindingStore.ts` | `intelligence_events.id` | **✓ index** | ✓ | ✓ |
| `cyber_signal` | `cyberSignalProcessingService.ts` | `cyber_signals.id` | ✗ | ✓ *"(NOT the vendor/ai_system id)"* | ✓ |
| `control_test` | `controlAssessments.ts` | `control_assessments.id` | ✗ | ✓ | ✓ |
| `ai_review` | `governanceReviews.ts` | `governance_reviews.id` | ✗ | ✓ | ✓ |
| `ai_governance_review` | `aiGovernanceAssessments.ts` | `ai_governance_assessments.id` | ✗ | ✓ | ✓ |
| `obligation_review` | `obligationAssessments.ts` | `obligation_assessments.id` | ✗ | ✓ | ✓ |
| `dependency_review` | `dependencyAssessments.ts` | `dependency_assessments.id` | ✗ | ✓ | ✓ |
| `pen_test` | `#840` intake | `pen_test_engagements.id` | ✗ | ✓ | ✓ |

**Only one writer breaks the pattern, and it is the only one with no test
asserting what it writes.**

## C. Current reader assumptions — all of them assume "assessment id"

| Reader | Assumption | Effect on CUEC-promoted findings |
|---|---|---|
| `vendorRiskScoreRecompute.resolveVendorIdForFinding` | `va.id = f.source_id` | **Returns NULL** — no recompute is ever scheduled |
| `vendorRiskScoreRecompute` **scoring query** | `JOIN vendor_assessments va ON va.id = f.source_id` | **Excluded from the score input** — a *second*, independent exclusion |
| `vendors.ts` `GET /vendors/:id/findings` | same join | **Finding never appears on the vendor** — customer-visible |
| `findingContextResolver.ASSESSMENT_AFFECTED_MAP` | `vendor_review → vendor_assessments → vendor_id` | Affected-entity context resolves to nothing |
| `findingEntitySearch` | `{ table: "vendor_assessments", fk: "vendor_id" }` | Finding not discoverable by vendor entity search |
| `evidence.ts SOURCE_TYPE_TABLE` | `vendor_review → vendor_assessments` | Evidence linkage validation looks in the wrong table |

**The double exclusion in vendor risk is the important detail.** Fixing only the
resolver would not fix the score: even when a recompute is triggered by some
*other* finding on the same vendor, the scoring query independently excludes
CUEC-promoted findings. Both arms must change together or the fix is cosmetic.

## D. The authoritative relationship

**`vendor_assurance_cuecs.promoted_finding_id` — and it is the strongest link in
this entire area**, because unlike `source_id` it is enforced by the database:

```sql
promoted_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL
```

Plus a CHECK that only a `gap` may carry one
(`vendor_assurance_cuecs_promotion_requires_gap`).

The authoritative chain, every hop FK-backed and org-scoped:

```
findings.id
  ← vendor_assurance_cuecs.promoted_finding_id      (FK)
  → vendor_assurance_documents.id via document_id   (FK)
  → vendors.id via vendor_id                        (FK)
```

**`source_id` should not be used to resolve the vendor for a CUEC-promoted
finding, now or after any fix.** It is an unconstrained UUID whose meaning is a
comment.

## E. Does T1-B change the correct solution? — **Yes, decisively**

T1-B (PR #861) already built and proved this exact resolution path:

- The same three-hop join, **org-scoped on both sides of every join**.
- **Five real-Postgres isolation assertions**, proven non-vacuous by mutation:
  removing `c.organization_id` turns 4 of 5 red.
- The load-bearing case is already covered: a **cross-wired CUEC in org B naming
  org A's finding** does not surface for org A.

**So the fix is a reuse, not an invention.** Before T1-B the correct fix would
have required designing and proving a new resolution path. Now it requires
lifting `findingVendorProvenance.ts`'s query shape into a shared resolver and
pointing the readers in §C at it.

That materially shrinks the fix and its risk, and it is a concrete argument that
authorising T1-B during the freeze paid for itself twice.

## F. Tenant-isolation implications

**The resolver itself is safe.** `resolveVendorIdForFinding` scopes both joins:
`AND va.organization_id = f.organization_id`. A cross-wired id cannot associate
org A's finding with org B's vendor there.

**Two readers are not.** Both of these join `vendor_assessments` / `vendor_reviews`
with **no org predicate on the joined table** — only `f.organization_id = $2`:

- `vendors.ts` `GET /vendors/:id/findings` (both UNION arms)
- `vendorRiskScoreRecompute` scoring query (both UNION arms)

Neither can leak another org's **findings** (those are scoped). Both could leak
another org's `assessment_id` / `assessment_type` / `performed_at`, or count a
foreign assessment's vendor, **if ids collided**. With random UUIDs that is not a
practical attack, but the predicate is missing and the pattern is wrong.

Additionally, `GET /vendors/:id/findings` **never verifies the URL's `vendorId`
belongs to the caller's organization** — it is used only as a filter value.

**Requirement for any fix:** the new CUEC arm must be org-scoped on **both sides
of every join**, exactly as T1-B's already is. The T1-B isolation test is the
template, including the deliberately cross-wired case.

## G. Customer-visible consequence

1. **A promoted CUEC gap does not appear on its own vendor's findings list.** A
   customer who reviews a SOC 2, records a gap, promotes it, then opens the
   vendor, sees nothing. This is the most damaging symptom because it looks like
   the promotion silently failed.
2. **The vendor's risk score does not move** when a gap is recorded against it.
3. Finding-context and entity search cannot associate the finding with the vendor.
4. The finding itself is entirely correct and fully tracked in Findings — **no
   data is lost or wrong.** The failure is relational, not a corruption.

**T1-B partially masks this**: the finding now shows its vendor. So after T1-B a
customer can get from finding → vendor, but still not vendor → finding. The loop
remains open in the other direction.

## H. Vendor-risk scoring consequence

- `vendors.current_risk_score` is **stale by omission** for any vendor whose only
  new findings came from CUEC gaps.
- The omission is **silent** — no error, no log, no zero. `resolveVendorIdForFinding`
  returning `null` is an ordinary, expected outcome for non-vendor findings, so
  nothing distinguishes "not a vendor finding" from "vendor finding we failed to
  resolve".
- **Residual risk:** not directly affected. `vendor_engagements.residual_score`
  is computed on the engagement spine, which the document spine does not feed
  (ADR-0010). This defect does not change that and must not be used to argue it.
- **Reporting:** any surface reading `current_risk_score` or
  `/vendors/:id/findings` inherits the omission.

## I. Impact on VA-3 — **none of its gates fail because of this**

VA-3's gates cover extraction, determination, promotion, SLA, provenance,
reporting and audit. **No gate asserts vendor risk score movement.**

- **Gate 12** is satisfied by T1-B (finding → vendor/document/CUEC/reviewer).
- **Gate 15** (Vendor Assurance reporting) asks whether the determination and
  promotion are visible on the document surface and in the exports — which they
  are.

**But VA-3 would very likely *discover* this**, because an operator who promotes
a gap and then opens the vendor will notice the finding is absent. **Recommend
adding it as an explicit observation step rather than letting it arrive as a
surprise mid-exercise** — that is a plan amendment, not a gate change, and it
does not weaken any evidence requirement.

## J. Impact on ADR-0010 — **none, and deliberately so**

This defect is **entirely inside the document spine**. Vendor, document, CUEC and
finding are all document-spine objects; `vendor_assessments` is a third thing
again, and neither is `vendor_engagements`.

**Fixing this does not answer, prejudge, or narrow the engagement/document
convergence question.** ADR-0010 remains OPEN and due 2026-08-28.

**Explicitly preserved:** no `engagement_id`, no `vendor_id`, and no other
relationship column is proposed on `findings`. The fix uses only relationships
that already exist and are already FK-enforced.

## K. Smallest correct fix

**One shared resolver with three arms, and every reader in §C uses it. No schema
change.**

1. Extend `resolveVendorIdForFinding` with a third arm resolving
   `vendor_assurance_cuecs.promoted_finding_id → document → vendor`, org-scoped
   on both sides of every join, reusing T1-B's proven shape.
2. Add the same arm to the **scoring query** — the second, independent exclusion
   in §C. Without this the score still does not move.
3. Point `vendors.ts` `GET /vendors/:id/findings` at the same relationship so the
   finding appears on its vendor.
4. **Correct the stale header comment in `vendors.ts:7`**, which is the probable
   origin of the divergence. Leaving it is how this recurs.
5. **Do not change what the CUEC promotion writes.** Rewriting `source_id` to a
   fabricated assessment id would invent an assessment that never happened, and
   backfilling existing rows would rewrite history. The promotion's semantics are
   defensible; the readers' assumption is what is wrong.

**Deferred, deliberately:** `findingContextResolver`, `findingEntitySearch` and
`evidence.ts` are the same root cause but are not on the Sept 15 advertised path.
Fixing them is correct and should be a follow-on, not scope creep here.

**A decision is owed alongside the fix** (not settled here): *is `source_id`
allowed to be polymorphic-by-convention at all?* The durable answer is probably
a partial unique index per source type, which is what protected the three types
that never drifted. That is an ADR, not a patch.

## L. Tests required

| Test | Proves |
|---|---|
| Resolver returns the vendor for a **CUEC-promoted** finding | The defect is fixed |
| Resolver still returns the vendor for an **assessment-sourced** finding | No regression on the existing arm |
| Resolver returns the vendor for a **cycle-review** finding | Third arm intact |
| Scoring query **includes** a CUEC-promoted finding | The *second* exclusion is fixed — a resolver-only fix passes the first three and still fails this |
| `GET /vendors/:id/findings` returns a CUEC-promoted finding | Customer-visible symptom fixed |
| **Cross-org: org B's CUEC cross-wired to org A's finding resolves to nothing** | Tenant isolation, mutation-checked as in T1-B |
| **Cross-org: org B's assessment id colliding with org A's source_id** | Closes the §F missing predicate |
| Mutation check: removing any org predicate turns a test red | The tests are not vacuous |

Isolation tests must run against real Postgres, following
`test/isolation/findingVendorProvenanceRls.test.ts`.

## M. Schema / migration work — **none required**

Every relationship the fix needs already exists and is already FK-enforced.

**One optional, non-blocking item:** `promoted_finding_id` has **no index**, so
the reverse lookup is a sequential scan of `vendor_assurance_cuecs`. Correctness
does not depend on it; throughput at scale might. A partial index on
`(organization_id, promoted_finding_id) WHERE promoted_finding_id IS NOT NULL`
would be the shape — **and it is schema work, so it falls under the one-schema-
package-in-flight rule and the 2026-08-29 cutoff.** Recommend deferring it and
shipping the correctness fix without a migration.

## N. Can it be built on a held branch during the freeze? — **Yes**

- **No migration**, so **R-1 §D's rollback rehearsal is not invalidated** (the
  pending set `20261021`–`20261036` is unchanged).
- **No merge**, so the promotion candidate `65cd3330` is untouched and K-1 stays
  closed.
- Touches `src/api/lib/vendorRiskScoreRecompute.ts` and `src/api/routes/vendors.ts`
  — **no overlap with T1-B** (`findingVendorProvenance.ts`, the finding page) or
  with any other held branch.
- Fits the "three code tracks maximum" bound in the Phase 2 roadmap; it would be
  the third alongside T1-B and admin audit.

## O. Priority for the Sept 15 Vendor Assurance scope — **P1, not P0**

**Not P0**, on the ruling's own words. The advertised claim is *"review a
vendor's SOC 2 report and turn what it obligates you to do into tracked
remediation work."* The finding **is** created and **is** tracked; the scope
ruling explicitly forbids claiming full third-party-lifecycle coverage, and
vendor risk scoring is not among the four advertised workflows.

**Firmly P1**, because the vendor-page symptom is the kind a design partner finds
in the first ten minutes: promote a gap, open the vendor, see nothing. That reads
as a broken product even though the data is correct.

**Sequencing:** it is **not** a #826 blocker and **must not delay the promotion**.
It belongs in Wave 2 alongside VA-3 remediation, and it is a strong candidate for
the third parallel track during the freeze.
