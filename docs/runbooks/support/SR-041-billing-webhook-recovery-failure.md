# SR-041 — Payment succeeded but access did not return

| | |
|---|---|
| **Playbook ID** | SR-041 |
| **Domain** | Billing |
| **Severity default** | **SEV2** — the customer has paid and is still blocked |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | **Requires the `develop` → `main` promotion** (event-ordering watermark, recovery convergence). |
| **Feature flag** | None. Grace remains `false`. |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Read this first

**The customer has paid.** Whatever the technical cause, they are entitled to
access and are not getting it. This is SEV2 from the moment it is confirmed, and it
is the billing failure most damaging to trust.

## Customer-visible symptoms

Payment confirmed by the bank or the provider, but the banner persists, features
stay locked, or the tier is wrong.

## Likely causes

1. **Provider event not received or not yet processed.** Platform state converges
   from provider events; if one does not arrive, state does not move.
2. **Events arrived out of order.** Guarded by an ordering watermark
   post-promotion, so a stale event cannot overwrite a newer state — but that also
   means a genuinely out-of-order event is ignored by design.
3. Payment succeeded against a **different subscription or customer record**.
4. Entitlement changed but the customer's session is stale — a re-login resolves
   it.
5. Platform issue → **SR-008**.

## Safe diagnostic steps

1. **Confirm the payment actually succeeded** — the customer's bank or provider
   receipt, not their expectation. *(L1 OBSERVABLE via the customer.)*
2. **How long ago?** Convergence is not instant; a few minutes is normal.
   *(L1 OBSERVABLE.)*
3. **Ask them to sign out and back in** — this genuinely resolves the stale-session
   case and is safe. *(L1 OBSERVABLE, and the only approved action here.)*
4. **Still blocked after a re-login and a reasonable wait → escalate.**
5. Webhook receipt, event ordering, subscription state — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Organization slug, time of successful payment with timezone, provider receipt
reference **if the customer volunteers it**, what is still blocked, whether they
have re-logged in. **Never card details.**

## Approved L1 actions

Confirm payment; advise sign-out/sign-in; escalate. That is the whole list.

## Actions L1 must NOT perform

- **restore entitlement manually** — the single most tempting action in this
  runbook. It puts platform state out of step with the provider, and the next
  provider event will overwrite it, so the customer gets locked out again with no
  record of why
- re-drive or replay a webhook (L2, and only per a validated procedure — none
  exists today)
- issue a credit or extension

## Escalate when

Payment is confirmed and access has not returned after a re-login and a reasonable
wait. Do not sit on this one.

## Recovery

**None validated (SUP-PROC-1).** Webhook replay and entitlement correction are
Engineering.

## Recovery verification

The customer performs a previously blocked action successfully **and** the banner
clears.

## Customer communication

> "Thanks — I can see you've paid, and I'm treating this as a priority. Could you
> sign out and back in once? That clears it in some cases. If it doesn't, I'm
> escalating straight away rather than leaving you locked out."

Never imply the customer has not paid.

## Observability

| Signal | Where | Level |
|---|---|---|
| Banner / access state | Customer's screen | **L1** |
| Webhook receipt and processing | Engine logs | L2 |
| Dunning metrics (aggregate) | `/admin/billing/dunning-metrics` | L2 (staff key) |
| Per-org billing/entitlement state | — | **NOT OBSERVABLE to L1** |

**Missing:** support cannot confirm whether a provider event was received for an
organization — the central question of this runbook (**SUP-OBS-20**).

## Related

SR-003, SR-004, SR-042 · `src/api/webhooks/stripeWebhook.ts`
