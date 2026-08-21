# SR-001 — Customer cannot log in

| | |
|---|---|
| **Playbook ID** | SR-001 |
| **Domain** | Authentication |
| **Severity default** | SEV2 (a paying user blocked from all work) |
| **Owning level** | L1 diagnose → L2 → Engineering |
| **Last validated** | 2026-08-21 against `develop@bf4e5b43` — auth is unchanged on `main` |
| **Status** | VALIDATED for diagnosis. Recovery steps marked individually. |

## Customer-visible symptoms

"I can't log in." Then one of these on screen:

| What they see | Error code | What it actually means |
|---|---|---|
| Wrong email or password | `invalid_credentials` / `incorrect_password` | Credentials do not match. Also returned when the email is unknown — deliberately, so the page cannot be used to discover who has an account. |
| Please verify your email | `email_not_verified` | Account exists, verification never completed → **SR-002** |
| Account temporarily locked | `account_locked` (HTTP 429) | 5 failed attempts. Auto-unlocks after 15 minutes. |
| Too many requests | `rate_limit_exceeded` / `too_many_requests` (429) | IP/route rate limit, not account lockout. Different fix. |
| Account is inactive | `account_inactive` | User deactivated by an org admin. |
| — (login succeeds, then bounces) | — | Session/entitlement issue, not authentication → **SR-004** |

## Business impact

Total block for that user. If it affects every user in one organization, treat as
SEV1 and go to **SR-008** — that is an availability event, not a login problem.

## Likely causes

1. Wrong password (most common by a wide margin)
2. Email never verified
3. Lockout after repeated attempts
4. Deactivated by their own admin
5. SSO misconfiguration where the org uses SSO
6. Platform-wide auth failure (rare — check SR-008 first if more than one org)

## Safe diagnostic steps

1. **Ask which message they see, exactly.** The table above turns it into a
   diagnosis in one step. A screenshot is better than a paraphrase.
2. **Ask when it last worked** and what changed — new device, password manager
   update, admin change, SSO rollout.
3. **Confirm scope.** One user, or everyone in the org? More than one org means
   escalate to SR-008 immediately.
4. **Check platform health** — `GET /health` on the engine returns
   `{"status":"ok","db":"connected"}`. Anything else is SR-008.
5. **Have the customer confirm the email address they are typing**, including
   domain. Typo'd domains present as `invalid_credentials`.

All five are safe against production and have no side effects.

## Evidence to collect

- exact error text or code, and the HTTP status if visible
- timestamp **with timezone** and what they were doing
- organization slug (not the display name)
- browser and whether an SSO redirect was involved
- whether other users in the same org can log in

**Never** ask for or accept a password, a session cookie, an API key or a reset
link. If a customer volunteers one, treat it as exposed: it must be rotated, and
that is a security escalation.

## Approved support actions

**L1 may:**
- direct the customer to the self-service password reset (they receive the link;
  support never sees it)
- direct them to re-request verification email → **SR-002**
- advise waiting out a 15-minute lockout
- ask their org admin to reactivate a deactivated user (the admin does it, not us)

**L2 may:** everything above, plus read auth logs and the admin audit log to
confirm whether attempts are arriving at all.

## Actions support must NOT perform

- set, reset or "temporarily change" a password on the customer's behalf
- clear `lockout_until` or `failed_login_attempts` in the database — the lock
  expires on its own in 15 minutes, and clearing it destroys the evidence of what
  triggered it
- verify an email address manually to "unblock" someone — that defeats the control
  entirely and is indistinguishable from an attacker's goal
- log in as the customer

## Escalate when

- more than one organization is affected → **SR-008**, SEV1
- the customer is certain the password is right, is not locked, is verified, and
  still cannot log in
- lockouts are recurring for a user who is not making the attempts → **security
  escalation**, SEV1, because that is a credential-stuffing signal, not a support
  problem
- SSO is involved and the failure is at the identity-provider redirect

## Escalate to

- **L2 / Platform Operations** for anything platform-wide
- **Security (the named security owner)** for unexplained repeated lockouts,
  logins from unexpected locations, or any suggestion the account is not under the
  customer's control. See `SUPPORT-AUTHORITY-MODEL.md`.

## Recovery / rollback

Lockout: **no action required** — 15 minutes, automatic.
Everything else: self-service reset, or escalation. There is deliberately no
support-side unlock procedure.

## How to verify recovery

The customer logs in successfully and reaches their dashboard. Confirm with them
directly; do not infer it from logs.

## Customer communication

While diagnosing: *"I can see the error you're getting. Let me confirm a couple of
things so we fix the right problem."*

For a lockout: *"Your account locked itself after several failed sign-in attempts.
That's a security protection and it clears automatically after 15 minutes. If you
didn't make those attempts, tell me — I'll get it looked at straight away."*

Never speculate about cause, and never confirm or deny whether an email address
has an account.

## Observability

| Signal | Where | Who can see it |
|---|---|---|
| Auth failure events | Engine logs | L2 |
| `auth.account_locked` audit event | Admin audit log | L2 |
| Lockout alert | Operator alert channel at lock time | L2 |
| Engine health | `GET /health` | L1 |

**Missing observability:** L1 has **no read-only view of a user's auth state** —
whether they are verified, locked, or active. Every one of those questions
currently requires L2 or an engineer. This is the top item in the support
observability backlog (SUP-OBS-1).

## Related

- SR-002 (email verification), SR-004 (suspended account), SR-008 (availability)
- `src/api/routes/customerAuth.ts` — `MAX_FAILED_ATTEMPTS = 5`,
  `LOCKOUT_DURATION_MINUTES = 15`, `ATTEMPT_RESET_HOURS = 24`
