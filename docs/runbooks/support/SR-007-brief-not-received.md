# SR-007 — Intelligence Brief not received

| | |
|---|---|
| **Playbook ID** | SR-007 |
| **Domain** | Email / Intelligence |
| **Severity default** | SEV3 (SEV2 for a Brief-subscription customer — it is the deliverable) |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Live in production today |
| **Feature flag** | None for delivery |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

"I didn't get this week's Brief." Possibly: others in the org did.

## Impact

For a Brief subscriber this is the product not arriving. Treat accordingly.

## Likely causes

1. Delivered but filtered — spam/quarantine. Most common.
2. **Provider suppression** from an earlier bounce or complaint — silently stops
   delivery to that address.
3. Not subscribed, or unsubscribed (possibly accidentally).
4. **No Brief was generated for that edition** — a platform-side issue, not a
   delivery one. Different problem, different escalation.
5. Generation ran but produced nothing publishable → **SR-012**.

## Safe diagnostic steps

1. **Did anyone else in the organization receive it?** This splits delivery from
   generation in one question — the most valuable step here.
   *(L1 OBSERVABLE.)*
2. **Spam/quarantine and exact address.** *(L1 OBSERVABLE.)*
3. **Is the Brief visible in-app?** If it is there but not emailed, it is a
   delivery problem; if it is absent, it is generation. *(L1 OBSERVABLE.)*
4. Per-recipient delivery/suppression state — *(L2 ONLY.)*
5. Scheduler run outcome for that edition — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Organization slug, recipient address, which edition/week, whether others received
it, whether it is visible in-app, timestamp.

## Approved L1 actions

Confirm subscription status with the customer; advise allow-listing; direct them to
read it in-app while delivery is investigated.

## Actions L1 must NOT perform

- resend the Brief — **UNVALIDATED**, and resend paths are staff-gated
- subscribe or unsubscribe an address on the customer's behalf
- trigger a Brief generation. **Never trigger generation runs**: the scheduler's
  idempotency and edition state are load-bearing, and a manual trigger can disturb
  evidence the team may be relying on.

## Escalate when

Nobody in the org received it; it is missing in-app as well as by email;
suppression suspected.

## Recovery

**None validated (SUP-PROC-1).** Resend and regeneration are Engineering.

## Recovery verification

The customer receives the next Brief, or confirms they can read the current one
in-app.

## Customer communication

> "Let me narrow it down — did anyone else at your organization get it? That tells
> me straight away whether it's a delivery problem to your address or something on
> our side. In the meantime you can read it in the app."

## Observability

| Signal | Where | Level |
|---|---|---|
| Brief present in-app | Customer's account | **L1** |
| Delivery / bounce / suppression per recipient | `email_provider_events` | L2 |
| Brief generation / scheduler outcome | Engine logs | L2 |
| `brief_staleness_detected` alert | Operator alerts | L2 |

**Missing:** per-recipient delivery lookup (**SUP-OBS-3**). L1 cannot tell delivery
from generation without the "did anyone else get it" question.

## Related

SR-002, SR-012, SR-008
