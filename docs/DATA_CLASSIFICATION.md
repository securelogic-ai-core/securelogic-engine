# Data Classification — GDPR/CCPA Data Subject Rights

**Purpose.** Authoritative reference for the SecureLogic data-subject-rights
workstream (GDPR Articles 15 / 17 / 20 + CCPA equivalents): self-service data
export, self-service account deletion, admin-initiated member deletion, and
admin-initiated org-wide export. Every table the platform owns is classified
A–F so the export engine and the deletion reaper know exactly what to read,
what to scrub, what to anonymize, and what to leave alone.

**Last updated.** 2026-06-12 (PR #2b — export executor + org_full query layer:
added `organizations` / `webhook_endpoints` `exportExcludedColumns`, the org_full
full-dump model + deferred-table set, the `jobs` / `data_export_files` export
exclusion, and the executor + manifest spec). Preceded by PR #2a (export engine
query + streaming core: `exportByEmailOnly`,
`vendor_assurance_documents.approved_by_user_id`, the NDJSON file-format
decision). Originally created 2026-06-11 (PR #1 — schema + classification
foundation).

**Machine-readable mirror.** `src/api/lib/dataClassification.ts` encodes this
document for runtime use. `src/api/__tests__/dataClassification.test.ts` asserts
the two stay in sync with the live migration schema. If you change one, change
the other.

---

## ⚠️ Deletion mechanism: TOMBSTONE, not hard-delete (Decision O-3)

**The `users` row is NEVER deleted.** On deletion, PII is scrubbed **in place**,
the row's **UUID is preserved**, and every foreign key that references the user
stays intact. This is load-bearing for two reasons discovered in Phase 0:

1. **Audit-trail integrity.** ~25 actor columns across the schema reference
   `users(id)` with `ON DELETE SET NULL`. A hard delete would null every one of
   them, destroying attribution. Tombstone keeps the UUID, so "who did this"
   survives while the human's PII does not.
2. **`security_audit_log` is append-only.** Its immutability triggers
   (`20260614_security_audit_log_immutable.sql`) reject any UPDATE/DELETE. Its
   `actor_user_id` FK is `ON DELETE SET NULL`, so a hard delete of a referenced
   user would trigger a cascade UPDATE that the trigger **rejects**, aborting the
   entire delete transaction. Tombstone never deletes the user row, so this never
   fires.

The reaper (PR #6) is the only writer that tombstones, and it enforces the
invariant that the `users` table never receives a `DELETE`.

---

## User lifecycle states (`users.status`)

The `status` column predates this workstream — it was created in
`001_securelogic_platform.sql` as `TEXT NOT NULL DEFAULT 'active'` with **no
CHECK**. PR #1 adds the formal CHECK constraint and **two new states**. A
whole-repo sweep confirmed the only values ever written before this PR are
`active` and `inactive`, so the constraint is safe against existing data.

| State | Meaning | Can authenticate? |
|---|---|---|
| `active` | Normal user. | Yes |
| `inactive` | Deactivated by admin or auto-deactivated (e.g. team-member removal via `teamInvites.ts`). **NOT** pending deletion. **Pre-existing behavior, unchanged by this PR.** | No |
| `pending_deletion` | Deletion requested; in the 30-day grace window; cancellable until the reaper runs. **New in this PR.** | No |
| `deleted` | Tombstoned: PII scrubbed in place, UUID preserved. Terminal. **New in this PR.** | No |

### Transition rules

| From → To | Trigger |
|---|---|
| `active` → `inactive` | Admin/system removes a member (existing behavior, **no change in this PR**). |
| `active` → `pending_deletion` | User self-requests deletion, OR an admin requests member deletion. |
| `inactive` → `pending_deletion` | Same triggers — an already-inactive member can still be queued for tombstone. |
| `pending_deletion` → `active` | User (or admin, if admin-initiated) **cancels** deletion within the grace window. |
| `pending_deletion` → `deleted` | Reaper job runs after grace expiry; PII scrub applied; the `users` row is preserved. |
| `deleted` → — | Terminal state. No further transitions. Immutable. |

### Note on `inactive` (pre-existing) vs. the new states

The `inactive` state **already existed before this workstream** and is preserved
exactly as-is. This PR adds two **new** lifecycle states (`pending_deletion`,
`deleted`) and the formal CHECK constraint; it does **not** change `inactive`
behavior. Critically, **`inactive` is not a deletion state** — an inactive user
still has full PII on their row. The reaper (PR #6) will **explicitly skip
`inactive` users** unless they have *also* been transitioned to
`pending_deletion`. Deactivation and deletion are independent.

---

## Category definitions

| Cat | Name | On user deletion |
|---|---|---|
| **A** | User PII root (the user record itself) | Tombstone: scrub PII in place, preserve UUID. |
| **B** | User-scoped data (MFA, password history, personal prefs, sessions) | Hard-delete with the user (these are `ON DELETE CASCADE` — but tombstone never deletes the user row, so the reaper deletes B rows **explicitly**). |
| **C** | Org content authored by a user (findings, risks, reviews, actor columns) | Anonymize the actor reference; keep the org content. |
| **D** | Org data not tied to a specific user | Leave alone. |
| **E** | System-wide / operational | Leave alone. |
| **F** | Billing / financial | Special legal-retention handling; not touched by member-level delete. |

---

## Per-table classification

`userRef` lists the column(s) that reference a specific user. `RLS` reflects the
mid-flight A04-G1 rollout: **enabled** = policy live now; **pending** = Tier A
customer-data table that will get a policy; **none** = system-wide / Tier B/C/D,
no per-org policy planned. The reaper and org-export run cross-org and must use
the elevated/owner channel (`pgElevated`) for any **enabled** table (and for all
tables once the `app_request` flip lands).

### A — User PII root
| Table | userRef | PII | RLS | Notes |
|---|---|---|---|---|
| `users` | — | high | pending | TOMBSTONE on delete; export omits `password_hash`, `totp_secret`, `totp_backup_codes`, `email_verification_token`/`_expires_at`, `password_reset_token`/`_expires_at` (see Export column exclusions). |

### B — User-scoped (delete with the user)
| Table | userRef | PII | RLS | Notes |
|---|---|---|---|---|
| `password_history` | user_id | high | pending | Password hashes. **Exclude from export.** |
| `user_alert_preferences` | user_id | low | pending | |
| `alert_sends` | user_id | low | pending | Dedup ledger. |
| `dashboard_preferences` | user_id | low | pending | `org_default` rows (user_id NULL) are effectively D — leave them. |
| `legal_consents` | user_id | high | pending | Holds `ip_address` + `user_agent`. **No RLS today** (not an RLS template). |
| `org_invites` | invited_by_user_id | medium | pending | FK is `ON DELETE CASCADE`; tombstone preserves pending invites this user sent. Export omits `token` (live invite capability). |

### C — Org content authored by a user (anonymize actor)
| Table | userRef | PII | RLS |
|---|---|---|---|
| `risks` | owner_user_id | high | **enabled** |
| `risk_treatments` | reviewer_uuid, owner_user_id, *reviewer_id (TEXT, deprecated)* | high | pending |
| `risk_control_links` | created_by_user_id | low | pending |
| `risk_obligation_links` | created_by_user_id | low | pending |
| `risk_scoring_weights` | updated_by_user_id | none | pending |
| `risk_settings` | updated_by_user_id | none | pending |
| `controls` | owner_user_id | high | pending |
| `control_assessments` | reviewer_id | high | pending |
| `requirement_responses` | assessed_by | high | pending |
| `obligations` | owner_user_id | high | pending |
| `obligation_assessments` | reviewer_uuid, *reviewer_id (TEXT)* | high | pending |
| `vendors` | owner_user_id | high | pending |
| `vendor_assessments` | reviewer_id | high | pending |
| `vendor_reviews` | reviewer_uuid, *reviewer_id (TEXT)* | high | pending |
| `vendor_assurance_documents` | uploaded_by_user_id, finalized_by_user_id, approved_by_user_id | medium | pending |
| `vendor_assurance_cuecs` | review_status_updated_by_user_id | high | pending |
| `vendor_assurance_cuec_control_mappings` | created_by_user_id, updated_by_user_id | none | pending |
| `vendor_assurance_review_decisions` | decided_by_user_id | high | pending |
| `vendor_assurance_field_overrides` | overridden_by_user_id | high | pending |
| `ai_systems` | owner_user_id | high | pending |
| `ai_governance_assessments` | reviewer_uuid, *reviewer_id (TEXT)* | high | pending |
| `governance_reviews` | reviewer_id | high | pending |
| `ai_system_vendor_dependencies` | created_by_user_id | high | pending |
| `dependency_assessments` | reviewer_uuid, *reviewer_id (TEXT)* | high | pending |
| `assessments` | created_by | high | pending |
| `findings` | owner_user_id | high | **enabled** |
| `actions` | owner_user_id | high | pending |
| `signal_match_suggestions` | accepted_by_user_id, dismissed_by_user_id | medium | pending |
| `signal_vendor_links` | created_by_user_id | low | pending |
| `signal_ai_system_links` | created_by_user_id | low | pending |
| `signal_control_links` | created_by_user_id | low | pending |
| `signal_obligation_links` | created_by_user_id | low | pending |

> **Deprecated TEXT `reviewer_id`.** Five tables (`risk_treatments`,
> `obligation_assessments`, `vendor_reviews`, `ai_governance_assessments`,
> `dependency_assessments`) carry a legacy TEXT `reviewer_id` that predates the
> UUID FK migration (`20260503`). It is **not** FK-protected and may hold a raw
> email or name — the reaper must anonymize it explicitly alongside the UUID
> columns.

### D — Org data not user-tied (leave alone)
`organizations` (ROOT-TENANT; see Special handling), `vendor_assurance_extractions`,
`vendor_assurance_extraction_spans`, `frameworks`, `requirements`, `policies`,
`policy_control_links`, `control_mappings`, `obligation_mappings`, `dependencies`,
`evidence` (⚠ `collected_by` is free TEXT — may embed a name/email, see O-7),
`reports`, `posture_snapshots` (**RLS enabled**), `domain_scores`,
`organization_risk_scales`, `webhook_endpoints`, `webhook_deliveries`,
`org_sso_configs`, `api_usage_daily`.

### E — System-wide / operational (leave alone)
`signals`, `insights`, `trends`, `trend_signals`, `cyber_signals`,
`intelligence_briefs`, `intelligence_brief_items`, `intelligence_brief_sends`,
`intelligence_brief_sources`, `newsletter_issues`, `newsletter_issue_insights`,
`published_artifacts`, `worker_runs`, `auth_anomaly_alerts`, `risk_scale_presets`,
`webhook_events_processed`, **`jobs`** (new), **`data_export_files`** (new), plus
the special-handling tables below.

### F — Billing / financial
`api_keys` — carries legacy Stripe mirror fields (`stripe_customer_id`,
`payment_failed_at`, `stripe_subscription_tier`) with legal retention. Org-scoped,
**not** user-scoped: a member self-delete does not touch billing. Anonymize
`created_by_user_id` only. (Stripe fields on `organizations` are likewise
retention-bound; org deletion is out of scope for this workstream.)

---

## Tombstone behavior specification

Exact rewrites the reaper applies to the `users` row. Mirrored by
`TOMBSTONE_USER_PATCH` in `dataClassification.ts`. Template tokens: `{id}` → the
user's own UUID (keeps the scrubbed email globally unique under
`users_email_unique`); `{now}` → the reap timestamp.

| Column | New value | Why |
|---|---|---|
| `email` | `deleted-{id}@deleted.invalid` | PII; `{id}` preserves UNIQUE. |
| `name` | `Deleted User` | PII; shown on shared records. |
| `password_hash` | `''` | Credential. (`NOT NULL DEFAULT ''`.) |
| `totp_secret` | `NULL` | Credential. |
| `totp_enabled` | `false` | Credential. |
| `totp_backup_codes` | `'{}'` (empty array) | Credential. **Column is `text[] NOT NULL`** — empty array, not NULL (deviates from the O-3 spec's "NULL", which would violate NOT NULL). |
| `email_verified` | `false` | Reset. |
| `email_verification_token` | `NULL` | Token. |
| `email_verification_expires_at` | `NULL` | Token. |
| `password_reset_token` | `NULL` | Token. |
| `password_reset_expires_at` | `NULL` | Token. |
| `failed_login_attempts` | `0` | Login telemetry (`NOT NULL`). |
| `lockout_until` | `NULL` | Login telemetry. |
| `last_failed_login_at` | `NULL` | Login telemetry. |
| `last_login_at` | `NULL` | Login telemetry. |
| `previous_login_at` | `NULL` | Login telemetry. |
| `password_changed_at` | `NULL` | Login telemetry. |
| `sso_provider` | `NULL` | Identity-provider linkage. |
| `dismissed_banner_keys` | `'{}'` (empty array) | Per-user UI state (`text[] NOT NULL`). |
| `status` | `deleted` | Lifecycle terminal state. |
| `deleted_at` | `{now}` | Tombstone timestamp. |
| `updated_at` | `{now}` | Standard bookkeeping. |

**Preserved** (NOT scrubbed): `id` (the whole point), `organization_id`, `role`,
`created_at`, `deletion_scheduled_at`, `deletion_requested_by_user_id`,
`deletion_reason`. These survive for audit-trail integrity.

---

## Export column exclusions (`exportExcludedColumns`)

The Art. 15 export omits credentials and live capability tokens. The export engine
projects an **explicit column allowlist** (every column EXCEPT the excluded ones)
instead of `SELECT *` for any table that declares `exportExcludedColumns` in
`dataClassification.ts`; a table that declares the field but whose live column list
is unavailable causes the query builder to **throw (fail-closed)** rather than
fall back to `SELECT *`. The live column list is read from `information_schema`
(`columnProbe.ts`) so the export stays complete as new columns are added, while
the denylist keeps secrets out.

**This is the export-side mirror of `TOMBSTONE_USER_PATCH`, but a separate field.**
Deletion scrubs a column's *value* in place and keeps the column (Art. 17); export
*omits* the column entirely (Art. 15). The two lists overlap but are not identical
— e.g. `users.email` is tombstone-scrubbed yet MUST be exported (it is the
subject's own data), whereas `users.password_hash` is both scrubbed on delete and
excluded from export.

| Table | Excluded columns | Why |
|---|---|---|
| `users` | `password_hash` | Credential hash. |
| `users` | `totp_secret` | **Live plaintext** TOTP seed. |
| `users` | `totp_backup_codes` | Live MFA recovery secrets. |
| `users` | `email_verification_token`, `email_verification_expires_at` | Live capability token + its expiry. |
| `users` | `password_reset_token`, `password_reset_expires_at` | Live capability token + its expiry. |
| `org_invites` | `token` | Live invite-acceptance capability (UNIQUE, 7-day TTL). |
| `organizations` | `stripe_customer_id`, `stripe_subscription_id`, `stripe_subscription_tier`, `stripe_subscription_status`, `payment_failed_at`, `promo_code` | Stripe billing identifiers / financial state (legal-retention F-fields). `entitlement_level` — the portable plan tier — is **retained** (Decision N3). org_full only. |
| `webhook_endpoints` | `secret` | HMAC signing secret for webhook delivery. `url`, `event_types`, `status` retained for portability. org_full only. |

A drift test (`dataClassification.test.ts`) asserts every `exportExcludedColumns`
entry references a column that actually exists in the migration schema, and that
the known secret-bearing tables (`users`, `org_invites`, `organizations`,
`webhook_endpoints`) still carry their exclusions. The `organizations` and
`webhook_endpoints` exclusions matter only for the org_full export — neither
table appears in a user self-export.

> **Not a free-text PII substitute.** This excludes *structured* secret columns
> only. Free-text PII a user typed into a body field is the O-7 manual process.

---

## Org-wide export format (Decision O-2, file format Decision Q9)

A single `.zip` per org-export job, stored in R2 under
`org/{organizationId}/data-exports/{jobId}/export.zip` (7-day lifetime, O-11).

**Data files are NDJSON; the manifest is JSON (Decision Q9).** Each table file is
newline-delimited JSON — one complete row object per line, no enclosing array.
This is what lets the export engine **stream** arbitrarily large tables a row at a
time (cursor → NDJSON `Transform` → zip entry) without buffering a whole table in
memory. The manifest stays plain JSON because it is small and read whole.

```
export.zip
├── manifest.json              # job id, org id, generated_at, schema version,
│                              # per-table row counts, attachment index, format note
├── tables/
│   ├── users.ndjson           # one NDJSON file per included table, scoped to org
│   ├── findings.ndjson
│   ├── risks.ndjson
│   └── … (one per included table)
└── attachments/
    └── vendor-assurance/      # org-owned R2 blobs (e.g. SOC2 PDFs) by document id
```

> **Converting NDJSON → a JSON array.** `jq -s '.' tables/findings.ndjson`, or in
> code read line-by-line and `JSON.parse` each. The manifest's `gdpr_note` records
> the format and this conversion hint for the data subject. Empty tables produce a
> zero-byte (or absent) `.ndjson` file; the manifest row count is authoritative.

A **user self-export** is the same shape but `tables/*.ndjson` contain only the
requesting user's A/B rows and the C rows where they are the actor (current
ownership **and** historical authorship via `security_audit_log`, O-1; full
rows, not field-sliced), and `attachments/` is omitted.

### Executor + org_full model (PR #2b)

The executor (`runExport`, `dataExport/exporter.ts`) drives each query inside its
own short `withTenant` scope, streams the cursor through the NDJSON transform into
a zip entry, and writes `manifest.json` last. **`user_self` is wired end-to-end in
PR #2b; `org_full` is wired in PR #2c** — member enumeration via the
`readMemberEmails` seam (current `users.email` of non-deleted members, Decision Q3)
feeds `buildOrgExportQueries`, which drives the same per-table streaming loop. For
org_full the manifest `scope` is `org_full` and `target_user_id` is `null` (it is
an org-level artifact). **R2 vendor-assurance attachment bytes (Q6) are not bundled
yet** — `attachments` stays `[]` and an org_full manifest note discloses it; a
follow-up PR adds attachment streaming. Manifest fields: `export_id`, `scope`,
`target_user_id` / `target_organization_id`, `generated_at`, `generator_version`
(`2.0.0` — first complete service layer), `schema_version` (the **latest applied
migration filename** from `schema_migrations`, Decision Q1; `null` if unavailable),
`tables[]` (name, category, `row_count`, `file`, `size_bytes`, `sha256`),
`attachments[]` (org_full; populated in the attachment follow-up), `notes[]`, and `gdpr_note`.

The **org_full** export (`buildOrgExportQueries`) is a **full table dump, not a
union of per-member self-exports** (Decision Q2): every org-scoped Category-A/B/C/D
table is selected in full with **no actor predicate**, so unassigned / NULL-actor
rows are included. Because RLS is bypassed under owner credentials and absent on
pending-RLS tables, every org_full query carries an **explicit org predicate**
(`organization_id = $1`; `organizations` by `id`; user-scoped tables with no org
column via a membership subquery). Email-keyed tables follow Decision N4
(`intelligence_brief_subscribers` by `organization_id`; `subscribers` /
`newsletter_deliveries` by the UNION of current member emails). Five Category-D
tables with neither an `organization_id` column nor a user ref (`requirements`,
`policy_control_links`, `control_mappings`, `obligation_mappings`, `domain_scores`)
are **explicitly deferred to PR #2c** (`ORG_EXPORT_DEFERRED_TABLES`) pending a
ratified parent-join scoping; the coverage drift test asserts they are the only
uncovered A/B/C/D tables. `jobs` and `data_export_files` (operational metadata
about the export process itself) are excluded from both scopes (Decision Q7).

### Email-keyed export inclusion (Decision Q6)

Three Category-E tables key personal data by **email address**, not a `users.id`
FK, and are included in a user self-export by matching the subject's **current**
`users.email` (machine-readable as `exportByEmailOnly: true` in
`dataClassification.ts`):

| Table | Email column | Notes |
|---|---|---|
| `subscribers` | `email` | Platform-level (no `organization_id`) — email is the sole key. |
| `intelligence_brief_subscribers` | `email` | Keyed by `(organization_id, email)`. |
| `newsletter_deliveries` | `subscriber_email` | Delivery audit trail. |

These remain **category E for deletion** (leave alone — a subscriber is an email,
not necessarily a platform user). The `exportByEmailOnly` flag encodes the
"delete=leave, export=include-by-email" distinction so the export engine includes
them while the reaper still skips them. `email_suppressions` is **NOT** in this set
— it is excluded from both delete and export (O-8).

> **Historical email matching is not supported.** Only the subject's current
> `users.email` is matched; the platform tracks no email-address history, so rows
> tied to a prior address the user no longer holds cannot be located. Recorded in
> the manifest `gdpr_note`.

> **⚠ Recycled-email collision (tracked for PR #2b/#5).** These tables are NOT
> tombstoned on user deletion (Category E, left alone), and subscriber/delivery
> rows are not user-FK'd. If email address `e` belonged to a now-deleted user A
> and is later held by user B, B's self-export — matching on current `users.email`
> — would include A's old `subscribers`/`newsletter_deliveries` rows. Rare, but a
> cross-subject leak. PR #2b/#5 must decide the mitigation (e.g. confirm the row's
> own org/created window against the subject, or gate on verified email ownership).
> The manifest `gdpr_note` should disclose that email-keyed rows reflect the
> current address holder.

---

## Special-handling tables

- **`security_audit_log`** — append-only (immutability triggers, `20260614`).
  Never UPDATE/DELETE. `actor_user_id` is `ON DELETE SET NULL`; tombstone avoids
  the cascade-UPDATE-rejection trap entirely. Tier B grant (SELECT+INSERT only).
- **`audit_log`** — HTTP request log; `actor_label` may embed an email. Keep for
  the GDPR-mandated retention of the request/erasure records; document lawful
  basis. Tier B.
- **`email_suppressions`** — **KEEP on delete (O-8).** Deleting a suppression
  could re-enable mail to a bounced/complained address. Lawful basis:
  deliverability / anti-spam compliance obligation. Platform-level (no org
  column), Tier C (SELECT-only).
- **`subscribers` / `intelligence_brief_subscribers` / `newsletter_deliveries`**
  — **email-keyed, not user-id keyed** (`exportByEmailOnly: true`). A subscriber is
  an email address, not necessarily a platform user. When honoring a request, match
  by the user's current email, not a user FK. Included in self-export (Q6), left
  alone on delete. See "Email-keyed export inclusion" above.
- **`jobs` / `data_export_files`** (new) — org-scoped, RLS **enabled**.
  `data_export_files` points at an R2 bundle that **contains a full PII export**
  — the purge job deletes it after 7 days (O-11). The download route looks the
  file up by `download_token_hash` **before** org context is established, so that
  lookup must run on `pgElevated` (owner channel), not the tenant client.
- **Stripe fields** (`api_keys.*`, `organizations.stripe_*`) — legal retention;
  not touched by member-level deletion. Billing is out of scope for this
  workstream.

---

## Free-text PII manual-review process (Decision O-7)

Automated erasure covers structured actor columns and the `users` row. It does
**not** scrub PII a user may have typed into free-text bodies (`description`,
`recommendation`, `analyst_notes`, `evidence.collected_by`, etc.) — e.g. a
finding that names a third party. Per O-7 this is **out of automated scope** and
handled as a documented manual process:

- **Who submits.** A data subject (often *not* the user being tombstoned — e.g.
  a third party named in a finding) requesting erasure of free-text references
  to them.
- **Where.** `privacy@securelogicai.com`.
- **SLA.** 30 days (GDPR Art. 12(3)).
- **Evaluation.** The operator weighs the request against the Art. 17(3)(e)
  exemptions (legal claims) and the platform's records-of-processing obligations
  before redacting; not every request results in deletion.
- **Future tooling.** A later PR adds admin tooling to search free-text fields
  for a given term and redact in place with an audit entry. Until then the
  process is manual.

---

## Open / future work in this workstream

This document is created by **PR #1** (schema + classification foundation).
Subsequent PRs (not yet open) reference it:

- **PR #2** — export engine. Split: **#2a** (per-category query layer + NDJSON
  streaming core — `src/api/services/dataExport/`; this PR) and **#2b** (zip/bundle
  orchestration, manifest builder, org-wide outer loop, R2 attachment streaming).
- **PR #3** — `data-rights-worker` service (render.yaml) + `jobs` poller.
- **PR #4** — shared `sendEmail()` helper + export/deletion email templates.
- **PR #5** — self-service export + delete API (`/account/privacy`).
- **PR #6** — deletion reaper (applies `TOMBSTONE_USER_PATCH`; enforces the
  "`users` never receives DELETE" invariant; purges expired R2 export files).
- **PR #7** — user-facing privacy UI.
- **PR #8** — admin org-export + member-delete (last-admin guard, O-6).
