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

**Governing rule: a quiet environment must not FAIL.** Where the metric depends
on traffic that may not occur in the window, the verdict is
**NOT-ENOUGH-DATA**, which is *not* a PASS — it holds the gate open and names
what is still owed. Only where traffic itself is the thing under test does
absence become a FAIL.

| ID | Metric | Expected | Source | Window | PASS | FAIL | NOT-ENOUGH-DATA |
|---|---|---|---|---|---|---|---|
| 2B-1 | Scheduler actually fires on the cron | exactly 1 run started | `scheduler_run_started` in the brief-scheduler service log | the Tue 07:00Z run + 60 min | exactly 1 | 0, or > 1 (double-fire) | n/a — the cron either fired or it did not, and this IS the traffic under test |
| 2B-2 | Eligible orgs are actually processed | `orgs_processed` > 2 | run summary | same | > 2 | 0 while `active_orgs > orgs_skipped_already_current` | every org already current → record NOT-ENOUGH-DATA, re-observe next edition boundary |
| 2B-3 | Org concurrency ceiling observed | `org_concurrency.peak_in_flight` > 0 and ≤ 2 | run summary | same | 1 or 2 | > 2 (ceiling breached) | `orgs_processed` ≤ 2, so the ceiling could not be exercised |
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
