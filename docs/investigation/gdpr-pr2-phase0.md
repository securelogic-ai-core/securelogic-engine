# GDPR PR #2 — Phase 0 enumeration (export engine)

**Date.** 2026-06-12
**Workstream.** GDPR/CCPA Data Subject Rights (Arts. 15 / 17 / 20).
**Predecessor.** PR #1 (`cec1274b`) — schema + classification foundation
(`docs/DATA_CLASSIFICATION.md`, `src/api/lib/dataClassification.ts`,
`src/api/__tests__/dataClassification.test.ts`).
**This PR.** #2 — the export engine. Split into **#2a** (query + streaming core,
this commit set) and **#2b** (bundle/zip orchestration, manifest, org-wide loop,
R2 attachment streaming). See "Split" below.

This document is the durable trail for the architectural enumeration that drove
the #2a/#2b design decisions. It is committed alongside the #2a implementation so
future sessions can reference the reasoning without re-deriving it. This is the
established pattern for documenting architectural enumeration in this workstream
(cf. `docs/investigation/e1-g1-harness-first-run-2026-05-21.md`).

---

## 1. Architecture decisions (Q1–Q10, ratified)

| # | Decision |
|---|---|
| **Q1** | **Consumption inside the `withTenant` callback.** The bundle generator drives row consumption *inside* the per-tenant scope; the sink (zip/file writer) is passed in. No yielding a stream/iterator that outlives the `withTenant` scope — the connection must not be referenced after the callback returns. |
| **Q2** | **Per-table short `withTenant` scopes.** Connection-pool hygiene wins over cross-table snapshot consistency. Table-to-table consistency is **best-effort** and documented as such in code. |
| **Q3** | **Runtime-probe `information_schema`** for `dependency_assessments.reviewer_uuid` before SELECTing it. Do **not** fix the guarded-DO-block migration in this PR; migration hygiene is a separate later PR. |
| **Q4** | Add `vendor_assurance_documents.approved_by_user_id` to `userRefColumns` in **both** `DATA_CLASSIFICATION.md` and `dataClassification.ts` (this PR). |
| **Q5** | C-table actor match is **UUID OR email**: `(uuid_col = $userId OR text_col = $userEmail)`. The legacy TEXT `reviewer_id` columns are matched by email; the UUID columns by id. |
| **Q6** | Email-keyed Category-E tables are **included in self-export by current email**. New classification dimension `exportByEmailOnly: true` distinguishes "delete=leave, export=include-by-email" tables from pure E. Tables: `subscribers`, `intelligence_brief_subscribers`, `newsletter_deliveries`. `email_suppressions` stays **pure E** (excluded per O-8). Historical email matching is **not** supported (no email history tracked) — documented in `gdpr_note`. |
| **Q7** | Include `ip_address` and `user_agent` for the subject's own rows in `security_audit_log` and `legal_consents` — the subject's own data under Art. 15. (Full-row `SELECT *` achieves this; see §4 conflict note.) |
| **Q8** | **DB-driven attachment enumeration.** Enumerate from `vendor_assurance_documents` rows and stream each PDF by `storage_key`. No S3 `ListObjectsV2` wrapper. (#2b.) |
| **Q9** | **NDJSON** for data files, **JSON** for the manifest. Reflected in `DATA_CLASSIFICATION.md` and noted in the manifest `gdpr_note` (how to convert). |
| **Q10** | Introduce a **`RowStreamer`** abstraction: cursor-backed in prod, array-backed in tests. |

---

## 2. Schema facts established (verified against `db/migrations/`)

### 2.1 Actor-column types (drives Q5 matching)

`reviewer_id` is **two different types** depending on the table:

- **UUID** `reviewer_id` (FK → `users(id)`, matched by `$userId`):
  `control_assessments`, `vendor_assessments`, `governance_reviews`.
- **Legacy TEXT** `reviewer_id` (no FK, may hold a raw email/name, matched by
  `$userEmail`) — the five tables from `20260503_reviewer_id_uuid_fk.sql`:
  `risk_treatments`, `obligation_assessments`, `vendor_reviews`,
  `ai_governance_assessments`, `dependency_assessments`.

Those five also carry a **UUID** `reviewer_uuid` (added 20260503). So their actor
predicate is `(reviewer_uuid = $userId OR reviewer_id = $userEmail)`.

All other C-table actor columns (`owner_user_id`, `created_by`,
`created_by_user_id`, `assessed_by`, `decided_by_user_id`, `updated_by_user_id`,
`accepted_by_user_id`, `dismissed_by_user_id`, `*_by_user_id`) are **UUID** →
`$userId`.

The legacy-TEXT-email set is encoded explicitly in `categoryQueries.ts`
(`LEGACY_TEXT_ACTOR_COLUMNS`), keyed by `(table → [column])`, because
`reviewer_id` alone is ambiguous (UUID in `control_assessments`, TEXT in the five).

### 2.2 `dependency_assessments.reviewer_uuid` — may not exist (drives Q3)

`20260503_reviewer_id_uuid_fk.sql` adds `reviewer_uuid` inside a guarded
`DO $$ … $$` block that branches on whether the table was historically named
`dependency_reviews` vs `dependency_assessments`. On some deployment lineages the
column landed on the now-renamed table, not on `dependency_assessments`. Hence the
**runtime `information_schema` probe** before emitting `reviewer_uuid` in the
`dependency_assessments` predicate. The probe degrades gracefully: if the column
is absent, the predicate falls back to `reviewer_id = $userEmail` only.

### 2.3 Email-keyed tables (drives Q6)

- `subscribers` — `email TEXT NOT NULL UNIQUE`. **Platform-level, no
  `organization_id`** → email is the *sole* key (no tenant scoping possible).
- `intelligence_brief_subscribers` — keyed by `(organization_id, email)`.
- `newsletter_deliveries` — holds `subscriber_email TEXT NOT NULL`.
- `email_suppressions` — email-keyed but **excluded** (O-8: deleting/exporting a
  suppression risks re-enabling mail to a bounced/complained address; pure E).

### 2.4 Attachments (drives Q8, #2b)

`vendor_assurance_documents` rows carry `storage_key` (R2 object key under
`org/{orgId}/vendor-assurance/`). Org-export enumerates these rows and streams
each PDF by key. No bucket listing.

---

## 3. Category → query mapping (self-export)

| Cat / dimension | Tables | Predicate |
|---|---|---|
| **A** — user PII root | `users` | `id = $userId` (full row) |
| **B** — user-scoped | `user_alert_preferences`, `alert_sends`, `dashboard_preferences`, `legal_consents`, `org_invites` | `<userRefColumn> = $userId` |
| **B — excluded** | `password_history` | **never exported** (password hashes) |
| **C** — authored content | all Category-C tables | OR over actor columns: UUID cols = `$userId`, legacy TEXT cols = `$userEmail` |
| **email-keyed** (`exportByEmailOnly`) | `subscribers`, `intelligence_brief_subscribers`, `newsletter_deliveries` | `<emailColumn> = $userEmail` |
| **historical authorship** (O-1) | `security_audit_log` | `actor_user_id = $userId` (full row, incl. `ip_address`) |

Org-scoping (`organization_id = $orgId`) is **not** duplicated into the WHERE
clauses — it is the `withTenant(orgId)` callback's responsibility (Q1/Q2). The
one table this cannot cover is `subscribers` (platform-level, no org column),
where the unique email *is* the boundary.

`dashboard_preferences` rows with `preference_type = 'org_default'` have
`user_id = NULL` (effectively Category D) and are naturally excluded by
`user_id = $userId`.

---

## 4. ⚠️ Doc/decision-vs-code conflict surfaced (must be noted, not silently fixed)

**Q7 says** to include `ip_address` **and** `user_agent` for the subject's rows in
both `security_audit_log` and `legal_consents`.

**Schema reality:**
- `legal_consents` has **both** `ip_address` (INET) and `user_agent` (TEXT).
- `security_audit_log` has `ip_address` (TEXT) **but no `user_agent` column**
  (`user_agent` was only ever added to `legal_consents` in
  `20260610_legal_consents.sql`; `security_audit_log` from `20260505` +
  `20260527_audit_actor_user.sql` never received it).

**Resolution in #2a:** the export uses full-row `SELECT *`, so it includes exactly
the columns that exist — `ip_address` from `security_audit_log`, and both
`ip_address` + `user_agent` from `legal_consents`. The intent of Q7 is satisfied
without referencing a non-existent column. **No code asks for
`security_audit_log.user_agent`.** Flagged here so the Q7 wording is not later
mistaken for a column that should exist.

---

## 5. PR #2a scope (this commit set)

**New — `src/api/services/dataExport/`:**
- `types.ts` — `ExportSubject`, `ExportQuery`, `RowStreamer`, `QueryRunner`,
  sketched `ManifestEntry` type (no impl).
- `rowStreamer.ts` — `RowStreamer` interface + `CursorRowStreamer` (pg-cursor) +
  `ArrayRowStreamer` (tests).
- `ndjsonTransform.ts` — object-mode → newline-delimited JSON `Transform`
  (+ pure `rowToNdjsonLine`).
- `categoryQueries.ts` — A / B / C / email-keyed query builders.
- `historicalAuthorship.ts` — `security_audit_log` actor query.
- `dependencyAssessmentsProbe.ts` — `information_schema` probe.
- `index.ts` — barrel.
- `__tests__/` — array-backed unit tests.

**New — `src/api/types/pg-cursor.d.ts`** — local ambient shim (no
`@types/pg-cursor` exists; pins to upstream `pg-cursor@2.20.0`). Placed under
`src/api/**` so it falls inside the `tsconfig.prod.json` include globs.

**Modified:**
- `docs/DATA_CLASSIFICATION.md` — Q4, Q6, Q9.
- `src/api/lib/dataClassification.ts` — Q4, Q6 (`exportByEmailOnly`).
- `src/api/__tests__/dataClassification.test.ts` — coverage-drift: every B/C and
  `exportByEmailOnly` table must have a query builder.
- `package.json` — `pg-cursor` dependency.

**Explicitly deferred to #2b:** `archiver` dep, `bundleGenerator.ts`,
`manifest.ts` implementation, `orgExportIterator.ts`, R2 PDF streaming.

---

## 6. Open items carried forward

1. **Q7 wording vs `security_audit_log.user_agent`** (§4) — documented, benign
   under `SELECT *`. No action in #2a.
2. **Guarded-DO-block migration hygiene** (`20260503`) — separate later PR (Q3).
3. **#2b** — bundle/zip orchestration, manifest builder, org-wide outer loop,
   R2 attachment streaming (Q8).
</content>
</invoke>
