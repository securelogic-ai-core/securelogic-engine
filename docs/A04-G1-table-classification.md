# A04-G1 — Table Classification Matrix (Phase 0 deliverable)

**Status:** Draft for operator review. Read-only — no schema or code changed in producing this document.
**Decisions context:** A1 (non-owner application role `app_request`) + B1 (transaction-wrapped `SET LOCAL app.current_org_id`) — see `A04-G1-rls-rollout-plan.md` §1.
**Schema baseline:** HEAD `6bf5042d`, `db/migrations/` = 94 files = 80 distinct application tables (excludes `schema_migrations` bookkeeping; one duplicate-name false positive `"and"` discarded).

This document is the authoritative input to phase 1 onward. Every RLS migration in phases 2–3 references the bucket assignment here.

---

## §1. Methodology

### Org-column verification (table buckets)

For every table found via `CREATE TABLE` in `db/migrations/`:

1. Locate the creating migration file.
2. Extract the `CREATE TABLE` block and check for an `organization_id` column declaration, plus its `NOT NULL` constraint.
3. Search every later migration for `ALTER TABLE <t> ADD COLUMN organization_id` and for `ALTER COLUMN organization_id { SET | DROP } NOT NULL` to track nullability changes.
4. For tables that never carry `organization_id`, inspect the `CREATE TABLE` body for FK columns pointing at org-scoped parents (`user_id`, `assessment_id`, `posture_snapshot_id`, etc.) — these are INDIRECT tenant-scoped tables.
5. For tables that have `organization_id NULLABLE` after all migrations, inspect the migration commit messages and read/write call sites to confirm whether NULL rows are intentional (HYBRID) or backfill leftovers (latent customer-data).

### Cross-org reader hunt

Five overlapping passes; explicit residual-risk acknowledgement at the end of §4:

1. **Cron/scheduler enumeration.** Every `cron.schedule(…)` and `setInterval(…)` in `src/`. Result: 4 cron jobs registered in `schedulerRunner.ts` + 2 idle-scan timers; each job's body traced into its called modules.
2. **Per-org loop detection.** Grep for `FROM organizations` and `WHERE status = 'active'` + iteration. Result: every per-org loop call site located.
3. **DB call-site inventory.** All 972 `pg.query` / `pool.query` / `client.query` invocations in `src/api/` traced to file. Files reading customer-data tables were inspected for the presence of an `organization_id` predicate.
4. **Admin route review.** Every `src/api/routes/admin*.ts` (20 files) inspected for aggregate or cross-org SELECT shape.
5. **Pre-context auth path.** Middleware and webhook handlers that run *before* `attachOrganizationContext` sets the org GUC were enumerated separately — these are structurally cross-org by design (auth resolution needs to look up `users` or `api_keys` by an attribute that doesn't yet name an org).

**Residual risk:** see §4 caveat. The hunt cannot prove the list complete — only that the named hunting passes turned up no other candidates.

---

## §2. Table matrix

### Bucket legend

- **CUSTOMER-DATA** — table has its own `organization_id NOT NULL` column. Standard RLS policy: `organization_id = current_setting('app.current_org_id', true)::uuid` for SELECT/INSERT/UPDATE/DELETE.
- **HYBRID** — table has `organization_id NULLABLE`. Mixes global rows (`NULL`) with tenant rows. Policy must allow `NULL OR matching org` on SELECT, but constrain write paths.
- **INDIRECT** — table has no `organization_id` of its own, but is per-org via FK chain. RLS policy uses a subquery against the parent table. Higher complexity, slower policy evaluation, but correct.
- **SHARED-REF** — table has no `organization_id` and is global by design. **No RLS policy.** `app_request` role gets no grants (or read-only grants) on these.
- **ROOT-TENANT** — the `organizations` table itself. Policy is `id = current_setting('app.current_org_id')::uuid`.

### The matrix

| Table | Has `organization_id` | Bucket | Evidence |
|---|---|---|---|
| `actions` | yes, NOT NULL | CUSTOMER-DATA | `20260410_platform_primitives.sql:76` |
| `ai_governance_assessments` | yes, NOT NULL | CUSTOMER-DATA | `20260429_ai_governance_review_workflow.sql` |
| `ai_systems` | yes, NOT NULL | CUSTOMER-DATA | `20260414_ai_system_governance_primitives.sql` |
| `ai_system_vendor_dependencies` | yes, NOT NULL | CUSTOMER-DATA | `20260505_ai_system_vendor_dependencies.sql` |
| `alert_sends` | no | INDIRECT | FK `user_id → users.organization_id`; `alertEmailService.ts:49` scopes by `user_id` |
| `api_keys` | yes, NOT NULL | CUSTOMER-DATA | `001_securelogic_platform.sql:83` |
| `api_usage_daily` | yes, NOT NULL | CUSTOMER-DATA | `20260529_api_key_mgmt.sql`; `trackApiUsage.ts:36` |
| `assessments` | yes, NOT NULL | CUSTOMER-DATA | `001_securelogic_platform.sql:39` |
| `audit_log` | yes, **NULLABLE** | HYBRID | `20260405_audit_log.sql`; pre-auth events may have NULL org. Written by `requestAudit.ts` |
| `auth_anomaly_alerts` | no | SHARED-REF | per-IP dedup ledger (`20260616_auth_anomaly_alerts.sql:21`); migration comment: "No worker touches auth_anomaly_alerts" tenant-side |
| `control_assessments` | yes, NOT NULL | CUSTOMER-DATA | `20260416_control_assessment_workflow.sql` |
| `control_mappings` | no | INDIRECT | FKs `control_id → controls.organization_id` and `requirement_id → requirements → frameworks.organization_id`; per-org via either side |
| `controls` | yes, NOT NULL | CUSTOMER-DATA | `20260415_control_framework_primitives.sql` |
| `cyber_signals` | yes, **NULLABLE** | HYBRID | `20260420_cyber_signals_allow_null_org.sql:36` explicitly `DROP NOT NULL`. Global advisories: NULL. Per-org overrides: non-null. `briefScheduler.ts:232` reads `(organization_id = $1 OR organization_id IS NULL)` |
| `dashboard_preferences` | yes, NOT NULL | CUSTOMER-DATA | `20260601_dashboard_preferences.sql` |
| `dependencies` | yes, NOT NULL | CUSTOMER-DATA | `20260422_dependency_primitives.sql` |
| `dependency_assessments` | yes, NOT NULL | CUSTOMER-DATA | `20260425_dependency_review_workflow.sql` |
| `domain_scores` | no | INDIRECT | FK `posture_snapshot_id → posture_snapshots.organization_id`; `20260410_platform_primitives.sql:121` |
| `email_suppressions` | no | SHARED-REF | platform-wide email block list; migration comment line 9: "no org scoping needed". Read by `alertEmailService.ts:41` and customer-auth flows |
| `evidence` | yes, NOT NULL | CUSTOMER-DATA | `20260420_evidence_primitives.sql` |
| `findings` | no | INDIRECT | FK `assessment_id → assessments.organization_id`; cross-org isolation harness (E1-G1) verifies this at app-layer today |
| `frameworks` | yes, NOT NULL | CUSTOMER-DATA | `20260415_control_framework_primitives.sql`. Initially expected hybrid (NIST/HIPAA catalog) but actually per-org clone-on-activation |
| `governance_reviews` | yes, NOT NULL | CUSTOMER-DATA | `20260414_ai_system_governance_primitives.sql` |
| `insights` | yes, **NULLABLE** | HYBRID | added by `20260405_add_organization_id_to_insights_trends.sql`; migration comment: "Nullable so existing rows are preserved". Per-org insights + legacy null-org rows |
| `intelligence_brief_items` | yes, NOT NULL | CUSTOMER-DATA | `20260501_intelligence_brief_pipeline.sql` |
| `intelligence_briefs` | yes, NOT NULL | CUSTOMER-DATA | `20260501_intelligence_brief_pipeline.sql` |
| `intelligence_brief_sends` | no | INDIRECT | FKs `brief_id → intelligence_briefs.organization_id` and `subscriber_id → intelligence_brief_subscribers.organization_id` |
| `intelligence_brief_sources` | no | SHARED-REF | catalog of source publishers (CISA, NIST, etc.). `slug UNIQUE`. Global |
| `intelligence_brief_subscribers` | yes, NOT NULL | CUSTOMER-DATA | `20260502_intelligence_brief_delivery.sql` |
| `newsletter_deliveries` | yes, **NULLABLE** | HYBRID | added by `20260406_newsletter_schema.sql:58`; migration comment line 10: "NULL means platform-level (visible to all orgs), non-null means org-specific" |
| `newsletter_issue_insights` | no | INDIRECT | FK `issue_id → newsletter_issues` (hybrid); inherits nullability of parent |
| `newsletter_issues` | yes, **NULLABLE** | HYBRID | added by `20260406_newsletter_schema.sql:37`; same comment as above |
| `obligation_assessments` | yes, NOT NULL | CUSTOMER-DATA | `20260419_obligation_assessment_workflow.sql` |
| `obligation_mappings` | no | INDIRECT | FKs `obligation_id → obligations.organization_id` and `requirement_id → requirements → frameworks.organization_id` |
| `obligations` | yes, NOT NULL | CUSTOMER-DATA | `20260418_obligation_regulatory_primitives.sql` |
| `organization_risk_scales` | yes, NOT NULL | CUSTOMER-DATA | `20260421_risk_scales.sql` |
| `organizations` | n/a — root | ROOT-TENANT | `001_securelogic_platform.sql:3`. Each row IS a tenant; policy: `id = current_setting('app.current_org_id')::uuid` |
| `org_invites` | yes, NOT NULL | CUSTOMER-DATA | `20260520_multi_user_team.sql` |
| `org_sso_configs` | yes, NOT NULL | CUSTOMER-DATA | `20260528_sso_config.sql` |
| `password_history` | no | INDIRECT | FK `user_id → users.organization_id`; `passwordHistory.ts:15` scopes via user_id |
| `policies` | yes, NOT NULL | CUSTOMER-DATA | `20260525_policy_register.sql` |
| `policy_control_links` | no | INDIRECT | FKs `policy_id → policies.organization_id` and `control_id → controls.organization_id` |
| `posture_snapshots` | yes, NOT NULL | CUSTOMER-DATA | `20260410_platform_primitives.sql:105` |
| `published_artifacts` | no | SHARED-REF | PK `issue_number`. Global Intelligence Brief publication ledger. `issueStore.ts:248` |
| `reports` | yes, NOT NULL (post-backfill) | CUSTOMER-DATA | `20260504_reports_organization_id.sql` — nullable add → backfill → NOT NULL. Now CUSTOMER-DATA, not hybrid |
| `requirement_responses` | yes, NOT NULL | CUSTOMER-DATA | `20260420_requirement_responses.sql` |
| `requirements` | no | INDIRECT | FK `framework_id → frameworks.organization_id`; `20260415_control_framework_primitives.sql` |
| `risk_control_links` | yes, NOT NULL | CUSTOMER-DATA | `20260605_risk_control_links.sql` |
| `risk_obligation_links` | yes, NOT NULL | CUSTOMER-DATA | `20260606_risk_obligation_links.sql` |
| `risks` | yes, NOT NULL | CUSTOMER-DATA | `20260421_risk_register_primitives.sql` |
| `risk_scale_presets` | no | SHARED-REF | `name UNIQUE` — global catalog of standard risk scales |
| `risk_scoring_weights` | yes, NOT NULL | CUSTOMER-DATA | `20260505_risk_scoring_weights.sql` |
| `risk_settings` | yes, NOT NULL | CUSTOMER-DATA | `20260607_risk_review_cadence.sql` |
| `risk_treatments` | yes, NOT NULL | CUSTOMER-DATA | `20260426_risk_treatment_workflow.sql` |
| `security_audit_log` | yes, **NULLABLE** | HYBRID | `20260505_security_audit_log.sql`. Pre-login auth events (login_failed, mfa_failed) have NULL org. `auth.account_locked` may have either. Used by `authAnomaly.ts` cross-org scan |
| `signal_ai_system_links` | yes, NOT NULL | CUSTOMER-DATA | `20260504_signal_ai_system_links.sql` |
| `signal_control_links` | yes, NOT NULL | CUSTOMER-DATA | `20260504_signal_control_links.sql` |
| `signal_match_suggestions` | yes, NOT NULL | CUSTOMER-DATA | `20260505_signal_match_suggestions.sql` |
| `signal_obligation_links` | yes, NOT NULL | CUSTOMER-DATA | `20260505_signal_obligation_links.sql` |
| `signals` | yes, **NULLABLE** | HYBRID | added by `20260405_add_organization_id_to_signals.sql:15`. Migration comment: "signals API route does not filter by organization_id (signals are global intelligence inputs)" — read pattern is explicitly cross-org for the public surface |
| `signal_vendor_links` | yes, NOT NULL | CUSTOMER-DATA | `20260504_signal_vendor_links.sql` |
| `subscribers` | yes, **NULLABLE** | HYBRID | added by `20260406_newsletter_schema.sql:48`. Comment line 45-46: "Existing rows and platform-level subscribers have NULL org" |
| `trends` | yes, **NULLABLE** | HYBRID | added by `20260405_add_organization_id_to_insights_trends.sql:29`. Same nullable rationale as `insights` |
| `trend_signals` | no | INDIRECT | FK `trend_id` to `trends` (hybrid). Inherits nullability |
| `user_alert_preferences` | yes, NOT NULL (post-backfill) | CUSTOMER-DATA | `20260504_user_alert_preferences_org_scope.sql` — nullable add → backfill → SET NOT NULL |
| `users` | yes, NOT NULL | CUSTOMER-DATA | `001_securelogic_platform.sql:13`. **Special handling needed** — see §4 pre-context auth |
| `vendor_assessments` | yes, NOT NULL | CUSTOMER-DATA | `20260413_vendor_assessment_workflow.sql` |
| `vendor_assurance_cuec_control_mappings` | yes, NOT NULL | CUSTOMER-DATA | `20260613_vendor_assurance_cuecs.sql` |
| `vendor_assurance_cuecs` | yes, NOT NULL | CUSTOMER-DATA | `20260613_vendor_assurance_cuecs.sql` |
| `vendor_assurance_documents` | yes, NOT NULL | CUSTOMER-DATA | `20260610_vendor_assurance_documents.sql` |
| `vendor_assurance_extractions` | yes, NOT NULL | CUSTOMER-DATA | `20260610_vendor_assurance_documents.sql` |
| `vendor_assurance_extraction_spans` | yes, NOT NULL | CUSTOMER-DATA | `20260610_vendor_assurance_documents.sql` |
| `vendor_assurance_field_overrides` | yes, NOT NULL | CUSTOMER-DATA | `20260612_vendor_assurance_document_presentation.sql` |
| `vendor_assurance_review_decisions` | yes, NOT NULL | CUSTOMER-DATA | `20260610_vendor_assurance_documents.sql` |
| `vendor_reviews` | yes, NOT NULL | CUSTOMER-DATA | `20260428_vendor_review_workflow.sql` |
| `vendors` | yes, NOT NULL | CUSTOMER-DATA | `001_securelogic_platform.sql:24` |
| `webhook_deliveries` | yes, NOT NULL | CUSTOMER-DATA | `20260421_webhooks.sql`; `webhookDispatcher.ts:61` |
| `webhook_endpoints` | yes, NOT NULL | CUSTOMER-DATA | `20260421_webhooks.sql`; `webhookDispatcher.ts:26` |
| `webhook_events_processed` | no | SHARED-REF | PK `(provider, event_id)`. Webhook idempotency. `78f509cc` |
| `worker_runs` | no | SHARED-REF | global worker telemetry. `workerLogger.ts:12` |

### Counts

| Bucket | Count |
|---|---:|
| CUSTOMER-DATA (direct, NOT NULL) | **52** |
| HYBRID (direct, NULLABLE) | **9** |
| INDIRECT (no own column, FK chain) | **9** |
| SHARED-REF (no policy needed) | **8** |
| ROOT-TENANT (`organizations`) | **1** |
| **Total application tables** | **79** |

Excluded from the matrix: `schema_migrations` (migrate-runner bookkeeping; never RLS-relevant). The earlier 81-distinct count from `CREATE TABLE` grep included a regex false positive `"and"` discarded here.

---

## §3. HYBRID tables — deep dive

Hybrid tables drive most of phase 3's policy complexity. There are **9 hybrid tables**. Each has the same structural property — `organization_id IS NULL` is a legitimate value — but for different reasons. Policy shape differs per table. Do not collapse them into a single template.

### 1. `cyber_signals`

- **Why hybrid:** `NULL` rows are global threat-intelligence advisories (KEV CVEs, NVD CVEs, MITRE techniques, CISA alerts). Non-NULL rows are per-org enrichments / overrides.
- **Writers:** `cyberSignalProcessingService.ts` (cross-org ingestion path inserts with `organization_id = NULL`); `briefScheduler.ts:134` inserts per-org rows during the brief pipeline.
- **Readers:** `briefScheduler.ts:231-232` — explicit `WHERE (organization_id = $1 OR organization_id IS NULL)`. `briefSynthesizer.ts`, `cyberSignalProcessingService.ts:715`.
- **Policy shape:** SELECT `organization_id IS NULL OR organization_id = current_setting(...)`. INSERT/UPDATE allow either NULL (cross-org-write path needs elevated role) or matching GUC.

### 2. `signals`

- **Why hybrid:** added late by `20260405_add_organization_id_to_signals.sql`.
- **Writers:** intelligence worker (referenced in migration comment as `postgresSignalStore.ts`) inserts with org_id; legacy rows have NULL.
- **Readers:** `src/api/routes/signals.ts:40` — `WHERE (organization_id = $1 OR organization_id IS NULL)`. The route **already implements the hybrid SELECT pattern verbatim** — every tenant gets global NULL rows + their own non-NULL rows, identical to the canonical hybrid policy shape.
- **Policy shape:** same as `cyber_signals`. **No elevation needed** — the route's existing predicate matches what the RLS policy will enforce, so behavior is unchanged when policies land.
- **Stale-comment cleanup (deferred, cosmetic):** the 2026-04-05 migration header says "The signals API route does not filter by organization_id (signals are global intelligence inputs; insights are the org-scoped output layer)." That statement is no longer accurate — the route was tightened to filter at some point after the migration was written. The migration comment is documentation only; it has no runtime effect. Tracked as a doc-fix item for a later cosmetic pass; **not on the A04-G1 critical path**.

### 3. `insights`

- **Why hybrid:** added by `20260405_add_organization_id_to_insights_trends.sql`. Migration comment: "Nullable so existing rows are preserved without an org." A partial unique index `WHERE organization_id IS NOT NULL` supports `ON CONFLICT` for per-org inserts without colliding on legacy nulls.
- **Writers:** `insightGenerator.ts` (per-org).
- **Readers:** insights route filters by org per migration comment, but legacy NULL rows are still present.
- **Policy shape:** same `NULL OR own-org` SELECT. INSERT with own-org GUC. **Migration cleanup candidate:** the legacy NULL rows could be either backfilled or deleted before RLS lands — talk to operator.

### 4. `trends`

- **Why hybrid:** same migration as `insights`; same rationale.
- **Same policy shape.** Same legacy-NULL cleanup question.

### 5. `audit_log`

- **Why hybrid:** pre-auth audit events (request rejected before API key resolved) have NULL org. Post-auth events have the actor's org. `requestAudit.ts:19` reads `apiKey.organization_id` and writes NULL if absent.
- **Writers:** `requestAudit.ts:29`.
- **Readers:** `adminAuditLog.ts:125` — admin reads cross-org by design.
- **Policy shape:** SELECT for engine `NULL OR own-org`. INSERT allow either (the engine writes both per-org and NULL-org audit rows depending on auth state). Admin reads use elevated path.

### 6. `security_audit_log`

- **Why hybrid:** same structural reason as `audit_log` — pre-login events (`auth.login_failed`, `auth.invalid_api_key`) have NULL org. Post-login events have the user's org.
- **Writers:** `auditLog.ts:62` (canonical sink).
- **Readers:** `authAnomaly.ts` scans **cross-org every 5 minutes** for credential-stuffing / API-key-probing patterns — see §4. This is the highest-risk cross-org reader.
- **Policy shape:** SELECT `NULL OR own-org` for engine path; INSERT allows either. `authAnomaly` must run on elevated path.

### 7. `newsletter_issues`

- **Why hybrid:** explicit migration comment `20260406_newsletter_schema.sql:10`: "organization_id on newsletter_issues/subscribers/newsletter_deliveries is nullable: NULL means platform-level (visible to all orgs), non-null means org-specific."
- **Writers:** `adminCreateNewsletterIssue.ts`, brief pipeline.
- **Readers:** customer-side newsletter routes + admin routes.
- **Policy shape:** SELECT `NULL OR own-org`. Writes allow either with appropriate role.

### 8. `subscribers`

- **Why hybrid:** same migration, same comment. Legacy free-tier newsletter subscribers have NULL org; per-org subscribers carry their org.
- **Policy shape:** same as `newsletter_issues`. `adminPromoteNewsletterIssue.ts:53,57` explicitly queries both NULL and non-null branches.

### 9. `newsletter_deliveries`

- **Why hybrid:** same migration, same comment.
- **Policy shape:** same.

### Hybrid policy template (sketch — drafted in phase 0 follow-up `A04-G1-policy-templates.md`)

```sql
-- Pseudocode — to be drafted formally
CREATE POLICY <t>_select ON <t> FOR SELECT
  USING (organization_id IS NULL
         OR organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY <t>_insert ON <t> FOR INSERT
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);

-- Cross-org writes (NULL-org inserts) go via the owner role, bypassing RLS.
```

This is the most fragile policy shape. Phase 3 batch F (hybrid tables) runs **last** and gets its own staging gate.

---

## §4. Cross-org reader hunt — completeness proof

This is the highest-risk classification step. Under RLS, a missed cross-org reader that today returns multi-tenant rows will silently return only the requesting org's rows — or zero rows — without error. The user-visible symptom is "data missing," not "error 500." Tests have to be written for every path.

### Hunting method (already summarized in §1; expanded here for transparency)

1. **Cron enumeration.** `grep -rln "cron\\.schedule\\|setInterval(" src/`. Result: 4 `schedule(…)` registrations in `schedulerRunner.ts` (lines 53, 103, 121, 140). Each was opened and its handler body read.
2. **Per-org loop pattern.** `grep -l "FROM organizations" src/api/lib/*.ts`. Result: 4 files. Each was inspected for the loop body.
3. **Worker/service inspection.** All 23 files in `src/api/lib/` opened or grepped for query call sites. The ingestion adapters (`cisaKevAdapter`, `cisaAlertsAdapter`, `nvdAdapter`, `mitreAttackAdapter`, `mitreAtlasAdapter`, `feedAdapter/*`, `sourceDisplayNames`) verified to be **pure HTTP fetch / parse** with **no DB writes** — they return data, the writer is `cyberSignalProcessingService`.
4. **Admin route review.** All 20 `src/api/routes/admin*.ts` files reviewed for cross-org SELECT shape.
5. **Pre-context auth audit.** `requireApiKey.ts`, `requireAuth.ts`, `attachOrganizationContext.ts`, customer-auth routes, webhooks reviewed for queries that run before `app.current_org_id` is set.
6. **Routes that read from HYBRID tables without an `organization_id` predicate** specifically grepped (see §3 — `signals` API route called out by migration comment).
7. **Scripts in `scripts/`.** 7 scripts touch the DB; all reviewed.

### Confirmed cross-org READERS (will break under RLS if not given elevated path)

| Path | What it reads cross-org | Treatment |
|---|---|---|
| `src/api/lib/authAnomaly.ts` (cron every 5 min, `schedulerRunner.ts:140`) | scans `security_audit_log` across all orgs for credential-stuffing + API-key probing patterns | **must use elevated role.** Cannot iterate per-org because the threat actor pattern is one-IP-attacking-many-orgs |
| `src/api/lib/cyberSignalProcessingService.ts` (called from `briefScheduler` and route handlers) | line 715 `FROM organizations` (cross-org); lines 234/249/800 vendor-name match across orgs for signal-to-vendor linking | parts run per-org (fan-out), parts cross-org. The cross-org match step needs elevated path |
| `src/api/lib/briefScheduler.ts:455` | `SELECT DISTINCT organization_id FROM intelligence_brief_subscribers WHERE active=TRUE` then loops orgs | enumerates orgs, then per-iteration sets GUC. The `SELECT DISTINCT` itself is cross-org → elevated path for that one query; loop body runs per-org under GUC |
| `src/api/lib/summaryScheduler.ts:9` | `SELECT id, name FROM organizations WHERE status='active'` then loop | same shape as briefScheduler — outer enumeration elevated, loop body per-org |
| `src/api/lib/digestScheduler.ts:18` | iterates `orgsResult.rows` (same pattern) | same |
| `src/api/lib/findingAlertTrigger.ts:32` | reads `users JOIN organizations` filtered to one org | already per-org via `WHERE u.organization_id = $1`. RLS-compatible; **no elevation needed** |
| `src/api/lib/briefEmailSender.ts:428` | reads `organizations` by id, then per-org subscribers | per-org caller; RLS-compatible once GUC is set |
| `src/api/lib/postureSnapshot.ts:71,173` | per-org reads | per-org; RLS-compatible |

### Confirmed cross-org ADMIN routes (read across all tenants by design)

| Path | What it reads cross-org | Treatment |
|---|---|---|
| `src/api/routes/adminOrganizations.ts` | full `FROM organizations` list; INSERT/UPDATE on org rows | admin uses owner/elevated connection (the §3 of `TENANT_ISOLATION_STANDARD.md` admin surface). All admin routes are gated by `requireAdminKey` chain |
| `src/api/routes/adminApiKeys.ts:68` | `FROM api_keys` cross-org list | elevated path |
| `src/api/routes/adminAuditLog.ts:125` | `FROM audit_log` cross-org (hybrid table) | elevated path |
| `src/api/routes/adminIssues.ts:72-82` | `FROM intelligence_briefs ib LEFT JOIN organizations o…` cross-org | elevated path |
| `src/api/routes/adminBriefSubscribers.ts:88-162` | `FROM intelligence_brief_subscribers ibs LEFT JOIN organizations o…` cross-org | elevated path |
| `src/api/routes/adminOpsHealth.ts:73` | `SELECT COUNT(DISTINCT u.id) FROM users u INNER JOIN organizations o … INNER JOIN email_suppressions es …` — cross-org aggregate | elevated path |
| `src/api/routes/adminOpsOverview.ts` | reads global tables only (`newsletter_*`, `email_suppressions`, `worker_runs`) — no customer-data | no elevation needed (just permissions on SHARED-REF tables) |
| `src/api/routes/adminPromoteNewsletterIssue.ts:53,57` | `subscribers WHERE organization_id IS NULL` + per-org — touches hybrid table | elevated path or per-org with NULL-clause policy |

All other `admin*.ts` routes operate on a specific org via path parameter (`/admin/organizations/:id/…`) and after acquiring the target org's id, must `SET LOCAL app.current_org_id = <target>` before subsequent queries — same shape as customer routes, just with a different mechanism for choosing the org.

### Confirmed cross-org WRITERS (write NULL-org or all-org rows)

| Path | What it writes | Treatment |
|---|---|---|
| `src/api/lib/cyberSignalProcessingService.ts` (ingestion persistence) | inserts to `cyber_signals` with `organization_id = NULL` for global advisories | **must use elevated role** — RLS INSERT policy `WITH CHECK (organization_id = GUC)` would reject NULL inserts |
| `src/api/middleware/requestAudit.ts:29` | inserts to `audit_log` with `organization_id` possibly NULL (pre-auth requests) | **two paths needed:** authenticated requests write under their GUC; pre-auth requests write under elevated path with NULL org |
| `src/api/lib/auditLog.ts:62` | inserts to `security_audit_log` with `organization_id` possibly NULL (login_failed before user resolved) | same dual-path treatment |
| `src/api/infra/issueStore.ts:363` | inserts to `published_artifacts` (global, SHARED-REF) | not under RLS; needs owner-role grant |
| `src/api/infra/workerLogger.ts:12,35,65` | inserts/updates `worker_runs` (SHARED-REF) | not under RLS |
| `src/api/webhooks/webhookIdempotency.ts:29` | inserts `webhook_events_processed` (SHARED-REF) | not under RLS |

### Confirmed pre-context auth reads (run BEFORE the org GUC is set)

These read customer-data tables before `attachOrganizationContext` has set `app.current_org_id`. Under B1, they run **outside** the request transaction (or inside it with the GUC still unset). Either way they will return zero rows under RLS unless given elevated access.

| Path | What it does | Treatment |
|---|---|---|
| `src/api/middleware/requireApiKey.ts:114, 149` | `SELECT ... FROM api_keys WHERE key_hash = $1` (no org filter — this is *resolving* the org from the key) | **must use elevated path.** This is the foundational identity-resolution query; without it, no org is ever bound |
| `src/api/middleware/requireApiKey.ts:76` | `SELECT password_changed_at FROM users WHERE id = $1` (no org filter) | elevated path |
| `src/api/middleware/requireAuth.ts:47` | same pattern for user-session auth | elevated path |
| `src/api/routes/customerAuth.ts:297, 475, 774` | `SELECT … FROM users WHERE email = $1` — login/forgot-password/account-create flows by email | elevated path — pre-auth, no org context |
| `src/api/routes/teamInvites.ts:689` | `SELECT id, status FROM users WHERE LOWER(email) = $1` (invite-acceptance) | elevated path |
| `src/api/webhooks/stripeWebhook.ts:311, 320, 624, 826` | `SELECT id FROM organizations WHERE stripe_customer_id = $1`; `SELECT organization_id FROM api_keys WHERE id = $1` — resolves which org the Stripe event belongs to | elevated path (webhooks have no api-key auth chain) |
| `src/api/webhooks/lemonWebhook.ts:61` | `UPDATE organizations … WHERE id = (SELECT organization_id FROM api_keys WHERE key_hash = $2)` — resolves org from inbound webhook | elevated path |
| `src/api/startup/startupCheck.ts:87` | `SELECT id, organization_id, url FROM webhook_endpoints` — full enumeration at boot | elevated path (this runs once at server boot, has no request context) |

### Scripts that touch DB (run from operator workstation, NOT in request path)

All scripts run with whatever `DATABASE_URL` is set in the operator's shell. Under A1, this is the owner role — these scripts bypass RLS by default and that's correct.

| Path | Notes |
|---|---|
| `scripts/seed-demo.ts` | inserts org + users + frameworks etc. owner-role |
| `scripts/seed-staging.ts` | similar; also cross-org cleanup queries (`FROM organizations … WHERE …`) |
| `scripts/backfill-vendor-assurance-cuecs.ts` | cross-org backfill across all `vendor_assurance_documents` rows |
| `scripts/triggerBriefForOrg.ts:99` | `UPDATE insights SET published = TRUE WHERE id = ANY($1)` — no org predicate; expects to update across whatever ids you pass |
| `scripts/backfillRequirementDescriptions.ts` | iterates frameworks, updates requirements |
| `scripts/add-test-subscriber.ts` | `UPDATE subscribers` — hybrid table |
| `scripts/test-matcher-staging.ts` | reads cross-org for testing |
| `scripts/runMigrations.ts` | DDL; needs owner role |

**Treatment:** all scripts continue to use the owner-role `DATABASE_URL`. The migrate runner under A1 specifically needs an env var that points at the owner role; the engine's `DATABASE_URL` points at `app_request`. Decision: introduce `MIGRATION_DATABASE_URL` for the migrate runner. Scripts can either use `DATABASE_URL` (if a separate operator value), or take a `--connection` flag. To be decided in phase 0 follow-up.

### Residual risk — explicit acknowledgement

The hunt above turned up no cross-org readers not already named. **However, completeness cannot be proven by grep.** Specific residual risks the hunt could miss:

1. **Dynamically-constructed SQL** that doesn't match the static grep patterns. Spot-checked: I found no `pg.query(\`SELECT … ${var} …\`)` shapes where the table name was variable. But the harness in `test/isolation/testDb.ts` and `scripts/seed-*.ts` does build dynamic SQL — these are operator-side, not engine-side, so out of the RLS hot path.
2. **Triggers and views.** No `CREATE TRIGGER` or `CREATE VIEW` exists in `db/migrations/` (verified by grep). If one is added later, the trigger function runs as the owner of the table and may inadvertently bypass RLS.
3. **The `pg` library's automatic reconnect path.** If a pool connection drops mid-transaction under B1, the new connection won't have the `SET LOCAL` applied. This is an implementation detail of the request-wrapping middleware to handle in phase 1.
4. **Future routes added after phase 0 lands.** Any new customer-data route written after the matrix is locked needs to be classified. Add to `TENANT_ISOLATION_STANDARD.md §10.A` checklist.
5. **The `findings` indirect-FK pattern**, multiplied across the 9 INDIRECT tables, means RLS policy on those tables performs a subquery lookup every read. If the subquery's plan degrades on a large tenant, latency does too. To be measured during phase 2 pilot.

**I cannot certify the list is exhaustive.** The five passes above cover the patterns I know to look for; new cross-org call sites will be found and named during phase 1 plumbing as queries get migrated onto `withTenant` / the elevated helper, and a missed one will surface as a phase 2 staging test failure.

### Update 2026-05-24 — `services/` subtree was missing from the original hunt

The original hunt enumerated `src/` and `scripts/` only. The repository also contains a `services/` subtree with **two additional Postgres-writing deployables** that were not searched. This is the residual-risk warning above made concrete. See §7 for the full deployable inventory and DATABASE_URL set.

#### New cross-org READERS (from the services/ tree)

| Path | What it reads cross-org | Treatment |
|---|---|---|
| `services/intelligence-worker/src/generators/insightGenerator.ts:125-139` | `SELECT id, organization_id, … FROM signals ORDER BY created_at DESC LIMIT 50` — **no `organization_id` predicate**, deliberately reads recent signals across all orgs to derive insights | **elevated path.** This is the upstream cause of the NULL-org `insights` rows reported in §6 item 1 |
| `services/posture-worker/src/index.ts:27-29` | `SELECT id FROM organizations WHERE status = 'active'` then per-org loop | enumerates orgs (cross-org one-statement), then per-iteration sets GUC — same shape as the engine's `briefScheduler`/`summaryScheduler` |

#### New cross-org WRITERS (from the services/ tree)

| Path | What it writes | Treatment |
|---|---|---|
| `services/intelligence-worker/src/pipeline/runPipeline.ts:108-125` | inserts `cyber_signals` with `organization_id` hardcoded NULL (`VALUES (NULL, $1, …)`) — duplicate of the in-engine ingestion path | elevated path |
| `services/intelligence-worker/src/storage/postgresSignalStore.ts:46` | inserts `signals` with caller-supplied `organization_id` (mostly NULL on the ingestion path) | elevated path |
| `services/intelligence-worker/src/generators/insightGenerator.ts:171, 207` | inserts `insights` with `organization_id = NULL` (line 171 branch) or per-org (line 207 branch) | elevated path for the NULL branch; per-org GUC for the non-null branch |
| `services/intelligence-worker/src/pipeline/runPipeline.ts:415` | calls `saveTrend({ organizationId: null, … })` — every trend row written as NULL-org | elevated path. **No per-org trend writer exists in this tree** |
| `services/intelligence-worker/src/storage/postgresIssueStore.ts:21` | inserts `newsletter_issues` (HYBRID) | elevated path for NULL-org; per-org GUC otherwise |
| `services/intelligence-worker/src/storage/deliveryStore.ts:10`, `generators/newsletterDeliveryGenerator.ts:108`, `generators/newsletterDelivery.ts:79` | inserts `newsletter_deliveries` (HYBRID) | same treatment as `newsletter_issues` |
| `services/intelligence-worker/src/storage/subscriberStore.ts:6` | inserts `subscribers` (HYBRID) | elevated path |
| `services/intelligence-worker/src/storage/runStore.ts:6`, `postgresRunStore.ts:6` | inserts `worker_runs` (SHARED-REF) | elevated path (already owner-only in §5 grant matrix) |
| `services/intelligence-worker/src/generators/newsletterGenerator.ts:77` | `UPDATE insights SET published = TRUE WHERE id = ANY($1)` — no org predicate; updates whatever ids are passed | needs review: under RLS, this UPDATE goes through whichever role runs the worker. If elevated, works as-is; if `app_request`, the WHERE clause must add an org predicate or the update silently no-ops for cross-org rows |
| `services/posture-worker/src/index.ts:49` → `computeAndSavePostureSnapshot(orgId)` in `src/api/lib/postureSnapshot.ts` | writes `posture_snapshots` (CUSTOMER-DATA), `domain_scores` (INDIRECT) per-org | per-org GUC after the outer enumeration; treatment matches engine-side per-org workers |

#### `assessSignal.ts` — ✅ CLOSED 2026-05-24 by deletion

`services/intelligence-worker/src/pipeline/assessSignal.ts` previously defined `assessSignal(organizationId, signal)`, which wrote to **three CUSTOMER-DATA tables** (`assessments`, `findings`, `reports`) and carried a latent `NOT NULL` constraint bug: the `reports` INSERT omitted `organization_id`, a column made `NOT NULL` after the function was authored (migration `20260504_reports_organization_id.sql`). Reviving the function would have failed before any RLS policy was involved.

The function was confirmed dead across the entire repo via three independent greps:
- Full-repo name reference → only the export definition (and doc references, no imports).
- Module-path import grep (`from "…assessSignal"` / `import…assessSignal`) → **zero hits**.
- Barrel re-exports + `pipeline/index.ts` → none exist.
- Tests in all four `__tests__/` directories under the worker → zero hits.

**File deleted.** Compiled artifact `dist-intelligence-worker/services/intelligence-worker/src/pipeline/assessSignal.js` was gitignored (`.gitignore:12` — `dist-*/`), so no tracked artifact removal was needed; the artifact stops being emitted on the next build. The latent bug is now closed without a fix-and-revive path. Should the assessment-from-signal capability be needed again in the future, it would be re-implemented with the `organization_id` shape correct from the start.

#### Residual-risk update — IaC is not authoritative for the deploy set

Knowing about `services/` only happened because `grep` reached outside `src/`. The render.yaml IaC is *also* known to drift from reality (memory `project_staging_frontend_gap_2026_05_07`: `securelogic-app-staging` is live but undeclared). So the deployable enumeration in §7 is grounded in render.yaml but **render.yaml itself is not the source of truth for what is running.** Any deploy that exists but is missing from render.yaml will also be missing from the A04-G1 rollout, and will break in prod under RLS the same way `services/intelligence-worker` would have.

---

## §5. Grant matrix for the `app_request` role (A1)

### Conventions

- **Customer-data table → "scoped DML":** `GRANT SELECT, INSERT, UPDATE, DELETE` on the table. RLS policy enforces tenant scope at the row level.
- **Hybrid table → "scoped SELECT, no INSERT/UPDATE/DELETE of NULL-org rows":** `GRANT SELECT, INSERT, UPDATE, DELETE` with policy ensuring INSERT row matches GUC; NULL-org writes go via owner.
- **Indirect table → "scoped DML with subquery policy":** same as customer-data; policy uses a subquery against the parent's `organization_id`.
- **SHARED-REF table → "no grant or SELECT-only":** these tables are accessed only via the owner role for writes; some admin reads via owner; engine reads only where the data is genuinely tenant-irrelevant (e.g. `email_suppressions` check at customer-auth time).
- **ROOT-TENANT (`organizations`) → "SELECT only":** engine never creates orgs from a customer request; orgs are created via admin / Stripe (owner-role). Engine reads to attach context.
- All grants additionally require `GRANT USAGE ON SCHEMA public` and `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public` (Postgres requires sequence USAGE for INSERTs that touch `DEFAULT gen_random_uuid()` columns — `gen_random_uuid` is fine without sequences, but any `SERIAL` columns require it; the schema has none today but future-proof).

### Grant table

| Table | Bucket | `app_request` grants |
|---|---|---|
| `actions` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `ai_governance_assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `ai_systems` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `ai_system_vendor_dependencies` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `alert_sends` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `api_keys` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE — *plus* the requireApiKey resolution query runs as **owner** (pre-context) |
| `api_usage_daily` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `audit_log` | HYBRID | SELECT, INSERT (own-org); NULL-org INSERT via owner |
| `auth_anomaly_alerts` | SHARED-REF | none (owner-only — written by elevated authAnomaly scan) |
| `control_assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `control_mappings` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `controls` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `cyber_signals` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only); NULL-org INSERT via owner |
| `dashboard_preferences` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `dependencies` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `dependency_assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `domain_scores` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `email_suppressions` | SHARED-REF | SELECT only (read by alertEmailService + customer-auth). INSERT/DELETE via owner (admin-only) |
| `evidence` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `findings` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `frameworks` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `governance_reviews` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `insights` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only); NULL-org writes via owner |
| `intelligence_brief_items` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `intelligence_briefs` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `intelligence_brief_sends` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `intelligence_brief_sources` | SHARED-REF | SELECT only (catalog read) |
| `intelligence_brief_subscribers` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `newsletter_deliveries` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only) |
| `newsletter_issue_insights` | INDIRECT | SELECT, INSERT, UPDATE, DELETE (parent-driven policy) |
| `newsletter_issues` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only) |
| `obligation_assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `obligation_mappings` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `obligations` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `organization_risk_scales` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `organizations` | ROOT-TENANT | **SELECT only.** No INSERT, UPDATE, or DELETE for `app_request`. All write paths run elevated: admin org-create, Stripe-driven org create, **and customer-auth signup** (resolved per §6 item 3, option (a)). Engine reads the row only inside `attachOrganizationContext` to load entitlement |
| `org_invites` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `org_sso_configs` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `password_history` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `policies` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `policy_control_links` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `posture_snapshots` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `published_artifacts` | SHARED-REF | SELECT only (read by engine for issue serving); INSERT via owner |
| `reports` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `requirement_responses` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `requirements` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `risk_control_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `risk_obligation_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `risks` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `risk_scale_presets` | SHARED-REF | SELECT only (catalog read) |
| `risk_scoring_weights` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `risk_settings` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `risk_treatments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `security_audit_log` | HYBRID | SELECT (NULL OR own-org), INSERT (own-org); NULL-org INSERT via owner (pre-auth events); cross-org READ via owner (authAnomaly) |
| `signal_ai_system_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `signal_control_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `signal_match_suggestions` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `signal_obligation_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `signals` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only); NULL-org via owner. Route already implements the hybrid predicate at `signals.ts:40` — no behavior change expected |
| `signal_vendor_links` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `subscribers` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only); NULL-org via owner |
| `trends` | HYBRID | SELECT (NULL OR own-org), INSERT/UPDATE (own-org only) |
| `trend_signals` | INDIRECT | SELECT, INSERT, UPDATE, DELETE |
| `user_alert_preferences` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `users` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE — *plus* pre-context email-based lookups (`customerAuth.ts`, `teamInvites.ts:689`, `requireApiKey.ts:76`, `requireAuth.ts:47`) run via **owner** |
| `vendor_assessments` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_cuec_control_mappings` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_cuecs` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_documents` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_extractions` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_extraction_spans` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_field_overrides` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_assurance_review_decisions` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendor_reviews` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `vendors` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `webhook_deliveries` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE |
| `webhook_endpoints` | CUSTOMER-DATA | SELECT, INSERT, UPDATE, DELETE — *plus* startup enumeration in `startupCheck.ts:87` via **owner** |
| `webhook_events_processed` | SHARED-REF | none (owner-only — webhook idempotency is system-level) |
| `worker_runs` | SHARED-REF | none (owner-only — worker telemetry) |
| `schema_migrations` | (bookkeeping) | none (owner-only — migrate runner) |

### Schema-level

```
GRANT USAGE ON SCHEMA public TO app_request;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_request;
-- and ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT … TO app_request
-- so future tables created by owner inherit the grant.
```

The default-privileges step is critical: without it, every new table added in a future migration would have to manually re-grant to `app_request`, and one missed grant breaks the engine silently. With it, every new table gets the same grant shape automatically — and the policy `ENABLE RLS` is what locks it down.

### Grants the role does NOT receive

- `BYPASSRLS` attribute. The whole point is that `app_request` is non-bypass.
- `CREATE` on schema `public`. DDL is owner-only.
- DML on `auth_anomaly_alerts`, `webhook_events_processed`, `worker_runs`, `schema_migrations`. These are touched only by elevated paths (workerLogger, webhookIdempotency, migrate runner, authAnomaly).
- INSERT/UPDATE/DELETE on `organizations`. Engine never creates orgs from a customer request; admin/Stripe paths run owner-role.

---

## §6. Open items for operator review before phase 1

1. **HYBRID legacy-NULL cleanup — ✅ RESOLVED 2026-05-24. `insights` and `trends` are HYBRID by design, not legacy.** Staging counts: 2,126 NULL-org `insights` and 7,570 NULL-org `trends`, MIN `created_at` 2026-04-30, MAX 2026-05-24 (minutes before this finding was recorded). The rows are *current operational output*, not pre-migration leftovers. Same shape as `cyber_signals` and `signals`: the cross-org feed pipeline emits global rows with `organization_id = NULL`; per-org fan-out happens downstream at consumption time. Writers traced to `services/intelligence-worker/src/generators/insightGenerator.ts:125` (`generateInsights()` — reads `signals` cross-org, inherits the signal's NULL/non-null org) and `services/intelligence-worker/src/pipeline/runPipeline.ts:415` (`saveTrend({ organizationId: null, … })` — every trend is global by design). **No backfill, no delete.** Hybrid `NULL OR own-org` SELECT policy is correct (every tenant gets the global rows plus their own); the NULL-INSERT path goes through the **elevated role** in phase 1, same treatment as `cyberSignalProcessingService`. The original "legacy-only" framing was wrong because the cross-org reader hunt missed an entire deployable — see §7 and §4 update below.
2. **`signals` route cross-org read pattern.** ✅ **RESOLVED 2026-05-24 — classified HYBRID, no elevation.** The migration comment that flagged this for review (`20260405_add_organization_id_to_signals.sql` lines 9-10: "The signals API route does not filter by organization_id…") is stale. The current route at `src/api/routes/signals.ts:40` reads `WHERE (organization_id = $1 OR organization_id IS NULL)` — the exact canonical hybrid SELECT pattern. The route works unchanged under the standard hybrid policy; no elevation, no UX impact. Migration comment is doc-only and tracked as a cosmetic doc-fix; **not on the A04-G1 critical path**.
3. **Customer signup → org creation path.** ✅ **RESOLVED 2026-05-24 — option (a) signup runs elevated.** `app_request` retains *no* INSERT/UPDATE/DELETE on `organizations`. The signup path joins the pre-context auth reads in §4 as an elevated-connection call site. Treat it as the same category — same role, same connection lifecycle, same future audit cue. (Original options preserved for reference: (a) signup elevated, (b) grant `app_request` INSERT on organizations, (c) stored procedure as owner.)
4. **`MIGRATION_DATABASE_URL` introduction.** ✅ **RESOLVED 2026-05-24 — plan accepted.** Sequencing: introduce `MIGRATION_DATABASE_URL` in Render env at the end of phase 0 (after this matrix is approved), populated with the **owner-role** connection string. `DATABASE_URL` is then repointed to `app_request` as the first act of phase 1 — single coordinated config flip. Until that flip, the engine's `DATABASE_URL` keeps pointing at the owner role (no behavior change) and `MIGRATION_DATABASE_URL` is unused. Engine `startCommand` `npm run migrate` reads `MIGRATION_DATABASE_URL` (falling back to `DATABASE_URL` for backwards compatibility during the transition).
5. **Bucket assignment edge cases.** ✅ **RESOLVED 2026-05-24 — confirmed CUSTOMER-DATA.** Operator confirmed `frameworks` and `controls` are org-cloned: each tenant has its own rows (no shared global catalog). Migration `20260415_control_framework_primitives.sql` describes them explicitly as "org-scoped compliance framework reference" and "org-specific control implementations," and both `CREATE TABLE` bodies declare `organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE` with `UNIQUE (organization_id, name [, version])`. Per-org RLS policy is the correct shape.

**HOLD — all §6 items closed 2026-05-24.** Phase 0 now blocks only on the items in §7 (deployable inventory, intelligence-worker writer treatment, `assessSignal.ts` latent-bug cleanup). No migrations, grants, or worker code changes authored.

---

## §7. Deployable inventory — full set of `DATABASE_URL` holders

The A1 connection-string flip (engine `DATABASE_URL` repointed from owner to `app_request`) must be applied **simultaneously** to every Render service that connects to the same Postgres. A missed deployable means that service keeps connecting as the owner and silently bypasses RLS — exactly the failure mode the rollout is designed to prevent. A missed deployable that holds the *new* `app_request` URL but doesn't have its NULL-org writes elevated breaks in prod under RLS.

### Inventory (sourced from `render.yaml`, audited 2026-05-24)

`grep -c DATABASE_URL render.yaml` → **5 matches**, on five services:

| # | Service name | Type | Env | Source path | Connects as | Phase-1 flip target | NULL-org writes? |
|---|---|---|---|---|---|---|---|
| 1 | `securelogic-engine` | web | prod | `src/api/` | owner today → `app_request` after flip | yes | yes — `requestAudit.ts`, `auditLog.ts` (pre-auth events) |
| 2 | `securelogic-engine-staging` | web | staging | `src/api/` | owner today → `app_request` after flip | yes | yes — same |
| 3 | `securelogic-intelligence-worker` | worker | prod | `services/intelligence-worker/src/` | owner today → `app_request` after flip | yes | **yes — heavy.** Confirmed writers in §4 update: `cyber_signals`, `signals`, `insights`, `trends`, `newsletter_issues`, `newsletter_deliveries`, `subscribers`, `worker_runs`. All NULL-org or system-table writes need the **elevated role**, not `app_request`. Worker code must take the same shape as the engine's `withTenant` / elevated helper |
| 4 | `securelogic-intelligence-worker-staging` | worker | staging | `services/intelligence-worker/src/` | owner today → `app_request` after flip | yes | yes — same |
| 5 | `securelogic-posture-worker` | worker | prod | `services/posture-worker/src/` | owner today → `app_request` after flip | yes | no NULL-org writes — purely per-org. Only the outer org-enumeration is cross-org and that step needs the elevated path |

### Services in render.yaml that are NOT DATABASE_URL holders

| Service | Notes |
|---|---|
| `securelogic-app` | Next.js. Calls the engine via `ENGINE_API_URL` over HTTP — does not connect to Postgres directly. No flip needed. |
| `securelogic-website` | Static marketing site. No DB at all. |

### Two flip targets need not exist yet but are implied

| Target | Why it's implied | Action |
|---|---|---|
| `securelogic-posture-worker-staging` | Production worker exists but **no staging counterpart is declared in render.yaml.** Either staging posture runs out of the engine-staging in-process (unlikely — the engine has no `setInterval` for posture), or staging has no posture worker, or there's an undeclared staging deployment | Operator: confirm staging posture-worker existence; if it exists, declare in render.yaml and include in the flip |
| `MIGRATION_DATABASE_URL` on every service | Per §6 item 4 (resolved): the migrate runner needs the owner-role URL. Currently the engine's `startCommand` runs `npm run migrate && npm start` so it needs both URLs. Workers do not run migrations, so they don't need `MIGRATION_DATABASE_URL` — only the engine prod and engine staging do | Phase 0 finalization: add `MIGRATION_DATABASE_URL` env var on `securelogic-engine` and `securelogic-engine-staging` only, populated with the existing owner-role URL |

### IaC drift — render.yaml may not be the complete deploy set

**This is a load-bearing residual risk.** Per memory `project_staging_frontend_gap_2026_05_07`, `securelogic-app-staging` is **live** but **not declared in render.yaml**. The same drift could conceal a Postgres-connecting deployable.

Before the phase-1 flip:
- Operator should pull the Render dashboard's services list and reconcile against render.yaml.
- Every service that holds a `DATABASE_URL` env var (visible in the dashboard) must be in the §7 inventory. If any is missing, it gets added.
- Bring `render.yaml` into agreement with reality as part of phase 0 finalization. The undeclared `securelogic-app-staging` should also be codified at this point so the gap doesn't propagate.

### Action items for phase 0 finalization (depend on operator)

1. Reconcile render.yaml against the Render dashboard's actual service list; codify any undeclared service (notably `securelogic-app-staging`). Confirm whether `securelogic-posture-worker-staging` exists or not.
2. Add `MIGRATION_DATABASE_URL` env var on `securelogic-engine` and `securelogic-engine-staging`, populated with the existing owner-role URL.
3. ✅ **RESOLVED 2026-05-24 — file deleted.** `services/intelligence-worker/src/pipeline/assessSignal.ts` removed in PR #91. Dead-code confirmation (three independent greps: name reference, module-path import, barrel re-export) and rationale captured in the §4 sub-section. No tracked artifact in `dist-intelligence-worker/` to remove (gitignored).
4. Confirm `securelogic-app` (Next.js portal) genuinely does not touch Postgres directly — spot-check `app/lib/` and any server-side route handlers for `pg` imports. If anything does, this inventory grows.
