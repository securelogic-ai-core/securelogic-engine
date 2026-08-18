# Decomposition of the 3.15-hour slowest org — READ-ONLY ANALYSIS

Status: **analysis only. No code changed. No optimization implemented.**
Date: 2026-08-18.
Subject: org `fe2ede61-e1f3-499f-b2b3-3ce530f4fc06`, staging weekly Brief run of
2026-08-18, engine `srv-d7n0rju8bjmc738jbs7g`.
Window: `14:51:35.628Z → 18:00:24.462Z` = **11,328.8 s = 3.147 h**.

---

## CORRECTED BASELINE — supersedes all earlier characterizations

| measure | value |
|---|---|
| **Measured sequential run** | **10.99 h** (`durationMs 39624403`, 13 orgs, 13 published, 0 errors) |
| **Projected concurrency-2 run** | **~6.24 h** (worker pool simulated over the real per-org durations) |
| **Longest individual org** | **~3.15 h** — the hard floor; no org-level concurrency goes below it |
| **Prior ~4.5 h characterization** | **SUPERSEDED. Do not use it for anything.** |

Deadline calibration requirement is unchanged: **≥ 3 weekly cycles** of
`scheduler_org_complete` telemetry collected *after* both the verdict cache and
bounded concurrency are live, threshold set from the observed distribution
(ADR-0008).

---

## 1. Stage decomposition

Derived from consecutive scheduler milestone events for this org. Every boundary
is a real logged timestamp; no interpolation.

| stage | seconds | share |
|---|---:|---:|
| KEV ingest — 9 new / 1,657 dedup | 80.8 | 0.71% |
| **NVD ingest — 3,563 new / 0 dedup** | **10,953.9** | **96.69%** |
| Federal Register ingest — 17 new | 3.6 | 0.03% |
| CISA Alerts ingest — 29 new / 1 dedup | 230.3 | 2.03% |
| Threat-intel RSS ingest — 18 new / 7 dedup | 18.7 | 0.17% |
| Regulatory ingest — 0 new / 8 dedup / 10 invalid | 0.1 | 0.00% |
| Brief generate Phase 1 + enrichment (24 items) | 23.5 | 0.21% |
| Synthesis + persist + publish | 16.7 | 0.15% |
| Send / publish | 1.1 | 0.01% |
| **ALL INGEST** | **11,287.5** | **99.63%** |
| **ALL BRIEF GENERATION + SEND** | **41.4** | **0.37%** |

**Feed/source fetching contributes 0 s to this org.** Feeds are fetched once per
run, before the org loop; per-org cost is ingest of an in-memory array. SEC EDGAR,
MITRE ATT&CK and MITRE ATLAS produced no per-org ingest at all (0 signals / 304
cache hits), which is why they have no row.

## 2. Inside the NVD phase — where 96.7% of the org lives

Measured by pairing `llm_control_matcher_start` → `_done` and summing spans fully
inside three independent 4-minute probes:

| probe | calls | LLM busy | wall | utilisation | overlap |
|---|---:|---:|---:|---:|---|
| 15:30–15:34 | 33 | 196.5 s | 240 s | 81.9% | **none** |
| 16:20–16:24 | 39 | 225.7 s | 240 s | 94.0% | **none** |
| 17:30–17:34 | 42 | 229.9 s | 240 s | 95.8% | **none** |
| **aggregate** | **114** | **652 s** | **720 s** | **90.6%** | **none** |

Merged-interval busy time equals raw summed busy time in every probe, to within
0.5 s. **The LLM calls do not overlap at all — they are strictly sequential.**

Applying the measured 90.6% utilisation to the NVD phase:

| | seconds | share of the whole org |
|---|---:|---:|
| **LLM control-matcher calls (sequential)** | **9,924** | **87.6%** |
| everything else in ingest — DB insert, validate, normalize, dedup, deterministic matcher, reassessment enqueue | 1,030 | 9.1% |

### LLM latency distribution (n = 114 paired calls)

| min | p50 | p90 | p99 | max | mean |
|---:|---:|---:|---:|---:|---:|
| 1.03 s | 5.48 s | 8.53 s | 13.14 s | 16.38 s | 5.72 s |

This is **normal latency** for a Sonnet call carrying up to
`MAX_CONTROLS_IN_PROMPT = 80` controls. There is no fat tail, no timeout
signature (nothing near the SDK's 10-minute default), and no retry pattern.

### Call count

Ten one-minute probes spread evenly across the 182.6-minute phase: 102 LLM
starts over 223 signals = **0.46 calls per signal**.

- extrapolated by rate: ~1,862 calls
- extrapolated by ratio: ~1,630 calls
- implied by utilisation (9,924 s ÷ 5.72 s mean): ~1,735 calls

**Honest range: ~1,600–1,900 LLM calls for this one org, in one weekly run.**
The three estimates agree to within ±8%; no single figure is claimed.

The gate is `shouldRunControlMatcher`: flag on **and** control-relevant signal
type **and** severity Critical or High. The ~46–62% hit rate across probes is
simply the Critical/High share of the week's NVD CVEs.

## 3. What the telemetry does NOT support

Stated rather than estimated, per the brief:

- **DB time is not separately instrumented.** The 1,030 s non-LLM figure is a
  residual (phase minus LLM busy time) covering insert, validation,
  normalization, dedup, the deterministic matcher and the reassessment enqueue
  together — ~0.29 s/signal. It is an upper bound on DB time, not a measurement
  of it.
- **Normalization and dedup cannot be separated from each other.** The KEV phase
  is the only near-clean sample: 1,666 signals of which 1,657 deduped, in 80.8 s.
  Netting out ~9 matcher-eligible inserts leaves roughly **10–20 ms per
  deduplicated signal** for validate + normalize + `INSERT … ON CONFLICT`. Order
  of magnitude only.
- **SDK-internal retries are invisible.** The Anthropic client logs no retry
  event, so a retried call appears only as elevated latency. The observed p99 of
  13.1 s rules out any retry involving the 10-minute timeout, but a fast internal
  retry could hide inside the distribution.
- **No per-org LLM cost figure exists for this run.** The LLM cost telemetry
  (`bfe79f78`) is not on staging yet.

## 4. Retries, fallbacks and waits — measured at zero

- `brief_enrichment_summary`: `total 24, enriched_count 24, fallback_count 0`.
  Zero provider degradation.
- No rate-limit, quota, `429`, `llm_call_failed`, or overload events anywhere in
  the run.
- `errors: []` on the run summary. All 13 orgs published.

**Nothing was retried, degraded, or waiting. The org was doing productive work
the entire 3.15 hours — just serially.**

---

## 5. Cause

**Primary cause: (1) excessive sequential LLM calls.**

~1,600–1,900 LLM control-matcher calls, issued strictly one at a time, at a p50
of 5.5 s, occupying 90.6% of the dominant phase and **87.6% of the entire org
runtime**.

**Contributing cause: (2) unusually large signal inventory.** 3,563 NVD signals
are ingested per org per week with **zero deduplication** — NVD's 7-day window is
genuinely new CVEs each week, and each org holds its own row per signal. The LLM
call count is a direct function of this volume × the Critical/High share.

Ruled out, with evidence:

| candidate | verdict |
|---|---|
| (3) provider latency / retries | **No.** p50 5.5 s, p99 13.1 s, no 429s, no quota events, zero fallbacks. Latency is normal for the prompt size. |
| (4) repeated work the verdict cache eliminates | **No — see §6.** Every key on this path is first-time. |
| (5) database behaviour | **No.** ≤9.1% of runtime, ~0.29 s/signal for insert + normalize + dedup + deterministic match. |
| (6) another architectural bottleneck | **Yes, and it is the real story — see §7.** |

---

## 6. Will the already-built packages reduce the 3.15 h floor?

### Verdict cache — **essentially zero effect on this path**

The cache key is
`(organization_id, signal_dedup_hash, control_inventory_digest, prompt_version)`.

The weekly scheduler processes each `(org, signal)` pair **exactly once**:
`ingestSignalsForOrg` skips duplicates at `INSERT … ON CONFLICT DO NOTHING`
*before* they ever reach `processSignal`. This org inserted 3,563 NVD signals
with **0 duplicates** — every one a fresh `dedup_hash`, therefore a fresh cache
key, therefore `miss: absent`, therefore a full-price call.

The cache does exactly what it was designed to do — prevent **duplicate** spend
across the three matcher invocation paths, the crash-recovery sweeper's retries,
and cross-process stampedes. It cannot prevent **first-time** spend, and
first-time spend is 100% of this workload.

Two further points worth recording:

- It is **org-scoped by design**. The same CVE costs one call per org — 13 calls
  across 13 orgs — because each prompt carries that org's own controls. That is
  correct, not waste, but it is why total spend scales as orgs × signals.
- The worker pipeline ingests **entirely different feeds** (regulatory, security
  news, AI governance, vendor risk, regulatory enforcement) — not NVD or KEV — so
  there is no cross-path content overlap to convert into hits here either.

### Bounded org concurrency — **no effect on the per-org floor, by construction**

It parallelises *across* orgs. The 3.15 h is one org's serial runtime and is
unchanged; under contention for the same database and provider it may rise
slightly. This is precisely why the concurrency package's own validation records
a **hard floor of 3.15 h** at any pool size.

### Conclusion

**Neither package materially reduces the 3.15 h per-org floor. Another bounded
architectural change is warranted.**

---

## 7. The bottleneck worth naming

**87.6% of this org's runtime produces output the Intelligence Brief never
reads.**

The LLM control matcher is documented in `cyberSignalProcessingService.ts` as
*"GAP-1: LLM control matcher (suggest-only, AFTER commit, non-fatal)"*. It writes
`signal_match_suggestions` — advisory control suggestions, a different product
surface. Brief generation queries `cyber_signals` only. The brief for this org
would have been byte-identical, and published at **~14:52 instead of 18:00**, had
the matcher not run inline.

So the weekly Brief run is blocked for nearly three hours per slow org on
advisory work that is not on the Brief's dependency path — while the overlap lock
holds and every other org waits.

### Candidate bounded changes, ranked — NOT approved, NOT implemented

**A. Take the matcher off the Brief scheduler's critical path.** Enqueue the
suggestion work instead of awaiting it inline; the intelligence worker already
owns two of the three matcher invocation sites. Projected effect on this org:
**3.15 h → ~0.4 h**, and the run-level floor collapses with it. This is the
architecturally correct fix — the Brief pipeline should not block on a
non-dependency — and it changes no matcher semantics, only *where* the work runs.

**B. Bound-concurrency the matcher inside ingest.** The same `mapWithConcurrency`
primitive already used twice in this codebase. At 6, the 2.76 h of LLM time
becomes ~28 min. Simpler and more local than A, but it keeps the spend on the
critical path and multiplies provider fan-out again — the concurrency package
already took the ceiling from 6 to 12, and this would compound it. Needs its own
provider-envelope analysis.

**C. Tighten the eligibility gate.** Whether every Critical/High CVE warrants a
per-org LLM control match is a product question, not an engineering one. This is
a **cost** lever more than a latency one: at ~1,700 calls/org/week × 13 orgs,
this run implies roughly **20,000+ Sonnet calls per week**, each carrying up to
80 controls. No cost figure exists yet — the LLM telemetry that would produce one
is not on staging.

A and C are complementary: A fixes the latency, C fixes the spend. B is the cheap
tactical option if A is judged too large.

### Scope note

`SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` is declared `"true"` in `render.yaml`
for **production engine** (line 277) as well as staging (line 651) and both
intelligence workers. Per the standing caveat that a declared value is not proof
of a synced one, the live production value is unverified here — but this should
be treated as a production condition until checked, not a staging artifact.

---

## 8. Recommendation

Stop here, as instructed. Before any optimization is built:

1. Confirm the intended product behaviour of the LLM control matcher — is
   per-org, per-Critical/High-CVE suggestion generation the desired steady state?
   That answers C and constrains A.
2. Decide between A and B. A is recommended: it removes the work from the Brief's
   critical path rather than making the wrong-place work faster.
3. Either way, `scheduler_org_complete` telemetry (PR #809) should be live first,
   so the change is measured against a distribution rather than this single run.
