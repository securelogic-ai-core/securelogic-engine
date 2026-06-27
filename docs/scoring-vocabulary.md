# Platform scoring vocabulary

Status: **accepted** · First recorded: 2026-07-06 (alongside `risks.residual_score`, migration `20260706`)

## Why this exists

SecureLogic AI now persists **several independent 0–100 "scores" with different
polarity and SQL types**. They are *not* interchangeable. This note is the
single place that declares, per scale: range, polarity (does higher mean better
or worse?), SQL type, band mapping, and the authoritative field. Any surface
that ranks, aggregates, colors, or blends scores across domains MUST consult
this table first — a bare "risk number" with no scale context is meaningless and
actively misleading (a `80` is *critical* risk but *low* vendor risk).

## The scales

| Scale | Column(s) | Type | Range | Polarity | Bands | Authority |
|-------|-----------|------|-------|----------|-------|-----------|
| **Risk register score** | `risks.residual_score`, `risks.inherent_score` | `INTEGER` | 0–100 | **higher = worse** | Critical ≥75, High ≥50, Moderate ≥25, Low <25 | `risks.residual_rating` (analyst-set) is authoritative; score is a derived projection |
| **Vendor risk score** | `vendors.current_risk_score` | `NUMERIC(10,2)` | 0–100 | **higher = better** ⚠️ *inverted* | ≥75 Low, ≥50 Moderate, ≥25 High, <25 Critical | `vendorRiskScore.ts` (`100 − criticality − finding_penalty`) |
| **Posture score** | `posture_snapshots.overall_score`, `domain_scores.score` | `INTEGER` | 0–100 | **CONTRADICTORY** — engine: higher = *worse* (risk); presentation: higher = *better* (green at high). See debt below. | `*_severity` string column | `OverallRiskAggregationEngineV2` (producer) vs weekly-summary / exec-report (consumers) |
| **Intelligence trend score** | `trends.score` | `NUMERIC(10,2)` | **UNKNOWN** | **UNKNOWN** (unverified) | UNKNOWN | trend ingestion |

## Rules for new surfaces

1. **Never render or compare a raw score without its scale.** Lead with the
   band/severity; show the number as secondary magnitude / tie-break.
2. **Never blend scores across scales into one number.** They have different
   polarity and types. If a surface needs a unified figure, it must normalize
   through an explicit, documented mapping — not arithmetic on raw values.
3. **Risk register: `residual_rating` wins.** `residual_score` orders *within*
   what the rating asserts (heatmap intensity, intra-band sort, tie-break). It
   must not reorder a risk across bands the rating disagrees with. See
   `src/api/lib/riskScore.ts` and migration `20260706`.
4. **Precision honesty.** The risk register score is a closed grid of ~13
   discrete integer values (5 likelihood × 4 impact weights); it is *not*
   continuous. Don't present it as a fine-grained measurement.

## Known debt (deferred — do not build now)

- **Vendor↔risk polarity inversion.** `vendors.current_risk_score` runs opposite
  to `risks.residual_score`. The day a surface shows both (e.g. a Vendor Profile
  that lists vendor risk *and* the risks linked to that vendor), a normalization
  / `score_semantics` convention is required. Tracked here; not in scope for the
  numeric-score foundation work.
- **No `risk_score_history`.** `residual_score` is overwritten in place on axis
  change, so score-over-time is not currently queryable. Continuous Monitoring
  will need a timestamped history table.
- **Posture-score polarity is CONTRADICTORY (unresolved).** The *producer* and
  the *consumers* of `posture_snapshots.overall_score` disagree on direction:
  - **Engine truth (producer):** `OverallRiskAggregationEngineV2.scoreToSeverity`
    maps a *higher* score to a *worse* posture — `≥85 Critical, ≥65 High,
    ≥40 Moderate, else Low`. `computePosture()` stores this engine output
    verbatim as `overall_score`. So the persisted number is **higher = worse**.
  - **Presentation surfaces (consumers):** the weekly posture email
    (`alertEmailService.sendWeeklySummary`, via `summaryScheduler`) and the
    executive report (`executiveReport.ts`) currently color a *higher* score as
    *healthier* — i.e. they treat it as **higher = better**. The cut points
    differ per surface: the weekly email is green at `≥75`, red at `<25`; the
    executive report is teal at `≥70`, red at `<40`.
  This inversion is **known scoring-vocabulary debt**. It is intentionally NOT
  normalized, refactored, or fixed in the numeric-score foundation work, and the
  alert/report coloring is left unchanged. An owner must decide the intended
  direction (is posture a maturity score where high = good, or a risk score
  where high = bad?) and then correct whichever side is wrong.
  **Until that polarity is resolved, `posture_snapshots.overall_score` MUST NOT
  be blended, compared, or co-ranked with `risks.residual_score`,
  `vendors.current_risk_score`, or `trends.score`** — any cross-surface figure
  that mixes them would be silently wrong in at least one direction.
- **`trends.score` semantics unverified.** The column exists
  (`trends.score NUMERIC(10,2)`, migration `001`) but no code reads, ranks, or
  range-constrains it, so its range and polarity are **UNKNOWN** and recorded as
  such above. Verify against the trend-ingestion producer before any surface
  renders or compares it — do not assume 0–100 or a polarity.
