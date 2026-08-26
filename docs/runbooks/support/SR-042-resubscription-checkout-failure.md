# SR-042 — Cannot resubscribe or complete Checkout

| | |
|---|---|
| **Playbook ID** | SR-042 |
| **Domain** | Billing |
| **Severity default** | SEV2 — a customer trying to pay us and unable to |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | **Requires the `develop` → `main` promotion** (the suspended → Checkout → restored path). |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## Customer-visible symptoms

The resubscribe or upgrade button does nothing; Checkout will not open; Checkout
completes but nothing changes → **SR-041**.

## What the error codes mean

| Code | Meaning |
|---|---|
| `billing_not_configured` | Billing not configured for this environment — **escalate**, the customer cannot fix it |
| `checkout_url_missing` | Checkout session created without a URL — escalate |
| `billing_checkout_failed` | Session creation failed — escalate |
| `billing_portal_failed` | Portal session failed — escalate |
| `invalid_tier` | Requested plan not recognised — escalate |
| `api_key_identity_missing` | Action attempted without user identity — the customer should sign in properly rather than use an integration path |

Most codes here are platform-side. Unlike SR-003, there is little the customer can
self-correct.

## Safe diagnostic steps

1. **Exact error, or does nothing happen at all?** *(L1 OBSERVABLE.)*
2. **Does Checkout open and fail, or never open?** Splits provider-side from
   platform-side. *(L1 OBSERVABLE.)*
3. **Blocker in the browser?** Payment frames are commonly blocked by extensions —
   ask them to try a clean window. *(L1 OBSERVABLE, and the one genuine
   self-service fix.)*
4. **Which plan are they choosing?** *(L1 OBSERVABLE.)*
5. Provider configuration and price mapping — *(L2/ENGINEERING ONLY.)*

## Evidence to collect

Organization slug, plan selected, exact error, whether Checkout opened, browser and
extensions, timestamp.

## Approved L1 actions

Clean-browser retry. Confirm the intended plan. Escalate.

## Actions L1 must NOT perform

- take payment by any other route
- change the organization's tier or entitlement to "get them working"
- send a payment link generated outside the product — a link from a support agent
  is indistinguishable from a phishing attempt, and teaches customers to trust one

## Escalate when

Any of the platform-side codes above; Checkout completes without effect →
**SR-041**.

## Recovery

**None validated (SUP-PROC-1).**

## Recovery verification

The customer completes Checkout and their access reflects the new plan. Confirm
both.

## Customer communication

> "Let's try one thing first — open your account page in a private window with
> extensions off, since payment windows get blocked more often than you'd expect. If
> it still won't open, that's on our side and I'll escalate it now."

## Observability

| Signal | Where | Level |
|---|---|---|
| Error / button behaviour | Customer's screen | **L1** |
| Checkout session creation errors | Engine logs | L2 |
| Provider price/plan configuration | Stripe | L2 |

**Missing:** support cannot verify that the environment's plan configuration is
correct — a known past defect was transposed price IDs, which produced exactly this
symptom and was invisible from support (**SUP-OBS-21**).

## Related

SR-003, SR-004, SR-041
