# VA-Q1 — Versioned questionnaire foundation: implementation plan

**Status:** **VA-Q1 COMPLETE 2026-08-28** — P1 #898, P2 #900, P3 #901 STAGING VERIFIED; P4 hardening merged. Every acceptance criterion in §G has a named proof. Q2 (fact registry, S5 domain activation) is the next increment and needs its own plan. · **Governs:** ADR-0013 R1, R3 · **Design:** VA-Q0 §4.1, §4.4, §9, §15
**Baseline:** `develop` @ `e773b6a8` (2026-08-28) · **Owner directive:** proceed into implementation in small reviewable packages without a further conceptual approval cycle.

## Objective

Establish the safe, versioned, content-addressed questionnaire foundation
**without changing today's customer-visible questionnaire content.** After Q1:

- requirements remain canonical and untouched;
- every vendor-facing question is a separately addressable, immutable
  `question_versions` row with many-to-many lineage to requirements;
- issued assessments are content-addressed and cannot change when the library
  changes;
- day-one questionnaires are content-equivalent to today's, via a bridge.

Q1 does **not** deliver domains, facts, branching, evidence rules, profiles or
AI analysis. It does not use `evidence_links` (that is Q3, after ADR-0012
T2-A). It does not need VA-S1a (#878): Q1 adds no unauthenticated surface.

## C. Baseline and D. dependency analysis

| Dependency | Needed by Q1? | State | Action |
|---|---|---|---|
| VA-E2E-1 (#896, #876) | yes — Q1 changes the portal question read and the R1 responses read | merged, staging-verified | none |
| ADR-0012 `evidence_links` (slots 51–55, T2-A) | **no** — Q1 does not link evidence to questions | authorised, unbuilt | Q3 prerequisite only |
| VA-S1a #878 (exchange rate limiter) | **no** — Q1 adds no unauthenticated route | held | Q3 prerequisite only |
| VA-C1/P1/D1 (slots 56–58, held) | no schema overlap; C1/D1 touch invites/participants, not scope items | held | none; Q1 slots avoid 50–58 |
| `requirement_set_version` hash (`methodologyVersion.ts`) | reused — Q1 adds `question_set_hash` alongside | built | none |
| Migration runner keys on filename | Q1 slots above 20261049 apply in order | built | none |

**No genuine blocking architectural issue.** One design decision made here:
bridge questions are created **lazily and idempotently at composition time**
(`ensureBridgeQuestions`) plus a one-shot backfill — not by hooking the three
separate requirement insert paths (`requirements.ts`, `frameworkActivation.ts`,
`templateLoader.ts`). Hooking inserts would leave a fourth path un-hooked one
day; lazy-ensure cannot miss.

## E. Migration slots — verified against the ledger 2026-08-28

Scan: `develop` tops at `20261049`; 51–55 ADR-0012; 56–58 on
`feat/va-c1-vendor-contacts` and `feat/va-d1-questionnaire-delegation`;
**nothing ≥ 20261059 on any of 342 remote branches.**

| Slot | File | Package |
|---|---|---|
| `20261059` | `questionnaire_content_primitives.sql` — `questions`, `question_versions`, `question_requirement_links`; RLS; grants; immutability triggers | P1 |
| `20261060` | `questionnaire_version_addressing.sql` — `question_version_id` on `vendor_engagement_scope_items`, `requirement_responses`, `requirement_response_revisions`; `question_set_hash` on `vendor_engagements`; indexes | P2 |
| `20261061` | `questionnaire_bridge_backfill.sql` — data-only, idempotent: one bridge question + v1 + link per (org, requirement); stamps `question_version_id` on existing scope items/responses; computes `question_set_hash` for existing engagements | P3 |
| `20261062`, `20261063` | **held in reserve** for Q1 defect follow-ups; released to Q2 if unused | — |

Rollback SQL for 59–61 ships in `docs/release/ROLLBACK-20261059-20261061.sql`
with each package (R-1 convention). 59 and 60 are additive (DROP is the
rollback); 61 is data-only and its rollback NULLs the stamped columns — the
requirement-keyed read path remains intact throughout Q1, so a code rollback
to the previous SHA is always sufficient.

## F. Implementation packages / PR boundaries

Each package = one PR, small enough to review in one sitting, merged through
the protected process (trial merge → affected tests → fresh CI → true merge
commit → exact-head CI → staging deploy → behavioural check → matrix update).

### P1 — Content primitives (slot 20261059) — **DONE: STAGING VERIFIED 2026-08-28**
- Tables per VA-Q0 §4.1. `question_versions` gets a `BEFORE UPDATE OR DELETE`
  trigger that raises (`question_versions_immutable`). `content_hash` = sha256
  over canonical JSON `{prompt, guidance, answer_type, options, evidence_policy}`
  computed in code (`questionContentHash.ts`), asserted equal by a DB CHECK on
  length only (hash logic stays in one place).
- `dataClassification.ts` entries (category C; `question_versions` holds no
  PII; `questions.created_by_user_id` is a user ref).
- Admin routes, all `requireEntitlement("premium")`, all `asTenant`, pinned in
  `teamTierEntitlements.test.ts` gate count:
  `GET/POST /api/questions`, `GET /api/questions/:id`,
  `POST /api/questions/:id/versions` (publish = new immutable version),
  `POST/DELETE /api/questions/:id/links`, `PATCH /api/questions/:id` (status
  only — content changes are versions).
- Publish validation: ≥1 link; `answer_type='select_*'` requires options each
  with `maps_to_status` in the closed status vocabulary; prompt non-empty ≤ 2000.
- **Tests:** unit (hash determinism, canonicalisation, validation); isolation
  (RLS proof; cross-org 404 on every route; UPDATE/DELETE on a version raises;
  org-B `requirement_id` in a link → 404; malformed content → 400 with field
  names; portal cookie on every admin route → 401/403/404; API-key-without-
  premium → 403); assembled-app (every route JSON-only: multipart → 415).
- **No customer-visible change.** Nothing reads the new tables yet.

### P2 — Version addressing (slot 20261060) — **DONE: STAGING VERIFIED 2026-08-28 (#900 @ `c9531cf1`)**
- Nullable `question_version_id` on scope items, responses, revisions (FK →
  `question_versions`, `ON DELETE RESTRICT`). `question_set_hash TEXT NULL` on
  `vendor_engagements`.
- `resolveScope` writes both `requirement_id` and `question_version_id`
  (via `ensureBridgeQuestions` → current version of the bridge question for
  each requirement). `question_set_hash` computed over ordered
  `(question_version.content_hash, depth, mandatory)` and stamped at **issue**
  (the moment scope freezes), never rewritten.
- Portal `getPortalQuestions` and `savePortalAnswer`, and the R1
  `listEngagementResponses`, read **version text when present, requirement
  text when absent** (pre-backfill rows). Response/revision inserts carry the
  version id.
- `GET /api/vendor-engagements/:id/integrity` — recomputes the hash from
  stored items and reports `match | drift | unstamped`.
- **Tests:** golden — same scope → identical hash across runs; editing a
  requirement's title/description **after issue** leaves the portal question
  text and the hash unchanged (the ADR-0013 R3 proof); editing before issue is
  reflected (bridge re-versions on next composition); cross-org integrity
  route → 404; a scope item cannot reference a version from another org
  (RLS + explicit test); **existing VA E2E suites unchanged and green**
  (`vendorPortalAdversarial`, `vendorPortalUploadAdversarial`,
  `vendorEngagementResponsesRead`, `vendorEngagementsRls`).
- **Customer-visible change: none.** Same text, same order, same counts.

### P3 — Bridge backfill + equivalence proof — **AMENDED during P2 (no schema; slot 20261061 released to reserve) — DONE: STAGING VERIFIED 2026-08-28 (#901 @ `7d7d9eb9`)**

> **Amendment (2026-08-28, during P2).** The original P3 stamped a bridge
> version onto EXISTING issued engagements' scope items. That would record
> today's requirement text as "what was asked" for questionnaires issued
> before P2 — and the text may have changed since. That is a fabricated
> history, the exact thing ADR-0013 R3 exists to prevent. So P3 does NOT stamp
> historical issued engagements: they stay `unstamped` in `/integrity`, render
> through the requirement fallback, and say so. Pre-issue engagements need
> nothing — their next scope resolution versions them (P2). What P3 still does:
> bridge every activated requirement eagerly (a TS script, `scripts/va-q1-bridge-all.ts`,
> idempotent, prod-refusing — not a SQL migration, so the ONE content-hash
> implementation is reused rather than re-implemented in SQL), ship the
> coverage query, and run the equivalence proof. Slot 20261061 is therefore
> unused by Q1 and returns to the reserve.
- Idempotent SQL: for every `(organization_id, requirement)` without a bridge
  question, insert `questions(question_key='req:'||framework_id||':'||reference_id, origin='securelogic', status='active')`,
  `question_versions v1 (prompt=title, guidance=description, answer_type='attest', evidence_policy='optional', content_hash)`,
  one `evidences` link. Stamp existing scope items / responses / revisions with
  the matching v1 id. Compute `question_set_hash` for every engagement with
  status ≥ `issued`. Re-runnable: every insert is `ON CONFLICT DO NOTHING`,
  every stamp is `WHERE question_version_id IS NULL`.
- `scripts/validation/va-q1-bridge-equivalence.ts`: for every engagement on
  the target DB, renders the portal question list **before** (requirement
  path) and **after** (version path) and asserts byte-equality of
  `(reference, title, guidance, order)`. Runs on the harness DB in CI and on
  staging as the acceptance step (§H).
- **Tests:** run backfill twice → identical row counts (idempotency); a
  requirement edited after backfill produces a v2 on next composition and
  leaves issued engagements on v1; historical engagement reproducibility —
  responses read against the stamped version text, not current.

### P4 — Hardening and matrix (no schema) — **DONE (this PR)**

> **Rollback rehearsal — DONE 2026-08-28 on the harness DB populated by the P2/P3
> suites** (2 questions, 3 versions, 9 stamped items, 10 stamped engagements):
> `ROLLBACK-20261059-20261061.sql` exit 0; all three tables and all four
> columns gone; the verbatim `e773b6a8` portal query still rendered 10 rows on
> the rolled-back schema; forward re-apply of 20261059 + 20261060 exit 0 and
> data-free. Code rollback (previous SHA) remains sufficient on its own.
- Adversarial additions the directive names that P1–P3 do not already cover:
  identifier manipulation (swap a version id for a *different question in the
  same org* on a response write → 409 `version_not_in_scope`); mapping
  tampering (link a question to a requirement of a framework the org has not
  activated → 404); attempts to mutate an issued snapshot through every write
  route → 409 `scope_frozen`; unauthorised version creation via portal session
  and via a `member`-role user (role gate: publish requires `admin`).
- Rollback rehearsal on the harness DB: apply 59–61, run equivalence, apply
  rollback SQL, run the pre-Q1 suites.
- VA-Q0 §18 matrix rows B, C, G(text+hash) → IMPLEMENTED → TESTED; staging
  step moves them to STAGING VERIFIED.

## G. Security / test matrix (acceptance criteria → proof)

| Required guarantee | Package | Proof |
|---|---|---|
| requirements remain canonical | P1–P3 | no migration touches `requirements`; `git diff --stat` on the table's migrations is empty; bridge questions *link to* requirements |
| vendor questions separately addressable | P1 | `question_versions.id` is what portal/R1 render |
| mappings preserve lineage | P1 | publish requires ≥1 link; lineage query test framework→requirement→question |
| immutable versions | P1 | trigger raises on UPDATE/DELETE; test asserts SQLSTATE |
| content-addressed snapshots | P2 | `question_set_hash` stamped at issue; integrity route |
| issued assessments cannot mutate on library change | P2, P3 | edit-after-issue golden test; equivalence script |
| historical assessments reproducible | P3 | responses render against stamped version |
| existing content survives bridge without regression | P3 | byte-equality equivalence on harness and on staging |
| deterministic hash | P1, P2 | canonicalisation unit tests; same input → same hash across processes |
| tenant isolation | P1, P2 | RLS proof per table (`testDb` harness) |
| object-level authorisation | P1, P2, P4 | every id from org B → 404; same-org wrong-engagement → 409 |
| no cross-tenant version/snapshot access | P1, P2 | explicit negative tests on versions, links, integrity route |
| safe, idempotent migration | P3 | double-run test; `ON CONFLICT DO NOTHING` / `IS NULL` guards |
| rollback / recovery | P4 | rehearsal on harness; ROLLBACK SQL shipped |
| existing VA E2E green | every | the six VA isolation suites + app suites in every PR's CI |
| **adversarial — the directive's eight classes** | P1, P2, P4 | cross-tenant questionnaire · cross-tenant version/snapshot · identifier manipulation · issued-snapshot mutation · mapping tampering · malformed content · unauthorised creation/modification · post-library-change historical mutation — one named test each, listed in the PR body |
| assembled-app middleware | P1, P2 | every new route through `createApp()`; JSON-only routes 415 multipart |

## H. Staging acceptance procedure (per package, after deploy)

1. Confirm both staging services live on the exact merged head
   (`/api/version` + Render deploy record).
2. **P1:** create a question, publish a version, link it, attempt UPDATE via
   a second version — verify the first is unchanged; org-B id → 404;
   portal cookie on `/api/questions` → 401.
3. **P2/P3:** on the existing `[VA-E2E-2]` (monitoring) and B.4 Harbourline
   (issued) engagements: run the equivalence script against staging (read-
   only) — byte-equal; open `/vendor-engagements/<id>` — identical text;
   `GET .../integrity` → `match`; then **edit a bridged requirement's
   description** via the UI and re-check both engagements → unchanged, and
   `integrity` still `match`. Open a *new* engagement → the edit is visible
   there (bridge re-versioned).
4. Re-run the 29-step VA walkthrough shape on a fresh engagement (internal +
   portal) — all PASS.
5. Update VA-Q0 §18 rows to STAGING VERIFIED with the head SHA and date.

Testers on the current product (B.3/B.4) are not paused for Q1: P1 is
invisible to them, and P2/P3 are content-equivalent by proof before they
deploy. Tester feedback is filed as evidence against VA-Q0 requirements; it
does not alter ADR-0013 without a new ruling.

## I. Blocking issues

None. Two non-blocking notes for the record:
- `question_key` for bridge rows embeds `framework_id` (a UUID) because
  `reference_id` is unique only per framework. Curated SecureLogic questions
  use human keys (`ai.training.customer_data`); the two namespaces never
  collide because bridge keys are prefixed `req:`.
- The equivalence proof compares rendered fields, not row ids — a bridged
  question is "the same content", not "the same row".
