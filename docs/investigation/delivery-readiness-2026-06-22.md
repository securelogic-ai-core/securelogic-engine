# Delivery-Readiness Audit — Soft-Launch Gating Doc

**Date:** 2026-06-22
**Scope:** Read-only delta audit of the four chained capability promises in our advertised
positioning, verified against current `develop`. Method rule: distinguish "a route/table
exists" from "a process actually produces the data" — find the *generator*, not the storage.

This doc gates marketing copy for soft launch. Section 1 is what we can stand behind today.
Section 2 is copy that overstates current capability and **must be softened until the
Section 3 build list lands**.

> **Evidence basis.** Claims below cite worker code + deployment wiring (`render.yaml`),
> not route existence. What was **not** verified: live-DB row freshness/counts (no prod DB
> access). Where a claim rests on "the scheduled generator is deployed" rather than "I saw
> recent rows," it is marked.

---

## 1. What we CAN honestly advertise today

### 1a. Curated threat + regulatory signal currency — LIVE
- `services/intelligence-worker/` is a **deployed Render worker** — `render.yaml:293`
  (prod) / staging block — `startCommand: node …/scheduler.js`.
- Runs `runPipeline()` hourly + `kevPoller` every 15 min (KEV fast-cadence).
- `runPipeline.ts:89` `bridgeSignalsToCyberSignals()` INSERTs global `cyber_signals`
  rows (dedup-guarded). Hourly feeds: CISA KEV, NVD, threat-intel RSS
  (BleepingComputer / Krebs / SANS), regulatory (NIST / FTC).
- **Caveat:** CISA alerts + MITRE ATT&CK / ATLAS are **manual-route-only** (not in the
  hourly loop). Do not advertise live MITRE currency without confirming.
- **Caveat:** verified the scheduled generator is deployed, not that rows are hours-old
  today. Confirm with one ops query: `MAX(created_at)` per source on `cyber_signals`.

### 1b. AI-enriched Intelligence Brief — LIVE (brief surface only)
- `enrichItemWithClaude()` (`src/api/lib/intelligenceBriefGenerator.ts:858`) produces
  `analysis`, `why_it_matters`, `recommended_actions`, `urgency` via the Claude API.
- Wired into the daily brief run: `enrichBriefItems()`
  (`intelligenceBriefGenerator.ts:1065`) called from `briefScheduler.ts:17`.
- **Scope boundary (see §2):** enrichment lives on `intelligence_brief_items`, **not** on
  the `cyber_signals` row — it backs the Brief output, nothing else.
- **Fragility:** requires `ANTHROPIC_API_KEY` on the worker; absent it, enrichment falls
  back to template content (degraded, not enriched). Historically the first thing to break
  on credit exhaustion.

### 1c. Live posture score — LIVE (and auto-refreshed)
- Computed from **live** org data — findings, open risks (residual_rating), active-vendor
  criticality as synthetic signals, action counts — via `DomainRiskAggregationEngineV2` /
  `OverallRiskAggregationEngineV2` (`postureComputation.ts:138`,
  `postureSnapshot.ts:60-326`). Returns **null** ("insufficient data") when no signals —
  not sample constants.
- **Auto-refreshed every 6 h per active org** by the deployed `services/posture-worker/`
  (`render.yaml:427`; `index.ts:5,10,28,87` — "every active organisation every 6 hours,"
  not flag-gated).

### 1d. Vendor + AI-system risk-connection — LIVE (suggested model)
- The generator exists, is automatic, and is scheduled: `runMatcherForSignal()`
  (`cyberSignalProcessingService.ts:209`) runs via worker fan-out on **every ingest cycle,
  across every active org** — `runPipeline.ts:195 fanOutMatcherToActiveOrgs`
  (`runMatcherForSignal(signal, org.id)` at `:258`) + the KEV poller's `fanOutKevMatcher`.
- On a vendor/AI-system name match it auto-writes (one tx): a `signal_match_suggestions`
  row (`:420`), a `findings` row (Phase 3a), and auto-flags `risks.exposure_flagged`
  by domain (Phase 5).
- Advertise as: **"new threat signals are automatically matched to your vendors and AI
  systems and surfaced for review."** The durable link is created on acceptance — the match
  and the finding are automatic.
- Empty tables here are **empty-because-no-customer** (no active orgs with matching-named
  vendors), not empty-because-unbuilt.

---

## 2. Claims that OVERSTATE current capability — soften in copy until built

### 2a. "Connect signals to your controls and obligations" — NOT delivered
- The matcher **only emits `target_type "vendor" | "ai_system"`**
  (`cyberSignalProcessingService.ts:371`; branch enum `vendor_name_ilike |
  ai_system_name_ilike | no_match`).
- `signal_control_links` and `signal_obligation_links` have **no generator** — they are
  **manual-`POST`-only**. These tables are empty-because-**unbuilt**, not no-customer.
- **Copy fix:** drop controls/obligations from the auto-connection claim. Vendor + AI
  system only.

### 2b. "Automatically connect" / "auto-linked" — actually SUGGESTED + crude match
- The persistent `signal_*_links` row is created only on `POST /accept` (or manual POST) —
  it is a **human-in-the-loop suggestion queue**, not automatic linking.
- Matching is **name-`ILIKE` only** (`:250` vendor name, `:278` ai_system name) — no
  CPE / identifier / semantic matching. Real-world hit rate depends on a vendor's stored
  name appearing as a substring in the feed text.
- **Copy fix:** say **"suggested matches you review and accept,"** not "automatically
  connected." Don't imply identifier-grade precision.

### 2c. "Know what to do next" — NO action-recommendation engine
- `actions` is **pure manual CRUD** (`actions.ts`: `POST` creates, `PATCH` updates). No
  process reads posture gaps, failed assessments, overdue items, unlinked signals, or new
  obligations to emit actions. The matcher creates **findings** and flags **risks** —
  **never actions**.
- Prioritization is a **static sort** (priority → due_date → created_at); no risk-driven
  ranking.
- The tagline "a new AI reg creates a governance task" fails twice: (a) obligation/
  regulatory signals don't match to obligations at all (§2a), and (b) nothing creates a
  task/action.
- **Copy fix:** "what matters" (posture) is real; remove or soften "tells you what to do
  next" until §3c lands. Frame actions as a tracker the user populates.

---

## 3. Build list to close each gap

### 3a. Control / obligation matcher branch (closes §2a)
Add matcher branches in `runMatcherForSignal` (`cyberSignalProcessingService.ts:209-492`)
that match signals to controls and obligations (e.g. framework-tag / keyword matching) and
emit `target_type "control" | "obligation"` suggestions, so `signal_control_links` and
`signal_obligation_links` get a generator instead of manual-only population.

### 3b. CPE / identifier matching + optional auto-accept threshold (closes §2b)
Replace name-`ILIKE` (`:250`, `:278`) with CPE / vendor-identifier matching to lift
precision and hit rate. Optionally add an auto-accept policy above a confidence threshold so
high-confidence matches become real links without a click — the only path to a truthful
"automatic" claim.

### 3c. Action-recommendation engine (closes §2c)
Build the engine that reads posture (`postureSnapshot.ts`), open findings/risks, failed
control assessments, and obligations, and writes `actions` rows with `source_type` /
`source_id`. Generators to ship: obligation→action, failed-assessment→action,
critical-posture→action, high-score-suggestion→action. This is what turns "what matters"
into "what to do next."

---

## 4. Method note — sub-agent blind spots corrected

The parallel investigation initially produced two **false "ASPIRATIONAL" calls** because two
probes scoped only to `src/api/` and **missed the `services/` worker tier**:

- **Cross-domain linking** was reported "no worker / global-signal fan-out aspirational."
  **Corrected:** `services/intelligence-worker/src/pipeline/runPipeline.ts:89,195,258`
  bridges feed signals into global `cyber_signals` and fans `runMatcherForSignal` out per
  active org — deployed at `render.yaml:293`. The vendor/AI-system generator is **live**,
  not absent (§1d).
- **Posture** was reported "weekly-Monday only, no daily auto-trigger."
  **Corrected:** `services/posture-worker/src/index.ts:5,87` snapshots every active org
  **every 6 hours** — deployed at `render.yaml:427` (§1c).

Lesson for future audits: **search `services/` workers, not just `src/api/` routes**, before
classifying a capability inert.
