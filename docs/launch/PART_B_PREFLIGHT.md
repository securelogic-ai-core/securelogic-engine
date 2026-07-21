# Sprint 1 Part B — Promotion Pre-Flight (Re-baselined 2026-07-21)

> **Status:** ACTIVE evidence document for the re-baselined Sprint 1 Part B promotion.
> Produced by the two automatable audits authorized in the Part B milestone-1 ruling
> (operator rulings D-A–D-E, recorded in `SPRINT_1.md` §Operator rulings 2026-07-21).
> **Promotion object (ruling D-C, composite):** the validated `develop` head — one
> architectural unit including Briefing B1/B2 + read-surface D1 — promoted as a single
> true merge. **Archived historical baseline (ruling D-A):** the 2026-07-02 promote
> (`main` = `512cfa5a`, PR #449) is evidence of history, NOT the governing baseline.
>
> Evidence labels: **VERIFIED** (commit/file/command output) · **INFERRED** · **UNKNOWN**
> (needs operator confirmation — repo cannot prove it).

Measured at re-baseline (VERIFIED, 2026-07-21): `origin/main` = `512cfa5a` (2026-07-02);
`origin/develop` = `cb934b05`; develop is **266 commits** ahead of main and contains
**65 staged migrations** (`20260710_finding_saved_views.sql` → `20260910_finding_independent_review.sql`).
`origin/develop..origin/main` = 0 (develop fully contains main).

---

## Audit 1 — Migration pre-flight (65 staged migrations)

### 1.1 Method (reproducible)

```bash
# Enumerate the staged set
git diff --name-only origin/main...origin/develop -- db/migrations/ | sort

# F-1 reshape scan: staged files modified after their first commit
for f in $(git diff --name-only origin/main...origin/develop -- db/migrations/); do
  n=$(git log --oneline origin/develop --follow -- "$f" | wc -l)
  [ "$n" -gt 1 ] && echo "RESHAPED($n): $f"
done

# Destructive-operation scan (live statements only; comments excluded by review)
grep -nE 'DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|DROP CONSTRAINT' <staged files>

# RLS conformance: every staged migration enabling RLS/policies uses the canonical
# NULLIF(current_setting(...,true),'') pattern
```

### 1.2 Results

| Check | Result |
|---|---|
| Staged-set size | **65 files**, `20260710` → `20260910` (VERIFIED) |
| F-1 reshape scan | **1 finding — PF-1 below** (VERIFIED) |
| Destructive-operation scan | **PASS** — no live `DROP TABLE`/`DROP COLUMN`/`TRUNCATE`/`DELETE FROM`; all `DROP CONSTRAINT IF EXISTS` hits are constraint-widening (drop + immediate re-add of a wider CHECK) or the ratified WORM-safe FK removal (`20260831`, ERG C2); remaining hits are commented rollback notes (VERIFIED) |
| RLS conformance | **PASS** — every staged RLS migration uses the canonical `NULLIF(current_setting(…,true),'')::uuid` pattern (VERIFIED) |

### 1.3 PF-1 — Reshaped migration: possible staging grant drift (the one real finding)

`db/migrations/20260719_enterprise_entities_rls.sql` was committed at
2026-07-03 19:26 UTC (`805b50be`) and **modified 59 minutes later** (`0e9ca92a`,
20:25 UTC) to add `app_request` DML grants on `enterprise_entities` + `data_stores`.
The runner is filename-keyed: if a staging deploy booted **between** the two pushes,
staging applied v1 and **silently skipped** the v2 grants. No later migration re-grants
on those tables (VERIFIED).

- **Prod impact: none.** The filename has never been applied to prod; promotion applies
  the current (v2) content. (VERIFIED)
- **Staging impact: UNKNOWN** — depends on push/deploy timing not provable from the repo.
  If the grants are missing, nothing breaks today (grants matter only under the
  `app_request` role, and the A04-G1 role flip has not happened), but the **staging RLS
  flip would fail closed** on those tables.
- **Operator verification (run on STAGING):**

```sql
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'app_request'
  AND table_name IN ('enterprise_entities', 'data_stores')
ORDER BY table_name, privilege_type;
```

Expected if v2 applied: SELECT/INSERT/UPDATE/DELETE rows for both tables. If empty/partial:
re-apply the grant statements from the current file (idempotent) — do **not** re-run the
migration file by renaming it.

### 1.4 Batch-application risk (architectural — carried to Gate 5′)

Staging applied these 65 migrations **incrementally over ~3 weeks**; production will
apply them **in one sequence on the first post-promotion engine boot** (the runner
auto-runs on deploy, per-file `BEGIN…COMMIT`). A mid-sequence failure leaves the engine
crash-looping with the schema partially advanced (each file atomic; the batch is not).
Staging’s incremental success is **weak evidence** for batch behavior.
**Recommended (operator ruling requested at Gate 5′):** rehearse the full 65-file batch
against a production clone/snapshot before promotion, or explicitly accept the risk with
the per-file atomicity + additive-only evidence above.

### 1.5 Gate 5′ — F-1 filename-key check (replaces the obsolete 7-file Gate 5)

The original Gate 5 set (`20260706`–`20260712`, incl. the seat-cap pre-flight) is
**already applied to production** via the archived 2026-07-02 promote — it validates
nothing about this promotion. Run the following in **PROD** (expected: **0 rows** —
none of the staged filenames applied yet) and in **STAGING** (expected: **65 rows**,
all applied, no deploy-log migration errors):

```sql
SELECT filename, applied_at FROM schema_migrations
WHERE filename IN (
  '20260710_finding_saved_views.sql',
  '20260714_risk_lifecycle_events_immutable.sql',
  '20260714_risk_lifecycle_events_rls.sql',
  '20260714_risk_lifecycle_events.sql',
  '20260714_risk_lifecycle_state.sql',
  '20260715_risk_approvals_rls.sql',
  '20260715_risk_approvals.sql',
  '20260715_risk_settings_approval.sql',
  '20260716_evidence_source_type_risk.sql',
  '20260717_org_max_enterprise_entities.sql',
  '20260718_enterprise_entities.sql',
  '20260719_enterprise_entities_rls.sql',
  '20260720_enterprise_relationships.sql',
  '20260721_briefing_layouts.sql',
  '20260721_enterprise_relationships_rls.sql',
  '20260722_applicability_assessments.sql',
  '20260723_applicability_evidence.sql',
  '20260724_applicability_affected_entities.sql',
  '20260725_applicability_worm.sql',
  '20260726_applicability_rls.sql',
  '20260727_applicability_assessments_seq.sql',
  '20260728_org_enterprise_context_caps.sql',
  '20260729_org_enterprise_context_capability.sql',
  '20260730_applicability_workflow_dispatch.sql',
  '20260731_jobs_applicability_reassess.sql',
  '20260801_enterprise_relationships_asset_expansion.sql',
  '20260802_asset_registry_view.sql',
  '20260803_assets_spine.sql',
  '20260804_phase2_asset_targets.sql',
  '20260806_asset_detail_tables.sql',
  '20260807_enterprise_connectors.sql',
  '20260808_jobs_connector_sync.sql',
  '20260809_org_core_platform_capability.sql',
  '20260810_asset_assessments.sql',
  '20260811_connector_sync_scheduling.sql',
  '20260812_connector_asset_observations.sql',
  '20260813_connectors_cloud_adapters.sql',
  '20260814_connectors_directory_adapters.sql',
  '20260815_orchestration_proposals.sql',
  '20260816_risk_history.sql',
  '20260817_risk_forecasts.sql',
  '20260818_orchestration_integrations.sql',
  '20260819_orchestration_playbooks.sql',
  '20260820_connector_writeback.sql',
  '20260821_connector_dead_letters.sql',
  '20260822_intelligence_events.sql',
  '20260823_findings_intelligence_event.sql',
  '20260824_intelligence_event_notifications.sql',
  '20260825_intelligence_event_workflow_triggers.sql',
  '20260826_suggestions_intelligence_event.sql',
  '20260827_business_process_entity_type.sql',
  '20260828_cyber_signals_published_at.sql',
  '20260829_finding_decision_state.sql',
  '20260830_canonical_products.sql',
  '20260831_applicability_assessment_asset_id_no_fk.sql',
  '20260901_finding_operational_status.sql',
  '20260902_finding_closure_sod.sql',
  '20260903_finding_sla_policy.sql',
  '20260904_backfill_deterministic_signal_links.sql',
  '20260905_asset_product_identity.sql',
  '20260906_finding_operational_status_closed.sql',
  '20260907_finding_risk_acceptances.sql',
  '20260908_action_block_metadata.sql',
  '20260909_evidence_file_attachment.sql',
  '20260910_finding_independent_review.sql'
)
ORDER BY filename;
```

Any filename present in **prod** before promotion, or absent from **staging**, is a
halt-and-investigate condition (F-1 silent-skip class).

---

## Audit 2 — Production dark-flag audit (27 declared + 18 undeclared flags)

### 2.1 Method (reproducible)

```bash
# Declared flags with per-service values
awk '/^  - type:/{svc=""} /^    name: /{svc=$2}
     /key: SECURELOGIC_[A-Z_]+_ENABLED/{key=$3; getline;
       if ($1=="value:") print svc"|"key"|"$2}' render.yaml | sort

# Flags read by code but never declared in render.yaml
diff <(grep -rhoE 'SECURELOGIC_[A-Z_]+_ENABLED' src/ app/src/ services/ | sort -u) \
     <(grep -oE  'SECURELOGIC_[A-Z_]+_ENABLED' render.yaml | sort -u)
```

### 2.2 Results — production services (desired state, VERIFIED from `render.yaml`)

**`"true"` in prod — all three are previously-promoted, deliberately-live features
(not part of the staged payload):**

| Flag | Services | Status |
|---|---|---|
| `SECURELOGIC_ACTION_ENGINE_ENABLED` | engine, intelligence-worker | Live since GAP-3 promotion — intentional |
| `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` | engine, intelligence-worker | Live since #345 promotion — intentional |
| `SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED` | engine, intelligence-worker | Live — intentional |

**Every staged-not-promoted feature is `"false"` on every production service
(engine, app, intelligence-worker) — VERIFIED.** This includes all Briefing
(`DASHBOARD_BRIEFING` — the two-switch stays dark post-promotion per ruling D-E),
Asset Registry, Enterprise Context, Decision Workspace, Findings Queue Controls, Risk
Workspace/Lifecycle/Acceptance, Closure Gate, Intelligence Events, connectors,
autonomous/predictive/knowledge-graph, capability gating, brief quality/catch-up/
citation, and Platform Trial.

**18 flags are read by code but not declared in `render.yaml`** (e.g.
`INDEPENDENT_REVIEW` — deliberately operator-owned; `SIGNAL_APPLICABILITY`;
`ACCOUNT_DELETION_REAPER`; `LEGACY_NEWSLETTER`; `MATCHER_ALERTS`; `DAILY_DIGEST`; the
Phase-4 signal flags). All flag reads use the default-off `=== "true"` idiom
(spot-verified on the canonical helpers), so an undeclared flag is **disabled unless the
operator has set it in the dashboard**. Per-flag ownership detail:
`docs/runbooks/FEATURE-FLAG-ENABLEMENT-MATRIX.md`.

### 2.3 Caveat + operator confirmation step

`render.yaml` is **DESIRED state**, not proof of live env (standing rule). The
promotion-readiness gate therefore includes one operator step: confirm in the Render
dashboard that no production service carries a dashboard-set override enabling any
staged-feature flag or any of the 18 undeclared flags (known dashboard-owned:
`SECURELOGIC_VENDOR_ASSURANCE_ENABLED` prod = operator kill-switch, expected ON per
its own runbook — it is a previously-shipped feature, not staged payload). Record the
confirmation in the `OPERATOR_RUNBOOK.md` §0.4 evidence log.

---

## Disposition

- **Audit 1:** PASS with one finding (PF-1, staging-only, blocks nothing at promotion;
  must be resolved before the staging A04-G1 RLS flip) and one carried ruling
  (batch-rehearsal decision at Gate 5′).
- **Audit 2:** PASS on desired state; one operator dashboard confirmation required.
- Gate definitions consuming this document: `SPRINT_1.md` §Part B (re-baselined),
  `OPERATOR_RUNBOOK.md` (Gate 5′ banner), `RELEASE_CHECKLIST.md` (F-1 + flag steps).
