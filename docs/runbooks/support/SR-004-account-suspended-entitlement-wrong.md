# SR-004 — Access lost or entitlement wrong

| | |
|---|---|
| **Playbook ID** | SR-004 |
| **Domain** | Billing / Access |
| **Severity default** | **SEV2** — a paying customer blocked from all work |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Post-promotion for the dunning-related paths |
| **Feature flag** | Grace period `false` in prod and staging — no buffer exists |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

Login succeeds but features are gone or 403; "upgrade" prompts on paid features;
seats unavailable; a suspended-account message.

## Likely causes

1. **Payment failure** → SR-003. Most common.
2. **Seat model** — `SECURELOGIC_SEAT_MODEL_ENABLED` is **on in production**: the
   user may have no seat, or a contributor-level seat that legitimately denies the
   action.
3. Subscription cancelled or lapsed at the provider.
4. Tier genuinely does not include the feature.
5. Entitlement out of step with the provider → escalate.

## Safe diagnostic steps

1. **Which feature, and what exactly happens** — missing, greyed, or an error?
   *(L1 OBSERVABLE.)*
2. **One user or everyone in the org?** One user strongly suggests seats, not
   billing. *(L1 OBSERVABLE.)*
3. **Any billing banner?** → SR-003. *(L1 OBSERVABLE.)*
4. **Has an admin changed seat assignments?** The customer's own admin can check.
   *(L1 OBSERVABLE.)*
5. Actual entitlement level and provider state — *(L2 ONLY.)*

## Evidence to collect

Organization slug, affected user vs whole org, the feature, exact message,
timestamp, whether billing shows anything.

## Approved L1 actions

Distinguish seat problem from billing problem; route to SR-003 for billing; direct
the customer's **own admin** to seat assignment.

## Actions L1 must NOT perform

- change entitlement level, tier or seat assignment
- "temporarily restore" access
- advise a plan change as a workaround for a suspected defect

## Escalate when

Entitlement disagrees with what the customer is paying for; access is lost with no
billing failure; restoration has not followed a successful payment → **SR-041**.

## Recovery

**None validated (SUP-PROC-1).** Entitlement changes are Engineering.

## Recovery verification

The customer performs the blocked action successfully.

## Customer communication

> "Let me work out whether this is a billing issue or a seat assignment — they look
> the same from the outside but they're fixed in different places. Is it just you,
> or is everyone in your organization seeing it?"

## Observability

| Signal | Where | Level |
|---|---|---|
| Feature visible / 403 | Customer's screen | **L1** |
| Billing banner | Account page | **L1** |
| Entitlement level, seat assignment | — | **NOT OBSERVABLE to support** |

**Missing:** support cannot see entitlement or seat state, which are the two
answers this runbook needs (**SUP-OBS-13**, **SUP-OBS-14**).

## Related

SR-003, SR-041, SR-042
