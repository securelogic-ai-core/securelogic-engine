# SR-016 — Vendor Assurance: document, extraction, review or gap-promotion problem

| | |
|---|---|
| **Playbook ID** | SR-016 |
| **Domain** | Vendor Assurance |
| **Severity default** | SEV3; **SEV2** if a vendor review blocks an audit or onboarding deadline |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | CUEC gap determination and promotion require the `develop` → `main` promotion |
| **Feature flag** | `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` — **`true` in production**. **`SECURELOGIC_VENDOR_PORTAL_ENABLED` is `false` everywhere** — see "What is not available" |
| **Last validated** | 2026-08-21 against `develop@4941f56e` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## What is not available at launch — say this plainly

**Vendors cannot log in to SecureLogic.** There is no vendor self-service portal at
Sept 15. The customer obtains the vendor's SOC 2 or security documentation through
their normal business process and **uploads it themselves**.

If a customer asks "how do I send my vendor a questionnaire to fill in?", the
honest answer is that this release is document-driven and vendor self-service is
not part of it. **Do not imply it exists, and do not offer to enable it.**

## Customer-visible symptoms

Upload fails · document stuck "processing" · no CUECs extracted · extraction looks
wrong · a CUEC cannot be marked as a gap · promoting a gap fails · a promoted
finding has no due date · the vendor review "doesn't do anything".

## The one that is usually not a bug

> **"I reviewed the document but nothing happened."**

Reviewing a document does not create work by itself. The chain is deliberate and
each step is a separate act:

**extract → review each CUEC → determine (`not applicable` / `satisfied` / `gap`) → promote the gap to a finding**

**Promotion is explicit on purpose.** An organisation may record that it does not
meet a requirement and decide, deliberately, not to open remediation yet. So a
reviewed document with no findings is a normal, valid outcome — often the *correct*
one for a clean vendor.

*(L1 OBSERVABLE — ask what the CUEC statuses are and whether promotion was clicked.)*

## What the errors mean

| Code / symptom | Meaning | Who fixes |
|---|---|---|
| `gap_reason_required` | A gap needs a written reason — it asserts the organisation fails an obligation | Customer |
| `invalid_severity` on promotion | Severity is required; there is **no default**, because severity drives the SLA and a deadline must belong to a person | Customer |
| `cuec_not_a_gap` | Only a gap can become a finding | Customer — record the determination first |
| `cuec_already_promoted` | The gap already produced a finding; changing it now would orphan that work | Customer — resolve or withdraw the finding |
| `vendor_assurance_cuec_not_found` | Not this organisation's, or does not exist — **deliberately undifferentiated** | Escalate if unexpected |
| Document stuck `extracting` | Extraction has not completed | **L2** |
| `extraction_failed` | Processing failed on this document | **L2** |

## Safe diagnostic steps

1. **Which step** — upload, processing, extraction, review, determination, or
   promotion? Each has a different owner. *(L1 OBSERVABLE.)*
2. **Document processing status** on the document view. *(L1 OBSERVABLE.)*
3. **CUEC statuses** — how many pending / not applicable / satisfied / gap?
   *(L1 OBSERVABLE.)*
4. **Was promotion actually performed?** A gap alone creates no finding.
   *(L1 OBSERVABLE.)*
5. **Does the org have an SLA policy?** No policy → a promoted finding gets no due
   date, which is correct, not a bug → **SR-033**. *(L1 OBSERVABLE via the customer.)*
6. Extraction worker state and failure reason — *(L2/ENGINEERING ONLY.)*

## Approved L1 actions

Explain the chain and that promotion is deliberate · confirm which step failed ·
direct the customer to record a determination or supply a severity · escalate
processing failures.

## Actions L1 must NOT perform

- **set a CUEC determination on the customer's behalf** — a gap asserts the
  organisation fails a control obligation. It carries the reviewer's name, it may
  be read by an auditor, and it is not support's determination to make.
- promote a gap for them, or choose the severity — severity sets the deadline
- re-run extraction
- edit extracted values to "correct" them
- suggest enabling the vendor portal

## Escalate when

Documents stick in `extracting`; extraction produces no CUECs on a document that
plainly contains them; promotion fails with anything other than the codes above; a
CUEC or document from another organisation is visible → **SR-009, SEV1**.

## Recovery

**None validated (SUP-PROC-1).** Reprocessing and extraction recovery are
Engineering.

## Recovery verification

The customer sees the expected finding on the vendor, with a severity and a due
date, reachable from the CUEC that produced it.

## Customer communication

> "Reviewing the document doesn't create the work on its own — that's deliberate.
> Once you've marked a requirement as a gap, there's a separate step to turn it into
> a finding, so you stay in control of what becomes remediation work. If the
> document is still processing, that's on our side and I'll check it."

For the portal question:

> "This release is document-driven — you upload the vendor's report and SecureLogic
> processes it. Vendors signing in to fill things in themselves isn't part of this
> release."

## Observability

| Signal | Where | Level |
|---|---|---|
| Document processing status | Document view | **L1** |
| CUEC statuses and reasons | Document view | **L1** |
| Promoted finding + provenance | Finding detail | **L1** |
| `vendor_assurance.cuec.*` audit events | Admin audit log | L2 |
| Extraction worker failures | Engine logs | L2 |

**Missing:** L1 cannot see why an extraction failed or whether it is still queued —
the most common escalation in this runbook (**SUP-OBS-23**).

## Related

SR-005, SR-033, SR-009 · `VENDOR-PORTAL-1` in `docs/backlog/SECURITY_BACKLOG.md` ·
migration `20261036`
