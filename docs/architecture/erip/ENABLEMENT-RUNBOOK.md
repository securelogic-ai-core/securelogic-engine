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
- Natural-language knowledge-graph answering (ERIP-AD-30 safety gate).
