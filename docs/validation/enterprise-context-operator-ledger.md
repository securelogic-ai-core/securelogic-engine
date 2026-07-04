# Enterprise Context / Risk Intelligence — Operator Action Ledger

Operator-only actions (env vars, `render.yaml` dashboard values, rebuilds, Stripe config,
prod flag flips, external-API credentials, prod DB) required by this workstream. **These are
NOT performed by the build agent** — they are recorded here for Simmee/operator execution.
Each slice's report reproduces this ledger. Nothing here is a prerequisite to *building*
(dark) code; several gate *enablement* (which is out of scope — GATE B).

Last updated: 2026-07-03.

| ID | Action | Service / where | Exact value / steps | Needed by | Status |
|---|---|---|---|---|---|
| **L-1** | Ratify the Platform-vs-Enterprise access model + AD-17 per-org capability-grant shape + entity/edge cap values (**GATE A ruling**) | product/commercial decision | RULED 2026-07-04: access = Platform Professional + Enterprise; grant = capability-based (`requireCapability`, Platform default on, per-org override); caps = 10k entities / 50k edges (separate from max_monitored_entities). Implemented in Item 9. | Slice 9 (gating) | **RESOLVED** |
| **L-7** | Per-org ECL capability grant/revoke + cap tuning (operational) | prod DB (organizations) | Grant/deny a specific org: `UPDATE organizations SET enterprise_context_capability = true/false WHERE id = …` (NULL = inherit the Platform default). Raise a specific org's caps (Enterprise): `UPDATE … SET max_enterprise_entities = …, max_enterprise_edges = … WHERE id = …`. No DDL, no code deploy. Still gated by the feature flag (GATE B) until prod enable. | post-enable, per customer | PENDING (operational, as needed) |
| **L-2** | Prod enablement of `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | Render env (prod ECL-serving services) | Set `= true` ONLY after: AD-17 grant shipped + H1 edge cap + H2 load test pass + staging soak green. **Out of scope for this goal (GATE B).** | GA (post-goal) | **PENDING — GATE B (do not perform under this goal)** |
| **L-3** | Decide the CSV/bulk-import per-org row-limit value | commercial/operator | Slice 3 reuses the S1 `max_enterprise_entities` cap mechanism; the import hard row-limit *value* is an operator decision (blueprint §24 Q1). Ship a conservative default; operator tunes via `UPDATE` (no DDL) | Slice 3 (tunable post-merge) | PENDING |
| **L-4** | Validate the ECL UI build in CI (app has no local test runner; sandbox SIGTERMs on app build) | CI (GitHub Actions) | Rely on the CI `build`/`typecheck`/`lint` lanes for the `app/` surface when the sandbox cannot build it locally | Slice 7 (UI/CX) | PENDING |
| **L-5** | Connector credentials + tenant setup (per connector) | external SaaS + Render env | ServiceNow CMDB / Defender / CrowdStrike / Wiz / Tenable / Qualys / Rapid7 / cloud / identity — API tokens, instance URLs, OAuth apps. Agent builds adapters + mock-backed tests only; real-credential round-trips are operator work. Per-connector rows below (L-5.1..L-5.9) | Slice 8 (connectors) | PENDING (details per connector) |
| **L-5.1** | ServiceNow CMDB credentials (REFERENCE adapter — the only fetch/normalize implemented) | external SaaS + Render env | `instance_url` (https), integration `username` + `password` (read on `cmdb_ci`). Adapter `servicenow_cmdb` is dark; a real fetch round-trip is operator validation | Slice 8 done; enablement post-GATE B | PENDING |
| **L-5.2** | Microsoft Defender credentials | Azure + Render env | `tenant_id`, app-registration `client_id` + `client_secret` (Defender API). Adapter PLANNED (config schema only) | when defender adapter built | PENDING |
| **L-5.3** | CrowdStrike Falcon credentials | external SaaS + Render env | Falcon `base_url` + `client_id` + `client_secret`. Adapter PLANNED | when falcon adapter built | PENDING |
| **L-5.4** | Wiz credentials | external SaaS + Render env | Wiz API `base_url` + `client_id` + `client_secret`. Adapter PLANNED | when wiz adapter built | PENDING |
| **L-5.5** | Tenable credentials | external SaaS + Render env | Tenable.io `base_url` + `access_key` + `secret_key`. Adapter PLANNED | when tenable adapter built | PENDING |
| **L-5.6** | Qualys credentials | external SaaS + Render env | Qualys API `base_url` + `username` + `password`. Adapter PLANNED | when qualys adapter built | PENDING |
| **L-5.7** | Rapid7 InsightVM credentials | external SaaS + Render env | InsightVM `base_url` + `api_token`. Adapter PLANNED | when rapid7 adapter built | PENDING |
| **L-5.8** | Cloud inventory credentials | AWS/Azure/GCP + Render env | `provider` + `account_id` + assumed-role ARN / credential ref (least-priv read-only inventory role). Adapter PLANNED | when cloud adapter built | PENDING |
| **L-5.9** | Identity provider credentials | Okta/Entra + Render env | IdP `base_url` + `api_token` (read users/groups). Adapter PLANNED | when identity adapter built | PENDING |
| **L-6** | Staging load-test environment for the recursive graph resolver | staging DB + seed | A staging org seeded with a dense/large graph (10⁴–10⁵ entities, high fan-out) so H2 `EXPLAIN`/load numbers are real. Agent writes the harness; operator provisions the data volume if not synthesizable in CI | Slice 10 (scale validation) | PENDING |

## Standing reminders
- **`render.yaml` flag declaration** (`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = false`) is a
  **code change** (repo), not an operator action — the agent will bundle it into the Slice 3 PR.
  It is listed nowhere above because it is not operator-only. The **prod flip to `true`** (L-2)
  is the operator action.
- No credentials are ever inlined in commands or committed. No prod DB writes. No Render
  dashboard changes by the agent.
