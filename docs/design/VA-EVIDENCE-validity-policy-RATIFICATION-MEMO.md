# DECISION MEMO — evidence-validity policy (wiring-plan Step 3)

**To:** the product owner
**From:** the platform build
**Date:** 2026-09-01
**Decision type:** ratification. **Nothing here is implemented, and nothing will
be implemented until this memo is answered.**
**Companion (the full analysis, unchanged):** `docs/design/VA-EVIDENCE-validity-policy-proposal.md`
**Blocked by this memo:** wiring-plan §7 step 3, and therefore step 5.

---

## 1. Why this needs a decision now, and not later

VA-S4-4C-4 shipped a twelve-veto sufficiency determination that refuses
`SUFFICIENT` whenever any veto is `FIRED` **or** `NOT_EVALUABLE`. Three vetoes
came back `NOT_EVALUABLE` on staging. One of them —

> `[20]` `report_period` → `NOT_EVALUABLE`, reason `no_ratified_validity_policy`

— is **not blocked on any code**. The dates parse. The window is extracted and
human-accepted. What is missing is a policy that says how long a report of that
class remains good for, and that is a product judgement, not an engineering one.

Step 2 (ADR-0012, migrations 20261080–82) has now landed the substrate: evidence
carries `valid_from`, `valid_until`, a `validity_basis` and an `assurance_class`.
**Nothing populates a duration, and nothing will, until the table in §3 is
approved.** Until then every determination the platform makes stays
`INDETERMINATE` — which is truthful, and permanent.

## 2. The fact that gives this decision its teeth

Measured on staging, 2026-08-31: **all 17 assurance extractions in the estate
share one report period, `2025-01-01` → `2025-12-31`.** As of today that period
ended **244 days ago**.

So the duration you ratify is not an abstraction — it decides, today, whether the
entire corpus is usable:

| Default validity from period end | Estate status on 2026-09-01 |
|---|---|
| 6 months | **STALE by 62 days** — nothing in the estate counts |
| 9 months | Valid, **29 days** remaining |
| **12 months (recommended)** | Valid, **121 days** remaining |
| 15 months | Valid, 212 days remaining |

A 6-month rule would take the whole estate out of scope on the day it is
ratified. A 15-month rule keeps evidence alive past the point where the next
annual report should already exist. **12 months matches the annual audit cycle
these reports are produced on**, which is why it is the recommendation.

## 3. The decisions

Each row is a yes/amend. Recommendations are the proposal's, restated so they can
be answered without re-reading it.

| # | Decision | Recommendation | If you do not decide |
|---|---|---|---|
| **D0** | Adopt `assurance_class` as a new orthogonal dimension rather than normalising `evidence_type` | **Yes — already built** in 20261080 under the wiring-plan's Step 2 authorisation, as a closed 16-value vocabulary. Ratify or send it back | The column exists but classifies nothing; every artifact stays `unclassified` and carries no validity |
| **D1** | SOC 1 / SOC 2 default validity | **12 months from period end**; guardrail min 3, max 15. Type I and Type II **must not share a rule** — a Type I attests design at a point in time | `report_period` stays `NOT_EVALUABLE`; S4 cannot proceed |
| **D2** | Bridge-letter window | **3 months.** Absent a bridge, an old report is **stale, not invalid** — it remains evidence of the period it covers | Bridged and unbridged gaps are treated identically |
| **D3** | ISO certifications | **The certificate's own stated term governs absolutely**; never longer | We substitute our judgement for the certifying body's |
| **D4** | A certificate within term with a **missed surveillance audit** | **Treat as stale.** We cannot observe surveillance audits, and fail-closed is the house rule | An unobservable condition silently reads as valid |
| **D5** | Penetration tests | **12 months** from test end; min 3, max 18 | — |
| **D6** | Vulnerability scans | **90 days** periodic / **30 days** where continuous scanning is claimed; max 90 | — |
| **D7** | Policies | **Reuse `policies.review_frequency` + `last_reviewed_at`.** Do not invent a second cadence for the same object; max 24 months | Two answers to one question |
| **D8** | BCP / DR test evidence | **12 months**; max 24 | — |
| **D9** | Technical / configuration evidence | **90 days** from observation date; max 180. Note this is `collected_at`, **never** `uploaded_at` | — |
| **D10** | Vendor attestations / questionnaires | **Reuse `vendor_engagements.next_review_due`** (tier-driven) | The attestation and the assessment that collected it can disagree |
| **D11** | DPA vs sub-processor list | **Separate treatment.** DPA = contractual term else 24 months; **sub-processor list max 12 months** | A DPA valid for years hides an Annex a year stale |
| **D12** | AI evaluation evidence | **Tied to model version**, else 6 months, max 12. Does a model-version change invalidate **unconditionally**? Recommend **yes** | Time becomes the only signal, and it is the wrong one here |
| **D13** | Contracts | **The stated term governs**; else until terminated. No TTL | We invent an expiry the parties did not agree |
| **D14** | Everything else (HITRUST, PCI AOC, CSA STAR, regulator correspondence) | The artifact's own term governs; absent a term, **`not_established`**. **No catch-all TTL** — a default for unknown artifacts is a universal TTL wearing a different name | — |
| **D15** | Customer configurability | **Tighten freely; loosen only within the max guardrail, never beyond the artifact's own dates.** A customer may never make an expired certificate current. Configuration must be **versioned**, so a past decision is reconstructible against the policy in force at the time | Customers can weaken governance, and history becomes unreadable |

## 4. One decision the memo adds to the proposal

**D16 — what happens to the legacy estate.** Step 2 fabricated no historical
validity: every pre-existing evidence row carries `validity_basis='not_established'`
and counts for nothing under the new predicate. Ratifying durations does **not**
retroactively fix that, and deliberately so — a duration applied to an artifact
whose class nobody established would be an inference dressed as a policy.

Three options, and this needs an answer before any wiring:

- **(a) Human curation, recommended.** Customers establish class and validity for
  the evidence they rely on, through the writer package's UI. Slowest, and the
  only one where the record means what it says.
- **(b) Machine-proposed, human-confirmed.** Derive a candidate class from
  `document_type_hint` / `pen_test_engagements.test_type`, present it, require a
  human to commit it. Faster; the confirmation is still real.
- **(c) Deterministic backfill.** Fast, and it invents judgements nobody made.
  **Not recommended**, and inconsistent with the direction that produced Step 2.

## 5. What this memo does not ask for

- **No implementation.** No duration exists in code, and the `validity_basis`
  vocabulary deliberately has **no `policy_default` value** — that value arrives
  in its own migration on the day this memo is approved, and not before.
- **No S4 wiring.** Ratifying this resolves one of three `NOT_EVALUABLE` vetoes.
  `contradictory_evidence` needs a populated `evidence_links`, and
  `open_findings` needs a populated dimension. Step 5's gate must be re-run and
  must pass on its own terms.
- **No production change.** Nothing here is deployed or promoted.

## 6. What the proposal still cannot express, recorded so approval is not mistaken for completeness

1. **Scope-bounded validity** — a pen test or scan is evidence about a defined
   scope; material change should invalidate it before its clock runs out, and the
   model has no environment-change signal to hang that on.
2. **Bridge letters** are not represented as an artifact type (D2 assumes they
   will be).
3. **Surveillance-audit status** is unobservable (which is what D4 concedes).
4. **Model-version identity** has no canonical anchor, so D12 degrades to the
   weaker time rule in practice.
