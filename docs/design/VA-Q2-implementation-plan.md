# VA-Q2 — Fact registry and dynamic-scoping foundation: implementation plan

**Status:** PLANNED 2026-08-28 — **no code, no migrations, no commits.** **D1 RULED 2026-08-28 = Option B; D2 RULED = (a) scope items only** (§J). No package is HELD. Sequence: **P1 → P2 → P3 → P4**, each merged and STAGING VERIFIED before the next starts. Amended 2026-08-28 (D1/D2 ruling; canon amended in the same PR). · **Governs:** ADR-0013 R2, R4 · **Design:** VA-Q0 §3, §4.2 (registry), §4.3, §5, §6.1–6.3, §9, §15, §16 (Q2 row), §17 (Q2 criteria)
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
- facts are stored as a **canonical polymorphic fact record** — `assessment_facts`
  keyed by `subject_type + subject_id` under a CLOSED subject allowlist (§J D1,
  Option B) — that the posture, monitoring and assessment layers reuse, not a
  questionnaire-local blob; the 13 inherent inputs stay the store of record for inherent risk and
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
| Owner decision required before ALL packages | **NO — and D1/D2 are now RULED** | §J: D1 = Option B (2026-08-28), D2 = (a). Nothing gates P3/P4 except P2's completion |

**Verdict: authorized and unblocked. P1 may start; P2, P3, P4 follow strictly in that order.**

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
| CANONICAL_DOMAIN_MODEL amendment for a Fact object | **yes for P3/P4** | **DONE in this doc PR** (Assessment Fact object, Fact Subject Type / Fact Source / Fact Status enums, Key Relationship line, Locked Decision "VA-Q2 D1 — Option B (2026-08-28)") | none |

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
3. **The fact store IS the issued snapshot's fact record.** Q2's writers
   (`intake`, `internal_user`, the mirrors) are refused once
   `!isScopeMutable(status)` (409 `scope_frozen`, the existing code) — so
   VA-Q0 §4.4's `fact_snapshot` (Q3) becomes a projection of rows that already
   cannot change, not a second copy. Per the D1 ruling, the *only* future
   writer against an issued subject is Q3's `vendor_response` path, and it is
   widen/append-only (P3 *Authority rules*).
4. **New scope tags are curated-only.** The nine starred tags in VA-Q0 §5 enter
   `SCOPE_TAG_VOCABULARY`; `deriveScopeTags` heuristics are **not** extended,
   so the 20260926 parity test stays true and no re-backfill is needed.
5. **Fact values are never rendered to the vendor.** `reasons` (rendered) carry
   S5 rationale text only; the fact route is internal-only.

## E. Migration slots — verified against the ledger 2026-08-28

Scan: `develop` tops at `20261061` (`email_sends_observability`); Q1 released
`20261062`/`20261063` from its reserve (Q1 COMPLETE, no defect follow-ups used
them); **nothing ≥ 20261062 on any of 357 remote branches.**
**Re-checked 2026-08-28 (D1 amendment, `origin/develop` @ `2c104dfe`):** `db/migrations`
still tops at `20261061`; `git ls-remote` shows **no branch name claiming
`2026106x`** (the only VA-Q2 branch is `docs/vaq2-plan-and-b4-package`, docs-only).
Slots 20261062 (P2) and 20261063 (P3) stand. **The P2 and P3 builders must
repeat this check on the day they create the file.**

| Slot | File | Package | Kind |
|---|---|---|---|
| `20261062` | `scope_item_domain.sql` — `vendor_engagement_scope_items.domain TEXT NULL CHECK (domain IN (…six…))`; partial index `(engagement_id, domain)` | P2 | additive column |
| `20261063` | `assessment_facts.sql` — the canonical polymorphic fact store (D1 Option B: closed `subject_type` allowlist, subject-check trigger, RLS, `SELECT/INSERT/UPDATE` grants, classification) | P3 | new table — **UNBLOCKED** |
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

### P1 — Fact registry + S5 in the pure resolver (no schema) — **size M — IMPLEMENTED + TESTED 2026-08-28** (branch `feat/va-q2-p1-fact-registry-s5`, D1 = Option B: registry and resolver are subject-addressed; `factResolver.ts` carries the mirror; the scope route honours the STAMPED `scope_rule_version`; `src/api/__tests__/fixtures/scopeResolver-1.0.0.golden.json` freezes 21 pre-Q2 cases)

**Goal.** The closed registry and the domain-activation rules exist as versioned
code and are proven pure, before anything is stored.

**Files.**
- `src/api/lib/vendorRisk/factRegistry.ts` (new): `FACT_REGISTRY` — closed
  record of VA-Q0 §6.1 keys → `{ type: 'bool'|'enum'|'enum[]'|'string[]'|'ranked', values?, ranked?, sources: FactSource[] }`;
  `FACT_ORIGINS = ['intake','vendor_profile','ai_system_dependency','vendor_answer','profile_default','derived']`
  (VA-Q0 §6.1's vocabulary — the `origin` column after D1) and
  `FACT_SOURCES = ['intake','vendor_response','ai_extraction','internal_user','system_derived']`
  (the trust class — the `source` column; §J conflict 2) with `ALLOWED_SOURCE_ORIGIN_PAIRS`;
  `ORIGIN_PRECEDENCE` (vendor_answer > intake > ai_system_dependency > vendor_profile > profile_default);
  `validateFact(key, value, source, origin)` → typed error with field names;
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

### P2 — Domain first-class on scope items (slot 20261062) — **size S — IMPLEMENTED + TESTED 2026-08-28** (branch `feat/va-q2-p2-scope-item-domain`, stacked on P1; ledger re-checked the day the file was created: `db/migrations` topped at `20261061`, no remote branch and no commit on any branch claimed `2026106[2-9]`; rollback in `docs/release/ROLLBACK-20261062.sql` — the P2 half of the combined file §E names)

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

### P3 — `assessment_facts` canonical fact store + internal intake route (slot 20261063) — **size M — UNBLOCKED by D1 (Option B, 2026-08-28); starts after P2**

**Goal.** Facts persist as a **canonical polymorphic fact record** — a fact
about a canonical *subject* (`subject_type + subject_id`), owned by one
organization, with source, provenance, timing, confidence and status carried
on the row — so the same object later serves Security, Privacy, AI,
Fourth/Nth-party, reassessment, continuous-monitoring and future
service/product/AI-system contexts **without a second table**. Q2 writes
exactly one subject type (`vendor_engagement`). This is **not** an
unconstrained generic polymorphic table: the subject-type set is a closed
allowlist enforced in the DB *and* in code, and every write and read resolves
the subject inside the tenant scope.

**Files.** `db/migrations/20261063_assessment_facts.sql`;
`src/api/lib/vendorRisk/factSubjects.ts` (new: `FACT_SUBJECT_TYPES`,
`SUBJECT_RESOLVERS` — see *Integrity mechanism*);
`src/api/lib/vendorRisk/factStore.ts` (new: `writeFacts`, `loadFactRows`,
`mirrorInherentFacts`, `mirrorVendorProfileFacts`, `mirrorAiDependencyFacts` —
all take a `Queryable`, `organizationId` and a resolved `FactSubject`; copy
`bridgeQuestions.ts`'s signature style);
`vendorEngagements.ts`: `GET /vendor-engagements/:id/facts` (resolved set +
rows with source/origin/status/provenance — **never** cross-subject),
`PUT /vendor-engagements/:id/facts` (bulk; `source='intake'` and
`subject_type='vendor_engagement'` forced server-side; body validated by
`validateFact`; 409 `scope_frozen` when the engagement is issued; audit
`vendor_engagement.facts_declared` with keys only — never values);
scope route: mirror → load → `resolveFacts` → resolver;
`dataClassification.ts` entry; `teamTierEntitlements.test.ts` gate count +2;
`docs/release/ROLLBACK-20261062-20261063.sql` second half.

**Schema (D1 Option B — final sketch).**
```
assessment_facts
  id              UUID PK DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  subject_type    TEXT NOT NULL CHECK (subject_type IN ('vendor_engagement')),
                  -- CLOSED allowlist. Widened ONLY by a later migration that also ships
                  -- the subject's resolver + tests. RESERVED, NOT accepted by Q2:
                  -- 'vendor', 'ai_system', 'asset', 'organization'.
  subject_id      UUID NOT NULL,           -- polymorphic; integrity via trigger + resolver (below)
  fact_key        TEXT NOT NULL CHECK (fact_key ~ '^[a-z]+(\.[a-z_]+)+$'),
                  -- registry membership + type enforced in code (validateFact); DB checks shape only
  value           JSONB NOT NULL,
  value_hash      TEXT NOT NULL,           -- sha256 of canonical JSON (RFC 8785-style key sort; same canonicaliser as question_set_hash)
  source          TEXT NOT NULL CHECK (source IN ('intake','vendor_response','ai_extraction','internal_user','system_derived')),
                  -- TRUST CLASS (who asserted it). Q2 writers emit intake + system_derived only.
  origin          TEXT NOT NULL CHECK (origin IN ('intake','vendor_profile','ai_system_dependency','vendor_answer','profile_default','derived')),
                  -- MECHANISM (VA-Q0 §6.1 vocabulary, unchanged) — the key precedence ranks over.
                  -- CHECK on allowed (source, origin) pairs — see the pair table below.
  provenance      JSONB NOT NULL,          -- { actor: {kind:'user'|'system'|'vendor_participant'|'model', id}, via: route|job|worker name,
                                           --   at: ISO-8601, evidence: {table, id} | null, model: {model_id,prompt_version,input_hash} | null }
  observed_at     TIMESTAMPTZ NOT NULL,    -- when the fact was true/observed (caller-supplied, validated ≤ now())
  verified_at     TIMESTAMPTZ NULL,        -- set ONLY by internal verification (intake / internal_user); never by vendor or model
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.000 CHECK (confidence >= 0 AND confidence <= 1),
                  -- intake/internal_user default 1.000; system_derived mirrors 1.000; ai_extraction carries the model's; vendor_response 1.000 (asserted, not verified — authority comes from source+verified_at, not confidence)
  status          TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('proposed','accepted','superseded','rejected')),
                  -- ai_extraction rows are born 'proposed' and can reach 'accepted' ONLY through the governed human-accept boundary
  supersedes_id   UUID NULL REFERENCES assessment_facts(id),   -- same org, same subject, same fact_key (trigger-checked)
  created_by      UUID NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()

  -- Idempotency / dedup: one row per distinct assertion. Re-ingesting the same value from the
  -- same source+origin for the same subject is a no-op (ON CONFLICT DO NOTHING; row count unchanged).
  UNIQUE (organization_id, subject_type, subject_id, fact_key, value_hash, source, origin)
  -- Justification vs the owner's key: `origin` is added so that two system_derived mirrors of the
  -- same value (vendor_profile AND ai_system_dependency both saying ai.uses_ai=true) keep separate
  -- provenance rows instead of silently collapsing into one; without it the second mirror's
  -- provenance is lost. It is the only addition.

  -- At most one ACCEPTED current value per (subject, fact_key, source, origin); history is the
  -- superseded chain, never an UPDATE of value.
  UNIQUE (organization_id, subject_type, subject_id, fact_key, source, origin) WHERE status = 'accepted'

  INDEX (organization_id, subject_type, subject_id)                 -- subject lookup (the resolver's read)
  INDEX (organization_id, fact_key)                                 -- cross-subject fact query (posture/monitoring)
  INDEX (organization_id, subject_type, subject_id, fact_key) WHERE status = 'accepted'   -- hot path
```
Allowed `(source, origin)` pairs (DB CHECK, mirrored by `validateFact`):
`intake→intake` · `internal_user→intake` (a reviewer's later declaration through the same route) ·
`system_derived→{vendor_profile, ai_system_dependency, profile_default, derived}` ·
`vendor_response→vendor_answer` (Q3 writer; **no Q2 writer** — grep-asserted) ·
`ai_extraction→derived` (Q6 writer; **no Q2 writer** — grep-asserted).
Precedence (unchanged from VA-Q0 §6.1) ranks over `origin`:
`vendor_answer > intake > ai_system_dependency > vendor_profile > profile_default`;
`derived` participates only when `status='accepted'` **and** `source<>'ai_extraction'`
or the row has passed the human-accept boundary (which is what `accepted` means for it).

**Value semantics.** `value` is never UPDATEd. A new value for the same
`(subject, fact_key, source, origin)` inserts a new `accepted` row with
`supersedes_id` → the prior row, and the prior row's `status` flips to
`superseded` in the same transaction (the only UPDATE the trigger permits on a
non-`proposed` row, alongside `verified_at` and `updated_at`). Nothing is
deleted: `app_request` gets **`GRANT SELECT, INSERT, UPDATE`** — **no DELETE**
(no private DELETE trigger either, so the WORM-consolidation lint — which
inspects only `(DELETE|TRUNCATE)` trigger definitions — is untouched; the
BEFORE UPDATE state-machine trigger follows the `finding_risk_acceptances_enforce_worm`
precedent that the lint deliberately does not absorb).

**Integrity mechanism (chosen; polymorphic refs carry no FK).** Three layers,
each independently tested, all three required:
1. **RLS on `assessment_facts` by `organization_id`** — the standard
   `USING/WITH CHECK (organization_id = current_setting('app.current_org_id'))`
   shape; `FORCE ROW LEVEL SECURITY`. Test: `assessmentFactsRls` in
   `test/isolation/assessmentFacts.test.ts` (org-A session sees zero org-B rows;
   an INSERT carrying org B under an org-A session is refused by WITH CHECK).
2. **Trigger `assessment_facts_check_subject()` BEFORE INSERT OR UPDATE OF
   subject_type, subject_id, organization_id** — `CASE NEW.subject_type WHEN
   'vendor_engagement' THEN PERFORM 1 FROM vendor_engagements WHERE id =
   NEW.subject_id AND organization_id = NEW.organization_id; … ELSE RAISE`
   (unknown type, defence in depth behind the CHECK); `IF NOT FOUND THEN RAISE
   EXCEPTION USING ERRCODE = '23503', MESSAGE = 'assessment_facts: subject does
   not exist in this organization'`. It also asserts `supersedes_id`, when set,
   names a row with the same `(organization_id, subject_type, subject_id,
   fact_key)`. The trigger runs as the invoker, so under RLS an org-B
   engagement is simply *not found* — the same answer as non-existence, which is
   the answer we want (no oracle). Adding a subject type = adding a `WHEN` arm
   in the same migration that widens the CHECK. Test: direct SQL as
   `app_request` with a fabricated `subject_id`, an org-B `subject_id`, and a
   `subject_type` outside the allowlist → SQLSTATE `23503` / `23514` and zero rows.
3. **Code resolver `SUBJECT_RESOLVERS[subject_type](q, organizationId, subjectId)`
   (`factSubjects.ts`)** — runs *inside* `asTenant(organizationId)`, loads the
   subject row, compares `row.organization_id === organizationId` (belt-and-
   braces over RLS), and returns the typed subject (`{kind:'vendor_engagement',
   id, state, vendor_id}`) — which is also where `isScopeMutable(state)` is
   evaluated for the frozen-scope guard. Every route and every mirror obtains
   its subject **only** through this function; a fact write API that accepts a
   raw `subject_id` does not exist. Missing/other-org subject → the route's
   existing 404 shape (never 403 — no existence oracle). Test: unit
   (`factSubjects.test.ts`: org mismatch → `null` even when the row is loaded)
   + isolation (org-B engagement id → 404 on GET and PUT, and **zero rows
   written** — asserted by count, not by status code alone).

Nothing here changes the answer to "can a caller supply org A + a subject of
org B and succeed on create/read/update?" — it is **no** at each of the three
layers, and the matrix in §G.1 has one named test per layer.

**Mirror rules (deterministic, idempotent, run at every scope resolve while mutable).**
- 13 columns → `core.*`, `source='intake'`, `origin='intake'`, `provenance.via='scope_resolve:mirror'`,
  `observed_at` = the engagement's `updated_at`, `verified_at` = same (internal
  intake **is** verification), `confidence=1`.
- `vendors.template_metadata.flags.processes_pii|processes_phi` → `data.personal_data=true`
  (`system_derived`/`vendor_profile`); `processes_ai_inference` → `ai.uses_ai=true`.
  Absent flags write nothing (never `false` from silence). `verified_at` NULL
  (a profile flag is a default, not a verification).
- `ai_system_vendor_dependencies` (active rows for **this engagement's vendor**,
  loaded under the same tenant scope): any → `ai.uses_ai=true`; role
  `model_provider` → `ai.third_party_models=true`; role `training_data` →
  `ai.trains_on_customer_data` is **NOT** inferred (a dependency role is not a
  declaration; VA-Q0 §8 wants that from intake/answer). `source='system_derived'`,
  `origin='ai_system_dependency'`, `provenance.evidence={table:'ai_system_vendor_dependencies', id}`.
- Re-running a mirror with unchanged inputs inserts nothing (idempotency key).
  A changed input inserts a superseding row; the old one becomes `superseded`.

**Authority rules (Q0 rulings preserved; written into code as tests).**
- **Vendor-sourced facts are never authoritative truth.** `source='vendor_response'`
  rows can never carry `verified_at`; a resolver reading them may only
  *widen* scope (S5/S2 have no `exclude` effect — type-level, P1). Provenance
  and source are always distinguishable on the row and in `GET /facts`.
- **Issued assessment: widen but never narrow.** While an engagement is
  issued, Q2's writers (`intake`, `internal_user`, mirrors) are refused with
  409 `scope_frozen` — the issued snapshot cannot move in either direction from
  this package. Q3's `vendor_response` writer is the *only* path that may add
  facts to an issued subject, and it may only **append** (follow-ups, ADR-0013
  R3) — never trigger re-composition. This supersedes the wording of design
  decision 3 (§D) only in that the freeze is now stated per source; the Q2
  behaviour is unchanged.
- **Narrowing only via the ratified reassessment mechanism.** A narrower scope
  exists only on a *new* engagement (`parent_engagement_id` set — a new
  `subject_id`), composed fresh by the deterministic engine from facts with
  `verified_at NOT NULL` and `source IN ('intake','internal_user')` (VA-Q0 §6.1
  clarification / ADR-0013 R4). An unconfirmed `vendor_response` or any
  `ai_extraction` row can never be the fact that narrows.
- **AI-derived information never becomes authoritative without the human-accept
  boundary.** `ai_extraction` rows are inserted `proposed`; the resolver ignores
  `proposed` rows; the only transition to `accepted` is the existing governed
  accept path (`accepted_at` by a human — the `snapshot_items.added_by='ai_suggested'`
  pattern, VA-Q0 §11). The trigger refuses `status='accepted'` on INSERT when
  `source='ai_extraction'`. No Q2 writer emits `ai_extraction`; the rule ships
  now so it cannot be forgotten by Q6.

**Tests.** Isolation (`test/isolation/assessmentFacts.test.ts`, through
`createApp()` per the real-gate lint): the §G.1 adversarial matrix (one
named `it` per row); RLS proof; portal cookie → 401; member/contributor → 403
on PUT (`denyContributor` as `questions.ts:42`); unregistered key / bad type /
disallowed `(source, origin)` → 400 with field names; `source`, `subject_type`,
`subject_id`, `status`, `verified_at` in the body are **ignored** (forced
server-side; asserted by reading the row back); PUT after issue → 409 and
`question_set_hash` unchanged; double mirror → identical row count; vendor B's
`ai_system_vendor_dependencies` never produce facts for vendor A's engagement;
`assessment_facts` in `dataClassification` (category C, piiRisk medium —
values may describe data subjects/jurisdictions, never a person); grants lint
(no DELETE); WORM lint unchanged; audit row carries keys only. Unit: mirror
functions table-driven; `factSubjects.test.ts`; canonical `value_hash` stable
across key order.

### P4 — Directive golden proof, S2-from-facts, adversarial E2E, staging proof, matrix (no schema) — **size S — UNBLOCKED by D1; starts after P3**

- Domain-aware S2 triggers reading non-core facts (VA-Q0 §6.2 "S2 reads facts"):
  `S2.ai_prompts` (`ai.customer_data_in_prompts` → privacy + ai tags),
  `S2.cross_border` (`data.cross_border` → `cross-border`, `data-protection`),
  `S2.subprocessors` (`nth.subprocessors_declared` → supply-chain, subprocessor).
  S2 reads only `status='accepted'` rows through `FactSet`.
- End-to-end golden test on real Postgres: declare directive example 1 via PUT,
  resolve, issue → four domains in `domains`, four S5 rule_ids, `integrity =
  match`; re-resolve a *copy* engagement with the same facts → identical
  `question_set_hash`.
- **Historical / reassessment E2E** (`test/isolation/assessmentFactsReassessment.test.ts`):
  issue engagement E1 with facts F; (a) any Q2 write against E1 → 409, hash
  unchanged, E1's fact rows untouched; (b) create E2 with `parent_engagement_id=E1`
  and a *verified* narrower fact set → E2's scope is narrower and E1's is not;
  (c) create E3 from E1 with an *unverified* (simulated `vendor_response`,
  inserted directly in the test as `app_request`) narrower fact → E3 is **not**
  narrower (the row is ignored for narrowing); (d) E1's `GET /facts` still
  returns the rows it was issued with, including `superseded` history.
- **AI-authority E2E**: a row inserted with `source='ai_extraction'` and
  `status='accepted'` is refused by the trigger; the same row as `proposed`
  never changes a resolve result; after the governed accept it does.
- Equivalence script `scripts/validation/va-q2-scope-equivalence.ts`
  (sibling of `va-q1-bridge-equivalence.ts`): for every pre-Q2, pre-issue
  engagement on the target DB, resolve under 1.0.0 and compare to stored items
  — byte-equal.
- VA-Q0 §18 rows D-SEC, D-PRIV, D-RES, D-NTH, D-COMP, DS, I(S5) → IMPLEMENTED →
  TESTED; staging step moves them to STAGING VERIFIED. `CURRENT_STATE_ARCHITECTURE.md`
  and the enterprise-architect skill `domain-model.md` gain the Assessment Fact
  row (Option B wording, from `CANONICAL_DOMAIN_MODEL.md`).

## G. Security / test matrix (acceptance criteria → proof)

| Required guarantee | Package | Proof |
|---|---|---|
| Fact registry is closed and versioned | P1 | unregistered key rejected in code (unit) and at the route (400, P3); `SCOPE_RULE_VERSION` bump — **P1 TESTED**: `factRegistry.test.ts` (unknown key / malformed key / wrong type / disallowed source / AI source for every key / reserved subject types not writable; `SCOPE_RULE_VERSION` = 1.1.0) |
| Deterministic scoping stays authoritative (ADR-0013 R2) | P1 | S5 is a pure table; no I/O in the resolver (import lint: `scopeResolver.ts` imports nothing from `infra/`) — **P1 TESTED**: `vendorScopeResolver.test.ts` "the resolver stays pure" (four modules: no infra/routes/db import, no `async`) |
| Vendor-sourced facts never narrow scope (R4) | P1, P3 | `exclude` absent from S5 effects (type-level); precedence test: `vendor_answer` cannot lower a ranked `intake` value; no vendor-answer writer exists in Q2 (grep-asserted in P3's test) — **P1 TESTED**: `DomainActivationRule` has no exclude field (shape-asserted); `factResolver.test.ts` widen-only for ranked / bool / list / enum against EVERY internal source; `verifiedOnly` reassessment view may narrow; resolver-level "vendor answer widens, never narrows" |
| Issued snapshots never shrink or move | P3 | PUT facts after issue → 409; hash unchanged; existing Q1 edit-after-issue golden still green |
| Pre-Q2 engagements unchanged | P1, P4 | 1.0.0 golden equivalence (unit) + equivalence script on harness and staging — **P1 TESTED**: 21 golden cases byte-identical under `scopeRuleVersion: "1.0.0"` (no `domain`, no S5); malformed stamp never runs S5; route passes the stamped version |
| Directive examples 1 and 2 | P1 (unit), P4 (E2E) | four distinct S5 rule_ids; ≤ 15 attest items — **P1 TESTED**: ex. 1 → Security+Privacy+AI+Nth, `S5.security.baseline` / `S5.privacy.personal_data` / `S5.ai.declared` / `S5.nth.third_party_models`; ex. 2 → security attest only, ≤ 15, identical to 1.0.0 |
| Same facts → same hash across runs | P1, P4 | 100-run unit loop; two-engagement E2E — **P1 TESTED**: 100 runs with shuffled fact rows → one byte string; ordered item list independent of requirement input order |
| Domain on every new scope item, closed vocabulary | P2 | DB CHECK + isolation assertion — **P2 TESTED**: `test/isolation/scopeItemDomain.test.ts` (every 1.1.0 item non-NULL in the closed set; `domains` sums to the item count on `GET /:id` and `/responses`; 1.0.0 re-resolve writes NULL and reports `domains: null`; bogus value → `23514`; CHECK list == `ASSESSMENT_DOMAINS` read from `pg_constraint`; migration applied twice = no-op; issued → 409 + `verdict: match`; org-B 404 + zero rows under org-B RLS session); unit: `vendorScopeResolver.test.ts` (1.1.0 stamps every item, compliance iff S3; 1.0.0 has no `domain` key), `requirementDomain.test.ts` (nine-tag table, `summarizeDomains`), `requirementScopeTags.test.ts` (nine tags curated-only, never heuristic; S5's `DOMAIN_TAGS` counted as a consumer) |
| Tenant isolation on the fact store | P3 | RLS proof; cross-org 404; vendor-B dependency never leaks into vendor-A facts; §G.1 A1–A3 |
| Object-level authorisation | P3 | portal cookie → 401; contributor → 403; org-B id → 404; §G.1 A4 |
| Closed subject-type allowlist (D1) | P3 | DB CHECK + code enum lockstep test (`FACT_SUBJECT_TYPES` equals the CHECK list, read from `pg_constraint`); RESERVED types refused; §G.1 A5 |
| Subject exists and belongs to the same org on every write/read (D1) | P3 | trigger + resolver + RLS — three named tests, §G.1 A1–A3, A6, A7 |
| Fact type/value validated against the registry on every write | P1, P3 | `validateFact` at the route (400 with field names); `(source, origin)` pair CHECK; §G.1 A8 |
| Provenance, source, observed/verified timing, confidence, status preserved | P3 | row read-back test: every column round-trips; server-forced fields cannot be set by the body |
| Dedup / idempotency | P3 | unique idempotency key; double PUT / double mirror / concurrent PUT → unchanged count; §G.1 A9 |
| Vendor facts never authoritative; AI never authoritative without human accept (Q0 rulings) | P3, P4 | `verified_at` unsettable by vendor/model; `ai_extraction` born `proposed`, trigger refuses `accepted` on insert; §G.1 A11, A12 |
| Issued: widen-only; narrowing only by governed reassessment | P3, P4 | 409 on Q2 writers after issue; child-engagement narrowing only on verified facts; §G.1 A11, A13 |
| Tenant+subject+fact lookup paths indexed | P3 | `EXPLAIN` assertion in the isolation suite: the subject read and the `fact_key` read both use the named indexes (no seq scan) |
| Traceability | every | §G.1 status column + VA-Q0 §18 rows updated in every PR; no increment COMPLETE before STAGING VERIFIED |
| No fact values in logs/audit/vendor-visible text (T-13) | P1, P3 | audit payload carries keys only (test inspects `security_audit_log` row); rationale-interpolation test; §G.1 A15 — **P1 TESTED**: every S5 rationale is a static string; no registry vocabulary value appears in any rationale; distinctive fact values absent from every reason |
| Grants, WORM, real-gate, classification, premium-count lints | P2, P3 | the five existing lints stay green with the new table/routes registered — **P2 TESTED**: `appRequestGrants.test.ts` + `dataClassification.test.ts` green; no new table, policy or grant (the column inherits 20260924's) |
| Safe, idempotent mirror | P3 | double-run row count; `ON CONFLICT … DO UPDATE` only when `captured_at` advances |
| Rollback / recovery | P2, P3 | `ROLLBACK-20261062-20261063.sql` rehearsed on the harness DB after P3's suites populate it; forward re-apply exit 0 — **P2 TESTED** (forward half): 20261062 re-applied on a populated harness DB = no-op (`scopeItemDomain.test.ts`); `ROLLBACK-20261062.sql` written, rehearsal owed with P3's combined file |
| Existing VA E2E green | every | the eleven VA isolation suites (list in §B) in every PR's CI |

### G.1 Adversarial matrix for the fact store (owner-required minimum; one named test per row)

Every row is an `it(...)` whose name is the **Case** column verbatim, in the
file named. A row is **TESTED** only when the test exists and is green in the
PR's exact-head CI; **STAGING VERIFIED** only after §H step 4 runs against
the deployed head. No increment is COMPLETE until every row of its package is
STAGING VERIFIED.

| # | Case | Attack / input | Expected | Layer proven | Test file | Pkg | Status |
|---|---|---|---|---|---|---|---|
| A1 | cross-tenant subject substitution | org-A key, `PUT /vendor-engagements/{org-B engagement}/facts` | 404; **zero** `assessment_facts` rows for either org (count) | resolver + RLS | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A2 | cross-tenant subject substitution (DB layer) | direct `INSERT` as `app_request` under org-A session with `organization_id=A`, `subject_id`=org-B engagement | SQLSTATE `23503`, zero rows | trigger | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A3 | cross-tenant subject substitution (RLS layer) | direct `INSERT` under org-A session with `organization_id=B`, `subject_id`=org-B engagement | RLS WITH CHECK refusal, zero rows | RLS | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A4 | unauthorized subject access | portal cookie → GET/PUT; contributor seat → PUT; member of org A → GET on org-B id | 401 / 403 / 404 respectively; no row | route auth | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A5 | invalid subject type | direct `INSERT` with `subject_type='vendor'` (RESERVED) and with `'bogus'`; body `subject_type` on PUT | `23514` (CHECK) / trigger ELSE arm; PUT ignores the field | CHECK + trigger + route | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A6 | nonexistent subject | random UUID on PUT/GET; direct INSERT with random `subject_id` | 404 / `23503`; zero rows | resolver + trigger | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A7 | mismatched org/subject | `withTenant(A)` writing `organization_id=A` for a subject that belongs to B *after* a same-transaction update moved nothing (the trigger re-checks on UPDATE OF subject/org columns) | `23503`; row unchanged | trigger (UPDATE arm) | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A8 | malformed fact type/value | unregistered key; `core.data_volume='huge'`; `ai.uses_ai='yes'`; key with SQL/`..`/uppercase; 2 MB value; disallowed `(source, origin)` pair | 400 with field names; DB CHECK on shape; zero rows | registry + CHECK | `test/isolation/assessmentFacts.test.ts` + `src/api/__tests__/factRegistry.test.ts` | P1, P3 | PLANNED |
| A9 | duplicate fact ingestion | same PUT body twice; same mirror twice; concurrent double PUT (two clients) | row count unchanged after the second; no `superseded` churn | idempotency key | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A10 | conflicting provenance | `vendor_profile` says `ai.uses_ai=true`, `ai_system_dependency` says `true`, intake says `false` | three rows, three provenances retained; resolved value follows §6.1 precedence (intake); `GET /facts` shows all three with `source`/`origin` | precedence + key | `src/api/__tests__/factResolver.test.ts` + isolation | P1, P3 | PLANNED |
| A11 | vendor attempt to narrow issued scope | after issue: simulated `vendor_response` row (`data.personal_data=false` over intake `true`), then resolve/integrity | scope unchanged; `question_set_hash` unchanged; `integrity=match`; no `exclude` effect exists in S5 | resolver types + freeze | `test/isolation/assessmentFactsReassessment.test.ts` (P4) + `vendorScopeResolver.test.ts` (P1) | P1, P4 | PLANNED |
| A12 | AI-originated fact attempting authoritative mutation | INSERT `source='ai_extraction', status='accepted'`; INSERT `proposed` then resolve; UPDATE `proposed→accepted` outside the accept path | trigger refusal; `proposed` ignored by resolver; UPDATE refused unless via the governed accept (asserted by provenance actor kind) | trigger + resolver | `test/isolation/assessmentFactsReassessment.test.ts` | P4 | PLANNED |
| A13 | historical / reassessment behaviour | issued E1; child E2 with verified narrower facts; child E3 with unverified narrower fact | E1 immutable; E2 narrower; E3 not narrower; E1 history readable incl. `superseded` | reassessment rule | `test/isolation/assessmentFactsReassessment.test.ts` | P4 | PLANNED |
| A14 | identifier manipulation (Q1 class, carried) | `subject_id` in body ≠ path id; `supersedes_id` pointing at another subject/org | ignored / `23503` | route + trigger | `test/isolation/assessmentFacts.test.ts` | P3 | PLANNED |
| A15 | fact values never leak | audit row, error bodies, S5 `reasons` text | keys only; no value string appears | T-13 | `test/isolation/assessmentFacts.test.ts` + P1 rationale test | P1, P3 | PLANNED |

## H. Staging acceptance procedure (per package, after deploy)

1. Confirm engine + app live on the exact merged head (`/api/version`, Render deploy record).
2. **P1:** on an engagement created *before* the deploy (`scope_rule_version =
   1.0.0`), re-resolve → item count and reasons identical to the pre-deploy
   record; create a new engagement (stamp `1.1.0`), same intake → S5 reasons
   present; `GET /:id` shows `scope_rule_version` per engagement.
3. **P2:** new engagement → every item has `domain`; `domains` counts sum to
   item count; the pre-Q2 engagement reports `domains: null`; app detail groups by domain.
4. **P3:** `PUT /facts` with directive example 1 on a draft engagement → 200;
   `GET /facts` shows every row with `source`, `origin`, `status`, `provenance`,
   `observed_at`, `verified_at`; re-send the same PUT → 200 and the row count
   (from `GET /facts`) is unchanged; change one value → the old row reads
   `superseded`, the new one `accepted` with `supersedes_id`; resolve → four
   domains; issue → `integrity = match`; `PUT /facts` again → 409
   `scope_frozen`; `GET /facts` on `[SEED] Walkthrough Org`'s engagement from a
   second org's key → 404 (and `PUT` from that key → 404 with no row, checked
   via the owning org's `GET`); portal cookie → 401; contributor seat → 403;
   a `PUT` naming `subject_type: 'vendor'` or a foreign `subject_id` in the
   body → 200 with the fields ignored (row reads back as `vendor_engagement` /
   the path id). Via `render jobs create`: direct `INSERT` as `app_request`
   with an org-B `subject_id` → `23503`. Mark §G.1 rows A1–A10, A14, A15
   STAGING VERIFIED with SHA + date.
5. **P4:** run `va-q2-scope-equivalence.ts` read-only against staging → 0
   diverged; re-run the 29-step VA walkthrough on a fresh engagement (internal
   + portal) → all PASS; reissue the walkthrough engagement with a verified
   narrower fact set → child is narrower, parent's `integrity = match`; update
   VA-Q0 §18 rows and §G.1 rows A11–A13 to STAGING VERIFIED with SHA + date.

Testers on the current product are not paused: P1/P2 are invisible for
existing engagements by proof; P3/P4 add internal-only routes.

## I. Blocking issues

- **None owner-level.** D1 and D2 are ruled (§J). P3 waits only on P2's
  STAGING VERIFIED; P4 on P3's.
- **BUILD_SEQUENCE.md drift** (§A): non-blocking; program-manager-agent to
  record VA-Q0/Q1/Q2 as a dated entry. Not for this agent to edit.
- **UNKNOWN, verify at P2 start:** the app engagement-detail path and whether
  `findings` promotion (`findingPromotion.ts`, `promote-findings` route) sets a
  `domain` at all — grep found no `domain` in `findingPromotion.ts`; if it
  writes the canonical `'Vendor Risk'`, D2's option (a) is confirmed correct.

## J. Decisions required from owner

### RULINGS (owner, 2026-08-28)

**D1 = OPTION B.** `assessment_facts` becomes a **canonical polymorphic fact
model** with an explicit `subject_type + subject_id` relationship.
*Owner rationale:* facts are broader than one engagement; they must represent
facts about canonical subjects over time — Security, Privacy, AI, Fourth/Nth
party, reassessment, continuous monitoring, and future service / product /
AI-system contexts. It is **not** an unconstrained generic polymorphic table.

Owner's security/integrity requirements, binding on P3/P4 (each is a §G / §G.1 row):
- **CLOSED allowlist** of subject types for Q2 — no arbitrary strings; DB CHECK
  **and** code enum, lockstep-tested. Q2 allowlist: `vendor_engagement`
  (writer). **RESERVED, not accepted by any Q2 writer or the CHECK:** `vendor`,
  `ai_system`, `asset`, `organization` — each enters only with its own
  migration, resolver arm and tests.
- Every fact write/read: establish org/tenant ownership; verify the referenced
  subject exists; verify the subject belongs to the same organization; enforce
  object-level authorization; prevent cross-tenant subject substitution;
  validate fact type/value against the fact registry; preserve provenance +
  source; preserve observed/verified timing; preserve confidence/status
  semantics; enforce dedup/idempotency; index tenant+subject+fact lookup paths.
- Polymorphic refs get no FK integrity across tables: the integrity mechanism
  is **documented and tested** — chosen: per-subject-type resolver loading the
  subject inside the tenant RLS scope and comparing `organization_id` **+**
  trigger-based existence/org check on INSERT/UPDATE **+** RLS on
  `assessment_facts` by `organization_id` (P3 *Integrity mechanism*).
- No caller may supply org A + a subject of org B and succeed on create, read
  or update.
- Fact authority: Q0 rulings preserved; vendor-sourced facts are NOT
  authoritative truth; provenance/source distinguishable; during an ISSUED
  assessment vendor facts may WIDEN scope but NOT narrow; narrowing only via
  the ratified deterministic/governed reassessment mechanism; AI-derived
  information never becomes authoritative without the existing governed
  human-accept boundary (P3 *Authority rules*).
- Required adversarial coverage (minimum): cross-tenant subject substitution;
  unauthorized subject access; invalid subject type; nonexistent subject;
  mismatched org/subject; malformed fact type/value; duplicate fact ingestion;
  conflicting provenance; vendor attempt to narrow issued scope; AI-originated
  fact attempting authoritative mutation; historical/reassessment behaviour
  (§G.1, one named test each).
- Traceability matrix maintained (§G.1 + VA-Q0 §18); **no increment COMPLETE
  until staging verification passes.**
- Migration: before using `20261062` re-check the current ledger (§E — done
  for this amendment; repeated by each builder).

**D2 = STAMP SCOPE ITEMS ONLY.** No finding-domain expansion in Q2 (option (a)
below). A finding's assessment domain stays derived at read.

**Conflicts with VA-Q0 that Option B resolves — stated, not papered over:**
1. **Table name and key.** Q0 §4.3 ratified `engagement_facts` keyed by
   `engagement_id` with `UNIQUE (engagement_id, fact_key, source)`. Option B
   replaces it with `assessment_facts (subject_type, subject_id)` and the
   idempotency key in P3. Q0 §4.3, §13 (Q2 line) and §16 (Q2 row) should be
   read as naming `assessment_facts` with `subject_type='vendor_engagement'`;
   the Q0 text is **not** rewritten by this PR (design-doc history), and
   ADR-0013 is unaffected (none of R1–R6 names the table).
2. **Source vocabulary.** Q0 §4.3/§6.1 define six *mechanism* sources
   (`intake, vendor_profile, ai_system_dependency, vendor_answer,
   profile_default, derived`) and rank precedence over them. The owner's
   ruling names five *trust-class* sources (`intake, vendor_response,
   ai_extraction, internal_user, system_derived`). These are different axes, and
   collapsing Q0's six into the owner's five would lose the precedence order
   (three of Q0's sources would all become `system_derived`). P3 therefore
   keeps **both**: `source` (owner's trust class — authority rules) and
   `origin` (Q0's mechanism — precedence), with a CHECK on allowed pairs. This
   is a plan-level reconciliation; the owner may veto it, in which case Q0
   §6.1's precedence must be re-ratified over the five-value set.
3. **"Value per source" → "value history per source."** Q0's UNIQUE implied
   overwrite-in-place. Option B (owner: "facts about subjects over time")
   makes values immutable with a `supersedes_id` chain and `status`; the
   resolver reads `accepted` rows only. Q0's resolver semantics are unchanged.
4. **Design decision 3 wording** ("no fact write is accepted against an
   issued engagement") is narrowed to Q2's writers; Q3's `vendor_response`
   append path is the ruled widen-only exception (§D, P3 *Authority rules*).

---

### D1 (as originally posed) — A Fact is a new canonical domain object; its home and shape — **RULED: B**

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

### D2 (as originally posed) — Domain stamping on promoted findings — **RULED: (a)**

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

### Summary

- D1 = B and D2 = (a) are ruled (2026-08-28). No open owner decision remains in Q2.
- One plan-level reconciliation is flagged for veto: the `source` + `origin`
  split (conflict 2 above).
