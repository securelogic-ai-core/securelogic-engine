# Weekly Brief run — LLM fan-out analysis and bounded redesign proposal

**Status:** READ-ONLY ANALYSIS. Nothing implemented. Awaiting operator approval.
**Date:** 2026-08-18
**Scope:** why `runScheduler()` takes ~4.5 h, what it costs, and the smallest
redesign that fixes it without touching tenancy or brief quality.

---

## 1. The finding in one paragraph

The run's duration is **not** brief generation. It is a single call site —
`runLlmControlMatcherForSignal` — invoked **once per (newly-inserted signal ×
organization), strictly serially**, with no batching, no concurrency, and no
cache. Measured live on staging 2026-08-18: **12 LLM calls per minute, one org
at a time**, ~5 s per call end-to-end. One organization (`f70267ce`) consumed
**77+ minutes and ~900 calls** by itself. Brief generation proper — enrichment,
headline, exec summary — is a rounding error by comparison (~10–13 minutes for
all 13 orgs combined, because it runs 24-way parallel).

The deeper structural problem: the engine scheduler writes **org-scoped copies**
of globally identical signals (`organization_id = orgId`, unique on
`(organization_id, dedup_hash)`), so the same CVE is stored N times and pays for
N LLM calls. The worker pipeline does the opposite and correct thing
(`organization_id = NULL`, fan-out at match time). The scheduler is the legacy
path and it is the expensive one.

---

## 2. Verified call inventory (one `runScheduler()` pass)

| # | Call | Site | Model | Multiplicity | Concurrency |
|---|---|---|---|---|---|
| A1 | `runLlmControlMatcherForSignal` | `cyberSignalProcessingService.ts:1529` → `llmControlMatcher.ts:175` | `claude-sonnet-4-6`, 1024 max tokens | **per (fresh signal × org)** | **serial** |
| B1 | `enrichItemWithClaude` | `intelligenceBriefGenerator.ts:1274` | `claude-sonnet-4-6`, 1024 | per shortlist item, ≤24/org | 24-way `Promise.all` |
| B2 | `generateHeadline` | `briefSynthesizer.ts:300` | `claude-sonnet-4-6`, 60 | 1 per brief | parallel with B3 |
| B3 | `generateExecSummary` | `briefSynthesizer.ts:489` | `claude-sonnet-4-6`, 450 | 1 per brief | parallel with B2 |

**A1 gating** (`llmControlMatcher.ts:196-232`): flag
`SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` (code default OFF, but `render.yaml`
declares `"true"` on all four services), `signal_type ∈ {cve, patch,
patch_advisory, threat_actor, malware, vulnerability, advisory}`, `severity ∈
{Critical, High}`, and the org has ≥1 `controls` row.

**Corrections to common assumptions** — verified by reading the code:
`personalizeBriefItems` makes **zero** LLM calls (DB + pure mapper);
`runMatcherForSignal` is **pure SQL**; `enqueueApplicabilityReassessment` is a
`jobs` INSERT. The `intelligence-worker`'s `llmClient.ts` is imported only by
the retired legacy-newsletter builder and is dead for cost purposes.

---

## 3. Measured numbers (staging, 2026-08-18 run)

| Measurement | Value | How obtained |
|---|---|---|
| A1 call rate | **120 calls / 10 min = 12/min** | `llm_control_matcher_start` count, 13:00–13:10Z window |
| Concurrency | **1 org at a time, serial within org** | all 120 calls in that window carry one `orgId` |
| Per-call latency | **~5 s** wall-clock | rate ÷ serial execution |
| One org's cost | **77+ min, ~900 calls** (`f70267ce`, 12:04→13:21Z, still running) | `scheduler_org_start` → live tail |
| Run start → 12th org | **07:00 → 12:04Z ≈ 5 h** for 11 orgs | `scheduler_org_start` sequence |

### Fan-out formula

```
LLM_total = Σ_org [ K(org) · |fresh signals with Crit/High + control-relevant type| ]   ← A1, SERIAL
          + Σ_org [ min(24, brief items) ]                                             ← B1, 24-way parallel
          + Σ_org [ 2 ]                                                                ← B2 + B3
```

Only the A1 term scales with `orgs × signals`, and only the A1 term is serial.

### The cold-run cliff

`cyber_signals` dedup is per-org: `CREATE UNIQUE INDEX idx_cyber_signals_dedup
ON cyber_signals (organization_id, dedup_hash)`
(`db/migrations/20260430_cyber_signals_ingestion.sql:88`), and `dedup_hash`
contains no org component (`cyberSignalNormalizer.ts:97-120`). So org 2
inserting the same CVE as org 1 does **not** conflict — it inserts a second copy
and pays for a second LLM call.

The observed run was therefore the **discounted** case: the logs show org 1
inserting 3563 NVD rows while orgs 2–13 report `inserted:0 /
skippedDuplicate:3563`, which is only possible because those orgs were already
warm from a prior run inside the same NVD window. **A genuinely cold weekly run
multiplies the A1 term by ~13** — on the order of 18,000–23,000 serial calls,
i.e. **20–50 hours**. That run cannot complete inside its own weekly cadence,
and every restart during it loses the in-flight org's progress.

### Cost is not instrumented

No token or cost telemetry exists on this path. `instrumentAnthropicClient`
(`providerQuotaAlert.ts`) wraps only the **throw** path (429 / credit
exhaustion) and never reads `message.usage` on success. The only usage capture
anywhere is on the Ask path (`ask/provenancePass.ts:487`, output tokens only).
**Counting `llm_call_start` events in the log stream is currently the only way
to reconstruct volume.** A 4-line change inside `instrumentAnthropicClient`
would cover all four scheduler sites centrally.

---

## 4. Which work is genuinely redundant

| Call | Prompt inputs | Org-private? | Reducible how |
|---|---|---|---|
| **B1 enrichment** | `summary`, `vendor`, `cve`, `severity`, `signal_type`, `category` — all signal-derived. `organizationId` appears only in log lines, never in the prompt. | **No** | **Fully cacheable across orgs.** Two orgs with the same signal send a byte-identical prompt and pay twice. |
| **B2 headline** | top-8 items' title + severity | **No** | Cacheable when top-8 vectors coincide. |
| **A1 control matcher** | signal summary **+ the org's `controls` rows** (LIMIT 80) | **Yes** | **Not cacheable across orgs** (and sharing would breach tenancy). Must be **restructured**. |
| **B3 exec summary** | items + **prior brief context** (org-private) | **Yes** | Not cacheable. |

**The crux:** the cacheable work is the small term; the dominant term is
org-private and needs structural change, not a cache.

---

## 5. Restart exposure

Three unpersisted-progress hazards, in severity order:

1. **Silent permanent signal loss (correctness, not just cost).** In
   `ingestSignalsForOrg`, rows are COMMITTED first, then `processSignal` runs
   afterward over an in-memory `toProcess[]` (`briefScheduler.ts:229` then
   `:253-256`). A crash between them leaves rows committed with
   `processed = FALSE`; the next run's INSERT returns 0 rows (duplicate), so
   they are **never re-added to `toProcess`** and never processed. No sweeper
   for `processed = FALSE` exists — only a manual one-signal-at-a-time
   reprocess route (`routes/cyberSignals.ts:2151`).
2. **Orphan `generating` briefs.** The Phase-1 brief row commits, then Phase 2's
   Claude calls run outside any transaction. A crash there leaves
   `status='generating'` forever; the idempotency skip set requires
   `status='published'`, so it is never cleaned up or retried.
3. **In-memory run state.** All nine feed payloads and the whole `summary`
   accumulator are lost on restart. NVD and Federal Register have no
   conditional-GET path, so they are fully re-fetched.

**Existing resumability:** exactly one level — the per-org skip added in
`8d03c4d5` (this branch). It is org-granular; an org interrupted mid-ingest
restarts from the beginning of that org.

**Concurrency guard is in-process only** (`let isRunning`), and the manual
trigger **bypasses it**: `routes/adminBriefs.ts:97` calls `runScheduler()`
directly rather than `runSchedulerGuarded()`. Two engine instances, or one
admin trigger during the cron run, would both execute a full pass.

---

## 6. Existing mitigations and flags

**Caching:** Redis ETag store for CISA KEV / MITRE ATT&CK / ATLAS only
(`feedEtagStore.ts`, no TTL, fail-open). NVD, SEC EDGAR, Federal Register and
both RSS bundles have no conditional GET. **No LLM response cache anywhere.**

**Caps** bound per-call token size, never call count: `ENRICHMENT_SHORTLIST=24`,
`BRIEF_MAX_ITEMS=12`, `MAX_CONTROLS_IN_PROMPT=80`, `SIGNAL_SUMMARY_BUDGET=1200`.

**Concurrency/rate limiting:** none. No `p-limit` anywhere in `src/` or
`services/`; no retry or backoff on Anthropic calls (failures degrade silently
to template fallback).

| Flag | Code default | Declared in render.yaml | Effect on LLM volume |
|---|---|---|---|
| `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` | OFF | **`"true"` all four services** | **The cost driver.** OFF removes the entire A1 term. |
| `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` | OFF | `"false"` | Fewer brief items → marginal B1 cut. No A1 effect. |
| `SECURELOGIC_SIGNAL_CLUSTERING_ENABLED` | OFF | undeclared | Marginal B1 cut. No A1 effect. |
| `SECURELOGIC_BRIEF_RELEVANCE_ENABLED` | OFF | undeclared | Marginal B1 cut. No A1 effect. |
| `SECURELOGIC_SIGNAL_RECENCY_ENABLED` | OFF | staging `"true"`, prod `"false"` | Marginal B1 cut. No A1 effect. |
| `SECURELOGIC_SOURCE_QUALIFICATION_ENABLED` | OFF | undeclared | **Increases** cost (per-org reliability recompute). No LLM change. |

**Duplication across services:** `runLlmControlMatcherForSignal` has **three
uncoordinated invocation sites** — the engine scheduler
(`cyberSignalProcessingService.ts:1529`), the worker pipeline
(`runPipeline.ts:337`, hourly), and the KEV poller (`kevPoller.ts:278`, every
15 minutes) — each fanning out over orgs with no shared budget. The 15-minute
KEV poller × N orgs × Sonnet is continuous background spend that the weekly-run
figures above do not even include. Signal ROWS are not duplicated (org-scoped
vs NULL-org indexes are disjoint, and the brief reads both), but the LLM work
class is.

---

## 7. Bounded redesign proposal (for approval — not implemented)

Sequenced smallest-first. Each step is independently shippable and independently
valuable; **stop after any step** if the result is good enough.

### Step 0 — Instrument before optimizing (half a day)
Capture `message.usage` centrally in `instrumentAnthropicClient` and add a
per-run aggregate keyed by `(purpose, model, org)` to `SchedulerRunSummary`.
Without this, every claim about cost improvement is unfalsifiable. **Do this
first regardless of which later steps are approved.**

### Step 1 — Bound the blast radius (1 day, no behavior change)
Add a concurrency limiter and a per-run A1 call budget with a loud log when it
trips; route the admin trigger through `runSchedulerGuarded` so it cannot race
the cron. Modest speedup (parallelism), large reduction in worst-case exposure.
**Recommended even if nothing else is approved.**

### Step 2 — Idempotent per-signal LLM work (2–3 days) ⭐ **highest value/risk ratio**
Persist the control-matcher verdict keyed by `(organization_id, dedup_hash,
control-inventory hash, prompt version)` and consult it before calling. Re-ingesting
the same CVE for the same org — which is what most of the observed 12 calls/min
actually are — becomes free. Preserves tenancy exactly (the key includes the
org), preserves output quality (same prompt, same model), and is invalidated
correctly when the org's controls change. **This alone should remove most of the
4.5 hours.**

### Step 3 — Cross-org enrichment cache (1–2 days)
Cache B1 enrichment on `(dedup_hash | cluster_key, prompt version)`. Safe
because the prompt provably contains no org-private data — but that property
must be **pinned by a test**, or a future edit could silently leak org context
into a shared cache. Smaller win (~minutes), cheap to do.

### Step 4 — Fix the correctness gaps (1–2 days, independent of performance)
A sweeper for `processed = FALSE` signals and for orphaned `generating` briefs.
These are silent-data-loss bugs, not performance work; they deserve their own
package and arguably outrank Steps 2–3.

### Step 5 — Structural: stop storing global signals per-org (large — separate program)
Converge the engine scheduler onto the worker's model (`organization_id = NULL`
+ fan-out at match time), eliminating N-fold storage and N-fold LLM work at the
source. This is the correct end state and matches the ratified external-signal
architecture, but it touches tenancy, dedup, the brief query and the matcher —
**a program, not a package.** Do not start it before Steps 0–2 prove the cheaper
wins are insufficient.

### Explicitly NOT recommended
Turning `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` off. It would reclaim ~4 of
the 4.5 hours instantly, but it deletes a customer-facing capability
(signal→control suggestions) to fix an engineering problem. It is worth holding
as a documented **emergency lever** if a cold run ever threatens the cadence.

---

## 8. Open questions for the operator

1. **Is the cold-run cliff real in production?** Prod org count and NVD warmth
   determine whether prod is already at risk. Step 0's instrumentation answers
   this; a prod log count of `llm_control_matcher_start` would answer it sooner.
2. **What is the control-matcher's actual customer value?** If suggestion
   accept-rates are low, Step 5 becomes less urgent and the emergency lever
   becomes more palatable.
3. **Approve Step 0 + 1 immediately, or wait?** They are low-risk, reversible,
   and make everything after them measurable.

---

## Verification note

All code claims cite `file:line` and were read directly. The runtime numbers in
§3 are from live staging logs on 2026-08-18 (read-only queries; no staging state
was touched, and the M-1 soak was not disturbed). The one number **not**
verified is the cold-run projection in §3 — it is arithmetic from the per-org
dedup constraint, not an observation, and it should be confirmed by
instrumentation rather than trusted as-is.
