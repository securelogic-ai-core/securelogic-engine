# Private Beta — Go-Live Checklist

Scope: controlled private beta (design-partner tenants, direct operator relationship).
Preconditions reference: `docs/DR_PLAN.md`, `docs/runbooks/PRODUCTION_READINESS_CHECKLIST.md`, `docs/validation/staging-smoke-2026-07-30.md`.

## Gate A — Must be TRUE before the first external tenant

- [ ] DR_PLAN [OPERATOR-VERIFY] boxes checked against the Render dashboard (backups, PITR, retention)
- [ ] **First restore test executed and logged** (DR_PLAN §6 table has one row)
- [ ] Sealed secrets copy exists (DR_PLAN §3)
- [ ] Flag-state review done: wave-1 OFF, risk-acceptance prod per GATE B, registry flags per rollout plan
- [ ] Staging smoke re-run green on the exact SHA being promoted (method: `docs/validation/staging-smoke-2026-07-30.md`)
- [ ] Promotion executed: develop → main → prod deploy green; `/health` green; Sentry quiet for 24 h soak
- [x] Merged-train validation: engine 6722 / isolation 858 / app 1200 green (2026-07-30)
- [x] Post-train integration merged (#710 SSO code exchange, dark · #711 global search, live): engine 6751 / isolation 863 / app 1200 green on the merged tree (2026-07-30)
- [x] Stale-session enforcement live (#732) — offboarding is real
- [x] Export purge worker live (#733) — data-minimization promise enforced

## Gate B — Per-tenant onboarding (repeat for each beta customer)

- [ ] Org created; profile fields set (regulated/PII/safety-critical drive scoring)
- [ ] Admin invited; MFA enforced (`require_mfa`) or SSO configured and test login done
- [ ] Seat cap set to contracted seats
- [ ] Entitlements/plan row verified (internal keys: `platform`/`platform_annual`)
- [ ] Initial data load: vendor + register CSV imports (customer-driven, import previews)
- [ ] Webhook endpoint configured + test delivery verified (if requested)
- [ ] Walkthrough of: findings queue, risk register, per-object history, audit-log drill-down, exports
- [ ] Named support channel + incident contact shared (DR_PLAN §7)

## Gate C — First 30 days of beta

- [ ] Weekly: Sentry triage, queue-depth review, scheduler ledger check, webhook delivery failure review
- [ ] Rule on the deferred decisions as usage data arrives: webhook_deliveries retention window, wave-1 enablement, SSO code-exchange enablement (#710 merged dark), session architecture, npm majors
- [ ] Collect the beta feedback that gates soft launch: import friction, report usefulness, missing-integration asks
- [ ] Quarterly DR restore test scheduled

## Explicitly OUT of beta scope (say no gracefully)

Comments on records · register bulk operations · in-app notification center · API key scopes · customer IP allowlisting · self-serve SSO configuration · public API reference/OpenAPI (docs page covers keys+webhooks) · multi-org/BU hierarchies · GDPR erasure automation (D-12 — manual process with operator involvement).
