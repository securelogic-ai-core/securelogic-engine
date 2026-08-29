# VA-EVIDENCE — evidence architecture reconciliation

**Status:** reconciliation of VERIFIED current state, 2026-08-29.
**Purpose:** establish what evidence infrastructure SecureLogic already has, so
that VA-Q reuses it instead of building a second evidence subsystem.
**Method:** read from schema and code on `develop` @ `876bdcd8`. Nothing here is
inferred from a roadmap document; every row names the migration or module that
proves it.

> **The governing conclusion.** SecureLogic already has an evidence architecture:
> polymorphic evidence with engagement and requirement linkage, file storage, a
> human-confirmation boundary, advisory AI analysis, SOC 1/2 document extraction
> with report periods and auditor opinion, human review of every extracted
> field, CUEC→control mapping, control→requirement mapping, findings
> integration — **and a resolver rule (`S4.assurance`) whose entire purpose is
> to let approved evidence reduce questionnaire depth.**
>
> The gap is not architectural. `S4.assurance` is **never invoked in
> production**, because the one argument that feeds it is not passed at the call
> site. VA-Q must wire that seam, not replace it.

---

## 1. Capability reconciliation

### EXISTS AND REUSABLE

| Capability | Where it lives | Notes |
|---|---|---|
| Polymorphic evidence object | `evidence` (20260420) | `(source_type, source_id)` with a **closed 7-value allowlist**: `control_test`, `vendor_review`, `ai_review`, `obligation_review`, `dependency_review`, `risk_treatment`, `finding` (20260427) |
| Evidence → engagement linkage | `evidence.engagement_id` | Nullable FK, already present |
| Evidence → requirement linkage | `evidence.requirement_id` | Nullable FK, already present — **VA-Q does not need to invent this** |
| Evidence uploads | `evidence.storage_key` / `original_filename` / `mime_type` (20260909), `evidenceStorage.ts`, `evidenceFileValidation.ts` | Portal upload path in `vendorPortal.ts` |
| **Human confirmation boundary** | `evidence.reviewed_at`, `reviewed_by_user_id`, `review_note` | The authority line. `claudeEvidenceAnalyzer.ts`: "the effectiveness ladder moves only on the human confirmation (`evidence.reviewed_at`)" |
| Advisory AI evidence analysis | `evidence_analysis` (20260930) | Verdicts `supports` / `insufficient` / `contradicts` / `unreadable`, with `model_id`, `engagement_id`, `requirement_id`. Advisory by construction — nothing here feeds a score |
| SOC 1/2 document intelligence | `vendor_assurance_documents` → `vendor_assurance_extractions` → `vendor_assurance_extraction_spans` (20260610–12) | `document_type_hint` ∈ `soc1` / `soc2_type1` / `soc2_type2`; `processing_status` lifecycle to `finalized` |
| Report period and auditor opinion | extraction fields `report_period_start`, `report_period_end`, `report_issued_date`, `auditor_opinion` (`vendorAssuranceExportData.ts`) | The raw material for a validity window on assurance reports |
| Human review of extraction | `vendor_assurance_review_decisions` (`accept` / `edit` / `reject`) + `vendor_assurance_field_overrides` | Per-field human decisions; `currentValue()` resolves the authoritative value |
| CUEC → control mapping | `vendor_assurance_cuecs`, `vendor_assurance_cuec_control_mappings` (20260613) | `mapping_status` (suggested/accepted), `mapping_source` (`auto` / `manual`), `mapping_score` |
| Control → requirement mapping | `control_mappings` | Closes the join from a SOC 2 report to a questionnaire requirement |
| Control effectiveness | `control_assessments` | Status, severity, `performed_at` |
| Findings integration | `findings.source_type` includes `vendor_engagement`, `vendor_review`, `control_test` | An engagement can already produce findings |
| Applicability evidence (internal posture) | `applicability_evidence` (20260723) | Separate lineage — `assessment_id`, `captured_value`, `weight`. Not vendor assurance; noted so it is not confused for it |
| **`S4.assurance` resolver rule** | `scopeResolver.ts` | Reduces DEPTH to `confirm`, never removes a requirement: "an independent report is evidence, not a substitute for asking" |

### UNWIRED — exists, but never runs in production

| Capability | Evidence |
|---|---|
| **`S4.assurance`** | `resolveEngagementScope` takes `assuranceCoveredRequirementIds?: string[]`. The production call site (`vendorEngagements.ts`) does **not** pass it, so `covered` is always empty and S4 never fires. The only callers that pass it are `vendorScopeResolver.test.ts` and the golden fixtures. |

This is the single highest-value gap in the whole reconciliation: the rule, its
depth semantics, and its "APPROVED — not raw extraction output" doc contract are
all already written.

### MISSING

| Capability | Notes |
|---|---|
| Generic evidence validity / staleness | `evidence` has **no** `valid_until` / `expires_at` / period columns. SOC 2 reports carry a period via extraction fields; a policy PDF carries nothing, so "stale" cannot be expressed for general evidence |
| Explicit "evidence not required / not expected" semantics | Absence is currently indistinguishable from omission — see §3 |
| Evidence → question (as opposed to requirement) linkage | Evidence links to `requirement_id`; VA-Q1 questions hang off requirements via `question_versions`. Probably NOT needed — see NOT NEEDED |

### AUTHORIZED BUT UNBUILT

| Capability | Notes |
|---|---|
| **ADR-0012 evidence lifecycle** — origin + links, decision-basis snapshots, immutable history | Ratified 2026-08-22 with migrations **20261051–20261055 authorized**. The ledger jumps `20261049` → `20261059`: **none of them were ever created.** Any VA-Q design that assumes evidence history or decision-basis snapshots exist is assuming something unbuilt |

### NOT NEEDED

| Capability | Why |
|---|---|
| A second evidence table for VA-Q | `evidence` already carries `engagement_id` + `requirement_id` |
| A VA-Q-specific document extractor | `vendor_assurance_documents` + extractions already do SOC 1/2 with spans and human review |
| A VA-Q-specific AI analysis verdict vocabulary | `evidence_analysis` already has `supports` / `insufficient` / `contradicts` / `unreadable` |
| Evidence → question linkage | Questions are versioned expressions of requirements; linking evidence at the requirement level is the stabler join and already exists |

---

## 2. The target assurance model against current capability

```
Vendor/Inherent Risk → Applicable Domains/Requirements → Existing Acceptable
Evidence → Remaining Assurance Gaps → Questions To Close Them → Conditional
Follow-ups → Evidence → Findings → Residual Risk → Human Decision →
Monitoring/Reassessment
```

| # | Requirement | Supported today? |
|---|---|---|
| A | Mandatory SecureLogic minimum floors | **YES** — `FLOOR_RULE_IDS` (#924), staging verified @ `876bdcd8` |
| B | Risk/domain-triggered requirements | **YES** — S2 fact triggers, S3 obligations, S5 domain activation |
| C | Recognition of acceptable existing evidence | **PARTIAL** — the objects exist; no rule consumes them (S4 unwired) |
| D | Evidence satisfying a requirement without asking again | **PARTIAL** — `S4.assurance` does exactly this, and never runs |
| E | Alternative evidence paths for vendors with no SOC 2 / ISO / pen test | **NO** — nothing distinguishes "not expected at this tier" from "missing" |
| F | More questions when evidence is absent / stale / contradictory / insufficient | **PARTIAL** — `evidence_analysis` produces `insufficient` / `contradicts` advisorily; no rule reads them; staleness unrepresentable for generic evidence |
| G | Conditional follow-ups from answers | **DESIGNED, NOT BUILT** — VA-Q3 (`questionnaire_snapshots` + follow-up append) |
| H | Expansion when answers reveal higher risk | **PARTIAL** — facts widen scope (VA-Q2 P1/P3, staging verified); vendor-sourced facts deliberately cannot narrow |
| I | Historical evidence reuse only while valid | **NO** — no validity window; `parent_engagement_id` reassessment is VA-Q2 P4 |
| J | Human review when assurance is insufficient | **YES** — `evidence.reviewed_at`, `vendor_assurance_review_decisions`, the effectiveness ladder |

**Conclusion on questionnaire length.** The owner principle — *questionnaire
length should be an output of the assurance need, not the primary assurance
control* — is reachable on this architecture without a second evidence system.
The ordered prerequisites are: wire S4 (C, D), add evidence validity (F, I), add
not-expected semantics (E). Nothing on that list needs a new evidence subsystem.

---

## 3. Evidence semantics — map first, invent last

Nine states the owner asked us to distinguish, mapped to what already exists.

| State | Existing semantics | Verdict |
|---|---|---|
| Evidence **not applicable** | Requirement is not in scope at all — `ScopeResolution.excluded[]` carries the requirement and a rationale | **EXISTS** — at the requirement level, not the evidence level, which is the right level |
| Evidence **not requested because risk does not justify it** | — | **MISSING.** The nearest thing is a requirement that never entered scope, which is a different statement. Needed for E |
| Evidence **unavailable but acceptable for the risk tier** | — | **MISSING.** This is the low-risk-vendor case: no SOC 2, and that is fine |
| Evidence **expected but unavailable** | — | **MISSING** as a positive state. Today it is silence |
| Evidence **supplied and sufficient** | `evidence` row + `reviewed_at` set; `evidence_analysis.verdict = 'supports'` (advisory) | **EXISTS** |
| Evidence **supplied but insufficient** | `evidence_analysis.verdict = 'insufficient'`; human `review_note` | **EXISTS** (advisory; no rule consumes it) |
| Evidence **stale** | `report_period_end` for SOC 1/2 only | **PARTIAL** — assurance reports only; unrepresentable for generic evidence |
| Evidence **contradictory** | `evidence_analysis.verdict = 'contradicts'` | **EXISTS** (advisory) |
| Evidence **independently verified** | Distinguishable by `source_type` + the SOC document chain (auditor opinion, report period, human-accepted extraction) | **EXISTS**, though implicitly — it is a property of provenance, not a flag |

**Genuinely missing: three states, all in the same family** — *not applicable at
this tier*, *not expected for this risk profile*, *expected but absent*. They are
one concept (**expectation**), not three, and they belong to the
requirement×tier relationship rather than to an evidence row: an evidence record
cannot describe evidence that does not exist.

**Recommendation: do NOT build an evidence state machine.** Add an
*expectation* to the scope item — what evidence this requirement expects at this
tier — and let the existing evidence + analysis vocabulary describe whatever
actually arrives. Staleness is one nullable validity column on `evidence`, not a
state machine.

---

## 4. AI authority — unchanged, and already enforced

AI **may**: extract from artifacts (`claudeSocExtractor`), classify candidate
evidence (`claudeEvidenceAnalyzer`), map candidates to controls
(`vendorAssuranceCuecMatcher`, `llmControlMatcher` — rows land as `suggested` /
`auto`), identify contradictions (`verdict = 'contradicts'`), and suggest
follow-ups.

AI **may not**, and today structurally cannot: declare a requirement satisfied
(the ladder moves only on `evidence.reviewed_at`), change deterministic
applicability (the resolver is pure and reads no model output), alter residual
risk, suppress a floor (`FLOOR_RULE_IDS` is a constant, not a model output), or
make the vendor decision.

`S4.assurance`'s own contract already carries this line: *"Approved — not raw
extraction output: an LLM-derived fact must not silently reduce questionnaire
depth."* Wiring S4 must preserve it, which is why the S4 plan's eligibility
predicate starts from human acceptance rather than from extraction output.

---

## 5. What this means for VA-Q

1. **Reuse `evidence`, `evidence_analysis` and the VA document chain.** Do not
   create a VA-Q evidence table, extractor, or verdict vocabulary.
2. **Wire `S4.assurance` rather than designing an evidence→question reducer.**
   The reducer exists. See `docs/design/VA-S4-assurance-wiring-plan.md`.
3. **Do not assume ADR-0012 exists.** History and decision-basis snapshots were
   authorized and never built.
4. **Add expectation, not states.** Three missing semantics collapse to one
   concept that belongs on the scope item.
5. **Nothing here changes VA-Q2 P4's scope.** P4 is correct as written without
   any of this.

## Related

- #922 / #924 — the security baseline as a protected assessment floor
- #925 — activated-domain starvation (ruling owed; option 2 depends on S4)
- #926 — applicability provenance lost by truncation
- #920 — SOC 2 / NIST CSF scope-tag re-curation
- ADR-0012 — evidence lifecycle (ratified, unbuilt)
- `docs/design/VA-S4-assurance-wiring-plan.md`
