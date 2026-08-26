# Tier-2 gate design — #826 split into 2A (deterministic) and 2B (live)

**Status:** proposed with this package. Supersedes the single flat checklist in
the body of #826.
**Scope:** the `develop` → `main` promotion gate for Wave 4 (`a8081aca`, #817).
**Author's constraint:** no promotion, no merge, no production change is
proposed here. This document defines what "discharged" means and what evidence
counts.

---

## 0. Why #826 had to be split

#826's checklist mixes two incompatible kinds of claim behind one PASS:

- **Correctness claims** — "a digest change forces recompute", "only
  `answered` is reused", "no cross-org collision", "an interrupted run
  reconciles". These are properties of SQL keys, policy functions and recovery
  code. A live run cannot *prove* them; it can only fail to contradict them. It
  cannot force a digest change, cannot manufacture a non-reusable state, cannot
  produce an interruption on demand, and on staging never produced a colliding
  cache key at all.
- **Operational claims** — "the scheduler actually fires", "the worker actually
  processes eligible work", "the concurrency ceiling is observed in a real
  multi-org run". These genuinely require the deployed environment and cannot be
  faked in a test harness.

Holding both behind "wait for the 2026-09-01 cron" made the correctness half
unprovable-by-waiting and the operational half indefinitely deferred. Worse, it
made *silence* look like progress: F-1 (#883) sat undetected for five days
inside a gate that was nominally being observed.

**The split:** Tier 2A is proven deterministically, now, in CI. Tier 2B is
proven by observing the deployed staging environment. #826 discharges only when
**both** pass.

---

## 0.1 F-4 DISPOSITION — ALREADY BUILT, MISDIAGNOSED

**F-4 as filed ("`scheduler_run_complete` omits `org_concurrency`, `llm` and
`verdict_cache`, so a cron-fired run is not self-evidencing") is CLOSED as
already-built.** The finding read the inner event
(`briefScheduler.ts`, end of `runSchedulerPass`) and correctly saw the fields
missing there. The outer event `scheduler_cron_complete`
(`schedulerRunner.ts`) spreads `...summary` *after* the accumulators close and
has carried all three, plus `trigger` and `durationMs`, since before the gate ran.

Verified against the actual 2026-08-25 staging log:

```
10:14:33.592Z  scheduler_cron_complete  trigger="cron"  durationMs=11673542
  llm:             {calls:338, input_tokens:286281, output_tokens:168442,
                    cost_usd:3.385473, unpriced_calls:0, failed_calls:0, by_purpose:{…}}
  verdict_cache:   {hits:0, misses:0, lookups:0, tokens_saved:0, …}
  org_concurrency: {limit:2, peak_in_flight:2}
```

`peak_in_flight: 2` was in the log the entire time it was being reconstructed
from `scheduler_org_start`/`_complete` interval pairs, and `trigger: "cron"` is
the direct proof — never used — that the banned admin trigger was not involved.

**What was actually wrong is worse, and is the reason this section exists.**
The `verdict_cache` zeros above are not a measurement. Since Wave 4 the matcher
runs in `securelogic-intelligence-worker`; the accumulators are begun only in
the engine process, and `server.ts` does not start that worker. So the engine
cannot observe a single lookup, and `llm.by_purpose` never contains
`llm_control_matcher` — while the worker made **133 matcher provider calls in
the 09:00–09:30Z window alone**, inside the same run. Left alone, 2026-09-01
would not have returned NOT-ENOUGH-DATA; it would have returned **confidently
wrong numbers**: matcher spend $0, cache activity zero.

Corrected by the F-4 follow-up package:
- the scheduler publishes `NOT_MEASURED_IN_THIS_PROCESS` instead of zeros it
  cannot produce (`outOfProcessMetric.ts`);
- the matcher worker reports its own totals on `control_matcher_tick_complete`,
  aggregated per **worker tick** — the narrowest truthful boundary;
- the stale comment claiming `by_purpose.llm_control_matcher` was "what was
  PAID" is corrected at the source.

---

## 1. TIER 2A — DETERMINISTIC CORRECTNESS

Runs in CI. No deployed environment, no cron, no network, no destructive
staging fixture. A Tier-2A failure is a **correctness/release failure**.

| # | Criterion | Evidence | Verdict |
|---|---|---|---|
| 2A-1 | Cross-org RLS on `llm_control_matcher_verdicts` holds under a deliberately colliding key | `test/isolation/llmVerdictCacheRls.test.ts` (pre-existing) | **PASS** |
| 2A-2 | The same control inventory yields the same digest and reuses the stored answer | `test/isolation/verdictCacheDigestRecompute.test.ts` §A | **PASS** |
| 2A-3 | A changed control inventory changes the digest and forces recomputation | `verdictCacheDigestRecompute.test.ts` §A | **PASS** |
| 2A-4 | A prompt-version bump is its own miss reason, not inventory churn | `verdictCacheDigestRecompute.test.ts` §A | **PASS** |
| 2A-5 | Only `state='answered'` is ever reused (`unparseable` / `failed` / `dead_lettered` are not) | `verdictCacheDigestRecompute.test.ts` §B | **PASS** |
| 2A-6 | No cross-org reuse under identical hash **and** identical digest | `verdictCacheDigestRecompute.test.ts` §C | **PASS** |
| 2A-7 | Reservation prevents duplicate provider spend; a stale reservation is re-claimable | `verdictCacheDigestRecompute.test.ts` §D | **PASS** |
| 2A-8 | An interrupted job is re-claimed and driven to a correct terminal state; a live lock is not stolen | `test/isolation/controlMatcherInterruptedRun.test.ts` §A | **PASS** |
| 2A-9 | Re-execution after interruption does not duplicate work or spend | `controlMatcherInterruptedRun.test.ts` §A | **PASS** |
| 2A-10 | Repeated failure dead-letters visibly rather than looping | `controlMatcherInterruptedRun.test.ts` §A | **PASS** |
| 2A-11 | An org stuck in `generating` or `failed` is reconciled next pass; a `published` org is skipped (no duplicate edition) | `controlMatcherInterruptedRun.test.ts` §B | **PASS** |
| 2A-12 | Global signals (`organization_id IS NULL`) reach the matcher and produce per-org suggestions — **F-1 / #883 + #884** | `test/isolation/controlMatcherGlobalSignal.test.ts` | **PASS** |
| 2A-13 | Global admission is not a wildcard: another org's private signal is still refused | `controlMatcherGlobalSignal.test.ts` §2 | **PASS** |
| 2A-14 | Zero-match and multi-match behaviour: empty is a cacheable answer, matches are ranked/filtered/capped, foreign control ids are dropped | `controlMatcherGlobalSignal.test.ts` §1 | **PASS** |

### 2A-1 — why the existing RLS test is sufficient

`llmVerdictCacheRls.test.ts` asserts isolation with a **deliberately colliding
key**: same `signal_dedup_hash`, same `control_inventory_digest`, same
`prompt_version`, different org. It covers SELECT, cross-org SELECT by explicit
`organization_id`, cross-org UPDATE (cache poisoning), `WITH CHECK` on INSERT,
unset-GUC fail-closed, empty-string-GUC fail-closed, absence of a DELETE grant,
and `ON DELETE CASCADE` for org erasure.

#826's live phrasing was *"`llm_control_matcher_verdicts` populated for ≥ 2
organizations … RLS confirmed … no cross-org key collision"*. Populating two
orgs was never the goal — it was the *precondition* the live run needed before
the RLS claim could be observed at all. The isolation test creates that
precondition by construction and asserts the claim more strongly than any
organic run could, because organic traffic is not guaranteed to produce a
colliding key. **No additional staging or `render psql` `SET ROLE` privilege is
requested, granted, or required.**

### 2A deliberate omission — `tokens_saved > 0`

See §2. It is not a Tier-2A criterion and not a Tier-2B criterion.

---

## 2. CACHE REUSE — CLASSIFICATION

The empirical finding from the 2026-08-25 gate observation:

| fact | value |
|---|---|
| `control_matcher_suggest` jobs | 27,586 |
| distinct (org, signal) pairs | 27,586 |
| natural duplicate lookups | **0** |
| `answered` verdict rows | 9,123 |
| `verdict_cache.tokens_saved` | **0** |

This is not a sampling artefact. It is **structural**, and the schema proves it:
`cyber_signals.dedup_hash` is UNIQUE per organization (and unique globally for
`organization_id IS NULL` — `20260420_cyber_signals_allow_null_org.sql`). The
cache key is `(organization_id, signal_dedup_hash, control_inventory_digest,
prompt_version)`. Therefore **two DISTINCT signals can never share a cache key
within one org**, and a re-ingested CVE never creates a second row to look up
(`ON CONFLICT DO NOTHING`). Cross-org does not help either: the same global
signal produces 13 different keys for 13 orgs, by design.

Splitting the mechanism as the ruling requires:

**A. Reservation / concurrency control — LOAD-BEARING. Retained and tested.**
`reserveVerdict`'s `INSERT … ON CONFLICT` is the cross-process stampede guard
across the three matcher invocation sites, and its `attempts` increment is the
retry budget that makes exhaustion reachable. Without it, concurrent workers
duplicate provider spend and a permanently failing key never dead-letters.
Covered by 2A-7 and 2A-10.

**B. Answer reuse / token saving — DORMANT / NO OBSERVED VALUE, as a saving
mechanism.** There is no reachable workflow in the current architecture that
generates a second lookup for a key that already holds an answer, other than
**re-execution of the same (org, signal)**. That replay path *is* load-bearing —
it is what makes a re-claimed job after an interruption free and non-duplicating
(2A-9) — but it is a **duplicate-safety** mechanism, not a token-saving one.
Expected steady-state saving: zero.

**Consequences, per the ruling:**

- `llm_verdict_cache_lookup` `outcome:"hit"`, `verdict_cache.tokens_saved > 0`
  and `cost_saved_usd > 0` are **REMOVED from mandatory Tier-2B PASS criteria**.
  They are classified **NOT APPLICABLE — dormant by design**, with the
  justification above. They remain useful telemetry; they are not a gate.
- Cache-hit traffic **must not be manufactured** to satisfy a gate.
- The cache implementation is **NOT removed** in this package. Removal is not
  required for correctness, and the reservation half is load-bearing.
- Follow-up recommendation (post-launch, not this package): see §5.

---

## 3. TIER 2B — LIVE OPERATIONAL VALIDATION

Only criteria that legitimately require the deployed staging environment.
Nothing here is a correctness test that Tier 2A already covers. A Tier-2B
failure is an **operational/release failure**.

### 3.0 EVIDENCE MODEL — WHICH PROCESS PRODUCES WHICH NUMBER

**Added 2026-08-25 after the F-4 re-examination. Read this before reading the
criteria table; the 2026-08-25 observation went wrong here, not in the criteria.**

Wave 4 split this system across two services. Any criterion that names a
"source" without naming a **process** is unverifiable, because the two processes
measure different things and neither can see the other:

| Producer (service) | Event | Aggregation window | Correlation key | Carries |
|---|---|---|---|---|
| `securelogic-engine` | `scheduler_run_start` | one Brief run | — (one run at a time, in-process lock) | run started, `isSendDay` |
| `securelogic-engine` | `scheduler_run_complete` | one Brief run | temporal adjacency to `scheduler_cron_*` | org counters, email counters, `org_concurrency` |
| `securelogic-engine` | `scheduler_cron_complete` | one Brief run | `trigger` + `durationMs` | **everything in `scheduler_run_complete` PLUS the full `llm` totals and `trigger`** — this is the authoritative per-run line |
| `securelogic-intelligence-worker` | `control_matcher_tick_complete` | **one worker tick** (drain-to-empty, non-overlapping) | none to a Brief run — see below | `processed`, `duration_ms`, matcher `llm` totals, `verdict_cache` totals |
| `securelogic-intelligence-worker` | `llm_call_usage`, `llm_verdict_cache_lookup` | one call / one lookup | `organizationId` | per-event detail, un-aggregated |

**THERE IS NO PER-BRIEF-RUN MATCHER ATTRIBUTION, AND THE GATE MUST NOT ASK FOR
ONE.** Matcher work is asynchronous by design: the tick fires every minute
whether or not the scheduler is running, and a signal enqueued by a Brief run is
routinely matched hours after that run ended (observed 2026-08-25: matcher calls
at 12:59Z for a run that completed at 10:14Z). Summing worker events inside the
Brief run's wall-clock window would produce a number that looks like per-run
matcher cost and is not one. The worker tick is the narrowest **truthful**
boundary, so that is what 2B measures.

### 3.0.1 MANDATORY OBSERVATION RULE — QUERY BY RESOURCE, NEVER BY `env`

**Every Tier-2B query MUST be scoped to an explicit Render resource id
(`render logs -r srv-…`). Filtering a merged log export on `service`, `env` or
`appEnv` is BANNED for this gate.**

The four services disagree about their own identity:

| Service | `service` | `env` | `appEnv` |
|---|---|---|---|
| staging engine | `securelogic-engine` | **`production`** | `staging` |
| production engine | `securelogic-engine` | `production` | `production` |
| staging intelligence worker | `securelogic-engine` | `staging` | **`null`** |
| production intelligence worker | `securelogic-engine` | `production` | `production` |

Consequences, stated plainly because they are load-bearing for this gate:

- `service` is **`securelogic-engine` on every service**, workers included. It
  cannot separate anything.
- The **staging engine reports `env: "production"`**. A merged export filtered
  `env == "production"` silently absorbs staging-engine lines into production;
  filtered `env == "staging"` it silently DROPS them.
- The two staging services disagree with **each other** — engine says
  `production`, worker says `staging` — so no single `env` filter selects
  "staging" as a whole.
- Almost all scheduler evidence (2B-1…2B-5, 2B-14) comes from the staging
  **engine**: the one service whose `env` is wrong.

This does **not** invalidate Tier 2B, because resource-scoped queries never
consult these fields. It invalidates any analysis that does. Tracked separately
as **issue #886**; **not fixed in this package** — changing environment
labelling mid-gate would alter the evidence surface the gate is about to be
measured on. If gate evidence is ever exported and merged, #886 becomes
blocking.

**A criterion whose source is "run summary" may only cite fields the engine
process actually measures.** Since Wave 4 the scheduler cannot observe the
verdict cache at all, and `SchedulerRunSummary.verdict_cache` is therefore the
explicit marker `NOT_MEASURED_IN_THIS_PROCESS` rather than zeros. **A zero from
the wrong process is not evidence.** That substitution — zeros standing in for
an absent measurement — is what produced the 2026-08-25 finding that the cache
did nothing, and separately what made F-4 look like a missing-field defect when
the fields were present on `scheduler_cron_complete` all along.

**Governing rule: a quiet environment must not FAIL.** Where the metric depends
on traffic that may not occur in the window, the verdict is
**NOT-ENOUGH-DATA**, which is *not* a PASS — it holds the gate open and names
what is still owed. Only where traffic itself is the thing under test does
absence become a FAIL.

| ID | Metric | Expected | Source | Window | PASS | FAIL | NOT-ENOUGH-DATA |
|---|---|---|---|---|---|---|---|
| 2B-1 | Scheduler actually fires on the cron | exactly 1 run started, `trigger == "cron"` | `scheduler_run_start` + `scheduler_cron_fired` in **`securelogic-engine`** (NOT `scheduler_run_started` — no such event exists; the 2026-08-25 sheet cited it) | the Tue 07:00Z run + 60 min | exactly 1, `trigger=="cron"` | 0, > 1 (double-fire), or `trigger` is `manual` (the banned admin path) | n/a — the cron either fired or it did not, and this IS the traffic under test |
| 2B-2 | Eligible orgs are actually processed | `orgs_processed` > 2 | run summary | same | > 2 | 0 while `active_orgs > orgs_skipped_already_current` | every org already current → record NOT-ENOUGH-DATA, re-observe next edition boundary |
| 2B-3 | Org concurrency ceiling observed | `org_concurrency.peak_in_flight` > 0 and ≤ 2 | `scheduler_cron_complete` **or** `scheduler_run_complete` (`securelogic-engine`) — both now carry it; do NOT reconstruct it from `scheduler_org_start`/`_complete` interval pairs, which is what 2026-08-25 did unnecessarily | same | 1 or 2 | > 2 (ceiling breached) | `orgs_processed` ≤ 2, so the ceiling could not be exercised |
| 2B-4 | One slow org does not block the rest | per-org start/end intervals overlap; remaining orgs complete after the slowest | per-org telemetry | same | overlap observed **and** all non-deadline orgs complete | a deadline-exceeded org aborts the run | fewer than 2 concurrent orgs in the window |
| 2B-5 | Counter accuracy under real concurrency | `active_orgs == orgs_processed + orgs_skipped + orgs_skipped_already_current`; `briefs_generated` == count of new published editions | run summary + `intelligence_briefs` | same | identity holds | any mismatch | run did not process ≥ 1 org |
| 2B-6 | Matcher worker actually processes eligible work | `control_matcher_job_completed` > 0 | intelligence-worker log | 24 h | > 0 | 0 while queued jobs exist and the flag is on | 0 queued jobs in the window (quiet feed) |
| 2B-7 | **Global signals no longer dead-letter** (F-1 exit) | failed `control_matcher_suggest` jobs whose signal is global | `jobs` ⋈ `cyber_signals` | 7 days post-deploy | **0** | ≥ 1 | 0 global Critical/High signals ingested in the window |
| 2B-8 | Matcher queue lifecycle is healthy | no job in `processing` with `locked_at` older than `LOCK_TIMEOUT_MS`; dead-letter count does not grow | `jobs` | 24 h | both hold | a stranded job survives two tick intervals | worker idle all window |
| 2B-9 | Matcher failure does not block Brief publication | briefs publish in a run where ≥ 1 matcher job failed | run summary + `jobs` | same | publication unaffected | a matcher failure correlates with a missing edition | no matcher failure occurred (a good outcome — record as N/A for the window) |
| 2B-10 | Latency: the matcher is off the Brief critical path | slowest org's wall clock no longer dominated by provider calls | per-org telemetry vs the 2026-08-18 baseline (87.6%) | same | provider share materially below baseline | at or above baseline | run did not process a comparable org |
| 2B-11 | Deployed configuration matches intent | `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED`, worker service present, migrations applied | live service env + `schema_migrations` | at observation | all as declared | any drift | n/a |
| 2B-12 | Regression surface | zero new error-level logs; no 42501 / RLS / `db_query_outside_tenant_scope`; M-1 `app_request` runtime separation intact | all service logs | same | zero | ≥ 1 | n/a |
| 2B-13 | Operational reconciliation visibility | an interrupted run, if one occurs, is visible and reconciles | logs + `intelligence_briefs` | 7 days | reconciled and visible | stuck `generating` persists across two runs | no interruption occurred — **N/A, correctness proven by 2A-8/2A-11** |
| 2B-14 | **Brief-run AI spend is reported without arithmetic** | `llm.calls` > 0 and `llm.cost_usd` > 0 for the run | `scheduler_cron_complete` (`securelogic-engine`) — the ONLY line with closed LLM totals | the Tue 07:00Z run + 60 min | present and > 0 | event absent, or `llm` missing | run generated 0 briefs |
| 2B-15 | **Matcher spend is measured where it happens** | ≥ 1 `control_matcher_tick_complete` carrying non-null `llm` with `calls` > 0 | `control_matcher_tick_complete` (`securelogic-intelligence-worker`) | 24 h — **worker ticks, NOT the Brief run window** | ≥ 1 tick with matcher calls | ticks processed jobs but `llm` is null on every one (accumulator not owned — a defect) | 0 jobs drained in the window (quiet feed) |
| 2B-16 | **Cache behaviour is measured, and absence is labelled** | `verdict_cache` on the tick rollup is a number set, and `SchedulerRunSummary.verdict_cache` is the out-of-process marker | tick rollup + run summary | 24 h | tick reports real lookup counts **and** the scheduler reports `NOT_MEASURED_IN_THIS_PROCESS` | the scheduler publishes numeric verdict-cache zeros again (regression of this package) | 0 jobs drained in the window |

**Removed from #826's live checklist and why:**

| #826 item | Disposition |
|---|---|
| `llm_verdict_cache_lookup` `outcome:"hit"` observed | **NOT APPLICABLE — dormant by design** (§2) |
| A hit suppresses the provider call | Moved to Tier 2A (2A-7, 2A-9); unreachable naturally |
| `tokens_saved` / `cost_saved_usd` > 0 | **NOT APPLICABLE — dormant by design** (§2) |
| `state='answered'` is the only state reused | Moved to Tier 2A (2A-5) |
| A non-`answered` state occurs naturally and is not reused | Moved to Tier 2A (2A-5) — waiting for a natural provider failure is not a test |
| Digest change forces recompute | Moved to Tier 2A (2A-3) |
| Verdicts populated for ≥ 2 orgs + RLS confirmed | Moved to Tier 2A (2A-1, 2A-6) |
| No cross-org key collision | Moved to Tier 2A (2A-6) |
| Interrupted run reconciles / no stuck `generating` / no duplicate edition | Moved to Tier 2A (2A-8, 2A-11); 2B-13 retains live *visibility* only |
| No signal permanently lost across a worker restart | Moved to Tier 2A (2A-8); **and was FAILING by design defect — F-1/#883** |
| Verdict reservation prevents duplicate spend | Moved to Tier 2A (2A-7) |

---

## 4. #826 PARENT GATE

```
#826 discharges  ⟺  Tier 2A = PASS  ∧  Tier 2B = PASS
```

- **Tier 2A failure** → correctness/release failure. Blocks promotion.
- **Tier 2B failure** → operational/release failure. Blocks promotion.
- **NOT-ENOUGH-DATA** → the gate stays open. It is not a PASS, and it must be
  recorded with the specific observation still owed and the next window in which
  it can be obtained.
- **UNEXERCISED must never silently count as PASS.** Every criterion above has
  an explicit not-enough-data column precisely so that "we saw nothing" cannot
  be written up as "it works".
- Where a behaviour is genuinely dormant by design it is **removed from
  mandatory criteria** or marked **NOT APPLICABLE with the justification
  recorded inline** (§2 and the removal table in §3). It is never left on the
  checklist to be quietly ticked.

---

## 5. FOLLOW-UP RECOMMENDATION (post-launch, NOT this package)

**Simplify or redesign the verdict cache's answer-reuse half.**

Rationale: the reuse half currently costs a `lookupVerdict` round trip plus a
second "related rows" probe on every miss, a `verdict` JSONB column, and the
`answered` state machine — for a measured steady-state saving of zero. Its only
reachable value is idempotent replay after an interruption, which a much smaller
mechanism could provide.

Options to evaluate then (not now):

1. **Keep as-is.** Zero risk, small ongoing cost, and the replay path stays.
   The honest default until there is a reason to move.
2. **Reduce to a reservation + replay ledger.** Drop the `verdict` payload and
   the miss-reason probe; keep the reservation and a terminal marker. Replay
   becomes "skip, already done" rather than "rewrite identical rows".
3. **Create a genuine reuse path.** If cross-org verdict sharing for *global*
   signals is ever acceptable — a single public CVE analysed once against a
   shared control taxonomy rather than 13 times against 13 inventories — reuse
   becomes real. This is a **tenant-isolation and product decision, not an
   optimisation**, and would require an explicit ruling: derived analysis of
   public data is currently org-owned, and #883's fix deliberately did not touch
   that.

Do not action any of these before promotion.
