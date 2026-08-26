# SR-003 — Payment failed / card declined

| | |
|---|---|
| **Playbook ID** | SR-003 |
| **Domain** | Billing |
| **Severity default** | SEV3 while access continues; **SEV2 once access is lost** |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Dunning emails and telemetry require the `develop` → `main` promotion. |
| **Feature flag** | **Grace period is `SECURELOGIC_BILLING_GRACE_ENABLED` — `false` in production AND staging.** With it off, `past_due` revokes entitlement on the **first** failed charge. Do not describe a grace period to customers. |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

A payment-failed banner on the account page; email about a failed payment (post-
promotion); or loss of access → **SR-004**.

## Impact

Money and access. With grace off, entitlement is revoked on the first failed
charge, so the customer can go from working to locked out with no buffer.

## Likely causes

Expired or declined card; insufficient funds; bank fraud block; billing address
mismatch; subscription cancelled at the provider.

## Safe diagnostic steps

1. **What does the account page show?** *(L1 OBSERVABLE.)*
2. **Has the customer had a decline notice from their bank?** *(L1 OBSERVABLE.)*
3. **Direct them to update payment details** through the billing portal — the
   customer does this themselves. *(L1 OBSERVABLE.)*
4. Provider-side subscription and invoice state — *(L2 ONLY.)*
5. Whether webhooks are being received — *(L2 ONLY → SR-041.)*

## Evidence to collect

Organization slug, what the banner says, when the customer last updated their card,
their bank's message if any, timestamp. **Never card numbers, never any part of
them, never a Stripe customer id from the customer.**

## Approved L1 actions

Direct to self-service payment update. Explain what happens next. Nothing else.

## Actions L1 must NOT perform

- change entitlement, tier or subscription state to restore access
- apply a credit, extension or manual grace
- take payment details by any channel — **never**, under any circumstance
- retry the charge

## Escalate when

The customer has updated a good card and access has not returned within a
reasonable window → **SR-041** (webhook/recovery). Entitlement does not match what
the provider shows → **L2, SEV2**.

## Recovery

**None validated (SUP-PROC-1).** Recovery is the customer paying successfully; the
platform converges from the provider event. Manual entitlement changes are
Engineering.

## Recovery verification

The customer confirms access is restored **and** the banner is gone. Not one or the
other.

## Customer communication

> "Your last payment didn't go through — usually an expired card or a bank block.
> You can update your payment details from your account page, and access follows
> automatically once it clears. I can't take card details over support, and we'd
> never ask for them."

## Observability

| Signal | Where | Level |
|---|---|---|
| Banner / billing state | Account page | **L1** |
| Dunning metrics (aggregate) | `/admin/billing/dunning-metrics` | L2 (staff key) |
| Provider subscription state | Stripe | L2 |
| Per-org billing state | — | **NOT OBSERVABLE to L1** |

**Missing:** L1 cannot see an organization's billing or entitlement state at all,
so "am I actually past due?" is an escalation (**SUP-OBS-13**).

## Related

SR-004, SR-041, SR-042 · `src/api/webhooks/stripeWebhook.ts`
