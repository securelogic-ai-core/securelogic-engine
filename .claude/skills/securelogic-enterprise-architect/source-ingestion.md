# Source Ingestion & the Intelligence Pipeline

This file documents what the ingestion + signal + brief pipeline **actually does today**
(verified from code), then separates out **recommendations** that are NOT yet built.
Keep that boundary crisp — `BUILD_SEQUENCE.md` priorities 3–6 are precisely about
maturing this layer, and `CURRENT_STATE_ARCHITECTURE.md` is honest that it is the
weakest part of the platform relative to the vision.

---

## Part A — What exists (verified)

### A1. The flow at a glance

```
 public sources ──► feed adapters ──► cyber_signals (GLOBAL) ──► matcher fan-out (per org)
   RSS / KEV / NVD     map to               org_id = NULL          runMatcherForSignal
   SEC / FedReg        CyberSignalIngestInput  dedup hash             ▼
   MITRE / reg feeds                                         signal_match_suggestions
                                                             findings · risk flags · posture
                                                                     ▼
                                            intelligenceBriefGenerator (pure scoring/bucketing)
                                                                     ▼
                                            briefSynthesizer (Anthropic LLM enrichment)
                                                                     ▼
                                  intelligence_briefs + items ──► briefEmailRenderer ──► Resend
```

### A2. Ingestion entry points (three schedulers)

- **Hourly worker pipeline** — `services/intelligence-worker/src/scheduler.ts` runs
  `runWorker()` (→ `pipeline/runPipeline.ts`) every ~1h.
- **15-minute KEV poll** — `kevPoller.ts` fetches CISA KEV with ETag + Redis short-circuit
  (304 → skip DB).
- **Daily brief scheduler** — `src/api/lib/briefScheduler.ts`, ~08:00 UTC, per org with an
  active brief subscription.

All three converge on the same matcher (`runMatcherForSignal`). **If you change matcher
behavior, change it once and verify all three call sites.**

### A3. Feed adapters & the source registry

- Registry: `src/api/lib/feedAdapter/registry.ts` — currently **8 registered feeds**: 3
  threat-intel RSS (BleepingComputer, KrebsOnSecurity, SANS ISC) + 5 regulatory RSS (NIST
  news, FTC news, ONC HealthIT, …). CMS is deliberately omitted (no discoverable RSS —
  would fail perpetually). All source URLs in the registry have been live-verified before
  landing.
- Aggregator: `feedAdapter/index.ts` `fetchAllFeeds({ ids? })` iterates the registry with
  **per-feed error isolation** (one feed failing doesn't block others) and returns
  `{ signals, results: { [feedId]: { total, mapped, skipped, error? } } }`.
- Mappers (pure): `threatIntelHelpers.ts`, `regulatoryHelpers.ts` map raw RSS items →
  `CyberSignalIngestInput`.
- The daily scheduler additionally pulls CISA KEV, NVD (7-day window), SEC EDGAR, Federal
  Register, CISA alerts, MITRE ATT&CK/ATLAS. Per-feed health is recorded
  (`recordFeedSuccess`/`recordFeedFailure`, `feed_health` table).

**To add a source:** add an adapter + a registry entry with a live-verified URL and a
mapper to the canonical signal shape. This is `BUILD_SEQUENCE.md` priorities 3–4 territory
— treat a new source as a discrete package, not a side effect, and confirm the URL is real.

### A4. Signals: shared, global, deduped

- Canonical table is **`cyber_signals`**; `signals` is the legacy table (deprecated but
  live). Per `TENANT_ISOLATION_STANDARD.md` §1, public-source signal tables are
  intentionally **not** org-scoped — rows are written **global** with
  `organization_id IS NULL`.
- Dedup is `ON CONFLICT DO NOTHING` against a partial unique index over a content/dedup
  hash (`buildDedupHash(source, signal_type, cve, vendor, external_id)`). Normalizer:
  `src/api/lib/cyberSignalNormalizer.ts` (re-exported so KEV, pipeline, and the daily
  scheduler normalize identically).
- **Severity** on a signal is the canonical PascalCase enum (`Critical`/`High`/…).
- **Rule:** never write public-source ingestion straight into an org-scoped table. Global
  in, per-org fan-out at consumption.

### A5. The matcher (signal → platform context)

- Core: `src/api/lib/cyberSignalProcessingService.ts` — `runMatcherForSignal(signal,
  orgId)` runs inside `withTenant(orgId)`. It matches the signal against the org's
  vendors / AI systems / controls / obligations and:
  - writes `signal_match_suggestions` (polymorphic over target_type/target_id, score
    0–100 from `computeRiskScore`),
  - creates findings (`source_type='signal'` / `cyber_signal`) on confident matches,
  - flags exposed open risks (`exposed`/`exposure_flagged`),
  - triggers a posture snapshot (non-fatal if it fails).
- Companion: `runLlmControlMatcherForSignal` (`llmControlMatcher`) — LLM suggest-only,
  self-gated by `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` (paid feature).
- **Fan-out** (`runPipeline.ts` `fanOutMatcherToActiveOrgs`): enumerate active orgs on
  `pgElevated`, then per (global signal, org) call the matcher inside that org's scope.
- **Relevance scoring** uses `risk_scoring_weights` (per-org, customer-configurable;
  two-vocabulary design — see `domain-model.md`). KEV signals pin severity weight to 1.0.

### A6. Brief generation

- `src/api/lib/intelligenceBriefGenerator.ts` — **pure** (no I/O): pulls the org's
  cyber_signals (7-day window, including global `organization_id IS NULL` rows), scores by
  relevance, buckets by category (CVE→vulnerability, breach→vendor_incident, …), builds
  `BriefItem`s + `content_json` / `content_markdown`.
- `src/api/lib/briefSynthesizer.ts` — Anthropic Claude enrichment of each item
  (`analysis`, `why_it_matters`, `recommended_actions`) + a brief-level thesis.
  **Falls back to templated text** if the model fails or returns unusable output.
- Persisted to `intelligence_briefs` + `intelligence_brief_items`; rendered by
  `briefEmailRenderer.ts` and sent via Resend (`briefEmailSender.ts`).
- **Premium-brief shape** (per `FINAL_PRODUCT_STANDARD.md` §Intelligence): title,
  severity, category/section, audience, whyItMatters, analysis, recommended action, CVE
  when available, vendor when available, rationale for higher-risk items. **No generic AI
  filler** ("may affect posture", "organizations should review", "underscores the
  importance" — explicitly banned).

### A7. Alerting

- `src/api/lib/alerting/alertService.ts` — `createAlertBatcher(kind, cycleId)` coalesces
  Critical/High findings into **one email per org per cycle**, with an idempotency ledger
  so a recipient isn't double-alerted.
- Flag-gated by `SECURELOGIC_MATCHER_ALERTS_ENABLED` (default **OFF** — inert until
  enabled). Wired into both the pipeline fan-out and the KEV poller.

### A8. Tenant rules for the pipeline (non-negotiable)

From `TENANT_ISOLATION_STANDARD.md` §6:
- Cross-org ingestion is allowed **only** for genuinely public/global data, and output
  goes **only** to shared signal tables.
- Per-org fan-out happens at consumption time and is an org-scoped operation under §4.
- LLM calls with customer-private inputs are single-org; never batch orgs (R6).
- Per-org loops wrap each org in try/catch (one tenant can't poison the cycle) and log
  `organizationId`.

---

## Part B — Recommendations (NOT yet built — do not present as existing)

`CURRENT_STATE_ARCHITECTURE.md` and `BUILD_SEQUENCE.md` are explicit that the external
intelligence layer is immature relative to the vision. The target architecture
(`BUILD_SEQUENCE.md` priority 3, `external-signal-architecture`) calls for, and the repo
does **not** yet fully have:

- A formal, documented **external signal object** model distinguishing raw source item →
  normalized signal → enriched signal → brief item as first-class stages.
- A **source qualification / credibility** model (right now sources are a hand-curated
  registry; there's no scored source-trust layer).
- Stronger **deduplication** beyond the current single content-hash (e.g. near-duplicate /
  cross-source clustering).
- Richer **normalization** and severity/context extraction.
- **Signal-to-platform linkage** maturity (priority 5): resolving signals to dependencies
  and risks, driving reassessment triggers and brief relevance — partly present via the
  matcher + link tables, but not the full vision.
- **Brief premiumization** (priority 6): analyst-grade cross-signal synthesis and clear
  free-vs-paid differentiation.

When asked to improve ingestion, prefer work that strengthens **signal qualification,
ranking, dedup, source credibility, and linkage** over renderer/layout polish — improving
presentation ahead of signal depth is explicitly out of sequence
(`FINAL_PRODUCT_STANDARD.md` §"Signal quality before presentation polish"). And treat
anything in Part B as a **proposal**, clearly separated from Part A, until it ships.
