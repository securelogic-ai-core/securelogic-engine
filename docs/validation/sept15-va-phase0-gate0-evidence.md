# Vendor Assurance — Phase 0 (Truth Repair & Preconditions) · Gate 0 Evidence

Program: September 15 design-partner launch, Stream A
Branch: `feat/sept15-va-phase0-truth-repair`
Baseline: `develop` @ `58285e67`
Date: 2026-08-12

---

## Gate 0 exit criteria

| # | Criterion | Result |
|---|---|---|
| 0.1 | D1 — approved SOC report visible on its vendor's detail page | **PASS** |
| 0.2 | D2 — production R2 configuration confirmed | **BLOCKED — operator-owned** |
| 0.3 | `asTenant` wrap coverage across the vendor route surface | **PASS** |
| 0.4 | Legacy `assessments` — prove zero runtime dependencies | **FAILED — see §4** |
| 0.5 | D5/D6 doc-sync | **PARTIAL — D6 done** |

---

## 1. D1 — the vendor page's Assurance card was dead code

**Defect.** `app/src/app/vendors/[id]/page.tsx` listed assurance documents with
`status: "finalized"`. Migration `20260612_vendor_assurance_document_presentation.sql`
replaced that state with `approved` and records in its own header that "no new code
path writes 'finalized'". `DocumentActions.tsx` only calls approve /
request-manual-review / reject.

Effect: after a reviewer approved a SOC report the card rendered
*"No assurance documents reviewed yet."* — permanently. The existing render test
asserted the broken filter, so the bug was locked in by its own coverage.

**Second defect, same card.** The value projection read `current_decisions` — the
per-field accept/edit/reject store that the *same* migration tore out — and ignored
`vendor_assurance_field_overrides`, the live mechanism the engine already returns in
the extraction payload. Every reviewer correction was invisible; the pre-override
extraction was displayed as though it were the accepted value.

**Fix.**
- Added the canonical predicate to the Metric Contract
  (`src/api/lib/metricDefinitions.ts`): `ASSURANCE_REVIEWED_STATUSES`,
  `isAssuranceReviewed()`, `sqlAssuranceReviewed()`. "A human accepted this
  extraction" is **two** column values — `approved` (current) and `finalized`
  (legacy rows, real customer review decisions). Naming either alone is a defect in
  one direction or the other.
- Added a `reviewed` **pseudo-status** to `GET /api/vendor-assurance/documents`.
  It expands to `processing_status IN ('approved','finalized')` as a compile-time
  constant, never a bound parameter.
- Value precedence is now: field override → legacy decision → raw extraction. An
  overridden value is labelled `corrected` rather than presented as the model's own.
- Cosmetics that were misleading: raw field names (`report_type`,
  `auditor_opinion`) now use the existing `fieldLabel()` map; the debug line
  `Vendor: 1a2b3c…` removed; CTA reads "View reviewed report".

**Evidence.** Engine `vendorAssuranceDocuments.test.ts` 103 → 106.
App `vendorDetail.render.test.tsx` 44 → 47, including:
- a regression guard asserting the status filter can never revert to a single
  terminal state;
- an end-to-end case proving an `approved` document renders (the exact scenario
  that was broken);
- a case proving a field override beats both the legacy decision and the extraction.

---

## 2. D2 — production R2 configuration

`render.yaml` declares `SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true"` on the
production engine block (line 237) and **no `R2_*` variables** on that block.
`blobStorageConfig.ts` treats absent R2 as a legal state that only fails at call
time, so a production upload would reach `putVendorAssurancePdf`, throw, mark the
row `extraction_failed: pdf_unparseable`, and return `500 blob_put_failed` — a
misleading error code for a configuration fault.

**Not resolvable from the repository.** Dashboard values are not provable from
committed IaC, and the Blueprint is paused. This remains an **operator check** and
is carried forward as a launch blocker, not a code change.

---

## 3. Wrap coverage — `asTenant` / `withTenant`

`vendorAssuranceDocuments.ts` shipped **18 routes with zero tenant scoping**. The
standing A04-G1 rule is *policy ⟹ routes wrapped*: an RLS policy on a table whose
routes are unscoped is a latent zero-rows failure at the `app_request` flip —
invisible in review and invisible in staging until that flip happens. RLS on the
seven `vendor_assurance_*` tables (Phase 2 / Stop Gate A) could not land until this
was closed.

`vendorReviews.ts` was already fully wrapped (4 routes, 4 `asTenant`) and needed no
change.

**Two scoping mechanisms, by handler shape:**

| Mechanism | Routes | Why |
|---|---|---|
| `asTenant(handler)` at the router | 12 | Handlers that only ever end in `status()+json()` |
| explicit `withTenant()` inside | 6 | Stream / redirect / long external I/O / already scoped |

The six explicit cases and their justifications:

- `uploadVendorAssuranceDocument` — streams bytes to R2 mid-handler; scopes bracket
  the put so no connection is held across external I/O.
- `getVendorAssurancePdfRedirect` — ends in a 302; `asTenant`'s buffering proxy
  throws on anything but `status()+json()`.
- `getVendorAssuranceCuecs` — already opens its own scope; an outer wrap would
  double-connect (`withTenant` takes a fresh pool connection per call).
- `rematchVendorAssuranceCuecs` — calls the LLM CUEC matcher; commit-then-compute,
  never a transaction held across the model round trip.
- `exportVendorAssuranceDocumentXlsx` / `…Pdf` — set `Content-Type` /
  `Content-Disposition` and send a rendered buffer.

**Structural guard.** `src/api/__tests__/vendorAssuranceTenantWrapCoverage.test.ts`
parses the router block and fails the build if any route is neither `asTenant`-wrapped
nor on a *justified* explicit allowlist. It additionally asserts that every
allowlisted handler really does call `withTenant` (following one level of
delegation), that no handler is both wrapped and explicit (double-connect), that
every allowlist entry carries a stated reason, and that no handler reads
`organization_id` from a request body.

The guard was **negative-tested**: removing one `asTenant(` wrap makes it fail with
`GET /vendor-assurance/documents -> listVendorAssuranceDocuments`, then passes again
when restored. It is not vacuous.

---

## 4. Legacy `assessments` — the proof FAILED

Ratified Decision 3 requires: *"Freeze/deprecate first and prove there are no
runtime dependencies/writers."*

**The proof came back negative. There are live dependencies.**

```
src/api/routes/assess.ts:159        INSERT INTO assessments (      ← live WRITER
src/api/routes/assessments.ts:101   FROM assessments a             ← live READER
src/api/routes/assessments.ts:177   FROM assessments a             ← live READER
```

All three are mounted (`routes/index.ts:465–466`), authenticated, and
`requireEntitlement("premium")`-gated. `POST /api/assess` runs `RunnerEngine` and
persists an assessment row.

**This contradicts finding D7 of the architecture audit**, which stated the table was
"referenced by no vendor route" and "dead schema". That finding was wrong: the
originating grep was truncated by `head -20` and the live routes fell below the cut.
The audit conclusion is corrected here.

**Consequence.** The planned Phase 7 migration `20260935_legacy_assessments_freeze.sql`
would add a `BEFORE INSERT` trigger raising on `assessments` — which would **break
`POST /api/assess`** for any direct API caller. It has therefore **not been written**.

Mitigating context, for the decision:
- No app or website code calls `/api/assess` or `/api/assessments` — the surface is
  API-only, with no first-party consumer.
- `CANONICAL_DOMAIN_MODEL.md:87` records **EAR-AD-6: "zero per-type assessment tables
  ever again"**, with `ASSESSMENT_TYPE_SPECS` (`src/api/lib/assessmentSpec.ts`) as the
  single source of truth for all assessment lifecycles.

**Decision required before Phase 7** — see §6.

---

## 5. D6 — product knowledge stated a capability that does not exist

`src/api/productKnowledge/workflows/assess_vendor.yaml` told users:

> "Complete the questionnaire and save to update the vendor's **inherent and residual
> risk**."

The vendor assessment form is an assessment-type dropdown, a severity dropdown and two
free-text areas. Neither inherent nor residual risk exists for vendors today (they
arrive in Phase 1/Phase 5). This copy is served to users through the product-knowledge
and Ask surfaces.

Rewritten to describe what the form actually does, and to point at the framework
questionnaire as the separate path it really is. Registry regenerated
(`npm run generate:workflows`, 14 workflows).

The remaining "inherent and residual" strings in the generated registry belong to the
**risk register** workflow and are accurate — `risks` genuinely carries
`inherent_rating` / `residual_rating`.

**D5 (BUILD_SEQUENCE / CANONICAL_DOMAIN_MODEL drift) is not yet done** and is carried
into the Phase 1 doc-sync.

---

## 6. Open items leaving Gate 0

| Item | Type | Owner |
|---|---|---|
| D2 — production R2 configuration | Operator check | Operator |
| Legacy `assessments` freeze — live writer/readers found | **Product decision** | Operator |
| D5 — BUILD_SEQUENCE / CANONICAL_DOMAIN_MODEL drift | Doc-sync | Carried to Phase 1 |

### The decision needed on `assessments`

The ratified instruction anticipated this case by making the proof a precondition.
The proof failed, so the freeze does not proceed. Three options:

1. **Retire the API surface first.** Deprecate `POST /api/assess` +
   `GET /api/assessments*`, announce, then freeze the table in a later release.
   Cleanest, but it is a public API removal and out of the September 15 scope.
2. **Freeze the table, keep the routes.** Not possible — the writer is the route.
3. **Leave both in place; drop the freeze from the launch program.** Record the
   table as legacy-but-live, and keep Phase 7 limited to demoting the *vendor*
   workflow writers (`vendor_assessments` / `vendor_reviews`), which is the part
   that actually matters for one-authoritative-path.

**Recommendation: option 3 for September 15.** The launch goal is one authoritative
vendor workflow path; `assessments` is not on that path and is not reachable from any
first-party surface. Retiring a public API route is a separate decision with its own
notice period, and forcing it into this program adds risk for no launch benefit.

---

## Test evidence

```
engine   npx vitest run src/api/__tests__/
         301 files · 5613 passed · 3 skipped · 0 failed

app      npx vitest run src/app/vendors/[id]/__tests__/vendorDetail.render.test.tsx
         47 passed (was 44)

typecheck  npm run typecheck (engine)  → clean
           tsc --noEmit (app)          → clean
```

No production environment was touched. No migration was applied. No schema changed
in Phase 0.
