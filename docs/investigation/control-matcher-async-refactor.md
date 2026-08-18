# Async LLM control matcher (Candidate A) — invocation-site verification

Status: **implemented, branch-held.** Branch `feat/async-control-matcher`,
stacked on the telemetry package. Not merged; M-1 soak active.

Product ruling (2026-08-18): per-org control-suggestion generation remains an
intended capability, but must not sit on the Brief publication critical path.

---

## 1. All three invocation sites, verified

Enumerated by `grep -rn runLlmControlMatcherForSignal --include=*.ts src/ services/`,
excluding tests. There are exactly three.

| # | site | reached by | before | after |
|---|---|---|---|---|
| **1** | `cyberSignalProcessingService.ts` phase 7 (`processSignal`) | Brief scheduler `ingestSignalsForOrg`; **12** ingest routes in `cyberSignals.ts`; `unprocessedSignalSweeper` | `await runLlmControlMatcherForSignal(...)` — inline, post-commit, one provider call per eligible signal, **blocking every caller** | `enqueueControlMatcherJob(client, orgId, …)` — **inside the processing transaction**. No provider call. The inline call is gone from the file entirely. |
| **2** | `kevPoller.ts:278` (intelligence worker, 15-min) | KEV fan-out, per `(signal, org)` | `controlSuggestionsWritten += await runLlmControlMatcherForSignal(signal, org.id)` — serialised the fan-out behind provider latency | `enqueueControlMatcherJob(pg, org.id, signal)` in its own `withTenant` scope; counter renamed `controlSuggestionsQueued` so the metric still says what it counts |
| **3** | `runPipeline.ts:337` (intelligence worker, hourly) | pipeline fan-out, per `(signal, org)` | identical to #2 | identical to #2 |

**Execution site after the refactor: exactly one** — `controlMatcherWorker`,
ticked every minute by `services/intelligence-worker/src/scheduler.ts` with a
non-overlapping guard. The intelligence worker owns asynchronous matcher
execution; the three former sites are now producers only.

### Why site 1's enqueue is inside the transaction

It rides the same `client` that commits the signal's processing, immediately
after the existing `enqueueApplicabilityReassessment` — so a job exists **iff**
the signal reached `processed = TRUE`. Enqueueing after the commit would open a
window in which the signal is processed with no job; re-ingest hits
`ON CONFLICT DO NOTHING` and never re-processes, so that suggestion would be
lost permanently with nothing able to detect it. A source test pins the ordering.

### Why sites 2 and 3 do not

The fan-out has already committed its matcher work for that pair, and there is
no open processing transaction to ride. They enqueue in their own tenant scope.
Over-enqueueing is safe (see idempotency below); under-enqueueing is not.

---

## 2. Requirements, and where each is met

| requirement | how |
|---|---|
| Brief publication depends only on data it consumes | `processSignal` makes **no** provider call. Brief generation reads `cyber_signals`; suggestions are written by a separate process, in a separate transaction. A source test asserts `runLlmControlMatcherForSignal` no longer appears in `cyberSignalProcessingService.ts`. |
| Suggestion generation stays tenant-scoped and non-fatal | The worker loads the signal and writes the job's terminal state inside `withTenant`; the signal read is `WHERE id = $1 AND organization_id = $2`. `enqueueControlMatcherJob` swallows its own failures — the inline call it replaces was non-fatal, and the replacement must not be stricter. |
| Intelligence worker owns async execution | `controlMatcherWorker.runOneTick` is registered only by the intelligence worker's scheduler. |
| A matcher failure cannot block or roll back publication | Different process, different transaction, different tick. The enqueue is the only thing on the publication path and it cannot throw. |
| No suggestion lost because a worker restarts | Durable `jobs` row + claim's `status = 'processing' AND locked_at < now() − timeout` arm re-claims work abandoned by a dead process. A failure that cannot even be recorded leaves the job `processing` and is re-claimed the same way. |
| Duplicate / re-ingested signals stay idempotent | Two layers. Producer: `NOT EXISTS` against a **queued** job for the same `(org, signal)`. Worker: the verdict-cache reservation — a duplicate execution either replays the cached verdict for **zero** provider spend or loses the `INSERT … ON CONFLICT` race and skips the call. Dedup deliberately does **not** cover in-flight jobs, because layer 2 already makes that free. |
| Reuse the verdict-cache reservation work | It is now genuinely load-bearing. Its retry budget is documented as "consumed by claims" — but inline execution never re-claimed, so that budget was unreachable. Job-level retry is the re-claim mechanism it was designed for. |
| Tenant isolation and control-inventory semantics preserved | The matcher itself is untouched: same gate, same `MAX_CONTROLS_IN_PROMPT`, same digest, same rows. Its existing test suite passes unmodified. |
| Observability for queued / completed / failed / retried / exhausted | `control_matcher_enqueued`, `control_matcher_job_completed`, `control_matcher_job_failed`, `control_matcher_job_retry_scheduled`, `control_matcher_job_exhausted`, plus `control_matcher_enqueue_failed`, `control_matcher_job_state_write_failed`, `control_matcher_tick_complete`. |
| Provider concurrency **not** increased | The tick claims and processes **one job at a time** — exactly what the inline path did. A test asserts peak in-flight matcher calls is 1. The package removes latency from the critical path; it does not hide it behind a wider fan-out. |

---

## 3. What changed in the matcher itself

Only its **return type**, and only additively.
`runLlmControlMatcherForSignal` keeps its `Promise<number>` signature and
delegates to a new `runControlMatcherWithOutcome`, which reports *which* outcome
occurred (`written` · `cache_hit` · `ineligible` · `no_controls` · `deferred` ·
`exhausted` · `provider_failed` · `unparseable`) and whether a later attempt
could still succeed.

The numeric return could not distinguish "wrote nothing because the org has no
controls" from "wrote nothing because the provider failed" — both were `0`. Once
the work is asynchronous that distinction decides whether the job retries. The
matcher's behaviour, gating, cache semantics and written rows are unchanged; its
existing tests pass without modification.

---

## 4. Rollback

Flip the existing `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` to `false`. It gates
**both** ends — `shouldRunControlMatcher` blocks the enqueue and `runOneTick`
refuses to claim — so one flag drains the feature completely. **No new
environment variable was introduced.** The migration is additive (one `job_type`
CHECK value) and invisible to every other worker.
