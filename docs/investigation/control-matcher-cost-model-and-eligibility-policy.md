# Control-suggestion cost model + eligibility policy proposal

Status: **PROPOSAL — STOPPED FOR APPROVAL. Candidate C is NOT implemented.**
Date: 2026-08-18. Evidence: staging weekly run 2026-08-18.

---

## 0. A correction to the earlier analysis, up front

The slowest-org decomposition estimated **"~20,000+ Sonnet calls/week"** by
extrapolating one org's call rate across all 13 orgs. **That was wrong.**

Measured directly: **orgs with no control inventory make ZERO LLM calls.** The
matcher returns before any provider call when `controls.length === 0`. Two-minute
probes inside each org's own processing window:

| org | duration | llm starts | signals | calls/signal |
|---|---:|---:|---:|---:|
| 0d8f5fa4 | 8.7 min | **0** | 98 | 0.00 |
| 14a6b864 | 8.9 min | **0** | 105 | 0.00 |
| 3b82e322 | 8.3 min | **0** | 97 | 0.00 |
| 44fd5f70 | 15.7 min | **0** | 95 | 0.00 |
| 295b989a | 109.6 min | 16 | 49 | 0.33 |
| b1a3da2d | 98.8 min | 21 | 27 | 0.78 |
| f70267ce | 167.0 min | 22 | 23 | 0.96 |
| fe2ede61 | 188.8 min | 13 | 63 | 0.21 |

This is the whole story of the 11-hour run: **4 of 13 orgs have controls; those
4 are the 4 slow orgs and 86% of the runtime.** The other 9 process ~50
signals/min because they never call the provider at all.

---

## 1. Cost model

### Calls

| quantity | value | basis |
|---|---|---|
| New signals processed per org per week | **~3,636** | 3,563 NVD + 9 KEV + 17 Federal Register + 29 CISA Alerts + 18 threat-intel RSS, measured |
| Calls per signal (org **with** controls) | **~0.46** | 10 one-minute probes spread across fe2ede61's NVD phase: 102 starts / 223 signals |
| Calls per signal (org **without** controls) | **0.00** | measured, 4 orgs, zero starts |
| Calls per org per week (with controls) | **~1,600–1,900** | three independent estimators agreeing ±8% |
| Orgs with controls | **4 of 13** (31%) | inferred from zero-vs-nonzero call rate |
| **Estate total, per week** | **~6,500–7,600 (call it ~7,000)** | 4 × ~1,750 |

### Tokens and money — a RANGE, because tokens are not instrumented

No token counts exist for this run: the LLM cost telemetry (`bfe79f78`) is not
on staging. The prompt carries instructions + up to
`MAX_CONTROLS_IN_PROMPT = 80` controls (id, name, description) + the signal
summary; the response is a small JSON match list.

Bounding the prompt at 1,500–6,000 input and 150–600 output tokens, priced from
the repo's own table for `claude-sonnet-4-6` ($3/Mtok in, $15/Mtok out):

| | per call | per week (7,000 calls) | per year |
|---|---:|---:|---:|
| low | $0.0068 | ~$48 | ~$2,500 |
| high | $0.0270 | ~$189 | ~$9,800 |

**This is an estimate with an honest error bar, not a measurement.** Landing the
LLM cost telemetry on staging replaces the range with a figure.

### Provider time — the scaling constraint that matters more than the money

At the measured mean of 5.72 s/call and the worker's deliberate concurrency of 1:

| scenario | calls/week | provider time/week | weekly headroom (168 h) |
|---|---:|---:|---:|
| today — 4 orgs with controls | ~7,000 | **~11.1 h** | 15× |
| all 13 staging orgs adopt controls | ~22,750 | **~36 h** | 4.7× |
| 40 orgs with controls | ~70,000 | **~111 h** | 1.5× — **at the wall** |

**Control adoption is the growth axis, not customer count.** Every org that
configures controls converts from ~9 minutes of processing to ~2.5 hours of
provider time. The async refactor moves that off the Brief's critical path, but
it does not make it smaller — and at ~40 control-configured orgs the queue stops
draining inside a week.

### Suggestion value — NOT measurable from here

`signal_match_suggestions` carries `accepted_at` / `accepted_by_user_id` /
`accepted_link_id`, so acceptance **is** measurable — but only against a
database, not from logs. In the retained staging log window there are **zero**
`signal_match_suggestion_accepted` and **zero** `signal_match_suggestion_dismissed`
events.

**That zero is not evidence of low value.** Staging has no organic analyst
traffic, so "no acceptances on staging" is vacuous in exactly the way "no denials
in prod" was for the seat-model gate. The honest position: **unknown, and it is
the single most important unknown in this document** — it is the ratio that
decides whether ~7,000 calls/week buys anything.

Operator-owed query, against **production**:

```sql
SELECT organization_id,
       COUNT(*)                                          AS suggestions,
       COUNT(*) FILTER (WHERE accepted_at  IS NOT NULL)  AS accepted,
       COUNT(*) FILTER (WHERE dismissed_at IS NOT NULL)  AS dismissed,
       ROUND(100.0 * COUNT(*) FILTER (WHERE accepted_at IS NOT NULL)
             / NULLIF(COUNT(*), 0), 1)                   AS accept_pct
  FROM signal_match_suggestions
 WHERE match_reason IS NOT NULL
   AND created_at > now() - interval '90 days'
 GROUP BY organization_id
 ORDER BY suggestions DESC;
```

---

## 2. Eligibility policy — options, NOT a decision

Current gate: `flag ON` **AND** control-relevant signal type **AND** severity
**Critical or High**. That passes ~46% of processed signals.

| option | mechanism | est. call reduction | what it costs you |
|---|---|---:|---|
| **A. Status quo** — Critical + High | unchanged | 0% | Cost and provider time scale with control adoption, hitting the weekly wall at ~40 control-configured orgs. |
| **B. Critical only** | drop `High` from the gate | **~50–70%** *(unmeasured — see gap 1)* | Loses High-severity CVEs, which are the majority of real control-relevant exposure. Blunt: severity is a property of the CVE, not of this org's exposure. |
| **C. Vendor-relevant only** | require the signal to have matched one of the org's vendors / AI systems | **large, unmeasured** *(gap 2)* | Ties spend to the org's actual footprint. Misses control-relevant signals about software the org runs but has not registered as a vendor. |
| **D. Actively-exploited only (KEV)** | restrict to CISA KEV | **~99%** (~9 signals/org/week) | Very high precision, very low recall. Almost certainly too narrow alone. |
| **E. Recommended: (vendor-relevant **OR** actively-exploited) AND Critical/High** | compose C and D under the existing severity gate | **large, unmeasured** | Spend follows relevance rather than volume, and it reuses the relevance concept the Brief's own `briefRelevanceEnabled` gate already applies. Same "misses unregistered vendors" caveat as C. |

### Why E, in one line

Severity is a property of the CVE; relevance is a property of the **org**. Paying
per-org for a per-CVE property is what makes cost scale with volume instead of
with value. E prices the work against the thing that actually differs per org.

### Two measurable gaps that should close BEFORE narrowing

1. **The Critical vs High split** of the ~46% that currently pass the gate.
   Decides option B entirely and is a one-query answer.
2. **The vendor-match rate** for those signals — what fraction reach a
   `matchedBranch` other than `no_match`. Sizes options C and E. The
   `matcher_run_for_signal` event already carries `matchedBranch`, so this is
   measurable from logs alone once someone counts a full run.

Plus the acceptance rate above, which is the one that decides whether to narrow
the feature or **invest** in it.

---

## 3. Recommendation

**Do not narrow yet.** Candidate A has already removed the customer-visible harm
(the Brief no longer waits), so there is no longer time pressure to cut scope.
Spending a week measuring the three gaps costs nothing and turns a guess into a
decision.

Proposed sequence:

1. Land LLM cost telemetry on staging → replaces the token/cost range with a figure.
2. Count the Critical/High split and the vendor-match rate from one full run.
3. Run the acceptance query against **production**.
4. **Then** choose between A and E, with numbers.

If a decision is needed before that, **E** is the recommendation — but it should
ship behind its own flag and be measured against the acceptance rate, not
assumed.

**Stopping here for approval. Nothing in section 2 is implemented.**
