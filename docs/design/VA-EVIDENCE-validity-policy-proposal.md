# VA-EVIDENCE — evidence-validity default policy: PROPOSAL

**Status:** PROPOSAL FOR OWNER RATIFICATION. **Not implemented. No durations are
in code.** Owner ruling 3 (2026-08-29) requires type- and policy-driven
validity, forbids a universal TTL, and forbids `uploaded_at + N days` where the
artifact carries a meaningful period. It also directs that defaults be proposed
separately rather than chosen inside the S4 package — this is that proposal.

**Companion:** `docs/design/VA-S4-assurance-wiring-plan.md` §2a Ruling 3.

---

## 1. The principle, and why the model already agrees with it

**Validity is a property of what the artifact ASSERTS, not of when we received
it.** A SOC 2 Type II covering 2025-01-01 → 2025-12-31 says something about that
year; uploading it in 2026 does not extend it, and uploading it late does not
shorten it.

This is not a new idea being imported. The canonical model already does exactly
this shape, per object class, and has **no universal expiry anywhere**:

| Existing | Pattern |
|---|---|
| `controls.testing_frequency` + `last_tested_at` → `next_test_due` | cadence + last event → next due |
| `pen_test_engagements.started_on` / `ended_on` / `next_test_due` | period + next due |
| `policies.review_frequency` + `last_reviewed_at` → `next_review_at` | cadence + last event → next due |
| `risks.next_review_due`, `vendor_engagements.next_review_due` | next due |
| `finding_risk_acceptances.expires_at`, `risk_approvals.expires_at` | explicit term |
| `retention_policies.effective_from` | effective term |

So the proposal below is **the existing idiom applied to evidence**, not a
competing concept. The only new persistence is `evidence.valid_from` /
`valid_until` (ADR-0012 20261051) — what the artifact asserts, snapshotted at
promotion and never recomputed.

### The resolution order (applies to every row in §3)

1. **Explicit artifact dates win.** If the artifact carries a coverage period,
   certification term, test date or contract term, that governs. Full stop.
2. **Otherwise the type's cadence applies**, anchored to the type's own start
   event (§3, "starts from").
3. **`uploaded_at` is a last resort**, used only for types that genuinely have
   no other date, and flagged as such so the weakness is visible rather than
   assumed.
4. **Unknown is not valid.** Missing dates never resolve to "current"; they
   resolve to `not_established`, which the S4 predicate treats as ineligible.

---

## 2. Are the existing evidence types normalized enough?

**Not yet — and this needs an answer before §3 can be applied.**

`evidence.evidence_type` is a free TEXT column with **no CHECK constraint**. On
staging the population is tiny (17 rows) and the two structured sources —
`vendor_assurance_documents.document_type_hint` (`soc1` | `soc2_type1` |
`soc2_type2`) and `pen_test_engagements.test_type` — carry their own
vocabularies that do not align with it.

So there are effectively **three partial type vocabularies** and one free-text
column. Applying per-type validity to a free-text field would produce policy
that silently misses on a typo.

**Recommendation:** normalise `evidence.evidence_type` to a closed vocabulary as
part of the validity package — reusing the two existing vocabularies as inputs
rather than inventing a third — and treat unrecognised values as
`not_established` rather than defaulting them. This is a prerequisite for §3,
not an optional tidy-up. **Do not create a duplicate classification**: the SOC
document hint and pen-test type should map INTO the evidence type, not sit
beside it.

---

## 3. Proposed defaults, by evidence type

Every duration below is a **proposal for ratification**. Guardrails are
expressed as min/max bounds a customer may move within; `—` means no guardrail
is proposed because the artifact's own dates govern.

### 3.1 SOC 1 / SOC 2 reports

| | |
|---|---|
| **Starts from** | `report_period_end` (Type II) or `report_issued_date` (Type I — a point-in-time opinion, not a period) |
| **Default validity** | **12 months** from period end |
| **Artifact dates** | Always govern. The period is extracted and human-accepted; it is never inferred |
| **Bridge/continuity** | A gap between period end and today is acceptable **only** with a bridge letter covering it. Absent a bridge, evidence older than the default is `stale`, not `invalid` — the distinction matters because a stale SOC 2 is still evidence of the period it covers |
| **Stale behaviour** | Does not contribute coverage. Does NOT delete or detach the artifact |
| **Customer configurability** | May tighten only |
| **Guardrails** | min 3 months, max 15 months (12 + a 3-month bridge window) |
| **Rationale** | 12 months matches the annual audit cycle these reports are produced on. The 15-month ceiling exists because a report whose period ended more than a full cycle ago has been superseded by one nobody has produced — that is a finding, not a validity question |

**Type I vs Type II must not share a rule.** A Type I attests design at a point
in time; a Type II attests operating effectiveness over a period. Treating a
Type I's issue date as if it were a period end would overstate it.

### 3.2 ISO certifications

| | |
|---|---|
| **Starts from** | certificate issue date |
| **Default validity** | **the certificate's stated term** (typically 3 years, with surveillance audits) |
| **Artifact dates** | Govern absolutely — a certificate states its own expiry |
| **Stale behaviour** | Expired certificate contributes nothing |
| **Customer configurability** | May tighten only |
| **Guardrails** | max = the stated term; never longer |
| **Rationale** | A certification term is a third-party assertion with an explicit end date. Inventing our own would be substituting our judgement for the certifying body's |

**Open question for ratification:** whether a certificate within term but with a
**missed surveillance audit** remains valid. Recommend treating it as `stale`
pending owner input, because we cannot observe surveillance audits.

### 3.3 Penetration tests

| | |
|---|---|
| **Starts from** | test end date (`pen_test_engagements.ended_on`) |
| **Default validity** | **12 months** |
| **Artifact dates** | Test period governs; `next_test_due` already exists on the object |
| **Stale behaviour** | Does not contribute coverage |
| **Customer configurability** | Tighten freely; loosen only within guardrail |
| **Guardrails** | min 3 months, max 18 months |
| **Rationale** | Annual is the common contractual and regulatory expectation. **A pen test is evidence about the environment as tested** — material change should invalidate it sooner, which is a scope question the model cannot currently answer (see §5) |

### 3.4 Vulnerability assessments / scans

| | |
|---|---|
| **Starts from** | scan completion |
| **Default validity** | **30–90 days** (proposed: 90 for periodic assurance, 30 where continuous scanning is claimed) |
| **Stale behaviour** | Ineligible quickly; scans age fast by nature |
| **Guardrails** | max 90 days |
| **Rationale** | A scan describes a moment. Its assurance value decays with every deployment, and the SL-OCC vulnerability-occurrence work already treats scan currency as scope-bounded |

### 3.5 Security / privacy / AI policies

| | |
|---|---|
| **Starts from** | `last_reviewed_at` (the column exists) |
| **Default validity** | **`review_frequency`**, which is already on `policies` |
| **Stale behaviour** | Past `next_review_at` → stale |
| **Customer configurability** | The cadence IS the customer's, within guardrails |
| **Guardrails** | max 24 months |
| **Rationale** | **Reuse, do not invent.** `policies.review_frequency + last_reviewed_at → next_review_at` already exists and is exactly this policy. Adding a second cadence for the same object would create two answers to one question |

### 3.6 BCP / DR test evidence

| | |
|---|---|
| **Starts from** | exercise date |
| **Default validity** | **12 months** |
| **Guardrails** | max 24 months |
| **Rationale** | Annual exercise is the common expectation; a two-year-old DR test describes an architecture that has usually moved |

### 3.7 Technical / configuration evidence

| | |
|---|---|
| **Starts from** | observation date (`evidence.collected_at` — the column exists, though populated on only 2 of 17 staging rows) |
| **Default validity** | **90 days** |
| **Guardrails** | max 180 days |
| **Rationale** | A screenshot or config export is a point observation of a mutable system. This is the one class where "observation age" genuinely is the right model — and note it still is not `uploaded_at`: an export taken in March and uploaded in July is four months old, not new |

### 3.8 Vendor attestations / questionnaire responses

| | |
|---|---|
| **Starts from** | questionnaire **issue** date, or engagement decision date |
| **Default validity** | **the vendor's reassessment cycle** — `vendor_engagements.next_review_due` already exists and is tier-driven |
| **Stale behaviour** | Past the reassessment cycle → stale |
| **Guardrails** | tier-driven; tighter for higher tiers |
| **Rationale** | **Reuse.** The reassessment cadence is already computed per engagement. An attestation is exactly as current as the assessment that collected it, so binding it to anything else would let the two disagree |

### 3.9 Privacy / DPA / sub-processor evidence

| | |
|---|---|
| **Starts from** | agreement effective date |
| **Default validity** | **the contractual term**, else 24 months |
| **Artifact dates** | Contract term governs |
| **Stale behaviour** | A DPA is usually evergreen; the **sub-processor list** is not, and ages far faster than the agreement |
| **Guardrails** | sub-processor list max 12 months |
| **Rationale** | **These are two different artifacts with one name.** A DPA can be valid for years while its Annex is a year stale. Ratifying one duration for both would make the shorter-lived half invisible |

### 3.10 AI governance / model / testing evidence

| | |
|---|---|
| **Starts from** | evaluation or model-version date |
| **Default validity** | **tied to the model version**, else 6 months |
| **Stale behaviour** | A model version change invalidates prior evaluation evidence regardless of age |
| **Guardrails** | max 12 months |
| **Rationale** | Bias/accuracy/robustness evidence is about a specific model version. Time is the weaker signal here; **version identity is the real one**, and this is the clearest case where an elapsed-time rule would be actively misleading |

### 3.11 Contracts

| | |
|---|---|
| **Starts from** | effective date |
| **Default validity** | **the stated term**, else until terminated |
| **Artifact dates** | Term governs absolutely |
| **Guardrails** | — |
| **Rationale** | A contract states its own life. Imposing a TTL would be inventing an expiry the parties did not agree |

### 3.12 Other independent assurance artifacts

Anything not above (HITRUST, PCI AOC, CSA STAR, regulator correspondence)
follows §3.2's shape: the artifact's own term governs; absent a term, treat as
`not_established` rather than defaulting. **Do not add a catch-all TTL** — a
default that applies to unknown artifacts is a universal TTL wearing a different
name.

---

## 4. Customer configurability, and the guardrail direction

Per ruling 2's principle: customers may **strengthen**, not weaken.

- Tightening (shorter validity) is always permitted.
- Loosening is permitted only within the max guardrail, and never beyond an
  artifact's own stated dates.
- A customer may never make an expired certificate current.
- Configuration changes must be **versioned**, so a past assurance decision is
  reconstructible against the policy in force at the time — not today's.

---

## 5. What this proposal cannot yet express

Recorded so ratification is not mistaken for completeness:

1. **Scope-bounded validity.** A pen test or scan is evidence about a defined
   scope; material change should invalidate it before its clock runs out. The
   model has no environment-change signal to hang that on.
2. **Bridge letters** are not represented as an artifact type.
3. **Surveillance-audit status** for certifications is unobservable.
4. **Model-version identity** for AI evidence has no canonical anchor, so §3.10
   currently degrades to the weaker time rule.
5. **Type normalisation is a prerequisite** (§2) and is not itself proposed
   here as a duration.

---

## 6. Decisions required to ratify

1. Every duration in §3 — this document proposes, it does not decide.
2. §3.1: the bridge-letter window (proposed 3 months).
3. §3.2: whether a missed surveillance audit makes a certificate stale.
4. §3.9: separate treatment for DPA vs sub-processor list (recommended).
5. §3.10: whether model-version change invalidates unconditionally.
6. §2: approval to normalise `evidence.evidence_type` as part of the package.
