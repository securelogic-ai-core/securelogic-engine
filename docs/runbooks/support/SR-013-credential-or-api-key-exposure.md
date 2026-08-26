# SR-013 — Credential or API key exposure

| | |
|---|---|
| **Playbook ID** | SR-013 |
| **Domain** | Security |
| **Severity default** | **SEV1** |
| **Owning level** | Security. L1/L2 contain and escalate only. |
| **Release dependency** | Live in production today |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 |
| **Status** | VALIDATED for escalation. Rotation is Engineering/Security. |

## Triggers

- A customer pastes an API key, password, token or session cookie into a ticket,
  chat or email — **including to us**
- A customer reports their key was committed to a repository, log, or shared doc
- A key appears in a screenshot or exported file
- A third party reports finding a SecureLogic credential

**A credential shared with support is exposed.** It does not matter that we are
trustworthy: it is now in a ticketing system, a mailbox, and probably a backup.
Treat it exactly as if it were public.

## Immediate actions

1. **Do not repeat the credential.** Do not quote it back, do not paste it into
   another system, do not put it in the escalation text. Reference *where* it
   appeared, not *what* it is.
2. **Escalate to Security immediately** — rotation is time-critical.
3. **Tell the customer it must be rotated**, and that anything using it will need
   updating.
4. **Do not delete the message containing it** — Security needs to know the scope.
   Flag it instead.

## Actions support must NOT perform

- rotate or revoke the key yourself
- forward the message containing the credential to anyone outside the escalation
- reassure the customer that "it's fine, we'll just delete it" — deletion does not
  un-expose it
- continue the conversation using the exposed credential to help diagnose something

## Escalate to

**The named Security Owner, immediately.** The process behind that escalation is
`docs/security/INCIDENT-RESPONSE.md` — §8 covers rotation authority, including the
constraint that `FIELD_ENCRYPTION_KEY` and `MFA_SECRET_KEY` **cannot be rotated ad
hoc** without a migration plan (`DR_PLAN.md` §4d).

## What Security will need

Where it appeared, when, which organization, what kind of credential, who has seen
it, whether it is still in use, whether the customer has already rotated it.

## Recovery

**UNVALIDATED from support.** Key rotation and revocation are Engineering/Security
actions with customer coordination — a rotated key breaks live integrations, so it
is not a step to take unilaterally from a support ticket.

## Customer communication

> "I need to flag that as a security matter — anything shared through support has
> to be treated as exposed, even with us. I've escalated it, and that credential
> will need rotating. Please don't send credentials through support in future; we'll
> never ask for them."

## Observability

| Signal | Where | Level |
|---|---|---|
| API key existence / last use | `/admin/api-keys` | L2 (staff key) |
| Where a key has been used | — | **NOT OBSERVABLE** |

**Missing:** there is no per-key usage history, so blast radius after an exposure
cannot be assessed from the product (**SUP-OBS-17**).

## Related

SR-009, SR-010 · `SUPPORT-AUTHORITY-MODEL.md`
