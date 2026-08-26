# Per-org deadline for the Brief scheduler — DESIGN ONLY

Status: **design for approval. Nothing implemented.**
Author: engineering, 2026-08-18.
Depends on: `perf/brief-scheduler-bounded-org-concurrency` (PR #808, merge-held
for the M-1 soak). This package is independent of it and can be sequenced
either side, but the numbers below assume the bounded fan-out lands first.

---

## 0. The evidence this design is built on

Everything here is derived from the **real** staging run of 2026-08-18
(`scheduler_cron_complete`, engine `srv-d7n0rju8bjmc738jbs7g`), not from a
model:

```
durationMs 39624403  (10.99 h)   active_orgs 13   orgs_processed 13
briefs_generated 13  emails_sent 7  emails_failed 0  errors []
```

| measure | value |
|---|---|
| per-org median | 12.0 min |
| per-org mean | 50.7 min |
| per-org max | 188.8 min |
| orgs > 3x median | 4 of 13 |
| share of run held by those 4 | 86% |

Three findings drive every decision below.

**F1 — The cost is ingest, and it is database-bound.**
`brief_enrichment_summary` for all 13 orgs reads `total 24, enriched_count 24,
fallback_count 0`. Enrichment is identical, healthy, and takes 1–2 min. The
remaining ~98% of each org's time is the ingest loop: 3,563 NVD + 1,666 KEV
signals inserted per org with **zero duplicates**, each running `processSignal`
→ matcher. Measured per-signal cost ranges ~0.09 s (fastest org) to ~2 s
(slowest). `matcher_run_for_signal` shows deterministic branches
(`vendor_name_ilike`, `no_match`) — this is DB work, not provider work.

**F2 — The dominant phase has a natural checkpoint every ~0.1–2 s.**
The ingest loop iterates ~5,300 times per org. That is what makes a *cooperative*
deadline viable with sub-second overshoot and no cancellation plumbing.

**F3 — Anthropic latency is not the problem today.**
Enrichment's 1–2 min against a 10–190 min org means the SDK's 10-minute timeout
is not what holds a slot. It remains the worst-case *single non-cancellable
await*, which constrains how tight a deadline can be enforced — but it is not
the thing to optimise for.

---

## 1. What constitutes the total org-processing deadline

**One wall-clock budget covering the whole per-org pipeline**: all nine feed
ingests, brief generation (both phases), and the send leg — the exact span of
`runOrgPipeline`.

- The clock **starts when the org is admitted to a worker slot**, not when the
  run starts. Queue time is the scheduler's problem, never charged to the org.
- It is a **single budget**, not per-step. Per-step budgets would need
  independent justification per step and would fire on the wrong thing: F1 says
  ingest legitimately dominates, so a per-step budget would either be so loose
  it never fires or would truncate healthy ingest.
- It is **per-org, per-run**. It does not persist across runs.

Rejected: a run-level budget. The cron is weekly with no competing consumer, and
a run-level abort resurrects exactly the tail-abandonment failure the
reconciliation package (`8d03c4d5`) closed.

---

## 2. Does a timeout cancel only the current org, or the scheduler?

**Only the current org.** Other slots are untouched, the run continues, and the
summary records the stop. This is the same isolation contract `processOrg`
already provides for failures; a deadline is just another contained outcome.

A run-wide abort is explicitly rejected: it would mean one pathological org
denies every other org its weekly edition — strictly worse than the status quo.

---

## 3. How partially completed work is resumed safely

**No new resumption machinery is required.** Every phase is already idempotent,
and the deadline only has to stop cleanly at a phase boundary it understands.

| stopped during | state left behind | how the next run resumes |
|---|---|---|
| ingest | some signals inserted | `INSERT … ON CONFLICT (organization_id, dedup_hash) DO NOTHING` — the next run re-ingests only what is missing. No brief row exists, so the org counts as missing and reconciles in full. |
| generate, Phase 1 | transaction rolled back | nothing persisted; org counts as missing. |
| generate, Phase 2 | `intelligence_briefs` row in `'generating'` | the deadline handler **must** mark it `'failed'`, the same terminal state the existing enrichment-error path uses. `orphanBriefReaper` (3 h) is the backstop if that mark itself fails. |
| send | some subscribers emailed | `intelligence_brief_sends` per-subscriber idempotency guard — the next attempt skips already-sent subscribers (`brief_send_skipped_already_sent`). |

**Hard requirement: a deadline stop must never publish a partial brief.** The
whole resumption model rests on `status = 'published'` meaning "this org's week
is complete" — that predicate is what both `orgsWithCurrentBrief` and
`briefCatchup` read. Publishing a truncated brief would make the org look
complete and permanently strand the missing content.

---

## 4. Interaction with Anthropic's 10-minute timeout and retries

Current client construction is `new Anthropic({ apiKey })` — SDK defaults:
`timeout` 10 min, `maxRetries` 2, and **timeouts are themselves retried**. Worst
case for a single call is therefore ~30 min plus backoff.

That figure is the **enforcement floor**: a cooperative deadline cannot fire
while blocked inside one non-cancellable await, so the deadline's worst-case
overshoot equals the longest single await in the pipeline.

- In ingest (F1/F2), the longest await is one signal — ~0.1–2 s. Overshoot is
  negligible.
- In enrichment, the longest await is one Claude call — up to ~30 min today.

**Recommendation (small, separate, testable):** construct the client with an
explicit `timeout` (~120 s) and keep `maxRetries: 2`, bounding the worst-case
single call to roughly 6 min plus backoff. Measured evidence supports this:
24/24 items enriched with zero fallbacks in 1–2 min means healthy calls are far
under 120 s, so the tighter timeout would not have degraded a single item in the
observed run.

This change should ship **before or with** the deadline, because it is what makes
the deadline's overshoot bound honest. It is not required for correctness.

---

## 5. Does a timing-out org release its slot immediately?

**Yes — via cooperative checkpoints, which is the only mechanism that actually
frees the resources.**

Two candidate mechanisms, and why only one is acceptable:

- **Cooperative checkpoint (RECOMMENDED).** A `deadline.exceeded()` check at the
  top of each per-signal iteration, and between pipeline steps. On expiry the
  pipeline returns normally with a `deadline_exceeded` outcome. The slot is
  released, the tenant scope is closed, the connection returns to the pool, and
  **no work is left running**. Given F2, worst-case overshoot in the dominant
  phase is one signal.

- **`Promise.race` hard stop (REJECTED as primary).** It releases the *slot* but
  not the *work*: the abandoned pipeline keeps running, keeps holding a pooled
  connection, and keeps writing rows — while a second org is admitted to the
  slot it supposedly vacated. That breaks the connection bound the concurrency
  package just established and can interleave writes from a task the scheduler
  believes is finished. If a hard stop is wanted as a last-resort guard, it must
  be set far above the cooperative deadline and must log explicitly that
  abandoned work may still be in flight.

JavaScript cannot cancel a running promise; a cooperative checkpoint is not a
compromise here, it is the correct primitive, and F2 is what makes it cheap.

---

## 6. How the scheduler distinguishes timeout from provider failure

They are different outcomes and must never share a bucket.

| | provider failure | deadline stop |
|---|---|---|
| summary counter | `orgs_skipped` (existing) | **`orgs_deadline_exceeded`** (new) |
| error string | `org:<id> generate_failed: …` / `send_failed` / `*_ingest_fatal` | **`org:<id> deadline_exceeded: phase=<ingest\|generate\|send> elapsed_ms=<n>`** |
| log event | `scheduler_generate_failed` etc. | **`scheduler_org_deadline_exceeded`** |

Corroborating signals already exist and should be read alongside, not replaced:
`brief_enrichment_summary.fallback_rate` isolates provider degradation
independently, and the LLM telemetry on the concurrency branch separates spend
from outcome. **A deadline stop with `fallback_rate = 0` is unambiguously "we ran
out of time", not "the provider failed"** — which is exactly the 2026-08-18
signature.

---

## 7. How catch-up resumes that org without duplicating completed work

It already does, with no change — **provided the flag is on.**

`briefCatchup` is completeness-based on *published* `intelligence_briefs` for the
current weekly window, and the scheduler's own `orgsWithCurrentBrief` skip set
uses the same predicate. An org stopped by the deadline has no published brief
for the window, so it is precisely the "missing tail" catch-up targets, and
completed orgs are skipped (`scheduler_org_skipped_already_current`). Email
double-delivery is independently prevented by `intelligence_brief_sends`.

**⚠ This is a gating dependency, and the flag states are asymmetric:**

| environment | `SECURELOGIC_BRIEF_CATCHUP_ENABLED` |
|---|---|
| staging | `true` |
| **production** | **`false`** |

On production as configured today, a deadline would convert "slow org" into
**"org silently misses the week"**, recoverable only by the next Tuesday or a
manual `POST /api/admin/briefs/run-scheduler`. That is a worse customer outcome
than the slow run it replaces.

**Therefore: the deadline must not be enabled in production until catch-up is
enabled in production.** That is an operator decision and a hard prerequisite,
not a follow-up.

---

## 8. Telemetry and alerting

Emitted on a stop:

- `scheduler_org_deadline_exceeded` (**warn**) — `orgId`, `phase`, `elapsed_ms`,
  `deadline_ms`, `signals_ingested_before_stop`, `brief_id` if one existed.
- Summary: `orgs_deadline_exceeded` (count) and `orgs_deadline_exceeded_ids`,
  carried through `scheduler_run_complete`.
- `briefDeliveryHealth.evaluateDeliveryHealth` should raise severity on a
  non-zero count, routing to the existing `ALERT_WEBHOOK_URL` Slack path
  (already wired; delivery proven on staging).

**Emitted always, deadline or not — and this should ship FIRST:**

- `scheduler_org_complete` with `org_id`, `duration_ms`, `phase_ms` breakdown,
  and outcome, for **every** org on **every** run.

This does not exist today. Its absence is why answering §9 required
reconstructing per-org durations from the gaps between `scheduler_org_start`
lines. **Recommend shipping the duration telemetry as its own small package
before the deadline**, so the deadline value is set from a distribution rather
than from one archaeological sample.

---

## 9. What deadline is justified by measured staging behaviour

### What the single measured run supports

| candidate | orgs stopped (of 13) | verdict |
|---|---|---|
| 30 min | 4 (31%) | **No.** Truncates a third of the estate. |
| 45 min | 4 (31%) | **No.** Same. |
| 120 min | 3 (23%) | **No.** |
| 200 min | 0 | Fires only above the observed max. |
| **240 min (4 h)** | **0** | **Recommended opening value.** ~1.3x the observed max. |

The four outliers ran 98.8 / 109.6 / 167.0 / 188.8 min and **all four published
successfully with zero errors and zero enrichment fallbacks**. They were slow,
not broken. Any deadline that stops them trades a long run for missing editions
— the wrong trade, and precisely the trade a deadline is supposed to prevent.

### The recommendation

**Open at 240 minutes, hard-coded, and only after `scheduler_org_complete`
duration telemetry has run for at least three weekly cycles.**

Reasoning, stated plainly:

1. **One run is one sample.** It cannot establish a distribution, a p99, or
   whether the 188.8-minute org is a persistent property of that org or a
   one-off. Setting a tight deadline on n=1 would be exactly the "fake certainty"
   this codebase's standards forbid.
2. **240 min is a safety valve, not an optimiser.** Its job is to stop an org
   that has genuinely hung, not to make the run faster. Making the run faster is
   the ingest package's job (F1), not the deadline's.
3. **The profile is about to change.** This run predates the verdict-cache work
   (`bfe79f78`), which staging does not yet have, and predates the bounded
   fan-out. Both change per-org cost. The deadline must be **re-derived** after
   they land, never inherited.

### Compatibility constraint

`orphanBriefReaper` marks `'generating'` rows older than **3 h** as failed. A 4 h
org deadline is longer than that threshold. This is safe **today** because
Phase 2 (the only window in which a row sits `'generating'`) measured 1–2 min —
the reaper never sees a live row. It becomes unsafe the moment Phase 2 could
exceed 3 h. **Constraint to encode and test: the generate-phase share of the
deadline must stay below `STUCK_AFTER_HOURS`**, or the reaper threshold must be
raised above the deadline.

---

## 10. Proposed sequencing

1. **Package A — per-org duration telemetry.** `scheduler_org_complete` with
   `duration_ms` and phase breakdown. Tiny, no behaviour change, ships anytime.
2. **Observe 3 weekly cycles.** Derive the real distribution.
3. **Package B — explicit Anthropic `timeout` / `maxRetries`.** Bounds the
   worst-case single await so the deadline's overshoot is honest.
4. **Operator decision — production catch-up flag.** Hard prerequisite (§7).
5. **Package C — the deadline itself**, cooperative, value derived from step 2.

Steps 1–3 are independently valuable and carry no risk of missed editions.
Step 5 must not ship before step 4.

---

## 11. Open questions for the operator

1. **Production catch-up flag** — enable it? Without it, §7 says the deadline
   must not be enabled in production at all.
2. **Is the 188.8-minute org expected?** If its inventory legitimately implies
   ~2 s/signal, a deadline is the wrong tool and the ingest package is the
   answer. If not, it is a defect that a deadline would merely mask.
3. **Should the deadline ever apply to catch-up runs**, which already run
   outside the Tuesday window and have more time available?
