# Design proposal — idempotent LLM control-matcher verdicts

**Status:** DESIGN ONLY. No schema, no migration, no code. Awaiting operator
approval of the key/state model before anything is built.
**Date:** 2026-08-18
**Prerequisite shipped:** telemetry (this same package) — the cache's value is
unprovable without per-call token/cost measurement.

---

## 1. What is being made idempotent, and why only this call

`runLlmControlMatcherForSignal` is the only LLM call in the weekly run whose
volume scales as `orgs × fresh signals`, and it is strictly serial: measured
live on staging 2026-08-18 at **12 calls/min, ~5 s each, one org at a time**,
with a single org consuming 77+ minutes.

It is also the only one of the four brief-path LLM calls that **cannot** be
shared across organizations: its prompt embeds the org's own `controls` rows
(id / name / description, `LIMIT 80`). Enrichment, headline, and exec-summary
prompts are either org-invariant (cacheable across tenants — a separate,
smaller win) or depend on the org's prior brief (not worth caching). So the fix
for the dominant term is **per-org idempotency**, not a shared cache: the same
signal, re-presented to the same org with the same control inventory, must not
be paid for twice.

This matters because re-presentation is the normal case, not the exception.
`cyber_signals` dedup is per-org (`UNIQUE (organization_id, dedup_hash)`), the
engine scheduler writes an org-scoped copy of every global signal, and a rerun
or catch-up re-walks orgs. Most of the observed 12 calls/min are re-asking a
question already answered.

---

## 2. Proposed persistence key

One row per answered question. The key is the **four-part identity of the
question**, so a cached verdict is reused if and only if re-asking would produce
the same prompt:

| Key part | Column | Source | Why it is in the key |
|---|---|---|---|
| Organization | `organization_id UUID NOT NULL` | the signal's org | Tenancy. A verdict is org-private (it names that org's controls) and must never be readable across orgs — this column is also what the RLS policy keys on. |
| Signal identity | `signal_dedup_hash TEXT NOT NULL` | `cyber_signals.dedup_hash` | The content identity of the signal, **not** `cyber_signals.id`. Keying on the row id would miss the entire point: the same CVE re-ingested for the same org gets a NEW id but the SAME dedup hash. `dedup_hash` is already `sha256(source\|signal_type\|cve\|vendor\|external_id)` with no org component, which is exactly the semantics wanted. |
| Control inventory version | `control_inventory_digest TEXT NOT NULL` | `sha256` over the org's control set as the prompt sees it | The prompt's other input. If the org adds, renames, or re-describes a control, the answer may legitimately change and the cache must miss. Digest the exact projection sent to the model — `(id, name, description)` for the same `LIMIT 80` in the same `ORDER BY` — so the digest changes precisely when the prompt would. |
| Prompt version | `prompt_version SMALLINT NOT NULL` | a constant bumped by hand beside the prompt builder | Any edit to the prompt template, model id, or parse contract invalidates every prior answer. A hand-bumped integer next to `buildControlMatcherPrompt` makes that a deliberate, reviewable act. **Bumping it is mandatory in any PR that edits the prompt** — this is the rule most likely to be forgotten, so it belongs in the PR checklist, not just in a comment. |

**Primary key:** `(organization_id, signal_dedup_hash, control_inventory_digest,
prompt_version)`.

Note what is deliberately **absent**: severity and signal_type. They gate
*whether* the call happens (`shouldRunControlMatcher`) but are derived from the
same signal identity, so including them would add key surface without adding
discrimination.

---

## 3. Proposed state model

Three terminal states plus the implicit "absent". A cache entry records **what
the model said**, not merely "we called it".

| State | Meaning | On a subsequent hit |
|---|---|---|
| *(no row)* | Never asked. | Call the model, then write a row. |
| `answered` | The model returned a parseable verdict; `suggestions` holds it (possibly an empty array — "no controls match" is a real, reusable answer). | Reuse; make no call. |
| `unparseable` | The model answered but the response failed the parse/validation contract. | Reuse as "no suggestions", make no call — **for this `prompt_version` only.** A bad prompt is a code defect to fix by bumping the version, not by paying for the same malformed answer weekly. |
| `failed` | Transport/quota/timeout — the model never really answered. | **Do NOT reuse.** Retry, subject to the backoff below. |

The `failed` distinction is the one that has to be right. Caching a transport
failure as an answer would silently and permanently suppress control
suggestions for that signal — converting a transient outage into invisible
permanent data loss, which is precisely the class of defect this whole package
exists to eliminate.

**Retry discipline for `failed`:** store `attempts` and `last_attempt_at`;
refuse to retry more than N times within a window. Without this, a signal that
always fails becomes a weekly re-spend forever — the cache's failure mode
mirroring the bug it replaces.

### Proposed shape (illustrative — not a migration)

```
llm_control_matcher_verdicts
  organization_id           UUID NOT NULL REFERENCES organizations(id)
  signal_dedup_hash         TEXT NOT NULL
  control_inventory_digest  TEXT NOT NULL
  prompt_version            SMALLINT NOT NULL
  state                     TEXT NOT NULL CHECK (state IN ('answered','unparseable','failed'))
  suggestions               JSONB          -- the verdict; NULL unless state='answered'
  model                     TEXT NOT NULL  -- what actually answered, for audit
  input_tokens              INTEGER
  output_tokens             INTEGER
  attempts                  INTEGER NOT NULL DEFAULT 1
  last_attempt_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
  PRIMARY KEY (organization_id, signal_dedup_hash, control_inventory_digest, prompt_version)
```

`suggestions` is a cache of a *derived* answer, not a canonical domain object —
the canonical suggestions continue to live in their existing table. This is the
one place the design deliberately stores JSON, and it is legitimate precisely
because the row is disposable: truncating this table costs money, never
correctness.

---

## 4. Invalidation semantics

Four invalidation paths, in order of how often they fire:

1. **Control inventory changes** → digest changes → automatic miss. No
   invalidation code, no triggers, no cache-busting on the write path. This is
   why the digest is in the key rather than tracked as a version column: it
   makes invalidation a *property of the key* instead of a job someone must
   remember to run.
2. **Prompt/model/parse contract changes** → `prompt_version` bump → global
   miss. Deliberate and reviewable.
3. **Operational reset** → `TRUNCATE`, or delete by org. Always safe: a cold
   cache costs money and time, never correctness.
4. **Age** → optional TTL sweep. **Recommended: none initially.** A verdict for
   a fixed (signal, control-set, prompt) tuple does not "go stale" in any sense
   the key does not already capture; a TTL would reintroduce recurring spend to
   solve a problem that does not exist. Revisit only if model drift is ever
   shown to matter.

**Deliberately NOT invalidated by:** new findings, posture recomputation, vendor
changes, or anything else org-scoped that is not in the prompt. Widening
invalidation beyond the prompt's real inputs would quietly restore the cost this
design removes.

---

## 5. Tenancy and safety

- `organization_id` is the first key column and carries the standard
  `NOT NULL` + FK; the table takes an RLS policy like every other org-scoped
  table. A cross-org read is structurally impossible: the org is part of the
  lookup key, so a miss — not a leak — is the failure mode of a wrong org id.
- Writes happen on the same elevated path that already performs the matcher's
  own writes; the cache is never consulted or written from a route handler.
- **A cross-org isolation test is mandatory** before this ships: org B must
  never observe org A's verdict for the same signal, even when both have
  identical control inventories (identical digests are expected and correct —
  the org column is what separates them).

---

## 6. Expected effect, and how it will be proven

Expected: the dominant A1 term collapses from "every (signal × org) every run"
to "every *new* (signal × org × control-set) once", which on a steady-state
weekly run should be a small fraction of today's volume. First cold run is
unchanged; the win appears from the second run onward and on every rerun,
catch-up, and manual trigger.

**This will be measured, not asserted**, using the telemetry shipped in this
package: `llm_call_usage` events and the per-run `llm` totals in
`SchedulerRunSummary` give calls, tokens, cost, and latency by purpose. The
acceptance criterion should be a before/after comparison of
`by_purpose.llm_control_matcher` across two consecutive staging runs — with the
explicit expectation that **quality is unchanged**, since a cache hit returns
the identical verdict the model previously produced.

---

## 7. Open questions for the operator

1. **`unparseable` reuse — agree or reject?** Reusing it saves real money and is
   correct as long as `prompt_version` is disciplined, but it means a prompt bug
   is "sticky" until someone bumps the version. The safer alternative is to
   treat `unparseable` like `failed` (always retry) at higher cost.
2. **Retry budget for `failed`:** how many attempts, over what window, before a
   signal is abandoned for that prompt version?
3. **Does this table belong in the GDPR export/erasure category set?** It holds
   derived analysis referencing an org's controls. My reading is yes for
   erasure (it is org-scoped derived data) and no for export (it is a disposable
   cache, not customer content) — but that is a data-classification ruling, and
   the M1-G2 incident is a direct precedent for getting this wrong being
   expensive.
4. **Scope check:** this design assumes the engine scheduler keeps writing
   org-scoped signal copies. If the larger global-signal convergence is ever
   approved, the `signal_dedup_hash` key survives that change unharmed — which
   is the main reason to key on the hash rather than the row id.
