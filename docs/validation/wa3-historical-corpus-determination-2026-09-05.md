# WA-3 — historical corpus / versioning determination

**Date:** 2026-09-05
**Branch:** `feat/wa3-vendor-facing-language`
**Environment:** staging (`securelogic-staging-db`, `dpg-d7n0pohj2pic738iidbg-a`)
**Method:** read-only SQL (`SELECT` only) as `securelogic_staging_user`. No writes, no DDL.
**Scope:** owner ruling of 2026-09-05, sequencing steps 1 and 2. Production untouched.

---

## Evidence standard used throughout

Findings are labelled **PROVEN**, **STRONGLY SUPPORTED**, or **NOT PROVABLE**.

Per the owner's caveat, absence of audit rows is never reported as proof of
non-mutation. Backfill scripts and direct `psql` sessions write without
producing application audit records, and `requirements` has **no `updated_at`
column**, so there is no row-level mutation timestamp to fall back on. The
formula used is:

> No additional application-audited requirement PATCH operations were identified
> across the examined audit period; direct historical backfill/script mutation
> cannot be excluded solely from `audit_log`.

---

## 1. The authoritative historical population

The "7 engagements / 93 items / 51 answered" figure is now pinned to an exact
predicate. It is **not** "all post-issue engagements" — there are 57 of those.
It is:

> post-issue engagements (`status NOT IN (draft, scoping, scoped, cancelled)`)
> that carry at least one scope item with `question_version_id IS NULL`.

| Measure | Count | Status |
|---|---|---|
| Engagements | **7** | PROVEN |
| Scope items | **93** | PROVEN |
| Items unstamped (`question_version_id IS NULL`) | **93 / 93** | PROVEN |
| Items stamped | **0** | PROVEN |
| Distinct requirements | **39** | PROVEN |
| Responses on those engagements | **51**, all answered | PROVEN |
| Organizations spanned | 1 — `[SEED] Walkthrough Org` | PROVEN |
| `question_set_hash` present | **0 / 7** | PROVEN |
| Composition snapshots present | **0** | PROVEN |
| Items where `requirement.created_at > scope_item.created_at` | **0** | PROVEN |

The population is entirely pre-VA-Q1-P2. `question_versions` begins at
`2026-08-28T16:51:48Z`; every engagement here was composed before that, which is
exactly why all 93 are unstamped.

| Engagement | Tier | Status | Issued | Items |
|---|---|---|---|---|
| `43a2abb9` | tier_1_critical | decided | 2026-08-15T17:33:39Z | 3 |
| `c35041bf` | tier_2_high | monitoring | 2026-08-15T17:39:35Z | 3 |
| `4ebc8a86` | tier_2_high | issued | 2026-08-14T14:13:18Z | 3 |
| `d010014b` | tier_2_high | monitoring | 2026-08-28T11:46:32Z | 3 |
| `4326c7e4` | tier_1_critical | monitoring | 2026-08-28T12:00:25Z | 3 |
| `8de82330` | tier_1_critical | monitoring | 2026-08-28T13:21:06Z | 39 |
| `e97e793b` | tier_1_critical | issued | 2026-08-28T13:25:23Z | 39 |

39 + 39 + (3 × 5) = **93**. The 39 distinct requirements are 36 SOC 2 Type II
(created 2026-08-28T12:08:36Z) and 3 NIST CSF 2.0 (created 2026-07-15T01:10:53Z).

---

## 2. The `ae678fa6…` gate — RESULT

### `ae678fa6…` **IS** among the 39. (PROVEN)

`ae678fa6-5ab8-4e5f-b35b-4769a98df24b` = **SOC 2 Type II `A1.1` — "Manages
capacity demand"**, framework version 2017, org `[SEED] Walkthrough Org`. It
sits on **2 scope items** in the population, in engagements `8de82330` and
`e97e793b`.

Because it is among the 39, the ruling's second branch applies and its current
description must not be assumed to be the historically issued text.

### Exact PATCH timestamps (PROVEN)

Across the **entire** staging `security_audit_log` — 252,522 rows spanning
`2026-04-27T14:46:31Z` → `2026-09-05T10:22:50Z` — there are exactly **two**
`requirement.curated` events, and **both are on this requirement**:

| # | Timestamp | Payload |
|---|---|---|
| 1 | `2026-08-28T18:06:58.517842Z` | `{reference_id: "A1.1", description_from_present: true, description_to_present: true}` |
| 2 | `2026-08-28T18:07:01.430313Z` | `{reference_id: "A1.1", description_from_present: true, description_to_present: true}` |

Same actor user `76cc5c29…` and API key `fd8472c6…`, 2.9 seconds apart.

### Does the audit record contain sufficient before/after information? **NO.** (PROVEN)

`PATCH /api/requirements/:id` (`src/api/routes/requirements.ts:625`) audits the
description change as **presence booleans only** — `description_from_present` /
`description_to_present`. The old and new **text are not written to the audit
record**. `scope_tags` changes do record `from`/`to` by value; descriptions do
not. This is a real audit-fidelity gap and is listed in §6.

### Old and new values ARE recoverable — from `question_versions`, not the audit log (PROVEN)

The bridge question `req:b228c32b-…:a1.1` (question `1f4f1d79…`) has two
immutable, content-addressed versions:

| Version | Published | Guidance | sha256(guidance) |
|---|---|---|---|
| **v1** `afe9ff77…` | `2026-08-28T18:06:54.773348Z` | the real A1.1 text (332 chars) | `8d02357a…e608b19` |
| **v2** `e3c2e06d…` | `2026-08-28T18:06:59.207043Z` | `"EDITED ON STAGING AFTER ISSUE — this text must NOT reach the issued questionnaire."` (82 chars) | `c08e4cc3…8815f63` |

Today's `requirements.description` for `ae678fa6…` hashes to
**`8d02357a…e608b19`** — byte-identical to **v1**.

**Reconstruction:** v1 published 18:06:54 → PATCH #1 at 18:06:58 wrote the
sabotage text → v2 captured it at 18:06:59 → PATCH #2 at 18:07:01 restored the
original. This was a **deliberate ADR-0013 R3 immutability test**, and the net
effect of the two PATCHes on the description is **zero**. The old value, the new
value, and the revert are all recoverable — through the immutable version rows,
which is precisely the mechanism R3 exists to provide.

### Which items were composed before vs after the PATCH? (PROVEN)

**Both** population items carrying `ae678fa6…` were composed **before** both
PATCHes — engagements issued `13:21:06Z` and `13:25:23Z`, PATCHes at `18:06:58Z`
and `18:07:01Z` the same day. Neither was composed after.

Later engagements that ask A1.1 (`4bf572c8`, `28cfd46e`, `57d4d327`, `7c317105`,
`130806e1`, `c03e7a0e`, …) are stamped with `question_version_id = afe9ff77…`
— **v1**, the correct text — and are therefore already immune.

### What text was persisted on those items? (PROVEN — none)

Nothing. The 93 items carry **no** persisted text: `vendor_engagement_scope_items`
stores `requirement_id` and `reasons`, never prompt or guidance. There are **no
composition snapshots** for these engagements (`vendor_engagement_composition_snapshots`
arrived in migration 20261088 on 2026-09-04, after all of them), and the snapshot
schema carries requirement **titles** by value but **not descriptions** anyway.
The portal renders these items live through
`COALESCE(qv.prompt, r.title)` / `COALESCE(qv.guidance, r.description)`.

### Can exact historical content be established deterministically?

**For the text as at `2026-08-28T18:06:54.773348Z`: PROVEN.** All 39 population
requirements have a bridge question; all 39 v1 rows were published in one
`bridgeAll` run at that instant; and for **39/39**, v1 `prompt` equals today's
`title` and v1 `guidance` equals today's `description`. A1.1 is the only one of
the 39 with more than one version.

**For the window between composition and `18:06:54`: STRONGLY SUPPORTED, not proven.**
The corroboration is independent of `audit_log`:

- `PATCH /api/requirements/:id` is the **only** application route that writes
  `requirements.description` (`requirements.ts:616`), and it always audits. No
  audited PATCH occurs in the window.
- **36/36 SOC 2 descriptions in the database are byte-identical to
  `src/api/lib/frameworkTemplates.ts`**, the template that seeds them at
  framework activation.
- Those 36 template strings are **byte-identical in git** between commit
  `bc53ae82` (`2026-08-13T17:11:32Z`, before the earliest composition) and HEAD.
  The A1.1 string has been unchanged since `27ef00a7` (2026-04-20).
- **3/3 NIST CSF descriptions** equal `"[SEED] " + title`, written by
  `scripts/validation/seed-walkthrough-org.ts` with `ON CONFLICT DO NOTHING` —
  a re-run can never overwrite them.
- The one known unaudited writer, `scripts/backfillRequirementDescriptions.ts`,
  updates only `WHERE description IS NULL OR description = ''`. It **cannot**
  overwrite a non-empty description; it could only ever have filled an empty one.

**NOT PROVABLE:** that no direct, unaudited database mutation occurred in that
window. `requirements` has no `updated_at`, so no row-level mutation timestamp
exists, and a manual `psql` UPDATE would leave no trace. This cannot be closed
with the evidence available and is not claimed.

---

## 3. The six `engagement_id IS NULL` responses — classified

All six are in `[SEED] Walkthrough Org`. All six were written by
`POST /api/requirements/responses` (`src/api/routes/requirements.ts:975`) — the
**pre-VA internal assessment model**, which by construction "never sets
engagement_id". All six carry a matching `requirement_response.created` audit
event; those are the only six such events in the log.

| Response | Type | Subject | Framework / ref | Created |
|---|---|---|---|---|
| `6ad28dea` | **self** | = organization | NIST CSF `RS.MA-01` | 2026-07-16T15:43:48Z |
| `d71387bd` | vendor | vendor `2de21b7e` | NIST CSF `RS.MA-01` | 2026-07-16T15:56:43Z |
| `94ad4fb8` | vendor | vendor `e1c57607` | NIST CSF `RS.MA-01` | 2026-09-04T03:40:31Z |
| `cd24d9f0` | vendor | vendor `e1c57607` | NIST CSF `PR.AA-05` | 2026-09-04T03:40:50Z |
| `8f33e3be` | vendor | vendor `e1c57607` | NIST CSF `DE.CM-01` | 2026-09-04T03:40:59Z |
| `c840a9fb` | vendor | vendor `e1c57607` | GDPR `Art-32` | 2026-09-05T02:14:37Z |

Answering the ruling's questions directly:

- **Which assessment model created them?** The original `requirement_responses`
  model from migration `20260420` — an internal analyst records pass/fail against
  a requirement for a subject that is either the org itself (`self`) or a vendor
  (`vendor`). `engagement_id` was added later, as NULLable, by `20260924`.
- **Do they correspond to an internal assessment?** One (`6ad28dea`) is a true
  internal self-assessment. The other five are internal analyst judgements
  *about* a vendor, recorded without any engagement.
- **Does question/requirement wording have historical meaning for them?** Yes —
  the analyst answered against the requirement's title and description. But that
  meaning is bound only by `requirement_id`, and requirement text is mutable.
- **Do they already possess an immutable content/version reference?** **No.**
  `question_version_id` is NULL on all six and the route never sets it.
- **Are they legitimately outside the vendor-engagement bridge?** **Yes.** They
  have no engagement, therefore no scope item, therefore no `si.reasons`, depth
  or mandatory flag. The portal reads `vendor_engagement_scope_items` joined by
  `engagement_id`; **no vendor was ever shown a question for any of these rows**.
  They are not vendor-facing content and must not be counted into the 93.
- **Do they expose a broader gap?** **Yes — reported in §6.** They are not
  merely historical: four of the six were written on 2026-09-04 and 2026-09-05.

**No mutation of these six rows is proposed.**

---

## 4. What this means for the bridge (design input, not yet implemented)

The durable versioning architecture the ruling asks for **already exists** and
should be reused, not paralleled:

| Concern | Existing canonical structure |
|---|---|
| Canonical requirement | `requirements` |
| Content version (immutable) | `question_versions` — WORM trigger on UPDATE/DELETE, content-addressed `content_hash` |
| Question identity | `questions` (`question_key`, `current_version`) |
| Requirement ↔ question lineage | `question_requirement_links` |
| Composition | `vendor_engagement_scope_items.question_version_id` |
| Issued-set identity | `vendor_engagements.question_set_hash` |
| Response ↔ content | `requirement_responses.question_version_id`, `requirement_response_revisions.question_version_id` |
| Composition rationale | `vendor_engagement_composition_snapshots` (append-only, hashed) |

Two facts make the bridge tractable:

1. **`bridgeAll.ts` deliberately refuses to stamp already-issued engagements**,
   and its comment states the reason in the owner's own terms: *"Stamping today's
   text as 'what was asked' would be a fabricated history — the exact thing
   ADR-0013 R3 exists to prevent."* The 93 unstamped items are that refusal,
   working as designed. The bridge must clear the evidential bar that refusal set,
   not bypass it.
2. **No WORM trigger exists on `vendor_engagement_scope_items`,
   `requirement_responses` or `requirement_response_revisions`** (verified on
   staging: the only such triggers are on `question_versions`). Stamping is
   mechanically possible.

**The non-mutation property that makes the bridge safe and provable:** for all
39 requirements, v1's `prompt`/`guidance` are byte-identical to today's
`title`/`description`. Since the portal renders `COALESCE(qv.prompt, r.title)`
and `COALESCE(qv.guidance, r.description)`, binding an item to **v1** leaves the
rendered bytes **completely unchanged**. The bridge is a provenance binding, not
a content change, and can be proven with before/after hashes of the rendered
question set.

**The trap to avoid:** `questions.current_version` for A1.1 is **2**. A bridge
that naively binds to `current_version` would bind the two historical A1.1 items
to the **sabotage text**. The binding must be to the version whose content
matches what was live at composition — v1 — never to the current version.

Remaining design questions (not yet answered, and gating implementation):
whether to stamp the 51 responses and their revisions as well as the items;
whether to stamp `question_set_hash` retroactively (it is defined as stamped
*once at issue*, so back-stamping may misrepresent it); and how to record the
residual "strongly supported, not proven" status of the pre-`18:06:54` window on
the rows themselves rather than only in this document.

---

## 5. Ruling 1 — implemented and validated (Phase A)

Presentation-boundary change only. `rule_id` / `rule_family` are no longer
shipped to the vendor portal; the rationale is.

- New pure projection `src/api/lib/vendorPortal/vendorFacingReasons.ts`, applied
  at `getPortalQuestions` (`src/api/routes/vendorPortal.ts:412`). Dropped from
  the **payload**, not merely the markup, so it cannot be read from the network
  response.
- `si.reasons` is unchanged in the database; the read does not rewrite it.
- Internal provenance verified intact in four independent places:
  `vendor_engagement_scope_items.reasons`;
  `vendor_engagement_composition_snapshots` (`compositionSnapshot.ts:125` writes
  `{rule_id, rule_family, rationale}` by value into the immutable snapshot);
  `engagement_applicability` (`applicabilityStore.ts:95,143`); and analyst
  explainability (`src/engine/applicability/v1/explainability.ts:173`).
- The **analyst** UI keeps it in full — `app/src/lib/api.ts:8052`
  (`CompositionReason`) and the WA-2 assessment-composition section. The portal
  was never the only consumer.
- Composition, response semantics, historical meaning and tenant isolation are
  untouched: no migration, no query-shape change, no change to what is stored.

**Tests, each proven non-vacuous by negative control:**

| Arm | Result | Negative control |
|---|---|---|
| `src/api/__tests__/vendorFacingReasons.test.ts` | 5/5 pass | input carries `rule_id`; asserts on the serialised payload |
| `app/src/app/portal/__tests__/questionnaire.render.test.tsx` | 11/11 pass | **fails** against the pre-WA-3 page |
| `test/isolation/vendorPortalResponseCompleteness.test.ts` (new arm) | 16/16 pass | **fails** against the pre-WA-3 engine |

The app fixture deliberately still carries `rule_id`/`rule_family`, because the
app and engine deploy as separate services and the portal can be served a stale
payload during a rolling deploy — and because a fixture without them let the old
badge markup pass vacuously. That vacuity was caught and fixed; it is the fourth
vacuous arm found in this program.

---

## 6. Findings to carry forward

1. **Requirement description edits are audited without their content.**
   `requirement.curated` records `description_from_present` / `description_to_present`
   booleans. `scope_tags` records `from`/`to` by value. Historical description
   text was recoverable here only because `question_versions` happened to capture
   it; before the bridge existed, it would not have been.

2. **`requirements` has no `updated_at` column.** There is no row-level mutation
   timestamp, so an unaudited write leaves no trace at all.

3. **The internal assessment path has the same versioning gap the vendor bridge
   is being built to close, and it is still live.**
   `POST /api/requirements/responses` writes `requirement_responses` with NULL
   `engagement_id` **and** NULL `question_version_id`, binding an analyst's
   answer to `requirement_id` alone — against mutable requirement text. Four of
   the six such rows date from 2026-09-04 and 2026-09-05.
   **The durable versioning architecture should not be declared complete on the
   strength of the vendor-engagement bridge alone.** This is reported, not fixed;
   it is outside the approved WA-3 scope.

4. **All 7 population engagements have `question_set_hash = NULL`**, so
   `GET /vendor-engagements/:id/integrity` has no anchor to verify them against.

---

## Production

Untouched. No Vendor Assurance production activation, no production
configuration change, no production data migration, no Blueprint sync, no
main/develop reconciliation. WA-3 remains a production-eligibility gate.

---

# Part 2 — the freeze as built (owner ruling of 2026-09-05, Option 1)

## Migration `20261091_wa3_historical_question_version_freeze.sql`

Binds each pre-P2 assessment item to **version 1** of its bridge question, plus
the answers and revisions that hang off it. Rollback:
`docs/release/ROLLBACK-20261091.sql`.

**Provenance semantics (Section B).** *Frozen as of 2026-08-28T18:06:54Z, the
earliest immutable content record available.* Not a reconstruction of
issuance-time text, not proof that the question never previously changed. The
four states the record keeps distinct:

1. **earliest immutable content we can substantiate** — question version 1,
   published `2026-08-28T18:06:54.773348Z`;
2. **current pre-bridge rendered content** — the COALESCE fallback over
   `requirements.title` / `.description`, hashed per item in Part 1 §1;
3. **frozen v1 content** — identical to (2) by construction; the migration
   refuses otherwise;
4. **unprovable earlier historical state** — the window between composition and
   (1), addressed in Part 1 §2 and not claimed.

**Bounding (Section F).** The population is unstamped **and** past issue **and**
composed before its own tenant's first `question_versions.published_at`. An
organization with no versions yields NULL from that subquery, so the predicate
is false and the migration is a no-op — the correct behaviour on a fresh
database, a test harness, and any environment where Vendor Assurance has never
run. This is a one-time historical bridge, not a standing policy of binding
unstamped rows to v1.

**Fail-closed.** Any item in the population without a byte-identical v1 —
missing bridge question, missing v1, or content drift — raises and rolls the
whole migration back (`migrationRunner.ts:212` wraps each migration in one
transaction). Nothing is normalized to make a comparison succeed. Post-conditions
then re-prove, on the committed rows, that every bound item renders exactly what
it rendered before.

**Version 1, never `current_version`.** `questions.current_version` for SOC 2
`A1.1` is **2**, and v2 holds the sabotage text from the immutability test. A
bridge keyed on `current_version` would attach two historical items to it.

## Test — `test/isolation/wa3HistoricalVersionFreeze.test.ts` (7/7)

Against real Postgres, with a fixture that reproduces the A1.1 two-version shape
and deliberately awkward content (an em-dash, a double space, a trailing space)
so that any normalization would fail the hash arms.

| Arm | Proves |
|---|---|
| fail closed | one drifted item aborts the migration; nothing bound in either tenant; zero responses stamped |
| binds the population | the historical items bind, and **every** item's rendered sha256 is unchanged in both tenants |
| v1 not current_version | the trap item binds to v1 and explicitly not to v2 |
| bounded | a pre-issue engagement's item and an item composed after the first version are both left NULL |
| answers + revisions | bound to the same version; `status` and `notes` untouched |
| lifecycle | engagement statuses unchanged |
| tenant isolation | zero rows in any of the three tables point at another org's version |
| idempotent | a second run is a no-op |
| freezes against a corpus edit | after a simulated canonical edit the bound item does not move, while the deliberately-unbound one does |

## Rulings 2/3/4 — applied, with measured counts

The counts recorded in the ruling are not all reproducible from the code. They
are reported rather than forced.

**Ruling 1** — see Part 1 §5. Unchanged.

**Ruling 2 — five corrected.** About 28 Core Assurance rationales use
customer-referent "your", but only five have a genuinely *misdirected subject* —
where the sentence addresses or describes the reader as the customer, with no
"the vendor" contrast to fix the referent: `CAS-01` applicable, `CAS-09`
applicable and not-applicable, `CAS-10` applicable and not-applicable. The other
23 read correctly because the sentence contrasts "the vendor" with "your".
The root cause was also corrected: `CoreAssuranceObjective` documented these
fields as *"Customer-facing"* when `decideCoreApplicability` carries them through
`scopeResolver.ts` into `si.reasons` and the portal renders them to the
**vendor**. The comment now states the audience and the third-person rule.

**Ruling 3 — three word forms, nine occurrences** (which reconciles the recorded
"three"): `programme`→`program` ×5, `authorised`/`authorisation`→US ×3,
`organisation`→`organization` ×1 (`scopeResolver.ts:612`, an S5 rule and
therefore ≥1.1.0 only). Extended into the app, where two further genuinely
vendor/customer-facing strings were found and corrected:
`app/src/app/portal/page.tsx` ("vendor assurance programme" — read by the
**vendor**) and `app/src/components/vendorAssurance/CuecDeterminationPanel.tsx`.

Left untouched as official external terminology: ISO/IEC 27001:2022
`A.5.13 "Labelling of information"` and `A.8.17 "Clock synchronisation"`, and
NIST CSF `ID.AM-4 "External information systems are catalogued"`.

Reported, not changed — outside the confirmed set, for a separate decision:
`labelled` in the A.5.13 *description*, `programme` in DORA-4's description, and
`organisation` in `app/src/app/signup/SignupForm.tsx` (signup copy, outside the
Vendor Assurance package). Doc comments carrying British spellings were left
alone: they are not strings shown to anyone.

**Ruling 4 — "47" could not be reproduced.** Measured inventory of em-dashes in
SecureLogic-authored vendor-facing content:

| Surface | Strings | Occurrences | Disposition |
|---|---|---|---|
| `coreAssuranceSet.ts` + `scopeResolver.ts` (rule corpus) | 2 | 3 | 1 string rewritten; 1 **frozen**, see below |
| `frameworkTemplates.ts` descriptions | 117 | 146 | **held** |

`CAS-01`'s description carried a matched em-dash pair around an appositive and
was recast as ordinary US prose. No hyphenated compound was touched;
`third-party`, `risk-based` and their kind are correct and were left alone.

**A Section I stop, caught by the repository's own frozen proof.** The
`S4.assurance` rationale also carries an em-dash, and rewriting it **failed the
1.0.0 golden** (`src/api/__tests__/fixtures/scopeResolver-1.0.0.golden.json`,
21 cases pinning rationale text byte-for-byte, whose contract is that
engagements stamped 1.0.0 re-resolve identically). That rule is emitted by the
1.0.0 corpus, so its wording is part of what pre-Q2 customers were told. The
edit was **reverted** and the reason recorded inline at the call site. Reported
for a separate ruling rather than cleaned up here.

The 146 occurrences in `frameworkTemplates.ts` are **held** for the same class of
reason: those descriptions carry the "…would satisfy this" clause, which is
**evidence-sufficiency** guidance. A bulk reword across 117 strings and 12
frameworks is methodology-adjacent, and Section I forbids hiding that inside
editorial cleanup.

## Section I — the correct next canonical version

**"1.3.0" is not it, and no artifact in this repository uses that numbering for
content.**

| Artifact | Current | What it versions |
|---|---|---|
| `question_versions.version` | per-question integer + sha256 `content_hash` | **the canonical content version** (ADR-0013 R3); what the freeze binds to |
| `SCOPE_RULE_VERSION` | `1.2.0` | the applicability **rule** corpus + fact registry |
| `METHODOLOGY_VERSION` | `1.0.0` | the scoring models |
| `CORE_ASSURANCE_SET_VERSION` | `1.0` | the Core Assurance set identity |
| requirement-set | computed hash per org | not a constant |

`SCOPE_RULE_VERSION` must **not** be bumped for wording. It versions rules, and
`scopeResolver` selects the corpus **by the engagement's stamp** — a bump changes
which corpus new engagements resolve against, which is a methodology change.
`CORE_ASSURANCE_SET_VERSION` is FK'd to
`canonical_framework_versions('securelogic-core-assurance','1.0')`, so bumping it
is a migration and provisioning change, not editorial.

That prose is deliberately non-contractual is corroborated by
`src/engine/applicability/v1/contentHash.ts:81`, which hashes
`rule_id`/`inputs_considered`/`outcome` and **excludes** the rationale.

**So the corrected corpus becomes a new version through the existing model, with
no new constant:** the edited template text seeds newly activated frameworks,
and for an existing tenant the correction arrives through audited curation
(`PATCH /api/requirements/:id`), whose next composition publishes
`question_versions` N+1 while the frozen historical items stay on v1. That is
Section H's invariant, enforced by structures that already exist.

**A corollary worth stating plainly:** every requirement insert path is
`ON CONFLICT DO NOTHING` (`frameworkActivation.ts:144`,
`coreAssuranceProvisioning.ts:92`, `templateLoader.ts:296`,
`requirements.ts:166`) or a no-op `DO UPDATE`. Editing the template corpus
therefore **cannot** mutate an existing `requirements` row. The corrected wording
reaches new activations only; it does not reach `[SEED] Walkthrough Org`'s
existing 224 requirements from a code change alone.

---

# Part 3 — R8 as built (owner ruling of 2026-09-05, section K)

R8: a relationship re-intake must never silently mutate the determination or
composition basis of an already-issued engagement; a pre-issue engagement MAY be
explicitly recomposed against the new intake, with provenance.

Three affordances were missing. All three are now built, and none of them
touches the historical freeze — migration `20261091` and the reseed path are
independent, and the reseed is structurally incapable of reaching an issued
engagement (see §R8-1).

## R8-3 — the staleness signal, DERIVED

`src/api/lib/vendorRisk/relationshipBasis.ts` (pure), surfaced on the engagement
read as `relationship_determination`. There is no stored flag: a cached boolean
would be a copy of a comparison between two rows that both already exist, and it
would go stale itself the moment either side moved. It is recomputed per read
from the engagement's own copied columns and `seedFromRelationship`'s current
result — the same helper `createEngagement` uses, so the comparison is against
the values that were actually written, never a re-derivation.

### The nineteen copied fields, and the seventeen that participate

`createEngagement` copies nineteen relationship-derived values onto
`vendor_engagements`. **Seventeen constitute the determination basis and are
compared:**

| # | Basis field | `vendor_engagements` column | Why it is a legitimate input |
|---|---|---|---|
| 1 | `data_sensitivity` | `data_sensitivity` | v1 fact read by the resolver |
| 2 | `data_volume` | `data_volume_band` | v1 fact |
| 3 | `access_level` | `access_level` | v1 fact |
| 4 | `operational_dependency` | `operational_dependency` | v1 fact |
| 5 | `recoverability` | `recoverability` | v1 fact |
| 6 | `business_criticality` | `business_criticality` | v1 fact |
| 7 | `regulatory_exposure` | `regulatory_exposure` | v1 fact |
| 8 | `regulatory_breach_notification` | `regulatory_breach_notification` | v1 fact; the E3 inherent floor trigger |
| 9 | `ai_involvement` | `ai_involvement` | v1 fact |
| 10 | `ai_autonomy` | `ai_autonomy` | v1 fact |
| 11 | `hosting_model` | `hosting_model` | v1 fact |
| 12 | `fourth_party_exposure` | `fourth_party_exposure` | v1 fact |
| 13 | `concentration` | `concentration_snapshot` | v1 fact |
| 14 | `assessment_tier` | `assessment_tier` | the joint tier the questionnaire is composed from |
| 15 | `inherent_score` | `inherent_score` | frozen determination output |
| 16 | `inherent_rating` | `inherent_rating` | frozen determination output; sets promoted finding severity |
| 17 | `inherent_arithmetic_rating` | `inherent_arithmetic_rating` | frozen determination output |

Fields 1–13 are exactly what `v1FactsFromRelationship` produces and what
`resolveScope` reads. Fields 14–17 are the determination the engagement froze at
creation. None is incidental metadata.

**Two are copied but deliberately excluded from the comparison:**

- `inherent_basis` — the explainability envelope FOR the score. It is derived
  from the same thirteen facts already compared, so it carries no independent
  signal, and its JSON shape can legitimately change when the methodology's
  presentation changes. Diffing it would manufacture staleness from formatting.
- `relationship_id` — identity, not basis. If it differed the comparison would
  not be running.

**Nothing else participates.** Not the relationship's `name`,
`service_description`, `is_primary`, `status`, `policy_minimum_tier` or
timestamps, and nothing on `vendors`. Asserted behaviourally: an arm renames the
relationship and rewrites its description, then asserts `stale: false`.

A relationship that can no longer produce a determination (deactivated, intake
withdrawn) is reported as `indeterminate`, never as stale — "we cannot tell" is
not "it changed".

## R8-1 — the reseed

`POST /api/vendor-engagements/:id/reseed-from-relationship`.

**Lifecycle.** Allowed only where `isScopeMutable` — the same gate `POST /scope`
and the inherent override use:

| Allowed | Refused (`409 engagement_basis_locked`) |
|---|---|
| `draft`, `scoping`, `scoped` | `issued`, `in_progress`, `submitted`, `in_review`, `clarification_requested`, `analysis_complete`, `decision_pending`, `decided`, `monitoring`, `closed`, `cancelled`, `expired` |

The refusal names the correct route — open a new engagement — rather than
failing blankly. **`SCOPE_MUTABLE_STATES` and `PORTAL_WRITABLE_STATES` are
disjoint**, so there is no state in which a reseed can run while vendor
responses can be written: the "does not discard vendor responses" requirement
holds structurally, not merely by care.

**Blast radius.** Writes the copied basis columns and nothing else. It does not
resolve scope, issue, or advance the lifecycle, and it does not touch a scope
item, response, evidence row, finding or remediation. The response carries an
explicit `next_step` telling the analyst to run the composition — so the
resulting question set is reviewed BEFORE it becomes the operative scope. That
separation is deliberate: a one-click "rebase and recompose" would collapse two
decisions into one and hide the second.

**Guards.** Reason ≥ 10 characters (`400 reason_required`); a human actor
(`403 human_actor_required` — an API-key integration silently rebasing an
assessment and leaving an anonymous row is what the 20261071 posture exists to
prevent, and it is the same guard WA-2's challenge route uses); a no-op refusal
(`409 basis_current`) so provenance can never record a reseed that changed
nothing; and `FOR UPDATE` on the engagement row so two concurrent reseeds
serialize instead of both claiming the same prior basis.

## R8-2 — the provenance envelope

Migration `20261092_vendor_engagement_relationship_reseeds.sql`
(rollback: `docs/release/ROLLBACK-20261092.sql`).

Carries engagement identity, tenant, `relationship_id`, `prior_basis` and
`new_basis` (the full seventeen on each side, BY VALUE — the relationship is
reclassified on every intake, so a pointer would show today's answer for both
halves of the question), `changed_fields`, `reason`, `reseeded_by_user_id` and
`created_at`.

**Security model.** RLS tenant policy on `organization_id`; `app_request` holds
**`SELECT, INSERT` only** — no UPDATE, no DELETE; append-only through the
**shared** `worm_guard_mutation` (never a private copy, because the single
sanctioned certified-erasure exception lives in that one function); a
ref-integrity trigger refusing any row whose engagement is not in the writing
tenant *and* not bound to that relationship; `reseeded_by_user_id` NOT NULL with
`ON DELETE RESTRICT`; `changed_fields` non-empty by CHECK; `reason` 10–4000 by
CHECK. Registered in `dataClassification.ts` as category C.

Release rollback drops the table — acceptable as release mechanics, and the file
states plainly what that destroys. Runtime behaviour stays append-only
regardless of the grant, because the WORM guard refuses first.

## R8 tests

`test/isolation/wa3RelationshipReseed.test.ts` — **13/13**, against real
Postgres, through the real routes with the Content-Type gate in front and real
user sessions.

| Owner's # | Covered by |
|---|---|
| 1 unchanged basis ⇒ not stale | "an engagement whose relationship has not moved is NOT stale" |
| 2 fact change ⇒ stale | "a real fact change makes it stale and names the fields" |
| 3 tier-impacting change ⇒ stale | same arm; asserts `assessment_tier` moves off `tier_1_critical` |
| 4 non-basis metadata ⇒ no false staleness | "renaming the relationship does NOT make the engagement stale" |
| 5 allowed in each mutable state | loops `draft`, `scoping`, `scoped` |
| 6 refused in immutable states | loops `issued`, `in_progress`, `submitted`, `analysis_complete`, `decided`, `closed`; asserts 409, byte-equal basis before/after, and zero provenance rows |
| 7 updates only the copied basis | asserts the moved columns and that scope items are byte-equal |
| 8 does not resolve/issue | scope items unchanged, status unchanged, `next_step.action === "resolve_scope"` |
| 9 reason < 10 rejected | 400 + zero provenance rows + still stale |
| 10 valid reason accepted | 200 with the provenance row |
| 11 provenance completeness | prior basis, new basis, changed fields, reason, actor, time, relationship id |
| 12 tenant-scoped | org B cannot read or write; no row crosses orgs |
| 13 cross-org denied | same arm, both directions |
| 14 app path cannot mutate/delete | WORM refuses UPDATE and DELETE; `role_table_grants` shows exactly `["INSERT","SELECT"]`; row unchanged after both attempts |
| 15 responses/evidence/findings preserved | a response is written directly and asserted intact — see the caveat below |
| 16 API surfaces stale state | `relationship_determination` asserted on the real engagement read |
| 17 analyst reviews before advancement | after the reseed the composition is run explicitly and only then is the basis current |

**Caveat on #15, stated rather than omitted.** A vendor response cannot exist on
a scope-mutable engagement through the product path, because
`SCOPE_MUTABLE_STATES` and `PORTAL_WRITABLE_STATES` are disjoint — which is a
stronger guarantee than the assertion. The arm therefore writes a response row
directly and proves the reseed's UPDATE does not reach it; it tests blast
radius, not a reachable state.

Plus `app/src/components/vendorEngagements/__tests__/relationshipDeterminationNotice.render.test.tsx`
— **8/8**, including the arm that matters most: on an ISSUED engagement the
notice still reports what changed but renders **no** rebase control and points
at opening a new engagement.

## R8 behavioural flow, end to end

`RelationshipDeterminationNotice` on the engagement page:

1. the analyst sees that the relationship has been re-assessed since the
   engagement was opened;
2. a disclosure lists each changed field with the engagement's value beside the
   relationship's current one, in analyst language rather than column names;
3. pre-issue, an explicit rebase control is offered — never a default, never
   automatic;
4. the reason is required, with the ten-character floor mirrored from the engine
   so the refusal is visible before submission;
5. the engine records prior basis, new basis, changed fields, actor, time and
   reason;
6. on success the engine's own next-step sentence is shown: run the composition
   to see the resulting question set before it replaces the current scope;
7. on an issued engagement the control is absent and the copy says to open a new
   engagement instead.

---

# Part 4 — deployed-staging validation

## Historical non-mutation, on the real population

Migration `20261091` ran for the first time against real data during the
staging deploy of develop `ab5283b2`. The pre-bridge capture was taken at
`2026-09-05T10:56:17Z`, before the deploy; the post-bridge capture at
`13:07:22Z`, after it.

| Invariant (owner ruling §G) | Result |
|---|---|
| 7/7 engagements accounted for | PASS |
| 93/93 items accounted for | PASS |
| 51/51 answered items accounted for | PASS |
| No population item left unstamped | PASS (0) |
| 93/93 bound to **version 1** | PASS |
| 0 bound to any other version (the A1.1 v2 trap) | PASS |
| 51 responses bound, none orphaned or added | PASS |
| 57 revisions bound | PASS |
| No cross-tenant version binding | PASS (0) |
| The SAME 93 items, none added or dropped | PASS |
| **100% render byte-identical content before vs after** | **PASS** |
| Every answered item's response bound to the frozen version | PASS |

Re-verified after a second and third deploy: still 93 bound to v1, so the
migration is genuinely idempotent rather than merely once-correct.

## The curation experiment — both halves of the durable invariant

The whole WA-3 thesis, run against deployed staging on `CC6.1`
(`d57c402e…`), a requirement genuinely inside the frozen population, on frozen
engagement `8de82330`:

1. the canonical requirement text was **curated** through the real admin route;
2. **HALF 1** — the frozen engagement rendered **byte-identical** content
   afterwards. Before migration `20261091` it would not have: an unstamped item
   reads `COALESCE(qv.guidance, r.description)`, so the curation would have
   silently rewritten 93 already-answered questions;
3. **HALF 2** — a NEW composition made after the curation rendered the
   **corrected** text and was bound to a **new immutable version**
   (`63a177b8` ≠ `0808e4fb`);
4. the canonical text was restored.

`CC6.1` now carries v1 (235 chars, published `2026-08-28T18:06:54Z`, what all 93
frozen items point at) and v2 (257 chars, `2026-09-05T13:56:04Z`, the curated
text), with the canonical description restored to match v1. Append-only history
kept every step — that is the mechanism working, not damage.

The negative control for this lives in the isolation suite: the arm that asserts
a bound item does not move under a corpus edit **while a deliberately-unbound
one does**.

## R8 provenance, written through the real UI

Four `vendor_engagement_relationship_reseeds` rows were written by the browser
journey, each carrying a **17-field** `prior_basis` and `new_basis`, a named
human actor, a reason, and `tier_1_critical → tier_4_low`.

**15 of 17** fields are reported as changed. `ai_involvement` and `ai_autonomy`
were `none` in both the high and low fixtures and are correctly absent — live
evidence that the comparison reports genuine movement rather than flagging the
whole basis.

Schema verified on staging: RLS enabled, `app_request` holds exactly
`{INSERT, SELECT}`, two shared `worm_guard_mutation` triggers.

## Three defects found by browser validation

None of these could have been caught by a unit or isolation test.

1. **The component unmounted itself on success.** `if (!determination.stale)
   return null` ran before the success message was considered, so the
   `revalidatePath` that followed a successful rebase made the analyst's
   next-step guidance vanish mid-read — the one instruction R8-1 exists to give.
2. **A redundant `router.refresh()` cancelled its own action stream.** There was
   only ever ONE POST: the server action. The action already calls
   `revalidatePath`, so Next streams the revalidated page back in that same
   response, and refreshing on top superseded the stream mid-flight. The user
   saw the right thing, but the request logged as aborted — indistinguishable
   from a mutation that failed. It was a Heisenbug: attaching request listeners
   perturbed the timing enough to let the stream finish, so the journey passed
   *because it was being observed*.
3. **The harness degraded the environment it validated.** The journey created a
   new vendor per run and walked the staging org into its 75-monitored-entity
   plan limit (`entity_limit_reached`). It now reuses one harness vendor and
   creates only fresh relationships, which carry no such limit.

## Operational finding — journey fixture debt

`[SEED] Walkthrough Org` holds **74 vendors + 1 AI system = 75/75**, at the plan
limit. **38 are journey fixtures**: WA1 9, WA2 17, WA3 12. WA-3's journey no
longer adds to this, but the existing fixtures remain and the org has no
headroom for new monitored entities. Reported, not acted on: deleting staging
data was not authorized and is not required for WA-3.

## Browser validation at the final SHA

Deployed staging, both services live on develop **`9f870a12`**
(`securelogic-engine-staging` and `securelogic-app-staging`, verified by deploy
API before each run).

| Run | Result |
|---|---|
| Chromium `20260905T143639` | **32/32** |
| WebKit `20260905T143740` | **32/32** (zero failed requests of any kind) |
| Chromium `20260905T143844` (stability re-run) | **32/32** |

Thirty-two arms per run, covering:

- **Ruling 1** — 6 arms: the rationale renders for the vendor on 79 questions;
  no scope-rule id in the markup; none in the captured
  `/vendor-portal/questions` payload; and a non-vacuity arm asserting
  `why_we_are_asking` is present, so the negative assertions cannot pass against
  an empty payload.
- **Internal provenance** — the analyst composition payload still carries
  `rule_id`, returning a real value (`S1.baseline`).
- **R8-3** — staleness reported on both a pre-issue and an issued engagement,
  fields itemised, the engagement's value shown beside the relationship's.
- **R8-1** — the control is disabled until a reason is given; the basis moves to
  `tier_4_low`; the analyst gets the next-step sentence; and the composition's
  **content hash and `history_count` are unchanged**, proving it was not
  silently re-run.
- **R8 refusal** — the issued engagement shows the notice, names "open a new
  engagement", and offers **no** rebase control.
- **Freeze** — integrity verdict `match`; 79/79 newly composed items bound to an
  immutable content version.
- **Hygiene** — no client-side exceptions; no failed request other than
  navigation-cancelled GET prefetches (Chromium 21–23, WebKit 0); and no aborted
  POST.

The aborted-POST arm is asserted separately from the tolerated prefetch class,
because a cancelled mutation is indistinguishable from a failed one in a log.
It is what surfaced the `router.refresh()` defect, and it is green three runs
running.
