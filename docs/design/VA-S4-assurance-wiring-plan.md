# VA-S4 — wiring `S4.assurance`: implementation plan

**Status:** PLAN ONLY. Not authorized for implementation.
**Predicate validated read-only against staging 2026-08-29 — result: DEAD.**
Four owner rulings incorporated 2026-08-29 (§2a). VA-Q2 P4 is complete and
staging verified; S4 remains deliberately outside it.
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
Section IV exceptions demonstrably do not touch — a determination nothing in the
current model can make, because the structured `exceptions` array is **empty in
all five extractions** while the narrative cites them.

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
| 1 | **Canonical crosswalk + reference content** (absorbs #920) — SecureLogic baseline for NIST CSF, SOC 2, GDPR, CCPA/CPRA, NIST AI RMF; customer layer separately identifiable (Ruling 2). **BLOCKED ON OWNER REVIEW**: the identity reconciliation (`VA-CANONICAL-CONTROL-IDENTITY-reconciliation.md`) found that no suitable canonical control identity exists — `TemplateControl.id` is stable but discarded at load, and `(organization_id, name)` is a mutable display string. A genuinely NEW canonical entity is required, so implementation stops for review per the ruling | — | yes (3, none reserved) | **THE blocker.** Until CUEC-reachable controls have canonical mappings, every later step is unobservable |
| 2 | **ADR-0012 subset** — `evidence.valid_from/valid_until` + version chain (20261051), `evidence_links` with per-use confirmation (20261052–53), `evidence_lifecycle_events` (20261054). **Now also carries `evidence.assurance_class`** (owner ruling: normalise in this package, not a second alter of `evidence`) | — | yes (reserved) | Only the subset S4 needs. **Note the corrected finding**: `evidence_type` is NOT unconstrained — it is a closed FORM vocabulary, and what is missing is an orthogonal ASSURANCE-CLASS axis. See the validity proposal §2 |
| 3 | **Evidence-validity policy** — type/purpose guardrails, customer tightening within bounds (Ruling 3) | 2 | maybe | **Default durations proposed separately for ratification, not chosen here** |
| 4 | **Auditor-opinion normalisation** — `unmodified / qualified / adverse / disclaimer / not_evaluated`, human-accepted, free text retained beside it (Ruling 4) | — | **DONE — 20261066** | Shipped 2026-08-29 (PR #936). Authority is a CHECK: no opinion without an acceptor. `opinionCoverageGate` returns `conditional` for `qualified` and deliberately cannot resolve it |
| 5 | **S4 wiring** — `assuranceCoveredRequirementIds` computed and passed; decision-basis snapshot written per reduction | 1,2,3,4 | no | One module, one call-site change |
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

## Related

`docs/design/VA-EVIDENCE-architecture-reconciliation.md`, #925, #926,
`src/api/lib/vendorRisk/scopeResolver.ts` (S4), ADR-0012 (ratified, unbuilt).
