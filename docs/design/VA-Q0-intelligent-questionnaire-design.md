# VA-Q0 — SecureLogic Intelligent Questionnaire System: Design Package

**Status:** DESIGNED · **ADR-0013 RATIFIED 2026-08-28** (with one clarification on ruling 4, folded into §6.1 and §9). Nothing in this document is built unless §1 or §18 says so.
**Date:** 2026-08-28 · **Baseline:** `develop` @ `e773b6a8` (post VA-E2E-1)
**Directive:** VA-Q program directive, 2026-08-28. VA-Q is an explicit product
commitment; this package is its first deliverable.
**Scope of this document:** architecture, data model, policy model, security
boundaries, testing model, delivery plan. **No implementation. No migrations
applied. No questionnaire content authored.**

---

## 0. The one-paragraph thesis

Today Vendor Assurance asks the vendor the *framework requirement*, verbatim.
That is why a tier-1 questionnaire is "every activated requirement" and why a
SOC 2 activation produced 36 questions written for an auditor, not a vendor.
VA-Q separates three things the current code conflates: **what we must be
satisfied about** (the canonical requirement, already built), **what we ask
the vendor** (a curated question, missing), and **why this vendor is being
asked it** (a deterministic scoping decision over declared facts — partly
built, with no Privacy or AI intake behind it). Everything else in this design
— domains, branching, evidence rules, snapshots, customer policy, governed AI
— hangs off that separation. The deterministic layer stays authoritative. AI
proposes; a human and a rule decide.

---

## 1. Existing capabilities we reuse (verified in code, not assumed)

| Capability | Where | Reuse verdict |
|---|---|---|
| **Canonical requirement library** — `frameworks` + `requirements` (org-scoped, materialised from 12 code templates via `POST /api/frameworks/activate`) | `db/migrations/20260415`, `src/api/lib/frameworkTemplates.ts` | **Reuse as-is.** This IS principle A. Do not build a second requirement store. |
| **Scope tags + curation** — closed 20-tag vocabulary, heuristic backfill, `curated` provenance, coverage endpoint | `requirementScopeTags.ts`, VA-6 (#872) | **Reuse.** Tags become the requirement→domain bridge (§5). Vocabulary will be extended, never replaced. |
| **Deterministic scoping** — S1 tier baseline, S2 context triggers, S3 obligation derivation, S4 assurance offset; every inclusion carries a `rule_id` + rationale; deterministic cap with recorded overflow | `scopeResolver.ts`, `SCOPE_RULE_VERSION` | **Reuse and extend.** This is principle I's nucleus and is STAGING VERIFIED today. VA-Q adds fact sources and rule families; it does not replace the resolver. |
| **Inherent-risk intake** — 13 required fields incl. `ai_involvement`, `ai_autonomy`, `fourth_party_exposure`, `hosting_model`, `data_sensitivity` | `inherentRisk.ts`, `vendor_engagements` columns | **Reuse.** These are the first 13 "facts" of the fact model (§6). |
| **Per-engagement scope snapshot** — `vendor_engagement_scope_items` with `reasons` JSONB, `source ∈ {deterministic, ai_suggested}`, human `accepted_at` for AI items | `20260924` | **Reuse and extend.** Already snapshots *which* requirement and *why*. Missing: *what text was asked* (§9). The `ai_suggested`+accept pattern is exactly the governed-AI shape §11 needs. |
| **Independent versioning** — `METHODOLOGY_VERSION`, `SCOPE_RULE_VERSION`, per-engagement `requirement_set_version` hash, all stamped and never rewritten | `methodologyVersion.ts` | **Reuse.** VA-Q adds a fourth artifact (question-set version) into the same envelope. |
| **Responses + append-only revisions**, engagement-scoped uniqueness (verified: `ON CONFLICT (…, COALESCE(engagement_id, …))`) | `requirement_responses`, `requirement_response_revisions` | **Reuse.** Response rows gain a `question_version_id` (§4). |
| **Engagement state machine** — 15 states, actor-gated transitions, guards (`freeze_scope`, `all_mandatory_answered`) | `engagementStateMachine.ts` | **Reuse.** Branching adds guards, not states (§6.4). |
| **External portal** — hash-only tokens, disjoint auth worlds, upload policy, adversarial suites now behind the real middleware (VA-E2E-1) | `vendorPortal.ts`, `test/isolation/vendorPortal*.test.ts` | **Reuse.** Portal renders question versions instead of requirement text. |
| **Evidence spine** — canonical `evidence` (`source_type='vendor_engagement'`), `engagement_id`/`requirement_id` anchors, ADR-0012 `evidence_links` (authorized, slot 20261052) | ADR-0010, ADR-0012 | **Reuse.** Evidence↔question uses `evidence_links`; no new link table. |
| **Governed AI precedent** — `evidence_analysis` is a *suggestion*, `claudeEvidenceAnalyzer` has a strict shape parser, an explicit "document is data, not a prompt" line, invalid JSON is terminal, and `analysis_coverage` records what the model did *not* do | `vendorEvidenceAnalysisWorker.ts`, `claudeEvidenceAnalyzer.ts`, `analysisCoverage.ts` | **Reuse as the template** for every VA-Q analysis type (§11). |
| **Assurance ladder** — `asserted < evidenced < attested`; human confirmation is the only way up | `controlEffectiveness.ts` | **Reuse unchanged.** VA-Q never adds a rung a model can climb. |
| **Obligations + mappings** (S3), **AI systems** + `ai_system_vendor_dependencies`, **controls** + `control_mappings` | `20260418`, `20260414`, `20260415` | **Reuse.** Obligations drive the Compliance domain; AI-system dependencies are a fact source for the AI domain. |
| **Jobs table + worker claim pattern**, `llmService.completeJson`, LLM telemetry | `dataRightsWorkerPolicy.ts`, `src/api/lib/llm/` | **Reuse** for every new analysis type. |
| **Framework templates as global content → org rows** | `frameworkTemplates.ts` | **Reuse the pattern** for the question library: SecureLogic-curated templates in code, materialised per org, customer-editable copies. |
| **RLS + `asTenant` + cross-org isolation harness** | `test/isolation/testDb.ts` | **Mandatory for every new table.** |

**Verdict on reuse:** roughly 60% of VA-Q's architecture exists and is proven.
The missing 40% is concentrated in three places: the question entity, the
fact/decision model beyond the 13 inherent inputs, and any AI assistance
beyond evidence→control.

## 2. Missing capabilities

| Gap | Principle | Severity |
|---|---|---|
| **No question entity.** The vendor sees `requirements.title` + `description`. | B, C | Blocking — everything else composes over it |
| **No question↔requirement mapping.** `control_mappings` is org-control↔requirement, not question. | C | Blocking |
| **Domain is implicit.** Scope tags approximate it; no first-class domain on requirement, question, scope item, or finding. Privacy is one tag; Compliance is "whatever S3 pulled in". | Directive §domains | Blocking |
| **Intake covers 13 facts.** None of: jurisdictions, personal-data categories, data subjects, sub-processors as entities, generative AI, third-party/foundation models, customer data into models, training/fine-tuning, automated decision-making, customer-policy applicability. | Dynamic scoping | Blocking for Privacy and AI domains |
| **No branching.** Scope is computed once from intake and frozen at issue. A vendor's answer cannot open a follow-up. | E | Blocking |
| **No evidence requirements.** Evidence is optional and may be unanchored. A "pass" with nothing behind it is legal. | F | High |
| **Snapshot stores IDs, not text.** `PATCH /requirements/:id` after issue silently changes what the vendor "was asked". `requirement_set_version` is a hash with no stored content to diff against. | G | High — integrity |
| **Profiles are code constants.** `TIER_BASELINE_TAGS`, `TIER_QUESTION_CAP`, depth are not per-org. | D, H | Medium — Q7 |
| **AI assistance = one analysis type** (evidence supports control). No narrative analysis, contradiction, missing-evidence, follow-up suggestion, or reviewer summary. | Directive §AI-assisted | Medium — Q6 |
| **No prompt-injection test corpus.** The analyzer has the defensive line but nothing adversarial exercises it. | Security | High — must land with Q6, tests first |
| **Vendor profile is thin** — `vendors` has no jurisdiction, no sub-processor list, no data-processing role. Facts are captured per engagement only. | Dynamic scoping | Medium — decide fact home (§6.1) |

## 3. Proposed architecture

```
                 ┌─────────────────────────────────────────────────────┐
                 │  POLICY LAYER (deterministic, versioned, authoritative)│
                 │  fact registry · rule families S1–S6 · profiles       │
                 │  evidence rules · branching rules                     │
                 └────────────┬─────────────────────────┬──────────────┘
   vendor profile             │ composes                │ evaluates
   + engagement intake ─▶ FACT STORE ─▶ QUESTIONNAIRE  ─▶ CONDITIONAL
   + vendor answers ─────────▲          SNAPSHOT (immutable) FOLLOW-UPS
   + AI-system deps          │               │                │
                             │               ▼                ▼
   CONTENT LAYER             │          PORTAL (renders question versions,
   requirements ◀─ links ─▶ questions   collects responses + evidence)
   (canonical)   (curated,   │               │
                  versioned) │               ▼
                             │      ANALYSIS LAYER (governed AI)
                             │      suggestions only · schema-validated
                             │      · fail-closed · provenance-stamped
                             │               │
                             ▼               ▼
                     REVIEW (human) ─▶ effectiveness ladder ─▶ findings
                     ─▶ remediation ─▶ residual ─▶ DECISION (human) ─▶ monitoring
```

**Four layers, one direction of authority.** Content is data. Policy is code
(versioned) plus org-scoped configuration rows (versioned). Analysis produces
suggestions that can only enter the policy layer through an existing human
gate (`accepted_at`, evidence review, finding disposition). Nothing in the
analysis layer has a write path to a score, a state transition, or a decision.

**What does not change:** the engagement state machine, the portal's trust
boundary, the effectiveness/residual methodology, the finding promotion path,
the evidence spine.

## 4. Data model

All new tables: `organization_id NOT NULL`, RLS policy in the standard shape,
`dataClassification.ts` entries, grants for the worker roles that need them,
and a cross-org negative test before merge. Additive only.

### 4.1 Content layer

```
questions
  id, organization_id, question_key TEXT (stable, e.g. "ai.training.customer_data"),
  domain TEXT CHECK (domain IN ('security','privacy','ai','resilience','nth_party','compliance')),
  origin TEXT CHECK (origin IN ('securelogic','customer')),
  template_key TEXT NULL,               -- which SecureLogic template seeded it
  status TEXT CHECK (status IN ('draft','active','retired')),
  current_version INT NOT NULL DEFAULT 1,
  created_by_user_id, created_at, updated_at
  UNIQUE (organization_id, question_key)

question_versions                       -- IMMUTABLE. Never UPDATE, never DELETE.
  id, organization_id, question_id, version INT,
  prompt TEXT, guidance TEXT NULL,
  answer_type TEXT CHECK (answer_type IN ('attest','select_one','select_many','text','numeric','date')),
  options JSONB NULL,                   -- for select_*; closed list, each with a stable value
  evidence_policy TEXT CHECK (evidence_policy IN ('none','optional','required_on_pass','required_always')),
  content_hash TEXT NOT NULL,           -- sha256 over the canonical JSON of the above
  published_at TIMESTAMPTZ NOT NULL, published_by_user_id
  UNIQUE (question_id, version), UNIQUE (organization_id, content_hash)

question_requirement_links              -- principle C: many-to-many
  id, organization_id, question_id, requirement_id,
  relation TEXT CHECK (relation IN ('evidences','partially_evidences')),
  created_at, created_by_user_id
  UNIQUE (question_id, requirement_id)
```

Domain lineage to frameworks is *derived*, not stored twice:
`question → question_requirement_links → requirements.framework_id`. A question
with links into NIST AI RMF and ISO 42001 has AI-framework lineage by
construction. A question with zero links is legal only while `status='draft'`
(CHECK enforced at publish in code, asserted by test).

### 4.2 Policy layer (org-scoped rows, SecureLogic-seeded)

```
questionnaire_profiles
  id, organization_id, profile_key TEXT, version INT,
  origin ('securelogic'|'customer'), status ('active'|'superseded'),
  tier_baseline JSONB,     -- {tier_1_critical: {domains:[...], depth:'full', cap:250}, ...}
  domain_activation JSONB, -- rule refs enabled/disabled per domain (never edits the rule)
  content_hash TEXT, published_at, published_by_user_id
  UNIQUE (organization_id, profile_key, version)

question_conditions                     -- principle E (see §6.4 for the DSL)
  id, organization_id, question_id,
  effect TEXT CHECK (effect IN ('include','exclude','require_evidence','escalate_depth')),
  predicate JSONB NOT NULL,             -- validated against the FACT REGISTRY at write time
  rule_id TEXT NOT NULL,                -- e.g. "S5.ai.training_followup"
  rationale TEXT NOT NULL,              -- vendor- and reviewer-facing "why we are asking"
  origin ('securelogic'|'customer'), created_at
```

The **fact registry** is code, not a table: a closed, versioned list of fact
keys with types and allowed sources (§6.1). A predicate referencing an
unregistered fact is rejected on write — the same discipline as the closed
scope-tag vocabulary.

### 4.3 Fact store

```
engagement_facts
  id, organization_id, engagement_id,
  fact_key TEXT NOT NULL,               -- must exist in the registry
  value JSONB NOT NULL,
  source TEXT CHECK (source IN ('intake','vendor_profile','ai_system_dependency','vendor_answer','profile_default','derived')),
  source_ref UUID NULL,                 -- the answer / dependency row it came from
  captured_at TIMESTAMPTZ NOT NULL
  UNIQUE (engagement_id, fact_key, source)   -- one value per source; resolver applies precedence
```

The 13 existing inherent-risk columns remain the store of record for inherent
risk (methodology stability). At scoping time they are **mirrored** into
`engagement_facts` with `source='intake'` so the resolver reads one surface.
This is transitional and explicit; the alternative (moving inherent inputs)
would touch the ratified methodology for no product gain.

### 4.4 Snapshot (principle G)

```
questionnaire_snapshots                 -- IMMUTABLE once status='issued'
  id, organization_id, engagement_id UNIQUE,
  profile_id, profile_version, scope_rule_version, methodology_version,
  question_set_hash TEXT,               -- sha256 over ordered (question_version_id, depth, mandatory, evidence_policy)
  fact_snapshot JSONB,                  -- every fact + source the composition read
  composed_at, composed_by_user_id, issued_at NULL

questionnaire_snapshot_items
  id, organization_id, snapshot_id, position INT,
  question_version_id NOT NULL,
  domain TEXT, depth, mandatory BOOLEAN, evidence_policy,
  requirement_ids UUID[],               -- resolved links at composition time
  reasons JSONB,                        -- every rule_id + rationale, as today
  added_by TEXT CHECK (added_by IN ('composition','followup','ai_suggested')),
  accepted_at, accepted_by_user_id      -- required when added_by='ai_suggested'
  UNIQUE (snapshot_id, question_version_id)
```

`vendor_engagement_scope_items` is **not dropped**. In Q1 it gains
`question_version_id UUID NULL`; existing rows keep `requirement_id`. The
resolver writes both until Q8 retires the requirement-only path. Existing
engagements remain readable forever with their original meaning.

### 4.5 Responses and evidence

- `requirement_responses` gains `question_version_id UUID NULL` and
  `answer_value JSONB NULL` (for `select_*`/numeric/date). `status` stays the
  closed `pass|fail|partial|not_assessed|not_applicable` vocabulary — the
  effectiveness ladder consumes **only** `status`. A `select_one` question's
  option maps to a status in `question_versions.options` (each option carries
  `maps_to_status`), so structured answers stay deterministic.
- `requirement_response_revisions` gains the same two columns. Append-only,
  unchanged.
- Evidence↔question: ADR-0012's `evidence_links` with `link_type='question_response'`.
  `evidence.requirement_id` stays for the legacy anchor.

### 4.6 Analysis layer (generalises `evidence_analysis`)

```
assessment_analyses
  id, organization_id, engagement_id,
  subject_type TEXT CHECK (subject_type IN ('evidence','response','engagement')),
  subject_id UUID,
  analysis_type TEXT CHECK (analysis_type IN (
     'evidence_support','narrative_consistency','contradiction',
     'missing_evidence','followup_suggestion','exception_priority','reviewer_summary')),
  output JSONB NOT NULL,                -- validated against the per-type schema BEFORE insert
  model_id TEXT, prompt_version TEXT, input_hash TEXT,
  status TEXT CHECK (status IN ('complete','failed_invalid_output','failed_unavailable','skipped_untrusted_input')),
  created_at
  UNIQUE (subject_type, subject_id, analysis_type, input_hash)
```

`evidence_analysis` is migrated *into* this shape by view, not moved, until Q8.

## 5. Question ↔ control ↔ framework/domain mapping model

```
framework (org row from template)
   └── requirement (canonical; scope_tags; domain derived from tags)
          ▲ many
          │ question_requirement_links (evidences | partially_evidences)
          ▼ many
       question (domain; versions)
```

- **Domain of a requirement** = `domain_for_tags(scope_tags)` — a pure,
  versioned function. Tag→domain table (extended vocabulary in Q1):
  `security` ← core, access-control, iam, privileged-access,
  segregation-of-duties, encryption, tenancy-isolation, logging,
  incident-response, vulnerability-management*, secure-development* ·
  `privacy` ← privacy, data-protection, retention, data-subject-rights*,
  cross-border*, lawful-basis*, breach-notification* · `ai` ← ai-governance,
  model-risk, explainability, human-oversight, training-data*,
  model-provider*, automated-decision* · `resilience` ← resilience,
  business-continuity · `nth_party` ← supply-chain, subprocessor ·
  `compliance` ← any requirement reached via S3 (obligation edge) regardless
  of tag. (*new tags.*)
- **Domain of a question** is stored (it is authored content) and must agree
  with at least one linked requirement's domain — asserted at publish, tested.
- **Coverage query** (Q1 deliverable): for each activated requirement, how many
  active questions evidence it. Zero-coverage requirements fall back to the
  **requirement-as-question bridge** (§15) so nothing silently disappears —
  the same "invisible is the one outcome with no trace" rule VA-6 set.
- **One question, many frameworks.** "Do you train models on customer data?"
  links to NIST AI RMF MAP-1.x, ISO 42001 A.7.x and a GDPR Art. 22 obligation
  mapping. Asked once, credited thrice. This is the point of principle C.

## 6. Dynamic scoping / decision model

### 6.1 Fact registry (code, versioned with `SCOPE_RULE_VERSION`)

| Namespace | Facts (type) | Primary source |
|---|---|---|
| `core.*` | the 13 inherent inputs | intake (mirrored) |
| `service.*` | `type` (enum), `customer_facing` (bool), `hosting_regions` (string[]) | intake / vendor profile |
| `data.*` | `personal_data` (bool), `categories` (enum[]), `sensitive_categories` (enum[]), `subjects` (enum[]), `volume_band`, `jurisdictions` (ISO[]), `cross_border` (bool), `retention_defined` (bool) | intake, then **vendor answers** |
| `access.*` | `privileged` (bool), `network` (bool), `production_data` (bool) | intake |
| `ai.*` | `uses_ai` (bool), `use_cases` (enum[]), `customer_facing` (bool), `generative` (bool), `third_party_models` (bool), `model_providers` (string[]), `customer_data_in_prompts` (bool), `trains_on_customer_data` (bool), `fine_tunes_on_customer_data` (bool), `automated_decisions` (bool), `material_decisions` (bool), `retention_of_inputs` (enum) | intake, `ai_system_vendor_dependencies`, vendor answers |
| `nth.*` | `subprocessors_declared` (bool), `subprocessor_count_band`, `subprocessors_in_scope_regions` (bool), `concentration` | intake, vendor answers |
| `policy.*` | `frameworks_active` (keys[]), `obligations_active` (ids[]), `profile_key` | org configuration |

**Precedence when a fact has several sources:** `vendor_answer` (most recent,
from *this* engagement) > `intake` > `ai_system_dependency` >
`vendor_profile` > `profile_default`. A vendor answer can *widen* scope; only
an internal user can *narrow* it (an "exclude" effect never fires from a
vendor-sourced fact — §12 T-6).

**Issued scope vs reassessment scope (ADR-0013 R4 clarification).** The
widen-only rule binds the *issued* assessment: an issued snapshot never loses a
required item. It is **not** monotonic across the vendor's lifetime. A future
reassessment is composed fresh from current facts under the current profile,
and the deterministic engine may legitimately produce a **narrower** scope when
*verified* facts (internal-sourced or reviewer-confirmed — never a prior
unconfirmed vendor answer alone) support it and governance requirements are
met. Both directions are tested: issued never shrinks; reassessment may.

### 6.2 Rule families

| Family | Exists? | Role |
|---|---|---|
| S1 tier baseline | yes | unchanged; reads `questionnaire_profiles.tier_baseline` instead of the code constant (Q7; identical defaults until then) |
| S2 context triggers | yes | extended with domain-aware triggers reading the fact store (Q2) |
| S3 obligation derivation | yes | unchanged; sets `domain='compliance'` on what it pulls in |
| S4 assurance offset | yes | unchanged |
| **S5 domain activation** | new (Q2) | activates a domain's question set from facts (§6.3); every activation is a reason |
| **S6 conditional follow-up** | new (Q3) | evaluates `question_conditions` against facts *including vendor answers*; adds `followup` snapshot items during `in_progress`; re-evaluated on each answer save, deterministically |
| **E1 evidence requirement** | new (Q3) | derives `evidence_policy` per item from question default, profile, and `require_evidence` conditions; enforced by the `all_mandatory_answered` guard's new sibling `all_required_evidence_attached` |

### 6.3 Domain activation (S5) — the authoritative table

| Domain | Activates when (any) | Never activates when |
|---|---|---|
| Security | always (baseline) | — |
| Privacy | `data.personal_data=true` · `core.data_sensitivity ≥ confidential` · any GDPR/CCPA/HIPAA obligation active · `ai.customer_data_in_prompts=true` | `data.personal_data=false` AND sensitivity ≤ internal AND no privacy obligation |
| AI | `core.ai_involvement ≠ none` · `ai.uses_ai=true` · an `ai_system_vendor_dependencies` row names this vendor | `ai.uses_ai=false` explicitly answered AND no dependency row |
| Resilience | `core.operational_dependency ∈ {high,critical}` · `core.recoverability ∈ {weeks,none}` · `core.business_criticality ≥ high` · tier ≤ 2 | tier 4 with low dependency |
| Nth party | `core.fourth_party_exposure ≥ moderate` · `nth.subprocessors_declared=true` · `ai.third_party_models=true` | vendor answers "no sub-processors" AND intake says none — but a later "yes" re-activates (S6) |
| Compliance | any active obligation maps to an activated requirement (S3) · `data.jurisdictions` intersects a jurisdiction-bound obligation | no active obligations |

The directive's worked example resolves as: LLM + customer PII →
`ai.uses_ai`, `ai.third_party_models`, `ai.customer_data_in_prompts`,
`data.personal_data` → **Security + Privacy + AI + Nth party** all activate,
each with its own rule_id in `reasons`. A low-risk vendor with
`access_level=none`, `data.personal_data=false`, `ai.uses_ai=false` →
Security baseline at `attest` depth only, cap 15.

### 6.4 Branching DSL (deliberately small)

```json
{ "all": [
    { "fact": "ai.uses_ai", "eq": true },
    { "any": [ { "fact": "ai.trains_on_customer_data", "eq": true },
               { "fact": "ai.fine_tunes_on_customer_data", "eq": true } ] }
] }
```

Operators: `all`, `any`, `not`, `eq`, `in`, `gte` (ranked enums only),
`present`. No arithmetic, no string matching, no references to other
questions' free text — a follow-up can only key off a **structured** answer
that has been mapped to a fact. Max nesting depth 3, enforced at write. This
keeps every questionnaire composition replayable from `fact_snapshot` alone,
which is what makes §9 auditable.

**State machine impact:** no new states. `in_progress` gains a re-evaluation
hook (S6) on answer save; `submitted` gains the guard
`all_required_evidence_attached`. Follow-ups appended after issue are
`snapshot_items.added_by='followup'` with the triggering answer as
`source_ref` — the snapshot is append-only, never edited.

## 7. Privacy decision tree

```
data.personal_data?
├─ no  ──▶ Privacy domain OFF (record reason "no personal data declared")
│          unless: sensitivity ≥ confidential OR privacy obligation active
│          ──▶ Privacy domain ON at 'confirm' depth ("confirm no personal data")
└─ yes ──▶ Privacy ON, baseline questions:
           purpose · minimisation · collection · storage location · retention ·
           deletion · data-subject rights · breach notification · DPA in place
           ├─ data.sensitive_categories non-empty ──▶ + special-category handling,
           │                                            lawful basis, DPIA evidence REQUIRED
           ├─ data.subjects ∋ children|patients|employees ──▶ + subject-specific questions
           ├─ data.cross_border OR jurisdictions ∉ hosting_regions
           │      ──▶ + transfer mechanism (SCC/adequacy/BCR), evidence REQUIRED
           ├─ nth.subprocessors_declared ──▶ + sub-processor list, flow-down, notice
           │      (activates Nth-party domain if not already)
           ├─ ai.customer_data_in_prompts ──▶ + AI-processing-of-PI questions
           │      (cross-links to AI domain; asked ONCE, credited to both)
           ├─ ai.automated_decisions AND material ──▶ + Art.22-class questions:
           │      human intervention, contestability, logic explanation
           └─ policy.obligations_active ∩ {GDPR,CCPA,HIPAA,…}
                  ──▶ S3 pulls the mapped requirements; questions linked to them are
                      mandatory; Compliance domain ON
```

Every arrow is a `question_conditions` row or an S5 rule with a `rule_id`.
The tree is documentation of the rules, not a second implementation.

## 8. AI decision tree

```
ai.uses_ai?  (from intake ai_involvement, ai_system_vendor_dependencies, or answer)
├─ no  ──▶ AI domain OFF; one 'attest' question "no AI/ML in the service" at tier ≤ 2
└─ yes ──▶ AI ON, baseline: use cases · customer-facing? · governance owner ·
           inventory · change management · incident handling · monitoring
           ├─ ai.generative ──▶ + prompt/output handling, content controls, logging
           ├─ ai.third_party_models ──▶ + provider list (→ nth.* facts), provider terms,
           │        data-use terms with provider, evidence REQUIRED (provider DPA/terms)
           ├─ ai.customer_data_in_prompts ──▶ + retention of inputs, isolation between
           │        customers, provider retention/training opt-out — evidence REQUIRED
           │        (activates Privacy if personal data)
           ├─ ai.trains_on_customer_data OR fine_tunes ──▶ + consent/lawful basis,
           │        data lineage, deletion from trained artefacts, model card —
           │        DPIA or equivalent evidence REQUIRED; escalate depth to 'full'
           ├─ ai.automated_decisions
           │      ├─ material=false ──▶ + human oversight design (confirm)
           │      └─ material=true  ──▶ + human-in-the-loop evidence, contestability,
           │               explainability, bias/fairness testing results REQUIRED,
           │               core.ai_autonomy must agree (contradiction check, §11)
           ├─ ai.customer_facing ──▶ + disclosure to end users, misuse controls
           └─ always when ON ──▶ + adversarial/security testing, model/data governance,
                    evaluation results, links to NIST AI RMF / ISO 42001 requirements
```

Framework lineage: every AI question links to ≥1 requirement in NIST AI RMF
(template exists) or ISO/IEC 42001 (template to be added in Q5 — the
framework-template mechanism already supports it). No isolated AI
questionnaire exists in this design.

## 9. Questionnaire versioning model

Four independently versioned artifacts, all stamped on the snapshot:

| Artifact | Identity | Changes when |
|---|---|---|
| `methodology_version` | code constant | scoring models change |
| `scope_rule_version` | code constant | rule families / fact registry / DSL change |
| `profile_version` | `questionnaire_profiles.version` | the org (or SecureLogic default) changes baseline/caps/activation |
| `question_set_hash` | sha256 over ordered snapshot items' `question_versions.content_hash` | any asked text, option, or evidence policy differs |

**Integrity rules (each is a test):**
1. `question_versions` rows are never updated or deleted (trigger raises).
2. Editing a question creates version N+1; live snapshots keep N.
3. A snapshot's `question_set_hash` is recomputable from its items and must
   match on read (`integrity_check` endpoint; drift = incident, not warning).
4. Follow-ups are appended items, never re-composition.
5. `PATCH /requirements/:id` no longer affects any issued questionnaire —
   because the portal renders `question_versions`, not `requirements`.
6. Recompute reads stamped versions, never current (existing rule, extended).

**Reissue semantics:** "reissue" = new snapshot from current versions on a new
engagement (`parent_engagement_id` set). Never mutate an issued snapshot. A
reissue is a *reassessment* in R4's sense: its scope is recomputed, and may be
narrower than the parent's when verified facts support it.

## 10. Evidence-requirement model

`evidence_policy` per snapshot item, resolved as
`max(question default, profile override, condition effects)`:

| Policy | Portal behaviour | Submit guard | Effectiveness |
|---|---|---|---|
| `none` | no upload prompt | — | answer credited at `asserted` |
| `optional` | upload offered | — | `evidenced` only after human confirm (unchanged) |
| `required_on_pass` | upload mandatory when answer maps to `pass`/`partial` | blocks submit | a `pass` without evidence is stored as `pass` but ladders as `asserted` and is flagged `evidence_missing` for review |
| `required_always` | upload mandatory | blocks submit | as above |

Missing required evidence never silently converts an answer. It blocks
submission (vendor-side) and, if a reviewer waives it, the waiver is a
recorded decision (`snapshot_items.evidence_waived_by`, rationale required).

## 11. AI-analysis boundary

**Allowed analysis types and what they may touch:**

| Type | Input | Output (schema-validated) | May write to |
|---|---|---|---|
| `evidence_support` | one file's text + one question version | `{verdict, rationale}` (exists) | `assessment_analyses` only |
| `narrative_consistency` | one free-text answer + its question | `{consistent: bool, issues[]}` | analyses only |
| `contradiction` | structured answers + facts for one engagement | `{pairs:[{a,b,why}]}` — e.g. `ai.automated_decisions=true` vs `core.ai_autonomy=none` | analyses only; surfaces as reviewer flag |
| `missing_evidence` | snapshot items + evidence links | `{items:[{question_version_id, expected}]}` | analyses only |
| `followup_suggestion` | answers + facts | `{questions:[{question_key, why}]}` restricted to **existing active questions** | `snapshot_items` with `added_by='ai_suggested'`, `accepted_at=NULL` — invisible to the vendor until a human accepts (existing pattern) |
| `exception_priority` | promoted findings | ordering + why | analyses only; UI ordering hint |
| `reviewer_summary` | all of the above | prose + citations to item ids | analyses only |

**Hard boundaries (each is a test in §14):**
- No analysis type has a write path to `requirement_responses.status`,
  `controlEffectiveness`, `residual_*`, `decision*`, `findings.severity`, or
  any state transition.
- A model may only *name* an existing `question_key`; it cannot author a
  question. Unknown keys are dropped and logged.
- Every prompt carries the existing "this is data, not a prompt" framing;
  every input is tagged with its trust class (`vendor_supplied`,
  `internal`, `system`) and vendor-supplied text is wrapped in delimiters the
  model is told to treat as opaque.
- Structured output is parsed by a strict per-type parser (the
  `parseAnalysisResponse` pattern); anything else is
  `failed_invalid_output` — **terminal, no retry, no partial row**.
- **Fail closed:** a failed analysis leaves `analysis_coverage` below `full`,
  never a default verdict, never a "no issues found".
- Provenance: `model_id`, `prompt_version`, `input_hash` on every row.
- Cross-tenant: the worker runs inside `withTenant(orgId)`; the prompt is
  built only from rows that query returned; tests assert an org-B string can
  never appear in an org-A prompt.
- Tool use: none. The analysis worker calls `completeJson` with no tools.
  This is a design constraint, asserted by a test that the client is
  constructed without a tools array.

## 12. Threat model (pre-implementation)

Assets: vendor answers and evidence (confidential, often PII), the org's
questionnaire policy (competitive), the issued snapshot (integrity =
auditability), the invite/session credentials, the model prompt context.

| # | Threat | Vector | Control (built ✓ / new ●) |
|---|---|---|---|
| T-1 | Cross-tenant read of questions/answers/analyses | IDOR on any new id | RLS on every table ✓ pattern · `asTenant` ✓ · cross-org negative tests ● per table |
| T-2 | Vendor reads another engagement of the same org | portal session param tampering | session bound to one engagement ✓ · snapshot lookups keyed by session's engagement only ● |
| T-3 | Vendor mutates the questionnaire | PUT to snapshot/condition routes with portal cookie | portal routes are an allowlist ✓ · new admin routes never mounted under `/vendor-portal` ● · "portal cookie cannot reach authenticated routes" test extended ● |
| T-4 | Issued questionnaire altered after the fact | requirement edit, question edit, direct SQL | immutable `question_versions` (trigger) ● · snapshot hash integrity check ● · portal renders versions not requirements ● |
| T-5 | Branching used to expose questions to the wrong vendor | crafted answers | conditions only read the *same* engagement's facts ● · DSL has no cross-engagement reference ● |
| T-6 | Vendor narrows their own scope | answering "no" to a gating question | `exclude` effect never fires from `vendor_answer`-sourced facts ● · widening only ● |
| T-7 | Prompt injection via answer/evidence/comment | text crafted to alter the verdict or exfiltrate context | trust-class delimiters ● · strict output parser ✓ · no tools ● · adversarial corpus test ● · verdict is suggestion-only ✓ |
| T-8 | Indirect injection changing scope | model "suggests" a question to remove | suggestions can only ADD, gated by human accept ✓ pattern · unknown keys dropped ● |
| T-9 | Cross-tenant context in a prompt | worker bug, shared cache | `withTenant` ✓ · verdict cache keyed by org ✓ (`verdictCachePolicy`) · org-B-string-never-in-org-A-prompt test ● |
| T-10 | Evidence abuse (size, type, path, quota) | upload | portal upload policy + adversarial suite ✓, now behind the real middleware ✓ |
| T-11 | Multipart route bypassing content-type gate | new upload route | assembled-app middleware test **required for every new multipart route** ● (VA-E2E-1 rule) |
| T-12 | State-transition abuse | submit with required evidence missing; follow-up answered post-submit | new guards in the state machine ● · "every portal-permitted transition is reachable, every other refused" test extended ● |
| T-13 | PII in telemetry/logs | logging answers or evidence text | `dataClassification` entries ● · log only ids + hashes ● · privacy-redaction test ● |
| T-14 | Retention/erasure conflict | ADR-0005 erasure vs immutable snapshots | snapshots are org-owned rows; erasure removes the org and everything under it — immutability is *within* the tenant's lifetime; `question_versions` hold no PII ● documented |
| T-15 | Rate/abuse on unauthenticated exchange | token guessing | VA-S1a (#878, held) adds the limiter — **prerequisite for Q3 portal changes** |
| T-16 | Customer policy misconfiguration weakens assurance | profile sets cap=0 or disables Security | SecureLogic floor: Security baseline and tier-1 minimum are not customer-disableable ● · profile validation ● |
| T-17 | Secrets in prompts/config | model keys, provider terms | existing env handling ✓ · no secrets in `assessment_analyses.output` (schema forbids) ● |

## 13. Security controls (summary, by increment)

- **Q1:** RLS + grants + classification for `questions`, `question_versions`,
  `question_requirement_links`; immutability trigger; publish-time validation
  (≥1 link, domain agreement); admin routes premium-gated via
  `requireEntitlement` and pinned in the premium-gate count test.
- **Q2:** fact registry validation; `engagement_facts` RLS; precedence tests;
  widening-only rule.
- **Q3:** DSL validator (depth, operators, registered facts); snapshot
  immutability + hash check; new state guards; portal reads snapshots only.
- **Q4/Q5:** no new surfaces — content + rules; tests for tree correctness.
- **Q6:** trust-class delimiting; per-type strict parsers; no-tools
  assertion; adversarial corpus; cross-tenant prompt test; fail-closed
  coverage; provenance columns NOT NULL.
- **Q7:** profile validation with SecureLogic floors; versioned profiles;
  audit events on every policy change.
- **Q8:** ZAP/Burp on a stable staging candidate; full E2E with adversarial
  vendor; regression suite index.

## 14. Testing strategy — mapped to the directive's 20 classes

| # | Class | Where it lands | Increment |
|---|---|---|---|
| 1 | Unit | resolver S5/S6/E1, DSL, fact precedence, hash functions, parsers | Q1–Q6 |
| 2 | Integration | compose → snapshot → portal → answer → follow-up → submit, real Postgres | Q3 |
| 3 | **Assembled-app middleware** | every new route through `createApp()`; every multipart route asserted not-415 and every JSON route asserted 415-on-multipart | every increment |
| 4 | Tenant isolation | RLS proof per new table (`testDb` harness) | every increment with a table |
| 5 | Cross-tenant adversarial | org-B ids in every new route; org-B strings in prompts | Q1, Q2, Q3, Q6 |
| 6 | BOLA/IDOR | snapshot/question/analysis ids from another org and another engagement | Q1, Q3, Q6 |
| 7 | Internal/external authz | portal cookie vs every new admin route; API key vs every portal route (extend existing) | Q3 |
| 8 | State transitions | new guards; reachability of every permitted transition | Q3 |
| 9 | Branching | table-driven: facts → expected items; widening-only; depth limit | Q3, Q4, Q5 |
| 10 | Version integrity | immutability trigger; hash recompute; edit-after-issue does not change snapshot | Q1, Q3 |
| 11 | Evidence authz | evidence_links to a question in another engagement refused | Q3 |
| 12 | Mapping | every active question has ≥1 link; domain agreement; coverage query | Q1 |
| 13 | Deterministic scoping | golden-file tests: same facts → byte-identical snapshot; directive's two worked examples | Q2, Q4, Q5 |
| 14 | AI failure/fallback | model unavailable / invalid JSON / timeout → `failed_*`, coverage < full, no default verdict | Q6 |
| 15 | Prompt-injection | corpus of adversarial answers/evidence (instruction override, exfil attempt, role play, delimiter escape) → output unchanged or `skipped_untrusted_input` | Q6, tests land **before** prompts |
| 16 | Cross-tenant AI context | two orgs, one worker run, prompt capture assertion | Q6 |
| 17 | Structured output validation | fuzzed outputs per type; unknown question_key dropped | Q6 |
| 18 | Privacy/redaction | no answer text in logs/telemetry; classification present | Q3, Q6 |
| 19 | Full E2E | customer→vendor→customer with branching + required evidence + AI suggestions accepted/rejected, on staging | Q8 |
| 20 | Regression per defect | one named test per defect found in VA-E2E-1 and after (the 415 suite is the first) | continuous |

Rule carried from VA-E2E-1: **no suite for a portal or upload path may build
its app from `buildRoutes()` alone.** The lint for this is a test that greps
the isolation suites for `enforceJsonContentType`.

## 15. Migration strategy

- **Additive only.** No column drops, no CHECK tightening on existing rows.
- **Slots:** 20261050–20261058 are reserved (ADR-0012 T2-A 51–55, VA-C1/P1/D1
  56–58). VA-Q1 requests **20261059–20261063**; later increments request at
  planning time. Nothing is reserved by this document.
- **Bridge:** Q1 ships a backfill that materialises one `question` +
  `question_versions` v1 per activated requirement (`question_key =
  "req:<framework_key>:<reference_id>"`, prompt = requirement title,
  guidance = description, `answer_type='attest'`, `evidence_policy='optional'`,
  one `evidences` link). Day-one questionnaires are therefore **byte-for-byte
  what they are today**, just addressed by version. Curated SecureLogic
  questions then *replace* bridge questions per requirement as they are
  authored (Q4/Q5), and the coverage query shows the ratio.
- **Dual-write window:** Q1–Q7 write both `requirement_id` and
  `question_version_id` on scope items and responses. Q8 makes
  `question_version_id` NOT NULL for new rows and retires the
  requirement-only read path. Historical rows are never rewritten.
- **`evidence_analysis` → `assessment_analyses`:** Q6 creates the new table
  and a compatibility view; the old table is retired in Q8 after a backfill
  with `analysis_type='evidence_support'`.
- **Rollback:** each increment ships `docs/release/ROLLBACK-<slots>.sql`
  (the R-1 convention). Code rollback = redeploy previous SHA; additive
  schema stays.
- **Flags:** VA-Q surfaces ride the existing `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`
  boundary (ruled: VA curation lives on the frameworks spine, not behind a
  new flag). AI-assisted analysis types gain one flag,
  `SECURELOGIC_VA_ANALYSIS_ENABLED`, default **off everywhere** like the
  portal flag, because it opens model calls over vendor-supplied text.

## 16. Increments and dependencies

| Inc | Delivers | Depends on | Schema | Size |
|---|---|---|---|---|
| **Q0** | this package · ADR-0013 (questions ≠ requirements; deterministic authority; AI boundary) · traceability matrix | VA-E2E-1 ✓ | none | done on acceptance |
| **Q1** | `questions`/`question_versions`/`question_requirement_links` · immutability · bridge backfill · coverage query · admin CRUD (premium) · portal renders versions · `question_version_id` on scope items + responses | Q0 | 59–63 | M |
| **Q2** | fact registry · `engagement_facts` · intake extension (facts beyond the 13) · S5 domain activation · S2 reads facts · domain stamped on scope items and promoted findings · golden-file scoping tests | Q1 | +1 | M |
| **Q3** | `question_conditions` + DSL · `questionnaire_snapshots` · S6 follow-ups · E1 evidence policy + guards · `evidence_links` use (needs ADR-0012 T2-A landed) · VA-S1a (#878) merged first | Q2, ADR-0012 T2-A, #878 | +2 | L |
| **Q4** | Privacy domain content + conditions (§7) · new privacy scope tags · GDPR/CCPA/HIPAA obligation mappings | Q3 | content only | M |
| **Q5** | AI domain content + conditions (§8) · ISO 42001 template · AI tags · `ai_system_vendor_dependencies` as fact source | Q3 | content + 1 template | M |
| **Q6** | `assessment_analyses` · six analysis types · trust-class prompting · adversarial corpus (tests first) · flag default-off | Q3 (Q4/Q5 for content) | +1 | L |
| **Q7** | `questionnaire_profiles` · customer configuration UI · SecureLogic floors · audit events | Q2 (Q3 for evidence policy) | +1 | M |
| **Q8** | dual-write retirement · `evidence_analysis` retirement · ZAP/Burp · full adversarial E2E on staging · matrix moves to STAGING VERIFIED | all | tightening only | M |

Q4 and Q5 are independent of each other and can run in parallel after Q3.
Q7 can start after Q2. Nothing else parallelises safely.

## 17. Acceptance criteria (per increment; each is a test or a staging proof)

- **Q1:** editing a requirement after issue changes nothing the vendor sees ·
  every activated requirement has ≥1 active question (bridge counts) ·
  `question_versions` UPDATE/DELETE raises · portal shows version text ·
  cross-org: 404 on every new id · assembled-app: every new route.
- **Q2:** directive example 1 (LLM + PII) activates Security+Privacy+AI+Nth
  with four distinct rule_ids · example 2 (no access, no data, no AI) yields
  Security `attest` only, ≤15 items · same facts → identical snapshot hash
  across runs · vendor-sourced fact never removes an item.
- **Q3:** a structured answer opens a follow-up within the same session; the
  snapshot is append-only; hash integrity holds · required evidence blocks
  submit · waiver is recorded with rationale · all state transitions
  enumerated and refused where not permitted.
- **Q4/Q5:** every tree branch in §7/§8 has a golden test · every question
  links to ≥1 requirement in a named framework · zero isolated questions.
- **Q6:** the adversarial corpus produces no verdict change and no
  cross-tenant string · model outage → coverage < full, no suggestion rows ·
  a suggested follow-up is invisible to the vendor until accepted · no
  analysis row can be traced to a score change (write-path test).
- **Q7:** a customer cannot disable Security or drop below tier-1 floor ·
  profile change creates a new version and an audit event; issued snapshots
  unaffected.
- **Q8:** staging E2E 29-step walkthrough (VA-E2E-1 shape) plus branching,
  required evidence and AI suggestions, performed by an external tester ·
  ZAP/Burp report with zero unaddressed High.

## 18. Requirements traceability matrix

Statuses: NOT STARTED · DESIGNED · IMPLEMENTED · TESTED · STAGING VERIFIED ·
ACCEPTED · DEFERRED WITH EXPLICIT RATIONALE. **DESIGNED means this document
only.** Rows marked further along are pre-existing capabilities, verified on
staging 2026-08-28.

| Req | Requirement | Design | Package | Security control | Tests | Staging evidence | Status |
|---|---|---|---|---|---|---|---|
| A | Canonical requirement/control library | §1 | (exists) | RLS, premium gate | framework activation, RLS | SOC 2 activation 36 req, 08-28 | **STAGING VERIFIED** |
| B | Curated vendor question library | §4.1, §5 | Q1 | T-1, T-4 | 1,4,10,12 | P1 #898 @ `64e1a746`, staging §H.2 all legs PASS 2026-08-28 (create → link → publish v1 → identical = 200 same id → v2 with v1 untouched → last-link 409 → 401/415 walls) | **STAGING VERIFIED** (P1: entity, immutable versions, write surface) · DESIGNED (portal renders versions — P2) |
| C | Many-to-many question↔requirement↔framework/domain | §4.1, §5 | Q1 | publish validation | 12 | P1 #898: `question_requirement_links`, framework-join org check, foreign≡unknown 404, last-link guard; staging 2026-08-28 | **STAGING VERIFIED** (links + lineage) · DESIGNED (coverage query, bridge — P3) |
| D | Risk-based questionnaire profiles | §4.2, §6.2 | Q7 (defaults in code Q2) | T-16 floors | 13 | tier baselines today | IMPLEMENTED (code constants) → DESIGNED (profiles) |
| E | Conditional/branching rules | §4.2, §6.4 | Q3 | T-5, T-6 | 8,9 | — | DESIGNED |
| F | Evidence requirement rules | §10 | Q3 | T-12 | 11 | — | DESIGNED |
| G | Issued-assessment snapshot preserves what was asked and why | §4.4, §9 | Q1 (text) + Q3 (snapshot) | T-4 | 10 | P2 #900 @ `c9531cf1`, staging §H.3 2026-08-28: pre-P2 engagement → `unstamped` and still renders; new engagement 39/39 versioned → issue → `match`; **requirement edited AFTER issue → portal unchanged, reviewer unchanged, stamp unchanged, integrity `match`; next engagement sees the edit** | **STAGING VERIFIED** (version addressing, content-addressed stamp, integrity) · DESIGNED (`questionnaire_snapshots` table + follow-up append — Q3) |
| H | Customer-configurable policy, safe defaults | §4.2, §15 flags | Q7 | T-16 | 1 | — | DESIGNED |
| I | Deterministic scoping is authoritative | §3, §6 | (exists) + Q2/Q3 | — | 13 | S1–S4 with rule_ids live | **STAGING VERIFIED** (S1–S4) / DESIGNED (S5–S6, E1) |
| J | AI as governed analysis layer, not decision-maker | §11 | (exists for evidence) + Q6 | T-7,8,9 | 14–17 | `analysis_coverage` deterministic→full, 08-28 | **STAGING VERIFIED** (evidence_support) / DESIGNED (5 types) |
| D-SEC | Security domain first-class | §6.3 | Q2 | — | 13 | implicit today | DESIGNED |
| D-PRIV | Privacy domain first-class + tree | §7 | Q2, Q4 | T-13 | 9,13,18 | one tag today | DESIGNED |
| D-AI | AI domain first-class + tree | §8 | Q2, Q5 | — | 9,13 | four tags, two S2 rules today | DESIGNED |
| D-RES | Resilience domain | §6.3 | Q2 | — | 13 | S2.resilience today | IMPLEMENTED (rule) → DESIGNED (domain) |
| D-NTH | Fourth/Nth party domain | §6.3 | Q2 | — | 13 | S2.fourth_party today | IMPLEMENTED (rule) → DESIGNED (domain) |
| D-COMP | Compliance/Regulatory domain | §6.3 | Q2 | — | 13 | S3 today | IMPLEMENTED (rule) → DESIGNED (domain) |
| DS | Dynamic scoping over the directive's fact list | §6.1 | Q2 | T-6 | 13 | 13 of ~35 facts today | DESIGNED |
| AI-A | AI-assisted analysis, 8 task types | §11 | Q6 | T-7–9 | 14–17 | 1 of 8 live | DESIGNED |
| AI-B | AI never authoritative; fail closed | §11 | (exists) + Q6 | T-8 | 14 | ladder moves only on human confirm, proven 08-28 | **STAGING VERIFIED** (existing) / DESIGNED (extension) |
| SEC | 22 security requirements | §12–13 | every | T-1–17 | 3–7,11,18 | portal suites behind real middleware | IMPLEMENTED (portal) / DESIGNED (VA-Q) |
| AI-SEC | 12 AI-security requirements | §11, T-7–9 | Q6 | — | 15–17 | injection line exists; no corpus | DESIGNED |
| TEST | 20 test classes | §14 | every | — | — | classes 3,4,5,7,10(partial),20 exist | IMPLEMENTED (6/20) / DESIGNED |
| TRACE | This matrix, maintained | §18 | every | — | — | — | DESIGNED — updated per VA-Q PR from Q1 onward |
| ADR | ADR-0013 six rulings recorded | this doc | Q0 | — | — | — | **ACCEPTED** (ratified 2026-08-28) |
| ZAP | ZAP/Burp on stable candidate | §13 Q8 | Q8 | — | — | — | NOT STARTED |

---

### Decisions ratified as ADR-0013 (2026-08-28) — see `docs/architecture/decisions/ADR-0013-questionnaire-content-policy-and-ai-boundary.md`

1. **Questions are content; requirements are canon.** A question is never a
   requirement and a requirement is never shown to a vendor directly after Q1.
2. **The deterministic layer is the only authority.** Every inclusion,
   exclusion, depth, evidence policy and follow-up carries a `rule_id`; a
   model can only propose additions through the existing human-accept gate.
3. **Snapshots are immutable and content-addressed.** Reissue is a new
   engagement. Follow-ups append.
4. **Vendor-sourced facts can only widen an ISSUED scope** — never narrow it.
   A future reassessment is composed fresh and may be narrower on verified
   facts (ratified with this clarification).
5. **AI analysis is default-off, fail-closed, tool-less, provenance-stamped**,
   and has no write path to any score, state or decision.
6. **SecureLogic floors are not customer-disableable** (Security baseline,
   tier-1 minimum, required-evidence for training-on-customer-data and
   material automated decisions).

### What this package does not do

No migrations. No code. No question content beyond illustrative keys. No
change to the methodology or its weights. No new flag beyond the one named.
No claim that anything marked DESIGNED exists.
