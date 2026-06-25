# Reference — Intelligence Pipeline Engineer

File-by-file map. **VERIFIED** unless tagged. Companion: the architect skill's
`source-ingestion.md` (Part A verified flow / Part B recommended target architecture).

## 1. Sources & ingestion
| Concern | File(s) | Notes |
|---|---|---|
| Source registry | `src/api/lib/feedAdapter/registry.ts` | **6 RSS feeds** (3 Tier-2 threat-intel + 3 Tier-1 regulatory). CMS omitted by design. |
| Direct-source adapters | `briefScheduler.ts` imports | **7 adapters** (CISA KEV, NVD, SEC EDGAR, Federal Register, CISA alerts, MITRE ATT&CK, MITRE ATLAS) — outside the RSS registry. |
| Aggregator | `src/api/lib/feedAdapter/index.ts` | `fetchAllFeeds({ ids? })`, per-feed error isolation, `{ signals, results }`. |
| Mappers (pure) | `threatIntelHelpers.ts`, `regulatoryHelpers.ts` | raw item → `CyberSignalIngestInput`. |
| Extra daily sources | `src/api/lib/briefScheduler.ts` | CISA KEV, NVD (7d), SEC EDGAR, Federal Register, CISA alerts, MITRE ATT&CK/ATLAS. |
| Feed health | `feed_health` table; `recordFeedSuccess/Failure` | per-feed status. |

## 2. Signals (shared, global)
| Concern | File(s) | Notes |
|---|---|---|
| Canonical table | `cyber_signals` (legacy `signals`) | `organization_id IS NULL` (global). Not org-scoped (standard §1). |
| Normalize + dedup | `cyberSignalNormalizer.ts` | hash `(source, signal_type, cve, vendor, external_id)`; `ON CONFLICT DO NOTHING`. |
| KEV fast path | `services/intelligence-worker/src/kevPoller.ts` | 15-min; ETag + Redis 304 short-circuit. |

## 3. Matcher (signal → platform context)
| Concern | File(s) | Notes |
|---|---|---|
| Core | `src/api/lib/cyberSignalProcessingService.ts` | `runMatcherForSignal(signal, orgId)` in `withTenant`. |
| Output | `signal_match_suggestions` (polymorphic target_type/target_id) | score 0–100 via `computeRiskScore`; `match_metadata`; partial-unique WHERE pending → re-suggest after dismissal. |
| Relevance weights | `risk_scoring_weights` (per-org) | two-vocabulary (PascalCase severity / lowercase criticality) — do NOT conflate. KEV pins severity_w=1.0. |
| Findings + risk flag | matcher writes findings (`source_type='signal'`/`cyber_signal`), flags exposed open risks | phase-5 lifted into matcher (#354 `b7165093`) so worker fan-out reaches it; telemetry #355. |
| LLM control matcher | `llmControlMatcher` | suggest-only, `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` (paid). Wired into fan-out (#345). |

## 4. Fan-out (cross-org → per-org)
| Concern | File(s) | Notes |
|---|---|---|
| Worker pipeline | `services/intelligence-worker/src/pipeline/runPipeline.ts` | `fanOutMatcherToActiveOrgs`: enumerate active orgs on `pgElevated`, matcher per (signal, org). Hourly. |
| KEV poller | `kevPoller.ts` | same fan-out, 15-min. |
| Daily scheduler | `src/api/lib/briefScheduler.ts` | per-org ingest (savepoint per signal) + matcher, ~08:00 UTC. |

**All three are matcher entry points — keep behavior in sync.**

## 5. Brief generation
| Concern | File(s) | Notes |
|---|---|---|
| Generator (pure) | `src/api/lib/intelligenceBriefGenerator.ts` | `BriefItem`: title, severity, `category`, `affected_cve`, `affected_vendor`, `analysis`, `why_it_matters`, `recommended_actions`. Categories: vulnerability/threat_actor/vendor_incident/regulatory/general. |
| Synthesis (LLM) | `src/api/lib/briefSynthesizer.ts` | Anthropic enrichment + brief thesis; template fallback on failure. |
| Persistence | `intelligence_briefs` + `intelligence_brief_items` | |
| Render + send | `briefEmailRenderer.ts`, `briefEmailSender.ts` (Resend) | single weekly Brief; Daily Digest send disabled (#347). |

## 6. Alerting
`src/api/lib/alerting/alertService.ts` `createAlertBatcher(kind, cycleId)` — coalesce 1
Critical/High email per org/cycle, idempotency ledger. Heartbeat `alert_batch_flush_complete`
(#349). Flag `SECURELOGIC_MATCHER_ALERTS_ENABLED` (default OFF). Wired in pipeline + KEV.

## 7. Tenancy rules (VERIFIED, from `TENANT_ISOLATION_STANDARD.md` §6)
- Cross-org ingestion only for public/global data → shared tables only.
- Per-org fan-out at consumption time, org-scoped, per-org try/catch + `organizationId` logs.
- LLM with customer-private inputs = single org; no cross-org batching (R6). **R5 (worker→brief
  per-org filtering) is flagged "unverified" in the standard — confirm when you touch it.**

## 8. Recommended / not built (label clearly when proposing)
Source qualification + credibility scoring · near-duplicate clustering · explicit
raw→normalized→enriched→brief-item stage model · richer normalization/severity extraction ·
deeper signal→risk-register reassessment triggers. (`BUILD_SEQUENCE.md` priorities 3–5.)

## Known operational notes (from project memory — verify before relying)
- Worker feeds repaired/retired over time (The Register, ICO, Dark Reading; SEC-8K UA) — check
  current `registry.ts` rather than assuming a feed is live.
- Per-item dedup key fix (#344) stops CVE-less signals collapsing — preserve when editing dedup.
