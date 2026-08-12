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
2. **`securelogic-app-staging` is now defined in `render.yaml`** (a `type: web`,
   `branch: develop`, `region: virginia` service; added 2026-07-10). It declares the
   four app feature flags at `"false"` and every secret/URL as `sync: false` (staging
   values set on the service in the dashboard — never prod). **Adoption caveat:** a
   dashboard-managed `securelogic-app-staging` predated this entry; because Render
   Blueprints match services **by name**, a sync **adopts** that existing service
   rather than creating a duplicate — the operator must reconcile it (operator ledger
   **L-4**) before/at sync. No `domains:` are declared, so it keeps its unique
   Render-assigned URL (no domain collision). Set the app-side flags to `"true"` on
   this service for staging validation.
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
- **Staging order:** migrations (Step 0) → `securelogic-engine-staging` → `securelogic-app-staging` (IaC service; set flags on the service).
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
- **Staging order:** migrations → `securelogic-engine-staging` → `securelogic-app-staging` (IaC service).
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

### 1.15 `SECURELOGIC_SIGNAL_RECENCY_ENABLED` (IQP Q2)
- **Purpose:** Source-authoritative recency enforcement on the customer-facing brief window — filters on `COALESCE(published_at, ingestion_timestamp)` so old-dated items (ancient KEV entries, historical backfill) are suppressed. Fixes Phase 1 audit defect #4 (CVE-2008-4250 as "this week"). Writing `published_at` is unconditional; only READS are gated.
- **Required services:** **Engine only.**
- **Why:** both brief-window queries (scheduler + on-demand route) run on the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; flag-off byte-identical legacy window).
- **Staging order:** migration `20260828` (adds `published_at` + backfill) → engine-staging flag → validate (`stale_signal_suppressed` log > 0 when old-dated rows are in the ingestion window; no pre-window `published_at` item in the brief).
- **Production order:** after staging validation passes IQP exit gate G2 → migration → engine.
- **Validation:** generate a staging brief; confirm no item's `published_at` predates the window.
- **Rollback:** `"false"` (legacy ingestion-time window returns; column stays, unread).
- **Dependencies:** Migration `20260828_cyber_signals_published_at.sql` applied first. Backfill-safe: old dates only ever REMOVE rows from the window. Ledger: OP-2/OP-3.

### 1.16 `SECURELOGIC_BRIEF_RELEVANCE_ENABLED` (IQP Q3)
- **Purpose:** INTERIM org-relevance + classification guard on the customer-facing brief. (a) `third_party_breach` items (the EDGAR shape) render only on a canonical match to an ACTIVE org vendor — the matcher's own `canonicalizeVendorName` comparison; (b) `regulatory` items without regulatory-intent content re-bucket to `general`. Fixes Phase 1 audit defects #5a/#5b. NOT the applicability engine (EAR scope).
- **Required services:** **Engine only.**
- **Why:** both brief-source sites (scheduler + on-demand route) and the pure category refinement run on the engine.
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; flag-off byte-identical brief).
- **Staging order:** engine-staging → validate (an unmonitored-filer `third_party_breach` fixture is absent from the generated brief and `irrelevant_signal_suppressed` logs; a news-shaped regulatory item renders under General, a rulemaking item stays under Regulatory & Compliance).
- **Production order:** after staging validation passes IQP exit gate G3 → engine.
- **Validation:** generate a staging brief with mixed fixtures; check the two behaviors above.
- **Rollback:** `"false"` (legacy ungated brief returns).
- **Dependencies:** None (independent of Q1/Q2 flags; all three compose). Ledger: OP-4.

### 1.17 `SECURELOGIC_BRIEF_QUALITY_ENABLED` (IQP Q4)
- **Purpose:** Title/summary quality contract on customer-facing brief items: (1) titles cap at 120 chars on a word/sentence boundary via `contentQuality.trimToSentence` (no mid-word cut, no literal `...`); (2) normalizer-derived summaries end on whole sentences; (3) a summary that restates its title is replaced by a deterministic entity-synthesized executive line; (4) duplicate titles across one brief collapse. Fixes Phase 1 audit defects #1/#2 and satisfies gate G2/G3 of the quality contract.
- **Required services:** **Engine only** (set on the intelligence-worker too if it runs its own env — it shares the canonical normalizer).
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; flag-off byte-identical, incl. the legacy 77-char `...` cut).
- **Staging order:** engine-staging → validate (no brief title ends in a bare `...` or mid-word cut; no item where summary == title; no two items share a title).
- **Production order:** after staging validation passes IQP exit gate G4 → engine.
- **Validation:** generate a staging brief from mixed fixtures incl. an over-long headline and a summary==title feed item.
- **Rollback:** `"false"` (legacy truncation/output returns).
- **Dependencies:** None (composes with §1.14–1.16). Ledger: OP-5.

### 1.18 `SECURELOGIC_ENRICHMENT_RELIABILITY_ENABLED` (IQP Q5)
- **Purpose:** Enrichment reliability guard + alerting — the April-incident detectors. When ON: (1) a degraded enrichment batch (≥50% template fallback) fires `brief_enrichment_degraded`; (2) an Anthropic auth failure (401/403 — invalid/revoked key) fires `brief_enrichment_auth_failure` once per process; (3) the CVE-grounding guard (`signals/actionGrounding`, built after PR #25 but previously unwired) rejects enrichment responses citing CVEs absent from the source item → template fallback, never shipped. Per-item `enrichment_status` marking and the per-cycle `brief_enrichment_summary` log are ALWAYS on (pure telemetry, output-inert — the marker is stripped from `content_json`).
- **Required services:** **Engine only.**
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; enrichment output byte-identical to pre-Q5).
- **Staging order:** engine-staging → validate (see OP-7). Alerts additionally require `ALERT_WEBHOOK_URL` (inert without it — same contract as all alerting).
- **Production order:** after staging validation passes IQP exit gate G5 → engine.
- **Validation:** temporarily unset/inject an invalid `ANTHROPIC_API_KEY` in STAGING ONLY → next brief cycle logs `brief_enrichment_summary` with `fallback_rate: 1` and fires both alerts; restore the key → healthy summary at info.
- **Rollback:** `"false"` (guard + alerts off; telemetry log remains).
- **Dependencies:** `ANTHROPIC_API_KEY` valid (OP-6); `ALERT_WEBHOOK_URL` set for alerts to be visible. Ledger: OP-6/OP-7.

### 1.19 `SECURELOGIC_DECISION_WORKSPACE_ENABLED` (ERIP Package 3 — Decision Workspace)
- **Purpose:** Gates the Decision Workspace on `/findings/:id` (phases 3.0–3.2b) **and** the P3.3 surfaces: the `/intelligence/[id]` drill-through, the finding→event / Queue reciprocal links, the Remediation tab, and the `/actions`→**My Actions** redirect. Two-switch: the engine gates `GET /api/findings/:id/context` (404 while dark); the app gates the render (flag-off = byte-identical legacy detail + legacy org-wide `/actions` list).
- **Required services:** **Engine + App** (both must be ON for the workspace to render).
- **Redeploy/restart:** Yes, Engine + App; no rebuild (runtime var, not `NEXT_PUBLIC`).
- **Default:** `"false"` (OFF everywhere).
- **Drill-through dependency (P3.3, three-flag reality):** the **full** app experience additionally needs `SECURELOGIC_RISK_WORKSPACE_ENABLED` ON (the Queue reciprocal link lives in the "Review Suggested Links" reskin branch + the enterprise IA). The `/intelligence/[id]` drill-through renders from finding-context on `DECISION_WORKSPACE` alone, and **enriches** from the canonical event only when the pre-existing `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (§1.3) is ON — degrading honestly (finding-context, or an "unavailable" state) otherwise. It never re-gates or requires that flag.
- **Staging order:** engine-staging + app-staging (IaC service, flags set on the service) → validate per `docs/validation/decision-workspace-staging-validation.md` §P3.3. Optionally add `INTELLIGENCE_EVENTS` for the enriched drill-through.
- **Production order:** GATE B — after staging validation; not in scope for this package.
- **Isolation (R5):** My Actions ownership derives from the session identity, never request input.
- **Guarantee:** Intelligence Events remain **drill-through only** — no primary-nav entry, no `/intelligence` index route (enforced by `applicationKnowledgeIndex.test.ts`).
- **Rollback:** `"false"` on either service → legacy behavior restored (no data reversal; no migration in P3.3).

### 1.20 `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED` (Enterprise Risk Graph convergence — C3/C3b shadow)
- **Purpose:** DARK shadow that runs the new product→tenant-asset applicability
  resolution (Canonical Product → `ApplicabilityEngineV1` resolver) ALONGSIDE the legacy
  signal→vendor / →ai_system / →asset match and emits counts-only
  `signal_applicability_shadow` telemetry (with a `grain` field: asset/vendor/ai_system)
  to measure convergence. **Measure-only** — writes nothing to authoritative
  applicability / vendor links / ai-system links / findings / asset-registry records; the
  legacy linkage stays authoritative. See `docs/architecture/proposals/CONVERGENCE-REPORT.md`.
- **Required services:** **Engine only** (read in the matcher, `cyberSignalProcessingService`).
- **Sub-mode:** `SECURELOGIC_SIGNAL_APPLICABILITY_MODE` ∈ `shadow` (default) | `surface`
  (surface is **unbuilt** — reserved for a post-convergence, ratified cutover).
- **Redeploy/restart:** Yes, Engine; no rebuild.
- **Default:** `"false"` (OFF everywhere; strict `=== "true"`; **flag-off byte-identical** —
  verified by matcher regression + snapshot tests).
- **Staging order:** engine-staging → enable → run a representative ingestion window →
  aggregate the `signal_applicability_shadow` telemetry grouped by `grain`.
- **Production order:** **GATE B — untouched.** No production enablement; no cutover; no
  retirement of the legacy path without an explicit, ratified decision after convergence
  is measured.
- **Validation:** enable in staging; confirm `signal_applicability_shadow` events emit and
  no authoritative applicability/link/finding rows are written by the shadow.
- **Rollback:** `"false"` → shadow stops (it is try/catch-isolated and writes nothing, so
  rollback is immediate and lossless).
- **Dependencies:** reads the org's asset registry (best with `ENTERPRISE_CONTEXT` +
  `ASSET_REGISTRY` populated); degrades to `no_match`/`needs_review` otherwise. Introduced
  by ERG convergence C3 (PR #602) / C3b (PR #603).

### 1.21 `SECURELOGIC_SEAT_MODEL_ENABLED` (Enterprise Seat / Role / Scoped Authorization — PR #784)
- **Purpose:** gates ALL seat-model enforcement: the `requireSeat` middleware seam,
  Contributor scoping (`src/api/lib/contributorScope.ts`), Viewer-seat read-only (regardless
  of role), separately grantable export, seat-aware provisioning + SSO-JIT default seat,
  and API-key binding to the issuer's seat/role. OFF = legacy authorization, byte-identical
  (verified by the branch regression suite).
- **Required services:** **Engine only.** The App reads **no env var** — the UI consumes the
  resolved `seat` block on `GET /api/me` (`seat.enforced` tells the UI whether the model is
  live in this environment; the server remains authoritative).
- **Redeploy/restart:** Yes, Engine. The 2026-08-12 staging activation used explicit
  same-SHA API-triggered deploys after setting the env (per the EG2 Wave-1 env-injection
  incident: set the flag first, then deploy).
- **Default:** OFF — strict `=== "true"` read (`src/api/middleware/requireSeat.ts`).
  **Not declared in `render.yaml`** (known IaC drift): the staging value is dashboard-set,
  so a Blueprint sync will not carry or restore it. Declaring it `"false"` in IaC is an
  open follow-up.
- **Staging order:** migrations `20260915_enterprise_seat_model` → `20260916_sso_default_seat`
  → `20260917_viewer_export` → `20260918_api_key_seat_binding` (all additive) → set flag on
  `securelogic-engine-staging` → deploy.
- **Staging state (VERIFIED live 2026-08-12):** **ENABLED and enforcing.** Config `"true"`
  on `securelogic-engine-staging`; in-process `GET /api/me` returns `seat.enforced: true`
  with resolved scope; staging DB at 207 migrations with all four seat migrations applied
  (2026-08-12 02:45 UTC, 203 → 207).
- **Production order:** **GATE B — and additionally the code is NOT on `main`.** PR #784
  merged to `develop` after the #756 release cut; prod (`49691948`) predates the package,
  the prod flag is unset, and prod is at 203 migrations (no seat migrations). Prod
  enablement therefore requires a develop→main release (with its four migrations,
  migrate-before-merge) **before** any GATE B flag ruling.
- **Validation:** `GET /api/me` seat block (`seatType`/`role`/scopes/`capabilities`/`enforced`);
  deny paths: Contributor `POST /api/findings` → 403, Viewer writes → 403, ungranted
  `GET /api/findings/export.csv` → 403; API-key calls constrained to issuer seat/role.
- **Rollback:** unset / `"false"` + redeploy Engine → legacy authorization everywhere; the
  four migrations are additive and inert with the flag off (no destructive rollback needed).
- **Dependencies:** none of the other Tier-A flags — migrations only.

---

> **Note (app flag reads):** §0 row for the App lists the three *legacy* nav flags; the app also reads `SECURELOGIC_RISK_WORKSPACE_ENABLED` (Packages 1/2 nav + queue reskin) and `SECURELOGIC_DECISION_WORKSPACE_ENABLED` (§1.19) server-side.

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
| `SECURELOGIC_MATCHER_ALERTS_ENABLED` | Matcher real-time alerts (coalescing batcher; all 3 matcher invocation paths since EG2 slice 1) | Engine + Intelligence Worker — **flip both together** | `"false"` | yes (declared `"false"` ×4: engine + worker, prod + staging, since `f8384a4d`) | staging volume check first |
| `SECURELOGIC_SLA_ALERTS_ENABLED` | Daily SLA-breach sweep — one grouped email per owner, 8:15 UTC (EG2 slice 11) | Engine only (scheduler; the worker never reads it) | `"false"` | yes (declared `"false"`: engine prod + staging, since `f8384a4d`) | observe one staging sweep (`sla_breach_sweep_complete`) first |
| `SECURELOGIC_DAILY_DIGEST_ENABLED` | Daily digest send | Engine | off (code-default) | no | — |
| `SECURELOGIC_LEGACY_NEWSLETTER_ENABLED` | Legacy newsletter path | Engine + Intelligence Worker | off (code-default) | no | — |
| `SECURELOGIC_SIGNAL_CLUSTERING_ENABLED` | Signal clustering in processing | Engine | off (code-default) | no | — |
| `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED` | Source qualification in processing | Engine | off (code-default) | no | — |
| `SECURELOGIC_EXPORT_EMAIL_ENABLED` | Email export delivery | Engine | off (code-default) | no | — |
| `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED` | Industry template packs | App + Engine | off (code-default) | no | — |
| `SECURELOGIC_ACCOUNT_DELETION_REAPER_ENABLED` | GDPR Art. 17 erasure reaper | Engine | off (code-default) | no | — |
| `SECURELOGIC_BRIEF_PROVENANCE_ENABLED` | Brief provenance writes | Engine | off (code-default) | no | pairs with citations |
| `SECURELOGIC_BRIEF_PLATFORM_CREDIT_ENABLED` | Brief→Platform upgrade credit | Engine | off (code-default) | no | — |

> **Alert-flag enablement fence (EG2):** both alert flags follow staging-first with a
> specific staging gate — matcher alerts need the volume check on `[SEED] Walkthrough
> Org` (coalesced batch sizes, no per-finding storm) with the flag flipped on **engine
> and intelligence-worker together**; the SLA sweep needs one observed 8:15 UTC run
> (`sla_breach_sweep_complete`, then a second run sending nothing — ledger dedupe).
> Rollback for either = set back to `"false"` + restart; the sweep becomes a zero-DB
> no-op and the batcher goes silent. Assignment emails (same EG2 train) have **no
> flag** — they activate wherever the code deploys; rollback is revert.
>
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
   the `securelogic-app-staging` service (now IaC-defined). Each side **fails closed
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
