# ADR-0010 — Vendor Assurance and Vendor Engagements are two independent evidence spines

- **Status:** **OPEN — decision required.** Raised 2026-08-21 by the VA-3 staging
  operational exercise. No option is chosen here; this ADR states the question,
  the evidence, and the options, so the answer is deliberate rather than
  emergent.
- **Date raised:** 2026-08-21
- **Decision owner:** product owner / platform architect
- **Needed by:** before Sept 15, if Vendor Assurance is to be advertised as a
  complete workflow. It is **not** a promotion blocker.
- **Applies to:** `vendor_assurance_documents`, `vendor_assurance_cuecs`,
  `vendor_engagements`, `evidence`, `evidence_analysis`,
  `requirement_responses`, `vendorExtractionWorker`,
  `vendorEvidenceAnalysisWorker`, `findings.source_type`.
- **Related:** ADR-0004 (finding→risk promotion and unified approvals),
  ADR-0006 (platform scope boundaries).
- **Evidence:** `docs/validation/VA-3-RERUN-PLAN.md` §0.2 gate 12,
  `docs/validation/VA-3-STAGING-EXERCISE.md`.

---

## The question

**Are "review a vendor's SOC 2 report" and "run a vendor assessment engagement"
one workflow or two?**

The platform currently implements them as **two**, completely independently, and
nothing in the codebase records that as a decision. It reads as an accident of
build order rather than a position anyone took.

---

## Context — what is actually built

Verified by reading the schema and the routes, not inferred.

### Spine A — Vendor Engagements

The third-party risk lifecycle. `vendor_engagements` is a substantial table:
engagement type (`initial` / `periodic` / `triggered` / `targeted`), a
fifteen-state status machine from `draft` to `closed`, inherent-risk inputs
(data volume, recoverability, operational dependency, hosting model, AI
involvement and autonomy, fourth-party exposure), concentration snapshot,
inherent score and assessment tier, residual score, a formal `decision` with
mandatory rationale and decider, review cadence, and pinned methodology and
scope-rule versions.

Around it: `vendor_engagement_scope_items`, `vendor_engagement_invites`,
`vendor_engagement_comments`, `requirement_responses`, a vendor portal, the
`evidence` table (carrying `engagement_id` and `source_type='vendor_engagement'`
since `20260925`), `evidence_analysis` (`20260930`), and
`vendorEvidenceAnalysisWorker`.

Findings from this spine use `findings.source_type = 'vendor_engagement'`.

### Spine B — Vendor Assurance documents

Upload a SOC 2 → extract → review CUECs → determine → promote a gap to a
Finding. `vendor_assurance_documents`, `vendor_assurance_extractions`,
`vendor_assurance_cuecs`, `vendor_assurance_cuec_control_mappings`,
`vendor_assurance_review_decisions`, `vendor_assurance_field_overrides`,
`vendorAssuranceStorage.ts`, `vendorExtractionWorker`.

Findings from this spine use `findings.source_type = 'vendor_review'`.

### They do not know about each other

| Check | Result |
|---|---|
| `vendor_assurance_documents.engagement_id` | **does not exist** |
| Any FK from `vendor_engagements` to an assurance document | **none** |
| `20260919_vendor_engagements.sql` references assurance documents | **no** |
| `vendorAssuranceDocuments.ts` / `vendorAssurance*.ts` mention `engagement` | **no** |
| `vendorEngagements.ts` / `vendorEngagement*.ts` mention `vendor_assurance` | **no** |
| Shared storage helper | **no** — `evidenceStorage.ts` vs `vendorAssuranceStorage.ts` |
| Shared analysis worker | **no** — `vendorEvidenceAnalysisWorker` vs `vendorExtractionWorker` |
| Shared finding source type | **no** — `vendor_engagement` vs `vendor_review` |

Their only common ancestor is `vendors.id`.

### What that costs today, concretely

1. **A SOC 2 uploaded during an engagement is invisible to that engagement.**
   It cannot inform `analysis_coverage`, the residual score, or the decision
   rationale — the things the engagement exists to produce.
2. **A CUEC gap cannot influence the engagement decision.** The strongest
   evidence a SOC 2 yields — the customer's own unmet obligations — lands on a
   Finding with `source_type='vendor_review'` and never reaches the
   `approved / approved_with_conditions / rejected` call.
3. **Two answers to "what evidence do we hold for this vendor?"**, from two
   tables, with no reconciliation. A user reasonably expects one.
4. **The provenance chain has a hole.** VA-3 gate 12 asks that a promoted
   Finding link back to vendor, **engagement**, document, CUEC and reviewer. The
   engagement leg cannot pass, because the edge does not exist.
5. **`vendor_engagement` findings have never been produced.** The findings-list
   filter deliberately omits that source type, with the comment that the path
   "exists in code but has never produced a finding". So one spine is unproven
   end to end and the other is blocked (see the VA-3 exercise).

---

## Why this is a decision and not a bug

Adding `engagement_id` to `vendor_assurance_documents` would take ten minutes.
That is exactly why it should not be done reflexively — the column would
encode an answer to a question nobody has asked out loud:

- Is a SOC 2 review **always** part of an engagement? Then the column should be
  `NOT NULL`, and today's standalone document-review path is a defect.
- Is it **sometimes** part of one? Then it is nullable, and the product must say
  what a document with no engagement means, and how the two views reconcile.
- Is it **never** part of one — are they genuinely separate services? Then the
  gap is not the missing FK, it is that Vendor Assurance has no lifecycle of its
  own, and the engagement spine duplicates capability it should be reusing.

Each answer implies different work. Choosing by adding a column chooses the
middle option silently, and it is not obviously right.

---

## Options

### Option 1 — Nullable `engagement_id` on the document (small)

Documents may optionally attach to an engagement; standalone review remains
valid.

- **For:** smallest change; closes VA-3 gate 12's engagement leg; preserves the
  ad-hoc "just review this PDF" path, which is a real user need.
- **Against:** two evidence stores remain. "All evidence for this vendor" still
  requires a UNION and still has two shapes. Duplication is deferred, not
  resolved.
- **Size:** S — one migration, upload UI change, one join.

### Option 2 — Fold assurance documents into the `evidence` model (large)

`evidence` already carries `engagement_id` and a `source_type`. Assurance
documents become evidence of a particular kind; extraction and CUECs hang off
that.

- **For:** one evidence store, one storage path, one answer per vendor. The
  engagement decision can see everything.
- **Against:** a substantial migration of a live table with real staging data,
  a worker rewrite, and it presumes SOC 2 review belongs inside an engagement —
  which forces a home for the standalone path.
- **Size:** L. **Not Sept 15 work.**

### Option 3 — Keep them separate, deliberately, and say so (smallest)

Ratify two spines: *engagements* answer "should we do business with this
vendor", *assurance documents* answer "what does this vendor's attestation
obligate us to do". Delete gate 12's engagement leg from the VA-3 definition
of done as a category error.

- **For:** honest about what is built; zero engineering; unblocks VA-3's
  definition immediately.
- **Against:** leaves the user-visible incoherence in (3) and (1) above. Only
  defensible if the two really are different products, and the UI must then stop
  presenting them under one "Vendor Assurance" nav group.
- **Size:** XS — a decision and a documentation change.

### Option 4 — Link at the Finding, not at the document (small)

Leave the spines separate but give the promoted Finding a provenance block
naming vendor, document, CUEC and reviewer, and let an engagement *reference*
findings that exist for its vendor within its window.

- **For:** closes the user-visible half of gate 12 without a schema
  commitment; independently useful, since **no** Finding currently shows its
  vendor-assurance provenance.
- **Against:** does not make the SOC 2 inform the engagement decision.
- **Size:** S — UI plus one read model. **This is the only option that also
  fixes the separate, confirmed UI defect below.**

---

## Not in scope for this ADR, but blocked behind it

Independent of which option wins, the Finding detail page today shows only a
`source_type` label for a promoted CUEC gap — no vendor, document, CUEC text or
reviewer. Provenance is **one-directional**: `CuecDeterminationPanel` links
CUEC → Finding; nothing links Finding → CUEC.

That is a plain UI gap, not an architecture question, and it is what caps VA-3
at DEGRADED even after the extraction fix (PR #855) lands. It should be built
regardless — Option 4 is that work, scoped.

---

## Recommendation

**Option 4 now, Option 1 or 2 later, and never Option 3 without also changing
the navigation.**

Option 4 is the only choice that closes a *confirmed, user-visible* defect
inside the Sept 15 window, commits to no schema position, and is useful under
every eventual answer. The deeper question — whether the two spines converge —
should be answered on its own timeline and not forced by a launch date.

**Explicitly deferred:** whether a SOC 2 review must occur inside an engagement.
That is a product-model question about how third-party risk is practised, and it
should be answered with a design partner in the room rather than by the shape of
a table.

---

## Consequences of leaving this open

- VA-3 cannot reach PASS on its current definition. Its gate 12 engagement leg
  must be recorded as **N/A — pending ADR-0010**, not as a failure of the
  exercise.
- Vendor Assurance should not be advertised as covering the full third-party
  lifecycle, because the document path does not feed the engagement decision.
- Every further feature on either spine widens the gap and raises the cost of
  Option 2.

## Enforcement

Until this ADR is resolved:

- **Do not** add `engagement_id` to `vendor_assurance_documents` in passing. It
  decides the question.
- **Do not** add a second evidence-upload surface to either spine.
- Any PR that links the two spines must reference this ADR and state which
  option it implements.
