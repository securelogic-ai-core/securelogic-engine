# IQ-1 — Intelligence Quality Initiative: Implementation Plan

**Status:** PROPOSED — awaiting operator approval
**Date:** 2026-08-07
**Scope:** BR-1, BR-2, TR-5, TR-6 from `docs/product-experience/PRIVATE-BETA-UX-READINESS-BACKLOG.md`
**Objective:** Make the intelligence as trustworthy as the interface. EUX-1 Workspace 1
(PR #748) fixed what the `/briefs` surfaces *say*; IQ-1 fixes what the engine *produces*.
Further EUX-1 workspaces pause until IQ-1 lands.

**Out of scope:** any UI polish beyond the minimum display change each fix requires;
BR-3 (shipped in PR #748, UI side); new sources, new outputs, redesigns.

---

## 1. Current state (code-verified 2026-08-07)

Every claim below was read from the files cited. Nothing is inferred from docs alone.

### BR-2 — stale KEV entries presented as "this period" (Critical, release blocker)

The defect mechanism is a **default-off flag, not missing code**:

- KEV `dateAdded` survives only in `raw_payload` at the adapter
  (`src/api/lib/cisaKevAdapter.ts:152-175`), but the normalizer recovers it into
  `published_at` (`src/api/lib/cyberSignalNormalizer.ts:184-215`, `dateAdded` is the
  first-priority key), and the migration backfilled it
  (`db/migrations/20260828_cyber_signals_published_at.sql`).
- The brief window query branches on `signalRecencyEnabled()`
  (`src/api/lib/briefScheduler.ts:322-346`; duplicated in
  `src/api/routes/intelligenceBriefs.ts:162-199`). Flag ON →
  `COALESCE(published_at, ingestion_timestamp)` inside the 7-day window, with
  `stale_signal_suppressed` telemetry (`briefScheduler.ts:351-367`). **Flag OFF
  (default) → `ingestion_timestamp` only** — so a 2010 CVE ingested by the 15-minute
  KEV poller this week is "this period".
- The flag `SECURELOGIC_SIGNAL_RECENCY_ENABLED`
  (`src/api/lib/signalRecencyFeatureFlag.ts:29`) **does not appear in `render.yaml`**
  → OFF in staging and prod.

Secondary defect found while mapping: `briefScheduler.ts:718-732` calls
`fetchCisaKevSignals()` sharing one Redis ETag key with the 15-minute poller
(`kevPoller.ts`), and ignores `fromCache` — on the normal 304 path the weekly run
records `signals_fetched.cisa_kev = 0` and silently relies on the poller's global rows.

### BR-1 — twelve identical templated items (Critical, blocker for paid subscription)

The observed template ("face active exploitation risk at high severity…", "patch {CVE}
on internet-facing assets within this week") is the **LLM fallback path**, not the
primary path:

- `fallbackWhyItMatters` / `fallbackRecommendedActions` / `buildFallbackItem` —
  `src/api/lib/intelligenceBriefGenerator.ts:1064-1095, 1154-1167`. Fallback fires when
  `ANTHROPIC_API_KEY` is unset, on JSON-parse failure, Zod failure, or any thrown error,
  and stamps `enrichment_status: "fallback"`, `urgency: near_term` (`URGENCY_FALLBACK`,
  line 1105).
- The observed brief's signature — 12/12 near-term, 12/12 HIGH, one sentence shape —
  matches fallback exactly (near_term is the fallback urgency; HIGH is the KEV severity
  floor, `cisaKevAdapter.ts:160`). **Working hypothesis: production briefs are running
  ~100% fallback.** The degraded-cycle alert only fires at ≥50% fallback
  (`ENRICHMENT_DEGRADED_THRESHOLD`, line 1402) — and if it fired, nothing customer-facing
  changed.
- **Personalization never reaches cron-generated briefs.** The manual route calls
  `personalizeBriefItems` before synthesis and persists 19 columns
  (`src/api/routes/intelligenceBriefs.ts:261, 279-320`); the scheduler — the path that
  produces customer briefs — never imports it and inserts 17 columns
  (`src/api/lib/briefScheduler.ts:511-550`), so `is_personalized`/`platform_context`
  default to FALSE/NULL. This starves both BR-1's "write one real analysis for the item
  that touches this customer's inventory" **and the BR-3 matched-first UI shipped in
  PR #748**, which keys on exactly these fields.

### TR-5 — issue date one day off from its own title (High)

Two independently computed dates, never reconciled, rendered by unpinned formatters:

- Title date: computed at **generation** time, pinned UTC
  (`services/intelligence-worker/src/newsletter/newsletterBuilder.ts:505-516`).
- `publish_date`: inserted NULL (`newsletterGenerator.ts:59-71` passes no
  `publishDate`), first populated at **send** time via
  `COALESCE(publish_date, NOW())` (`postgresIssueStore.ts:134`). Generation day ≠ send
  day → permanent one-day disagreement.
- Display: every newsletter-issue formatter is local-timezone, none UTC-pinned
  (`app/src/components/BriefCard.tsx:95-101`, `app/src/app/briefs/page.tsx:68-78`,
  `app/src/app/briefs/[id]/page.tsx:17-23`,
  `services/intelligence-worker/src/render/renderNewsletterHtml.ts:276-288`) — while a
  UTC-pinned helper already exists and is used by canonical brief surfaces
  (`app/src/lib/dates.ts:12-20`, `formatDateOnlyUTC`).
- Adjacent debt: `getNextIssueNumber()` is `COUNT(*)+1`
  (`newsletterBuilder.ts:391-402`), bypassing the DB's
  `newsletter_issue_number_seq` default — a second drift source.

### TR-6 — "Weekly risk intelligence" over a nine-week archive hole (High, verify-first)

- The canonical brief runs on a **single-shot** cron: Tuesday 07:00 UTC
  (`src/api/lib/schedulerRunner.ts:116-126`). One missed firing = one missing week.
- The recovery mechanism exists — `briefCatchup.ts` behind
  `SECURELOGIC_BRIEF_CATCHUP_ENABLED` — but `render.yaml:540-541` enables it on
  **staging only** (the comment there documents "staging brief dormant since May 19").
- The legacy newsletter generator is dark (`SECURELOGIC_LEGACY_NEWSLETTER_ENABLED`
  off, not in render.yaml), so the legacy archive stopped when it stopped.
- Copy sites making the promise: `app/src/app/briefs/page.tsx:161`,
  `app/src/app/layout.tsx:12-13`, plus adjacent weekly claims
  (`briefs/page.tsx:181-182`, `pricing/page.tsx:12,117`, `BriefCard.tsx:218`,
  `dashboard/page.tsx:321`, `briefStaleness.ts`).
- Backlog status is already "Needs production confirmation — may be staging-only."

---

## 2. Workstreams

Ordered by leverage: A and the B1 diagnosis are cheap and unblock everything else.

### WS-A — BR-2: recency correctness (validate + enable, small code)

| # | Task | Files | Kind |
|---|------|-------|------|
| A1 | Staging validation of the existing recency branch: set flag on staging, run a manual generation for `[SEED] Walkthrough Org`, assert zero items with `published_at` before the window, confirm `stale_signal_suppressed` telemetry counts | none (operational) | validation |
| A2 | Add `SECURELOGIC_SIGNAL_RECENCY_ENABLED` to `render.yaml` — staging `true`, prod declared `false` (operator flips at promotion). **Render injects env at deploy, not restart** — activation requires a same-SHA rebuild (2026-08-05 incident) | `render.yaml` | IaC |
| A3 | Surface the recency signal instead of hiding it: brief item shows "Added to KEV {date}" from `published_at` for `cisa_kev`-sourced items; brief masthead states the window explicitly. This converts BR-2's failure mode into the "genuinely valuable signal" the backlog asks for | `intelligenceBriefGenerator.ts` item payload, one app display touch | code, small |
| A4 | Fix the scheduler/poller ETag collision: `briefScheduler.ts:718-732` must either honor `fromCache` explicitly (log "relying on poller rows", not `signals_fetched: 0`) or use a scheduler-scoped ETag key. Today's telemetry misreports every normal weekly run | `briefScheduler.ts` | code, small |

**Exit gate:** a staging-generated brief contains no item whose `published_at` predates
the stated window; suppression telemetry visible; `render.yaml` merged.

### WS-B — BR-1: synthesis that exercises judgment

| # | Task | Files | Kind |
|---|------|-------|------|
| B1 | **Diagnose before rewriting.** Query staging + prod `intelligence_brief_items.enrichment_status` distribution for the last 8 briefs. If fallback-dominant, find the throw site (missing key on the engine service? parse failures?) and fix activation. Rewriting prompts is pointless while output comes from `buildFallbackItem` | read-only SQL, then targeted fix | diagnosis |
| B2 | **Wire `personalizeBriefItems` into the scheduler path**, matching the manual route's ordering (personalize → synthesize → persist 19 columns). No migration — columns exist since `20260511_brief_items_personalization.sql`. This feeds PR #748's matched-first UI on real cron briefs and is the prerequisite for B3 | `briefScheduler.ts` | code, core |
| B3 | Restructure synthesis per the backlog's smallest change: one full analysis for inventory-matched item(s), compact "also added to KEV this week" treatment for unmatched bulk; tighten the urgency rubric + validation so a 12/12 single-band brief cannot ship (bucket targets exist at `URGENCY_BUCKET_TARGETS` but can't rebalance items that all *arrive* one band) | `intelligenceBriefGenerator.ts`, `briefSynthesizer.ts` | code, core |
| B4 | Make degradation honest: when `enrichment_status = "fallback"` dominates, the brief should not present template text as analysis — surface degradation operationally (threshold review) and visually distinguish fallback items | generator + minor app touch | code, small |

**Exit gate:** a staging cron-path brief shows ≥1 matched item with non-templated
analysis leading its band, a non-degenerate urgency distribution, and
`is_personalized` populated.

### WS-C — TR-5: one date, one source

| # | Task | Files | Kind |
|---|------|-------|------|
| C1 | Set `publishDate` at generation from the same instant that formats the title label (`newsletterGenerator.ts` passes it; `COALESCE` at send becomes a no-op) | `newsletterGenerator.ts`, `newsletterBuilder.ts` | code, small |
| C2 | Pin every newsletter-issue date render to UTC via the existing `formatDateOnlyUTC` (`BriefCard`, `FeaturedIssueCard`, `[id]/page.tsx`, `renderNewsletterHtml.ts`) | 4 display files | code, small |
| C3 | Historical rows: **operator decision** — leave history as-is (C2 alone makes label/title agree for rows where `publish_date` ≈ `created_at`) vs. a one-time backfill `publish_date = created_at` where they differ by 1 day. Recommend display-only (no migration) unless drifted rows remain visible | possible migration | decision |
| C4 | (Debt, optional) collapse `getNextIssueNumber()` onto the DB sequence | `newsletterBuilder.ts` | code, small |

**Exit gate:** regression test — issue generated at 23:30 UTC renders the same date in
row label and title when viewed from UTC−5.

### WS-D — TR-6: cadence truth

| # | Task | Files | Kind |
|---|------|-------|------|
| D1 | **Verify production archive continuity first** (backlog's own instruction): SQL against prod `intelligence_briefs` + `newsletter_issues` for gaps. The nine-week hole was observed on staging, which is documented dormant since May 19 — it may not exist in prod | read-only SQL | validation |
| D2 | If prod gaps are real: enable `SECURELOGIC_BRIEF_CATCHUP_ENABLED` in prod via `render.yaml` (same env-at-deploy caveat as A2) — the single-shot Tuesday cron is the structural cause and the recovery mechanism is already built | `render.yaml` | IaC |
| D3 | Copy decision, driven by D1's answer: cadence verified → keep "Weekly"; not verified → the header stops promising it. One-line app changes at the listed copy sites | app copy | code, tiny |

**Exit gate:** prod archive is contiguous weekly, or no customer-facing surface
promises weekly.

---

## 3. Sequencing

```
D1 (prod SQL, operator-assisted)  ──────────────┐
A1 → A2 → A3/A4  (PR IQ-1a)                     ├→ D2/D3 (PR IQ-1d)
B1 → B2 (PR IQ-1b) → B3/B4 (PR IQ-1c)           │
C1/C2/C4 (PR IQ-1e, independent)  ──────────────┘
```

- **A before B3**: no point synthesizing judgment over a signal set still polluted with
  16-year-old entries.
- **B1/D1 immediately**: both are read-only diagnostics and can run in parallel with A.
- **B2 early**: it is the smallest change with the largest compound payoff — it activates
  both the shipped BR-3 UI and BR-1's matched-item analysis.
- **C independent**: legacy-newsletter surface only; can land any time.
- Each PR is small, dark-first where flagged, staging-validated on
  `[SEED] Walkthrough Org` before any prod flag flip. Operator owns all flag flips,
  promotions, and the C3 backfill decision. Staging is pinned to `develop` — no stacked
  release branches needed if PRs land sequentially.

## 4. Risks and open questions

1. **Enrichment cost/limits (B1 outcome-dependent):** if fallback dominance is a quota
   or key issue, fixing it turns on ~12 Claude calls per org per week — size the spend
   before enabling broadly.
2. **Render env-at-deploy:** every flag change in A2/D2 needs a same-SHA rebuild to
   actually reach the process (2026-08-05 incident; runbook §7.2 was wrong).
3. **Recency flag blast radius:** `signalRecencyEnabled()` may gate more than the brief
   window (it ships with dedup-adjacent behavior) — A1 validation must cover the full
   flag surface, not just the window query.
4. **TR-6 may dissolve:** if D1 shows prod is contiguous, D2/D3 reduce to "enable
   catch-up as insurance" and no copy change.
