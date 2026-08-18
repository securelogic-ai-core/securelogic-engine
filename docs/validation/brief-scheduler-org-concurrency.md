# Brief scheduler — bounded per-org concurrency: measurement record

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

**The per-org latency in this harness is synthetic.** The repository records no
per-org timing for a production Brief run — `scheduler_cron_complete.durationMs`
is logged but no captured value exists in any document — so the step costs are
parameters, not observations. Only the **ratio** between the two arms is
evidence, and it is an **upper bound**: the harness simulates no database
contention and no Anthropic rate limiting, both of which are real in production
and both of which push the achieved ratio below 2x.

No production speedup is claimed here. The honest claim is: on identical
workloads, the restructuring removes the serialization, and the observed ratio
approaches the theoretical ceiling of 2x when contention is absent.

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
3. **No per-org timeout exists.** The Anthropic client is constructed with SDK
   defaults (`timeout` 10 min, `maxRetries` 2, timeouts retried), so a single
   pathological enrichment call can hold a slot for roughly half an hour before
   it resolves. A per-org deadline is deliberately NOT in this change; it is
   the next independent reliability package, design-first.
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
