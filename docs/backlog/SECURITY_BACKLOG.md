# Security Backlog

> Tracking summary for the open security remediation work surfaced by the Sprint 3D security review (`SECURITY_REVIEW.md`, merged to `develop` in [#430](https://github.com/securelogic-ai-core/securelogic-engine/pull/430)).
> **Last updated:** 2026-07-26. Priorities here are a record of the agreed triage — do not change them in this doc without re-triaging.
>
> Scope: the three **High** findings (#431–#433), two remediation **epics** (#434–#435), and the accepted-debt findings from the asset-search package pre-commit review (SEC-AS1/AS2, 2026-07-26). This backlog is intentionally kept separate from the [Performance & Reliability Backlog](./PERFORMANCE_RELIABILITY_BACKLOG.md).

## Priority-ordered items

| Rank | Issue | Title | Severity | Priority | Promotion-gate (develop→main) | Effort | Dependencies |
|---|---|---|---|---|---|---|---|
| 1 | [#433](https://github.com/securelogic-ai-core/securelogic-engine/issues/433) | SEC-H3 — Ask/Voice rate limiter collapses to one platform-wide bucket | High | P1 | **No** | Low (~1–2h) | None; unblocks #432 |
| 2 | [#434](https://github.com/securelogic-ai-core/securelogic-engine/issues/434) | SEC-E1 — Tenant scoping hardening (epic) | Medium | P1 | **No** | S–M (~1–2d) | None (complementary to A04-G1 RLS flip) |
| 3 | [#435](https://github.com/securelogic-ai-core/securelogic-engine/issues/435) | SEC-E4 — Billing & webhook integrity hardening (epic) | Medium | P1–P2 | **No** | S (~0.5d) | None; validate alongside Part-B Gate 4 |
| 4 | [#432](https://github.com/securelogic-ai-core/securelogic-engine/issues/432) | SEC-H2 — HTTP rate limiters in-memory / per-replica | High | P2 | **No** | M (~1–2d) | Redis (already wired); soft dep on #433 keying |
| 5 | [#431](https://github.com/securelogic-ai-core/securelogic-engine/issues/431) | SEC-H1 — SSO session JWT transmitted in URL | High | P2 (deferred) | **No** — *must-fix-before-SSO-GA* | M–H (~2–4d) | Design decision (form_post vs one-time code); shares JWT-revocation store with finding M8 |

## Administrative access plane (added 2026-08-21, ADR-0011)

Raised by the ADMIN-NET-1 ruling. The `/admin` chain was audited rather than
assumed; the audit found **no P0 and no bypass**. Two P1s and one P2 below.

| ID | Title | Severity | Priority | Promotion-gate | Effort | Dependencies |
|---|---|---|---|---|---|---|
| **ADMIN-NET-1** | Admin network allowlisting — **DEFERRED ENFORCEMENT / OBSERVATIONAL CONTROL** | n/a | **Closed as a ruling** (ADR-0011) | **No** | none — do not build | A stable trusted egress path (ADMIN-ACCESS-2) |
| **ADMIN-AUDIT-1** | Administrative actions are not durably audited — **1 of 32** admin route modules writes an audit row; the rest are stdout only | Medium | **P1** | **No** | S–M | `src/api/lib/auditLog.ts` already exists; actor field needs ADMIN-ACCESS-2 to be meaningful |
| **ADMIN-ACCESS-2** | Trusted Administrative Access Architecture — authentication today has **no administrator identity** | Medium (High once a 2nd admin exists) | **P1 — record, do not build** | **No** | L | Operator decision; must handle mobile operators and dynamic source IPs |
| **ADMIN-LOCKOUT-P2** | `adminLockout` falls back to a single **shared** bucket when no client address parses — one caller could lock out everyone | Low | P2 | **No** | XS | Should not trigger behind Cloudflare; observation only |

### ADMIN-NET-1 — ruled, closed, do not enforce

Full reasoning in `docs/architecture/decisions/ADR-0011-admin-network-deferred-enforcement.md`.
`SECURELOGIC_ADMIN_NETWORK_ENFORCED` must not be enabled in staging or
production: the sole operator administers from an iPad on a dynamic IP, and
enforcing against a moving address locks the operator out of production admin —
including the endpoints used to diagnose being locked out. The middleware,
its `admin_network_evaluated` telemetry, and the corrected `clientIp.ts`
resolution are all **preserved**. The operator's IP must not become a production
authorization dependency, and the allowlist must not be updated to chase it.

**Prerequisite for revisiting:** a stable, **independently recoverable** trusted
administrative network path must exist and be validated. Independently
recoverable is load-bearing — a break-glass that lives behind the allowlist is
not a control.

### ADMIN-AUDIT-1 — the audit trail is telemetry, not a record

`adminAudit` emits `admin_request` (method, route, status, duration, requestId)
via `logger.info`. That is stdout, retained by the host, not by the product: not
queryable, not tenant-linked, not under a retention policy we control, not
usable as evidence. Only `adminProviderSuppressionRecovery.ts` writes durably.

For a GRC product this is a credible finding against us in our own customers'
vendor reviews. The fix extends `lib/auditLog.ts`, an existing pattern. It is
**not launch-critical** — `/admin` is unreachable without the key and the chain
fails closed — so it belongs to the Enterprise Capability Baseline, not to the
Sept 15 path.

### ADMIN-ACCESS-2 — record the target, build nothing

Today `/admin` is protected by a **static shared credential**
(`SECURELOGIC_ADMIN_KEY`, timing-safe compare, rotatable set, max 10). No
per-person account, no MFA, no session, no actor attribution.

Target architecture to be **evaluated** later, not chosen now:

```
authorized administrator → strong identity + MFA → trusted administrative
access path → privileged authorization → SecureLogic administrative plane
```

with full auditability and an **independently usable break-glass/recovery
mechanism**. It must accommodate mobile operators and dynamic source IPs — the
constraint that produced ADMIN-NET-1. **No VPN or zero-trust vendor is selected
in this item.**

**Role separation — intended direction for the Enterprise Capability Baseline.**
Do not assume future Support, Operations, Engineering or Security personnel get
the platform owner's `/admin` access:

| Role | Intended scope |
|---|---|
| **L1 Support** | Constrained intake/triage and customer-visible diagnostic state |
| **L2 Operations** | Appropriately scoped read-only operational telemetry |
| **Engineering / SRE** | Controlled deeper diagnostics |
| **Security** | Security-specific investigation capability |
| **Privileged Administrator** | Separately controlled administrative actions |

Not implemented, not designed, recorded only.

## Release-parity gap (added 2026-08-21, Sept 15 reconciliation)

| ID | Title | Severity | Priority | Promotion-gate | Effort | Dependencies |
|---|---|---|---|---|---|---|
| **REL-SEC-1** | **Production is running without every security fix merged since #799** | High | **P0 — launch** | **It IS the promotion** | S (the promotion itself) | #826 Tier 2 gate; prod DSN repoint; B-5 ruling |

### REL-SEC-1 — the fixes are written, merged, and not where the customers are

Verified by ancestry check on 2026-08-21: **none** of the following is on `main`,
and production engine is serving `011e1f1d`.

| Commit | Fix |
|---|---|
| `a6c3e6cd` (#799) | Verify Postgres TLS certificates by default — closes the 2026-05 audit **Critical** |
| `903518bd` (#807) | Digest reset / verification / invite tokens at rest |
| `8868859d` (#819) | Deterministic session invalidation via `users.session_epoch` |
| `8484b366` (#820) | Sign the user out when the engine invalidates their session |
| `f817998c` (#825) | SSO callback redirects to the public origin, not the internal host |
| `842f499d` (#814) | Rate limiters key on the resolved client, not the rotating Cloudflare edge |
| `4a945257` (#813) | Auth-anomaly detectors get a real client identity |
| `9e0af404` (#812) | High-severity dependency advisories remediated; CI audit gate restored |

**Why it is filed here rather than as a release chore.** Each of these was
triaged as a security defect, fixed, reviewed and merged — and every day since
2026-08-17 production has run the vulnerable version. The remediation is complete
in engineering terms and incomplete in every term that matters to a customer.

**The one thing that must happen first.** #799 makes TLS certificate verification
mandatory, and internal Render DSNs fail `SELF_SIGNED`. **Each production
service's `DATABASE_URL` must be repointed to the External Database URL form
before this release reaches `main`**, or the workers fail live-but-broken —
they have no HTTP endpoint, so `/health` probes cannot see it
(`docs/validation/p0-hardening-batch.md` §1.3).

**Sequencing:** `docs/launch/SEPT15-LAUNCH-RECONCILIATION.md` §11 (R-1…R-5) and
§14. Recommended as a **dark** promotion so it changes no customer-visible
behaviour while delivering the whole batch.

## Support & incident-response gaps (added 2026-08-21, SUPPORT-1/2 audit)

| ID | Title | Severity | Priority | Promotion-gate | Effort | Dependencies |
|---|---|---|---|---|---|---|
| **SUP-SEC-1** | **No formal Incident Response process** | High | **P1 — launch** | **No** (not a code gate) — but a **soft-launch readiness gate** | S–M | Named security owner; legal/privacy reviewer identified |

### SUP-SEC-1 — No formal Incident Response process

**Status: IN PROGRESS — minimum IR program authorized 2026-08-21.**

The repository contains no `SECURITY.md`, no incident-response process, no
vulnerability-disclosure policy and no defined notification path. Four **SEV1**
security support runbooks (SR-009 cross-tenant exposure, SR-010 account
compromise, SR-013 credential exposure, SR-014 inbound vulnerability report)
therefore escalate to a named human **and stop** — there is no defined process
behind that escalation.

**Why it is a launch item and not a code item.** Nothing here blocks a deploy.
It blocks the honest claim that SecureLogic — a security and GRC product — can
respond to a security incident in its own platform. The gap is most acute for
cross-tenant exposure, which is simultaneously the highest-impact scenario and the
one with the least defined follow-through.

**Explicitly NOT in scope:** building an IR application, a SOC, or an on-call
rotation that does not exist. The deliverable is a process a small team can
actually execute.

**Related:** `docs/runbooks/support/SUPPORT-READINESS-GAPS.md`,
`docs/security/INCIDENT-RESPONSE.md` (this package), `docs/DR_PLAN.md` §7–§8.

### VENDOR-PORTAL-1 — Vendor collaboration & external portal security readiness

**Status: OPEN — NOT authorized for activation. Ruled out of Sept 15 scope 2026-08-21.**

Sept 15 Vendor Assurance is **customer-operated and document-driven**: the customer
obtains the vendor's documentation through their normal business process and uploads
it. The external vendor portal — emailed invite → token exchange → vendor session —
is **not activated**, and `SECURELOGIC_VENDOR_PORTAL_ENABLED` is `false` in
production **and** staging.

**Observed facts, verified against `src/api/routes/vendorPortal.ts` on
`develop@4941f56e`:**

| Observation | Count |
|---|---|
| `withTenant` call sites | **15** |
| `pgElevated` call sites | **5** |
| `asTenant` call sites | **0** |

**These are observations, not findings.** The elevated sites are in the invite
lookup and token-exchange path (lines 109, 153, 171, 238), where the tenant is by
definition not yet known — an unauthenticated caller presents a token and the
system must resolve which organisation it belongs to before any tenant context can
exist. That is a defensible design, and it has **not** been shown to be unsafe.
It has also not been shown to be safe. **Do not describe it as a vulnerability
without proving the authorization behaviour is wrong.**

**Prerequisite security review before any activation** — this is an
internet-reachable surface authenticated by a bearer token rather than a session,
so it deserves its own pass rather than inheriting the app's:

- external token lifecycle: generation, entropy, storage (hashed?), transport
- token exchange: replay, fixation, binding to the invited vendor
- authentication and authorization model for a non-user principal
- tenant resolution: how org is derived, and what happens when it cannot be
- every `withTenant` usage — is the GUC set from the token's org, and can it be influenced?
- every `pgElevated` usage — is each strictly limited to the pre-session lookup?
- absence of `asTenant` — deliberate, or an unwrapped request path?
- object-level authorization: can a vendor session read or write another engagement?
- cross-tenant isolation under a valid token
- expiration, revocation, and what a withdrawn invite can still do
- rate limiting on the exchange endpoint
- audit logging of vendor-principal actions
- document upload boundaries: type, size, storage scoping, malware posture
- the vendor↔customer relationship authorization model

**Do not activate, and do not modify portal authorization to satisfy a Vendor
Assurance DONE definition.** Whether there is time to complete this review safely
before feature cutoff is a separate decision.

## Notes

- **Priority ≠ severity for #431:** it is the most severe finding by impact (credential leakage) but the lowest launch-urgency because SSO is **out of initial launch scope** — its exposure is contingent on SSO going live. It is classified **must-fix-before-SSO-GA**, and re-escalates to promotion-relevant only if SSO GA is pulled into the launch (see the reclassification recorded on the issue).
- **Epics group the Medium/Low findings from the review:** #434 (SEC-E1) covers M2, M3, M4, L6, L7, L8; #435 (SEC-E4) covers M7, M9. Findings are referenced by their `SECURITY_REVIEW.md` IDs on each epic (no child issues created yet).
- **Not yet ticketed:** the entitlement rank-collapse finding (M1 / R4) is intended as a **standalone** issue, product-gated (needs a Platform-only capability before it becomes must-fix); it is tracked as R4 debt in `TENANT_ISOLATION_STANDARD.md`, not opened here.
- **Recommended implementation order:** #433 → #434 → #435 → #432 → #431 (override: #431 first if SSO GA joins the launch).
- **Promotion gating:** **none of #431–#435 blocks the develop→main promotion.** The actual promotion blockers remain the Part-B operator Gates 1–5 (Stripe billing config/validation + migration F-1 + seat-cap pre-flight), tracked in `docs/launch/OPERATOR_RUNBOOK.md`.

## Asset-search package — accepted debt (pre-commit review, 2026-07-26)

Findings from the security pass on the shared asset-search package (`asset_search_index_v` + `assetSearchResolver.ts` + five consuming routes). Labeled **F-1/F-2** in the review conversation; recorded here as **SEC-AS1/AS2** — *not* to be confused with migration gate **F-1** in `RELEASE_CHECKLIST.md`, which is unrelated. Both were triaged **accept as technical debt** (neither was a commit blocker; no live leak, no auth gap, no injection). No GitHub issues opened yet.

| ID | Review label | Title | Severity | Disposition | Rides on |
|---|---|---|---|---|---|
| SEC-AS1 | F-1 | `asset_search_index_v` tenant isolation rests on a single control (caller org predicate); `vendors`/`ai_systems` arms have no RLS backstop and `security_invoker` is PG ≥ 15 only | Medium (defense-in-depth) | Accept as debt | A04-G1 RLS rollout (add `vendors`/`ai_systems` RLS there) |
| SEC-AS2 | F-2 | Search cost amplification: 2-char minimum, leading-wildcard ILIKE over the unindexed multi-arm view, behind non-durable rate limiting | Medium (availability/cost) | Accept as debt, **trigger-gated** | SEC-H2 [#432](https://github.com/securelogic-ai-core/securelogic-engine/issues/432) (Redis-backed limiters) |

- **SEC-AS1 details:** every current consumer passes a server-derived org id, and `test/isolation/assetSearchIndexView.test.ts` covers cross-org exclusion + RLS-through-the-view for `app_request`. Residual risk is a *future* consumer omitting the predicate. Remediation: (a) `vendors`/`ai_systems` RLS lands with A04-G1 (no new scope); (b) optional XS guard test asserting the view is referenced only from `assetSearchResolver.ts` and the one audited EXISTS in `signalMatchSuggestions.ts`.
- **SEC-AS2 details:** leading-wildcard `ILIKE` cannot use btree and no `pg_trgm` indexes exist; `LIMIT` bounds rows, not scan work. Org-predicate pushdown onto indexed `organization_id` scans keeps this cheap at current volumes. **Growth triggers (act when either fires):** any tenant exceeding ~50k rows across the seven asset tables, **or** p95 search latency > 200 ms on staging. Then: one additive migration adding `pg_trgm` GIN indexes on the hot term columns (`vendors.name`, `ai_systems.name`, `enterprise_entities.name`, `endpoints.hostname`, `cloud_resources.account_id`, the `external_ref` columns). Independently, when #432 lands, the five `?q=` routes (assets, vendors, ai-systems, enterprise-entities, signal-match-suggestions) must be inside the durable limiter's scope.
- **F-3 (not backlogged):** the correlated-EXISTS plan-shape question in `listSignalMatchSuggestions` is a **post-merge staging validation action** (EXPLAIN ANALYZE against the walkthrough org; rewrite to the pre-resolved id-set pattern only if the per-row SubPlan signature appears). It is an action item of the package's staging pass, not standing debt — deliberately not tracked here.

## Source of record
- Full findings, evidence (`file:line`), false positives, and OWASP mapping: [`SECURITY_REVIEW.md`](../../SECURITY_REVIEW.md).
- SEC-AS1/AS2 evidence and the full 10-point expansion (including the F-3 EXPLAIN expectations): the 2026-07-26 pre-commit review of the asset-search package (conversation record; key anchors — `db/migrations/20260908_asset_search_index_view.sql:32-38,125-137`, `src/api/lib/assetSearchResolver.ts:35,50-52,119-140`, `src/api/routes/signalMatchSuggestions.ts:433-446`).
