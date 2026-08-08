# Enterprise Risk Intelligence Platform (ERIP) — Governing Roadmap

**Status:** ACTIVE governing engineering program (established 2026-07-06, Simmee directive).
**Supersedes:** the Enterprise Asset Registry (EAR) goal as the *active roadmap*.
**Preserves:** every EAR document as a completed historical engineering artifact — nothing
under `docs/architecture/enterprise-asset-registry/` or the EAR validation docs is renamed,
rewritten, or reinterpreted. The EAR is recorded here as **Completed Epic 1** and is the
foundation every later epic builds on.

**Tracker (living truth):** `docs/validation/erip-tracker.md`
**Prior program record:** `docs/validation/enterprise-asset-registry-tracker.md`,
`docs/validation/enterprise-asset-registry-final-report.md`

---

## 1. Program charter

SecureLogic AI's platform vision (CLAUDE.md §1–2, PRODUCT_VISION.md) requires more than a
canonical asset identity: it requires continuous discovery of the enterprise estate,
continuous correlation of external signals to that estate, risk propagation across the
relationship graph, executive and predictive intelligence derived from it, approval-gated
operational follow-through, and a queryable knowledge graph tying every domain object
together. The EAR delivered the identity spine, the generalized matcher/applicability
chokepoints, the connector activation lane, the generic assessment engine, and the
capability-gating plumbing. ERIP is the program that turns that spine into the platform.

ERIP is **engine-first**: every epic extends the shared risk/posture/graph engines and the
canonical domain model. No epic may warp the architecture around a single output surface.

## 2. Governance invariants (non-negotiable, inherited from EAR/ECL)

- All work lands on `develop`. Branch off `origin/develop` → PR → CI green
  (8/8) → **squash-merge** → delete branch. *(Amended 2026-07-28: the original "`main`
  frozen" clause was superseded by the 2026-07-21 production launch — `main` now advances
  via the launch/promotion process (`docs/launch/LAUNCH_MASTER_PLAN.md`), never by direct
  program pushes. The develop-based flow above is unchanged.)*
- **Dark launches only.** Every new behavior behind a feature flag, default OFF in all four
  `render.yaml` services. **Never enable production** (GATE B applies program-wide).
- **Additive migrations only**; backward compatibility is structural, not best-effort. No
  destructive migration without an explicit Simmee ruling (STOP condition).
- Tenant scoping on everything: org-scoped predicates + `asTenant` on new routes, inert RLS
  (NOT FORCE) + `app_request` grants + `dataClassification.ts` entry on every new table.
- **Reuse before rewrite; never duplicate an EAR capability.** New work extends
  `asset_registry_v`, `enterprise_relationships`, the asset-type spec, the assessment spec,
  the applicability engine, and the connector framework — it does not fork them.
- Operator actions are never executed by the program — they are documented in runbooks and
  the operator ledger only.
- Each epic requires a **design memo ratified before implementation** (the EAR P6–P11
  convention). Autonomous engineering decisions are permitted where they preserve these
  invariants.
- Stop conditions: product-vision decision · destructive migration · backward-compat break ·
  production/operator action · true BLOCKED-ON-SIMMEE. Nothing else stops the program.
- Docs discipline: the ERIP tracker, this roadmap, rollback guidance, and runbooks are
  updated continuously as phases merge.

## 3. Completed Epic 1 — Enterprise Asset Registry ✅

Delivered as PRs #496–#510 (develop @ `7a81f857`), all dark, migrations `20260801`–`20260810`
additive, decisions EAR-AD-1…7 ratified. Authoritative record: the EAR tracker + final
report. The capabilities ERIP inherits:

| Inherited capability | Where |
|---|---|
| Canonical asset identity (Tier-0 `assets` spine + `asset_registry_v` federated view; EAR-AD-1/2/3) | `assetRegistry.ts`, `assetRegistrar.ts`, `20260802`/`20260803` |
| 4 native detail types (cloud_resource, endpoint, api, identity_system) + unified `/api/assets` CRUD | `assetDetail*.ts`, `routes/assets.ts` |
| One graph substrate with infrastructure vocabulary (EAR-AD-4) + bounded recursive resolver | `enterprise_relationships`, `enterpriseGraphResolver.ts` |
| Connector framework: 9 adapters, encrypted per-org config, SSRF-safe HTTP client, sync worker, relationship persistence | `connectors/*`, `connectorSyncCore.ts`, `connectorSyncWorker.ts`, `connectorConfigStore.ts`, `connectorHttpClient.ts` |
| Spec-driven matcher + applicability engine over any asset type (R1b; plane convergence) | `cyberSignalProcessingService.ts`, `engine/applicability/v1/*` |
| WORM applicability decision ledger + explainability + reassessment worker | `applicability_assessments`, `applicabilityReassessmentWorker.ts` |
| Generic spec-driven assessment engine over any asset (EAR-AD-5/6/7) | `assessmentSpec.ts`, `assessmentEngine.ts`, `asset_assessments` |
| Tenant hardening (asTenant on 46 core endpoints) + capability dual-gate | P8/P9, `corePlatformCapability.ts` |
| Registry-wide rollups in stats/dashboard + Brief applicability citations | P5/P11 |
| Enablement runbook + rollback map (GATE B checklist) | `enterprise-asset-registry/ENABLEMENT-RUNBOOK.md` |

Open product decisions carried (NOT ERIP work; reserved for Simmee): GATE B production
enablement; P9 entitlement-leg cutover.

## 4. Future epics

Each epic below is a charter: objective, foundation reused, indicative phases, exit
criteria. The ratified per-epic design memo (`docs/architecture/erip/E<n>-*.md`) refines
phases and makes the binding engineering decisions. Epics execute in order; an epic may
start while a prior epic's deferred follow-ups remain open only if the tracker records the
dependency explicitly.

### Epic 2 — Enterprise Discovery & Connectors

**Objective:** production-grade continuous discovery — connectors that synchronize
incrementally on a schedule, resolve conflicts across sources, score confidence, discover
owners and relationships, and detect drift — plus adapter coverage for the major
enterprise estates.

**Foundation reused (never duplicated):** the 9 existing adapters + `ConnectorAdapter`
contract, `connectorSyncCore` (pure planning), `connectorSyncWorker` (tx discipline),
`connectorConfigStore` (AES-256-GCM), `connectorHttpClient` (A10-G1 SSRF defense on every
request), `enterpriseImportPersistence`, P7 relationship resolution, `jobs` retry/backoff
machinery.

**Indicative phases:**
- **E2.P0 — design memo** (sync-state model; scheduling; conflict/confidence/drift
  semantics; adapter interface extension for incremental cursors; new-adapter auth modes).
- **E2.P1 — sync state + scheduled synchronization + retry hardening.** Per-org/per-connector
  sync state (cursor/watermark, last full sync, schedule interval); a scheduler tick that
  enqueues due syncs (double-fenced + per-connector `enabled`); reuse jobs retry/backoff.
- **E2.P2 — incremental sync + reconciliation + drift detection.** Cursor-based delta
  fetches where the source supports it; periodic full-sync reconciliation that detects
  assets no longer reported (lifecycle drift → `lifecycle_status`, never hard delete);
  drift summary in the sync record.
- **E2.P3 — conflict resolution + confidence scoring + provenance depth.** Multi-source
  merge policy (source precedence, field-level last-writer + confidence), per-asset
  provenance/confidence surfaced read-side.
- **E2.P4 — owner + metadata discovery.** Owner hints from sources mapped to users (suggest,
  never auto-assign), richer metadata sync into typed columns.
- **E2.P5 — adapter expansion wave 1:** native AWS, Azure, Google Cloud (generalizing the
  pre-authorized-export `cloud_inventory` v1 into real API adapters).
- **E2.P6 — adapter expansion wave 2:** Microsoft Graph, Google Workspace, GitHub, Jamf;
  Okta generalized from the `identity_provider` adapter. Future-connector contract
  documented so a new adapter is config + one module.

**Exit:** a mock-credential connector estate syncs on schedule, incrementally, with
conflict-resolved, confidence-scored, provenance-carrying assets and relationships;
drift is detected and reported; all listed sources have adapters with mock-backed tests;
real-credential validation remains operator work (ledger).

### Epic 3 — Enterprise Risk Intelligence

**Objective:** continuous signal→asset correlation and graph-aware risk computation:
direct risk, dependency risk, inherited risk, business impact, and criticality — every
decision explainable — with automatic reassessment of affected assets and reporting
expansion across enterprise / business units / applications / vendors / AI / cloud /
operations / supply chain.

**Foundation reused:** the spec-driven matcher (three invocation paths preserved), the
applicability engine + WORM ledger + explainability + S6/S7 pure cores (workflow
recommendations, signal-linkage/reassessment/drift), the graph resolver, `risk_scoring_weights`,
the posture engine, `findings`/`actions`/`risks` primitives.

**Indicative phases:** E3.P0 memo → E3.P1 continuous correlation (wire the inert S7
signal-linkage core: signal events trigger applicability reassessment of affected assets)
→ E3.P2 graph risk propagation engine (pure: direct/dependency/inherited per asset,
reasoning traces; persisted rollups) → E3.P3 business impact + criticality rollups →
E3.P4 dimensional reporting expansion.

**Exit:** a new signal against a vendor propagates explainably through the graph to
dependent applications/AI systems, reassessments fire automatically (dark), and per-dimension
risk rollups are queryable.

### Epic 4 — Executive Intelligence

**Objective:** decision-grade executive reporting across every Epic-3 dimension —
board-ready rollups, trends, heatmaps, and narratives grounded exclusively in canonical
domain objects (outputs consume, never define).

**Foundation reused:** Epic 3 rollups, `asset_registry_v`, posture snapshots, the exec
dashboard + R6 stats endpoint, the Brief synthesis/citation lane (P11 direction:
platform → Brief).

**Indicative phases:** E4.P0 memo → E4.P1 dimensional executive reporting API (trend +
rollup + top-movers per dimension) → E4.P2 executive surfaces (UI) → E4.P3 board-report
generation (structured, explainable, citation-carrying).

**Exit:** an executive can see enterprise/BU/application/vendor/AI/cloud/operations/
supply-chain posture and risk movement from one dark surface, every number traceable to
canonical objects.

### Epic 5 — Predictive Intelligence

**Objective:** explainable forecasting — emerging risk, control degradation, audit
readiness, vendor deterioration, SLA failure risk, future exposure — with recommendations
that carry reasoning traces. Deterministic/statistical first; every prediction explainable
and reproducible (the WORM/by-value discipline applies).

**Foundation reused:** posture history (`posture_snapshots`/`domain_scores`), assessment
histories, sync/drift records (Epic 2), correlation events (Epic 3), the explainability
pattern from `engine/applicability/v1`.

**Indicative phases:** E5.P0 memo → E5.P1 pure forecasting engine + fixtures → E5.P2
persisted forecasts + API (org-scoped, dark) → E5.P3 explainable recommendations feeding
`actions` (suggest-only).

**Exit:** forecasts with confidence bands and step-by-step rationale exist per org across
the six prediction families, reproducible from persisted inputs.

### Epic 6 — Autonomous Operations

**Objective:** approval-based orchestration — the platform can *propose and, on human
approval, execute* operational follow-through: findings, tasks, evidence requests,
notifications, ServiceNow/Jira tickets, and future playbooks. **Human approval remains
required unless an org explicitly configures otherwise;** every execution is audited.

**Foundation reused:** `actions`/`findings` primitives, the S6 workflow-recommendation core,
the jobs/worker pattern, `connectorHttpClient` (SSRF-safe outbound), `writeAuditEvent`,
the approval/separation-of-duties thinking in the risk-lifecycle spec.

**Indicative phases:** E6.P0 memo (playbook spec, approval model, execution ledger) →
E6.P1 orchestration core (playbook definitions, approval-gated execution state machine,
append-only execution ledger) → E6.P2 internal executors (findings/tasks/evidence
requests/notifications) → E6.P3 external executors (ServiceNow, Jira; per-org encrypted
config reusing the connector config store).

**Exit:** a recommendation can be approved and executed end-to-end in staging mocks with a
complete audit trail; nothing executes without approval; all dark.

### Epic 7 — Enterprise Knowledge Graph / Digital Twin

**Objective:** one queryable graph connecting assets, relationships, signals, risks,
findings, evidence, controls, owners, business processes, regulations, and workflows —
supporting natural-language enterprise risk questions, blast-radius analysis, dependency
analysis, business-impact analysis, and executive explainability.

**Foundation reused:** `enterprise_relationships` + resolver (EAR-AD-4: one substrate),
typed-edge union (AD-13), the polymorphic link/quartet tables + `asset_id` spine, the
applicability blast-radius machinery, LLM guardrails from the existing Claude integrations.

**Indicative phases:** E7.P0 memo (node/edge vocabulary growth vs. read-time federation of
typed edges; NL answering safety model) → E7.P1 graph completeness (federate
signals/risks/findings/evidence/controls/regulations/processes as resolvable nodes —
read-time union first, edges only where no typed source exists) → E7.P2 analysis surfaces
(blast radius, dependency, business impact APIs) → E7.P3 natural-language question
answering over the graph (org-scoped retrieval, prompt-injection-hardened, answers cite
graph paths).

**Exit:** "what is the blast radius of a compromise of vendor X?" is answerable dark, with
a cited graph path, in natural language and via API.

## 5. Flags

Existing flags are reused where an epic extends their surface
(`SECURELOGIC_ASSET_REGISTRY_ENABLED`, `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`,
`SECURELOGIC_CAPABILITY_GATING_ENABLED`, `SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED`).
New autonomous or net-new behavior gets its own flag (proposed; memos finalize):
`SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` (E2), `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`
(E3/E4), `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` (E5),
`SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` (E6), `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` (E7).
All default `"false"` in all four render.yaml services; enablement order and rollback per
the program runbook at close.

## 6. Program completion definition

ERIP is complete only when: every epic's ratified scope is implemented and integrated with
the EAR foundation; tests (unit + cross-org isolation) pass; documentation, rollback
guidance, and runbooks are complete; operator actions are fully ledgered (documented, never
executed); all capabilities remain dark by default; and a final implementation report,
staging validation guide, production enablement checklist, and rollback plan exist.
Production enablement itself is out of scope forever within this program (GATE B).
