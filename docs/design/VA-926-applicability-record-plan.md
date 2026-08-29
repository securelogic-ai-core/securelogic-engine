# VA-926 — the applicability record: implementation plan

**Status:** PLAN ONLY. Not authorized for implementation.
**Slot:** `20261065`, reserved by owner ruling 2026-08-29.
**Issue:** #926. Related: #925 (blocked on this being decidable), the S3 ruling
(plan §H.2 Ruling 2), `docs/design/VA-S4-assurance-wiring-plan.md`.

## 1. The defect, restated as a design problem

**Applicability and questionnaire composition are the same fact today.** A
rule's activation is recorded only on the ITEMS it contributed
(`vendor_engagement_scope_items.reasons`). When composition drops every one of
those items, the stored scope contains no evidence the rule ever fired.

Proven live on staging `876bdcd8`: six tier-4 engagements where
`S5.privacy.personal_data`, `S5.ai.declared` and `S5.nth.third_party_models` all
activated, and the stored scope records none of them.

The owner ruling this must satisfy:

> Truncation alone may never produce: applicable requirement → no evidence → no
> question → **invisible assurance gap**.

And for S3 specifically:

> An applicable regulatory obligation cannot disappear because of questionnaire
> composition. Do not simply put every S3 question into `FLOOR_RULE_IDS`.

## 2. The line: immutable record vs derived state

This is the decision that keeps the record from becoming an event log. The test
is **reproducibility**: something belongs in the immutable record if it cannot
be recomputed later from surviving state.

### IMMUTABLE — written once, at resolve time, never updated

| Field | Why it cannot be derived later |
|---|---|
| `rule_id`, `rule_family` | The rule table is versioned code; a rule can be edited or removed. What fired *then* is not recoverable from what exists *now* |
| `domain` | S5's rule→domain mapping is code, and `TAG_DOMAIN` changes with curation |
| `requirement_ids` matched | Requirement `scope_tags` are mutable — 63 rows were retagged on 2026-08-29 alone. Re-deriving "what matched" against today's tags answers a different question |
| `basis` — the facts/obligation that triggered it | Facts supersede; obligations deactivate. The triggering VALUE must be captured, not a pointer to a mutable row |
| `scope_rule_version` | Cheap, and pins which corpus of rules is being described |
| `organization_id`, `engagement_id` | Tenancy and subject |
| `resolved_at` | The instant the applicability determination was made |

### DERIVED — never stored on this record

| State | Where it lives, and why it must stay there |
|---|---|
| Was the requirement **represented by a question** | `vendor_engagement_scope_items` — the scope items ARE that answer. Copying it creates two sources of truth that can disagree |
| Was it **truncated from composition** | Derivable: applicable requirement ∉ scope items ⟹ truncated. Storing it duplicates the previous row |
| Is it **assurance-covered** | Changes after the resolve — evidence arrives, expires, is contradicted. Freezing it at resolve time would be wrong within hours |
| Is it **still an assurance gap** | The whole point is that this is a LIVE question: `applicable ∧ ¬covered ∧ ¬asked`. It must be computed against current assurance, not remembered |

**So the record answers "what applied, and why" — permanently. Everything about
what HAPPENED to it is a join against live state.** That division is what stops
this becoming a dumping ground, and it is also what makes the assurance-gap
query possible at all: a gap is only meaningful against current evidence.

## 3. The query the whole package exists to enable

```
applicable requirement  (from the applicability record)
  ⟕ scope items        → was it asked?
  ⟕ assurance coverage → is it covered?          [S4, not yet wired]
= ASSURANCE GAP where neither
```

This is the owner's target model expressed as a join:

```
APPLICABILITY → AVAILABLE GOVERNED ASSURANCE → ASSURANCE GAP →
QUESTION / EVIDENCE COMPOSITION
```

Until S4 exists the middle term is empty, so the query degrades honestly to
"applicable but not asked" — which is exactly what #925 needs in order to be
decidable, and is useful on its own.

## 4. Shape (one table, slot 20261065)

`engagement_applicability` — one row per (engagement, rule, requirement), or per
(engagement, rule) with a requirement id array. **Row-per-requirement is
preferred**: it joins directly to scope items and to control mappings without
array unnesting, and the volume is bounded by corpus size.

Non-negotiables, mirroring `assessment_facts` (20261063) because it is the
closest precedent and was staging-verified 32/32:

- `organization_id` NOT NULL, RLS **ENABLE** (not FORCE — the elevated channel
  for erasure/export/migrations must bypass, per the 20261063 ruling);
- a subject-integrity trigger: the engagement must exist **in the same org**;
- `CHECK` on `rule_family` and `domain` against the closed vocabularies, with a
  code↔CHECK lockstep test read from `pg_constraint`;
- **immutability trigger**: no UPDATE of the recorded columns. A re-resolve
  writes a NEW generation rather than mutating history;
- a `resolution_generation` (or `resolved_at`) so successive resolves of the
  same engagement are distinguishable and the latest is addressable;
- indexes for the two read paths: by engagement, and by (org, domain).

**Basis capture.** `basis JSONB` holding the triggering fact keys and their
VALUES at resolve time (not fact row ids — rows supersede), or the obligation id
plus its title for S3. Values, not pointers, is the difference between a record
that reproduces and one that dangles.

## 5. What this does NOT do

- **It is not the S4 decision-basis snapshot.** Four inputs remain
  unreconstructible — evidence version, accepted review state, mapping used, and
  contradictions present at decision time (S4 plan §5b). This record covers
  *applicability*, not *why a question was not asked because of evidence*.
  Representing it as a substitute would be wrong, and the S4 plan must keep its
  ADR-0012 dependency.
- **It does not change what is asked.** No change to `FLOOR_RULE_IDS`, to
  `TIER_QUESTION_CAP`, or to composition. Scope items are untouched.
- **It does not solve #925.** It makes #925 *decidable* by making starvation
  visible; the ruling remains the owner's.
- **It does not put S3 in the floor.** It discharges the S3 ruling's first half
  — applicability survives truncation — leaving the assurance half to S4.

## 6. Isolation, authorization, reproducibility

- **Tenant isolation:** RLS plus the org-matching trigger plus an
  `organization_id` predicate in every read. The isolation suite must prove
  cross-org 404 and zero rows under an org-B session, on the
  `assessmentFacts.test.ts` pattern.
- **Authorization:** written by the resolver only; no external write route.
  Reads follow the engagement's existing authorization — a portal session must
  not see it (applicability reasoning is internal), which needs an explicit
  401/403 test.
- **Historical reproducibility:** immutability trigger + generation column +
  values-not-pointers in `basis`. The test that matters: mutate the requirement
  corpus and the facts after a resolve, then assert the record still reports
  what applied at the time.

## 7. Open questions to settle before coding

1. **Row-per-requirement or row-per-rule?** Recommended per-requirement; confirm
   against expected corpus sizes (63 requirements × rules ≈ low hundreds).
2. **Does a re-resolve supersede or append?** Recommended append with a
   generation, matching `assessment_facts`' supersession discipline.
3. **Retention.** These rows outlive engagements for audit. Erasure must reach
   them — check against the ADR-0005 erasure mechanism before choosing
   `ON DELETE`.
4. **Is `excluded` worth recording?** The resolver already computes
   `ScopeResolution.excluded` with rationales. Recording *why a requirement did
   NOT apply* is a different and larger claim; recommend **no** for this
   package.

## 8. Sequencing

After VA-Q2 (now fully staging verified). Before #925's ruling and before S4,
both of which depend on applicability being observable.
