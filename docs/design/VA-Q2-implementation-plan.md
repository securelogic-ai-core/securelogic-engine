# VA-Q2 — Fact registry and dynamic-scoping foundation: implementation plan

**Status:** PLANNED 2026-08-28 — **no code, no migrations, no commits.** P3 and P4 are HELD on owner decision D1 (§J); P1 and P2 may start. · **Governs:** ADR-0013 R2, R4 · **Design:** VA-Q0 §3, §4.2 (registry), §4.3, §5, §6.1–6.3, §9, §15, §16 (Q2 row), §17 (Q2 criteria)
**Baseline:** `develop` @ `5517caaf` (2026-08-28, post VA-Q1 P4 #903) · **Predecessor:** `docs/design/VA-Q1-implementation-plan.md` (COMPLETE 2026-08-28)
**Planning agent:** implementation-planner-agent. Evidence labels: **VERIFIED** (read in repo) · **INFERRED** · **RECOMMENDED** · **UNKNOWN**.

## Objective

Give the deterministic policy layer one typed surface of **declared facts** to
scope over, and make the six assessment domains — Security, Privacy, AI,
Resilience, Fourth/Nth party, Compliance/Regulatory — **first-class, rule-driven
activations** instead of side-effects of scope tags. After Q2:

- a closed, versioned **fact registry** (code) names every fact the resolver may
  read, its type, its allowed sources and its ranked vocabulary; a fact outside
  the registry cannot be stored or referenced;
- every scope item carries the **domain** it was activated under and the
  **S5 rule** that activated it, alongside today's S1–S4 reasons;
- facts are stored as a **canonical, org-scoped, subject-addressed record** the
  posture and assessment layers can reuse (§J D1), not a questionnaire-local
  blob; the 13 inherent inputs stay the store of record for inherent risk and
  are mirrored, as VA-Q0 §4.3 ratified;
- the internal intake can declare the facts beyond the 13 (`data.*`, `ai.*`,
  `nth.*`, `service.*`) through one validated route;
- VA-Q0 §17's two directive examples pass as golden tests, and the same facts
  produce the same `question_set_hash` across runs.

Q2 does **not** deliver branching (`question_conditions`, S6), evidence rules
(E1), `questionnaire_snapshots`, vendor-answer-sourced facts (no writer exists
until Q3), profiles (Q7), or any AI analysis (Q6). Q2 adds **no portal surface**
and **no unauthenticated route**, so VA-S1a (#878) is not a prerequisite.
Frozen-snapshot semantics from Q1 are preserved unchanged: `question_versions`
stay immutable, `question_set_hash` is stamped once at issue, `/integrity`
keeps working, and **no fact write is accepted against an issued engagement**.

## A. Authorization check (STOP conditions)

| Check | Result | Evidence |
|---|---|---|
| Package is the active VA-Q increment | **YES — VERIFIED** | VA-Q1 plan header: "Q2 (fact registry, S5 domain activation) is the next increment and needs its own plan"; VA-Q0 §16: Q2 depends on Q1 only, `+1` schema |
| Prerequisites satisfied (unblocked) | **YES — VERIFIED** | Q1 P1 #898, P2 #900, P3 #901 STAGING VERIFIED; P4 #903 merged (`f63dd32c`); 20261059/20261060 on develop; `ensureBridgeQuestions`, `questionSetHash`, `loadQuestionSetItems` live in `src/api/lib/questionnaire/bridgeQuestions.ts` |
| Explicit build authorization exists | **YES — VERIFIED (program-level)** | VA-Q0 header: "VA-Q program directive, 2026-08-28. VA-Q is an explicit product commitment"; VA-Q1 plan header: "Owner directive: proceed into implementation in small reviewable packages without a further conceptual approval cycle"; ADR-0013 RATIFIED 2026-08-28 |
| Governing docs consistent with the package | **DRIFT — non-blocking** | `BUILD_SEQUENCE.md` (last edited #853) and `docs/launch/SEPT15-LAUNCH-RECONCILIATION.md` name neither VA-Q nor ADR-0013 (grep: zero hits). The VA-Q program is governed by its own directive + Q0/Q1 docs. **Hand to program-manager-agent** for a BUILD_SEQUENCE doc-sync entry; do not block Q2 on it. |
| Owner decision required before ALL packages | **NO** | §J: D1 gates P3/P4 only; P1/P2 are schema-neutral to D1 |

**Verdict: authorized and unblocked. P1 may start. P3/P4 wait on D1.**

## B. Baseline (what exists, VERIFIED in code)

| Capability | Where | Q2 use |
|---|---|---|
| Scope resolver S1–S4, pure, `ScopeInclusionReason.rule_family: "S1"\|"S2"\|"S3"\|"S4"`, `CONTEXT_TRIGGERS` keyed off `InherentRiskInput` | `src/api/lib/vendorRisk/scopeResolver.ts` | extend with S5; widen `rule_family`; feed S2 from facts |
| The 13 inherent inputs (`InherentRiskInput`) + ranked vocabularies | `inherentRisk.ts` (`DATA_VOLUME_BANDS`, `AI_INVOLVEMENT_LEVELS` = none/embedded/core, `AI_AUTONOMY_LEVELS`, `HOSTING_MODELS`, `FOURTH_PARTY_LEVELS`, `CONCENTRATION_LEVELS`; sensitivity/access/criticality/regulatory) | become the `core.*` namespace, mirrored — never moved |
| `SCOPE_RULE_VERSION = "1.0.0"`, stamped on `vendor_engagements.scope_rule_version NOT NULL` at creation | `methodologyVersion.ts`; `20260919` | bump to `1.1.0`; S5 runs only for engagements stamped ≥ 1.1.0 (§F P1) |
| Scope route: reads the 13 columns, requirements of activated frameworks, ACTIVE obligation edges; delete-then-insert of `vendor_engagement_scope_items` inside `asTenant`; refuses when `!isScopeMutable(state)` → 409 `scope_frozen`; audit `vendor_engagement.scope_resolved` | `src/api/routes/vendorEngagements.ts:640–800` | the one composition entry point; facts are read here |
| Issue route stamps `question_set_hash` once; `/integrity` recomputes | `vendorEngagements.ts:860–900`, `:2151` | unchanged; Q2's determinism proof reuses it |
| `vendor_engagement_scope_items` (`requirement_id`, `depth`, `mandatory`, `source`, `reasons JSONB` rendered to the vendor, `question_version_id` from Q1) | `20260924`, `20261060` | gains `domain` (P2) |
| Requirement→domain bridge `domainForScopeTags` (tag table + precedence ai > privacy > nth_party > resilience; security floor) — "Q2 promotes this to a first-class, versioned rule" | `src/api/lib/questionnaire/questionContent.ts:243–262` | promoted into `vendorRisk/requirementDomain.ts` (P1) |
| Closed scope-tag vocabulary (20 tags); `requirements.scope_tags TEXT[]` has **no DB CHECK** on values; parity test replays the 20260926 heuristic SQL against `deriveScopeTags` | `requirementScopeTags.ts:46–75`; `20260926`; `test/isolation/requirementScopeTagsParity.test.ts` | extend vocabulary **curated-only** (no heuristic change → parity test untouched) |
| `questions.domain` CHECK (`security,privacy,ai,resilience,nth_party,compliance`) | `20261059` | the ONE domain vocabulary; reused verbatim for scope items and the registry |
| `ai_system_vendor_dependencies` (`dependency_role` incl. `model_provider`, `training_data`; `deleted_at`) | `20260505` | fact source `ai_system_dependency` |
| `vendors.data_sensitivity`, `vendors.access_level`, `vendors.criticality`, `vendors.template_metadata.flags {processes_pii, processes_phi, processes_payment_data, processes_ai_inference}` | `20260412`, `CANONICAL_DOMAIN_MODEL.md` §Key Relationships | fact source `vendor_profile` (defaults only; never authoritative over intake) |
| `obligations.jurisdiction`, `obligation_mappings` (S3) | `20260418`, `routes/obligations.ts` | `policy.obligations_active`, Compliance activation |
| Isolation harness, WORM-guard lint, grant lint, real-gate lint, classification test, premium-gate count | `test/isolation/testDb.ts`, `wormGuardConsolidation.test.ts`, `appRequestGrants.test.ts`, `src/api/__tests__/isolationSuitesUseRealGate.test.ts`, `dataClassification.test.ts`, `teamTierEntitlements.test.ts` | every new table/route must satisfy all of them |
| Rollback convention | `docs/release/ROLLBACK-20261059-20261061.sql` | `ROLLBACK-20261062-20261063.sql` ships with P2/P3 |

**Not present today (VERIFIED absent):** any fact table; any `domain` on scope
items or findings; any reading of `ai_system_vendor_dependencies` or
`vendors.template_metadata` by the scope route (grep: zero hits in
`vendorEngagements.ts` and `vendorRisk/*`); any migration ≥ `20261062` on any
of the 357 remote branches (`git ls-tree` sweep 2026-08-28).

## C. What Q2 changes for customers

- **Engagements created before Q2** (stamped `scope_rule_version = 1.0.0`):
  re-resolving scope produces exactly today's items and reasons. S5 does not
  run for them. Asserted by a golden equivalence test over the existing
  `vendorScopeResolver.test.ts` fixtures.
- **Engagements created after Q2** (`1.1.0`): S5 may add items (e.g.
  Resilience activates on `business_criticality ≥ high`, wider than
  `S2.resilience`) — each with its own `rule_id` in `reasons`. This is the
  intended product change and is what VA-Q0 §17 Q2 accepts.
- **Issued engagements:** untouched. `question_set_hash` cannot move; facts
  cannot be written; the portal renders the same versions.

## D. Dependency analysis

| Dependency | Needed by Q2? | State | Action |
|---|---|---|---|
| VA-Q1 P1–P4 | yes | merged, staging verified | none |
| ADR-0012 `evidence_links` (slots 51–55) | **no** | authorised, unbuilt | Q3 |
| VA-S1a #878 limiter | **no** (no unauthenticated surface) | held | Q3 |
| VA-C1/P1/D1 (slots 56–58) | no schema overlap (invites/participants) | held | none |
| ISO 42001 template | no | Q5 | none |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | yes — all Q2 routes ride it (ruled: VA curation lives on the frameworks spine; VA-6 memory: the helper fails OPEN off-production) | live | no new flag |
| CANONICAL_DOMAIN_MODEL amendment for a Fact object | **yes for P3/P4** | not done | **D1 (§J)** |

**Design decisions made in this plan (not owner-level):**
1. **S5 is version-gated, not flag-gated.** The engagement's stamped
   `scope_rule_version` selects the rule corpus, exactly as
   `methodologyVersion.ts` promises ("recompute reads the stamped values").
   Today the scope route ignores the stamp (VERIFIED: it always runs current
   code); Q2 makes the stamp load-bearing for S5. No new feature flag.
2. **No new columns on `vendor_engagements` for the new intake facts.** They go
   in the fact store with `source='intake'`. Adding twenty nullable columns
   would repeat the 20260927 shape for facts that are, by design, an open-ended
   registry.
3. **The fact store IS the issued snapshot's fact record.** Writes are refused
   once `!isScopeMutable(status)` (409 `scope_frozen`, the existing code) — so
   VA-Q0 §4.4's `fact_snapshot` (Q3) becomes a projection of rows that already
   cannot change, not a second copy.
4. **New scope tags are curated-only.** The nine starred tags in VA-Q0 §5 enter
   `SCOPE_TAG_VOCABULARY`; `deriveScopeTags` heuristics are **not** extended,
   so the 20260926 parity test stays true and no re-backfill is needed.
5. **Fact values are never rendered to the vendor.** `reasons` (rendered) carry
   S5 rationale text only; the fact route is internal-only.

## E. Migration slots — verified against the ledger 2026-08-28

Scan: `develop` tops at `20261061` (`email_sends_observability`); Q1 released
`20261062`/`20261063` from its reserve (Q1 COMPLETE, no defect follow-ups used
them); **nothing ≥ 20261062 on any of 357 remote branches.**

| Slot | File | Package | Kind |
|---|---|---|---|
| `20261062` | `scope_item_domain.sql` — `vendor_engagement_scope_items.domain TEXT NULL CHECK (domain IN (…six…))`; partial index `(engagement_id, domain)` | P2 | additive column |
| `20261063` | `assessment_facts.sql` — the fact store (shape per D1); RLS; grants; classification | P3 | new table — **HELD on D1** |
| `20261064` | held in reserve for Q2 defect follow-ups; released to Q3 if unused | — | — |

Q0 §16 budgeted `+1` for Q2; this plan uses two so P2 (column) and P3 (table)
stay separately reviewable and separately rollback-able. Rollback:
`docs/release/ROLLBACK-20261062-20261063.sql` (drop column; drop table). Both
are additive; a code rollback to the previous SHA is always sufficient because
the 1.0.0 resolver path remains intact throughout Q2.

## F. Implementation packages / PR boundaries

Each package = one PR, branch off `develop`, merged with `--merge` through the
protected process (trial merge → affected tests → fresh CI → true merge commit →
exact-head CI → staging deploy → behavioural check → VA-Q0 §18 matrix update).
Sizes: S ≤ 300 LoC net, M ≤ 800.

### P1 — Fact registry + S5 in the pure resolver (no schema) — **size M — MAY START**

**Goal.** The closed registry and the domain-activation rules exist as versioned
code and are proven pure, before anything is stored.

**Files.**
- `src/api/lib/vendorRisk/factRegistry.ts` (new): `FACT_REGISTRY` — closed
  record of VA-Q0 §6.1 keys → `{ type: 'bool'|'enum'|'enum[]'|'string[]'|'ranked', values?, ranked?, sources: FactSource[] }`;
  `FACT_SOURCES = ['intake','vendor_profile','ai_system_dependency','vendor_answer','profile_default','derived']`;
  `SOURCE_PRECEDENCE` (vendor_answer > intake > ai_system_dependency > vendor_profile > profile_default);
  `validateFact(key, value, source)` → typed error with field names;
  `FACT_REGISTRY_VERSION` folded into `SCOPE_RULE_VERSION`. `core.*` entries
  reference `inherentRisk.ts` vocabularies — never a second copy.
- `src/api/lib/vendorRisk/factResolver.ts` (new): `resolveFacts(rows) → FactSet`
  applying precedence; `factsFromInherent(input: InherentRiskInput) → core.* rows (source='intake')` — the mirror, pure.
- `src/api/lib/vendorRisk/requirementDomain.ts` (new): `domainForRequirement(req, reachedViaObligation)`
  — `domainForScopeTags` moved here (questionContent.ts re-exports it, no behaviour change), plus `compliance` when reached via S3.
- `src/api/lib/vendorRisk/scopeResolver.ts`: `ScopeResolverInput` gains
  `facts: FactSet` and `scopeRuleVersion: string`; `rule_family` union gains
  `"S5"`; `DOMAIN_ACTIVATION` table per VA-Q0 §6.3 with one `rule_id` per
  activation clause (`S5.privacy.personal_data`, `S5.ai.dependency`, …); S5
  runs only when `scopeRuleVersion >= 1.1.0`; S2 triggers read `core.*` facts
  through `FactSet` (identical predicates); the `include()` accumulator stamps
  `domain` on each item (first-activating domain; further domains as reasons).
  **`exclude` is not an S5 effect: S5 only ever adds** (ADR-0013 R4; the
  "never activates when" column is documentation of the rule's negation, not
  an exclusion pass).
- `src/api/lib/vendorRisk/methodologyVersion.ts`: `SCOPE_RULE_VERSION = "1.1.0"`.
- `src/api/lib/questionnaire/questionContent.ts`: re-export only.

**Pattern to copy.** `CONTEXT_TRIGGERS` (rule shape) and `SCOPE_TAG_VOCABULARY`
(closed vocabulary + `areValid…` guard).

**Tests (unit, `src/api/__tests__/`).**
- `factRegistry.test.ts`: every key has a type and ≥1 source; ranked enums are
  total orders; `validateFact` rejects unregistered key / wrong type / source not
  allowed for key (e.g. `policy.*` never from `vendor_answer`) with field names.
- `factResolver.test.ts`: precedence table-driven; `factsFromInherent` is a
  bijection over the 13 inputs; a `vendor_answer` row can only raise a ranked
  value's effective rank (widen), never lower it below an `intake` value —
  asserted now even though no writer exists.
- `vendorScopeResolver.test.ts` (extend): **1.0.0 golden equivalence** — every
  existing fixture with `scopeRuleVersion='1.0.0'` yields byte-identical
  `items`/`reasons`/`excluded`/`truncated`; **directive example 1** (LLM + PII:
  `ai.uses_ai`, `ai.third_party_models`, `ai.customer_data_in_prompts`,
  `data.personal_data`) → Security + Privacy + AI + Nth party with four distinct
  S5 `rule_id`s; **example 2** (`access_level=none`, `data.personal_data=false`,
  `ai.uses_ai=false`, tier 4) → Security `attest` only, ≤ 15 items; same facts →
  identical ordered item list across 100 runs; `compliance` domain only via S3.
- `requirementDomain.test.ts`: precedence and floor as today, plus compliance.

**Security/tenant gate.** None new (pure code). `reasons` rationale strings are
vendor-visible: a test asserts no S5 rationale interpolates a fact *value*.

**Customer-visible change:** none until a route passes facts (P3). The scope
route in P1 passes `facts = factsFromInherent(row)` and the engagement's stamped
version, so pre-Q2 engagements are unchanged and new ones gain S5 over the 13
facts only.

### P2 — Domain first-class on scope items (slot 20261062) — **size S — MAY START after P1**

**Goal.** Every scope item records the domain it was asked under; the reviewer
surface and the engagement read can group by it.

**Files.** `db/migrations/20261062_scope_item_domain.sql`;
`vendorEngagements.ts` scope route writes `domain` from the resolver; `GET
/vendor-engagements/:id` adds `domains: {security: n, privacy: n, …}` and
`domain` per item (additive fields); `requirementScopeTags.ts` vocabulary +9
curated tags (`vulnerability-management`, `secure-development`,
`data-subject-rights`, `cross-border`, `lawful-basis`, `breach-notification`,
`training-data`, `model-provider`, `automated-decision`);
`requirementDomain.ts` tag→domain table extended per VA-Q0 §5;
`dataClassification.ts` specialHandling note on `vendor_engagement_scope_items`
mentions `domain`; `docs/release/ROLLBACK-20261062-20261063.sql` (first half);
app: engagement detail groups items by domain (read-only, `app/src/app/vendor-engagements/[id]`; INFERRED path — verify at P2 start).

**Migration.** `ADD COLUMN IF NOT EXISTS domain TEXT NULL CHECK (domain IS NULL OR domain IN (…))`.
NULL on every pre-Q2 row; **no backfill** — a domain nobody computed at the
time is a fabricated history (the Q1 P3 amendment principle). Historical
engagements report `domains: null`.

**Tests.** Isolation: `questionnaireVersionAddressing.test.ts` extended — new
scope items carry a non-NULL domain in the closed set; cross-org read → 404
unchanged; `GET /:id` JSON-only (415 on multipart). Unit: parity test still
green (curated-only tags); `areValidScopeTags` accepts the nine.

**Security/tenant gate.** Column inherits the table's RLS/grants (no new
policy). `appRequestGrants.test.ts` unchanged. Findings are **not** stamped —
see D2.

### P3 — Fact store + internal intake route (slot 20261063) — **size M — HELD on D1**

**Goal.** Facts persist as a canonical, org-scoped, subject-addressed record;
the scope route reads the full fact set with precedence; the 13 inputs,
vendor-profile defaults and AI-system dependencies are mirrored in.

**Files.** `db/migrations/20261063_assessment_facts.sql` (shape per D1 —
recommended shape below); `src/api/lib/vendorRisk/factStore.ts` (new:
`upsertFacts`, `loadFactRows(subject)`, `mirrorInherentFacts`,
`mirrorVendorProfileFacts`, `mirrorAiDependencyFacts` — all take a `Queryable`
and `organizationId`, copy `bridgeQuestions.ts`'s signature style);
`vendorEngagements.ts`: `GET /vendor-engagements/:id/facts` (resolved set +
rows with source), `PUT /vendor-engagements/:id/facts` (bulk, `source='intake'`
forced server-side, body validated by `validateFact`, 409 `scope_frozen` when
issued, audit `vendor_engagement.facts_declared` with keys only — never
values); scope route: mirror → load → `resolveFacts` → resolver;
`dataClassification.ts` entry; `teamTierEntitlements.test.ts` gate count +2;
rollback SQL second half.

**Recommended table (D1 option B).**
```
assessment_facts
  id UUID PK, organization_id UUID NOT NULL → organizations,
  subject_type TEXT NOT NULL CHECK (subject_type IN ('vendor_engagement')),   -- widened by later packages, never by Q2
  subject_id  UUID NOT NULL,
  fact_key    TEXT NOT NULL CHECK (fact_key ~ '^[a-z]+(\.[a-z_]+)+$'),
  value       JSONB NOT NULL,
  source      TEXT NOT NULL CHECK (source IN (six sources)),
  source_ref  UUID NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  captured_by_user_id UUID NULL → users ON DELETE SET NULL,
  UNIQUE (organization_id, subject_type, subject_id, fact_key, source)
```
RLS in the standard shape; `GRANT SELECT, INSERT, UPDATE, DELETE TO app_request`
(UPDATE is needed for the upsert; the *issued* freeze is a code guard + test,
not a trigger — a trigger would need a status join and there is no sibling
pattern for that). Registry membership is enforced in code (`validateFact`),
asserted by test; the DB checks only key shape, mirroring the Q1 content-hash
split. No FK from `subject_id` (polymorphic, same as `evidence.source_id`);
the engagement's same-org existence is a pre-flight `SELECT 1 … WHERE id=$1 AND organization_id=$2`.

**Mirror rules (deterministic, idempotent, run at every scope resolve while mutable).**
- 13 columns → `core.*`, `source='intake'`.
- `vendors.template_metadata.flags.processes_pii|processes_phi` → `data.personal_data=true` (`vendor_profile`); `processes_ai_inference` → `ai.uses_ai=true` (`vendor_profile`). Absent flags write nothing (never `false` from silence).
- `ai_system_vendor_dependencies` (active rows for this vendor): any → `ai.uses_ai=true`; role `model_provider` → `ai.third_party_models=true`; role `training_data` → `ai.trains_on_customer_data` is **NOT** inferred (a dependency role is not a declaration; VA-Q0 §8 wants that from intake/answer). `source='ai_system_dependency'`, `source_ref` = dependency row.

**Tests.** Isolation (`test/isolation/assessmentFacts.test.ts`, through
`createApp()` per the real-gate lint): RLS proof; org-B engagement id → 404 on
both routes; portal cookie → 401; member/contributor → 403 on PUT
(`denyContributor` as `questions.ts:42`); unregistered key / bad type → 400
with field names; `source` in body ignored (always `intake`); PUT after issue →
409 and `question_set_hash` unchanged; double mirror → identical row count;
vendor B's `ai_system_vendor_dependencies` never produce facts for vendor A;
`assessment_facts` in `dataClassification` (category C, piiRisk medium —
values may describe data subjects/jurisdictions, never a person); grants lint;
WORM lint (no private trigger). Unit: mirror functions table-driven.

### P4 — Directive golden proof, S2-from-facts, staging proof, matrix (no schema) — **size S — HELD on D1**

- Domain-aware S2 triggers reading non-core facts (VA-Q0 §6.2 "S2 reads facts"):
  `S2.ai_prompts` (`ai.customer_data_in_prompts` → privacy + ai tags),
  `S2.cross_border` (`data.cross_border` → `cross-border`, `data-protection`),
  `S2.subprocessors` (`nth.subprocessors_declared` → supply-chain, subprocessor).
- End-to-end golden test on real Postgres: declare directive example 1 via PUT,
  resolve, issue → four domains in `domains`, four S5 rule_ids, `integrity =
  match`; re-resolve a *copy* engagement with the same facts → identical
  `question_set_hash`.
- Equivalence script `scripts/validation/va-q2-scope-equivalence.ts`
  (sibling of `va-q1-bridge-equivalence.ts`): for every pre-Q2, pre-issue
  engagement on the target DB, resolve under 1.0.0 and compare to stored items
  — byte-equal.
- VA-Q0 §18 rows D-SEC, D-PRIV, D-RES, D-NTH, D-COMP, DS, I(S5) → IMPLEMENTED →
  TESTED; staging step moves them to STAGING VERIFIED. `CURRENT_STATE_ARCHITECTURE.md`
  and the enterprise-architect skill `domain-model.md` gain the Fact row (with D1's wording).

## G. Security / test matrix (acceptance criteria → proof)

| Required guarantee | Package | Proof |
|---|---|---|
| Fact registry is closed and versioned | P1 | unregistered key rejected in code (unit) and at the route (400, P3); `SCOPE_RULE_VERSION` bump |
| Deterministic scoping stays authoritative (ADR-0013 R2) | P1 | S5 is a pure table; no I/O in the resolver (import lint: `scopeResolver.ts` imports nothing from `infra/`) |
| Vendor-sourced facts never narrow scope (R4) | P1, P3 | `exclude` absent from S5 effects (type-level); precedence test: `vendor_answer` cannot lower a ranked `intake` value; no vendor-answer writer exists in Q2 (grep-asserted in P3's test) |
| Issued snapshots never shrink or move | P3 | PUT facts after issue → 409; hash unchanged; existing Q1 edit-after-issue golden still green |
| Pre-Q2 engagements unchanged | P1, P4 | 1.0.0 golden equivalence (unit) + equivalence script on harness and staging |
| Directive examples 1 and 2 | P1 (unit), P4 (E2E) | four distinct S5 rule_ids; ≤ 15 attest items |
| Same facts → same hash across runs | P1, P4 | 100-run unit loop; two-engagement E2E |
| Domain on every new scope item, closed vocabulary | P2 | DB CHECK + isolation assertion |
| Tenant isolation on the fact store | P3 | RLS proof; cross-org 404; vendor-B dependency never leaks into vendor-A facts |
| Object-level authorisation | P3 | portal cookie → 401; contributor → 403; org-B id → 404 |
| No fact values in logs/audit/vendor-visible text (T-13) | P1, P3 | audit payload carries keys only (test inspects `security_audit_log` row); rationale-interpolation test |
| Grants, WORM, real-gate, classification, premium-count lints | P2, P3 | the five existing lints stay green with the new table/routes registered |
| Safe, idempotent mirror | P3 | double-run row count; `ON CONFLICT … DO UPDATE` only when `captured_at` advances |
| Rollback / recovery | P2, P3 | `ROLLBACK-20261062-20261063.sql` rehearsed on the harness DB after P3's suites populate it; forward re-apply exit 0 |
| Existing VA E2E green | every | the eleven VA isolation suites (list in §B) in every PR's CI |

## H. Staging acceptance procedure (per package, after deploy)

1. Confirm engine + app live on the exact merged head (`/api/version`, Render deploy record).
2. **P1:** on an engagement created *before* the deploy (`scope_rule_version =
   1.0.0`), re-resolve → item count and reasons identical to the pre-deploy
   record; create a new engagement (stamp `1.1.0`), same intake → S5 reasons
   present; `GET /:id` shows `scope_rule_version` per engagement.
3. **P2:** new engagement → every item has `domain`; `domains` counts sum to
   item count; the pre-Q2 engagement reports `domains: null`; app detail groups by domain.
4. **P3:** `PUT /facts` with directive example 1 on a draft engagement → 200;
   resolve → four domains; issue → `integrity = match`; `PUT /facts` again →
   409 `scope_frozen`; `GET /facts` on `[SEED] Walkthrough Org`'s engagement
   from a second org's key → 404; portal cookie → 401.
5. **P4:** run `va-q2-scope-equivalence.ts` read-only against staging → 0
   diverged; re-run the 29-step VA walkthrough on a fresh engagement (internal
   + portal) → all PASS; update VA-Q0 §18 rows to STAGING VERIFIED with SHA + date.

Testers on the current product are not paused: P1/P2 are invisible for
existing engagements by proof; P3/P4 add internal-only routes.

## I. Blocking issues

- **D1 (§J) blocks P3 and P4.** P1 and P2 do not touch the fact table and are
  correct under every D1 option.
- **BUILD_SEQUENCE.md drift** (§A): non-blocking; program-manager-agent to
  record VA-Q0/Q1/Q2 as a dated entry. Not for this agent to edit.
- **UNKNOWN, verify at P2 start:** the app engagement-detail path and whether
  `findings` promotion (`findingPromotion.ts`, `promote-findings` route) sets a
  `domain` at all — grep found no `domain` in `findingPromotion.ts`; if it
  writes the canonical `'Vendor Risk'`, D2's option (a) is confirmed correct.

## J. Decisions required from owner

### D1 — A Fact is a new canonical domain object; its home and shape (BLOCKS P3, P4)

`CANONICAL_DOMAIN_MODEL.md` has no Fact object and its Amendment Protocol
says "define it in this document first". VA-Q0 §4.3 ratified an
**engagement-keyed** `engagement_facts (engagement_id, fact_key, value, source, …)`.
The Q2 directive asks for facts as a **platform object reusable by posture and
assessments**, not a questionnaire-local structure. Those two are in tension
only on the table's key, not its semantics.

| Option | Shape | For | Against |
|---|---|---|---|
| **A** — as ratified | `engagement_facts` keyed by `engagement_id` | matches Q0 text exactly; simplest FK | questionnaire-local; a later vendor- or AI-system-level fact needs a second table or a rename migration |
| **B — RECOMMENDED** | `assessment_facts` keyed by `(subject_type, subject_id)`, Q2 writes only `subject_type='vendor_engagement'`; registry, sources and precedence identical to Q0 §6.1 | same semantics as A; one table for vendor / AI-system / org facts later (`ai_system` governance intake, org profile) without a migration; matches the `evidence.source_type/source_id` and `findings.source_type/source_id` polymorphic convention already in the canon | polymorphic id (no FK) — same trade the canon already accepted for evidence/findings; the `subject_type` CHECK is widened by a later migration |
| **C** — defer | ship A now, revisit at Q7 | no decision today | guarantees a rename or a parallel object later — the exact drift the canon forbids |

**Recommendation: B.** Amend `CANONICAL_DOMAIN_MODEL.md` with a "Fact" row
(table `assessment_facts`, routes in P3, package VA-Q2) and add the closed
`source` vocabulary under Canonical Enums. VA-Q0 §4.3 is then read as "the
engagement subject of the fact store" — a naming clarification, not a
semantic change, and no ADR-0013 ruling is affected.

### D2 — Domain stamping on promoted findings (does NOT block P1–P3)

VA-Q0 §16 lists "domain stamped on scope items **and promoted findings**" for
Q2. `findings.domain` uses the canonical enum (`Access Management`, `Vendor
Risk`, `AI Governance`, `Regulatory`, `Vulnerability`, `Resilience`,
`General`), which has no `security`/`privacy`/`nth_party`/`compliance` and is
the vocabulary posture domain scores aggregate over.

| Option | For | Against |
|---|---|---|
| **(a) — RECOMMENDED** stamp scope items only; a finding's assessment domain is **derived at read** through `findings.requirement_id` / the engagement's scope item (the supersede-on-pass precedent: derived, no stored marker) | no canonical change; no lossy mapping; nothing fabricated | the finding row alone does not say its assessment domain |
| (b) add `findings.assessment_domain TEXT NULL` | queryable | second domain vocabulary on the canonical Finding — a canon amendment and a posture-aggregation question |
| (c) map assessment domain → canonical `Domain` | one vocabulary | lossy (security→?; compliance→Regulatory conflates) |

**Recommendation: (a) for Q2**, and treat any stored finding-level domain as a
Q7/posture-package decision. P2 proceeds under (a).

### Summary for the owner

- **No decision is needed to start P1 or P2.**
- **D1 must be ruled before P3 begins** (recommended B, with the canon amendment).
- **D2 defaults to (a)** unless the owner objects.
