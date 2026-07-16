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

## Item 7 — Framework coverage rule (RULED)

### Classification

CODE DEFECT once ruled. Simmee's ruling (2026-07-15): **keep satisfied-only math**
(partial earns no score credit); explicit caption everywhere ("0 fully satisfied ·
3 partial" pattern); progress bars render partials as a **visually distinct
segment** (solid = satisfied, hatched/lighter = partial); defined **once** so
caption and segmentation cannot drift per-surface.

### What was drifting (verified pre-fix)

- The identical satisfied-only formula was hand-rolled in THREE engine routes
  (`frameworkReadiness.ts`, `auditPackage.ts`, `gapReport.ts`).
- Four UI surfaces phrased the breakdown four different ways; `FrameworkGaps`
  **dropped zero counts**, so the walkthrough's "0% with 3 partial" rendered as a
  bare "3 partial" beside an unexplained 0%.
- Color bands also drifted: ComplianceCoverage used 80/60, the Readiness widget
  75/50/25, versus the canonical 80/60/40.
- The audit-package PDF omitted the partial count from its stat grid and summary
  sentence entirely.

### Implementation (branch `fix/framework-partial-credit-display`)

- **Engine `src/api/lib/frameworkCoverage.ts`** (new, the ONE definition):
  `readinessScore(satisfied, total)` (satisfied-only, unchanged math) +
  `coverageCaption()` ("N fully satisfied · N partial · N unmapped"; the
  "fully satisfied" part is ALWAYS present, even at 0). Wired into all three
  routes. `GET /frameworks/:id/readiness` now emits `coverage_caption` on the
  wire; app surfaces render it **verbatim** — the wording physically cannot drift.
- **App `app/src/lib/frameworkCoverage.tsx`** (new): `CoverageBar` — solid
  segment = fully satisfied, hatched/lighter segment (same hue,
  `repeating-linear-gradient`) = partial. One component; canonical 80/60/40 bands.
- **Four surfaces converted:** engine readiness_score (wire caption + audit PDF
  grid gains "Fully Satisfied" / "Partial / Unmapped" boxes + caption sentence,
  gap-report PDF sentence uses the caption), Compliance Coverage tile, Readiness
  widget, Framework Gaps — all render `coverage_caption` + `CoverageBar`.

### Evidence

- Engine: new `frameworkCoverage.test.ts` (7 tests — pins "0 fully satisfied · 3
  partial" exemplar, partial-earns-no-credit, zero-count never dropped); full
  suite 6193 passed (356 files).
- App: per-surface regression tests — FrameworkGaps (caption verbatim; hatched
  partial segment with NO solid segment at score 0; both segments when mixed),
  ComplianceCoverage (caption + "fully satisfied" aggregate + segmented row bar),
  Readiness widget via full-page harness. Full suite 849 passed (65 files).
- `tsc --noEmit` clean on both packages.

### Triage discoveries (NOT built)

- **`readiness_score` name collision, different math:** `frameworks.ts`
  (`assessment_readiness.self`) and `requirements.ts` (requirements summary)
  compute `(pass + partial*0.5)/total` over **questionnaire responses** — a
  different metric family on a different data source that DOES grant partial
  credit, under the same field name. Whether assessment-response readiness should
  also be satisfied-only is a DESIGN-NEEDS-RULING for Simmee — not changed
  silently.
- `frameworks/page.tsx` (`ActiveFrameworkCard`/`ReadinessBar`) and
  `frameworks/[id]` render the same readiness with a plain bar + own counts —
  outside the ruled four surfaces; converting them to the shared component is a
  small follow-up.

---

## Items 5 + 6 — Finding-title CVE dedupe + enum leaks (shipped pre-package-2 branch)

### Classification

Both **CODE DEFECT**, fixed together in **#666** (`0f3643fb`, merged before the
posture branch started):

- **Item 5:** `eventFindingTitle` unconditionally prefixed `"<CVE>: "` onto event
  titles that already named the CVE, persisting the duplicate onto every finding
  surface. Prefix now applies only when the title doesn't already mention that
  CVE; fixed at composition (persisted), not render; dirty rows self-heal on the
  next event update.
- **Item 6:** `buildSignalFindingTitle` interpolated the raw `signal_type` enum
  ("Cyber signal (patch_advisory): …") into persisted customer-visible titles.
  New shared vocabulary module `src/api/lib/signals/signalTypeLabels.ts` — brief
  synthesis, finding titles and event projection share ONE map; unknown types
  humanize, never the raw underscore enum. App `SOURCE_COMPACT_LABELS` extended
  to the full `findings_source_type_check` enum.

Dashboard-row ellipsis truncation (the render half of item 5) is covered by the
B1/Q2 title-normalization work extended to dashboard findings rows in the same PR.

---

## Items 3 + 10 — Open Risks / Risk Heatmap empty state (built this package)

### Classification

- **Item 3:** CODE DEFECT (empty-state language) **plus** SEED-DATA GAP (register
  never seeded) — both remedies the brief listed.
- **Item 10:** CODE DEFECT — no empty-state branch in `RisksBreakdown`; the
  four-row all-zero ladder always rendered.

### Root cause (verified)

Zero risks is a **truthful** state: the walkthrough seed inserted no `risks`
rows, and findings never auto-create risks — the only `INSERT INTO risks` in
`src/` is user-initiated `POST /api/risks` (risks.ts), with a dispatcher test
asserting the finding path never touches the risk table. The defect was
presentation: `RisksBreakdown` rendered a zero severity ladder ("we measured and
found nothing") while adjacent `RiskHeatmap` said "No risk data available."
(reads as loading/error) — two contradictory stories beside 12 active findings.

### Implementation

- **Code (#671 `14ab3730`):** both tiles share ONE empty state (module-level
  constants — message and CTA physically cannot drift): *"No risks promoted yet —
  findings don't become risks automatically. Review findings to decide what
  belongs on the risk register."* → `Review findings →` (`/findings?active=true`).
  The zero ladder collapses into it (item 10); the headline `0` stays because it
  reconciles with `/risks`. Populated behavior unchanged.
- **Seed (#673):** three risks PROMOTED from existing seeded findings
  (`source_type='finding'`, the production population path): privileged-account
  compromise ← MFA finding (residual High), nth-party Microsoft exposure ←
  subprocessor finding (residual Moderate), AI-copilot PII retention ← manual
  finding (residual High). Ladder 0/2/1/0, two heatmap zones, all reconciling
  with visible findings. Verified against a throwaway Docker PG with the full
  migration set: commits, idempotent re-run, buckets aggregate 2 High + 1
  Moderate. The honest-empty path any fresh org shows stays regression-tested.

### Evidence

3 new render tests (ladder collapsed at zero + message + CTA target; ladder kept
when populated; heatmap same-story incl. old copy asserted absent).

---

## Item 8 — Actions aging "—" beside 4 recent actions (built this package)

### Classification

**CODE DEFECT** — render guard, not SQL.

### Root cause (verified)

`dashboard.ts` computes `ROUND(AVG(NOW() − created_at))` over active actions
with no age filter; 4 actions younger than ~half a day legitimately round to
`"0"`. The tile guard `avgAge != null && avgAge > 0` treated that real 0 as
no-data and dashed it. The engine returns NULL only when there are zero active
rows to average (AVG over an empty set) — the true no-data case. Same latent
bug existed for findings via the shared `AgingSection`.

### Implementation (#671 `14ab3730`)

Guard is now null-only: 0 renders as `0` ("avg days open" — under half a day),
"—" renders only when there is genuinely nothing to average. 2 regression tests.

---

## Item 4 — Latest Brief staleness (built this package)

### Classification

**CODE DEFECT** (missing product rule) **plus OPERATIONAL** (staging generator
dormant — ledgered as O-6, not fixable from code).

### Root cause (verified)

- No seed inserts briefs (`INSERT INTO intelligence_briefs` exists only in
  `briefScheduler.ts` and the API route), so the May-19 brief is real staging
  generator output: **staging has not published a brief since May 19** — an
  operational fault to investigate, not a seed gap.
- `IntelligenceBriefDashboardCard` had zero staleness logic and hardcoded a
  "Today's intelligence" eyebrow for calm briefs — old intelligence silently
  presented as current, with an urgency accent that was itself a currency claim.

### Implementation (#672 `6345f8d0`)

Product rule: cadence is weekly (Tuesday 07:00 UTC cron `0 7 * * 2`), so a
Latest Brief older than one cadence window +1 day publish slack (**> 8 days**)
renders an explicit amber age warning ("This brief is N weeks old — briefs are
published weekly. A newer brief has not been generated yet."), drops the urgency
accent, and shows a neutral "Previous brief" eyebrow. Within the window nothing
changes. Also: "Today's intelligence" → "Current intelligence", "Daily
Intelligence Brief" fallback → "Intelligence Brief" (the product is weekly —
"Daily/Today's" was wrong on any day), and the DATE-typed `period_end` now
formats through the item-2b UTC-pinned helper. 5 regression tests with the clock
pinned to the walkthrough's July-15 view of a May-19 brief.

---

## Item 9 — Setup banner on a fully-seeded org (already fixed)

### Classification

**CODE DEFECT — already fixed** by package 1's **#664** (`c9031b77`, D-2), which
merged AFTER Simmee's walkthrough. The banner is gated on
`isPlatformUser && !onboardingCompleted && !hasPlatformData`, where
`hasPlatformData` is true when ANY platform object exists (posture snapshot,
open finding/action/risk, computed domain, activated framework) — verified on
current develop (`page.tsx:84–93,139`) with both regression tests present
(banner hidden when the tenant has data; still shown for a genuinely empty
platform tenant). No further work.

---

## Package 2 PR ledger (squash SHAs on develop)

| PR | SHA | Items |
|---|---|---|
| #665 | `f14a5d2a` | Step 0 — entitlement display defect |
| #666 | `0f3643fb` | 5 + 6 — CVE dedupe + signal-type vocabulary |
| #669 | `9d07d325` | 1 + 2 + 2b — health-style posture via canonical mapper |
| #670 | `efe38df2` | 7 — coverage rule defined once |
| #671 | `14ab3730` | 3 + 10 + 8 — risk tiles empty state + aging zero |
| #672 | `6345f8d0` | 4 — brief staleness rule |
| #673 | (open) | 3 seed half — walkthrough risk register rows |

## Post-fix walkthrough — the corrected dashboard (seeded org, this page)

What the walkthrough org's dashboard shows after deploy + re-seed, every number
reconciling with every other and with its destination page:

- **Plan chip:** the real entitlement (never "Free" for a platform/team org) — Step 0/#665.
- **Posture Score tile:** health-style score (higher = better) with a severity
  badge in the SAME direction, plus a separate "N critical · M high findings"
  chip → `/findings?active=true`; "as of" date matches the trend chart's first
  snapshot date exactly (UTC-pinned) — #669.
- **Domain bars:** same health-style direction as the headline score; Access
  Control / Vendor Risk bars no longer read as perfect beside open MFA/vendor
  findings — the score derives from the risk engine and the findings fact rides
  the chip, two different truths in two elements — #669.
- **Active Findings donut:** 8, severity segments summing to the headline, titles
  free of duplicate CVEs and raw enums — #666.
- **Open Risks:** 3, ladder 0 Critical / 2 High / 1 Moderate / 0 Low; heatmap
  shows the two matching residual zones; both numbers land on `/risks` showing
  exactly those 3, each traceable to a visible finding — #671 + #673. (A fresh
  org instead shows the shared explanatory empty state: "No risks promoted yet —
  findings don't become risks automatically…" with a Review findings CTA.)
- **Open Items Aging:** real averages for both populations; "—" only when a
  population is empty — #671.
- **Latest Brief:** if staging's generator has resumed, a current brief with its
  urgency accent; until then the May brief carries "Previous brief" + an amber
  "N weeks old" warning instead of claiming currency — #672 (generator itself =
  O-6).
- **Compliance Coverage / Framework Gaps / Readiness:** "0 fully satisfied ·
  3 partial" caption everywhere with hatched partial segments — #670.
- **Setup banner:** absent (org has data) — #664.

## Triage list additions (NOT built)

- (carried) `publication_context_json` stores risk-style posture provenance.
- (carried) assessment-response `readiness_score` partial-credit collision → O-5 ruling.
- (carried) `frameworks/page.tsx` + `frameworks/[id]` plain readiness bars →
  convert to shared `CoverageBar`.
- Brief card copy says briefs are "published weekly" — if the cadence ever
  changes, the staleness window constant and copy live in ONE component
  (`IntelligenceBriefDashboardCard.tsx`), but the cadence itself is defined in
  `schedulerRunner.ts`; a shared cadence constant would remove the duplication.

## Operator ledger (actions NOT performed by the build session)

| # | Action | Why | Status |
|---|---|---|---|
| O-1 | Staging DB confirm for Step-0: verify the walkthrough org's entitlement row is `platform`/`team` (query against `organizations`/entitlement source), confirming verdict (a) | Package gate 1 | ☐ pending |
| O-2 | Add cutover annotation to the customer-facing release note **beside the posture-population discontinuity note**: "Posture scores now read health-style (higher = better); numbers before this release are on the inverted scale." No canonical release-note file exists in-repo — annotate wherever the discontinuity note was published | Ruling requirement | ☐ pending |
| O-3 | Staging re-walkthrough of the posture surfaces (dashboard, /posture, trend, executive report PDF, Ask, weekly email) after deploy — confirm every surface shows the same health-style number | Package gate: report product behavior, not PR completion | ☐ pending |
| O-4 | Staging check of item 7 after deploy: a framework with 0 satisfied / N partial shows "0 fully satisfied · N partial" and a hatched-only bar on Framework Gaps, Compliance Coverage, and the Readiness widget; audit-package + gap-report PDFs carry the partial count | Package gate: report product behavior | ☐ pending |
| O-5 | Ruling request for Simmee: assessment-response readiness (`frameworks.ts` / `requirements.ts`) grants partial credit (`pass + partial×0.5`) under the same `readiness_score` name as the satisfied-only control-mapping readiness — same word, two maths. Should it become satisfied-only too, or be renamed? | DESIGN-NEEDS-RULING (never pick silently) | ☐ pending |
| O-6 | Investigate why staging has published no Intelligence Brief since May 19: the brief cron (`0 7 * * 2`) runs in the staging **web** service at boot (`server.ts` → `startScheduler`), not the intelligence worker. Check staging web-service logs for Tuesday-07:00 scheduler runs / generation errors; confirm boot-time catch-up (`briefCatchup.ts`) fires | Item 4 root cause — real generator output is stale; not fixable from code | ☐ pending |
| O-7 | Re-run the walkthrough seed on staging (`npx tsx scripts/validation/seed-walkthrough-org.ts`) after #673 deploys, so the walkthrough org picks up the 3 risk-register rows | Item 3 seed half | ☐ pending |
| O-8 | Extend the O-3 staging re-walkthrough to the full dashboard checklist in "Post-fix walkthrough" above (risk tiles + heatmap vs /risks, aging averages, brief staleness marker, setup banner absent) | Package gate: report product behavior, not PR completion | ☐ pending |
