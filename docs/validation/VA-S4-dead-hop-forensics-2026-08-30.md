# VA-S4 — the dead hop, measured (staging, read-only)

Environment: **staging** (`securelogic-engine-staging` `srv-d7n0rju8bjmc738jbs7g`, db `securelogic-staging-db`).
Code: `develop` `57c1962c`. Date: 2026-08-30.

**READ-ONLY.** Three injected jobs — `job-daa4f3pf2nfc7396mh2g`,
`job-daa4i0hsrm7s73du95gg`, `job-daa4j5lg1s2s73c4h3l0` — all exit 0. The first two
ran entirely inside `BEGIN READ ONLY … ROLLBACK`; the third is pure `SELECT`. No
row was created, modified or deleted. No scope was mutated, no questionnaire
issued or reissued, no flag changed, no promotion, no Blueprint sync. `S4` remains
unwired: `assuranceCoveredRequirementIds` still has **zero production callers**
(`scopeResolver.ts:123` declares it, `:698` reads it, nothing passes it).

---

## 1. The premise correction

The package was opened on the understanding that the read-only predicate dies at
the auditor-opinion hop. **It does not.** It dies two hops earlier, and no row
has ever reached the opinion hop.

| Hop | Estate-wide | StageA |
|---|---|---|
| h1 applicable NIST CSF 1.1 requirement | 114 | 57 |
| h2 governed crosswalk (published, live) | 114 | 57 |
| h3 published canonical control | 114 | 57 |
| h4 tenant control (`control_canonical_identities`) | **34** | **34** |
| h5 accepted, non-`auto` CUEC→control mapping | **0** | 0 |
| h6 accepted CUEC + approved document | 0 | 0 |
| h7 human-accepted opinion, `eligible` | 0 | 0 |

Three relaxations were measured, not assumed, to locate the break precisely:

| h5 variant | Result |
|---|---|
| `mapping_status='accepted' AND mapping_source <> 'auto'` (committed) | **0** |
| `mapping_status='accepted'` (drop the source clause) | **0** |
| any mapping, any status, any source (drop every eligibility clause) | **0** |

The bare structural join is empty. h5 is not failing an eligibility test; there
is nothing to test.

---

## 2. Cause, classified

Three independent causes, stacked. Any one is fatal.

### h5 — DISJOINT TENANCY (cause A: corpus)

The estate splits cleanly in two, and the halves never meet:

| Org | canonical identities | VA docs | CUECs | mappings | NIST CSF 1.1 |
|---|---|---|---|---|---|
| `Enterprise Validation StageA` `f70267ce` | **30** | **0** | 0 | 0 | yes |
| `Staging Inc` `fe2ede61` | **0** | **53** | 6 | 10 | no (800-53 Rev 5 only) |
| `[SEED] Walkthrough Org` `295b989a` | 0 | 3 | 0 | 0 | no |
| `Standing Inc 3` `55041494` | 0 | 1 | 3 | 0 | no |

No organization holds both halves. A correctly org-scoped predicate **must**
return 0 against this corpus, and it does. This is not a predicate defect.

All 10 CUEC→control mappings point at hand-created `Staging Inc` controls
(`template_source` NULL, `has_canonical_identity` false on all 10).

### h6 — UNSATISFIABLE BY CHECK CONSTRAINT (cause E: predicate defect)

`scripts/validation/va-s4-readonly-predicate.mjs:124` requires
`vendor_assurance_cuecs.review_status = 'accepted'`. The live constraint:

```
vendor_assurance_cuecs_review_status_check
  CHECK (review_status = ANY (ARRAY['pending','not_applicable','satisfied','gap','reviewed_no_match']))
```

**`'accepted'` is not in the vocabulary and no row can ever hold it.** Even
against a fully populated corpus h6 would return 0 forever. Migration `20261036`
replaced the CUEC vocabulary with a *determination* model — a CUEC is not
accepted, it is determined `satisfied` / `gap` / `not_applicable` — and the
predicate was written against the vocabulary that migration retired.

The wiring plan §2d records h5/h6 emptiness as "no CUEC has been human-accepted."
That describes a state that cannot exist. **Corrected here.**

### h7 — NO WRITER (cause D: acceptance has no surface)

Confirmed live: `assurance_opinion IS NOT NULL` on **0 of 57** documents, and the
column is written by nothing in the codebase.

This is **not cause B** — extraction populates the source field. It is **not
cause C** — normalization exists and is correct. It is **cause D**: the human
review/acceptance step that would establish the authoritative value has no
surface. `vendor_assurance_review_decisions` is **empty corpus-wide**: zero
accept/edit/reject decisions have ever been recorded, on any field, by anyone.

It is **not cause F**: the documents are SOC 2 Type II, which unambiguously
carries an applicable auditor opinion.

---

## 3. The trace, document → predicate

Representative: document `323840a5-8165-4661-8c60-d4cbca1afc9d`, `Staging Inc`,
`processing_status='approved'` with a named approver — the strongest document in
the estate.

```
document 323840a5   processing_status=approved, approved_by_user_id set
  ↓
extraction f81e3b0f   5 of 5 extractions are byte-identical (one synthetic PDF, uploaded 5×)
  ↓
fields.auditor_opinion.value =
  "Unqualified opinion, except for the specific deviations and exception
   described in Section IV"
  confidence 0.99 · span page 1: "Opinion Unqualified opinion, except for…"
  ↓
vendor_assurance_review_decisions for this extraction → 0 rows (0 estate-wide)
  ↓
vendor_assurance_documents.assurance_opinion → NULL (0 of 57)
  ↓
predicate h7 → UNREACHABLE; no row survives h5
```

`proposeAssuranceOpinion` on that live string returns **`qualified`** — the
`except for` pattern is tested before the `unqualified` pattern — so
`opinionCoverageGate` returns `conditional`. **The normalizer is correct and the
system already fails closed at this point.** What is missing is any mechanism to
resolve `conditional`, and any surface to record the human decision.

### Corpus census (staging, 2026-08-30)

| Measure | Value |
|---|---|
| `vendor_assurance_documents` | 57 — `extraction_failed` 52, `extracted` 3, `approved` 2 |
| documents ever `finalized` | **0** |
| `approved` with named approver | 2 of 2 |
| extractions | 5 (5 documents, 2 orgs) |
| **`vendor_assurance_review_decisions`** | **0** |
| CUECs | 9 — **all `pending`**, 0 with reviewer, 0 with `gap_basis` |
| CUEC→control mappings | 10 — **all `mapping_source='auto'`** (3 accepted, 7 suggested); **zero `manual`** |
| documents with `assurance_opinion` set | **0** |
| `control_canonical_identities` | 30, all provenance `template`, all StageA |
| scope items with `depth='confirm'` | **0** (1411 `full` + 715 `attest`) |
| `evidence` | 17; `evidence_analysis` 2, both `unreadable` |

`depth='confirm'` is S4's only output. It has never been written once.

---

## 4. Correction to the wiring plan — Ruling 4's premise is wrong

§2a Ruling 4 states: *"the structured `exceptions` array is **empty** in all five
extractions while the narrative cites them."*

**False against live data.** `exceptions` is populated with **2 entries in all 5
extractions**, each carrying a page-3 source span:

> "Exception noted: for 2 of 30 sampled days, failed backup jobs were not
> investigated within the organization's documented 24-hour SLA. Backups were
> subsequently completed successfully within 48 hours."

> "Deviation noted: the Q3 privileged access review was completed 19 days after
> the documented due date. All sampled accounts were eventually reviewed, and no
> inappropriate privileges were identified."

Every material field except `report_issued_date` is populated on 5/5 extractions
at confidence 0.99:

| Field | Value (identical on all 5) |
|---|---|
| `report_type` | `SOC 2 Type II` |
| `report_period_start` / `_end` | `2025-01-01` / `2025-12-31` |
| `report_issued_date` | **null on 5/5** (confidence 0.00) |
| `trust_services_criteria` | `["Security","Availability","Confidentiality"]` |
| `subservice_method` | **`Carve-out`** |
| `exceptions` | 2 entries |
| `cuecs` / `controls` | 3 / 5 entries |

The data needed to decide "is this exception unrelated to the mapped control"
**exists in structured form**. Ruling 4's blocker is not missing data; it is that
**nothing attributes an exception to a control**. That is a different and smaller
problem than the one recorded.

The second exception — a late privileged access review — lands directly on
`Quarterly access reviews`, one of the three controls carrying an *accepted*
CUEC mapping. The corpus contains its own counterexample.

---

## 5. What the opinion is allowed to prove

A clean report-level opinion must be **necessary and never sufficient**. Five
facts must each be able to veto coverage independently. None is represented today.

1. **TSC scope.** The report covers Security / Availability / Confidentiality. A
   requirement resolving to a Privacy or Processing Integrity control is outside
   what the auditor examined. Coverage must be refused, not inherited.
2. **Carve-out.** `subservice_method = "Carve-out"` means subservice
   organization controls were **excluded from testing**. Any requirement whose
   satisfaction depends on a subservice org is uncovered by construction.
   `subservice_organizations` is extracted and joins to nothing.
3. **Report period.** `2025-01-01 → 2025-12-31` asserts something about that
   window, not about today. With `report_issued_date` null on 5/5 there is not
   even an issuance anchor for bridge-letter reasoning.
4. **Type I vs Type II.** A Type I is a point-in-time design opinion and cannot
   support an operating-effectiveness claim at all. One validity rule cannot
   serve both; `report_type` is extracted and consumed by nothing.
5. **Control-level exception beats report-level opinion, always.** A clean
   opinion is an aggregate materiality judgement; an exception is a specific
   tested failure, and it is the more specific fact about that control.

Contradiction arms available today: `evidence_analysis.verdict='contradicts'`
carries `requirement_id` + `engagement_id`, so that clause is expressible.
**`findings` has no `control_id`** — only `requirement_id` and
`framework_control_id` — so §2d clause 7's "no open finding on that control" is
not directly expressible and must be phrased on `requirement_id`.

### The CUEC inversion — the largest open question in this package

A CUEC is what the vendor's report says **the customer must do**. It marks the
boundary of what the auditor did **not** test at the vendor.

The committed predicate routes coverage *through* CUEC→control mappings, which
reads as: *"the vendor told us we must do X ourselves, therefore we need not ask
the vendor about X."* That inference runs backwards.

The defensible route for **vendor** assurance coverage is the report's **tested
controls** (`fields.controls`, 5 entries per extraction) constrained by its
**TSC scope** — not its CUECs. The CUEC spine is the right home for the
**customer-side gap** workflow that `20261036` built, which is a different
question from S4.

**This is an owner ruling, and it is upstream of every remaining build item.**

---

## 6. Control→requirement fan-out, now quantified

Fifteen StageA tenant controls each resolve to more than one NIST CSF 1.1
requirement through the published crosswalk:

| Tenant control | Requirements |
|---|---|
| `Risk analysis documentation (current)` | **4** |
| `Annual risk assessment per Security Rule §164.308(a)(1)(ii)(A)` | **4** |
| `Designated HIPAA Privacy Officer` | 3 |
| `Designated HIPAA Security Officer` | 3 |
| `File integrity monitoring on ePHI repositories` | 3 |
| 10 further controls | 2 each |

A single assurance fact would silently reduce depth on up to **four**
requirements. §2 open question #5 is not theoretical and must be answered before
wiring.

---

## 7. The ceiling — what would qualify if S4 were wired

**Zero requirements qualify today.** The *ceiling* is the h4 set: **34 distinct
NIST CSF 1.1 references on StageA**, reached through 30 template-provenance
canonical identities.

`DE.AE-1 · DE.AE-2 · DE.AE-3 · DE.CM-3 · DE.CM-5 · DE.CM-7 · ID.AM-1 · ID.AM-5 ·
ID.AM-6 · ID.BE-1 · ID.BE-3 · ID.BE-5 · ID.GV-2 · ID.GV-4 · ID.RA-3 · ID.RA-4 ·
ID.RA-5 · ID.RA-6 · PR.AC-1 · PR.AC-3 · PR.AC-4 · PR.AC-5 · PR.AT-1 · PR.AT-2 ·
PR.DS-1 · PR.DS-2 · PR.DS-3 · PR.IP-1 · PR.IP-4 · RC.RP-1 · RS.AN-1 · RS.CO-1 ·
RS.CO-2 · RS.RP-1`

That ceiling is unreachable: StageA has **zero** assurance documents, and the org
that has them cannot reach the crosswalk. Zero synthetic
(`industry-template:*`) rows appeared at any hop.

---

## 8. Non-SOC evidence

`assurance_opinion` is a property of an independent-assurance *report*. It must
be a clause on the SOC/ISAE **arm**, never a universal prerequisite — a low or
nominal vendor may hold no SOC report and must still be able to reach governed
assurance.

Existing generic spine (`evidence`, 17 rows) already carries the three things S4
needs: origin (`source_type`/`source_id`/`sha256`), requirement link
(`requirement_id`, `engagement_id`), and a human review arm (`reviewed_at`,
`reviewed_by_user_id`, `review_note` — used on **1** row). The two
`source_type='vendor_engagement'` rows are the only live instance of the shape
S4 actually needs.

What the generalization looks like: what the SOC arm names
`auditor_opinion` / `report_period_*` / `trust_services_criteria` is, in general,
**(independence, assertion window, asserted scope)**. Every evidence type has all
three. S4 should be built against that triple with a **SOC-specific resolver**,
so a later ISO or pen-test arm is a new resolver rather than a re-cut predicate.

Additional validity semantics each type would need — **not to be built now**:

| Type | Missing semantic | Existing idiom |
|---|---|---|
| Certification (ISO 27001 / 42001) | certificate term + Statement of Applicability scope | — |
| Penetration test | test window + declared scope | `pen_test_engagements.next_test_due` (table empty, 0 rows) |
| Policy | approval date + review cadence | `policies.next_review_at` (table empty, 0 rows) |
| Technical / configuration | observation age | `evidence.collected_at` (1 of 17 set) |
| Vendor attestation | reassessment cycle **and non-independence** | — |
| Contractual | effective term | — |

**Attestation must not equal audit.** S4 has one outcome (`confirm`). A
self-attestation reaching the same outcome as an audited SOC 2 is a fail-open.
Either attestation is excluded from S4, or S4 needs a weaker second depth — which
§2 #11 already flags as a separate design.

---

## 9. Minimum historical decision-basis package

Requirement: answer *"why did SecureLogic not ask requirement X during assessment
Y?"* with the evidence and decision state that existed then.

### Already reproducible — do not rebuild

- **`engagement_applicability`** (20261065, 322 rows live) — snapshots `basis`
  **by value** + `basis_hash` + `scope_rule_version` + `resolved_at`, with
  `requirement_id` ON DELETE RESTRICT and the reference id stored alongside.
  This is the ratified pattern and it already covers the *applicability* half.
- `vendor_engagement_scope_items.reasons` JSONB — by-value rule trace, written today.
- `vendor_assurance_cuecs.gap_basis` — snapshot-by-value precedent for a determination.
- `vendor_assurance_documents.assurance_opinion_note` — verbatim source text at
  acceptance. Designed correctly, unused.
- `canonical_control_crosswalk.mapping_version` + `superseded_at` — versioned,
  non-destructive.

### The smallest package: ONE table, cloning 20261065

`engagement_assurance_basis`:

| Column | Note |
|---|---|
| `organization_id`, `engagement_id` | tenant-first, as 20261065 |
| `requirement_id` (RESTRICT) + `requirement_reference_id` | reference data is mutable; store both |
| `decision` | `covered` \| `not_covered` — **both** recorded; "why we did NOT reduce depth" is the answer to the question being asked |
| `basis` JSONB + `basis_hash` (sha256) | **by value**: document_id, extraction_id, storage sha256, accepted opinion + acceptor + accepted_at, report period, `report_type`, TSC scope, `subservice_method`, exception set, crosswalk `(canonical_control_id, mapping_version)`, tenant control id, mapping id, contradiction ids |
| `assurance_rule_version` | the S4 resolver corpus version, distinct from `scope_rule_version` |
| `resolved_at`, `created_at` | |
| UNIQUE `(engagement_id, requirement_id, basis_hash)` | same idempotency shape as 20261065 |

That is **one migration and one writer**, reusing a shipped and populated
pattern, so it needs no new architecture decision.

This closes all four named unreproducible facts:

| Fact | Closed by |
|---|---|
| evidence version | document_id + extraction_id + storage **sha256**, by value. No versioning lifecycle is built — content identity already exists |
| accepted review state | accepted opinion + acceptor + accepted_at, by value |
| mapping used | crosswalk `(canonical_control_id, mapping_version)` + mapping id, by value |
| contradictions at decision time | contradicting analysis ids / open finding ids as of the decision |

### Deliberately excluded, each a separate package

- **`evidence.valid_from` / `valid_until`.** Not needed for *reproducibility* —
  the period is snapshotted by value. Needed for *validity evaluation at read
  time*. Different requirement; generic staleness is deferred by owner direction.
- **Revocation on `vendor_assurance_documents`.** Wiring-plan Finding B stands:
  no `revoked_at`, no `superseded_by`, no soft-delete, no DELETE route, and field
  overrides refused once `approved` — so eligibility once granted is permanent
  and unbounded. A basis record keeps a past decision *explicable* even after an
  approval should have been withdrawn, which is the reproducibility requirement.
  Revocation is a **correctness** requirement for the live predicate and must be
  resolved before wiring — but it is not part of the reproducibility package.

---

## 10. ADR-0012 — partially implement; do not resurrect 20261051–55

**Retain the principles. Implement a strict subset. Do not automatically
resurrect the authorized migration block.**

Those five slots were authorized 2026-08-22, before the crosswalk existed, before
20261065 shipped, and before 20261066's authority-CHECK pattern was ratified. Two
of ADR-0012's three legs are now redundant:

- **decision-basis snapshots** — shipped as `engagement_applicability`. Building
  a second one would be the second evidence architecture this package is
  forbidden to create.
- **immutable history** — `canonical_control_crosswalk.superseded_at` plus the
  published-row freeze triggers already implement it on the crosswalk arm.

What genuinely remains and is not covered: **`evidence.valid_from` /
`valid_until`** — still the right idea, still unbuilt, and required only when
generic evidence staleness is built. Evidence origin and links are largely
present already (`source_type`, `source_id`, `engagement_id`, `requirement_id`,
`sha256`).

**Take one column pair from ADR-0012 later; take nothing from it now.** The S4
basis table is not an ADR-0012 deliverable — it is an `engagement_applicability`
clone. **ADR-0012 should be amended** to record that its decision-basis leg was
superseded by 20261065's pattern, so it stops implying five owed migrations.

---

## 11. #925 — do not close; it now has 52 concrete instances

Measured: **52 applicability rows across 4 domains sit on engagements with ZERO
scope items in that domain** — the #925 shape, occurring today:

| Domain | Rule family | Engagements | Rows |
|---|---|---|---|
| `ai` | S5 | 4 | 32 |
| `privacy` | S5 | 1 | 17 |
| `nth_party` | S5 | 1 | 2 |
| `compliance` | S3 | 1 | 1 |

Decisively: this is happening with **zero governed assurance anywhere in the
estate**. S4 is unwired, `depth='confirm'` has never been written, and h5 is
empty. So **none of these 52 rows is assurance-covered — every one is
unexplained**, and by the owner's own definition each is an unresolved assurance
gap. The applicability record (#926) is doing exactly its job: it made the gap
visible instead of leaving silence.

The mirror finding: **`resilience` has 57 scope items across 19 engagements and
ZERO applicability rows.** Questions are being asked in a domain no applicability
rule ever fired for — the applicability record does not explain the questionnaire
it accompanies. More broadly, 35 engagements hold 1209 `security` scope items
with no applicability row at all.

**Is "applicable domain + zero questions + sufficient governed assurance"
achievable with the current corpus and model? No** — not for any engagement
today, and not for any engagement reachable from the current corpus, because the
maximum coverage set is empty and its ceiling (34 requirements) sits on an org
holding no assurance documents. **#925 stays open.**

---

## 12. Authority statement

Nothing in this package changed authority. Specifically NOT done:
`assuranceCoveredRequirementIds` not wired into composition; S4 suppresses and
reduces nothing; residual risk untouched; evidence authority unchanged; no second
evidence architecture; no promotion; no Blueprint sync; no questionnaire issued or
reissued; no scope mutated; zero writes of any kind.
