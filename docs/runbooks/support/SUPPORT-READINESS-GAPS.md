# Support readiness gaps

What support cannot currently see or do. **This is a backlog, not a build plan** —
nothing here was implemented as part of establishing these runbooks.

Ordered by how often it forces "ask an engineer to look in the database", which is
the procedure this whole directory exists to eliminate.

## Observability gaps

### SUP-OBS-1 — L1 has no read-only view of a user's auth state *(highest value)*

Support cannot see whether a user is verified, locked, active or deactivated.
Every one of those questions — the four most common in SR-001 — currently needs
L2 or an engineer. This single gap converts the most frequent support case into an
escalation.

**Needed:** a staff-only read-only lookup returning verification status, lock
state until, active/inactive, and last successful login. No PII beyond what
support already legitimately holds. Read-only, audited.

### SUP-OBS-2 — No support-facing surface at all

Every `/admin/*` route requires a staff key and returns **404** without one — by
design, and correctly so. The consequence is that L1 has no operational surface
whatsoever: not health beyond `/health`, not delivery status, not billing state.

**Needed:** a decision on whether L1 gets a scoped read-only console, or whether
L1 remains a pure intake tier that always escalates diagnosis to L2. **Either is
defensible; the current situation is neither, because runbooks are being written
against tools that do not exist for the level expected to use them.**

### SUP-OBS-3 — Email delivery is not answerable per customer

"Did my verification email send?" cannot be answered without engineering.
`email_provider_events` and delivery metrics exist, but there is no per-recipient
lookup, and Resend suppression — a known, recurring failure mode — is invisible to
support.

**Needed:** a per-recipient delivery/suppression lookup. Blocks SR-002 and SR-007
from being genuinely self-sufficient.

### SUP-OBS-4 — Cross-tenant exposure is detected by a customer noticing *(highest severity)*

There is no alert for a response or export containing more than one
`organization_id`. RLS is enforced at the database and isolation suites are
extensive, but **detection of a failure that gets past them is entirely
reactive**.

**Needed:** a response-level assertion or sampled audit that flags multi-org
result sets. Low frequency, catastrophic impact.

### SUP-OBS-5 — Request IDs are not customer-visible

Engine logs carry `requestId`, but a customer seeing an error has no reference to
quote, so support cannot correlate a report to a log line without a timestamp
hunt.

**Needed:** surface a correlation id on customer-facing error states.

## Process gaps

### SUP-SEC-1 — No incident-response process exists *(launch blocker for security)*

There is no `SECURITY.md`, no IR runbook, no vulnerability-disclosure policy and
no defined severity/notification path in the repository. SR-009 and SR-010
therefore escalate to a **named human** and stop, because inventing a parallel IR
framework inside support documentation would be worse than admitting the gap.

**Needed:** a real IR process — as a separate authorized package, with the
notification obligations reviewed by someone qualified to rule on them. This is
the most significant non-technical launch gap identified.

### SUP-PROC-1 — No validated recovery procedures

Every recovery path currently written is either self-service or escalation.
**No support-executable recovery procedure has been proven safe**, so none is
documented as validated. That is honest but thin: it means today, in practice,
recovery *is* engineering.

**Needed:** identify the two or three highest-frequency recoveries (likely: resend
verification, re-drive a failed webhook, restart a worker), prove them safe in
staging, and promote them from UNVALIDATED.

### SUP-PROC-2 — Stale operator documentation

`docs/launch/OPERATOR_RUNBOOK.md` (last changed 2026-07-21) predates the entire
SL-BILL-1 dunning package and describes billing flows that have since changed. It
is the most dangerous document in the repository for support purposes, because it
is confidently wrong rather than absent.

**Needed:** re-validate against `develop` or mark it superseded.

## Sept 1 security validation intake

Operational findings from the planned OWASP ZAP / Burp Suite work should land
**here and in the affected runbook**, not in test notes:

- a new customer-visible failure mode → new or updated `SR-*`
- a new escalation trigger → SR-009 / SR-010 and the authority model
- a detection gap → a `SUP-OBS-*` entry above
- an IR process finding → SUP-SEC-1

The structure is deliberately ready for that input now, so nothing discovered on
Sept 1 has to wait for somewhere to put it.
