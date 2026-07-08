# SecureLogic — Feature Flag Enablement Matrix (operational reference)

**Status:** Living reference. Does **not** replace the per-goal Enablement Runbooks
(`docs/architecture/enterprise-asset-registry/ENABLEMENT-RUNBOOK.md`,
`docs/runbooks/intelligence-events-enable-rollback.md`, the ECL/ERIP trackers) — it
sits above them as the single map of **flag → services that require it**. Where a
flag has a dedicated runbook, that runbook is authoritative for its validation
detail; this doc tells you *which services to set it on and why*.

**Source of truth:** `render.yaml`, the engine feature-flag helpers
(`src/api/lib/*FeatureFlag.ts`), `src/api/server.ts` (which starts the in-process
workers), the app `layout.tsx` nav flags, and the actual `process.env.<FLAG>`
reads across `app/`, `src/`, and `services/`. Verified against `develop`. Nothing
here is inferred from naming.

> **The one question this doc answers:** *"Which service needs this flag?"* — see
> every flag's **Required services** line and the summary funnel at the end.

---

## 0. Service topology (who runs what)

| Service (prod / staging) | Runtime | Reads flags for |
|---|---|---|
| **Engine** — `securelogic-engine` / `securelogic-engine-staging` | `server.js` (API) **+ all `src/api/workers/*` in-process** + the scheduler | Every API route gate **and** the connector-sync, connector-writeback, risk-history, predictive-forecast, autonomous-orchestration, and applicability-reassessment background workers (`server.ts` calls `start…Worker()`, each self-gating). |
| **App** — `securelogic-app` / `securelogic-app-staging` | `next start` (server-side) | Exactly **3 nav flags** in `layout.tsx`: `ENTERPRISE_CONTEXT`, `ASSET_REGISTRY`, `RISK_INTELLIGENCE` (+ a few page-body reads: vendor-assurance, industry-templates, risk-lifecycle). |
| **Intelligence Worker** — `securelogic-intelligence-worker(-staging)` | `scheduler.js → runPipeline` | Signal ingestion pipeline: `INTELLIGENCE_EVENTS`, `LEGACY_NEWSLETTER`. |
| **Posture / Data-rights / Vendor-extraction workers** | dedicated `index.js` | **None** of the feature flags below. |
| **Website(-staging)** | static serve | None. |

**Key facts that govern the whole matrix:**
1. **There is no separate "connector/risk/predictive/autonomous worker" service.**
   Those loops run **in-process inside the Engine**, so their flags belong on the
   **Engine service**, not a worker.
2. **`securelogic-app-staging` is NOT in `render.yaml`** (it is dashboard-only).
   Set the 3 app-side flags for staging in the **Render dashboard**; the engine /
   worker staging flags live in `render.yaml`'s staging blocks (or a dashboard
   override).
3. **All flags are RUNTIME env** (read per request / per worker cycle; the app
   reads them server-side, **not** `NEXT_PUBLIC`). Changing any flag requires a
   **service restart** — Render auto-redeploys on env save — but **never a
   rebuild**.
4. **Default semantics:** every flag is read as `=== "true"`, so an unset env is
   **OFF**. `render.yaml` sets four to `"true"` (live features); everything else is
   `"false"` or absent (dark).

---

## 1. Tier A — Platform / ERIP / EAR / ECL flags (full treatment)

All Tier-A flags are **dark by default (`"false"`)** and under **GATE B** for
production (no prod enablement without an explicit operator ruling).

### 1.1 `SECURELOGIC_ASSET_REGISTRY_ENABLED`
- **Purpose:** Enterprise Asset Registry — the canonical asset surface (`/api/assets*`, `/api/connectors`, `/api/asset-assessments`, matcher branch, `registerAsset`) and the app's Assets nav + onboarding (`/assets`, `/assets/new`, `/assets/connect`, wizard step).
- **Required services:** **Engine + App.**
- **Why each:** *Engine* — gates all registry routes/writes and the in-process connector/risk/predictive workers. *App* — "Asset Registry" nav + `/assets*` page dark-gating + Setup-Wizard step 2.
- **Redeploy/restart:** Yes, restart Engine + App (auto on env save); no rebuild.
- **Default:** `"false"` (render.yaml, all blocks).
- **Staging order:** migrations (Step 0) → `securelogic-engine-staging` → `securelogic-app-staging` (dashboard).
- **Production order:** GATE B ruling → prod engine → prod app.
- **Validation:** `GET /api/assets`→200; nav shows "Assets → Asset Registry"; create/import/connect via `/assets/new`; EAR Enablement Runbook Step 1.
- **Rollback:** set `"false"` on both → routes 404-before-auth, UI shows neutral panel; written rows remain inert.
- **Dependencies:** Reuses the `enterprise_context` **capability** (platform/premium/enterprise tiers, or per-org `organizations.enterprise_context_capability=TRUE`). Connectors sub-surface additionally needs **`ENTERPRISE_CONTEXT`** (double-fence).

### 1.2 `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED`
- **Purpose:** Enterprise Context Layer (ECL) — enterprise entities, relationship graph, applicability engine, CSV import, and the connector + brief-citation double-fences.
- **Required services:** **Engine + App.**
- **Why each:** *Engine* — ECL routes (`/api/enterprise-entities`, relationships, graph, import, applicability) + the in-process connector-sync/writeback/applicability-reassessment workers. *App* — "Context" nav + `/assets/new` ECL affordances + `/assets/[id]` graph link + ECL proxy.
- **Redeploy/restart:** Yes, Engine + App; no rebuild.
- **Default:** `"false"`.
- **Staging order:** migrations → `securelogic-engine-staging` → `securelogic-app-staging`.
- **Production order:** GATE B (do **not** enable until AD-17 grant + edge-cap H1 + graph load-test H2) → engine → app.
- **Validation:** `GET /api/enterprise-entities`→200; "Context" nav appears; enterprise-context tracker validation.
- **Rollback:** `"false"` on both; ECL routes 404; connector + citation sub-features go dark with it.
- **Dependencies:** Prerequisite for connectors, brief citations, and the applicability workflow.

### 1.3 `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED`
- **Purpose:** Canonical Intelligence Events — the hourly pipeline projects global `cyber_signals` into deduplicated events; engine serves `/api/intelligence-events`.
- **Required services:** **Engine + Intelligence Worker.**
- **Why each:** *Intelligence Worker* — `runPipeline` performs the signal→event projection. *Engine* — `/api/intelligence-events` routes + event stores (`intelligenceEventStore`, `eventFindingStore`, `eventBriefSource`, `eventLifecycleWorkflow`).
- **Redeploy/restart:** Yes, Engine + Intelligence Worker; no rebuild.
- **Default:** `"false"` (×4 ingestion services).
- **Staging order:** migrations `20260822`–`20260826` → set on `securelogic-intelligence-worker-staging` **and** `securelogic-engine-staging` → run pipeline.
- **Production order:** GATE B → prod intelligence-worker first → prod engine.
- **Validation:** run the hourly pipeline (or trigger); confirm same-CVE signals collapse to one event (`source_count > 1`). See `intelligence-events-enable-rollback.md`.
- **Rollback:** `"false"` on both → pipeline stops projecting (zero DB access), routes 404.
- **Dependencies:** None hard; **App does not read it** (backend-only).

### 1.4 `SECURELOGIC_RISK_INTELLIGENCE_ENABLED`
- **Purpose:** ERIP E3 — graph-aware risk intelligence (risk propagation, Executive dashboard, risk-history snapshots).
- **Required services:** **Engine + App.**
- **Why each:** *Engine* — `/api/assets/:id/risk-propagation` + the in-process `riskHistoryWorker`. *App* — "Executive" nav + `/executive` page.
- **Redeploy/restart:** Yes, Engine + App; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine → app (with `ASSET_REGISTRY` already on).
- **Production order:** GATE B → engine → app.
- **Validation:** `GET /api/assets/:id/risk-propagation`→200; "Executive" nav + `/executive` render.
- **Rollback:** `"false"` on both.
- **Dependencies:** **`ASSET_REGISTRY`** (the risk-history worker double-gates on both).

### 1.5 `SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED` (ERIP E2.P1)
- **Purpose:** Scheduled (cron-interval) connector sync loop.
- **Required services:** **Engine** only (`connectorScheduledSyncFlag` gates the in-process scheduled-sync loop).
- **Why:** The connector-sync worker runs in the engine; this flag turns the *scheduled* trigger on (manual sync works without it).
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** after `ENTERPRISE_CONTEXT` + `ASSET_REGISTRY` → engine.
- **Production order:** GATE B → engine.
- **Validation:** configure a connector; confirm sync fires on its interval (sync-summary counters advance across cycles).
- **Rollback:** `"false"` → scheduled trigger stops; manual sync + configs persist.
- **Dependencies:** **Triple-fence — `ENTERPRISE_CONTEXT` AND `ASSET_REGISTRY` AND this.**

### 1.6 `SECURELOGIC_CONNECTOR_WRITEBACK_ENABLED` (ERIP E2a)
- **Purpose:** Bidirectional connector writeback (the only external-**mutation** path; ServiceNow reference adapter).
- **Required services:** **Engine** only (`connectorWritebackWorker` in-process + `connectorWritebackFlag`).
- **Why:** Writeback worker + route run in the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** after ECL + asset-registry → engine.
- **Production order:** GATE B → engine.
- **Validation:** enqueue a writeback intent; confirm `/api/connectors/:id/writeback` processes.
- **Rollback:** `"false"` → external mutations stop immediately.
- **Dependencies:** **`ENTERPRISE_CONTEXT` AND `ASSET_REGISTRY`** (the mutation fence).

### 1.7 `SECURELOGIC_PREDICTIVE_INTELLIGENCE_ENABLED` (ERIP E5)
- **Purpose:** Explainable forecasting (features → OLS+Holt forecasts + inference).
- **Required services:** **Engine** only (`predictiveIntelligenceFeatureFlag` + in-process `predictiveForecastWorker`).
- **Why:** Forecast worker + predictive routes run in the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine (with `ASSET_REGISTRY` on).
- **Production order:** GATE B → engine.
- **Validation:** confirm the forecast worker emits predictions; predictive overlay on the risk routes.
- **Rollback:** `"false"`.
- **Dependencies:** **`ASSET_REGISTRY`** (worker self-gates on both).

### 1.8 `SECURELOGIC_KNOWLEDGE_GRAPH_ENABLED` (ERIP E7)
- **Purpose:** Knowledge graph / blast-radius + NL graph querying.
- **Required services:** **Engine** only (`knowledgeGraphFeatureFlag` → `/api/graph/blast-radius/:assetId`, `/api/graph/ask`).
- **Why:** Graph routes run in the engine; **App does not read it**.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine.
- **Production order:** GATE B → engine.
- **Validation:** `GET /api/graph/blast-radius/:assetId`→200; `POST /api/graph/ask` returns a grounded answer.
- **Rollback:** `"false"`.
- **Dependencies:** Best with `ASSET_REGISTRY` + `ENTERPRISE_CONTEXT` populated (graph substrate), but the flag itself is independent.

### 1.9 `SECURELOGIC_AUTONOMOUS_OPERATIONS_ENABLED` (ERIP E6)
- **Purpose:** Approval-gated orchestration (playbooks + executors; **human approval required**, never auto-executes).
- **Required services:** **Engine** only (`autonomousOperationsFeatureFlag` + in-process `orchestrationPlaybookWorker`).
- **Why:** Orchestration ledger + executor run in the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine.
- **Production order:** GATE B → engine.
- **Validation:** instantiate a playbook; confirm it enters the approval ledger and does **not** execute without approval.
- **Rollback:** `"false"`.
- **Dependencies:** None hard; approval gate is intrinsic (not a flag).

### 1.10 `SECURELOGIC_CAPABILITY_GATING_ENABLED` (EAR P9)
- **Purpose:** Core-domain premium **dual-gate** — a 403 may be overridden by a per-org `organizations.core_platform_capability=TRUE` grant.
- **Required services:** **Engine** only.
- **Why:** Mounted on the premium gates of the core-domain routes.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (flag off → byte-identical entitlement behavior, zero DB access).
- **Staging order:** engine (grants written per-org via SQL as needed).
- **Production order:** GATE B → engine. **Removing the entitlement leg is a product STOP GATE, never this flag.**
- **Validation:** with no grants, denials are byte-identical; `UPDATE organizations SET core_platform_capability=TRUE` admits that org.
- **Rollback:** `"false"` (grants persist inert).
- **Dependencies:** Independent; grants are per-org data, not a flag.

### 1.11 `SECURELOGIC_BRIEF_APPLICABILITY_CITATION_ENABLED` (EAR P11)
- **Purpose:** Intelligence Brief items carry `applicability_citations` (current per-target decisions).
- **Required services:** **Engine** only.
- **Why:** Attached at Brief serve time (`briefApplicabilityCitations`).
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine (with `ENTERPRISE_CONTEXT` on).
- **Production order:** GATE B → engine.
- **Validation:** for an org with decisions, `GET /api/intelligence-briefs/:id` items carry citations; fail-open (citation errors never 500 the Brief).
- **Rollback:** `"false"` → responses byte-identical to pre-flag.
- **Dependencies:** **Double-fence — `ENTERPRISE_CONTEXT`.**

### 1.12 `SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED` (ECL R2/S6)
- **Purpose:** Applicability workflow-recommendation dispatcher.
- **Required services:** **Engine** only.
- **Why:** Dispatcher path in the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"`.
- **Staging/Production order:** after `ENTERPRISE_CONTEXT` → engine (GATE B for prod).
- **Validation:** applicability decisions dispatch workflow recommendations.
- **Rollback:** `"false"`.
- **Dependencies:** **`ENTERPRISE_CONTEXT`.**

### 1.13 `SECURELOGIC_RISK_LIFECYCLE_ENABLED` (Epic R1)
- **Purpose:** Risk lifecycle state machine (risk register transitions).
- **Required services:** **Engine + App.**
- **Why each:** *Engine* — lifecycle routes. *App* — risk lifecycle UI affordances.
- **Redeploy/restart:** Yes, Engine + App; no rebuild.
- **Default:** `"false"`.
- **Staging order:** engine → app.
- **Production order:** GATE B → engine → app.
- **Validation:** risk lifecycle transitions available on `/risks`.
- **Rollback:** `"false"` on both.
- **Dependencies:** Optional companion `RISK_LIFECYCLE_NOTIFICATIONS` (below).

### 1.14 `SECURELOGIC_SIGNAL_SANITIZE_ENABLED` (IQP Q1)
- **Purpose:** HTML/entity/markdown-artifact sanitization of customer-facing intelligence text at the canonical normalization boundary (`normalizeSignal` stored summary + brief-item title/summary derivation). Fixes Phase 1 audit defect #3 (literal `<b>`/`&nbsp;` visible to customers).
- **Required services:** **Engine only** (the intelligence-worker KEV poller reuses the same canonical normalizer — set it there too if that service runs with its own env).
- **Why:** all live signal INSERT paths and brief generation run on the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; flag-off byte-identical).
- **Staging order:** engine-staging → validate (new `normalized_summary` rows + brief item titles/summaries carry no tag/entity artifacts).
- **Production order:** after staging validation passes IQP exit gate G1 → engine.
- **Validation:** ingest an HTML-bearing fixture feed item in staging; confirm stored summary and rendered brief text are plain.
- **Rollback:** `"false"` (new rows revert to raw pass-through; already-sanitized rows stay clean).
- **Dependencies:** None. Ledger: `docs/validation/iqp-operator-ledger.md` OP-1.

---

## 2. Tier B — Live and operational flags

**Live (`"true"` in render.yaml — already enabled in prod):**

| Flag | Purpose | Required services | Why | Default | Restart | Dependencies |
|---|---|---|---|---|---|---|
| `SECURELOGIC_ACTION_ENGINE_ENABLED` | Idempotent action writes (item 1, free) | Engine | Action-engine writes in matcher fan-out | `"true"` (live) | Engine | — |
| `SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED` | Suggest-only fuzzy vendor match (item 3, free) | Engine | Matcher suggestion path | `"true"` (live) | Engine | — |
| `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` | LLM control matcher (item 2, **paid**, suggest-only) | Engine | Matcher fan-out LLM branch | `"true"` (live) | Engine | LLM key |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | Vendor assurance / SOC upload + analysis (Vendor Management) | App + Engine | Engine assurance routes; app upload UI | `"true"` (live) | Engine + App | — |

**Operational / peripheral (default OFF — `"false"` or code-default when absent from render.yaml):**

| Flag | Purpose | Required services | Default | In render.yaml? | Dependencies |
|---|---|---|---|---|---|
| `SECURELOGIC_PLATFORM_TRIAL_ENABLED` | Platform trial gating | Engine | `"false"` | yes | — |
| `SECURELOGIC_BRIEF_CATCHUP_ENABLED` | Missed-send Brief catch-up | Engine | `"false"` | yes | — |
| `SECURELOGIC_RISK_LIFECYCLE_NOTIFICATIONS_ENABLED` | Risk lifecycle notifications | Engine | off (code-default) | no | `RISK_LIFECYCLE` |
| `SECURELOGIC_MATCHER_ALERTS_ENABLED` | Matcher real-time alerts | Engine | off (code-default) | no | — |
| `SECURELOGIC_DAILY_DIGEST_ENABLED` | Daily digest send | Engine | off (code-default) | no | — |
| `SECURELOGIC_LEGACY_NEWSLETTER_ENABLED` | Legacy newsletter path | Engine + Intelligence Worker | off (code-default) | no | — |
| `SECURELOGIC_SIGNAL_CLUSTERING_ENABLED` | Signal clustering in processing | Engine | off (code-default) | no | — |
| `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED` | Source qualification in processing | Engine | off (code-default) | no | — |
| `SECURELOGIC_EXPORT_EMAIL_ENABLED` | Email export delivery | Engine | off (code-default) | no | — |
| `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED` | Industry template packs | App + Engine | off (code-default) | no | — |
| `SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED` | GDPR Art. 17 erasure reaper | Engine | off (code-default) | no | — |
| `SECURELOGIC_BRIEF_PROVENANCE_ENABLED` | Brief provenance writes | Engine | off (code-default) | no | pairs with citations |
| `SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED` | Brief→Platform upgrade credit | Engine | off (code-default) | no | — |

> **Restart for all Tier-B flags:** runtime env → restart the listed service(s) on
> change; no rebuild. **Validation/rollback** follow the same pattern: enable on the
> listed service → exercise the feature's endpoint/UI → set back to `"false"` (or
> unset) to revert. Tier-B "code-default-only" flags are **absent from render.yaml**,
> so they are OFF everywhere unless an operator adds the env explicitly.

---

## 3. Global enablement principles

1. **Staging first, always.** Never set a dark flag in prod before the same
   sequence is green in staging.
2. **Two-switch flags (Engine + App)** — `ASSET_REGISTRY`, `ENTERPRISE_CONTEXT`,
   `RISK_INTELLIGENCE`, `RISK_LIFECYCLE`, `VENDOR_ASSURANCE`, `INDUSTRY_TEMPLATES`:
   set the engine half in `render.yaml`/dashboard and the app half in the Render
   dashboard for `securelogic-app-staging`. Each side **fails closed
   independently** — no split-brain; order between them does not matter.
3. **Restart, not rebuild.** Saving an env var in Render redeploys/restarts the
   service, which is sufficient (the app reads flags server-side, not
   `NEXT_PUBLIC`). Wait for the service to report **Live** before validating.
4. **GATE B.** Every Tier-A flag is dark in production and must not be enabled
   there without an explicit operator ruling. This document does not enable
   anything.
5. **Fencing graph (enable in this dependency order):**
   ```
   ENTERPRISE_CONTEXT ──┐
                        ├─► connectors (/assets/connect, sync)  ── + CONNECTOR_SCHEDULED_SYNC (scheduled)
   ASSET_REGISTRY ──────┤                                        ── + CONNECTOR_WRITEBACK (mutation)
                        ├─► RISK_INTELLIGENCE ─► risk-history worker
                        └─► PREDICTIVE_INTELLIGENCE ─► forecast worker
   ENTERPRISE_CONTEXT ─► BRIEF_APPLICABILITY_CITATION ; APPLICABILITY_WORKFLOW
   (independent) KNOWLEDGE_GRAPH ; AUTONOMOUS_OPERATIONS ; CAPABILITY_GATING ;
                 INTELLIGENCE_EVENTS (engine + intel-worker)
   ```

---

## 4. Summary funnel — Feature ↓ Required Services ↓ Validation Order

| Feature (flag) | ↓ Required Services | ↓ Validation Order |
|---|---|---|
| **Asset Registry** (`ASSET_REGISTRY`) | Engine → App | `GET /api/assets` 200 → nav "Asset Registry" → create/import/connect on `/assets/new` |
| **Enterprise Context** (`ENTERPRISE_CONTEXT`) | Engine → App | `GET /api/enterprise-entities` 200 → "Context" nav → applicability |
| **Intelligence Events** (`INTELLIGENCE_EVENTS`) | Intelligence Worker + Engine | pipeline run → dedup event (`source_count>1`) → `/api/intelligence-events` |
| **Risk Intelligence** (`RISK_INTELLIGENCE`) | Engine → App *(needs ASSET_REGISTRY)* | risk-propagation route 200 → "Executive" nav/page |
| **Connector Scheduled Sync** (`CONNECTOR_SCHEDULED_SYNC`) | Engine *(needs ECL+ASSET)* | configure connector → interval sync counters advance |
| **Connector Writeback** (`CONNECTOR_WRITEBACK`) | Engine *(needs ECL+ASSET)* | enqueue intent → `/api/connectors/:id/writeback` processes |
| **Predictive Intelligence** (`PREDICTIVE_INTELLIGENCE`) | Engine *(needs ASSET)* | forecast worker emits predictions |
| **Knowledge Graph** (`KNOWLEDGE_GRAPH`) | Engine | `/api/graph/blast-radius/:id` 200 → `/api/graph/ask` |
| **Autonomous Operations** (`AUTONOMOUS_OPERATIONS`) | Engine | playbook → approval ledger (no auto-execute) |
| **Capability Gating** (`CAPABILITY_GATING`) | Engine | grant → org passes core-domain gate |
| **Brief Applicability Citations** (`BRIEF_APPLICABILITY_CITATION`) | Engine *(needs ECL)* | brief item carries citations (fail-open) |
| **Applicability Workflow** (`APPLICABILITY_WORKFLOW`) | Engine *(needs ECL)* | decision dispatches workflow recommendation |
| **Risk Lifecycle** (`RISK_LIFECYCLE`) | Engine → App | risk transitions on `/risks` |
| **Vendor Assurance** (`VENDOR_ASSURANCE`, live) | Engine + App | SOC upload + analysis under Vendor Management |
| *Live matcher flags* (`ACTION_ENGINE`, `FUZZY_VENDOR_MATCH`, `LLM_CONTROL_MATCHER`) | Engine | matcher fan-out behavior (already live) |
| *Peripheral* (trial, brief-catchup, digest, newsletter, clustering, source-qual, export-email, industry-templates, deletion-reaper, brief-provenance/credit, risk-lifecycle-notifications, matcher-alerts) | Engine (+ Intel-Worker for newsletter; + App for industry-templates) | enable on listed service → exercise feature endpoint/UI |

**Bottom line:** App = only the 3 nav flags (+vendor-assurance/industry-templates/risk-lifecycle page reads). Intelligence Worker = only `INTELLIGENCE_EVENTS` and `LEGACY_NEWSLETTER`. **Everything else is the Engine service** (its API routes and its in-process workers). No feature flag requires the posture, data-rights, or vendor-extraction workers.
