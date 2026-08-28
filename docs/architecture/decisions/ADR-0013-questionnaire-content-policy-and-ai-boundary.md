# ADR-0013 — Questionnaire content, deterministic policy authority, and the AI boundary

**Status:** RATIFIED 2026-08-28 (owner decision, with one clarification on
ruling 4)
**Context package:** VA-Q0 — `docs/design/VA-Q0-intelligent-questionnaire-design.md`
**Supersedes:** nothing. Extends ADR-0010 (evidence spines) and ADR-0012
(evidence lifecycle) without altering either.
**Baseline at ratification:** `develop` @ `e773b6a8`

## Context

Vendor Assurance asks the vendor the framework requirement verbatim. There is
no question entity, no domain, no branching, no evidence rule, and an issued
questionnaire stores requirement *ids*, so a later requirement edit changes
what the vendor "was asked". The VA-Q program (directive 2026-08-28) makes the
Intelligent Questionnaire System an explicit product commitment. Six rulings
were required before any of it could be built safely.

## Decisions

### R1 — Questions are content; requirements are canon

A **requirement** is the canonical, framework-anchored statement of what the
organisation must be satisfied about. A **question** is curated, versioned
content asked of a vendor. They are distinct objects. After VA-Q1, vendors
interact with question content, never with requirement text directly.

Lineage is preserved through many-to-many links:
`question ↔ requirement/control ↔ framework/domain`. A published question
must link to at least one requirement. Framework and domain lineage are
derived through the link, never stored twice.

### R2 — The deterministic policy layer is the only authoritative decision layer

AI may analyse and propose. AI may not independently change:

- authoritative questionnaire scope
- control effectiveness
- scores
- findings or their disposition
- residual risk
- lifecycle state
- acceptance or governance decisions

Any AI proposal that would require an authoritative change passes through the
governed human-accept mechanism (the existing `ai_suggested` + `accepted_at`
pattern). Every authoritative inclusion, exclusion, depth, evidence policy and
follow-up carries a `rule_id` and a rationale.

### R3 — Issued questionnaire snapshots are immutable and content-addressed

An issued snapshot is never mutated. Library changes never alter previously
issued assessments. Reissue creates a new engagement (or a new versioned
assessment under `parent_engagement_id`). Follow-ups **append** to the
snapshot; they never rewrite historical questionnaire state. The snapshot's
identity is a content hash over its ordered items, recomputable and verified
on read.

### R4 — Vendor-sourced facts widen an issued scope; they never narrow it — with a clarification

**Issued-assessment scope (the active/issued assessment):** a vendor-sourced
fact may widen scope (open follow-ups, raise depth, require evidence). It may
never remove an already-required question or requirement. A vendor cannot
narrow their own assessment by changing an answer. An `exclude` effect never
fires from a `vendor_answer`-sourced fact.

**Future-reassessment scope (a later engagement):** this is *not* permanent
monotonic scope across the lifetime of the vendor. For a future reassessment,
SecureLogic's deterministic policy engine may legitimately produce a
**narrower** assessment when current *verified* facts support it and the
customer's and reviewer's governance requirements are satisfied. "Verified"
means facts whose precedence source is internal (`intake`, `vendor_profile`,
`ai_system_dependency`, reviewer-confirmed) — a prior engagement's unconfirmed
vendor answer alone does not narrow a future scope.

The two scopes are distinct concepts in the design and in code:
`questionnaire_snapshots` (issued, append-only) versus the composition input
of a *new* engagement (recomputed from current facts under the current
profile). Tests must cover both directions: an issued snapshot never shrinks;
a reassessment may.

### R5 — AI analysis is governed

AI analysis is: **default OFF** (its own capability flag,
`SECURELOGIC_VA_ANALYSIS_ENABLED`, off in every environment including
non-production, like the portal flag); **fail closed** (a failed analysis
leaves coverage below `full`, never a default verdict); **tool-less**
initially; **provenance-stamped** (`model_id`, `prompt_version`,
`input_hash` on every row); **isolated** behind that flag; and **prohibited
from authoritative writes**. Vendor responses and evidence are **untrusted
model input** and are delimited as such. No score, state or decision write
path may exist from model output; this is asserted by test, not by
convention.

### R6 — SecureLogic assessment floors are not customer-disableable

Customer policy may increase or customise assessment requirements. It cannot
disable mandatory SecureLogic safety floors. At minimum these floors are:

- the Security domain baseline for every tier
- the tier-1 (critical) minimum question set and depth
- required evidence when a vendor trains or fine-tunes models on customer data
- required evidence when a vendor's AI makes material automated decisions

Profile validation rejects any configuration that would breach a floor.

## Consequences

- VA-Q1 introduces `questions`, `question_versions` (immutable),
  `question_requirement_links`, and version addressing on scope items and
  responses, with a bridge backfill that keeps day-one questionnaires
  content-equivalent to today's.
- `PATCH /requirements/:id` stops affecting any issued questionnaire once the
  portal renders question versions.
- The engagement state machine gains guards, not states.
- Every VA-Q table ships with RLS, classification, and a cross-org negative
  test; every new multipart route ships with an assembled-app middleware test
  (the VA-E2E-1 rule).
- The traceability matrix in VA-Q0 §18 is the status of record. DESIGNED,
  IMPLEMENTED, TESTED and STAGING VERIFIED are distinct and never conflated.

## Rejected alternatives

- **Treat requirements as questions with per-org text overrides.** Rejected:
  it keeps one object doing two jobs, cannot express one question evidencing
  many requirements, and leaves issued text mutable.
- **Let a vendor's "no" remove questions during an issued assessment.**
  Rejected: it lets the assessed party narrow their own assessment; handled
  instead at reassessment under R4's clarification.
- **Store snapshots by reference to current content.** Rejected: not
  reproducible; the integrity gap this ADR exists to close.
- **Enable AI analysis by default off-production for developer convenience.**
  Rejected: it opens model calls over vendor-supplied text on shared
  environments; the portal-flag precedent applies.
