# Verdict cache — operator rulings and the four remaining design decisions

**Status:** DESIGN. Companion to `llm-verdict-cache-design.md`, which holds the
key/state model. This file records the operator's rulings (2026-08-18) and
resolves the four questions they asked to be settled before implementation.

---

## 0. Rulings received (binding)

1. **`unparseable` is NOT reusable.** Persist it for observability and
   debugging; it can never satisfy a lookup. Only `answered` is reusable. Both
   `unparseable` and `failed` remain eligible for retry.
2. **Retry budget = 3 attempts total** (initial + 2 retries) with exponential
   backoff and jitter. Provider/transport failure and model-response-unparseable
   keep **separate** state and telemetry. After exhaustion: fail visibly /
   dead-letter per the existing job model. Exhaustion must never become a cached
   negative verdict and must never silently suppress control suggestions.
3. **Governance:** the table is **always** included in organization/tenant
   erasure. Individual GDPR export/erasure is **conditional on the row actually
   containing personal data about the requesting subject** — organization-level
   derived risk intelligence is not exported merely because the requester works
   there. Integrate via the existing TDG / data-classification model; no
   special-case deletion logic.
4. Key unchanged: `(organization_id, signal_dedup_hash,
   control_inventory_digest, prompt_version)`; control changes must invalidate
   by **key miss**, not by an invalidation job.

### How ruling 3 lands with zero special-case logic

The existing model already expresses exactly this distinction, so the table
joins it rather than getting bespoke handling:

- `dataClassification.TABLE_CLASSIFICATION` → **category `D`** ("org data not
  tied to a specific user"). Category D is already defined as *left alone on
  user delete* and *not part of a user's Art. 15 self-export*, while every
  org-scoped table is covered by organization erasure. That is ruling 3,
  verbatim, in the vocabulary the codebase already enforces.
- `governance/dataClasses.GOVERNED_DATA_CLASSES` → a new class with
  `subjectColumns: []`, `erasureDisposition: "org_content"`,
  `classificationCategory: "D"`.

**What makes category D unconditionally correct here is the payload design
(§3): the row contains no personal data at all.** The two are coupled — if the
payload ever grew to carry prompt text, control names, or response bodies, the
classification would become wrong. A test therefore pins the column set, so
adding a content-bearing column fails the build rather than silently
misclassifying the table. The conditionality in ruling 3 is resolved at design
time by making the condition structurally impossible.

---

## 1. TTL — is there one beyond key-version invalidation?

**No correctness TTL. A storage-retention bound only, expressed as a TDG
governed class.**

A verdict for a fixed `(org, signal, control-set, prompt)` tuple does not decay:
every input that could change the answer is already in the key, so an entry is
either still exactly right or already unreachable. A correctness TTL would
reintroduce recurring spend to solve a problem that does not exist.

Storage, however, is a real concern and must not be hand-waved. The row count
grows as `orgs × distinct signals × control-set revisions`, and the ingest
volumes are not small (~3.5k NVD rows per org per week before severity gating).
Left unbounded it grows without limit.

So: **retention by `created_at`, default 90 days, as a governed data class** —
long enough to capture essentially all reuse value (a signal's re-ask value is
concentrated in the weeks it keeps being re-ingested), swept by the retention
machinery that already exists rather than a bespoke job. Expiry costs a
recompute, never a wrong answer, which is why this class is safe to make
tenant-configurable within bounds.

Two consequences worth stating plainly: a cold cache after expiry is a cost
event, not an incident; and because retention here is hygiene rather than
compliance, its floor can be low without the "customer-shortenable audit
ledger" objection that pins the Ask tool-invocation class at a fixed 365 days.

## 2. Concurrent identical misses — stampede control

**A `pending` reservation row, claimed by `INSERT … ON CONFLICT DO NOTHING`,
with stale-reservation reclamation.**

The race is real and cross-process, not theoretical: `runLlmControlMatcherForSignal`
has three independent invocation sites — the engine scheduler, the hourly
worker pipeline, and the 15-minute KEV poller — with no shared budget or lock.
Two of them can hold the same (org, signal) question at the same moment.

Flow:
1. Lookup. `answered` → hit, return, no call.
2. Miss → attempt to insert a `pending` row for the key. `ON CONFLICT DO
   NOTHING` makes exactly one caller the winner.
3. Winner calls the model and updates the row to a terminal state.
4. Loser (insert affected 0 rows, existing row is `pending`) **skips the call
   for this pass** and returns no suggestions. Control suggestions are advisory
   and re-derived on the next pass, so skipping is a deferral, not a loss —
   whereas paying twice is a permanent waste.

**Stale reservations are reclaimable.** A winner that dies mid-call would
otherwise strand the key in `pending` forever — precisely the orphan-state bug
class this program just spent a package eliminating, so it will not be
reintroduced here. A `pending` row older than a lock timeout is treated as
absent and may be re-claimed. The timeout mirrors the existing worker's
`LOCK_TIMEOUT_MS` concept.

Rejected alternative: a Postgres advisory lock held across the call. It avoids
stranded state (locks die with the connection) but pins a pooled connection for
the ~5 s duration of an LLM call, across thousands of calls. Trading connection
pressure for a self-healing row state is the wrong trade at this volume.

## 3. Retained payload for `failed` / `unparseable`

**Diagnostics only. No prompt, no control names, no response body, no signal
summary.** The signal is referenced by `signal_dedup_hash` alone.

| State | Retained | Deliberately NOT retained |
|---|---|---|
| `unparseable` | `response_sha256`, `response_chars`, `parse_error_code` | the response text — it can echo control names |
| `failed` | `failure_class` (`rate_limit` / `credit_balance` / `timeout` / `transport` / `other`), provider HTTP status | the provider error message — messages can quote request content |
| both | `attempts`, `last_attempt_at`, `next_attempt_at`, `model` | the prompt, in any form |

`response_sha256` is the piece that earns its place: identical malformed
responses cluster by digest, so "the same broken shape 400 times" is one
`GROUP BY` away without retaining a single character of content. That is the
debugging value the operator asked to preserve, at zero content-retention cost
— and it is what keeps the category-D classification honest.

Separate `failure_class` vs `parse_error_code` columns are what implement
ruling 2's "separate telemetry/state for provider/transport failure versus
model-response-unparseable": the two failure modes are distinguishable in the
row, in the metrics, and in the alerting, never collapsed into one "error".

## 4. Metrics

Per-lookup structured event `llm_verdict_cache_lookup`, plus per-run totals
folded into `SchedulerRunSummary` beside the existing `llm` block.

**Hit rate** — `hits / (hits + misses)`, and per purpose.

**Miss reason** — four distinguishable values, because "why did we pay" is the
question that drives the next decision:
- `absent` — never asked for this org+signal.
- `control_inventory_changed` — a row exists for this `(org, signal,
  prompt_version)` under a *different* digest. Resolved by one extra indexed
  lookup **on the miss path only**, where an LLM call is about to happen anyway,
  so the cost is negligible. This is the number that reveals whether control
  churn is quietly destroying cache value.
- `prompt_version_changed` — same, for a superseded version.
- `non_reusable_state` — a `pending`, `unparseable`, `failed`, or
  `dead_lettered` row exists (reported with which one).

**Token / cost savings** — a hit's saved spend is *known*, not modelled: the
`answered` row stores the `input_tokens` / `output_tokens` the original call
actually consumed, so a hit accumulates exactly those, priced through the same
table the telemetry package uses. Reported as `tokens_saved` and
`cost_saved_usd`, with the same never-silently-zero discipline (an unpriced
model contributes to `unpriced_hits`, not to a fake $0 saving).

**Retry exhaustion** — `llm_verdict_retry_exhausted` event per occurrence plus a
run counter, and `dead_lettered` is queryable as a standing backlog. This is the
"fail visibly" half of ruling 2: exhaustion produces an alertable event and a
durable, human-actionable row, never a cached negative.

**Verdict latency** — cache-lookup latency recorded separately from model
latency (already captured by `llm_call_usage`), so a slow lookup can never be
mistaken for a slow model. The comparison of the two is what proves the cache is
actually cheaper in wall-clock, not just in dollars.

---

## 5. Acceptance criterion

Two consecutive staging runs after enablement, compared on
`by_purpose.llm_control_matcher`: call count and cost should fall sharply on the
second, with **verdict content unchanged** — a hit returns the identical verdict
the model previously produced, so quality is invariant by construction. The
first run after deployment is a cold cache and is expected to look like today.
