# GDPR/CCPA PR #2b — Phase 0 Investigation

**Export engine: bundle/zip orchestration + manifest + R2 attachments + executor.**
Read-only enumeration pass. Durable trail (same pattern as `gdpr-pr2-phase0.md`).

- Branch point: `origin/develop` `8e30192…` (contains PR #2a, squash of #184).
- `origin/main` `81afe31f…` (PR #2a live in prod 2026-06-12).
- PR #2b does **not** branch until Phase 1 is authorized.

---

## 1. What PR #2a shipped (the contracts #2b consumes)

`src/api/services/dataExport/` (the engine is the first and only thing under `services/`; every other "service" in this repo is a function module in `src/api/lib/`):

| File | Reusable contract |
|---|---|
| `index.ts` | `buildSelfExportQueries(subject, opts, tableColumns) → ExportQuery[]` (order A→B→C→email-keyed→historical authorship). Trust-model JSDoc = the security spec. |
| `categoryQueries.ts` | `buildCategoryQueries`, `buildProjection` (fail-closed secret omission), `EXPORT_EXCLUDED_TABLES` (currently `{password_history}`), `CategoryCOptions.dependencyAssessmentsReviewerUuidPresent`. |
| `historicalAuthorship.ts` | `buildHistoricalAuthorshipQuery(subject)` — `security_audit_log` by `actor_user_id`. |
| `rowStreamer.ts` | `CursorRowStreamer(client, text, values)`, `ArrayRowStreamer(rows)`, `drainRows`. |
| `ndjsonTransform.ts` | `createNdjsonTransform()`, `rowToNdjsonLine(row)`. |
| `columnProbe.ts` | `buildTableColumnsMap(run)`, `tablesRequiringProjection()` → `['users','org_invites']`. |
| `dependencyAssessmentsProbe.ts` | `dependencyAssessmentsHasReviewerUuid(run)` (Q3). |

**Sketched / to finish in #2b:** `ManifestEntry` (types.ts) is a stub (`{table,category,rowCount,file}`) — expand to carry `sizeBytes` + `sha256` and add top-level `Manifest`, `ManifestAttachment`, `ExportResult`, `ExportScope`.

**Integration seam:** inside `withTenant`, the `PoolClient` for `CursorRowStreamer` is `requireTenantContext().client` (in-transaction, `app.current_org_id` already set).

---

## 2. Infra facts that constrain the design

- **`withTenant(orgId, fn)`** (`infra/postgres.ts`) opens ONE transaction, sets `app.current_org_id`, runs `fn`, **COMMITs and `release()`s on return**. The cursor must be drained + closed before the callback returns (Decision Q1/Q2).
- **`requireTenantContext()`** throws if no scope is active — the fail-closed gate (Invariant A).
- **R2:** `getVendorAssurancePdfStream({organizationId, documentId})` lives in `lib/vendorAssuranceStorage.ts` (NOT `blobStorage.ts`), returns AWS SDK `GetObjectCommandOutput` whose `.Body` is the Node `Readable`. Key shape `org/{orgId}/vendor-assurance/{documentId}/original.pdf`; `assertKeyBelongsToOrg()` (private in `blobStorage.ts`) enforces the prefix.
- **`schema_migrations` is owner-only** — `app_request` has NO grant (`20260618_create_app_request_role.sql:76,233`). The `schema_version` read MUST use the elevated/owner channel (`withElevated`/`pgElevated`).
- **`archiver` is not a dependency** (zero zip libs present). Add `archiver` (MIT, Node ≥14, streams Readables, `finalize()` returns a Promise, emits per-entry `'entry'`) + `@types/archiver`.
- **Test harness:** `test/isolation/` with `bootstrapTestDb()` (drops schema, applies all migrations, seeds `orgA`/`orgB`) + seed helpers (`seedFinding`, `seedRisk`, `seedVendor`, …). CI `cross-org-isolation` job provisions `postgres:16-alpine`.
- **Tables:** `jobs` + `data_export_files` (`20260621_gdpr_foundations.sql`) are Category E (operational); `vendor_assurance_documents` columns = `id, organization_id, vendor_id, uploaded_by_user_id, original_filename, byte_size, sha256, storage_key, mime_type, …`.

---

## 3. Executor design (locked)

`export async function runExport({ subject, scope, sink, exportId?, signal? }): Promise<ExportResult>` — a function, matching the repo idiom (no class).

Per-table loop honoring Q1/Q2 + Invariants A–E:
1. `withTenant(orgId)` per table (short scopes, Q2) → `requireTenantContext()` (A) → `CursorRowStreamer(requireTenantContext().client, …)`.
2. Pump cursor → `rowToNdjsonLine` → sha256 + byte tally → an **in-memory `PassThrough`** appended to archiver, respecting backpressure (bounded memory, batch const `EXPORT_BATCH_SIZE`, Invariant D).
3. `await once(archive,'entry')` **before leaving the scope** (Q1: no lazy yield past scope close), `streamer.close()` in `finally` (Invariant C).
4. After all tables: append `manifest.json`; `archive.finalize()`.

**Pinch point resolved:** archiver's lazy `.append(readable)` would pull rows after COMMIT (use-after-release) if handed a cursor-backed stream. Instead the cursor is fully drained inside the scope and archiver only reads a DB-independent `PassThrough`; awaiting `'entry'` keeps memory bounded. **Failure semantics: fail-the-whole-export** (`archive.abort()`, reject, no partial bundle); retries are the PR #3 worker's job.

**Observability (Invariant E):** one structured log per export with `subject_id`, `org_id`, table list, per-table row counts, bundle key — **no email/PII values**.

**Sink:** plain `NodeJS.WritableStream` (Buffer collector in tests; R2 multipart in PR #3 via `@aws-sdk/lib-storage`, not added here; `fs` locally).

---

## 4. Manifest (final form)

```jsonc
{
  "export_id": "<uuid>",
  "scope": "user_self" | "org_full",
  "target_user_id": "<uuid|null>",
  "target_organization_id": "<uuid>",
  "generated_at": "ISO-8601",
  "generator_version": "2.0.0",                       // first complete service layer (#2a+#2b)
  "schema_version": "20260621_gdpr_foundations",      // Q1: latest applied FILENAME (owner-channel read)
  "tables": [{ "name","category","row_count","file":"tables/<t>.ndjson","size_bytes","sha256" }],
  "attachments": [{ "path":"attachments/vendor-assurance/<docId>.pdf","size_bytes","sha256",
                    "source_table":"vendor_assurance_documents","source_row_id":"<docId>" }],
  "notes": ["dependency_assessments: reviewer_uuid absent (Q3) — matched legacy reviewer_id only"],
  "gdpr_note": "…NDJSON hint; current-email-only matching; recycled-email disclosure (Q11); IP/user_agent are your own data; deleted-account tombstone note (Q3)…"
}
```

`schema_version` is the latest applied migration **filename** (`SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`) — stable across environments, unlike the SERIAL id. Per-table sha256 computed while streaming; attachment sha256 from the R2 stream, cross-checkable against `vendor_assurance_documents.sha256`.

---

## 5. Locked operator decisions (Phase 0 close)

- **Q1** schema_version = latest applied filename (owner-channel read).
- **Q2** org_full = **full table dump, no actor predicate**. New `buildOrgExportQueries(orgId, memberEmails, tableColumns)` over every org-scoped A/B/C/D table; email-keyed tables matched against the UNION of current member emails; `buildProjection` for secret omission; `withTenant(orgId)` is the boundary.
- **Q3** member enumeration `WHERE status NOT IN ('deleted')`; tombstoned users' residual rows still appear via the full dump (scrubbed PII per O-3); disclosed in `gdpr_note`.
- **Q4** flat layout — one `tables/{t}.ndjson` per table for the whole org; rows carry their own `*_user_id` columns.
- **Q5** new `exportExcludedColumns` for Category-D tables (see §6).
- **Q6** R2 PDF bytes stream OUTSIDE `withTenant`; metadata enumerated INSIDE. Org-prefixed key + `assertKeyBelongsToOrg` preserve isolation without holding the DB connection.
- **Q7** `jobs` + `data_export_files` added to `EXPORT_EXCLUDED_TABLES` (excluded from both scopes).
- **Q8** integration test rides `test/isolation/` (`test/isolation/dataExport.test.ts`, reuse `bootstrapTestDb()`).
- **Q9** `yauzl` for unzip in tests (devDependency).
- **Q10** `generator_version = '2.0.0'`.
- **Q11** recycled-email collision = disclosure-only in `gdpr_note`; real mitigation in PR #5.

---

## 6. Q5 — Category-D `exportExcludedColumns` (to add in #2b foundation)

Grounded against migrations:

| Table | Exclude | Keep |
|---|---|---|
| `organizations` | `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_status` (+ `payment_failed_at`) — Stripe billing. **`stripe_subscription_tier` vs `entitlement_level` "plan tier": see new open question N3.** | name, dates, settings, plan tier (per N3 resolution). |
| `org_sso_configs` | secret-bearing columns (e.g. `client_secret`/signing key — exact names to be read in Phase 1) | provider, entity_id, issuer URL (portability). |
| `webhook_endpoints` | `secret` (HMAC signing secret) | url, event types, name. |
| `api_usage_daily` | — (counters only) | all. |

Exact column lists confirmed by reading each migration during Phase 1. Drift test asserts each excluded column exists in the live schema.

---

## 7. Split (locked)

- **PR #2b** — `runExport({scope:'user_self'})` end-to-end + `buildOrgExportQueries` (pure, fully tested) + manifest expansion (full type/builder incl. `attachments[]` sketched) + Q5 Category-D exclusions + coverage drift incl. org_full table coverage + trust-model JSDoc updated for the org_full path (not yet wired) + this report.
- **PR #2c** (held back) — `runExport({scope:'org_full'})` wiring: member enumeration + R2 attachment streaming + a second integration-test case. Smaller wiring PR since the primitives ship in #2b.

---

## 8. New open questions surfaced by the locked decisions

- **N1 — executor testability seam.** To unit-test `runExport(user_self)` without a DB, inject a streamer factory + scope wrapper (prod: `withTenant` + `CursorRowStreamer`; test: identity scope + `ArrayRowStreamer` + Buffer sink). Recommended.
- **N2 — owner-channel reads.** `schema_version` (`schema_migrations`) and arguably the `columnProbe`/`dependencyAssessmentsProbe` (`information_schema`) run before/around the per-table tenant scopes. `schema_migrations` is owner-only → read via `withElevated`. `information_schema` is readable by any role. Confirm the channel split.
- **N3 — "plan tier" in org_full.** Q5 says exclude `Stripe*` but "include plan tier." Is the includable plan tier `entitlement_level` (non-Stripe, on `organizations` per `20260603_entitlement_on_organizations.sql`) while `stripe_subscription_tier` is excluded as a Stripe field? Needs a one-line ruling.
- **N4 — org-keyed email tables in org_full.** `intelligence_brief_subscribers` is keyed by `(organization_id, email)`. Q2 says email-keyed tables match the member-email UNION — but that under-includes org subscribers who are not platform users. For org_full, should this table be matched by `organization_id` (all org subscribers) rather than member-email UNION? (`subscribers`/`newsletter_deliveries` are platform-level with no org column → member-email UNION is correct there.)
