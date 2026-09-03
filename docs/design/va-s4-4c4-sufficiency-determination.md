# VA-S4-4C-4 — the governed sufficiency determination

Status: **BUILT 2026-08-31** against the owner rulings of the same day. Migration
`20261079` (plus `20261078` for the tenant classification). Not wired to S4.

Measured against `securelogic_staging` on 2026-08-31, at `develop` `81d1f35f`
(4C-3 merged and staging-verified 60/60). Every count below is a measurement,
not an estimate, and every one is labelled REAL or SYNTHETIC.

---

## The hop this closes

Ruling 5 states the coverage inference in full. Four of its nine hops are built:

```
approved assurance document              4C-0  (governed review at two grains)
  -> applicable report / TSC scope        —    THIS PACKAGE
  -> tested vendor control               4C-2  (element_key identity)
  -> test result / effectiveness state   4C-3  (Layers 1 and 2)
  -> exception / deviation state         4C-3  (Layer 3)
  -> control <-> requirement mapping     4C-1  (SOC 2 canonical crosswalk)
  -> CANDIDATE requirement coverage      4C-2  (resolutions)
  -> governed sufficiency determination   —    THIS PACKAGE
  -> assurance-covered requirement        —    step 5, NOT this package
```

4C-2 answers *which canonical control a tested control is*. 4C-3 answers *what
the auditor said, what SecureLogic governs, and what the exceptions mean*. 4C-4
answers the only question left before step 5: **does this assurance actually
support the objective this requirement represents?**

Ruling 6 is the constraint: a mapping is a candidate, never a conclusion. One
tested control resolving to eight crosswalk rows must not become eight covered
requirements. The determination is per **(requirement × tested control ×
document)** — the finest grain at which the question is answerable — and it is
a human act.

---

## The invariant this package exists to establish

> **A veto that cannot be computed is not a veto that passed.**

This is the whole design. Twelve vetoes are mandatory before a candidate may
become assurance-covered. If an unevaluable veto is silently omitted, the
predicate returns a *confident* answer built on a gap — the exact failure this
programme has hit repeatedly: a vacuous pass that reads as a considered
judgement. So every determination carries all twelve vetoes with an explicit
per-veto state, and three states are not two:

| State | Meaning |
|---|---|
| `PASSED` | evaluated, and it does not block |
| `FIRED` | evaluated, and it blocks |
| `NOT_EVALUABLE` | **could not be evaluated — the substrate does not exist** |

`NOT_EVALUABLE` is a first-class recorded value, never an absent row and never
folded into `PASSED`.

---

## Veto expressibility, MEASURED

Not one of these is assumed. Each was checked against the live staging schema
and corpus on 2026-08-31.

| # | Veto | Substrate | Verdict |
|---|---|---|---|
| 1 | report / TSC scope | `trust_services_criteria` | **COMPUTABLE, needs a normalizer** — see below |
| 2 | report period / validity | `report_period_start` / `_end` | **FACT computable, THRESHOLD absent** — see below |
| 3 | Type I vs Type II | `report_type` | **COMPUTABLE, needs a normalizer** — 3 surface forms measured |
| 4 | tested-control result | 4C-3 Layer 1 + Layer 2 | COMPUTABLE |
| 5 | control exception / deviation | 4C-3 Layer 3 + `vendor_assurance_exception_controls` | COMPUTABLE |
| 6 | carve-out / subservice | `subservice_method`, `subservice_organizations` | COMPUTABLE, case-variant |
| 7 | accepted auditor opinion | `vendor_assurance_documents.assurance_opinion` (20261066/70) | COMPUTABLE |
| 8 | contradictory evidence | `evidence_links` | **NOT EVALUABLE — the table does not exist** |
| 9 | relevant open findings | `findings.framework_control_id` → `control_canonical_identities` | **SHAPE EXISTS, POPULATION ZERO** — see below |
| 10 | mapping authority | `canonical_control_crosswalk.mapping_source` / `status` / `approved_by_user_id` | COMPUTABLE, but uniform today |
| 11 | human / governed acceptance | the determination row itself | BY CONSTRUCTION |
| 12 | historical decision basis | the basis snapshot | BY CONSTRUCTION |

**Seven computable, two by construction, one fact-without-a-threshold, one with
a shape but no population, and one with no substrate at all.**

### Veto 1 — the scope field is MIXED-GRAIN, and that is not a defect to flatten

`trust_services_criteria` on staging contains, across 17 extractions, both
grains at once:

```
A1.1  A1.2  CC6.1  CC6.2  CC6.3  CC6.4  CC7.2  CC8.1     <- criteria
Availability   Confidentiality   Security                 <- categories
```

A report scoped to `Security` covers `CC6.1` without ever naming it; a report
listing `CC6.1` explicitly does too. So the scope veto cannot be a set-membership
test on strings. It needs a two-grain normalizer: criterion match, or category
match via the criterion's own prefix (`CC*` → Security/Common Criteria, `A*` →
Availability, `C*` → Confidentiality, `PI*` → Processing Integrity, `P*` →
Privacy). Where neither grain resolves, the veto is `NOT_EVALUABLE` — it must
not default to in-scope.

### Veto 2 — the dates are clean, the POLICY does not exist

Every extraction in the corpus carries an ISO-parseable period, and all 17 carry
the same one: `2025-01-01` → `2025-12-31`. Today is 2026-08-31, so **every report
in the estate ended eight months ago.**

The fact is computable. The judgement is not: nothing in the platform says how
long a SOC 2 Type II report remains current. That is step 3 (evidence-validity
policy), which depends on step 2 (ADR-0012), and neither is built —
`evidence` has no `valid_from`, no `valid_until`, no `assurance_class`
(verified against `information_schema` today).

So veto 2 records the measured staleness in days as a fact, and its state is
`NOT_EVALUABLE` until a ratified policy exists. It must never read `PASSED`
because a date parsed successfully.

### Veto 3 — three surface forms, and Type I is real

```
SOC 2 Type 2   11        SOC 2 Type II   5        SOC 2 Type I   1
```

A Type I report is a statement about **design** at a point in time, never about
operating effectiveness over a period. It can never establish sufficiency for a
requirement that asks whether a control *operated*. The single Type I witness is
what makes this veto non-hypothetical, and the normalizer must treat
`Type 2` / `Type II` / `Type Ⅱ` as one value and `Type I` as another — the exact
string-variance trap 4C-3's Layer 1 normalizer already handles for assertions.

### Veto 6 — the "100% carve-out" note is now STALE

The 4C-3-era note that the corpus is 100% `Carve-out` was measured over 5
extractions. At 17 the distribution is: `null` 11, `Carve-out` 5, `carve-out` 1.
Two consequences: the veto must be case-insensitive, and a NULL subservice method
is the majority case, which means "we do not know whether work was carved out"
is the *normal* state and must be `NOT_EVALUABLE`, not `PASSED`. OWNER RULING
2026-08-31, stated generally: **missing or null carve-out / subservice-method
information is `NOT_EVALUABLE`, never `PASSED`.** Absence of a stated carve-out
is not evidence that none exists.

### Veto 10 — uniform today, so it must be enforced STRUCTURALLY

All 162 published crosswalk rows are `mapping_source = 'securelogic'`,
`status = 'published'`. A test that asserts "the authority veto passes" against
this corpus proves nothing, because no row could fail it. The veto must be
enforced by construction — an `ai_proposed` or `customer` or unpublished mapping
must be refused by the evaluator and asserted with a negative fixture, never
validated observationally.

### Veto 9 — the pivot is right, the column is empty, and that is a trap

`findings.framework_control_id` gives a finding a control dimension; that control
resolves to a canonical control through `control_canonical_identities.control_id`;
the candidate names the same canonical control. So "a live gap on the same
control" is answerable without inventing a link table, and it is the first
consumer of Step 1's identity table outside the crosswalk itself.

**But the column is TEXT, carries no foreign key, and is NULL on all 5,478
findings on staging.** Nothing populates it. A join on it therefore returns zero
for every candidate — and a zero read as `PASSED` would be a confident "no live
gap on this control" built on a column nothing writes. That is the vacuous pass
this whole package exists to prevent, and it would have shipped silently.

The rule, therefore: the veto is `NOT_EVALUABLE` unless at least one open finding
in the organisation actually carries the dimension. Zero-because-unpopulated and
zero-because-clean are different facts and must not share a state. Populating
`framework_control_id` is separate work and is not in this package.

---

## The two layers, and why the split is the same one 4C-3 made

### The veto evaluation — machine, versioned, no authority

A pure function over: the resolution row (4C-2), the three layers (4C-3), the
nine assurance-bearing fields of the extraction, the document's accepted opinion,
the crosswalk row's authority, and the org's open findings. It returns twelve
`(veto, state, reason, observed)` tuples and **no conclusion**. It carries an
`evaluator_version`, like `normalizer_version`, so a determination made under one
rule set stays explainable when the rules move (veto 12).

It never proposes SUFFICIENT. Same rule as `suggestEffectiveness`, same reason: a
candidate that passes twelve computable checks is still a statement about one
report's testing, and sufficiency is a statement SecureLogic makes on its own
authority.

### The sufficiency determination — human, named, fail-closed by absence

Three values, deliberately mirroring Layer 2:

| Value | Meaning |
|---|---|
| `SUFFICIENT` | this assurance supports this requirement's objective |
| `INSUFFICIENT` | it does not |
| `INDETERMINATE` | it cannot be concluded, with a reason |

Structural rules, all enforced in the schema rather than in prose:

1. **No default, no seeding, no materialization.** Absence of a row is absence of
   sufficiency. Nothing in the approval path writes one. (4C-3 Layer 2 precedent.)
2. **`SUFFICIENT` is refused while any veto is `FIRED`.** Not overridable. This
   is Ruling 6's "an exception must not be erased by a clean opinion", enforced.
3. **`SUFFICIENT` is refused while any veto is `NOT_EVALUABLE`.** OWNER RULING
   2026-08-31: hard refusal, **no human override of epistemic insufficiency**.
   A veto that could not be evaluated blocks exactly as a fired one does, and no
   column exists through which a reviewer could wave it past.
4. **A named human, or nothing.** `determined_by_user_id NOT NULL`, enforced by
   an INSERT-scoped trigger on the 20261071 pattern, because an API key
   establishes permission and never human authority.
5. **The basis is the full twelve-veto evaluation, snapshotted by value** into
   `basis JSONB NOT NULL`, so the determination stays explainable after the
   crosswalk, the corpus and the evaluator all move (veto 12).
6. **Idempotent by content, superseded by change** — 4C-3's rule, not 20261073's
   blanket supersession, because the row carries a human decision that a
   re-approval must not silently discard.
7. **Risk acceptance is a DIFFERENT layer and may not reach this one.** OWNER
   RULING 2026-08-31: human risk acceptance belongs at the later risk-decision
   layer and must never rewrite an `INDETERMINATE` assurance basis into
   `SUFFICIENT`. Accepting a risk is a statement that an organisation will
   tolerate a gap; it is not a statement that the gap was closed, and the two
   must not share a writer. Enforced structurally: nothing in the
   finding-risk-acceptance path (`finding_risk_acceptances`) may write, update
   or supersede a determination row, and an adversarial test asserts it.

---

## The consequence that must not be discovered later

With veto 8 permanently `NOT_EVALUABLE` and veto 2 `NOT_EVALUABLE` until step 3,
**rule 3 above means 4C-4 produces zero `SUFFICIENT` determinations on the day it
ships.** Every candidate resolves to `INDETERMINATE`.

OWNER RULING 2026-08-31: **this is acceptable and expected.** It is not a bug and
it is not a reason to weaken rule 3. It is the truthful state of the platform: SecureLogic cannot yet tell whether contradictory evidence
exists, or whether a report is still current, so it cannot honestly conclude that
assurance covers a requirement. What 4C-4 changes is that this becomes
**machine-readable and per-candidate**, instead of a paragraph in a design doc.

It also means, plainly: **4C-4 does not make S4 live.** Step 5 still needs steps
2 and 3. Anyone reading a green 4C-4 acceptance run must not conclude otherwise.

---

## What this package does NOT do

- **No S4 wiring.** No `assuranceCoveredRequirementIds` caller. Nothing reads
  these rows for coverage, questionnaire reduction, or residual risk.
- **No auto-determination.** Nothing writes a determination without a human.
- **No new extraction fields.** `PROMPT_VERSION` stays `soc-extraction-v3`.
- **No production activation.** `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` stays
  `false` on production.
- **No evidence work.** ADR-0012 is step 2 and is not started here.

Every API response and audit payload restates
`establishes_requirement_coverage: false`, as 4C-3's do.

---

## Known gaps, stated plainly

- **No reviewer UI**, for the determination or for 4C-3 Layer 2. The routes exist
  and are tested; the screens do not. 4C-4 is API-complete, not customer-operable.
- **h5 disjoint tenancy is UNCHANGED and now sharper.** Measured today: the org
  holding all 30 canonical control identities is `Enterprise Validation StageA`
  (`f70267ce`), which holds **zero** assurance documents; the orgs holding
  extractions are `Enterprise Validation 20260810` (`b1a3da2d`, 12, SYNTHETIC),
  `Staging Inc` (`fe2ede61`, 4) and `Standing Inc 3` (1). No org holds both
  halves, so an org-scoped end-to-end proof still requires a prepared corpus.
- **Only the synthetic org can resolve at all.** All 53 `Staging Inc` documents
  have `document_type_hint = NULL`; all 12 `Enterprise Validation 20260810`
  documents carry one. 20261073's framework gate therefore fires for the entire
  non-synthetic corpus, by design.
- **Layers 1–3 and resolutions are EMPTY on staging** — the 4C-3 harness cleans
  up its own fixtures. 4C-4's acceptance must build the whole chain itself.

---

## The tenant classification this package settles (20261078)

4C-3's acceptance check 41 left ten organisations `customer` that looked
synthetic but matched no in-tree convention. Owner ruling 2026-08-31: reclassify
only on **positive provenance**; name similarity is not sufficient.

Applying that standard, the marker is a reserved, unregistrable e-mail TLD
(RFC 2606 `.test` / `.invalid`), which every already-synthetic organisation in
the estate carries. **Exactly one of the ten has it**: `Onboarding Validation
20260809150033`, whose sole user is at `securelogicai.test`, never verified,
never logged in, with a script-generated timestamp name matching its `created_at`
to the second.

The other nine are left `customer`, including the three the name-based reading
would have swept up: `Staging Inc` (`fe2ede61`), `Standing Inc 3` and
`Enterprise Validation StageA` — all on real user accounts with live Stripe
subscriptions and recorded consents.

**Therefore the REAL / SYNTHETIC split recorded during 4C-1, 4C-2 and 4C-3 —
five real extractions against twelve synthetic — stands as recorded, and is not
downgraded.** An earlier reading of this session assumed the "Staging Inc" name
settled the question; the provenance standard settles it the other way, and the
historical measurement is preserved rather than rewritten.


---

## What was built

- **`20261078`** — the tenant classification decision, applied by explicit
  identity to the ONE organisation positive provenance established.
- **`20261079`** — `vendor_requirement_sufficiency_determinations`, with the
  owner ruling enforced as a CHECK rather than as route policy:

  | Constraint | What it makes impossible |
  |---|---|
  | `..._fail_closed_check` | `SUFFICIENT` whose own basis records a fired or not-evaluable veto |
  | `..._basis_completeness_check` | a determination recorded against fewer than twelve vetoes |
  | `..._no_coverage_claim_check` | a row that claims to establish requirement coverage |
  | `trg_..._require_human_determiner` | an unattributed determination, whatever the route does |

  There is deliberately **no override, waiver or force column**. The acceptance
  harness asserts its absence by scanning `information_schema`.

- **`src/api/lib/vendorAssurance/sufficiencyVetoes.ts`** — the ten computable
  vetoes, the two normalizers the corpus forced (report type, mixed-grain TSC
  scope), the determination vocabulary, `determinationPrecondition` and the
  basis builder. Versioned as `sufficiency-veto-1.0`.
- **`src/api/lib/vendorAssurance/sufficiencyCandidates.ts`** — candidate
  assembly, including the veto-9 substrate check.
- **Two routes**, same guard stack as 4C-3:
  `GET  /api/vendor-assurance/documents/:id/sufficiency-candidates`
  `POST /api/vendor-assurance/documents/:id/candidates/:resolutionId/sufficiency`
  (the write additionally carries `requireCapability("assurance:review")`,
  `requireHumanReviewer`, and the INSERT trigger beneath both).

### A defect the isolation suite caught before it shipped

Supersession was first written as `WITH superseded AS (UPDATE …) INSERT …`. Both
arms of a data-modifying CTE read the same snapshot, so the partial unique index
still saw the old live row and the insert died on a duplicate key — **a 500 on
every re-decision**. It is now two statements inside the transaction `asTenant`
already opens. The happy path had passed; only the second decision failed.

### Verification

- `src/api/__tests__/sufficiencyVetoes.test.ts` — 45 tests, all normalizer
  precedence traps and every three-state assertion.
- `test/isolation/sufficiencyDeterminationAuthority.test.ts` — 19 tests against a
  real Postgres, adversarial: direct-SQL writes for every CHECK, cross-tenant
  reads and writes, the API-key-is-not-a-human axis, and a source scan proving no
  risk-acceptance module can write the table.
- `scripts/validation/va-s4-4c4-sufficiency-determination-staging-acceptance.mjs`
  — 44 checks + corpus notes, including the counts-lie and NULL-dodge adversaries.
