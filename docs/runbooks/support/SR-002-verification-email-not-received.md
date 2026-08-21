# SR-002 — Verification email not received

| | |
|---|---|
| **Playbook ID** | SR-002 | 
| **Domain** | Authentication / Email |
| **Severity default** | SEV2 (blocks first login entirely) |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Live in production today |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **Resend is UNVALIDATED — SUP-PROC-1.** |

## Customer-visible symptoms

"I never got the verification email." Login shows `email_not_verified`.

## Impact

Total block — the user cannot log in at all. On a new organization this blocks the
whole onboarding.

## Likely causes

1. Delivered but filtered — spam/quarantine. Most common.
2. **Provider suppression.** A previous bounce or complaint can suppress an
   address at the provider, and **subsequent sends silently do not arrive**. This
   is a known, recurring failure mode and is invisible to the customer.
3. Typo in the address at signup.
4. Link expired — verification tokens last **24 hours**.
5. Email infrastructure degraded → **SR-008**.

## Safe diagnostic steps

1. **Confirm the exact address**, character by character. *(L1 OBSERVABLE.)*
2. **Spam/quarantine check**, including org-level filtering. *(L1 OBSERVABLE.)*
3. **When was it requested?** Past 24 hours means the link is expired even if it
   arrived. *(L1 OBSERVABLE.)*
4. **Has this address ever bounced or been marked spam?** *(L2 ONLY — support has
   no per-recipient delivery or suppression view.)*
5. Whether the send was attempted at all. *(L2 ONLY.)*

## Evidence to collect

Exact address, signup time with timezone, organization slug, whether other users
in the org received theirs, any bounce message the customer's mail admin can see.

## Approved L1 actions

Ask the customer to re-request verification from the login screen (self-service).
Advise allow-listing the sending domain.

## Actions L1 must NOT perform

- **verify the address manually** to unblock them — that defeats the control
  entirely and is exactly what an attacker would want
- change the email address on the account
- remove a provider suppression

## Escalate when

Re-request produces nothing twice; multiple users in one org affected; suppression
suspected — all **L2**.

## Recovery

Self-service re-request. **Clearing a provider suppression is UNVALIDATED and
Engineering-only** — the deletion path is gated and has not been proven safe from
support.

## Recovery verification

The customer receives the email and completes verification. Confirm with them.

## Customer communication

> "Let me check a couple of things. First, can you confirm the exact address? Then
> check spam and anything your mail team quarantines. The link also expires after 24
> hours, so if it's older than that I'll get you a fresh one."

## Observability

| Signal | Where | Level |
|---|---|---|
| Whether the user is verified | — | **NOT OBSERVABLE to L1** |
| Send attempt / delivery / bounce | `email_provider_events` | L2 |
| Suppression state for an address | Provider | **NOT OBSERVABLE to support** |

**Missing:** "did my email send?" is unanswerable by support without Engineering
(**SUP-OBS-3**), and L1 cannot see verification state (**SUP-OBS-1**). Between
them these make the most common onboarding failure an escalation every time.

## Related

SR-001, SR-007, SR-008 · `src/api/routes/customerAuth.ts` (`VERIFICATION_TTL_MS` = 24h)
