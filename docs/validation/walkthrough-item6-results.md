# July-15 Walkthrough — Package 2 (Dashboard) Results

> **Purpose:** Per-item results for the dashboard fix package from Simmee's 2026-07-15
> staging walkthrough. Every item is classified (CODE DEFECT / SEED-DATA GAP /
> DESIGN-NEEDS-RULING) before any fix; rulings are recorded verbatim-in-substance;
> operator actions are ledgered, never executed by the build session.
> **Base:** branch `fix/dashboard-pkg-posture-display` off develop `0f3643fb`.

---

## Step 0 — Entitlement verdict (gate)

**Verdict (a) — display defect, not a premium leak.** The seeded org held a real
`platform`/`team` entitlement and passed every `isPlatformUser` gate; only
`planDisplayName` (app `api.ts`) fell through to "Free" when no Stripe tier was
present. Fixed and shipped as **#665** (`f14a5d2a`) before this branch started.
No entitlement gate was widened. Operator confirm query is ledgered below.

---

## Items 1 + 2 — Posture score semantics (RULED) + item 2b (dates)

### Classification

- **Item 1 (score 96 badged Critical read as contradiction):** DESIGN-NEEDS-RULING →
  ruled by Simmee 2026-07-15: invert to **health-style (higher = better) on every
  posture surface**, engine math untouched, conversion at ONE canonical mapper at the
  API/display boundary; score badge and findings fact are **separate elements**.
- **Item 2 (domain bars/tiles inconsistent direction):** CODE DEFECT once ruled —
  surfaces disagreed about which direction was good.
- **Item 2b (dashboard "as of Jul 14" vs trend "Jul 15" for the same snapshot):**
  CODE DEFECT — `DATE`-typed `snapshot_date` formatted without a pinned timezone
  renders the previous day in negative-UTC zones.

### Implementation (this branch)

**The canonical mapper — `src/api/lib/postureDisplay.ts`** (new): `display = 100 − risk`,
clamped, null-safe; severity labels pass through (a Critical posture now reads as a
LOW number beside its Critical badge). Unit-tested in
`src/api/__tests__/postureDisplay.test.ts` (6 tests). The engine
(DomainRiskAggregationEngineV2, `posture_snapshots`, `domain_scores`) stays
risk-style; **no surface converts ad-hoc**.

**Surface inventory (ruling requirement) — each converted + tested:**

| Surface | Conversion point | Status |
|---|---|---|
| Dashboard summary (tile + domain bars) | `routes/dashboard.ts` → mapper | ✅ converted; app tests assert "higher = better" and no risk framing |
| Posture page (headline + domain table) | same API + copy/caption updated in `app/src/app/posture/page.tsx` | ✅ converted; render tests added |
| Posture snapshot POST/GET + webhook payload | `routes/posture.ts` | ✅ converted |
| Posture trend series | `routes/posture.ts` → `toDisplayTrend`; caption added to `PostureTrendChart` | ✅ converted; render test added |
| Posture forecast (observations + projection) | `routes/predictiveIntelligence.ts` converts observations BEFORE fitting, so the projection is in display space | ✅ converted; isolation test re-seeded |
| Executive report / PDF | `routes/executiveReport.ts` (both trend points through one mapper) | ✅ converted — PDF `scoreColor` (≥70 green) and delta `▲ green` were already health-style, so conversion **fixed** two latent miscolorings |
| Executive risk summary | `routes/riskIntelligence.ts` | ✅ converted; isolation test updated |
| Leadership summary (intelligence) | `routes/intelligence.ts` → `toDisplayPosture`; `trend_direction` "higher = improving" logic is now semantically correct | ✅ converted |
| Ask (LLM context + `context_used`) | `routes/ask.ts` — both emissions | ✅ converted |
| Weekly summary email | `lib/summaryScheduler.ts`; email colorizer (≥75 green) was already health-style | ✅ converted |

**Findings-fact chip (ruling complement):** `PostureScoreTile` now renders a separate
"N critical · M high findings" chip linking to `/findings?active=true` — never folded
into the score badge.

**Item 2b:** new shared helper `app/src/lib/dates.ts` (`formatDateOnlyUTC`) pins
DATE-only formatting to UTC; used by the dashboard tile and the posture page (the
trend chart already forced UTC).

### Latent inversions the cutover FIXED (were live bugs under risk-style data)

1. Executive PDF colored risk ≥70 green (health-style colorizer on risk data).
2. Executive PDF 90-day delta showed rising risk as green ▲.
3. `buildLeadershipSummary.trend_direction` labeled rising risk "improving".
4. `PredictiveInsightsPanel` colored an "increasing" (risk) forecast green.
5. Weekly email colored risk ≥75 green.

All five now receive display values and are correct without code changes.

### Evidence

- Engine unit suite: **355 files / 6186 passed** (includes new mapper tests).
- App suite: **65 files / 843 passed** (new: PostureScoreTile health framing +
  findings chip + UTC date; DomainPostureBars; PostureTrendChart caption; posture
  page health framing + UTC date).
- Isolation harness (throwaway Docker PG): `dashboardReaderWrap`, `postureForecast`,
  `executiveRiskSummary` — **13 passed**, assertions updated to expect display forms
  of risk-style seeds (comments explain the mapping at each site).
- `tsc --noEmit` clean on engine and app (stale tsbuildinfo removed first).

### Triage discoveries (NOT built — per package gate 6)

- `publication_context_json` (`briefPublicationContext.ts`) stores the posture score
  **risk-style at rest** as brief provenance. No surface renders it today. If one
  ever does, it must pass through the mapper at render time. → triage list.
- Dead `DomainRow` component removed from `app/src/app/posture/page.tsx` (unused,
  encoded stale semantics).

---

## Operator ledger (actions NOT performed by the build session)

| # | Action | Why | Status |
|---|---|---|---|
| O-1 | Staging DB confirm for Step-0: verify the walkthrough org's entitlement row is `platform`/`team` (query against `organizations`/entitlement source), confirming verdict (a) | Package gate 1 | ☐ pending |
| O-2 | Add cutover annotation to the customer-facing release note **beside the posture-population discontinuity note**: "Posture scores now read health-style (higher = better); numbers before this release are on the inverted scale." No canonical release-note file exists in-repo — annotate wherever the discontinuity note was published | Ruling requirement | ☐ pending |
| O-3 | Staging re-walkthrough of the posture surfaces (dashboard, /posture, trend, executive report PDF, Ask, weekly email) after deploy — confirm every surface shows the same health-style number | Package gate: report product behavior, not PR completion | ☐ pending |
