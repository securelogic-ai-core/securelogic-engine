# ERIP — Enablement Runbook (staging validation · production checklist · rollback)

**Documentation only. Nothing in this file is executed by the program (GATE B).**
Every ERIP surface is dark by default; enablement in any environment is an explicit,
operator-owned decision requiring a Simmee ruling. This runbook is the checklist for
when that ruling is made.

Governing docs: `docs/architecture/enterprise-risk-intelligence-platform.md`,
`docs/validation/erip-tracker.md`, `docs/validation/erip-final-report.md`. The EAR
(Epic 1) enablement runbook remains authoritative for the registry/ECL flags it covers:
`docs/architecture/enterprise-asset-registry/ENABLEMENT-RUNBOOK.md`.

---

## 1. Flag inventory & dependency order

All flags are `"false"` in all four render.yaml services today. ERIP surfaces sit ON TOP of
the EAR/ECL substrate, so enable in this order:

| Order | Flag | Gates | Depends on |
|---|---|---|---|
| (pre) | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | ECL substrate, graph resolver, connectors | — |
| (pre) | `SECURELOGIC_ASSET_REGISTRY_ENABLED` | registry, `asset_registry_v`, `/api/assets/*` | ECL |
| 1 | `SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` | connector due-scan (E2) | ECL + registry |
| 2 | `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` | `/api/assets/:id/risk-propagation`, `/api/risk/*`, `/api/executive/*` (E3/E4) | registry |
| 3 | `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` | `/api/predictive/*` (E5) | — (reads posture) |
| 4 | `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` | `/api/graph/*` (E7) | registry + ECL resolver |
| 5 | `SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` | `/api/orchestration/*` (E6) | — (writes `actions`) |

Each flag is independent: enabling one does not require the next. Enable narrowly, validate,
then proceed. Connector scheduled sync is additionally per-org (`enterprise_connectors.enabled`
+ `sync_interval_minutes`); orchestration executes only on explicit human approval.

## 2. Staging validation (run in STAGING, per epic, after enabling that epic's flag)

**E2 — Discovery & connectors.** Configure a connector for a test org; set
`sync_interval_minutes`; confirm the worker enqueues on schedule and the observation ledger
fills:
```sql
SELECT connector_id, sync_interval_minutes, next_sync_at, last_sync_status, consecutive_failures
  FROM enterprise_connectors WHERE organization_id = :org;
SELECT connector_id, count(*), sum((stale)::int) AS stale FROM connector_asset_observations
  WHERE organization_id = :org GROUP BY connector_id;
```
Expect: due connectors enqueue; a full re-sync marks removed refs stale; a delta run does not.

**E3/E4 — Risk intelligence + executive.** With scored applicability decisions present:
`GET /api/assets/:id/risk-propagation` returns direct/inherited/total + contributor traces;
`GET /api/risk/dimensions` and `GET /api/executive/risk-summary` return dimension rollups +
heatmap + posture. Confirm every number ties back to applicability decisions.

**E5 — Predictive.** With ≥2 posture snapshots: `GET /api/predictive/posture-forecast?horizon_days=30`
returns a fitted projection with `insufficient_data:false`, a trend, and a reasoning trace.

**E6 — Autonomous operations.** `POST /api/orchestration/proposals` → `proposed`; self-approve
→ 403 (SoD); a DIFFERENT user approves → `executed` with an `actions` row; reject is terminal.
Confirm audit events for every transition.

**E7 — Knowledge graph.** `GET /api/graph/blast-radius/:assetId` returns a labelled node set
+ edges + summary; labels resolve from canonical tables; cross-org asset → 404.

**Cross-cutting:** with each flag OFF, the corresponding routes 404 before auth and behavior is
byte-identical to pre-ERIP. Cross-org isolation holds (RLS + explicit org predicates).

## 3. Production enablement checklist (GATE B — requires a Simmee ruling)

Do NOT proceed without an explicit ruling. Then, per flag, in dependency order:
1. Confirm staging validation (§2) passed for that epic and the migration set is applied in prod
   (`SELECT filename FROM schema_migrations WHERE filename LIKE '2026081%';` → 20260811–20260815 present).
2. Enable the flag on the intended services only; keep per-org controls conservative
   (connector `enabled=false` until each org is configured; no auto-approve for orchestration).
3. Smoke-test one org's read surfaces; watch logs/audit for the epic's events.
4. Record the enablement in the operator ledger (who, when, which flag, which orgs).

## 4. Rollback plan

**Flags (immediate, always safe):** set the flag back to `"false"`. Every ERIP route returns to
404-before-auth; workers idle-skip; no data is written. This is the primary rollback and needs
no migration.

**Migrations (forward-only convention; reverse only if a flag rollback is insufficient):**
- `20260815_orchestration_proposals` → `DROP TABLE orchestration_proposals;` (self-contained).
- `20260814` / `20260813` connector-id CHECK widenings → re-add the prior CHECK (only once no
  rows use the removed ids).
- `20260812` → `DROP TABLE connector_asset_observations;` + `ALTER TABLE enterprise_connectors
  DROP COLUMN sync_cursor;`.
- `20260811` → drop `sync_interval_minutes`/`next_sync_at`/`consecutive_failures` +
  `idx_enterprise_connectors_due` (see each migration header for the exact reverse).
All migrations are additive; with the flags off the added columns/tables are inert, so a flag
rollback alone fully neutralizes ERIP without touching schema.

**Data written while enabled:** `connector_asset_observations`, `orchestration_proposals`, and
any `actions` rows created by an approved orchestration are ordinary org-scoped rows; they are
harmless when the flags are off and can be pruned per normal data-retention if desired.

## 5. Reserved product decisions (not enablement — need their own ruling)

- The Epic-1 GATE B production enablement and the P9 entitlement-leg cutover (see the EAR runbook).
- Orchestration per-org auto-approve (ERIP-AD-24 keeps approval structural until then).

---

## 6. Raised-bar addendum (2026-07-07) — new flags, secrets, and validation

The raised-bar work (final report Addendum, PRs #526–#536 + the executive-dashboard UI branch)
added surfaces on top of the flags in §1. Enable in this extended order; each is independent
and additionally gated per-org / per-integration where noted.

### 6.1 New / extended flags & secrets (all default off / unset)

| Flag / secret | Gates | Notes |
|---|---|---|
| `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` (extended) | also `/api/risk/trends`, `/kpis`, `/export` (E4) | already in §1 for E3/E4; now also the executive time-series surfaces. |
| `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` (extended) | also `/api/predictive/forecasts`, `/insights` (E5) | reads `risk_forecasts` produced by the inference worker. |
| `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` (extended) | also `POST /api/graph/ask` (E7 NL querying) | NL answering now shipped behind this flag; **injection-safe** (LLM sees only pre-resolved org-scoped graph evidence). |
| `SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` (extended) | also real executors + playbooks (E6a/b) | executors run only on a DIFFERENT human's approval (SoD). |
| **`SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED`** (NEW) | writeback worker + `POST/GET /api/connectors/:id/writeback` (E2a) | the ONLY external-mutation fence; on top of ECL + registry. |
| **`ANTHROPIC_API_KEY`** (NEW secret) | LLM-assisted predictive insights (E5b) + graph NL answers (E7) | absent → both degrade to grounded deterministic output, never an error. Set on the engine AND worker services. |
| **`SECURELOGIC_RISK_INTELLIGENCE_ENABLED`** (app-side) | the `/executive` dashboard nav entry | two-switch model: this app-side env reveals the nav item; the engine routes 404 independently until their own flags flip. |

Workers registered but self-gating (zero DB access while off): risk-history snapshot (03:15),
predictive inference/retraining (03:45), connector writeback (*/1), playbook scheduler (*/5).
No worker acts until its flag is on.

### 6.2 Per-org / per-integration operator settings (not env)

- **Writeback:** enqueue intents via `POST /api/connectors/:id/writeback` (whitelisted external
  fields only); the worker applies them only when the connector is `enabled` and the flag is on.
- **Orchestration integrations:** per-org credentials on `orchestration_integrations`
  (encrypted at rest); each integration has its own `enabled`.
- **Playbooks:** per-org definitions + optional schedule; a run creates proposals (still approved).

### 6.3 Staging validation for the new surfaces

- **E4 executive:** with ≥2 `risk_history` snapshots, `GET /api/risk/trends` / `/kpis` return
  per-dimension series + KPI deltas; `/export?format=csv` streams the history.
- **E5 predictive:** after the inference worker runs, `GET /api/predictive/forecasts` and
  `/insights` return RMSE-selected OLS/Holt forecasts + (with `ANTHROPIC_API_KEY`) an
  LLM-authored, forecast-grounded narrative; re-runs sharpen as history grows.
- **E6 executors:** approve a `servicenow_incident`/`jira_issue`/… proposal (by a DIFFERENT
  human) → the real outbound call fires through the SSRF-safe client; audit records every step.
- **E7 NL graph:** `POST /api/graph/ask {asset_id, question}` returns a grounded answer +
  impact analysis; without a key the deterministic grounded answer is returned; cross-org 404.
- **E2a writeback:** enqueue an intent, enable the flag → the worker PATCHes the source record;
  an externally-drifted field is HELD as a conflict, never overwritten.
- **E2b recovery:** a terminally-failed op appears in `GET /api/connectors/dead-letters`;
  re-drive re-enqueues it. **E2c health:** `GET /api/connectors/health` bands the fleet.

### 6.4 Reserved (still need a ruling)

- Natural-language knowledge-graph answering is now SHIPPED behind `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED`
  (ERIP-AD-30 satisfied by structured org-scoped grounding); enabling it in production is a
  standard flag ruling.
- Orchestration per-org auto-approve remains reserved (approval stays structural).
