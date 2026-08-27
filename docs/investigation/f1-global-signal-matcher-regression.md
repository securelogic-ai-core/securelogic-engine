# F-1 / #883 — global-signal control-matcher regression: root cause, scope, fix

**Status:** fixed on the held branch `fix/f1-global-signal-control-matcher`.
Unmerged. No promotion, no deploy, no production change proposed here.
**First bad commit:** `a8081aca` — "Brief scheduler + LLM control-matcher stack
(Candidate A, verdict cache, bounded concurrency) [Wave 4]" (#817), merged
2026-08-20. Matches the first observed failure date exactly.
**Classification:** **execution-only. NOT data-integrity affecting.**
**Tracked as:** #883 (defect 1) and **#884** (defect 2 — latent, filed
separately rather than folded into #883, whose evidence does not cover it).

---

## 1. Root cause

`cyber_signals` is one of the tables `TENANT_ISOLATION_STANDARD.md` §1 names as
intentionally **not** org-scoped:

> Tables that are intentionally **not** org-scoped:
> - shared/global signal tables (`signals`, KEV cache, CVE cache) — public-source data

Public-source intelligence (CISA KEV, NVD, advisory feeds, security news) lands
with `organization_id IS NULL` and is cross-org visible by design. The table
carries **no RLS policy** — verified: no `ENABLE ROW LEVEL SECURITY` and no
`CREATE POLICY` for `cyber_signals` exists in any of the 29 migrations that
touch it. The application predicate is therefore the *only* isolation boundary,
and the canonical form — already used by all four signal-link routes
(`signalControlLinks`, `signalObligationLinks`, `signalAiSystemLinks`,
`signalVendorLinks`), each with a `§1` citation and its own regression test — is:

```sql
WHERE id = $1 AND (organization_id = $2 OR organization_id IS NULL)
```

Wave 4 moved the LLM control matcher from an inline call onto a durable job
queue. The inline predecessor was handed the `signal` **object** and never
re-read the row. The queued design deliberately carries only the signal id and
re-reads the row — a sound choice in itself — and introduced **two new reads**,
both written as a bare `organization_id = $2`:

| # | Site | Behaviour on a global signal | Visibility |
|---|---|---|---|
| 1 | `controlMatcherWorker.loadSignal` (`controlMatcherWorker.ts:137-162`) | no row → `NonRetryableJobError("signal … not found for org …")` → job **dead-lettered permanently** | loud, but mislabelled as a deleted signal |
| 2 | `llmControlMatcher` phase-1 `dedup_hash` read (`llmControlMatcher.ts:363`) | no row → `phase1 === null` → outcome **`no_controls`**, job marked **SUCCEEDED** | **silent** — indistinguishable from an org that owns no controls |

Neither predicate can ever match `organization_id IS NULL`.

**Defect #2 was not in #883 and is the more dangerous of the two. It is tracked
separately as #884.** It is **latent with a zero historical population**:

- for a **global** signal, `loadSignal` (defect 1) returns `null` first, so
  `runControlMatcherWithOutcome` is never entered at all;
- for an **org-scoped** signal, `organization_id = $2` is a *correct* predicate —
  the row is org-owned and matches.

There is no third case, so defect 2's failure arm has never executed. Verified
by grep across `src/`, `services/`, `scripts/` and `packages/`:
`runControlMatcherWithOutcome` has **exactly one** production call site
(`controlMatcherWorker.ts:295`), downstream of `loadSignal`, and
`runLlmControlMatcherForSignal` has **zero**.

It nonetheless belongs in this package, because fixing the worker alone makes
the product *worse*: `loadSignal` would admit the global signal, the dedup_hash
read would then return nothing, and the job would be marked **SUCCEEDED** with
`no_controls`. The capability would stay dead **and** the 403-failed-jobs signal
that surfaced F-1 in the first place would disappear. The two predicates are one
defect with two exits.

The originating error is visible in the code comment `a8081aca` left on
`loadSignal`:

> *"tenant isolation is enforced by the same RLS scope that governs every other
> read of `cyber_signals`"*

`cyber_signals` has no RLS. The author added an application predicate believing
it to be belt-and-braces behind a database policy; in fact it was the entire
boundary, and it was written in the wrong form. Both the comment and the
predicate are corrected on the branch.

### Ruling on the three options #883 left open

**Option 1 (admit `organization_id IS NULL` in the tenant-scoped read) is
correct, and is not a widening of the isolation boundary.** It restores the
platform-canonical predicate that four ratified route surfaces already
implement and test, on a table §1 explicitly designates as shared. `id` is the
primary key, so the disjunction still admits at most one row. It grants an org
nothing it could not already read through `GET /api/signals/:id/control-links`.
It also restores exactly the pre-Wave-4 inline behaviour: at `a8081aca~1` the
matcher read no `cyber_signals` row at all and processed global signals
end-to-end.

**Option 2 (enqueue against a per-org signal row) is rejected.** No such row
exists. The fan-out iterates *global signals × active orgs*; materialising a
per-org copy of every public CVE contradicts §1's shared-table designation and
the R5 fan-out model, and would multiply the signal table by the tenant count.

**Option 3 (exclude global signals from the queue) is rejected.** It deletes the
capability rather than fixing it. `shouldRunControlMatcher` gates on
Critical/High, and the Critical/High population is overwhelmingly the global
public-source feed — the very signals the product exists to map to controls.

---

## 2. Affected scope

**Code path.** `runPipeline.ts:334` and `kevPoller.ts:286` enqueue per
`(global signal × active org)`; `controlMatcherWorker.processClaimedJob` fails
every one of them. The per-org enqueue path
(`cyberSignalProcessingService.ts:1451`) is unaffected, which is why aggregate
job success looked healthy (25,197 succeeded on 2026-08-25 alone).

**Tenant/data scope.** All organizations, uniformly. This is not a per-tenant
defect: every active org loses every global Critical/High signal.

**Recorded population** (staging, from the #883 evidence table — these figures
are carried forward, not re-measured here; no staging query was run for this
package):

| fact | value |
|---|---|
| failed `control_matcher_suggest` jobs, all time | 403 |
| of those, whose signal is global | 403 — 100% |
| distinct signals permanently lost | 31 |
| first failure | 2026-08-20 (the day `a8081aca` merged) |
| by day | 08-20: 182 · 08-21: 104 · 08-24: 91 · 08-25: 26 |

Production is **not** affected: Wave 4 has never reached `main`. `main` is at
`011e1f1d`; the defect is on `develop` only.

---

## 3. Data integrity

**No incorrect persisted decisions or results were produced.** Verified by
tracing every write the defective path can reach:

- `loadSignal` returns `null` **before** `runControlMatcherWithOutcome` is
  called, so no provider call, no `llm_control_matcher_verdicts` row and no
  `signal_match_suggestions` row is written for a global signal.
- The only rows written are the failing `jobs` rows' own bookkeeping
  (`status`, `error`, `attempts`) — which accurately record that the job failed.
- Defect #2 writes nothing at all: `phase1 === null` returns before
  `reserveVerdict`.
- No path exists by which a global signal could have been analysed under the
  wrong tenant, or a suggestion attributed to the wrong org.

**Exhaustive write inventory for this code path** (every `INSERT`/`UPDATE`
reachable from `processClaimedJob`, enumerated from source):

| Table | Written by | Reached on the defective path? |
|---|---|---|
| `signal_match_suggestions` | `writeControlSuggestions` (`llmControlMatcher.ts:246`) | **No** — downstream of the failed read |
| `llm_control_matcher_verdicts` | `reserveVerdict` / `recordAnsweredVerdict` / `recordFailedVerdict` | **No** — `phase1 === null` returns before `reserveVerdict` |
| `jobs` | worker bookkeeping (`controlMatcherWorker.ts:209,314`) | Yes — and it records the failure *accurately* |

The path writes nothing else. In particular it creates **no findings, no risks,
no control associations beyond suggestions, and no downstream decisions** — the
deterministic matcher (`runMatcherForSignal`), which is what produces findings,
is a separate path and is unaffected by either predicate.

**The harm is exclusively absence.** 31 signals × the active-org count produced
no control suggestions that should have existed. Nothing that *does* exist is
wrong.

**Therefore: no reconciliation of existing rows is required, and no corrective
or destructive backfill is proposed or built in this package.**

---

## 4. Re-processing the lost population — DECISION OWED, NOT TAKEN

The 403 jobs are in terminal `failed` state and will never be re-claimed on
their own. Whether to re-process them is a separate decision, and it is **not**
taken here. No script is included. Per the standing instruction, the affected
population is reported first.

The enumeration is **read-only** and can be run by an operator against staging
to confirm the population before any decision:

```sql
-- READ ONLY. Enumerates the F-1 population. Changes nothing.
SELECT j.organization_id,
       j.payload->>'signal_id' AS signal_id,
       cs.severity,
       cs.source,
       cs.created_at,
       count(*) AS failed_jobs
  FROM jobs j
  JOIN cyber_signals cs ON cs.id = (j.payload->>'signal_id')::uuid
 WHERE j.job_type = 'control_matcher_suggest'
   AND j.status   = 'failed'
   AND cs.organization_id IS NULL
 GROUP BY 1,2,3,4,5
 ORDER BY cs.created_at DESC;
```

Considerations for whichever way that decision goes:

- **Re-processing is non-destructive and idempotent by construction.** Setting
  those rows back to `status='queued'` re-enters the normal path; the verdict
  reservation prevents duplicate spend and
  `signal_match_suggestions`' `ON CONFLICT … DO NOTHING` prevents duplicate rows.
- **It costs real provider spend** — up to 31 signals × active orgs of fresh
  LLM calls, since no verdict was ever cached for them.
- **Signal recency matters.** Control suggestions for a five-day-old CVE may
  have limited decision value; a window shorter than "all of it" may be the
  right answer.
- **Staging first.** Production has never run this code, so there is no
  production population to reconcile — only staging, and only if the decision
  is that the suggestions are worth the spend.

---

## 5. The fix

Two predicates, both to the canonical §1 form. **No schema change, no
migration, no new environment variable, no flag change, no behavioural change
to any other path.**

```
src/api/workers/controlMatcherWorker.ts   loadSignal            + corrected comment   (#883)
src/api/lib/llmControlMatcher.ts          phase-1 dedup_hash read                     (#884)
```

### Regression evidence

| Test | Layer | Red against the defect? |
|---|---|---|
| `src/api/__tests__/controlMatcherAsync.test.ts` (+4) | unit, mocked | 3 of 4 red; the 4th is a negative control that must pass both ways |
| `test/isolation/controlMatcherGlobalSignal.test.ts` (10, new) | **real Postgres** | 6 of 10 red; the other 4 are negative controls |

Both suites cover: global signals, org-scoped signals, another org's private
signal (still refused), a nonexistent signal (still refused), zero matches,
multiple matches with ranking/threshold/cap, a hallucinated foreign control id
(dropped), and the same global signal in two orgs producing two independent
non-leaking result sets.

A mocked `pg.query` returns rows regardless of the `WHERE` clause, so the unit
tests pin the predicate's *text* and the isolation test pins its *effect*. The
gap between those two is precisely what let CI stay 8/8 green for five days
while the capability was dead.
