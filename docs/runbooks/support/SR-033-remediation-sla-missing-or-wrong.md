# SR-033 — Remediation SLA missing or wrong

| | |
|---|---|
| **Playbook ID** | SR-033 |
| **Domain** | Findings / Remediation |
| **Severity default** | SEV3 (SEV2 if an audit deadline depends on it) |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | The admin SLA configuration UI requires the `develop` → `main` promotion. Unflagged. |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

A finding has no due date; the due date is not what the policy says; changing the
policy did not change existing findings.

## The three rules that explain almost every report

1. **The SLA applies at creation only.** A due date is set when the finding is
   created. **Changing the policy does not retro-apply** to findings that already
   exist — this is the most common report and it is correct behaviour.
2. **An explicit due date always wins.** If the finding was created with one, the
   policy never overrides it.
3. **No canonical severity means no SLA** — deliberately. → **SR-022**.

## Likely causes

1. Policy changed after the findings were created (rule 1).
2. The finding has no canonical severity (rule 3, → SR-022).
3. An explicit due date was supplied on import (rule 2).
4. No SLA policy configured for that severity — an unset severity yields no date.
5. Policy saved without the review cadence, blanking part of the settings —
   escalate.

## Safe diagnostic steps

1. **Does the finding have a canonical severity?** No → SR-022, and stop.
   *(L1 OBSERVABLE.)*
2. **When was the finding created, and when was the policy last changed?** Created
   first explains it. *(L1 OBSERVABLE.)*
3. **Check the configured policy** — Settings → Risk policy shows days per
   severity. *(L1 OBSERVABLE to the customer; support sees it only if the customer
   reads it out.)*
4. **Was a due date supplied on import?** *(L1 OBSERVABLE from the import file.)*
5. Recomputing what the date should have been — *(L2 ONLY.)*

## Approved L1 actions

Explain the three rules. Confirm the configured policy with the customer. Where a
specific finding needs a different date, the customer can set it themselves.

## Actions L1 must NOT perform

- change a due date to match customer expectation
- change the org's SLA policy
- set a severity to force an SLA → see SR-022

## Escalate when

A finding created **after** a policy change has the wrong date; the policy shows
values nobody set; the review cadence has been blanked.

## Recovery

**None validated (SUP-PROC-1).** Customer-side: set a due date on the finding, or
correct the policy for future findings.

## Customer communication

> "SLA deadlines are applied when a finding is created, so changing the policy
> today won't move dates on findings you already have — it applies from here on.
> For the existing ones you can set a due date directly on the finding."

## Observability

| Signal | Where | Level |
|---|---|---|
| Finding severity and due date | Finding detail | **L1** |
| Configured SLA policy | Settings → Risk policy | Customer / **L1 via customer** |
| `risk_settings.updated` audit with before/after | `security_audit_log` | L2 |

**Missing:** support cannot read an organization's SLA policy directly and depends
on the customer reading it out (**SUP-OBS-15**).

## Related

SR-022, SR-020 · `src/api/lib/findingSlaPolicyRules.ts` · `PUT /api/orgs/me/risk-settings`
