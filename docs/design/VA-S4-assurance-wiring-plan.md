# VA-S4 — wiring `S4.assurance`: implementation plan

**Status:** PLAN ONLY. Not authorized for implementation, and deliberately NOT
scheduled inside VA-Q2 P4 — P4's acceptance criteria do not require it.
**Prerequisite reading:** `docs/design/VA-EVIDENCE-architecture-reconciliation.md`.

## 1. What is being wired, and what is not

`S4.assurance` already exists in `scopeResolver.ts`. It reduces a requirement's
**depth** from `full` to `confirm` — it never removes the requirement:

> *"Reduces DEPTH, never removes the requirement: an independent report is
> evidence, not a substitute for asking."*

It consumes exactly one input, `assuranceCoveredRequirementIds`, and the
production call site does not pass it. **This plan is about computing that
list.** It is not about changing S4's semantics.

### Hard boundaries (from the owner ruling, restated as build constraints)

S4 **may** reduce question depth. S4 **may not**:

| Must not | Enforced by |
|---|---|
| Remove applicability | S4 sets `depth`, never deletes from `chosen`. Test: an S4-covered requirement is still present in `items` |
| Remove a mandatory SecureLogic floor | `FLOOR_RULE_IDS` (#924) governs composition; S4 runs before composition and changes only depth. Test: a floor item covered by assurance is still in `items` and still counted in `composition.mandatory` |
| Authoritatively change residual risk | S4 has no write path to scoring. Test: no scoring module imports the coverage computation |
| Suppress contradictory evidence or findings | Contradiction is a **disqualifier** in the predicate below, never a silent skip |
| Treat raw AI extraction as approved evidence | The predicate starts from human acceptance, never from extraction output |

## 2. The eligibility question — to be VALIDATED, not assumed

**Do not assume that "non-qualified auditor opinion + report period still valid"
is sufficient to declare a mapped requirement assurance-covered.** It is not,
and the plan's first task is to prove what is.

Each criterion below is a *candidate* predicate clause with the specific
question it must answer before it is coded.

| # | Criterion | Source of truth | Question to validate first |
|---|---|---|---|
| 1 | **Human acceptance** | `vendor_assurance_review_decisions.decision = 'accept'` (or `'edit'` with `reviewed_value`); `vendor_assurance_documents.processing_status = 'finalized'` | Is field-level acceptance enough, or must the DOCUMENT be finalized? Accepting `report_period_end` while rejecting `auditor_opinion` must not yield coverage |
| 2 | **Report period / validity** | `report_period_start` / `report_period_end`, `report_issued_date` | What is "in validity"? Period end within N months of *today*, or of the engagement date? A Type I is a point in time, a Type II a window — they cannot share one rule |
| 3 | **Auditor opinion** | `auditor_opinion` | What exact values count as unqualified? This is extracted free text. **A string match on extracted text must not be the gate on its own** |
| 4 | **Accepted CUEC/control mapping** | `vendor_assurance_cuec_control_mappings.mapping_status`, `mapping_source` | Does `suggested`+`auto` ever count? Proposed answer: **no** — `auto` is matcher output, i.e. AI. Only accepted mappings |
| 5 | **Requirement mapping** | `control_mappings` (control ↔ requirement) | One control may map to many requirements. Does covering a control cover every requirement it maps to? Almost certainly **no** — see partial coverage (#11) |
| 6 | **Evidence relevance** | CUEC text ↔ control ↔ requirement chain | The chain can be long. At what point is relevance asserted by a human rather than inherited transitively? |
| 7 | **Tenant / engagement ownership** | `organization_id` on every table in the chain | Non-negotiable. The join must carry `organization_id` at each hop, and the vendor must be THIS engagement's vendor — a SOC 2 for vendor B cannot cover vendor A |
| 8 | **Does the evidence actually support the requirement** | `evidence_analysis.verdict` (advisory), human review | `supports` is a model verdict. Can it contribute at all, or only as reviewer triage? Proposed: **triage only** |
| 9 | **Contradicting exceptions/findings** | `evidence_analysis.verdict = 'contradicts'`; open `findings` on the engagement/control; SOC 2 exceptions in extraction | A report with a relevant exception must NOT reduce depth for the requirement the exception touches. Needs a defined precedence: contradiction beats coverage |
| 10 | **Provenance** | `evidence`, extraction spans, review decisions | Every coverage decision must be explainable: which document, which page span, whose acceptance, when |
| 11 | **Partial vs full coverage** | — | S4 has ONE outcome (`confirm`). If a report covers a requirement partially, is that `confirm` or unchanged? Proposed: **partial coverage does not reduce depth**; only full coverage does. Introducing a partial depth is a separate design |
| 12 | **Reassessment behaviour** | `parent_engagement_id` (VA-Q2 P4) | Does coverage carry to a child engagement? Only if still in validity **at the child's resolve time**, recomputed — never copied |

### Proposed predicate (to be confirmed, not built yet)

A requirement is assurance-covered for engagement E iff **all** hold:

1. a finalized VA document belongs to E's org **and** E's vendor;
2. its `report_period_end` is in validity at E's resolve time, by a rule that
   distinguishes Type I from Type II;
3. its `auditor_opinion` was **human-accepted** and is unqualified by a curated
   vocabulary, not a free-text match;
4. an **accepted** (not `suggested`, not `auto`-only) CUEC→control mapping exists;
5. a `control_mappings` row ties that control to the requirement;
6. **no** contradicting signal: no `contradicts` analysis and no open finding
   against that control/requirement for this vendor;
7. coverage is **full**, not partial.

Any clause failing → not covered → the question is asked at full depth. **Fail
closed, always**: the failure mode of a wrong "covered" is an unasked question,
which is invisible; the failure mode of a wrong "not covered" is a redundant
question, which is merely annoying.

## 3. Validation before coding (the first task, not a footnote)

1. **Measure the corpus.** On staging: how many finalized VA documents, accepted
   review decisions, accepted CUEC mappings and `control_mappings` rows exist?
   If the answer is near zero, S4 would ship dead a second time — that alone
   changes the sequencing decision.
2. **Answer #2, #3, #5, #9, #11 with the owner.** Validity window, opinion
   vocabulary, control→requirement fan-out, contradiction precedence, and
   partial coverage are product rulings, not implementation details.
3. **Dry-run the predicate** as a read-only script over staging, printing which
   requirements *would* be covered for each engagement and why. Review that
   list before a line of resolver-facing code is written.

## 4. Implementation shape (after validation)

- **No new tables.** The join is `vendor_assurance_documents` → `extractions`
  (+ `review_decisions` / `field_overrides` for authoritative values) →
  `vendor_assurance_cuecs` → `cuec_control_mappings` (accepted) → `controls` →
  `control_mappings` → `requirements`.
- **One module**, `src/api/lib/vendorRisk/assuranceCoverage.ts`, exporting
  `loadAssuranceCoveredRequirementIds(db, orgId, engagementId)` — pure SQL plus
  the curated opinion vocabulary; no LLM call.
- **One call-site change** in `vendorEngagements.ts`: pass the result as
  `assuranceCoveredRequirementIds`.
- **Provenance surfaced**: S4's reason rationale should name the document and
  the accepted mapping, not just say "covered by assurance".
- Likely **one migration** only if an evidence validity column is needed for
  non-SOC evidence; the SOC path needs none.

## 5. Testing

- Predicate unit tests, one per disqualifier: unfinalized document, expired
  period, qualified opinion, `suggested`-only mapping, missing
  `control_mappings` row, contradicting finding, partial coverage — each proving
  **not covered**.
- Isolation test: a SOC 2 belonging to org B never covers an org A requirement,
  and a document for vendor B never covers vendor A's engagement.
- Resolver tests: an S4-covered requirement is still present with
  `depth = 'confirm'`; a covered FLOOR requirement is still in `items` and still
  counted in `composition.mandatory` (the #924 interaction).
- Equivalence: with no assurance data, output is byte-identical to today.

## 6. Sequencing

**After VA-Q2 P4, not inside it.** P4's acceptance criteria — S2-from-facts
triggers, reassessment E2E, AI-authority E2E, equivalence script — do not
require S4, and inserting it would put a new deterministic input into the
resolver in the middle of the package that proves the resolver's current inputs.

It also interacts with #925: if evidence can satisfy a domain, "activated domain
with zero questions" becomes a legitimate state rather than starvation — so the
starvation ruling is better made after this plan is validated, not before.

## Related

`docs/design/VA-EVIDENCE-architecture-reconciliation.md`, #925, #926,
`src/api/lib/vendorRisk/scopeResolver.ts` (S4), ADR-0012 (ratified, unbuilt).
