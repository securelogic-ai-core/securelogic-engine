# Brief scheduler — bounded per-org concurrency: measurement record

> ## CORRECTED BASELINE — authoritative
>
> | measure | value |
> |---|---|
> | Measured sequential run | **10.99 h** (13 orgs, 13 published, 0 errors) |
> | Projected concurrency-2 run | **~6.24 h** |
> | Longest individual org | **~3.15 h** — hard floor at any pool size |
> | Prior ~4.5 h characterization | **SUPERSEDED — do not use** |
>
> Deadline calibration requires **≥ 3 weekly cycles** of `scheduler_org_complete`
> telemetry collected *after* the verdict cache and bounded concurrency are live,
> with the threshold set from the observed distribution (ADR-0008).
>
> The 3.15 h floor is decomposed in
> `docs/investigation/brief-scheduler-slowest-org-decomposition.md`: **87.6% of it
> is sequential LLM control-matcher calls whose output the Brief never reads.**
> Neither the verdict cache nor org concurrency reduces it.


Branch: `perf/brief-scheduler-bounded-org-concurrency`.
Measured 2026-08-18.

**MERGE HOLD — M-1 SOAK IN PROGRESS.** This branch is pushed for review only.
It must not reach `develop` until the M-1 staging soak
(`docs/validation/m1-staging-soak.md`) exits, because `develop` is what all
seven staging services deploy from — merging would redeploy the estate mid-soak
and invalidate the soak clock. Concurrency limit is fixed at **2** for this
package; changing it is a separate, separately-measured decision.

## What changed

The weekly Brief run processed organizations in a strict `for` loop, mutating a
single shared `SchedulerRunSummary` as it went. It now runs them through a
fixed-size worker pool — `ORG_CONCURRENCY = 2`, a hard-coded constant, not an
env var — where each org produces its **own sealed result** and the scheduler
merges those results, in org-enumeration order, after completion.

Per-org behaviour is unchanged. The per-org pipeline body was verified to be a
purely mechanical transform of the previous loop body (shared-summary writes →
private draft, `continue` → `return`, feed arrays → one frozen bundle); nothing
else in the step order, error handling, or logging moved.

## Wall-clock: measured A/B

Both arms run the **real** `runScheduler`, the real worker pool, and the real
per-org step order. The A/B swaps **only** `src/api/lib/briefScheduler.ts`
between git states; every mock and every parameter is identical.

Harness: `scripts/bench/briefSchedulerOrgConcurrency.bench.ts`

```
npx vitest run --config scripts/bench/vitest.bench.config.ts        # concurrent arm
git stash push -- src/api/lib/briefScheduler.ts
npx vitest run --config scripts/bench/vitest.bench.config.ts        # sequential arm
git stash pop
```

13 orgs (staging's current population). Best of 3 after a discarded warm-up:

| profile | sequential | concurrent (2) | ratio |
|---|---|---|---|
| uniform — every org costs the same | 1540 ms | 828 ms | **1.86x** |
| skewed — one org costs 10x the rest | 2080 ms | 1067 ms | **1.95x** |

Repeat runs varied by <3 ms per arm.

### What these numbers are NOT

**The per-org latency in this harness is synthetic**, so the absolute
milliseconds say nothing about production and only the *ratio* is evidence. The
harness simulates neither database contention nor provider rate limiting.

Supersede this table with the real-duration projection below wherever the two
disagree.

## Real staging measurement (2026-08-18) — supersedes the synthetic projection

The weekly cron fired on staging while this branch was being built, and the run
completed cleanly. This is the actual sequential baseline, not a model.

`scheduler_cron_complete`, staging engine (`srv-d7n0rju8bjmc738jbs7g`):

```
durationMs 39624403  (10.99 h)   active_orgs 13   orgs_processed 13
briefs_generated 13  emails_sent 7  emails_failed 0  errors []
```

Per-org durations, derived from consecutive `scheduler_org_start` timestamps
(last org measured to run completion):

| org | duration | | org | duration |
|---|---|---|---|---|
| 0d8f5fa4 | 8.7 min | | 65a1b20b | 9.8 min |
| 14a6b864 | 8.9 min | | 8c7209e0 | 12.0 min |
| **295b989a** | **109.6 min** | | a0755951 | 12.1 min |
| 3b82e322 | 8.3 min | | **b1a3da2d** | **98.8 min** |
| 3cf08bbb | 9.0 min | | **f70267ce** | **167.0 min** |
| 44fd5f70 | 15.7 min | | **fe2ede61** | **188.8 min** |
| 55041494 | 11.0 min | | | |

**median 12.0 min · mean 50.7 min · max 188.8 min.** Four orgs exceed 3x the
median and account for **86% of the entire run**.

### Projected concurrent runtime, from the real durations

Simulating this branch's worker pool over the measured per-org durations, in
enumeration order:

| pool | makespan | speedup |
|---|---|---|
| 1 (today) | 10.99 h | 1.00x |
| **2 (this branch)** | **6.24 h** | **1.76x** |
| 3 | 4.97 h | 2.21x |
| 4 | 3.76 h | 2.93x |

- Perfect-split bound at pool=2: 5.50 h.
- **Hard floor: 3.15 h** — the single longest org. No amount of org-level
  concurrency goes below the longest single org.

So the honest expected improvement is **~11 h → ~6.2 h (1.76x)**, not the
1.86–1.95x the synthetic harness suggested. The assumption in that projection is
that per-org duration is unchanged when two orgs run together; two orgs sharing
the database and the provider may each run slightly slower, which would push the
result above 6.24 h.

### Where the time actually goes — and why this matters more than concurrency

`brief_enrichment_summary` for **every one of the 13 orgs**: `total 24,
enriched_count 24, fallback_count 0`. Identical work, zero provider degradation.
Enrichment finishes 1–2 min before each org's window closes.

The variance is entirely in **ingest**. Each org inserts the same 3,563 NVD +
1,666 KEV signals with **zero duplicates**, and `processSignal` runs the matcher
on every one — sequentially, at a measured ~0.09 s/signal for the fastest org
and ~2 s/signal for the slowest. Ingest is **~98% of per-org time**;
`matcher_run_for_signal` shows deterministic branches (`vendor_name_ilike`,
`no_match`), so this is **database-bound, not LLM-bound**.

Two consequences worth recording:

1. Org-level concurrency is the right change but not the big one. The dominant
   cost is ~5,300 sequential per-signal matcher runs per org per week — 69,000
   across the estate. That is a separate package.
2. This run predates the verdict-cache work on this branch's ancestry
   (`bfe79f78`), which staging does not yet have. Any per-org profile derived
   from this run must be re-derived after that lands.

## Provider-facing consequence

Peak simultaneous Anthropic requests **doubles**: enrichment fans out at
`ENRICHMENT_CONCURRENCY = 6` per org, and two orgs now enrich at once, so the
ceiling moves from 6 to **12**. This is asserted by test, not assumed.

Retry and quota behaviour itself is untouched — no code path in the SDK wrapper,
the quota alerting, or the verdict-cache retry budget was modified.

## Verdict cache

The reservation key is `(organization_id, signal_dedup_hash,
control_inventory_digest, prompt_version)`. Two concurrent orgs address
different rows **by construction**, so org-level concurrency can neither
duplicate spend nor create false contention. Both halves are pinned by test.

## Residual risks — ACCEPTED AND RECORDED AT MERGE-HOLD

These four are the accepted risk position for this package. They are recorded
here as the standing register; none is a blocker for the branch, and risk 4 is
a hard gate on a flag that is currently off everywhere.


1. **Within an org, nothing is parallel.** Nine feed ingests, then generation,
   then send, still run strictly in order for a given org. A slow feed still
   delays that org's own brief. Unchanged by design.
2. **One stuck org halves throughput.** With a bound of 2, an org parked in a
   long call leaves a single worker to drain the tail. The measured skewed
   profile shows this is still a large improvement over sequential, but the
   degradation is real and scales with how slow the outlier is.
3. **There is currently no per-org deadline.** Measured: one org held the
   single sequential worker for 188.8 min. The Anthropic client also uses SDK
   defaults (10 min timeout, `maxRetries` 2, timeouts retried), so one call can
   in the worst case block ~30 min — but that is NOT what the 2026-08-18 run
   shows. The measured slot-holding cost is the **ingest loop** (~98% of org
   time, DB-bound), not enrichment. A per-org deadline is deliberately NOT in
   this change; it is the next independent reliability package, design-first.
4. **`SECURELOGIC_SOURCE_QUALIFICATION_ENABLED` would create concurrent global
   source-reliability sweeps if enabled, and MUST be addressed before that flag
   is activated.** With the flag on, `recomputeSourceReliability` sweeps the
   global `sources` table once per org, so two orgs would now sweep it
   concurrently — the same values written, but concurrent full-table UPDATEs on
   identical rows. The flag is absent from `render.yaml`, so this is dormant in
   every declared environment today. Hoisting that call out of the per-org path
   is the fix. It is out of scope here because it would change per-org
   semantics, and it is a **prerequisite of turning the flag on**, not of
   merging this branch.

## Database

Pool size unchanged (pg default, 10 per pool; two pools). Peak simultaneously
open tenant scopes is bounded at 2 and proven independent of population size —
a 40-org run still demands 2. No scope leak: open-scope count returns to 0.
