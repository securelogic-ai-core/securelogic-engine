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
- Date of inspection: 2026-05-04
- Total route files in `src/api/routes/`: 100
- Files referencing org scoping: 74
- Files NOT referencing org scoping (subject of this artifact): 26

## Classification table

| File | Class | Evidence |
|---|---|---|
| `accountRecovery.ts` | tenant-irrelevant | Pre-auth account-recovery flow. Email + token lookup, no org context yet exists for the caller. Same model as `customerAuth.ts`. |
| `adminAuth.ts` | tenant-irrelevant | Staff login (Argon2 + session). No customer-data queries. |
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
| `adminLoginPage.ts` | tenant-irrelevant | Static admin login HTML. |
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

## Allowlist source for `tenantScopingGuard.test.ts`
The narrow guard in `src/api/__tests__/tenantScopingGuard.test.ts` consumes this table indirectly: it has a curated allowlist of customer-data route files (a strict subset of the 74 org-scoped files plus `alertPreferences.ts`) and asserts each:
- imports `requireApiKey` AND `attachOrganizationContext`
- contains the literal `organization_id` somewhere in the source

The guard does NOT scan tenant-irrelevant routes. Adding a new customer-data route requires adding it to the guard's allowlist — that is the enforcement seam.

## Maintenance
- When a route changes class (e.g. a previously-public route gains org scoping), update this table in the same PR.
- When a new customer-data route is added, add it to the guard allowlist and to the customer-data side of the table here.
- When `email_suppressions`, `newsletter_issues`, or any other table currently treated as global is migrated to be org-scoped, every route that touches it must move to the customer-data side.
