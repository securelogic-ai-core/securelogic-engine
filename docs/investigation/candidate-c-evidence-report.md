# Candidate C — evidence report

**ANALYSIS ONLY.** Nothing implemented, no flag changed, no deploy, no merge, no
data modified. Read-only aggregate queries against the staging and production
databases via the authorized Render channel; no customer content read.

Date: 2026-08-18. Evidence window: 7 days ending 2026-08-18T18:00Z (staging).

Every number below is tagged **MEASURED** · **RECONSTRUCTED** · **PROJECTED** ·
**HYPOTHETICAL** · **UNKNOWN**.

---

## 1. Executive verdict

**Three findings change the shape of this decision, and two of them correct my
own previous numbers.**

1. **Production has never run this feature.** 1 active org, **0 controls**,
   **0 suggestion rows ever**. The matcher exits before any provider call when an
   org has no controls. Candidate C would change nothing in production today.
   *(MEASURED)*
2. **Latency does NOT scale with control-inventory size.** Directly measured
   across three orgs: 1 control → 4.93 s, 3 controls → 2.18 s, 9 controls →
   5.72 s. **The linear "2.46 + 0.318 × controls" model in my previous report was
   an artifact of dividing org duration by call count, and is withdrawn.**
   Consequence: previous capacity ceilings (12–31 orgs) were far too pessimistic.
   Corrected ceiling for status quo is **57–150 control-configured orgs**.
   *(MEASURED, supersedes PROJECTED)*
3. **Critical signals are the LEAST org-relevant slice, not the most.**
   Vendor-relevance is **3.10% for Critical** vs **19.21% for High** — High is
   **6.2× more likely** to be relevant. And **100% of KEV signals are severity
   High**. Critical-only would therefore discard every actively-exploited signal
   and keep the least customer-specific ones. *(MEASURED)*

**Scalability verdict:** the status quo is not in danger at realistic scale.
Cost is small ($5.6k–$139k/yr across 10→250 orgs) and the queue drains until
~57–150 orgs. Narrowing is an **optimisation, not a rescue**.

**Customer-value verdict:** **INSUFFICIENT EVIDENCE TO DETERMINE CUSTOMER VALUE.**

---

## 2. What is measured vs projected

| claim | status |
|---|---|
| Gate population, severity split, vendor-relevance, KEV counts, control/vendor inventories, production emptiness | **MEASURED** (SQL) |
| Per-call latency (3 orgs, n=34/48/114 paired spans) | **MEASURED** (log pairing) |
| Prompt token count | **RECONSTRUCTED** (analytic from `buildControlMatcherPrompt`) |
| Output token count | **RECONSTRUCTED** (observed response shape) |
| All 10/25/50/100/250-org figures | **PROJECTED** (linear in org count) |
| Cache hit rates | **HYPOTHETICAL** (never observed) |
| Acceptance / value / ROI | **UNKNOWN** |

---

## 3. Critical vs High distribution — GAP 1 CLOSED

**MEASURED**, 7-day window, org-scoped signals, all 13 staging orgs:

| bucket | signals | per org | share of gate |
|---|---:|---:|---:|
| All org-scoped signals | 50,483 | 3,883 | — |
| Control-relevant `signal_type` | 50,199 | 3,861 | — |
| **Matcher-eligible (gate)** | **27,463** | **2,113 mean / 1,853 median** | **100%** |
| — **Critical** | 5,031 | 387 | **18.3%** |
| — **High** | 22,432 | 1,726 | **81.7%** |

Full severity distribution: High 44.45%, Moderate 43.67%, Critical 9.95%, Low 1.93%.

**Workload attribution:** matcher work is linear in call count, so Critical
carries **18.3%** of the workload and High **81.7%**.

### The mean/median gap is explained, and is not a defect

Two orgs show 3,526 gate signals instead of 1,853. Cause **(MEASURED)**: they
were created 2026-08-10 and 2026-08-15 and each ingested the **full CISA KEV
catalog once** (1,666 rows) as a first-time backfill. Established orgs receive
only KEV deltas (4–9/week). Every org receives an identical 1,828 NVD + 387
Critical gate signals — the same global feed fanned out per tenant.

**All projections below use the steady-state median of 1,853**, with the
one-time ~1,670-call onboarding backfill called out separately in §8.

### Stated limitation

This is **one week**. NVD publication volume varies seasonally and by
disclosure-embargo cycles; a single week cannot establish variance. The
*severity ratio* is likely more stable than the absolute volume, but neither is
established by n=1 week. **Do not treat 1,853/org/week as a constant.**

---

## 4. Vendor-relevance findings — GAP 2 CLOSED

**Classification method, stated exactly:** a gate-passing signal counts as
vendor-relevant iff a row exists in `signal_match_suggestions` with
`target_type IN ('vendor','ai_system')` for that `signal_id`. That is the
**existing deterministic matcher's own output** — the `vendor_name_ilike` /
CVE-match branches recorded in `matcher_run_for_signal`. **No new definition of
relevance was invented for this analysis.**

**MEASURED**, per org:

| org | gate signals | vendor-relevant | rate | active vendors | controls |
|---|---:|---:|---:|---:|---:|
| fe2ede61 | 1,868 | 310 | **16.6%** | 10 | 9 |
| 295b989a | 1,853 | 280 | **15.1%** | 2 | 3 |
| 44fd5f70 | 3,526 | 0 | 0% | 2 | 0 |
| 55041494 | 1,853 | 0 | 0% | 1 | 0 |
| 9 others | ~1,853 each | 0 | 0% | 0 | 0 |

### Relevance differs sharply by severity — the decisive finding

**MEASURED**, across the two orgs with populated vendor inventories:

| severity | gate signals | vendor-relevant | rate |
|---|---:|---:|---:|
| **Critical** | 774 | 24 | **3.10%** |
| **High** | 2,947 | 566 | **19.21%** |

**High signals are 6.2× more likely to be vendor-relevant than Critical ones.**

Source breakdown **(MEASURED)** confirms it is not a single-source artifact:
NVD High 18,746 (561 relevant), NVD Critical 5,018 (22 relevant), CISA KEV High
3,381 (5 relevant), CISA alerts High 292 (0).

### Calls avoided under a vendor-relevance gate

**MEASURED** for the two orgs with vendors: 1,868 → 310 and 1,853 → 280.
**~84% of matcher calls avoided.**

### The caveat that cuts against C and E

Both measured orgs hold **2 and 10 vendors**. A real enterprise carries far
more, and relevance rises with inventory size. **The 16% figure is a lower bound
measured on near-empty vendor inventories; a genuine enterprise customer would
see a materially higher rate, so the 84% saving is very likely OVERSTATED.**
*(MEASURED input, UNKNOWN extrapolation.)*

---

## 5. Production suggestion-value evidence — GAP 3: NOT MEASURABLE

**MEASURED** against the production database:

| metric | value |
|---|---|
| Active organizations | **1** |
| Controls (all orgs) | **0** |
| Orgs with ≥1 control | **0** |
| Active vendors | **0** |
| `signal_match_suggestions` rows, all time | **0** |
| `llm_control_matcher_verdicts` table | **does not exist** (migration unpromoted) |
| cyber_signals total / last 14 d | 25,704 / 9,059 |
| Published intelligence briefs | 7 |

| requested metric | status |
|---|---|
| Suggestions generated | **MEASURED: 0** |
| Suggestions viewed/reviewed | **NOT MEASURABLE** — no per-suggestion view event exists |
| Accepted | **MEASURED: 0** (of 0) |
| Dismissed | **MEASURED: 0** (of 0) |
| Converted to findings/actions/remediation | **NOT MEASURABLE** — and vacuous at 0 rows |
| Untouched/unreviewed | **MEASURED: 0** (of 0) |

The zeroes mean **the feature has never produced output in production**, not
that customers rejected it. Per instruction, staging's zero accept/dismiss
activity is **not** used as evidence either way.

**Exact read-only query for when production has a control-configured org:**

```sql
SELECT s.organization_id,
       COUNT(*)                                                   AS generated,
       COUNT(*) FILTER (WHERE s.accepted_at  IS NOT NULL)         AS accepted,
       COUNT(*) FILTER (WHERE s.dismissed_at IS NOT NULL)         AS dismissed,
       COUNT(*) FILTER (WHERE s.accepted_at IS NULL
                          AND s.dismissed_at IS NULL)             AS untouched,
       COUNT(*) FILTER (WHERE s.accepted_link_id IS NOT NULL)     AS converted_to_link,
       ROUND(100.0*COUNT(*) FILTER (WHERE s.accepted_at IS NOT NULL)
             / NULLIF(COUNT(*),0), 1)                             AS accept_pct
  FROM signal_match_suggestions s
 WHERE s.match_reason IS NOT NULL
   AND s.created_at > now() - interval '90 days'
 GROUP BY s.organization_id;
```

**Instrumentation gap:** "viewed / surfaced" cannot be answered by this query or
any current event — see §13.

---

## 6. Current measured baseline — reconciled

Each prior figure independently re-checked:

| prior figure | verdict | corrected value |
|---|---|---|
| Sequential run ≈ 10.99 h | **MEASURED, stands** | 10.99 h (`durationMs 39624403`, 13 orgs, 0 errors) |
| Longest org ≈ 3.15 h | **RECONSTRUCTED, stands** | 3.147 h, from consecutive `scheduler_org_start` timestamps |
| Concurrency-2 ≈ 6.24 h | **PROJECTED, stands** | simulation of the worker pool over real per-org durations |
| Provider workload ≈ 11.1 provider-h/week | **SUPERSEDED** | **≈ 8.8–12.2 h/week** — recomputed as Σ(calls × measured per-org latency) rather than one blended latency |
| Cost ≈ $48–$189/week | **SUPERSEDED** | **≈ $43/week** for the current 4 control-configured orgs (9,111 calls × $0.00577) |
| Control adoption is the scaling axis | **MEASURED, stands and strengthens** | 4 of 13 orgs hold controls; they are exactly the 4 slow orgs. Orgs with 0 controls make **0** calls |

### Customer/org count vs control-configured org count

| | staging | production |
|---|---:|---:|
| Active organizations | 13 | **1** |
| **Control-configured organizations** | **4** | **0** |

**All projections in §7–§9 use control-configured organizations.** An org with
no controls contributes exactly zero matcher calls, zero provider time and zero
cost.

### Measured per-call latency

| org | controls | mean latency | paired spans |
|---|---:|---:|---:|
| 295b989a | 3 | **2.18 s** | 34 |
| b1a3da2d | 1 | **4.93 s** | 48 |
| fe2ede61 | 9 | **5.72 s** | 114 |

**No monotonic relationship with inventory size.** Projections use the measured
mean **4.28 s** with a **2.18–5.72 s** band. **Latency above 9 controls is
UNKNOWN — no measurement exists.**

---

## 7. Candidate C scaling projections

### Formulas

```
calls/week          = N_orgs × calls_per_org_per_week(policy)
provider-hours/week = calls/week × latency_seconds / 3600
cost/week           = calls/week × (TOK_IN × $3/1e6 + TOK_OUT × $15/1e6)
```

**Measured inputs** — steady-state calls/org/week: A 1,853 · B 387 · C 295
(mean of 280/310) · D 4 · E 299 (mean of 282/316).
**Reconstructed inputs** — TOK_IN 1,173, TOK_OUT 150 → **$0.00577/call**.
Token counts are analytic, not instrumented; treat cost as ±40%.

### Provider-hours/week — mean latency [low–high band]

| policy | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|---:|
| **A** Status quo | 22 [11–29] | 55 [28–74] | 110 [56–147] | **220** [112–294] | **551** [281–736] |
| **B** Critical-only | 5 [2–6] | 12 [6–15] | 23 [12–31] | 46 [23–61] | 115 [59–154] |
| **C** Vendor-relevant | 4 [2–5] | 9 [4–12] | 18 [9–23] | 35 [18–47] | 88 [45–117] |
| **D** KEV only | 0 | 0 | 0 | 0 [0–1] | 1 [1–2] |
| **E** Vendor OR KEV | 4 [2–5] | 9 [5–12] | 18 [9–24] | 36 [18–48] | 89 [45–119] |

### Cost/week · /month · /year

| policy | | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---|---:|---:|---:|---:|---:|
| **A** | wk / yr | $107 / $5.6k | $267 / $13.9k | $534 / $27.8k | $1,069 / $55.6k | $2,672 / $139.0k |
| **B** | wk / yr | $22 / $1.2k | $56 / $2.9k | $112 / $5.8k | $223 / $11.6k | $558 / $29.0k |
| **C** | wk / yr | $17 / $0.9k | $43 / $2.2k | $85 / $4.4k | $170 / $8.9k | $425 / $22.1k |
| **D** | wk / yr | $0 / $12 | $1 / $30 | $1 / $60 | $2 / $120 | $6 / $300 |
| **E** | wk / yr | $17 / $0.9k | $43 / $2.2k | $86 / $4.5k | $172 / $9.0k | $431 / $22.4k |

Monthly = weekly × 52/12.

### Reduction vs status quo

Calls, provider-hours and cost are all linear in call count, so **the three
reduction percentages are identical** for each policy:

| policy | reduction | calls/org/week |
|---|---:|---:|
| **B** Critical-only | **79.1%** | 387 |
| **C** Vendor-relevant | **84.1%** | 295 |
| **D** KEV only | **99.8%** | 4 |
| **E** Vendor OR KEV | **83.9%** | 299 |

Every policy is calculable. **None is NOT CALCULABLE**, though C and E rest on a
relevance rate measured on two near-empty vendor inventories (§4).

---

## 8. Unit economics — CONTROL-MATCHER LLM COST ONLY

Not total customer cost, not gross margin. SecureLogic carries other
infrastructure and AI costs outside this calculation.

Per control-configured organization:

| policy | calls/wk | provider-h/wk | $/week | $/month | marginal $/yr per added org |
|---|---:|---:|---:|---:|---:|
| **A** Status quo | 1,853 | 2.20 | $10.69 | $46.34 | **$556** |
| **B** Critical-only | 387 | 0.46 | $2.23 | $9.68 | $116 |
| **C** Vendor-relevant | 295 | 0.35 | $1.70 | $7.38 | $89 |
| **D** KEV only | 4 | 0.005 | $0.02 | $0.10 | $1.20 |
| **E** Vendor OR KEV | 299 | 0.36 | $1.72 | $7.48 | $90 |

**Marginal cost is linear** — every added control-configured org costs the same
as the last; there are no economies of scale, because the cache cannot span orgs
(§10).

**One-time onboarding cost (MEASURED):** a newly created org ingests the full
KEV catalog once — **~1,666 extra gate signals ≈ $9.61 one-off** under status
quo. Under C/E it is far smaller (KEV is rarely vendor-relevant: 5 of 3,381).

---

## 9. Queue / capacity analysis

**This is a CAPACITY MODEL, not a prediction of scheduler wall-clock.**

### Provider-hours vs wall-clock — they are now different subsystems

After Candidate A the matcher no longer runs inside the Brief scheduler.

- **Provider-hours** = total time the provider is occupied = `calls × latency`.
  A property of the workload, independent of how it is scheduled.
- **Wall-clock** = elapsed time to drain, = provider-hours ÷ effective worker
  concurrency (matcher worker concurrency is **1**).

**Does bounded org concurrency = 2 change the provider-hour capacity limit?
No — and after Candidate A it does not change matcher wall-clock either.** Org
concurrency 2 governs the *Brief scheduler*, which no longer issues matcher
calls. It changes Brief publication wall-clock (10.99 h → ~6.24 h projected) and
nothing about matcher capacity. The two are decoupled by design.

### Break-even: control-configured orgs at which provider-hours/week ≥ 168 h

**PROJECTED**, at worker concurrency 1:

| policy | @ low latency (2.18 s) | @ mean (4.28 s) | @ high (5.72 s) |
|---|---:|---:|---:|
| **A** Status quo | 150 | **76** | **57** |
| **B** Critical-only | 717 | 365 | 273 |
| **C** Vendor-relevant | 940 | 479 | 358 |
| **D** KEV only | 69,358 | 35,327 | 26,434 |
| **E** Vendor OR KEV | 928 | 473 | 354 |

**This supersedes the previous report's 12–31 org ceiling**, which was derived
from the withdrawn latency-scaling model.

Caveats: assumes steady-state 1,853 gate signals/org/week (one week's
observation), no retries, and worker concurrency held at 1. Raising worker
concurrency multiplies every figure proportionally and is a lever independent of
eligibility — **not evaluated or recommended here.**

---

## 10. Verdict-cache sensitivity

**All primary tables above assume ZERO cache benefit.** That is not
conservatism, it is the measured situation: every NVD signal is new each week
(3,563 inserted, **0 duplicates**), each `(org, signal)` pair is processed
exactly once, so every lookup is `miss: absent`.

### What invalidates reuse

Key = `(organization_id, signal_dedup_hash, control_inventory_digest, prompt_version)`.

| change | effect |
|---|---|
| Different **organization** | different key — the same CVE costs one call per org, by design |
| Changed **control inventory** | digest changes → all that org's prior verdicts unreachable |
| Changed **prompt version** | every verdict estate-wide unreachable |
| Genuinely different **signal dedup hash** | different key — the dominant case here |

### Standing ruling preserved

`answered` = **reusable** · `unparseable` = **NOT reusable** · `failed` = **NOT
reusable**. Only `answered` satisfies a lookup; `unparseable` is persisted for
observability only; `dead_lettered` is never auto-retried.

### HYPOTHETICAL — NOT OBSERVED

Provider-hours/week under status quo at hypothetical hit rates. **No hit rate
has ever been measured. These are not expected savings.**

| hit rate | n=10 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|
| **0%** (the measured situation) | 22 | 110 | 220 | 551 |
| 25% — HYPOTHETICAL | 17 | 82 | 165 | 413 |
| 50% — HYPOTHETICAL | 11 | 55 | 110 | 275 |
| 75% — HYPOTHETICAL | 6 | 27 | 55 | 138 |

A material hit rate would require a workload change that does not currently
exist (re-processing the same signals for the same org under an unchanged
control inventory). **Do not budget against these rows.**

---

## 11. Candidate E analysis

### Is the reasoning supported?

> *"Severity is a property of the CVE; relevance is a property of the
> organization. Paying for organization-specific LLM analysis based only on a
> global CVE property can cause cost to scale with vulnerability volume rather
> than customer-specific value."*

**The first half is MEASURED-supported and stronger than stated.** Severity is
demonstrably a poor proxy for org relevance: Critical is **3.10%** relevant vs
High **19.21%** — the severity signal points the *wrong way*. And every org
receives an identical 1,828 NVD + 387 Critical gate signals regardless of its
footprint: cost under the status quo is a pure function of NVD publication
volume × org count, exactly as the statement claims.

**The second half — that relevance tracks customer-specific value — is NOT
supported by evidence.** It is plausible, and it is currently unfalsifiable:
§5 shows there is no acceptance data. **The reasoning is half-proven.**

### Work avoided, per control-configured org per week

| vs | E calls | that policy's calls | difference |
|---|---:|---:|---:|
| Status quo (A) | 299 | 1,853 | **−1,554 (−83.9%)** |
| Critical-only (B) | 299 | 387 | −88 (−22.7%) |
| Vendor-relevant (C) | 299 | 295 | **+4 (+1.4%)** |
| KEV-only (D) | 299 | 4 | **+295 (+7,375%)** |

**E is only 1.4% more expensive than C** — the measured KEV/vendor overlap is
2–3 signals, so KEV adds almost nothing to the bill while covering a category C
would miss entirely.

### What E MISSES — false-negative / coverage risk

This is where E looks worst, and it should be stated plainly.

1. **E discards ~84% of gate-passing signals.** Any control implication in that
   84% is never surfaced. With acceptance unmeasured, **the false-negative cost
   is UNKNOWN and could be the majority of the feature's value.**
2. **Vendor-relevance depends on a maintained vendor inventory.** An org with
   controls but **no registered vendors gets 0.2% of the status-quo coverage**
   (KEV only). Measured: 9 of 13 staging orgs have zero vendors. **Under E those
   orgs would receive almost nothing** — a silent, invisible degradation.
3. **Vendor matching is `vendor_name_ilike`-based**, so it misses software the
   org runs but has not registered, and misses name variants. E inherits every
   false negative of the deterministic matcher.
4. **Critical coverage collapses.** Critical is only 3.10% vendor-relevant and
   0% KEV, so E retains roughly **3%** of Critical signals. If a customer expects
   "you told me about every Critical CVE affecting my controls", E breaks that
   expectation hardest exactly where the language is most alarming.
5. **The 84% saving is likely overstated** (§4): measured on inventories of 2 and
   10 vendors. A real enterprise's higher relevance rate means less saving —
   E's economics get *worse*, not better, as customers mature.

---

## 12. Customer-value conclusion

# INSUFFICIENT EVIDENCE TO DETERMINE CUSTOMER VALUE

Production has generated zero suggestions, so there is no acceptance, dismissal,
analyst-interaction, finding-conversion or remediation evidence of any kind.
Staging's inactivity is not used as evidence in either direction.

Nothing in §7–§11 speaks to value. Those sections establish what the feature
**costs**, never what it is **worth**. Engineering efficiency is not converted
into a value claim anywhere in this report.

---

## 13. Telemetry gaps

| stage | status | note |
|---|---|---|
| signal → matcher run | **ALREADY MEASURABLE** | `matcher_run_for_signal`, `llm_control_matcher_start/_done` |
| suggestion generated | **ALREADY MEASURABLE** | table rows + `llm_control_matcher_done.written` |
| suggestion surfaced | **PARTIALLY MEASURABLE** | HTTP request logs carry `path`, so list-route calls are countable — route-level only, not per suggestion, and only within log retention |
| analyst viewed | **NOT MEASURABLE** | no per-suggestion view event; the list route logs only on failure |
| accepted / dismissed | **ALREADY MEASURABLE** | `accepted_at` / `dismissed_at` / `dismissal_reason` + events |
| finding/action created | **PARTIALLY MEASURABLE** | `accepted_link_id` records the link created on accept; whether it became a finding or drove an action needs a join and is not directly recorded |
| remediation initiated / completed | **NOT MEASURABLE** | no link from a suggestion to remediation lifecycle |

### Minimum additions that would materially improve the Candidate C decision

Only two are needed — the rest can wait:

1. **A per-suggestion "surfaced" event** (or a `first_surfaced_at` column) on the
   list route. Without it, a low acceptance rate cannot be distinguished from
   "nobody ever looked", which are opposite conclusions.
2. **A `source` discriminator on `signal_match_suggestions`** distinguishing
   LLM-produced from deterministic-matcher rows, so acceptance can be attributed
   to the thing Candidate C would narrow. Today both write to the same table and
   `match_reason` is the only hint.

**Not recommended now:** full remediation-lifecycle tracing. It is a large build
and it does not change the Candidate C decision.

---

## 14. Recommendation

**Do not narrow eligibility yet.** The evidence supports this more firmly than
last time, for a corrected reason:

- The scalability case for narrowing is **much weaker than previously reported**.
  Status quo runs to **57–150 control-configured orgs** before the queue fails to
  drain, not 12–31. At the realistic near-term scale (10–50 orgs) the status quo
  costs **$5.6k–$27.8k/year** and uses **22–110** of 168 available provider-hours.
- The value side is not merely unmeasured, it is **unmeasurable** until
  production has a control-configured org.
- Narrowing now would permanently discard ~84% of signals whose value has never
  been observed, to save money that is not currently a constraint.

**If a decision is forced, E remains the best of the narrowing options** — 83.9%
reduction, only 1.4% more expensive than C, and it uniquely preserves
actively-exploited coverage. But it must ship with a fallback for orgs holding
controls and no vendor inventory, or those orgs silently receive ~0.2% coverage.

**B (Critical-only) should be removed from consideration.** The measured evidence
is against it on three independent counts: it keeps the *least* org-relevant
slice (3.10% vs 19.21%), it discards **100%** of actively-exploited KEV signals
(all of which are severity High), and it saves *less* than C or E.

---

## 15. Exact next decision required from you

**One decision, and it is not about eligibility:**

> **Do we defer the Candidate C decision until production has at least one
> control-configured organization and 30–60 days of suggestion-acceptance data?**

- **If YES** — nothing further is built. Optionally authorise telemetry item 1
  (per-suggestion "surfaced" event), which is small and is the difference between
  a future measurable decision and another unmeasurable one.
- **If NO**, and a policy must be chosen now — the choice is **A (status quo)**
  or **E**, with B eliminated on evidence. I would need one further ruling: what
  should orgs with controls but no vendor inventory receive under E?

Secondary, independent of Candidate C: **should the KEV-catalog onboarding
backfill (~1,666 extra calls per newly created org) be suppressed?** It is a
one-time ~$9.61/org and is arguably wasted work at onboarding. Not urgent.
