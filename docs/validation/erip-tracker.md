# Enterprise Risk Intelligence Platform (ERIP) — Program Tracker

Living tracker for the ERIP program (governing roadmap:
`docs/architecture/enterprise-risk-intelligence-platform.md`). Successor program to the
completed Enterprise Asset Registry goal (`enterprise-asset-registry-tracker.md` — preserved
as the Epic-1 historical record; do not edit it). Same governing invariants: everything DARK
behind flags (default off), additive-only migrations, backward compatibility, branch off
`origin/develop` → PR → CI 8/8 → squash-merge + delete branch, tenant scoping + inert RLS +
`dataClassification` on every new table, operator actions ledgered never executed, **no
production enablement (GATE B)**.

Last updated: 2026-07-07 (**RAISED-BAR COMPLETE** — the CORE-COMPLETE deferrals that were
engineering (not operator-runtime) are now built to the raised completion bar; PRs #526–#537
all merged to develop (backend #526–#536 + executive-dashboard UI #537). See the Raised-Bar
ledger below and `erip-final-report.md` §Addendum). Prior milestone: PROGRAM CORE COMPLETE
(Epics 1–7 shipped dark; close docs #524; develop @ `21e84fb4`).

## Program rulings / decision gates

| Date | Ruling |
|---|---|
| 2026-07-06 | ERIP established as the active governing program (Simmee directive). EAR = Completed Epic 1; EAR docs preserved as historical artifacts. Epics 2–7 approved scope; per-epic design memo required before implementation; autonomous engineering decisions where invariants preserved. Stop conditions: product-vision / destructive migration / compat break / operator-production action / BLOCKED-ON-SIMMEE. |

Open product decisions carried from Epic 1 (reserved for Simmee, not ERIP work): GATE B
production enablement; P9 entitlement-leg cutover.

## Epic ledger

| Epic | Scope | Status | Evidence |
|---|---|---|---|
| 1 — Enterprise Asset Registry | P0–P11 per EAR tracker | **COMPLETE ✅ (2026-07-06)** | PRs #496–#510; develop `7a81f857`; `enterprise-asset-registry-final-report.md` |
| 2 — Enterprise Discovery & Connectors | E2.P0–P6 | **COMPLETE ✅ (2026-07-06)** | Memo (ERIP-AD-8…14) + PRs #512–#517; 16 adapters total (9 EAR + aws/azure/gcp + microsoft_graph/google_workspace/github/jamf; Okta served by identity_provider) |
| 3 — Enterprise Risk Intelligence | E3.P0–P4 | **CORE COMPLETE ✅ (#518, #519)** — memo (ERIP-AD-15…18); E3.P1 graph propagation #518 + dimensional rollups. **Deferred by ruling:** E3.P2 live S7 continuous-correlation wiring (reassessment worker exists + dark; live triggering is operator-runtime = GATE-B territory), E3.P3 persisted-rollup materialization (perf optimization, unneeded while dark). Core exit met: a vendor's applicability decision propagates explainably to dependent assets (isolation-proven). | `docs/architecture/erip/E3-RISK-INTELLIGENCE-MEMO.md` |
| 4 — Executive Intelligence | E4.P1 executive risk summary + heatmap | **CORE COMPLETE ✅ (#520)** — memo (ERIP-AD-19 compose-not-store; AD-20 no fabricated trends). `executiveRiskSummary.ts` + `GET /api/executive/risk-summary`. **Deferred by ruling:** time-series trends + board-report generation (need persisted risk history, E3.P3-deferred — not fabricated); exec UI (presentation follow-up). | `docs/architecture/erip/E4-EXECUTIVE-INTELLIGENCE-MEMO.md` |
| 5 — Predictive Intelligence | E5.P1 forecast engine + posture forecast | **CORE COMPLETE ✅ (#521)** — memo (ERIP-AD-21 deterministic/explainable/reproducible OLS; AD-22 predict only where a real series exists; AD-23 factual direction). `forecastEngine.ts` + `GET /api/predictive/posture-forecast`. **Deferred by ruling:** vendor-deterioration/SLA/audit-readiness/control-degradation forecasts (same engine, their series, as those accrue); recommendation emission into `actions`. | `docs/architecture/erip/E5-PREDICTIVE-INTELLIGENCE-MEMO.md` |
| 6 — Autonomous Operations | E6.P1 approval-gated orchestration ledger + create_action executor | **CORE COMPLETE ✅ (#522)** — memo (ERIP-AD-24 human approval structural; AD-25 SoD; AD-26 forward-only; AD-27 internal-first). Migration `20260815` + `orchestrationPolicy.ts` + `routes/orchestration.ts`. **Deferred by ruling:** external executors (ServiceNow/Jira), notification/evidence executors, multi-step playbooks, per-org auto-approve. | `docs/architecture/erip/E6-AUTONOMOUS-OPERATIONS-MEMO.md` |
| 7 — Knowledge Graph / Digital Twin | E7.P1 labelled blast-radius / dependency graph | **CORE COMPLETE ✅ (#523)** — memo (ERIP-AD-28 one substrate/read-time projection; AD-29 labels from canonical home; AD-30 NL answering deferred behind a safety gate). `blastRadiusSummary.ts` + `graphLabeling.ts` + `GET /api/graph/blast-radius/:assetId`. **Deferred by ruling:** federating signals/risks/findings/evidence/controls/regulations/processes as graph nodes (as edge sources wire); NL question answering (LLM safety gate); graph business-impact scoring. | `docs/architecture/erip/E7-KNOWLEDGE-GRAPH-MEMO.md` |
| Close — final report, staging validation guide, prod enablement checklist, rollback plan | **DONE ✅ (#524)** | `21e84fb4` | `docs/validation/erip-final-report.md` + `docs/architecture/erip/ENABLEMENT-RUNBOOK.md` (staging validation §2, prod checklist §3, rollback §4). No enablement executed (GATE B). |

## Phase/PR ledger

| Item | Status | PR / squash | Notes |
|---|---|---|---|
| Program establishment (roadmap + tracker + BUILD_SEQUENCE amendment) | **DONE** | #511, squash `c85c612d` | docs-only |
| E2.P0 — Epic 2 design memo (ERIP-AD-8…14) | **DONE** (shipped with E2.P1) | #512, squash `600d22d5` | `docs/architecture/erip/E2-DISCOVERY-CONNECTORS-MEMO.md`; memo+first-phase shared a PR (EAR P10 precedent) |
| E2.P1 — sync state + scheduled sync + retry/backoff | **DONE** | #512, squash `600d22d5` | Migration `20260811` (interval CHECK ≥15, next_sync_at, consecutive_failures, partial due-index); `connectorScheduleCore.ts` (pure backoff/validation); `connectorScheduledSyncFlag.ts`; worker `runScheduleScan` (elevated due-scan → per-org tenant-tx deduped enqueue + schedule advance; terminal failure = streak+backoff, success resets); PUT accepts `sync_interval_minutes`; flag `SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` default "false" ×4 render.yaml. Unit + isolation `connectorScheduling.test.ts` |
| E2.P2 — observation ledger + incremental sync + drift reconciliation | **DONE** | #513, squash `6c111092` | Migration `20260812` (`connector_asset_observations` ledger — RLS, app_request DML, dataClassification entry; `enterprise_connectors.sync_cursor JSONB`); `ConnectorAdapter.fetchDelta?` optional capability + `ConnectorCursor`/`DeltaFetchResult` (ERIP-AD-10); ServiceNow reference `fetchDelta` (`sys_updated_on>` watermark; empty delta → cursor unchanged); `connectorObservationCore.ts` (pure plan→observations) + `connectorObservationStore.ts` (upsert; `countReappearing` before upsert; `markDriftStale` via `transaction_timestamp()` inequality — clock-independent, same-tx); worker: full vs delta branch, cursor persist (COALESCE keeps unchanged on null next_cursor), `sync_mode`/`observed`/`drift_stale`/`drift_reappeared` in summary. Drift is report-only — canonical rows never deleted (isolation-proven). Unit (`connectorObservationCore.test.ts`: planner + fetchDelta + migration lockstep) + isolation (`connectorObservations.test.ts`: full→cursor seed, delta no-stale, full-omit→stale→reappear, canonical survives, RLS) |
| E2.P3 — conflict resolution + confidence + discovery read surface | **DONE** | #514, squash `af2ecc52` | `discoveryConfidence.ts` (PURE, ERIP-AD-12: per-field precedence by connector category rank then recency, deterministic confidence 0–100 from source count/agreement/staleness/age, injected clock); `GET /api/assets/:id/discovery` (flag+capability+asTenant; correlates an asset's own backing external_ref + cross-connector same-name observations, org-scoped; read-only, no canonical mutation). **Deviation from memo (autonomous):** sync-time `conflicts_detected` DROPPED — a sync run is single-connector so cross-source conflict is only observable read-side; surfaced instead via the endpoint's `contested` flags. Unit `discoveryConfidence.test.ts` + isolation `assetDiscovery.test.ts` (two-connector name correlation → precedence winner + confidence; empty set; org-scoped no-leak on shared names; 404) |
| E2.P4 — owner + metadata discovery (suggest-only) | **DONE** | #515, squash `893324e7` | `NormalizedEntity` +`owner_hint?`/`metadata?` (source-echo, ECL S0 rule respected); ServiceNow reference adapter emits owner_hint (assigned_to/owned_by) + metadata (os/ip); `planObservations(plan, inventory)` enriches by external_ref; store upsert persists owner_hint/metadata (COALESCE keeps a prior discovery when a source omits it); `discoveryConfidence` gains `effective_owner_hint` (precedence-resolved) + merged `metadata`; `GET /api/assets/:id/discovery` adds `suggested_owner` — org-scoped `users` email match, **suggest-only (ERIP-AD-13, never auto-assigns)**. Unit (owner precedence + metadata merge) + isolation `assetOwnerDiscovery.test.ts` (sync→hint/metadata in ledger→endpoint suggests matching user; canonical owner untouched; no match → null). **Reserved columns from 20260812 (`owner_hint`/`metadata`/`confidence`) now used** (confidence still read-derived) |
| E2.P5 — adapter expansion wave 1 (native AWS/Azure/GCP) | **DONE** | #516, squash `2e034192` | 3 native cloud adapters + 2 pure auth modules: `awsSigV4.ts` (dependency-free SigV4 v4 signer, unit-tested determinism + derivation cross-check), `gcpServiceAccountJwt.ts` (RS256 SA-assertion minter, verified against a generated keypair). AWS = SigV4 → Resource Groups Tagging GetResources; Azure = OAuth client-creds → ARM resources; GCP = SA JWT → Cloud Asset Inventory. Migration `20260813` widens `enterprise_connectors.connector_id` CHECK (+aws/azure/gcp, ERIP-AD-14; DROP+ADD reshape, widening-only); registry + REQUIRED_CONNECTOR_IDS +3; `connectorSyncCore` `ADAPTER_PROVIDER` stamps provider from adapter id (native clouds override config.provider). Lockstep test repointed at 20260813 (current CHECK); handler count test derives from REQUIRED_CONNECTOR_IDS.length. Unit `cloudAdapters.test.ts` (config/fetch-with-fakes/normalize, SigV4, JWT, migration lockstep) + isolation `cloudConnectorSync.test.ts` (Azure sync → cloud_resource with provider='azure' → registry + view; org-isolated). Real-credential round-trips = operator ledger |
| E2.P6 — adapter expansion wave 2 (MS Graph/Google Workspace/GitHub/Jamf) | **DONE** | #517, squash `b0e70c29` | 4 adapters: `microsoft_graph` (OAuth client-creds → devices → endpoint), `google_workspace` (SA JWT **domain-wide delegation** — `mintServiceAccountAssertion` gains optional `subject` → Admin SDK users → identity accounts), `github` (PAT → org repos → application/import lane), `jamf` (OAuth client-creds → computers-inventory → endpoint). Migration `20260814` widens the connector_id CHECK (+4, ERIP-AD-14, widening-only). Registry + REQUIRED_CONNECTOR_IDS → 16; lockstep test repointed at 20260814. Okta stays served by `identity_provider` (no duplicate). Unit `directoryAdapters.test.ts` (per-adapter fetch-with-fakes/normalize/routing, DWD subject in the minted JWT, registry + migration lockstep) + isolation `directoryConnectorSync.test.ts` (GitHub sync → application enterprise_entities + observations + view; org-isolated). Real-credential round-trips = operator ledger. **Epic 2 COMPLETE** |
| E3.P0/P1 — Risk Intelligence memo + graph risk-propagation engine | IN PR | — | Memo `E3-RISK-INTELLIGENCE-MEMO.md` (ERIP-AD-15 pure read-derived; AD-16 own-risk from applicability; AD-17 outbound-graph inherited risk with per-hop decay; AD-18 correlation reuses reassessment worker). `graphRiskPropagation.ts` (PURE, deterministic, bounded [0,100]: direct = own; inherited = noisy-OR of dependencies' decayed own-risk; total = noisy-OR(direct, inherited); ordered contributor traces). `assetOwnRisk.ts` (own-risk seed from CURRENT applicability decisions — WORM latest-wins DISTINCT ON … seq DESC; decision→score × confidence; matches by target_id OR asset_id). `GET /api/assets/:id/risk-propagation` (new flag `SECURELOGIC_RISK_INTELLIGENCE_ENABLED` ×4 + registry chain; resolves outbound neighbourhood via the ECL graph resolver, seeds own-risk, runs the engine). No migration; read-only, no canonical mutation. Unit `graphRiskPropagation.test.ts` + isolation `assetRiskPropagation.test.ts` (asset→vendor depends_on; vendor 'affected'@100 → asset inherits 54 with trace; zero when no risky deps; org-scoped 404; unknown 404) |
| E3 — dimensional risk rollups (business impact across dimensions) | IN PR | — | `riskDimensionRollup.ts` (PURE: buckets per-asset own-risk by asset_type → count/at-risk/max/avg + Critical/High/Moderate/Low/None band distribution + enterprise overall; ERIP-AD-15/16). `GET /api/risk/dimensions` (new `routes/riskIntelligence.ts`; risk-intel flag + registry chain; own-risk from CURRENT applicability decisions latest-wins per asset_id over `asset_registry_v`, LEFT JOIN so unassessed = 0). Read-only, no migration. Unit `riskDimensionRollup.test.ts` (bands/aggregation/ordering/determinism) + isolation `riskDimensions.test.ts` (endpoint dimension rollup; org-scoped; unassessed = own-risk 0) |
| E4 — executive risk summary + heatmap | IN PR | — | `executiveRiskSummary.ts` (PURE compose, ERIP-AD-19: headline [overall band from peak, inventory totals, top-3 at-risk dimensions] + asset_type×band heatmap + latest posture context; trends deliberately absent, ERIP-AD-20). `GET /api/executive/risk-summary` (shares `gatherAssetRisk` with /risk/dimensions; joins latest `posture_snapshots`). Read-only, no migration. Unit `executiveRiskSummary.test.ts` + isolation `executiveRiskSummary.test.ts` (composes risk+posture; posture null when absent; org-scoped) |
| E5 — deterministic forecast engine + posture forecast | IN PR | — | `forecastEngine.ts` (PURE OLS: slope/intercept/R², sample-+fit-scaled confidence, factual increasing/decreasing/stable via slope deadband, reasoning trace; guards <2 points + zero x-variance → insufficient_data; optional clamp). `GET /api/predictive/posture-forecast?horizon_days=N` (new flag `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` ×4; reads posture_snapshots series, x=days-since-first, y=overall_score clamped [0,100]). Read-only, no migration. Unit `forecastEngine.test.ts` (exact fit, clamp, trends, degenerate guards, confidence scaling, noise) + isolation `postureForecast.test.ts` (rising series → increasing projection >last; single snapshot → insufficient_data; org-scoped; bad horizon → 400) |
| E6 — approval-gated orchestration ledger + create_action executor | IN PR | — | Migration `20260815` (`orchestration_proposals` — RLS NOT FORCE, app_request DML, dataClassification, forward-only status CHECK, proposal_type CHECK('create_action')). `orchestrationPolicy.ts` (PURE forward-only transition table + SoD rule + per-type payload validation). `routes/orchestration.ts`: POST propose→proposed, GET list, POST :id/approve (SoD-checked; approve→execute create_action [emits an `actions` row, source_type='manual', action_type='orchestration:create_action']→executed\|failed; audited), POST :id/reject. Flag `SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` ×4. **No auto-execute — approval is structural (ERIP-AD-24); approver ≠ proposer (AD-25).** Unit `orchestrationPolicy.test.ts` (transitions/SoD/payload/lockstep) + isolation `orchestration.test.ts` (propose→self-approve 403→different-human executes real action→re-approve 409; reject terminal; org-isolated + RLS) |
| E7 — labelled blast-radius / dependency graph | IN PR | — | `blastRadiusSummary.ts` (PURE: reachable count [root excluded], by-type, max depth, edge count; deterministic). `graphLabeling.ts` (batched per-type label lookup from canonical home tables — asset_registry_v/vendors/ai_systems/enterprise_entities/users; ERIP-AD-29). `GET /api/graph/blast-radius/:assetId?depth=N` (new flag `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` ×4 + registry chain; maps asset→graph node EAR-AD-4, resolves outbound neighbourhood via the ECL resolver, labels nodes, summarizes). **NL answering deferred (ERIP-AD-30 safety gate).** Read-only, no migration. Unit `blastRadiusSummary.test.ts` + isolation `blastRadius.test.ts` (asset→vendor depends_on; vendor node labelled from vendors, root from registry; summary reachable_count=1; org-scoped 404) |

## Raised-bar ledger (2026-07-07)

Program owner raised the completion standard (a capability is complete only when fully
engineered and operational immediately after credentials + operator settings + flags +
customer systems — no framework/mock/deterministic-only/placeholder). Every §-deferred item
that was *engineering* was built to that bar. Governance unchanged (dark, additive, CI 8/8,
squash-merge, GATE B).

| Item | Status | PR | Delivered |
|---|---|---|---|
| F1 — shared LLM service | **DONE ✅** | #526 | `llmService.ts` (instrumented Anthropic client, text+JSON, graceful degradation) — substrate for all LLM features |
| F2 — risk history persistence | **DONE ✅** | #527 | `risk_history` (`20260816`) + daily snapshot worker (03:15) |
| E4 — executive trends/KPIs/exports | **DONE ✅** | #528 | `GET /api/risk/trends`,`/kpis`,`/export`; real historical analysis over persisted snapshots |
| E5a — predictive pipeline | **DONE ✅** | #529 | `risk_forecasts` (`20260817`); OLS+Holt RMSE-selected; inference worker (03:45) **re-fits each run = retraining**; confidence + explainability |
| E5b — LLM-assisted insights | **DONE ✅** | #530 | `generatePredictiveInsights` — LLM narrative/recommendations grounded in forecasts; deterministic only as no-key fallback |
| E6a — real executors | **DONE ✅** | #531 | ServiceNow/Jira/Teams/Slack/Email over SSRF-safe client; encrypted per-org integration config (`20260818`); evidence + escalation |
| E6b — playbooks + scheduling | **DONE ✅** | #532 | Playbooks (`20260819`) + scheduler; runs create proposals (still human-approved) |
| E7 — NL querying + graph reasoning | **DONE ✅** | #533 | `POST /api/graph/ask` — LLM-grounded NL answers + blast-radius/dependency/business-impact analysis; injection-safe; deterministic fallback |
| E2a — bidirectional writeback | **DONE ✅** | #534 | `connector_writeback_intents` (`20260820`) + worker + adapter `writeback` (ServiceNow) + optimistic-concurrency conflict resolution; new flag `SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED` |
| E2b — dead-letter recovery | **DONE ✅** | #535 | `connector_dead_letters` (`20260821`) — capture + operator re-drive/ignore (`/api/connectors/dead-letters*`) |
| E2c — connector health monitoring | **DONE ✅** | #536 | `GET /api/connectors/health` — per-connector band + reasons + org rollup |
| UI — interactive executive dashboard | **DONE ✅** | #537 | Multi-view Next.js dashboard (all dimensions; KPIs/trend/heatmap/comparison/drill-down/export + predictive + connector health); dark behind app-side `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`. App typecheck + knowledge-index drift + full suite (5,504) green |

Raised-bar migrations: `20260816`–`20260821` (all additive, dataClassification-registered).
Full unit suite **5,504 passing**; new isolation suites for risk history, forecasts, LLM
narrative, executors + playbooks, graph ask, writeback, dead-letter, and connector health —
all green. Remaining work is **operator-owned only** (credentials, settings, flags, systems,
staging validation) — see `erip-final-report.md` §A4.

## Enterprise Risk Workspace (presentation-layer program — Packages 1+2)

Post-core ERIP presentation program (audit + memo: `docs/architecture/erip/
ENTERPRISE-RISK-WORKSPACE-AUDIT.md` + `ERIP-ENTERPRISE-RISK-WORKSPACE-MEMO.md`).
Operator-approved Packages 1 (Finding-centric / Asset-context IA) and 2 (navigation
restructuring) on 2026-07-08; Packages 3 (page merges) and 4 (workflow convergence)
NOT authorized. Same governance: DARK, additive, GATE B.

| Item | Status | Notes |
|---|---|---|
| Workspace IA + navigation restructure | **IN PR** | New app nav flag `SECURELOGIC_RISK_WORKSPACE_ENABLED` (default off; render.yaml app declaration). `navigation.ts` gains `WORKSPACE_NAV_ITEMS` + `getNavItems(flags)` + per-child entitlement gating; enterprise-workflow IA (Intelligence / Risk Operations / Assets / Compliance); Approvals + Vendor Assurance surfaced; Ask demoted to the user menu. Flag off = legacy nav byte-for-byte. Knowledge-index unaffected (reads NAV_ITEMS). |
| Queue → "Review Suggested Links" reskin | **IN PR** | Plain enterprise language, confidence bands, humanized "why matched", Intelligence-Event title (fixes the `event_*`/`signal_*` field-name bug → no raw signal UUIDs). Behind the same flag; engine query unchanged. `components/queue/reviewLanguage.ts` (pure, unit-tested). |
| Tests | **DONE** | `navigationFlags.test.ts` (+workspace nav: flag-off byte-identity, groups/order, Ask demoted, Approvals/Vendor-Assurance surfaced, EAR asset-registry behavior preserved) + `reviewLanguage.test.ts` (no raw codes/UUIDs, confidence bands). Full suite 5763 green; app+engine typecheck green; no knowledge-index drift. |
| Operator actions (ledgered, not executed) | **PENDING** | Set `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` on the staging app service → validate nav + Review Links → separate GATE-B ruling for prod. |

**Out of scope for Packages 1/2 (now Package 3+):** finding↔intelligence-event deep
linkage. **Still out of scope (Package 4 / separate):** `/vendors`+`/vendors/risk` merge,
brief-engine convergence, Posture consolidation, `/ai-systems` entitlement fix.

### Package 3 — Decision Workspace (approved 2026-07-09 with modifications)

Design: `docs/architecture/erip/PACKAGE-3-DECISION-WORKSPACE-DESIGN.md` (v2 with the six
operator modifications). Flag `SECURELOGIC_DECISION_WORKSPACE_ENABLED` (default off). Findings
become the enterprise decision object; Intelligence Events stay drill-through only (no
customer Intelligence Events page). Phased, each independently dark/shippable/testable.

| Phase | Status | Notes |
|---|---|---|
| 3.0 Finding Context Resolver | **DONE** (#560) | `findingContextResolver.ts` (read-only compose). `GET /api/findings/:id/context` — flag-gated 404 when dark. No schema change. Unit + cross-org isolation tests. |
| 3.1 Business Impact + Risk Score | **DONE** (#561) | compose-at-read; `findingRiskScore.ts`; degrades when `risk_intelligence` off |
| 3.2 Decision Workspace UI | **DONE** (#562/#563) | Zones A–G; `decision_state` additive column; What's-Changed marker |
| 3.3 Intelligence drill-through + Remediation tab + `/actions` redirect | **DONE** (#565–#569) | `/intelligence/[id]` drill-through only (no nav — guard test). PR-1 fetcher `getIntelligenceEvent`; PR-2 drill-through page (reuses existing engine route, enrichment + honest degrade); PR-3 Finding→event (Zone E) + Queue reciprocal link (**Brief link deferred — D5**); PR-4 Remediation tab; PR-5 `/actions`→My Actions (R5 session-scoped). No new flag/route/schema/render.yaml. |
| 3.4 Finding List redesign + saved views | PLANNED | executive/analyst framing — NOT in P3.3 scope |

**P3.3 operator actions (ledgered, not executed):** staging is DARK. Full drill-through
validation needs `SECURELOGIC_RISK_WORKSPACE_ENABLED` + `SECURELOGIC_DECISION_WORKSPACE_ENABLED`
on the staging **app**, plus `SECURELOGIC_DECISION_WORKSPACE_ENABLED` on the staging **engine**;
`SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (engine) additionally enriches the drill-through
(degrades honestly when off). No render.yaml change in this package. Prod remains GATE B.

## Deferred / follow-up register

Carried from Epic 1 (rulings recorded in the EAR tracker; not blockers):
- Legacy assessment route-tx collapse, one stack per PR (EAR-AD-7 step 2).
- vendorAssessments/dependencyAssessments gate normalization (P9-cutover scope).
- Brief citations for corroborating provenance signals.
- **Enterprise Risk Workspace Package 4** (workflow/brief convergence) — audited
  and recommended, awaiting separate operator authorization. (Package 3 —
  Decision Workspace, phases 3.0–3.3 — is SHIPPED dark; 3.4 list redesign remains.)
- **Brief → Decision Workspace drill-through link (D5, deferred):** the brief item
  view carries `cyber_signal_id`, not an intelligence-event id; a dedicated
  Brief-workflow package should add the `cyber_signal_id → event_id` resolution.
- **App RTL harness (test follow-up):** the Next app has no React Testing Library
  harness, so P3.3 DOM/tab-interaction behavior is covered by pure-helper unit
  tests + manual staging validation. Add an RTL harness to close the gap.

### ERIP Launch Readiness — deferred customer-facing UX (SHIPPED dark, 2026-07-09)

Operator-directed closure of the deferred customer-facing ERIP UX so the platform
reads as enterprise decision support, not raw lists/queues. All dark; flag-off
byte-identical. No schema/migration/render.yaml; no new engine routes (all reuse
existing endpoints).

| Item | Status | PR | Flag | Notes |
|---|---|---|---|---|
| Findings → decision queue | **DONE (dark)** | #571 | `RISK_WORKSPACE` | Attention tiles (overdue SLA / unassigned / High&Critical open / open total) + urgency grouping; header reframe. Rows link into the Decision Workspace. Pure `decisionQueue.ts`. |
| Brief → Decision flow | **DONE (dark)** | #572 | `DECISION_WORKSPACE` | Brief item resolves the org's finding for its `cyber_signal_id` via existing `getFindings({source_id})` (tenant-safe); links to the Workspace or "Review suggested links". Closes D5 without the signal→event bridge. |
| Source-aware Workspace empty states + recommendations | **DONE (dark)** | #573 | `DECISION_WORKSPACE` | Zone E + recommendation copy now explain absence by finding source. Pure `findingSourceCopy.ts`. |
| Review Suggested Links (plain language, confidence, why-matched, no raw IDs, accept/dismiss) | **DONE (dark)** | Pkg 1/2 (#559) | `RISK_WORKSPACE` | Already shipped. Raw IDs / matcher terms remain ONLY in the flag-OFF legacy branch (removing them there would break byte-identity) — removed by enabling the flag. |
| Queue bulk accept/dismiss | **DEFERRED (optional)** | — | — | "If practical" — would need a bulk engine endpoint; not built (no engine change). |
| Actions integrated into Findings | **DONE (dark)** | #568/#569 | `DECISION_WORKSPACE` | Remediation tab + `/actions`→My Actions (session-scoped). |
| Intelligence Events drill-through only | **DONE + guarded** | #566/#570 | `DECISION_WORKSPACE` | Nav guard test; no primary-nav, no index route. |

### Launch Experience close-out (SHIPPED dark, 2026-07-09/10)

Operator-directed completion goal "Complete the SecureLogic Launch Experience". Closes the
remaining customer-facing gaps + selected fast-follow. All dark; flag-off byte-identical; no
schema-visible behavior change; GATE B untouched. Final report:
`docs/validation/launch-experience-final-report.md`; operator actions:
`docs/validation/launch-experience-operator-ledger.md`.

| Item | Status | PR | Flag | Notes |
|---|---|---|---|---|
| §6 Every-source affected context | **DONE (dark)** | #576 | `DECISION_WORKSPACE` | `findingContextResolver` resolves affected entities for assessment/risk/applicability/legacy sources, not just intelligence. `resolveAssessmentAffected` + `mergeAffected`; +2 real-Postgres isolation cases. No schema change. |
| §5 My Actions remediation depth | **DONE (dark)** | #577 | `DECISION_WORKSPACE` | SLA framing + ownership (mine/team) + source-finding linkage. Pure `actionQueue.ts` + `MyActionsView`. `myActions.actionScope` (mine\|team) additive. |
| Day-0 Findings empty state | **DONE (dark)** | #578 | `RISK_WORKSPACE` | first-time-empty vs filtered-empty; `isFirstTimeEmpty`. |
| §4 D5 Brief → Intelligence Event | **DONE (dark)** | #579 | `DECISION_WORKSPACE` | Linked brief item drill-throughs to its supporting event, resolved from finding context (reuses #576 bridge). Closes D5 for linked items; unlinked-item signal→event lookup still deferred. |
| §1 Findings saved views | **DONE (dark)** | #580 | `DECISION_WORKSPACE` | New `finding_saved_views` table (org+user, RLS, dataClassification) + `/api/finding-saved-views` + `SavedViewsBar`. Migration `20260710`. Whitelist-sanitized filters. |
| §3 Review Links bulk accept/dismiss | **DONE (dark)** | #581 | `RISK_WORKSPACE` | Opt-in Select mode reusing the ratified per-item endpoints (no engine-tx change); partial-failure results. Closes the previously-DEFERRED-optional bulk item. |
| RTL harness + render tests | **DEFERRED (fast-follow)** | — | — | App has no RTL harness; UI covered by pure-helper unit tests + staging validation. Top recommended fast-follow. |

**Operator actions to make launch-readiness VISIBLE (ledgered, NOT executed — dark by governance):**
staging-first, then GATE B for prod:
- **App:** `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` (Findings decision queue, nav IA,
  Review Suggested Links) **and** `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`
  (Decision Workspace, Brief→decision, source-aware states).
- **Engine:** `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true`; optionally
  `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` to enrich the drill-through.
- Until these are enabled, every surface stays byte-identical to today (dark-launch
  design) — the code is complete; visibility is an operator flag flip.
