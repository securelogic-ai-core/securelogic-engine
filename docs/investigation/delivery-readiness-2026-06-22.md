# Delivery-Readiness Audit — Soft-Launch Gating Doc

> ## ⏫ 2026-07-01 REFRESH — this section SUPERSEDES the 2026-06-22 audit below
>
> The original audit (dated 2026-06-22, commit `90e9863e`) was written **immediately
> before** the GAP-3 action-recommendation work landed. Several of its Section 2 / Section 3
> gaps have since been closed and are verified live on `main`. The 2026-06-22 body is
> **retained unedited below as history**, with inline `SUPERSEDED 2026-07-01` markers on the
> specific claims that changed. Where a claim is *not* marked, it still stands.
>
> **Verified changes since 2026-06-22 (method unchanged — the generator was found, not just the table):**
>
> - **Action-recommendation engine — SHIPPED (supersedes §2c and §3c).** `actionRecommendationEngine.ts`
>   exists and is wired into `cyberSignalProcessingService.ts` and `controlAssessments.ts`,
>   flag `SECURELOGIC_ACTION_ENGINE_ENABLED="true"` on every engine block. Generators live on
>   `main`: **finding→action** (#276), **risk→action** (#285), **failed-control-assessment→action**
>   (#291). The blanket "actions is pure manual CRUD / nothing creates a task" claim in §2c no
>   longer holds. *Not yet built:* obligation→action and critical-posture→action (two of the four
>   §3c generators) — do not advertise regulatory-obligation-driven task creation yet.
>
> - **Entitlement gating — rank-2 leak CLOSED.** Platform-wide **rank-2 → rank-4** gate flip
>   (#245) plus the caps audit (#284). Paid platform surfaces (vendor risk, AI governance)
>   now gate at rank-4/premium rather than leaking to rank-2 Brief tiers.
>
> - **GDPR data export — fully wired end-to-end.** Request → `dataRightsWorker.ts` →
>   R2 bundle via `createDataExportWriteStream` (`dataExportStorage.ts`) → `sendExportReadyEmail`
>   (`exportReadyEmail.ts`, worker `:244`) with a single-use `dataExportDownloadToken`. The
>   `securelogic-data-rights-worker` is deployed (`render.yaml`, prod + staging). The
>   2026-06-18 "inert until an email sender exists" caveat is resolved.
>
> - **Postgres RLS — on `main` but INERT. Do NOT market as "RLS-enforced".** The A04-G1
>   row-level-security policies are committed, but the engine's `DATABASE_URL` still connects as
>   the table-owner role (RLS is bypassed for owners) — the cutover to the `app_request` role is
>   unshipped. Tenant isolation today is enforced by **explicit application-level org-scoping**
>   (`withTenant` / route code + the cross-org-isolation CI gate), not by the database. Marketing
>   may say "strict per-tenant isolation," **not** "database-enforced row-level security."
>
> - **Pricing — canonical is the 2026-06-30 lock.** Brief Pro **$49/mo** · Team Professional
>   **$199/mo** (up to 6 members) · Platform Professional **$600/mo billed annually**
>   ($7,200/yr founding rate through Dec 2026) or **$800/mo** month-to-month · Enterprise
>   **Custom**. Source of truth: `website/src/lib/pricing.ts`. **The "$279" figure is dead** —
>   it was a June-22 provisional Team price that was **never committed** to code or docs; a
>   repo-wide grep finds zero occurrences. Any external note quoting "$199 → $279" is void.
>
> **Still accurate from the 2026-06-22 body:** §1a–§1d (signal currency, AI-enriched Brief,
> live posture, vendor/AI-system suggested matching) and §2a/§2b (controls/obligations still have
> no signal-*link* generator; matching is still name-ILIKE, suggestion-queue not automatic).
>
> ---

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
> **SUPERSEDED 2026-07-01.** An action-recommendation engine now exists and is live
> (`actionRecommendationEngine.ts`; generators finding→action / risk→action /
> failed-control-assessment→action, #276/#285/#291). The claims below held on 2026-06-22 but
> no longer describe `main`. Obligation→action and critical-posture→action remain unbuilt.
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
> **DONE 2026-07-01 (partial).** The engine shipped to `main`: finding→action (#276),
> risk→action (#285), failed-control-assessment→action (#291), wired through
> `cyberSignalProcessingService.ts` / `controlAssessments.ts` and flag-enabled. **Remaining**
> from the original list: obligation→action and critical-posture→action are not yet built.
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
