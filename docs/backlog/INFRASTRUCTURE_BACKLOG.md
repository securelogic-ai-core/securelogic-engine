# Infrastructure Backlog

> Tracking summary for infrastructure / IaC-ownership work items. Kept separate
> from the [Security Backlog](./SECURITY_BACKLOG.md) and the
> [Performance & Reliability Backlog](./PERFORMANCE_RELIABILITY_BACKLOG.md).
> **Last updated:** 2026-08-16.

## Priority-ordered items

| Rank | ID | Title | Priority | Promotion-gate (develop→main) | Effort | Dependencies |
|---|---|---|---|---|---|---|
| 1 | INF-1 | Three services run outside Blueprint ownership | P2 | **No** — not a promotion blocker | S to decide, M–L to adopt | Operator ownership ruling; demo DB migration-drift reconciliation |

| 2 | PLAT-ASSET-1 | Asset inventory is effectively unpopulated | **P0 as a *decision* / P2 as a *build*** (re-rated 2026-08-21) | **No** — but gates the customer-visible truth of per-asset vulnerability tracking, and therefore a Sept 15 advertising claim | XS to decide, L to build | Ownership ruling: import vs connector vs manual onboarding |

## Enterprise Capability Baseline candidates (added 2026-08-21)

| ID | Title | Priority | Promotion-gate | Effort | Dependencies |
|---|---|---|---|---|---|
| **OPS-1** | **SecureLogic Operations & Tenant Health** — enterprise-foundational capability | **P1 — record and inventory, do NOT build** | **No** | XS to inventory, L to build | Existing observability primitives; must not become a parallel framework |

### OPS-1 — SecureLogic Operations & Tenant Health

**Named as an enterprise-foundational capability for the Enterprise Capability
Baseline.** Do not build it now.

**Intended architecture:**

```
subsystem telemetry → standardized operational events / health signals
  → tenant + platform health model → SecureLogic Operations Dashboard
  → alerting → support / incident response / recovery
```

**The two questions OPS-1 must eventually answer:**

1. *Are all customer tenants healthy right now?*
2. When not: *which customer is affected, what capability is degraded, when did
   it begin, what evidence supports the diagnosis, and what is the approved next
   action?*

#### First step is an inventory, not a build

The standing constraint is **no parallel observability framework.** Reuse what
exists. Verified present today:

| Primitive | What it already gives | Gap against OPS-1 |
|---|---|---|
| `GET /admin/ops/health` | queued/dead-lettered deliveries, suppressions, failed + stale worker runs, latest issue, latest provider event | **No tenant dimension.** Newsletter/email/worker-centric |
| `GET /admin/ops/overview` | delivery totals by status, suppression counts, provider events, worker runs | **No tenant dimension** |
| `GET /admin/billing/dunning-metrics` | cross-org dunning aggregate | Billing only |
| `worker_runs` table | per-worker status, started_at, failures | No capability mapping |
| Structured error codes | e.g. `processing_error_code` on documents | Not aggregated |
| `security_audit_log` / `lib/auditLog.ts` | durable audit rows where used | Sparse — see ADMIN-AUDIT-1 |
| `email_provider_events`, `email_suppressions` | delivery telemetry | Email only |

**Honest baseline: two operations surfaces already exist and neither can answer
question 1**, because nothing in them carries a tenant dimension.

#### Telemetry the baseline should evaluate

Tenant health · APIs/application · database · Redis/cache · workers/background
jobs · queues · document processing/extraction · AI/provider processing ·
Vendor Assurance · vulnerability ingestion · asset synchronization · pen-test
processing · AI Governance workflows · reporting · authentication ·
billing/dunning · email/notifications · integrations/connectors ·
security/anomalies · rate limiting/lockouts · **administrative-network
evaluations** (`admin_network_evaluated`, per ADR-0011) · scheduled jobs ·
deployment/version · migration level · configuration drift · active incidents ·
capacity/usage where appropriate.

#### Non-negotiable design principles

**1. Tenant health must be DERIVED, never manually assigned.** No hand-set
green/yellow/red. The model must support at least:

| State | Meaning |
|---|---|
| `HEALTHY` | Observable evidence within defined thresholds |
| `DEGRADED` | Observable evidence outside thresholds, capability still functioning |
| `CRITICAL` | Capability not functioning for that tenant |
| `UNKNOWN` | **No evidence.** Must NOT silently collapse into HEALTHY |

`UNKNOWN` is the important one. A tenant we cannot see is not a tenant that is
fine, and a health model that renders absence as green is worse than no model —
it manufactures false assurance. The scoring algorithm is deliberately **not**
designed yet.

**2. Read-only by default.**

> **Cross-tenant operational visibility does not imply cross-tenant mutation
> authority.**

OPS-1 begins as a read-only operational surface. Any future capability to change
customer state requires separate authorization/elevation, explicit tenant
context, a reason where appropriate, and complete audit logging.

**The Operations Dashboard must not become a generic database administration
console.** That is the failure mode this principle exists to prevent, and it is
also why ADMIN-AUDIT-1 matters: a cross-tenant surface without a durable audit
trail is exactly the thing an enterprise customer's vendor review will ask about.

## Item detail

### PLAT-ASSET-1 — Asset inventory is effectively unpopulated

**Status: OPEN — no owner. Surfaced by the SL-OCC-1/2 packages, 2026-08-21.**

Per-asset vulnerability tracking is built, merged and verified on `develop`
(SL-OCC-1a/1b, SL-OCC-2). The **substrate is empty**: staging holds **24 assets and
2 endpoints**, 0 `canonical_product_external_ids` and 0 `asset_product_identities`,
against 5,340 findings.

**The consequence is precise:** the capability is real, but a customer will see
**"0 affected assets"** on every vulnerability until their estate exists in
SecureLogic. Occurrences can only attach to assets the organization already has —
deliberately, because the importer never creates an asset (a placeholder host would
be indistinguishable from a real one and would corrupt every exposure count that
follows).

**This is the gap between *built* and *visibly true*,** and it is a product/GTM
decision before it is an engineering one:

- who populates the estate — the customer by import, a connector, or onboarding?
- is per-asset vulnerability tracking part of the Sept 15 story? If yes, this is a
  launch dependency. If no, SL-VULN-1 alone still tells a truthful vulnerability
  story at the finding level.

**Explicitly NOT authorized:** asset-inventory connectors, scanner connectors
(SL-OCC-3), or any integration work. This item is the **decision**, not the build.

> **RE-RATED 2026-08-21 (`docs/launch/SEPT15-LAUNCH-RECONCILIATION.md` §5, P0-F).**
> Split into two items with different priorities, because they have different
> sizes and different deadlines:
>
> - **The ruling is P0 for Sept 15 and XS.** It decides an advertising claim, and
>   the claim must be settled before GTM copy is written. Recommended answer:
>   **per-asset exposure is NOT part of the Sept 15 story**; SL-VULN-1 alone tells
>   a truthful vulnerability story at the finding level.
> - **The build is P2 and L.** Verified 2026-08-21: `/api/assets*` is **404 in
>   production** — the route chain puts `SECURELOGIC_ASSET_REGISTRY_ENABLED`
>   first, and the routes additionally require the per-org `enterprise_context`
>   capability. So the build branch does not stop at "populate the estate"; it
>   runs back through the Enterprise Context activation gates (AD-17 grant, edge
>   cap H1, graph load test H2). That cannot land before Sept 15.
>
> If the ruling is "not in the Sept 15 story", the only work owed before launch is
> **TRUTH-1** (XS): make the Affected Assets panel distinguish *"no assets in
> inventory"* from *"no affected assets"*, so an empty substrate never renders as
> a confident zero.

**Related:** `docs/runbooks/support/SR-023-asset-resolution-failure.md`,
migrations `20261033`–`20261035`, `assetDetailPersistence.ts`
(`DETAIL_ASSET_CAP = 10_000`).

### INF-1 — `demo-engine`, `demo-app` and `intelligence-api` are outside Blueprint ownership

**Status: OPEN — intentional today, decision owed. Do NOT add them to
`render.yaml` without an explicit ownership ruling.**

**What is true.** `render.yaml` declares **fourteen** services. These three are
not among them and never have been:

| Service | Live state (2026-08-16) | autoDeploy | In `render.yaml`? |
|---|---|---|---|
| `securelogic-demo-engine` | `live` on `98e97098` | **no** (held) | **no** |
| `securelogic-demo-app` | `live` on `98e97098` | **no** (held) | **no** |
| `securelogic-intelligence-api` | `update_failed` on `759e7c94` since 2026-05-02 | **no** (held) | **no** |

They exist only as Render dashboard state. Every other `main`- and
`develop`-tracking service is Blueprint-declared.

**Why this is being recorded rather than fixed.** Surfaced during the Stage-1
promotion (2026-08-16), when the four `autoDeploy=false` holds were written back
into IaC. Only `securelogic-website` could be expressed, because it is the only
one of the four the Blueprint owns. Declaring the other three would mean ADDING
complete service definitions — branch, build and start commands, environment —
which is not "recording a hold": it hands the Blueprint control of services it
has never managed, and the first sync would then assert that definition over
whatever the dashboard actually holds. On a service already in `update_failed`,
and on a demo pair whose database carries unresolved migration drift, that is a
change with real blast radius. It needs a decision, not a commit.

**The risk of leaving it.** These three are invisible to review. A change to
them leaves no diff, no PR, and no history — the same class of gap that produced
a P0 on 2026-08-14, when a `render.yaml` value and the live value disagreed and
nothing detected it. Their current holds live only in §11 of
`docs/validation/develop-to-main-promotion-audit.md` and in this item.

**The decision required, per service.**
1. **Adopt** into `render.yaml` — capture live config exactly, then verify a
   sync is a no-op before enabling autosync. For `intelligence-api` the
   `update_failed` condition must be reconciled *first*, or adoption will
   codify a broken definition. For the demo pair the DB migration drift must be
   resolved first, since adoption implies they will move with `main`.
2. **Decommission** — `intelligence-api` has not deployed successfully since
   2026-05-02; whether it is still load-bearing is itself unanswered.
3. **Deliberately exclude** — keep them dashboard-only, but record that as a
   ruling here so the absence stops reading as an oversight.

**Promotion-gate impact — none.** Stage 1 completed with all three held. They
are not a Stage 2 blocker either. This is IaC hygiene and operational
visibility, not release risk.

## Notes
- Blueprint autosync is **off** and the Blueprint is **paused**. Nothing in this
  backlog has been applied to any service.
