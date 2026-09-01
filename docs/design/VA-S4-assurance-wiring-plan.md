# VA-S4 — wiring `S4.assurance`: implementation plan

**Status:** PLAN, PARTLY BUILT. Steps 1 and 4 are built and staging verified;
**step 4b is built as VA-S4-P2 (this package)**. Step 5 — the S4 wiring itself —
remains NOT authorized: `assuranceCoveredRequirementIds` still has zero
production callers.
**COVERAGE ROUTE NAMED 2026-08-30 — read §0 then §0a.** Rulings 5 and 6 replace
the retired CUEC route with tested controls x TSC scope, and settle that a
mapping yields CANDIDATE coverage only.
**COVERAGE ROUTE SUPERSEDED 2026-08-30 — read §0 first.** The CUEC spine is no
longer the canonical S4 coverage route; the semantics below survive, the routing
does not.
**Predicate validated read-only against staging 2026-08-29 — result: DEAD.**
**Re-validated 2026-08-30 after canonical publication + a proven end-to-end
chain — result: STILL DEAD. Gate fired, S4 NOT wired. See §2d.**
Four owner rulings incorporated 2026-08-29 (§2a). VA-Q2 P4 is complete and
staging verified; S4 remains deliberately outside it.
**Prerequisite reading:** `docs/design/VA-EVIDENCE-architecture-reconciliation.md`.

---

## 0. OWNER RULING 2026-08-30 — the CUEC spine is NOT the S4 coverage route

**This ruling supersedes the coverage ROUTE assumed everywhere below.** The
predicate in §2, its clause 4, and the §2d hop chain all route coverage through
CUEC→control mappings. **That route is retired as the canonical basis for
assurance coverage.**

Not to be used as the general basis for declaring a requirement sufficiently
assurance-covered and therefore eligible for depth reduction:

```
SOC report -> CUEC -> control -> requirement
```

**Why.** A CUEC is a customer/user-entity responsibility — a
shared-responsibility condition the report places on the *reader*. It marks the
boundary of what the auditor did **not** test at the service organisation.
Routing coverage through it inverts the inference: *"the vendor told us we must
do X ourselves, therefore we need not ask the vendor about X."* A CUEC mapping
is **not** equivalent to evidence that the service organisation's relevant
control was tested and operated effectively.

CUECs remain first-class and keep every use they already have — applicability,
customer responsibility, follow-up questions, findings, exceptions, and residual
assurance conclusions. `20261036`'s gap-determination model is unaffected. What
they may not do is establish assurance coverage.

**The canonical model to evolve toward:**

```
governed evidence
  -> tested control / control assertion
  -> test result / exception state
  -> control <-> requirement mapping
  -> requirement assurance coverage
```

with human/governance gates and a preserved historical decision basis.

**That arm is DESIGN-ONLY and must not be invented inside the current
predicate.** The canonical evidence → tested-control → requirement arm will be
recorded in a follow-up design document after the tested-controls inventory and
opinion-acceptance work are complete.

**What sections below remain valid.** Everything about *semantics* survives: the
hard boundaries in §1, Rulings 1–4 in §2a, the eligibility clauses in §2 other
than #4/#6's routing, §2c's "do not build an evidence state machine", and §5b.
What is retired is the CUEC-shaped path through them.

Forensic evidence for this ruling:
`docs/validation/VA-S4-dead-hop-forensics-2026-08-30.md`.

---

## 0a. OWNER RULINGS 2026-08-30 (second set) — the canonical route is NAMED, and candidate ≠ covered

§0 retired the CUEC route and left the replacement unnamed, which made every
remaining build item blocked on a decision. These two rulings unblock it.

### Ruling 5 — TESTED CONTROLS × TSC SCOPE is the canonical S4 coverage direction

The intended inference, in full:

```
approved assurance document
  -> applicable report / TSC scope
  -> tested vendor control
  -> test result / operating-effectiveness state
  -> exception / deviation state
  -> control <-> requirement mapping
  -> CANDIDATE requirement coverage
  -> governed sufficiency determination
  -> assurance-covered requirement
```

CUECs are **not part of the canonical requirement-coverage route** and are not
to be repurposed into one. They keep every legitimate use they already have:
customer / user-entity responsibilities, shared-responsibility analysis,
customer-side gaps, findings and follow-ups, and the whole `20261036` workflow.
Nothing there is to be removed or narrowed.

### Ruling 6 — a mapping establishes CANDIDATE coverage only

A tested control mapping to a requirement is a **candidate**, never a
conclusion. Specifically:

```
one tested control -> four mapped requirements
```

must **not** become four assurance-covered requirements. §6 of the forensics
record measured exactly this shape on live rows: fifteen StageA tenant controls
each resolve to more than one NIST CSF 1.1 requirement, two of them to four.

The sufficiency determination must establish that the tested control actually
supports the assurance objective the requirement represents. Many-to-many
mappings stay **visible** and are never collapsed into implicit full coverage.
Provenance must be preserved well enough to reconstruct: the tested control, its
test result, the relevant report scope, the mapped requirement, the mapping
used, and why coverage was judged sufficient or insufficient.

### The coverage vetoes

Before a candidate may become assurance-covered, the future predicate must
evaluate at minimum:

| Veto | Why it is not optional |
|---|---|
| report / TSC scope | a control outside the report's scope was never tested |
| report period / validity | assurance is a statement about a window, not forever |
| Type I vs Type II, where material | design vs operating effectiveness are different claims |
| tested-control result | a tested control that failed is not coverage |
| control exception / deviation | the specific matter the auditor carved out |
| carve-out / subservice implications | the work may have been done by someone else, untested |
| accepted auditor opinion | report-level, human-accepted — **built, step 4b** |
| contradictory evidence | other evidence saying the opposite |
| relevant open findings / exceptions | a live gap on the same control |
| mapping authority | who asserted the mapping, and may they |
| human / governed acceptance | the determination itself is a human act |
| historical decision basis | it must remain explainable after the facts move |

**An exception or a contradiction must not be erased by a clean report-level
opinion.** This is the single most important line in the ruling: the opinion is
one veto among twelve, and passing it proves only that this one veto did not
fire.

### What this means for step 4b, built as S4-P2

Acceptance of the report-level opinion MUST NOT itself:

- establish requirement coverage
- reduce questionnaire depth
- change residual risk
- override a control exception
- override contradictory evidence

The implementation enforces this by construction: the acceptance handler
computes no coverage, touches no scope, schedules no vendor-score recompute and
creates no finding, and the row it writes carries
`establishes_requirement_coverage: false` as recorded data rather than as a
comment. A test asserts the absence of every such write, using `unmodified` —
the most permissive value in the vocabulary — because that is where a leak would
appear first.

---

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

## 2a. OWNER RULINGS, 2026-08-29 — the eligibility semantics, settled

These four rulings replace the corresponding open questions in §2. Where a
ruling and the §2 table disagree, the ruling governs.

### Ruling 1 — SecureLogic owns the canonical crosswalk

The control ↔ requirement crosswalk is **governed, versioned SecureLogic
reference content**, not per-customer accident. Initial framework priority:

1. NIST CSF · 2. SOC 2 · 3. GDPR · 4. CCPA/CPRA · 5. NIST AI RMF

It must carry **provenance and version identity**. **AI may PROPOSE candidate
mappings; it may not PUBLISH authoritative canonical mappings** without the
governed approval path — the same boundary `vendor_assurance_cuec_control_mappings`
already draws with `mapping_status` (`suggested` → accepted) and `mapping_source`
(`auto` | `manual`).

*Current state against this ruling.* `control_mappings` is
`(id, control_id, requirement_id, created_at)`. **No `organization_id`, no
provenance, no version, no source, no approval state**, and `frameworks.ts`
hard-`DELETE`s rows when a framework is deleted. It cannot satisfy the ruling as
it stands; it needs augmenting, not replacing.

### Ruling 2 — customer mappings augment, never narrow

Customers may **strengthen** requirements, mappings, evidence expectations,
assessment depth and regulatory applicability. They may **not** silently narrow
or overwrite the SecureLogic canonical baseline.

A customer wishing to exclude a SecureLogic-applicable requirement must use an
explicit **governed exception / risk-acceptance** mechanism — not the removal of
a canonical mapping. This is the same principle VA-Q2 already enforces for
vendor-sourced facts ("a vendor answer widens, never narrows"), applied one
layer up, and it means the canonical baseline and the customer layer must remain
**separately identifiable at read time** rather than merged on write.

### Ruling 3 — evidence validity is type- and policy-driven

**No universal TTL, and validity is never based on `uploaded_at` alone.**
Validity must respect what the artifact actually asserts:

| Evidence type | What determines validity |
|---|---|
| SOC / independent assurance report | coverage period, plus bridge-letter considerations |
| Penetration test | test date / testing period and age |
| Certification (ISO etc.) | certificate validity term |
| Policy | approval + review cadence |
| Technical / configuration evidence | observation age |
| Vendor attestation | assessment / reassessment cycle |
| Contractual evidence | effective term |

SecureLogic provides **default guardrails by evidence type**; customer policy may
tighten or adjust within governed bounds.

**This package does NOT choose production default durations.** They are proposed
separately for owner ratification — picking numbers here would make an unratified
policy look like an implementation detail.

*Reuse before invention.* The model **already does exactly this shape** and has
no universal expiry anywhere: `controls.testing_frequency + last_tested_at +
next_test_due`, `pen_test_engagements.next_test_due`, `policies.review_frequency
+ last_reviewed_at + next_review_at`, `risks.next_review_due`,
`retention_policies.effective_from`. The idiom is
`<frequency> + <last event> → <next due>`, per object class. Validity policy
should follow it rather than introduce a competing concept; only
`evidence.valid_from` / `valid_until` (what the artifact ASSERTS, snapshotted at
promotion — ADR-0012 §3) is new persistence.

### Ruling 4 — a qualified opinion is not automatically unusable

A qualified independent-assurance opinion **may** contribute coverage for a
mapped control — but only when the qualification or exception is **demonstrably
unrelated** to that control and the remaining evidence is sufficient.

**If that separation cannot be established, FAIL CLOSED**: the evidence does not
suppress the questionnaire requirement.

**AI alone may not determine that an exception is unrelated.** That is a
governed human judgement, and the same boundary that keeps `ai_extraction` facts
`proposed` until a human accepts applies here.

*Why this ruling has teeth.* All five staging extractions read:

> `"Unqualified opinion, except for the specific deviations and exception described in Section IV"`

A `LIKE '%Unqualified%'` test returns **TRUE** on that. It is a qualified
opinion, and under this ruling it can only contribute coverage for controls the
Section IV exceptions demonstrably do not touch.

> **CORRECTED 2026-08-30 (S4-P1).** This paragraph previously closed: *"a
> determination nothing in the current model can make, because the structured
> `exceptions` array is **empty in all five extractions** while the narrative
> cites them."* **That is false against live staging data**, and the correction
> matters because it changes what is actually blocking Ruling 4.
>
> `exceptions` is populated with **2 entries in all 5 extractions**, each
> carrying a page-3 source span:
>
> - *"Exception noted: for 2 of 30 sampled days, failed backup jobs were not
>   investigated within the organization's documented 24-hour SLA…"*
> - *"Deviation noted: the Q3 privileged access review was completed 19 days
>   after the documented due date…"*
>
> Every material field except `report_issued_date` (null on 5/5) is populated at
> confidence 0.99: `report_type` `SOC 2 Type II`, period `2025-01-01` →
> `2025-12-31`, `trust_services_criteria` `[Security, Availability,
> Confidentiality]`, **`subservice_method` `Carve-out`**, `cuecs` 3, `controls` 5.
>
> So the exception data needed to ask "is this exception unrelated to the mapped
> control?" **exists in structured form.** Ruling 4's blocker is not missing
> data — it is that **nothing attributes an exception to a control**. That is a
> different and considerably smaller problem than the one recorded here, and it
> is exactly what the tested-controls arm exists to solve.
>
> The corpus also contains its own counterexample: the second deviation — a late
> privileged access review — lands squarely on `Quarterly access reviews`, one of
> the three controls that carries an *accepted* CUEC mapping. A clean
> report-level opinion sitting on top of a control-level exception is not a
> hypothetical here; it is the only assurance report the estate has.
>
> Evidence: `docs/validation/VA-S4-dead-hop-forensics-2026-08-30.md` §4.

---

## 2b. Reconciliation findings — why S4 is DEAD, exactly

Measured read-only against staging 2026-08-29 (`job-da9hs7ijnfac73dub8gg` and
follow-ups). No staging data was modified.

### The chain, hop by hop

```
applicable requirement → canonical control mapping → CUEC-reachable control
  → evidence → evidence validity → assurance eligibility → assurance gap
  → questionnaire composition
```

It dies at hop 2, in **two independent ways**:

1. **Cross-tenant.** The 5 CUEC-reachable controls belong to org `fe2ede61`
   (Staging Inc). All 3 `control_mappings` rows belong to org `295b989a`
   (Walkthrough) and map manual controls to NIST CSF requirements. A correctly
   org-scoped predicate could never join them — and should never.
2. **Population.** `cuec_controls_have_any_mapping = 0`. Not one CUEC-reachable
   control has ANY mapping of any kind. All 14 controls are manual
   (`template_source` NULL on every one) and `synthetic_requirements = 0`, so
   the industry templates that would create control→requirement links have never
   been loaded on this environment.

So the chain reads `applicable requirement → ∅ → CUEC → evidence`.

### Corpus measurements

| Measure | Value |
|---|---|
| Requirements (all orgs) | 197 |
| VA documents | 57 — `extraction_failed` 52, `extracted` 3, `approved` 2 |
| Documents `finalized` | **0** |
| Extractions | 5 |
| **Human review decisions** | **0** |
| Field overrides | 0 |
| CUEC→control mappings | `accepted/auto` 3, `suggested/auto` 7 |
| `control_mappings` | 3 rows / 3 controls / 3 requirements |
| **CUEC-reachable controls WITH any mapping** | **0** |
| Evidence rows | 17 — 12 with `sha256`, 2 with `collected_at`, **1** with a requirement link |
| `evidence_analysis` | 2 rows, both `unreadable` |

### Four independent predicate failures

Any one of them is fatal on its own:

1. the mapping hop is empty (above);
2. **nobody has accepted anything** — `review_decisions` and `field_overrides`
   are empty corpus-wide, so the "approved, not raw extraction output" clause has
   zero satisfying rows;
3. **§2 clause 1 was wrong** — it gates on `processing_status='finalized'`, and
   the real vocabulary is `pending | extracting | extracted | extraction_failed |
   finalized | approved | manual_review_requested | rejected`. **Zero** documents
   are `finalized`; the terminal states in use are `approved` and `extracted`;
4. the opinion trap of Ruling 4.

### Are the rulings sufficient to make S4 viable?

**No — one genuine architectural dependency remains beyond them.** Rulings 1–4
settle the *semantics*. They do not create the *canonical crosswalk content*,
and without it hop 2 stays empty however correct the predicate is. That content
is the blocking dependency, and it is a curation/ownership question, not an
engineering one.

Everything else the chain needs already exists as canonical objects: `evidence`
(with `sha256`, `engagement_id`, `requirement_id`), the SOC 1/2 document chain,
CUEC→control mappings, `controls`, `requirements`, `findings`, and — since
2026-08-29 — `engagement_applicability` (#926) for the applicability half.

**There is no second control model and none is needed.** CUEC mappings and
`control_mappings` already reference the same `controls` table by foreign key.
The gap is population plus governance metadata on one existing table.

---

## 2c. The missing assurance state — "evidence not expected"

Six states must eventually be distinguishable. Mapped against canonical
semantics **before** proposing anything new:

| State | Canonical representation today | Verdict |
|---|---|---|
| Evidence **supplied and acceptable** | `evidence` row + `reviewed_at`; `evidence_analysis.verdict='supports'` (advisory) | **EXISTS** |
| Evidence **supplied but insufficient** | `evidence_analysis.verdict='insufficient'` + reviewer note | **EXISTS** (advisory; no rule consumes it) |
| Evidence **contradictory** | `evidence_analysis.verdict='contradicts'` | **EXISTS** (advisory) |
| Evidence **stale** | SOC coverage period via extraction fields only | **PARTIAL** — assurance reports only; unrepresentable for generic evidence until `evidence.valid_until` exists |
| Evidence **expected but unavailable** | — | **MISSING** as a positive state; today it is silence |
| Evidence **not expected for this risk profile** | — | **MISSING**; today indistinguishable from omission |

**Recommendation: do NOT build an evidence state machine.** Four of the six
already exist or are one column away, and the two genuinely missing ones are the
same concept — **EXPECTATION** — which is a property of
`(requirement × tier × evidence_type)`, not of an evidence row. An evidence
record cannot describe evidence that does not exist.

Expectation belongs in a **subsequent assurance-policy increment**, not in S4.
S4 answers "is this requirement covered?"; expectation answers "was cover even
required here?" — and conflating them would put a policy question inside a
predicate. S4 can ship without it and degrade honestly to "covered / not
covered".

---

## 2d. Post-publication re-validation, 2026-08-30 — the three proven prerequisites

The canonical crosswalk was **published on staging** on 2026-08-30 and the Step 1
chain was **proven end to end**. Full record:
`docs/validation/VA-S4-canonical-control-publication-2026-08-30.md`.

**The read-only predicate of §3 was re-run against that state. It is still
DEAD.** The §7 gate therefore holds and S4 remains unwired. What changed is that
the cause is now measured rather than inferred, and it decomposes into exactly
three prerequisites — one missing MECHANISM, one missing CONTENT, one missing
STAGING STATE. None of them is the crosswalk.

### The structural break, hop-isolated

The predicate dies **before any eligibility clause is applied**: the bare
structural join is already empty.

| Hop | Rows |
|---|---|
| documents → CUECs | 9 |
| CUECs → CUEC→control mappings | 10 |
| mappings → controls (same org) | 10 |
| **controls → `control_mappings`** | **0** |

The terminal break is the **control → requirement** hop — precisely the
deficiency Ruling 1 named in `control_mappings` ("no `organization_id`, no
provenance, no version, no source, no approval state").

**Substituting the governed canonical crosswalk for that hop still returns
zero**, and this was measured, not assumed. Two independent reasons, each
sufficient:

1. all 5 CUEC-mapped controls belong to `Staging Inc` (`fe2ede61`) and are
   **hand-created**, so they carry no `control_canonical_identities` row — and
   Ruling 1 forbids manufacturing one;
2. that org's only activated framework is **NIST SP 800-53 Rev 5**, which the
   published corpus does not cover.

So publishing the crosswalk was necessary and is not sufficient. Re-pointing the
predicate at it is also necessary and still not sufficient.

### Prerequisite 1 — assurance-eligible evidence (missing STAGING STATE **and, it turns out, a missing MECHANISM**)

Staging corpus at re-validation: **57 VA documents, 0 finalized, 0 accepted
CUECs, 0 human-accepted opinions** (2 documents `approved`, both naming a
human approver).

**Reclassified 2026-08-30.** This prerequisite was filed as missing staging
STATE — something an operator could go and create. Attempting it proved
otherwise: clause 2 has **no writer at all**, so part of this prerequisite is a
BUILD gap. See the blocker below before planning any population work.

**S4 cannot be proven on non-final, non-accepted evidence.** A predicate that
reduces question depth on unreviewed extraction output is exactly the
fail-open the hard boundaries forbid.

**Minimum governed state for evidence to contribute assurance** — every clause
required, no substitutions:

| # | Required | Why it cannot be relaxed |
|---|---|---|
| 1 | The document has reached a **terminal, human-owned state** — **RULED 2026-08-30: that state is `approved`**, and a `finalized` state must NOT be introduced to satisfy the old predicate | Raw extraction is a model output. The real vocabulary is `pending / extracting / extracted / extraction_failed / finalized / approved / manual_review_requested / rejected`; **zero documents ever reach `finalized`**, which is legacy, and the terminal state the product actually produces is `approved`. Verified: `approved` is set only by `POST /vendor-assurance/documents/:id/approve`, only from `extracted`, and never by a worker — the extraction path writes `extracting` / `extracted` / `extraction_failed` and nothing else. **But see finding A: the status alone is not sufficient** |
| 2 | The **auditor opinion is human-accepted** — `assurance_opinion_accepted_by_user_id` present (20261066) | Ruling 4. The CHECK already makes an opinion without an acceptor impossible; the predicate must actually read the acceptance, not the extracted string. **BLOCKED — nothing can write this field. See the blocker below** |
| 3 | The opinion resolves through `opinionCoverageGate` to a **covering** verdict | `qualified` returns `conditional` and deliberately cannot self-resolve — it needs a human decision, not a default |
| 4 | The report period is **in validity at resolve time**, by a Type I / Type II aware rule | Ruling 3. No universal TTL, never `uploaded_at` |
| 5 | The CUEC→control mapping is **`accepted`**, never `suggested`, never `auto`-only | `auto` is matcher output — AI may propose, not confirm |
| 6 | A **governed** control→requirement association exists (see prerequisite 2) | The hop that is currently empty |
| 7 | **No contradicting signal** — no `contradicts` analysis, no open finding on that control/requirement for that vendor | Contradiction beats coverage, always |
| 8 | Coverage is **full**, not partial | §2 #11 |

Until at least one document satisfies 1–4 on staging, any S4 acceptance run is
vacuous regardless of how the other prerequisites land. **No document can
satisfy clause 2 today.**

#### BLOCKER — `assurance_opinion` has no writer

`vendor_assurance_documents.assurance_opinion` is written by **nothing**.
Verified 2026-08-30 by exhaustive search: the column name appears in exactly two
files — `db/migrations/20261066_assurance_opinion.sql`, and
`src/api/lib/vendorAssurance/assuranceOpinion.ts`, the latter only inside a
comment stating that nothing writes it. **Zero routes, zero services, zero
scripts.**

VA-S4 Step 4 (PR #936) shipped the closed vocabulary, `opinionCoverageGate`, the
advisory proposal normalizer and the authority CHECK that makes an opinion
without a named acceptor structurally impossible — but **no acceptance
surface**. The governed path stops one step short of the act it governs.

So "obtain a human-accepted opinion" cannot be done through any product or
governance path. The only way to set the field is direct database manipulation,
which would make the resulting proof a fabrication — precisely what the §7 gate
exists to prevent. **An acceptance surface is a prerequisite of the
prerequisite**, and it is a build item, not an operator task.

This is why prerequisite C was attempted and stopped on 2026-08-30 rather than
completed. Every other step had a real route — vendor, engagement, document
upload, approval, CUEC mapping acceptance, and a tenant control already carrying
canonical identity. Only opinion acceptance had none.

#### Two lifecycle findings the same verification produced

**Finding A — `approved` is human-owned by CONVENTION, not by construction.**
The approve route's middleware is `requireApiKey + attachOrganizationContext +
requireEntitlement("premium") + denyContributor()` — **no user session is
required** — and it writes `approved_by_user_id = req.userId ?? null`. Meanwhile
`vendor_assurance_documents_approved_consistency` requires only `approved_at IS
NOT NULL AND processing_status = 'approved'` and says **nothing** about the
approver. An API-key-only integration can therefore produce an `approved`
document with a NULL approver. **Any predicate must require
`approved_by_user_id IS NOT NULL`, never the status alone** — which the
read-only instrument now does. Whether the CHECK should be tightened to match
the opinion authority CHECK is a separate decision, and tightening it is a
migration against live rows.

**Finding B — eligibility, once granted, is irreversible.**
`vendor_assurance_documents` has no `revoked_at`, no `superseded_by`, no
soft-delete column and no DELETE route, and field overrides are refused once
`approved` (a re-open is documented as "out of scope"). Nothing can withdraw an
approval. Combined with the fact that report periods live in
`vendor_assurance_extractions.fields` JSONB rather than columns — so Ruling 3
validity is not expressible in SQL either — **assurance coverage today would be
permanent and unbounded in time once granted.** That is not acceptable for a
production predicate, and it is a real dependency on the ADR-0012 subset
(§7 step 2) rather than a nicety.

#### The instrument

`scripts/validation/va-s4-readonly-predicate.mjs` implements this section's
semantics: gated on `approved` **plus a named approver**, routed through the
governed canonical crosswalk rather than `control_mappings`, and reporting any
`industry-template:*` row as `INVALID_SYNTHETIC` so the NIST CSF 2.0 umbrella
can never be counted as coverage. It is read-only and imported by nothing.

Result 2026-08-30 — hop by hop, `requirement → crosswalk → canonical control →
tenant control → accepted CUEC mapping → approved document → accepted opinion`:

| Hop | StageA | Estate-wide |
|---|---|---|
| 1. applicable NIST CSF 1.1 requirement | 57 | 114 |
| 2. governed crosswalk | 57 | 114 |
| 3. canonical control | 57 | 114 |
| 4. tenant control | 34 | 34 |
| 5. accepted CUEC mapping | **0** | **0** |
| 6. approved document | 0 | 0 |
| 7. human-accepted opinion | 0 | 0 |

**Verdict DEAD, zero synthetic rows.**

> **CORRECTED 2026-08-30 (S4-P1).** This paragraph previously read: *"Estate-wide
> it is empty because no CUEC has been human-accepted and the only accepted
> mappings are `auto`."* **That describes a state that cannot exist**, and it
> attributes the break to the wrong hop.
>
> **The terminal break is DISJOINT TENANCY at h5**, and it was isolated by
> relaxation rather than inferred. h5 was re-measured with each eligibility
> clause removed in turn:
>
> | h5 variant | Result |
> |---|---|
> | `mapping_status='accepted' AND mapping_source <> 'auto'` | **0** |
> | `mapping_status='accepted'` | **0** |
> | any mapping, any status, any source | **0** |
>
> The bare structural join is empty, so h5 is not failing an eligibility test —
> there is nothing to test. The estate splits in two and no organisation holds
> both halves:
>
> | Org | identities | VA docs | CUECs | mappings | CSF 1.1 |
> |---|---|---|---|---|---|
> | `Enterprise Validation StageA` | **30** | **0** | 0 | 0 | yes |
> | `Staging Inc` | **0** | **53** | 6 | 10 | no (800-53 Rev 5 only) |
>
> A correctly org-scoped predicate **must** return zero against this corpus.
> That is a corpus fact, not a defect.
>
> **h6 carried a defect of its own, independent of the corpus.** The clause
> `vendor_assurance_cuecs.review_status = 'accepted'` is **unsatisfiable by CHECK
> constraint** — the live vocabulary is
> `('pending','not_applicable','satisfied','gap','reviewed_no_match')`, set by
> migration `20261036`, which replaced acceptance with **determination**. No row
> can ever hold `'accepted'`, so h6 would have returned zero against a perfect
> corpus. Fixed in the instrument under S4-P1.
>
> Hop 7 sits downstream of both and has never been reached by a single row. It
> is unreachable for everyone until the acceptance surface (S4-P2) is built.
>
> Evidence: `docs/validation/VA-S4-dead-hop-forensics-2026-08-30.md` §§1–3.

### Prerequisite 2 — governed tenant-control → canonical-control association (missing MECHANISM)

`templateLoader` is the **only** writer of `control_canonical_identities`.
Provenance `attestation`, `customer_mapped` and `inferred` have **no route, no
service and no script**. A hand-created control — the normal case for a real
tenant — can acquire a canonical identity by no means at all.

**Hand-created controls must NOT be auto-assigned to canonical controls.** Name
similarity is not identity, and a wrong canonical identity silently changes what
a historical assurance decision was anchored to — the exact defect Step 1 was
built to end.

The association path is **governed, staged, and human-terminated**:

```
customer / tenant control
  → candidate canonical association        (proposal; may be AI-generated)
  → validation / mapping analysis          (evidence for the proposal, reviewable)
  → governed confirmation                  (a named human accepts or rejects)
  → control_canonical_identities row       (the durable identity)
```

**Only the final step writes an identity row.** A proposal is not an identity,
and no proposal may skip the confirmation step — the same boundary
`vendor_assurance_cuec_control_mappings` already draws with `mapping_status`
(`suggested` → accepted) and `mapping_source` (`auto` | `manual`), and the same
boundary the crosswalk's publication CHECK draws. **AI may PROPOSE a canonical
association; it may never authoritatively publish or confirm one.**

How the existing provenance vocabulary should be used — settling this before any
build, because the values already exist and misusing them is worse than adding
one:

| Provenance | Correct use | Not for |
|---|---|---|
| `template` | Written by `templateLoader` when `TemplateControl.id` resolves through a registered alias to a **published** canonical control. Already built and now proven live | Anything a human or a model decided |
| `attestation` | A named human in the tenant explicitly declares this control implements this canonical control. The 20261069 CHECK **already requires an actor** for this value and forbids one on the others — so this is the terminal state of the governed path above | A bulk or inferred assignment |
| `customer_mapped` | The tenant's own mapping asserted through a governed customer-mapping surface (Ruling 2: customers may strengthen, never silently narrow the SecureLogic baseline) | A SecureLogic-authored claim |
| `inferred` | A weak/machine match that **nobody stood behind**. It exists so a candidate is representable without being mistaken for a decision, and it must **never** be treated as evidence, nor be sufficient for S4 coverage | Any coverage-bearing decision |

**Open question this raises, and it is a design decision not an implementation
detail:** whether a *candidate* association is a row in
`control_canonical_identities` with provenance `inferred`, or a separate
proposal object that only ever becomes an identity on confirmation. The former
reuses an existing table and risks a candidate being read as an identity by
every consumer that does not filter provenance; the latter is one more object
but keeps "proposed" and "decided" structurally distinct — the pattern
`vendor_assurance_cuec_control_mappings` and the crosswalk both chose. **Decide
this before building.**

**Controls with no canonical equivalent must be preserved as such.** A
customer-specific control with no SecureLogic counterpart is a legitimate,
representable state — no row, and that absence is meaningful. It is not a gap to
be filled, not a data-quality defect, and not something a coverage metric may
count against the tenant.

### Prerequisite 3 — crosswalk corpus coverage (missing CONTENT)

The two must not be confused:

| | |
|---|---|
| **MECHANISM — PROVEN** | Governed canonical publication works end to end: publication authority, fail-closed drift detection, alias resolution, versioned requirement identity, the crosswalk join, the tenant identity write, and the evidence terminus. Demonstrated on staging 2026-08-30 with 45 controls / 54 aliases / 75 crosswalk rows and a live 57 → 44 → 34 chain |
| **CONTENT — INCOMPLETE** | The published corpus covers **NIST CSF 1.1 only**. The evidence-bearing staging org runs **NIST SP 800-53 Rev 5**. Zero governed crosswalk reachability there is the **expected and correct** result, not a defect |

**Do not manufacture NIST SP 800-53 mappings to make the staging test pass.** A
crosswalk invented to turn a number green is precisely the "correct and joins to
nothing" failure the NIST CSF 1.1-over-2.0 decision was taken to avoid, and it
would be published as governed SecureLogic reference content asserting mappings
no one curated.

Reconciliation with the planned curation work: Ruling 1 fixes framework priority
as **NIST CSF · SOC 2 · GDPR · CCPA/CPRA · NIST AI RMF**, and #920's SOC 2 /
NIST CSF re-curation rides this same crosswalk (§6). **NIST SP 800-53 is not on
that list.** Two legitimate routes, and the choice is an owner decision, not an
implementation one:

- **(a)** curate the next priority framework (SOC 2) and prove reachability
  against an org that runs it — keeping the priority order intact; or
- **(b)** add NIST SP 800-53 Rev 5 to the curation queue **on its own merits**
  as a customer-demand decision, explicitly re-ordering the priority list.

What is not legitimate is bending the corpus to the shape of one staging org.

### Status

**S4 remains DEAD. It is not to be wired.** Prerequisites 1, 2 and 3 are now
named, measured and independent; the smallest dependency-ordered plan to resolve
them is the next decision, and none of them is authorized for implementation by
this record.

---

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

## 5b. ADR-0012 dependency analysis (owner-required, 2026-08-29)

ADR-0012 was **ratified and never built** — migrations 20261051–55 were
authorized and the ledger jumps `20261049` → `20261059`. So the question is not
"does S4 use ADR-0012" but **"which ADR-0012 capabilities must exist before
assurance-based question reduction is DEFENSIBLE?"**

The test is a single sentence: **we must be able to reconstruct, later, why a
question was not asked.** A depth reduction is a decision not to ask; if the
basis for it cannot be reproduced, the assessment cannot be defended to an
auditor, a customer, or a court.

| Must be reconstructible | Available without ADR-0012? | Verdict |
|---|---|---|
| **Evidence used** | Yes — the document/extraction/mapping rows are addressable by id | Sufficient IF the ids are recorded at decision time |
| **Evidence version** | **NO.** Extractions and `field_overrides` are mutable; a re-review changes `currentValue()` with no history | **REQUIRED** |
| **Evidence review/acceptance** | Partly — `review_decisions` carries `decided_by_user_id` and `decided_at` per field, but nothing pins WHICH decision was current when S4 ran | **REQUIRED** (snapshot of the accepted state) |
| **Requirement/control mapping used** | Partly — `cuec_control_mappings` and `control_mappings` are mutable and carry no history. A mapping accepted today and revoked tomorrow leaves no trace that it justified a reduction | **REQUIRED** |
| **Assessment/scope version** | Yes — `scope_rule_version` is stamped on the engagement | Sufficient |
| **Reason depth was reduced** | Yes — S4 writes a `reasons` entry on the item | Sufficient, IF the rationale names the document and mapping rather than saying "covered by assurance" |
| **Reviewer identity** | Partly — available on `review_decisions`, not pinned to the S4 decision | **REQUIRED** (as part of the snapshot) |
| **Timestamp** | Yes — the resolve time is recoverable | Sufficient |
| **Contradictory findings/exceptions present at decision time** | **NO.** Findings open and close; a finding that existed when S4 ran and was closed since is invisible afterwards | **REQUIRED** |

### Conclusion

**Four of the nine are not reconstructible today, and they are the four that
matter most** — evidence version, the accepted state, the mapping used, and the
contradictions present at the time. Every one of them is mutable state that S4
reads and nothing preserves.

What S4 needs is precisely ADR-0012's **decision-basis snapshot**: an immutable
record, written at the moment of the reduction, of the evidence version, the
accepted review state, the mapping ids, the reviewer, and the contradiction set
as it stood. Not the whole of ADR-0012 — the immutable *history* of every
evidence object is a larger promise than S4 requires.

### The ruling this implies

**S4 must not be production-enabled before a decision-basis snapshot exists.**
It could be built and validated first — the predicate and its dry run need no
snapshot — but flipping it on in production without one would create depth
reductions nobody can later justify, which is a worse failure than asking a
redundant question.

Recommended sequencing:

1. validate the predicate (§3) — no ADR-0012 dependency;
2. build the ADR-0012 decision-basis snapshot **subset** listed above, under its
   own authorization;
3. then wire S4, writing a snapshot with every reduction;
4. only then consider production enablement.

**Do not build ADR-0012 now** — it is not authorized, and this section exists to
record the dependency, not to start it.

## 6. #920 reconciliation — one curation mechanism, not two

**#920 (SOC 2 / NIST CSF scope-tag re-curation) must NOT proceed as a separate
curation effort.** Owner ruling 1 makes SecureLogic the owner of governed,
versioned reference content, and #920 is reference-data curation over two of the
five priority frameworks. Running it independently would create a second
curation mechanism competing with the canonical crosswalk — different
provenance, different versioning, different approval path, for the same corpus.

They are **different axes of the same content**, and they should share one
governance spine:

| | #920 | Canonical crosswalk |
|---|---|---|
| Axis | requirement → `scope_tags` (which domain/rules reach it) | control → requirement (what evidences it) |
| Governs | applicability | assurance |
| Today | `scope_tags_source` ∈ `curated` / `heuristic` / `uncurated` — provenance **already exists** (VA-Q2 P3.1, 20261064) | `control_mappings` — **no provenance at all** |

Note the asymmetry: **the tagging axis already has the governance the mapping
axis lacks.** `scope_tags_source` is exactly the provenance concept Ruling 1
demands, already shipped and staging-verified. The crosswalk package should
adopt that pattern rather than invent a parallel one, and #920 should be folded
in as the tagging half of the first reference-content package — same frameworks,
same version identity, same approval path, one review pass over one corpus.

**#920's own regression requirement stands unchanged**: re-tagging changes what
existing questionnaires ask on re-resolve, so the diff analysis it already
specifies is still owed, whichever package carries it.

## 7. Smallest dependency-ordered sequence to make S4 LIVE

Eight steps. The ordering is a real dependency chain, not a preference: nothing
after step 1 can be demonstrated without step 1.

| # | Package | Depends on | Migration | Notes |
|---|---|---|---|---|
| 1 | **Canonical crosswalk + reference content** (absorbs #920) — SecureLogic baseline for NIST CSF, SOC 2, GDPR, CCPA/CPRA, NIST AI RMF; customer layer separately identifiable (Ruling 2). **IMPLEMENTED 2026-08-30 — migrations 20261067–69.** The owner review the reconciliation stopped for was given and the new canonical entity approved; `canonical_controls` + `canonical_control_aliases` (20261067), `canonical_framework_versions` + `frameworks.framework_key` + `canonical_control_crosswalk` (20261068) and `control_canonical_identities` (20261069) are built, with the NIST CSF 1.1 proof corpus (45 canonical controls, 57/57 template references) as version-controlled reference content and a governed publisher. **STAGING VERIFIED 2026-08-30** (published + chain proven, `docs/validation/VA-S4-canonical-control-publication-2026-08-30.md`). **Still NOT complete**: coverage is NIST CSF 1.1 only, and §2d's three prerequisites are open | — | **BUILT — 20261067–69** | **MECHANISM PROVEN on staging 2026-08-30; CONTENT COVERAGE INCOMPLETE.** (a) the NIST CSF 1.1 corpus was published under a named human — 45 controls / 54 aliases / 75 crosswalk rows, persisted state matching the constraint-backed dry run exactly; (b) the real staging chain was proven end to end — 57 applicable requirements → 57/57 crosswalk → 44 of 45 canonical controls → 34 requirements reaching a tenant control → evidence. **The read-only S4 predicate was re-run and is STILL DEAD** — see §2d, which decomposes the cause into three prerequisites (assurance-eligible evidence; a governed hand-created-control → canonical association, which has NO writer today; crosswalk coverage of the frameworks evidence-bearing orgs actually run). Publication covers **NIST CSF 1.1 only**, deliberately. **Outstanding: #920's SOC 2 / NIST CSF re-curation is folded into this step's governed content work (§6) and rides the same crosswalk; its regression-diff requirement (§6 above) still stands** |
| 2 | **ADR-0012 subset** — `evidence.valid_from/valid_until` + `validity_basis` + version chain, `evidence_links` with per-use confirmation, `evidence_lifecycle_events`, and `evidence.assurance_class` (owner ruling: normalise in this package, not a second alter of `evidence`). **BUILT DARK 2026-09-01 — migrations 20261080–82** | — | **BUILT — 20261080–82** | **RE-SLOTTED.** The ADR reserved 20261051–55; those slots were never consumed and the repository floor had advanced to 20261079, so the implementation took the next sequential range by owner direction and **20261051–55 are RETIRED UNUSED**. **Two deliberate divergences from the ratified ADR, both owner-directed 2026-09-01:** (a) §2.1's origin-link backfill was NOT built and (b) §6.2's "legacy NULL-validity rows keep counting" is NOT implemented — fabricate no historical confirmations, and fail closed where history cannot be known. `validity_basis` is the discriminator that makes "nobody established this" distinguishable from "this never expires"; the ADR predicate read both as valid. **CONSEQUENCE: the entire legacy estate counts for NOTHING under the new predicate**, which is why nothing imports it (a test fails the build if anything does), `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` is default-off and undeclared, and **a legacy curation path is OWED before that flag can be considered**. Ships substrate with NO writer, declared at birth rather than discovered late (cf. step 4's opinion surface): the governed writer — link / confirm / detach, evidence curation, the D15 customer surface and a governed WITHDRAWAL path — **BUILT 2026-09-01, migration 20261084**. Owner ruling on the one genuine conflict (`vendorPortal.ts`'s deliberate hard delete vs `ON DELETE RESTRICT`): **detach all links, record events, then permit deletion**, implemented as the SECURITY DEFINER `withdraw_evidence()` so the capability exists WITHOUT granting `app_request` a general DELETE on `evidence_links`. **Withdrawal is a REVIEWER act, never the vendor's** — the portal now returns a distinguishable 409 `evidence_in_use` once a link exists. Curation is WRITE-ONCE by trigger, keeping `routes/evidence.ts`'s write-once promise true while letting Step 2/3's columns be filled in by a human. Proof: 20/20 contract unit, 32/32 isolation, 30/30 WORM + grants guards, 43/43 evidence-adjacent regression. Record: `docs/design/VA-S4-step2-adr0012-evidence-lifecycle.md` |
| 3 | **Evidence-validity policy** — type/purpose guardrails, customer tightening within bounds (Ruling 3) | 2 | **BUILT — 20261083** | **RATIFIED + BUILT 2026-09-01.** The owner ratified **D0, D1, D15 and D16** as recommended; D2-D14 remain open and are deliberately NOT implemented. `20261083` adds `policy_default` to `validity_basis` (the value Step 2 withheld precisely because a value only a ratified policy could produce would imply a policy existed), `evidence_validity_policy` (global, append-only versions, one live row per class, `app_request` SELECT-only) and `organization_evidence_validity_settings` (org-scoped, RLS forced, append-and-supersede, ceiling enforced by trigger). **Seeded with D1 ONLY**: `soc1` and `soc2_type2` at **12 months from report period end**, customer range 3..15; **`soc2_type1` carries NO duration** — D1 ratified that a Type I must not inherit the Type II rule but named no number, and the implementation does not invent one, so a Type I establishes no operating-effectiveness window at all. Classes with no policy row yield `not_established`: **absence is the fail-closed default, never a catch-all TTL**. Three rules bind in order — no ratified policy means no validity; the customer may tighten freely and loosen only to the ceiling; **the artifact always outranks the policy** (a computed window may narrow what the artifact asserts, never extend it). Still NO writer and still behind `SECURELOGIC_EVIDENCE_LIFECYCLE_V2`; step 3 introduces no flag of its own. Proof: 20/20 contract unit, 26/26 isolation, 21/21 Step-2 contract (re-pointed lockstep), 32/32 Step-2 isolation, 20/20 dataClassification, rollback EXECUTED + its refusal guard PROVEN. |
| 4 | **Auditor-opinion normalisation** — `unmodified / qualified / adverse / disclaimer / not_evaluated`, human-accepted, free text retained beside it (Ruling 4) | — | **DONE — 20261066** | Shipped 2026-08-29 (PR #936). Authority is a CHECK: no opinion without an acceptor. `opinionCoverageGate` returns `conditional` for `qualified` and deliberately cannot resolve it |
| 4b | **Opinion ACCEPTANCE surface** — a governed route that sets `assurance_opinion` + `assurance_opinion_accepted_by_user_id`, consuming `proposeAssuranceOpinion` as a candidate a human confirms. **BUILT as VA-S4-P2, 2026-08-30 — migration 20261070** | 4 | **BUILT — 20261070** | Step 4 shipped the vocabulary, the gate, the normalizer and the authority CHECK but **no writer**. `GET`/`POST /api/vendor-assurance/documents/:id/assurance-opinion`; `20261070` adds `assurance_opinion_reviewer_note` + `assurance_opinion_basis` and makes the basis REQUIRED by extending the authority CHECK. Refuses an unattributed caller (403), a non-approved document (409), an approved document with a NULL approver (409), an unexplained departure from the candidate (400) and a silent re-decision (409). Per §0a it establishes **no coverage**. **STAGING VERIFIED 2026-08-30 on `de035043`: 15 PASS / 0 FAIL** — `docs/validation/VA-S4-P2-opinion-acceptance-2026-08-30.md`. Estate-wide accepted opinions went 0 -> 1, the first that has ever existed |
| 4c | **Tested-controls arm DESIGN** — the canonical route named by Ruling 5, built on the ACTUAL extraction inventory (`fields.controls`, 5 entries per extraction on staging) constrained by TSC scope. Must state how candidate coverage becomes sufficient coverage, and must address the measured fan-out (one control -> up to FOUR requirements). **DESIGN ONLY, no wiring** | 4b staging verified | no | Owner-directed, 2026-08-30. **The inventory is now MEASURED** (§8b): 25 tested-control entries, 4 keys each, `result` is FREE TEXT with no pass/fail; exceptions ARE control-attributed; and the published crosswalk covers **`nist-csf 1.1` only** while every document is SOC 2 TSC — so Ruling 5's chain has a missing link at the hop that matters |
| 5 | **S4 wiring** — `assuranceCoveredRequirementIds` computed and passed; decision-basis snapshot written per reduction | 1,2,3,**4b**, **and the tested-controls arm design** | no | **BUILT 2026-09-01.** The counting predicate is `src/api/lib/vendorAssurance/assuranceCoverage.ts` (`assurance-coverage-1.0`): a live SUFFICIENT determination, its document approved and belonging to THIS engagement's vendor, its requirement identity (held by value) resolving in THIS org, and its window CURRENT under the ratified Step-3 policy at read time — every missing hop is a RECORDED gap, never a silent discard. Evaluator bumped to `sufficiency-veto-1.1`: `report_period` is COMPUTABLE (assembly supplies a validity assessment through `resolveValidityWindow` — the same machinery, never a re-implementation) and `contradictory_evidence` is evaluated AT DETERMINATION TIME as a conflicting-governed-judgement check (`evaluateContradictionVeto`; link-level contradiction has no vocabulary yet — `link_kind` is `origin|reuse` — stated as a known limit). `open_findings` refinement: ZERO open findings estate-wide is now evaluable (a true statement about an empty set); the unobservable case — findings exist, none dimensioned — stays NOT_EVALUABLE. Wired at `resolveScope` behind `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` with ADR-0012 §5 DUAL-READ: coverage computed and logged on EVERY resolve (`s4_coverage_dual_read` + persisted in the scope_resolved audit payload), APPLIED only when the flag is on; flag-off output byte-identical, test-asserted. The reduction sets depth to `confirm`, never removes, never touches floors; the decision basis (determination id, document, valid_until, source, predicate version, as-of) rides the scope item's own S4 reason. Reviewer surface: `GET /vendor-engagements/:id/assurance-coverage` — covered AND the gaps with reasons. **Proven end to end through product paths** (isolation capstone, 27/27): the FIRST SUFFICIENT ever recorded (all twelve vetoes PASSED), counted for the right vendor only, expired-at-read excluded, flag-off identical, flag-on reduced with basis, superseding INSUFFICIENT withdraws coverage while the historical basis survives intact |
| 6 | **Adversarial / security tests** — cross-tenant coverage leakage, forged mapping, expired-at-decision-time, qualified-opinion fail-closed, AI-proposed mapping cannot publish, partial coverage does not reduce | 5 | no | Fail-closed is the assertion, not an aspiration |
| 7 | **Staging acceptance** on the exact merged SHA | 6 | no | Must show a REAL reduction, not a vacuous pass |
| 8 | **#925 reassessment** — re-measure Privacy 17/17, AI 16/16, Nth-party 2/2 against live assurance | 7 | no | The ruling becomes decidable only here |

### What can run in parallel

- **1, 2 and 4 are independent of each other** and can run concurrently — they
  touch different tables (`control_mappings`, `evidence`/`evidence_links`,
  extraction fields) and share no schema slot. This is the only meaningful
  parallelism available, and it is worth taking: step 1 is the long pole because
  it is curation work, so 2 and 4 should run alongside it rather than after.
- **3 depends on 2** (there is nothing to apply a validity policy to until the
  columns exist) but its *ratification* — the default durations — can be decided
  in parallel with everything.
- **5 depends on all of 1–4** and cannot start early. Wiring S4 against a
  partial chain would produce a predicate that passes vacuously, which is worse
  than one that fails: a vacuous pass reads as "no reduction was warranted".
- **6, 7, 8 are strictly serial** after 5.

### Gate before step 5

Re-run the read-only validation of §3. If it still reports zero eligible
requirements, **stop** — S4 would ship dead a second time, and the cause will be
step 1's population rather than the predicate.

**The gate FIRED on 2026-08-30 and the answer was STOP.** With the crosswalk
published and the chain proven, the predicate still returns zero eligible
requirements, and the cause is population and corpus coverage exactly as
anticipated — not the predicate. S4 was not wired. See §2d for the hop-isolation
evidence and the three prerequisites, and
`docs/validation/VA-S4-canonical-control-publication-2026-08-30.md` for the run
record. **This gate must be re-run, and must pass, before step 5 is attempted
again.**

**Two things changed on 2026-08-30 that the gate must now account for.** First,
h5 disjoint tenancy is a CORPUS fact: no staging org holds both a canonical
identity and an assurance document, so a correctly org-scoped predicate returns
0 no matter what is built. Owner ruling: that is data/setup work and is **never**
a reason to change the architecture — prepare the minimum controlled corpus that
exercises the canonical path in ONE tenant, keep it clearly identifiable and
removable, and manufacture no production data. Second, step 4b now exists, so
the opinion hop is reachable for the first time — but reaching it proves one
veto passed, not coverage.

## 8b. The tested-controls inventory, MEASURED (2026-08-30, S4-P2)

Read-only on staging, `job-daa7q3hsrm7s73e73qq0`. Five extractions estate-wide,
**25 tested-control entries** (5 per extraction) and **10 exception entries**
(2 per extraction). Full record:
`docs/validation/VA-S4-P2-opinion-acceptance-2026-08-30.md` §7-§8.

**Three findings that change this step's design.**

**1. `controls[].result` is FREE TEXT.** Four keys per entry on 25/25 —
`control_id`, `description`, `test_procedure`, `result` — and `result` carries
prose: `"No exception noted."` (15), `"Exception noted: for 2 of 30 sampled
days …"` (5), `"Deviation noted: …"` (5). No boolean, no enum. **This is the
auditor-opinion problem a second time**, so the tested-controls arm needs its own
closed vocabulary, its own deterministic normalizer and its own human acceptance.
It cannot be a SQL predicate over `result`.

**2. A recorded fact was WRONG: exceptions ARE attributed to a control.**
Ruling 4's blocker says nothing attributes an exception to a control. Measured:
all 10 `exceptions[]` entries carry `control_id`, `description` and
`auditor_assessment`, and `control_id` joins directly to
`controls[].control_id`. The exception veto is directly expressible today.

**3. The canonical crosswalk does not cover SOC 2 AT ALL.** Published coverage is
`nist-csf 1.1` only (75 rows). Every assurance document is `SOC 2 Type II` with
TSC `Security / Availability / Confidentiality`, and every vendor control id is a
TSC reference (`CC6.1 CC6.2 CC7.2 A1.2 C1.1`). **No SOC 2 TSC -> canonical
control crosswalk exists**, so Ruling 5's chain breaks at the hop that turns a
tested vendor control into a requirement. Step 1 is not finished for the
framework the evidence is actually written in.

### Veto expressibility, measured

Expressible today: report/TSC scope, report period, Type I vs II, control
exception, carve-out, accepted opinion (built), historical basis.
**Not expressible: tested-control result** (free text), **mapping authority**
(`control_canonical_identities` has ONE writer, `templateLoader`; `attestation` /
`customer_mapped` / `inferred` have no route), contradictory evidence.
Partial: open findings (expressible on `requirement_id`, not
`framework_control_id`).

**All five documents are carve-out reports** (`subservice_method = "Carve-out"`,
3 subservice orgs each). The carve-out veto fires on 100% of the corpus.

### Fan-out, re-measured at the crosswalk grain — the number is 5, not 4

§6 of the forensics record measured fan-out at the TENANT-CONTROL grain and
reported a maximum of four. At the **crosswalk** grain — the grain coverage would
actually propagate along — **44 canonical controls, 21 map to more than one
requirement (48%), and the maximum is FIVE.**

Under Ruling 6 this is decisive. One `"No exception noted."` could silently
reduce depth on up to five requirements, and 21 of 44 controls would do it to at
least two. **Sufficiency must therefore be determined at the REQUIREMENT grain,
not the control grain** — a determination attached to the canonical control
cannot express "this test supports DE.AE-1 but not DE.CM-5".

---

## Related

`docs/design/VA-EVIDENCE-architecture-reconciliation.md`, #925, #926,
`src/api/lib/vendorRisk/scopeResolver.ts` (S4), ADR-0012 (ratified, unbuilt).
