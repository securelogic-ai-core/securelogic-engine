# Control-suggestion measurement gaps — CLOSED, plus scaling projections

Status: **measurement + projection. Candidate C still NOT implemented.**
Date: 2026-08-18. Read-only queries against the staging and production
databases (aggregate counts only; no customer content read).

> **Everything in §1–§3 is MEASURED.** Everything in §4–§5 is **PROJECTED** from
> those measurements under stated assumptions. The two are never mixed in a
> single table.

---

## 0. The finding that reframes the decision

**Production has never made a single LLM control-matcher call, and cannot today.**

Measured against the production database:

| | |
|---|---|
| Active organizations | **1** |
| Controls, all orgs | **0** |
| Orgs with any controls | **0** |
| Active vendors | **0** |
| `signal_match_suggestions` rows | **0** |
| `llm_control_matcher_verdicts` table | **does not exist** (migration not promoted) |
| cyber_signals (total / last 14 d) | 25,704 / 9,059 |
| Published briefs | 7 |

The matcher returns before any provider call when an org has no controls. With
zero control-configured orgs in production, the feature's production blast
radius — cost, latency and value alike — is currently **zero**.

**Consequence for Candidate C: narrowing eligibility today would change nothing
in production.** The entire cost picture is a staging phenomenon driven by four
orgs holding 1–9 controls each, and a forward projection for production.

---

## 1. Gap 1 — CLOSED: the Critical vs High split

Measured over the full 2026-08-18 run window, org-scoped signals:

| bucket | signals | share |
|---|---:|---:|
| All signals ingested | 50,483 | 100% |
| Control-relevant `signal_type` | 50,199 | 99.4% |
| **Gate: type + Critical/High** | **27,463** | **54.4%** |
| — of which **Critical** | 5,031 | **18.3% of gate** |
| — of which **High** | 22,432 | **81.7% of gate** |

Full severity distribution: High 44.45%, Moderate 43.67%, Critical 9.95%,
Low 1.93%.

**Correction to the proposal:** it estimated Critical-only would cut calls
"~50–70%". The measured figure is **81.7%**. Critical-only is a far blunter
instrument than proposed.

Per-org gate load: **1,853 signals/org/week** (median of 13). Two orgs
(`f70267ce`, `44fd5f70`) show 3,526 — almost exactly double — which is
unexplained and worth a look, but does not change the model's shape.

## 2. Gap 2 — CLOSED: the vendor-relevance rate

Fraction of gate-passing signals that matched one of the org's vendors or AI
systems:

| org | gate signals | vendor-relevant | rate | active vendors |
|---|---:|---:|---:|---:|
| fe2ede61 | 1,868 | 310 | **16.6%** | 10 |
| 295b989a | 1,853 | 280 | **15.1%** | 2 |
| 44fd5f70 | 3,526 | 0 | 0% | 2 |
| 55041494 | 1,853 | 0 | 0% | 1 |
| all others (9) | ~1,853 each | 0 | 0% | 0 |

**~16% for an org with a populated vendor inventory; 0% for one without.** The
second half matters as much as the first: a vendor-relevance policy gives an org
with no registered vendors **no suggestions at all**.

## 3. Gap 3 — NOT MEASURABLE, and will not be soon

`signal_match_suggestions` in production: **0 rows.** Not zero accepted — zero
rows, ever.

There is no acceptance rate, no dismissal rate, and no analyst-review signal to
measure, because the feature has never produced output in production. Staging's
zero accept/dismiss events remain vacuous: staging has no analysts.

**Per instruction, no acceptance or value rate is extrapolated anywhere in this
document.** The value question is *open*, and it cannot close until production
has (a) at least one control-configured org and (b) analysts reviewing what the
matcher produces. Until then, every projection below is a **cost** model only —
it says what the feature will cost, never what it is worth.

---

## 4. Measured inputs carried into the projections

| input | value | how measured |
|---|---|---|
| Gate-passing signals / org / week | **1,853** | DB count over the run window |
| Calls / org / week | **≈ gate count** | every key first-time (0 NVD duplicates), so the verdict cache cannot hit |
| Critical share of gate | **18.3%** | DB count |
| Vendor-relevant share of gate | **16.0%** (orgs with vendors) | DB count |
| KEV new signals / org / week | **9** | scheduler ingest log |
| Latency @ 1 control | **2.7–2.9 s** | run milestones ÷ gate count |
| Latency @ 3 controls | **3.2 s** | ditto |
| Latency @ 9 controls | **5.3 s** | ditto, corroborated by 114 paired start→done spans (mean 5.72 s) |
| Prompt size | analytic from `buildControlMatcherPrompt` | 1,180-char scaffold + 357 chars/control (280-char desc cap) |

### The assumptions — and their weakest link

1. **Inventory size.** Staging's largest org holds **9** controls. Real GRC
   inventories are far larger, so projections are shown at **25** and at **80**
   (`MAX_CONTROLS_IN_PROMPT`, the ceiling).
2. **Latency scales with prompt size.** Fitting the four measured points gives
   `latency ≈ 2.46 + 0.318·controls` (2.7 s @1, 3.2 s @3, 5.3 s @9). Extending
   that to 25 controls (10.4 s) and 80 (27.9 s) is an **extrapolation 3–9×
   beyond the measured range and is the single weakest assumption here.** A
   flat-latency alternative (5.3 s regardless of inventory) is the optimistic
   bound; reality is very unlikely to be below it.
3. **Pricing** is list rate for `claude-sonnet-4-6` from the repo's own table
   ($3/Mtok in, $15/Mtok out). Token counts are analytic, not instrumented.
4. **Worker concurrency is 1**, by design. Weekly drain capacity = **168 h**.

---

## 5. PROJECTIONS — calls, provider-hours and cost

Format per cell: **calls/week / provider-hours/week**. `n` = control-configured
organizations.

### At 25 controls/org — prompt ~2,626 in / 250 out, **$0.0116/call**, fitted latency 10.4 s

| policy | calls/org/wk | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|---:|---:|
| **A** status quo (Critical+High) | 1,853 | 19k / **54 h** | 46k / **134 h** | 93k / **268 h** ⚠ | 185k / **536 h** ⚠ | 463k / **1,340 h** ⚠ |
| **B** Critical only | 339 | 3k / 10 h | 8k / 25 h | 17k / 49 h | 34k / 98 h | 85k / **245 h** ⚠ |
| **C** Vendor-relevant only | 296 | 3k / 9 h | 7k / 21 h | 15k / 43 h | 30k / 86 h | 74k / **214 h** ⚠ |
| **D** KEV only | 9 | 0k / 0 h | 0k / 1 h | 0k / 1 h | 1k / 3 h | 2k / 7 h |
| **E** Vendor-relevant OR KEV | 306 | 3k / 9 h | 8k / 22 h | 15k / 44 h | 31k / 88 h | 76k / **221 h** ⚠ |

| policy | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|---:|
| **A** | $215 | $539 | $1,077 | $2,155 | $5,387 |
| **B** | $39 | $99 | $197 | $395 | $987 |
| **C** | $34 | $86 | $172 | $345 | $862 |
| **D** | $1 | $3 | $5 | $10 | $26 |
| **E** | $36 | $89 | $178 | $356 | $889 |

### At 80 controls/org (prompt cap) — ~7,535 in / 400 out, **$0.0286/call**, fitted latency 27.9 s

| policy | calls/org/wk | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|---:|---:|
| **A** status quo | 1,853 | 19k / **144 h** | 46k / **359 h** ⚠ | 93k / **718 h** ⚠ | 185k / **1,436 h** ⚠ | 463k / **3,590 h** ⚠ |
| **B** Critical only | 339 | 3k / 26 h | 8k / 66 h | 17k / 132 h | 34k / **263 h** ⚠ | 85k / **658 h** ⚠ |
| **C** Vendor-relevant only | 296 | 3k / 23 h | 7k / 57 h | 15k / 115 h | 30k / **230 h** ⚠ | 74k / **574 h** ⚠ |
| **D** KEV only | 9 | 0k / 1 h | 0k / 2 h | 0k / 3 h | 1k / 7 h | 2k / 17 h |
| **E** Vendor-relevant OR KEV | 306 | 3k / 24 h | 8k / 59 h | 15k / 118 h | 31k / **237 h** ⚠ | 76k / **592 h** ⚠ |

| policy | n=10 | n=25 | n=50 | n=100 | n=250 |
|---|---:|---:|---:|---:|---:|
| **A** | $530 | $1,325 | $2,650 | $5,301 | $13,251 |
| **B** | $97 | $243 | $486 | $971 | $2,428 |
| **C** | $85 | $212 | $424 | $848 | $2,120 |
| **D** | $3 | $6 | $13 | $26 | $64 |
| **E** | $87 | $219 | $437 | $875 | $2,186 |

⚠ = exceeds the 168-hour weekly drain capacity: the queue never empties, backlog
grows without bound, and suggestions arrive later every week.

### Where each policy hits the wall

Organizations at which weekly provider-hours exceed 168 h (worker concurrency 1):

| policy | @9 controls (measured) | @25 controls | @80 controls |
|---|---:|---:|---:|
| **A** status quo | 61 | **31** | **12** |
| **B** Critical only | 335 | 171 | 64 |
| **C** Vendor-relevant only | 383 | 196 | 73 |
| **D** KEV only | 12,627 | 6,455 | 2,409 |
| **E** Vendor-relevant OR KEV | 372 | 190 | 71 |

---

## 6. What the numbers say

**Cost is not the binding constraint. Throughput is.** Even the worst cell is
~$13k/year — real, but not decisive for an enterprise platform. The constraint
that actually bites is the 168-hour week: under the status quo the queue stops
draining somewhere between **12 and 61 control-configured organizations**,
depending on inventory size. That is well inside a plausible customer count.

Three consequences worth stating plainly:

1. **The status quo has a hard ceiling, and it is low.** At 80 controls/org it is
   ~12 orgs. Any of B/C/E moves that ceiling out by ~5–6×.
2. **Raising worker concurrency is the other lever, and it is available.** The
   async package deliberately kept concurrency at 1. Going to 4 multiplies every
   capacity figure by 4 without touching eligibility — but it multiplies the
   provider-facing burst rate too, and it does nothing about cost. It is a
   genuine alternative to narrowing, and it should be weighed alongside C rather
   than assumed away.
3. **None of this is urgent.** Production has zero control-configured orgs. The
   ceiling is a design constraint to fix before adoption, not an incident.

## 7. Recommendation — unchanged in direction, sharper in detail

**Still do not narrow yet**, and now for a better-evidenced reason: the value
side of the ratio is not merely unmeasured, it is **unmeasurable until production
has a control-configured org**. Narrowing a feature whose output nobody has ever
reviewed would be optimising a number we cannot see.

If and when a decision is forced:

- **E (vendor-relevant OR KEV)** remains the recommendation on cost-per-value
  grounds — spend follows the org's actual footprint — but the measured 0% rate
  for orgs without vendors means it must ship with a fallback for orgs that have
  controls but no vendor inventory, or those orgs silently get nothing.
- **B (Critical only)** is now clearly the worst of the narrowing options:
  it discards **81.7%** of the gate on a property of the CVE rather than of the
  customer.
- **Raising worker concurrency** should be evaluated as a peer of C, not a
  consolation prize.

**Nothing in §5–§7 is implemented. Stopping for approval.**
