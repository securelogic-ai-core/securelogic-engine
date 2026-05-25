# TENANT_ROUTE_CLASSIFICATION.md

## Purpose
This document records the per-route tenant-isolation classification for every route file in `src/api/routes/` that does NOT reference `organization_id` / `organizationId` / `organizationContext` in its source. It is the evidence artifact for risk **R2** in `TENANT_ISOLATION_STANDARD.md` §11.

It is a point-in-time record. When new routes land, the classification table here MUST be updated as part of the same PR. The test in `src/api/__tests__/tenantScopingGuard.test.ts` enforces the inverse rule for *customer-data* routes (it asserts they DO scope by `organization_id`).

## Method
1. List every `src/api/routes/*.ts` file that does not match the regex `organization_id|organizationId|organizationContext`.
2. Read each file in full or to the first 25–30 lines.
3. Classify each as **tenant-irrelevant** or **customer-data risk**, with evidence.
4. For customer-data risks, file a fix in the same package (or open a follow-on package).

## Snapshot
- Date of original inspection: 2026-05-04
- Date last re-synced: 2026-05-21
- Total route files in `src/api/routes/`: 110
- Files referencing org scoping: 88
- Files NOT referencing org scoping (subject of this artifact): 22

> **Re-sync note (2026-05-21).** The 2026-05-04 snapshot counted 100 files
> (74 org-scoped / 26 not). Since then 12 route files were added — all 12
> reference org scoping (see "Routes added since the 2026-05-04 snapshot"
> below) — and 2 were deleted (`adminAuth.ts`, `adminLoginPage.ts`,
> removed in the admin-auth cleanup; their classification rows are removed
> from the table below). Net: 100 → 110 files, 74 → 88 org-scoped,
> 26 → 22 not.
>
> The classification table below carries **24 rows**: the 22 currently
> non-org-scoped files, plus `alertPreferences.ts` and
> `vendorAssessmentAnalysis.ts`. The latter two were remediated in the
> tenant-isolation-enforcement package and now reference org scoping;
> their rows are retained as remediation evidence rather than deleted.

## Classification table

| File | Class | Evidence |
|---|---|---|
| `accountRecovery.ts` | tenant-irrelevant | Pre-auth account-recovery flow. Email + token lookup, no org context yet exists for the caller. Same model as `customerAuth.ts`. |
| `adminBriefs.ts` | tenant-irrelevant | Wraps `POST /api/admin/briefs/run-scheduler`; bearer-token authed via `SCHEDULER_SECRET`. Calls `runScheduler()`, which is itself per-org (verified in R5 trace). No customer-data SQL. |
| `adminCreateEmailSuppression.ts` | tenant-irrelevant | Operates on `email_suppressions` — global platform-internal table per `TENANT_ISOLATION_STANDARD.md` §1. |
| `adminDeadLetterNewsletterDeliveries.ts` | tenant-irrelevant | Operates on `newsletter_deliveries` — global free-newsletter table. |
| `adminDeleteEmailSuppression.ts` | tenant-irrelevant | Global `email_suppressions`. |
| `adminDeleteNewsletterIssue.ts` | tenant-irrelevant | Global `newsletter_issues`. |
| `adminDeliveryMetrics.ts` | tenant-irrelevant | Aggregate metrics over global newsletter delivery tables. |
| `adminEmailProviderEventById.ts` | tenant-irrelevant | Global `email_provider_events`. |
| `adminEmailProviderEvents.ts` | tenant-irrelevant | Global `email_provider_events`. |
| `adminEmailSuppressions.ts` | tenant-irrelevant | Global `email_suppressions`. |
| `adminEntitlements.ts` | tenant-irrelevant | Manages Redis-backed entitlements keyed by `entitlement:<apiKey>`. The `apiKey` is unique per org by `api_keys.organization_id` uniqueness; no cross-org collision possible. Admin-only route. |
| `adminIssueDeliveryMetrics.ts` | tenant-irrelevant | Global newsletter delivery metrics. |
| `adminOpsDashboard.ts` | tenant-irrelevant | Static admin dashboard HTML (CSP-restricted). |
| `adminOpsOverview.ts` | tenant-irrelevant | Reads platform-internal counts (worker runs, queue depths). No customer-row reads. |
| `adminRequeueNewsletterDeliveriesByIssue.ts` | tenant-irrelevant | Global `newsletter_deliveries`. |
| `adminRequeueNewsletterDelivery.ts` | tenant-irrelevant | Global `newsletter_deliveries`. |
| `adminSuppressions.ts` | tenant-irrelevant | Global `email_suppressions`. |
| `debugAdmin.ts` | tenant-irrelevant | Echoes the admin-key match status. No DB. |
| `emailProviderWebhook.ts` | tenant-irrelevant | Resend webhook; writes to global `email_provider_events` and `email_suppressions`. |
| `index.ts` | tenant-irrelevant | Router aggregator only. No handlers. |
| `issues.ts` | tenant-irrelevant | Public Intelligence Brief signed-artifact endpoint. Reads from `issueStore` infra; not a customer-data table. |
| `unsubscribe.ts` | tenant-irrelevant | Token-validated unsubscribe; writes to global `email_suppressions`. |
| `alertPreferences.ts` | **CUSTOMER-DATA — fixed in this package** | `user_alert_preferences` was queried by `WHERE user_id = $1` only. Standard §4 requires `organization_id = $orgId`. Fixed by adding `organization_id` column (migration `20260604_user_alert_preferences_org_scope.sql`) and adding the predicate to all four query sites. |
| `vendorAssessmentAnalysis.ts` | tenant-irrelevant at the route layer; observability gap fixed | Route uses standard middleware chain, in-memory Multer, does not persist. The route itself produced no SQL leak. The LLM call site (`analyzeAssessmentDocument`) was missing `organizationId` for traceability per Standard §6 — fixed in this package by threading `organizationId` through and logging it. |

## Routes added since the 2026-05-04 snapshot

These 12 route files were added between 2026-05-04 and 2026-05-21. **All 12
reference org scoping** (`organization_id` / `organizationId` /
`organizationContext`), so none is a subject of the classification table
above — that table records only non-org-scoped files. They are recorded
here so the snapshot is complete and so the future cross-org isolation
harness (E1-G1) has a classified manifest source.

| File | Added | Class | Tenancy | Evidence |
|---|---|---|---|---|
| `signalObligationLinks.ts` | 2026-05-04 | customer-data | mixed | Link route. Org-scoped `signal_obligation_links`; `cyber_signals` may be org-owned or global (`organization_id IS NULL`). Carries an explicit global-signal asymmetry guard. Cross-org tests present. |
| `signalVendorLinks.ts` | 2026-05-04 | customer-data | mixed | Link route, same shape — org-scoped links, global-signal asymmetry. Cross-org tests present. |
| `signalControlLinks.ts` | 2026-05-04 | customer-data | mixed | Link route, same shape. Cross-org tests present. |
| `signalAiSystemLinks.ts` | 2026-05-04 | customer-data | mixed | Link route, same shape. Cross-org tests present. |
| `aiSystemVendorDependencies.ts` | 2026-05-05 | customer-data | org-scoped | Link route over `ai_system_vendor_dependencies`; both endpoints org-scoped. Cross-org tests present. |
| `signalMatchSuggestions.ts` | 2026-05-05 | customer-data | org-scoped | `match_suggestions` scoped by `organization_id` from `req.organizationContext`. Cross-org tests present. |
| `riskScoringWeights.ts` | 2026-05-05 | customer-data | org-scoped | `risk_scoring_weights`, one row per org, every query scoped `WHERE organization_id = $1` / `ON CONFLICT (organization_id)`; org id from `req.organizationContext`, never the body. Singleton-per-org — addressed as `/api/risk-scoring-weights` with no `:id` param, so outside the v1 path-param IDOR surface. |
| `riskSettings.ts` | 2026-05-05 | customer-data | org-scoped | `risk_settings`, one row per org, `WHERE organization_id = $1` / `ON CONFLICT (organization_id)`; org id from `req.organizationContext`. Singleton-per-org — addressed as `/api/orgs/me/risk-settings` (`me` = caller's org), no `:id` param, so outside the v1 path-param IDOR surface. |
| `templates.ts` | 2026-05-05 | customer-data | mixed | `GET /api/templates` and `GET /api/templates/:industry` serve **static template content from code** (`src/templates/index.ts`) — global, identical for every org, no DB read. `POST /api/templates/load` is the customer-data write path: `loadTemplate(organizationId, …)` with org id from `req.organizationContext`, writes into the requesting org's inventory. `POST /api/me/dismiss-banner` writes to `users` scoped by `req.userId`. Harness manifest must tag the GET endpoints `global`, not `org-scoped`. |
| `riskControlLinks.ts` | 2026-05-07 | customer-data | org-scoped | Link route over `risk_control_links`, org-scoped. Cross-org tests present. |
| `riskObligationLinks.ts` | 2026-05-07 | customer-data | org-scoped | Link route over `risk_obligation_links`, org-scoped. Cross-org tests present. |
| `vendorAssuranceDocuments.ts` | 2026-05-08 | customer-data | org-scoped | SOC-document upload/read scoped by `organization_id`. Cross-org tests present. |

## Allowlist source for `tenantScopingGuard.test.ts`
The narrow guard in `src/api/__tests__/tenantScopingGuard.test.ts` consumes this table indirectly: it has a curated allowlist of customer-data route files (a strict subset of the 88 org-scoped files) and asserts each:
- imports `requireApiKey` AND `attachOrganizationContext`
- contains the literal `organization_id` somewhere in the source

The guard does NOT scan tenant-irrelevant routes. Adding a new customer-data route requires adding it to the guard's allowlist — that is the enforcement seam.

## Maintenance
- When a route changes class (e.g. a previously-public route gains org scoping), update this table in the same PR.
- When a new customer-data route is added, add it to the guard allowlist and to the customer-data side of the table here.
- When `email_suppressions`, `newsletter_issues`, or any other table currently treated as global is migrated to be org-scoped, every route that touches it must move to the customer-data side.
