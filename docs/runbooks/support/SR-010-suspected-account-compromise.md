# SR-010 — Suspected account compromise / suspicious authentication activity

| | |
|---|---|
| **Playbook ID** | SR-010 |
| **Domain** | Security |
| **Severity default** | **SEV1** |
| **Owning level** | Security. L1/L2 contain and escalate only. |
| **Release dependency** | Live in production today |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | VALIDATED for escalation. Investigation is Security-owned. |

## Read this first

Treat as compromise until Security says otherwise. **Speed matters more than
certainty here** — an account escalated and cleared costs an hour; one escalated
late costs whatever the attacker did in between.

## Customer-visible symptoms

- "Someone else is in my account" / activity the user did not perform
- Repeated lockouts the user is not causing (credential stuffing signal)
- Login notifications from unexpected locations
- Records changed, exported or deleted by an unrecognised user
- A user reports their SecureLogic password was reused elsewhere in a breach

## Immediate actions — in this order

1. **Tell the customer to change their password now**, from a device they trust,
   and to enable MFA if it is not on. They do it; support never handles it.
2. **Escalate to Security immediately.** Do not confirm first.
3. **Record what you already know** — times with timezone, what looked wrong, which
   user, which organization.
4. **Do not log in as the user** and do not ask for their credentials or a session
   cookie to "check".
5. **Preserve evidence.** Do not advise deleting suspicious records — they are the
   evidence of what happened.

## Actions support must NOT perform

- ask for a password, token, cookie or API key — **ever**. If a customer volunteers
  one, it is now exposed: it must be rotated, and that is itself an incident.
- reset the password on the customer's behalf
- clear lockouts or failed-attempt counters — that destroys the record of the
  attack
- tell the customer it is "probably nothing"
- investigate beyond collecting what the customer reports

## Escalate to

**The named security owner (the platform owner), immediately.**

There is **no formal incident-response process** in this repository — no
`SECURITY.md`, no IR runbook, no disclosure policy. This runbook therefore stops at
escalation by design and does not invent one. See **SUP-SEC-1**.

## What Security will need

Organization slug, affected user, times with timezone, what specifically looked
wrong, whether the customer has changed the password yet, whether MFA is enabled,
whether other users are affected, whether anything was exported or deleted.

## Recovery

**Engineering/Security only.** Password change and MFA enrolment are customer
actions. Session invalidation, key rotation and forensic review are not support
actions and are **UNVALIDATED** from support.

## Customer communication

> "Thanks for flagging that quickly. Please change your password now from a device
> you trust, and turn on multi-factor authentication if it isn't already. I've
> escalated this to our security team as a priority. Don't delete anything that
> looks wrong — we may need it to understand what happened."

Do not speculate about how access was gained. Do not confirm or deny that anything
was accessed until Security has determined it.

## Observability

| Signal | Where | Level |
|---|---|---|
| `auth.account_locked` events | Admin audit log | L2 |
| Auth attempt logs | Engine logs | L2 |
| Session/lockout state for a user | — | **NOT OBSERVABLE to L1** |
| Login geography / device history | — | **NOT CAPTURED** |

**Missing:** there is no login-history or active-session view for a customer or for
support, so "where has my account been signed in from?" cannot be answered at all
(**SUP-OBS-16**). Detectors group by request IP, which is a rotating edge address,
so per-user anomaly detection is not reliable today.

## Related

SR-001, SR-009, SR-013 · `SUPPORT-AUTHORITY-MODEL.md`
