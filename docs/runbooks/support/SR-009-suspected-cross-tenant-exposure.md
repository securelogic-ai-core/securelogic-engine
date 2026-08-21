# SR-009 — Suspected cross-tenant exposure

| | |
|---|---|
| **Playbook ID** | SR-009 |
| **Domain** | Security |
| **Severity default** | **SEV1 — always, without exception** |
| **Owning level** | Security. L1/L2 contain and escalate only. |
| **Last validated** | 2026-08-21 |
| **Status** | VALIDATED for escalation. Investigation is Security-owned and deliberately not written here. |

## Read this first

**One record is not a small incident.** Cross-tenant exposure is the failure that
ends enterprise security contracts, and its severity does not scale with the
number of rows. There is no "probably nothing" version of this runbook: if the
question has been asked, it is SEV1 until Security says otherwise.

**You are not the investigator.** Your job is to preserve what happened, stop it
continuing, and hand it over. Everything below is written to keep you from
accidentally destroying the evidence or widening the exposure while trying to
help.

## Customer-visible symptoms

- "I can see a vendor/finding/asset/document that isn't ours"
- "This report contains another company's name"
- a customer names an organization that is not theirs
- an export, Brief or search result containing unfamiliar records
- a screenshot showing data the customer should not have

Also treat as this runbook: **any internal observation** of a query, export or
page returning rows from more than one organization.

## Business impact

Confidentiality breach affecting at least two customers — the one who saw it and
the one whose data was seen. Likely contractual and regulatory notification
obligations. The second customer does not yet know.

## Immediate actions — in this order

1. **Do not ask the customer to send you the data.** Ask them to keep it and not
   share it further. A screenshot forwarded through a support inbox spreads the
   exposure into more systems.
2. **Record the facts you already have** — time with timezone, what page or
   export, which organization reported it, what they described. Do not paste the
   exposed content into a ticket.
3. **Escalate to Security immediately.** Do not wait to confirm it. Do not
   attempt to reproduce it.
4. **Tell the customer it is being escalated now** and that someone will come
   back to them. Do not characterise cause, scope or likelihood.
5. **Preserve your session.** Do not clear cookies, log out and back in, or retry
   the action — that can destroy the state that reproduces it.

## Actions support must NOT perform

- **Do not attempt to reproduce it** by logging into another organization, or by
  asking anyone to. Reproducing an isolation failure creates a second one.
- **Do not run any query** to "check how many records are affected."
- **Do not delete, edit or hide** the offending record, export or page. Removing
  it destroys the evidence and does not undo the disclosure.
- **Do not contact the other affected organization.** Notification is a legal and
  contractual decision, not a support one, and a premature call cannot be taken
  back.
- **Do not discuss it in a shared channel** that includes people outside the
  incident.
- **Do not tell the customer it was "a display issue"** or any other guess. If it
  turns out to be one, that is good news delivered later — not a holding line now.

## Escalate to

**The named security owner (the platform owner), immediately, by the fastest
channel available.**

SecureLogic has **no formal incident-response process** as of 2026-08-21: there
is no `SECURITY.md`, IR runbook or disclosure policy in the repository. This
runbook therefore stops at escalation by design and does not invent an IR
framework. Establishing one is an open launch gap
(see `SUPPORT-READINESS-GAPS.md`, gap **SUP-SEC-1**).

## What Security will need from you

- when it was reported and when it was observed (with timezone)
- the reporting organization's slug
- the exact surface: page, export, Brief, API endpoint
- what the customer was doing immediately before
- whether the customer has shared it further, and with whom
- whether anyone attempted to reproduce it (say so plainly if they did)

## Customer communication

**Holding line, verbatim-safe:**

> "Thank you for telling us — that's exactly the right thing to do. I've escalated
> this to our security team as a priority. Please don't share what you saw with
> anyone else, and don't delete it. Someone will come back to you directly."

Then stop. Do not add reassurance you cannot support, do not estimate a cause, and
do not promise a timeline. Every further sentence is a commitment made under
uncertainty.

## Observability

| Signal | Where | Who can see it |
|---|---|---|
| Request ID, org context per request | Engine logs | L2 / Security |
| Audit trail of reads | `security_audit_log` | Security |
| RLS policy state | Database | Engineering |

**Missing observability:** there is no alert for a response containing more than
one `organization_id` — cross-tenant exposure is currently detected by **a
customer noticing**. That is the single highest-value security detection gap
(**SUP-OBS-4**).

## Related

- `SUPPORT-AUTHORITY-MODEL.md` — Security level
- SR-010 (suspected account compromise)
- Tenant isolation is enforced by Postgres RLS with `USING` + `WITH CHECK` on
  `app.current_org_id`; isolation suites live in `test/isolation/`
