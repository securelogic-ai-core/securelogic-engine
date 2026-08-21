# Support authority model

**Status:** ratified 2026-08-21. Applies to every runbook in this directory.

## The default principle

> **Support does not manipulate production database state to solve customer
> problems.**

Not "should avoid" — does not. A database write made to unblock one customer is
invisible to every other system that believed the old value: audit trails,
derived statuses, entitlement checks, exports and the customer's own evidence
record. It also cannot be reviewed, because nothing captured why it happened.

Any exception must be a **named, documented procedure inside a runbook**, with a
recorded reason and an approver. "An engineer ran a query" is not a procedure.

## Levels

### L1 — Customer Support

> **RULED 2026-08-21: for Sept 15, L1 is an INTAKE AND TRIAGE tier, not an
> operational administration tier.** `/admin/*` routes and staff keys are NOT
> exposed to L1, and no support console is being built before launch. A rushed
> console would be a privileged read surface over every tenant's data shipped
> under launch pressure — the wrong thing to hurry.
>
> The consequence is deliberate and should be planned for: **L1 diagnoses from
> what the customer can see, and escalates.** Runbooks are written to that
> boundary. Where a diagnostic needs more, it is an escalation step, not an L1
> step.
>
> A scoped, read-only **Support Operations Console** is tracked as a POST-LAUNCH
> package, and must be built to least privilege, explicit tenant scoping and full
> audit logging — see `SUPPORT-READINESS-GAPS.md` (SUP-OBS-2).

**May:**
- read customer-facing surfaces and reproduce what the customer sees
- collect evidence: request IDs, timestamps, error codes, organization slug
- guide the customer through self-service (retry, re-verify email, update payment
  method, re-upload a document)
- trigger **explicitly authorized** safe re-sends where a runbook names them
- classify severity and escalate

**May NOT:**
- access the database, directly or through any tool that reaches it
- change entitlement, billing state, subscription tier or seat allocation
- modify, close or reopen findings, risks, exceptions or evidence
- read another tenant's data to "compare"
- ask a customer for a password, token, session cookie or API key — **ever**, for
  any reason. Anyone who does is to be treated as a security incident, not a
  training issue.

### L2 — Platform Operations

**May:** everything L1 may, plus
- read operational surfaces: `/health`, `/admin/ops/health`, the ops dashboard,
  delivery and dunning metrics, the admin audit log
- read service logs and deploy history
- re-run **idempotent** recovery jobs a runbook names
- re-drive a failed webhook or queued job where the runbook says it is safe
- restart a worker

**May NOT:**
- write to the database outside a named runbook procedure
- flip a feature flag without a change record — flags change customer-visible
  behaviour and are a deploy, not a setting
- alter migrations, or run one out of band
- act on a suspected security incident beyond containment and escalation

### Engineering

**Owns:** code defects, migrations, worker failures, data corruption, anything
requiring source reading or a schema change, and every recovery procedure marked
UNVALIDATED.

Engineering is also the only level that may decide a support procedure is safe
enough to be promoted from UNVALIDATED.

### Security

**Owns:** suspected compromise, credential or API-key exposure, authorization
bypass, **any suspicion of cross-tenant exposure**, suspicious authentication
activity, and inbound vulnerability reports.

**Escalation path:** SecureLogic has **no formal incident-response process** as of
2026-08-21 — there is no `SECURITY.md`, no IR runbook and no disclosure policy in
the repository. Until one exists, security escalation is:

> **Escalate immediately to the named security owner (the platform owner).
> Preserve evidence. Do not investigate further yourself. Do not contact the
> reporter or the customer about the security aspect without their direction.**

Establishing a real IR process is a **separate authorized package** and is
recorded as a launch gap. These runbooks deliberately do not invent one.

## Severity

| | Meaning | Examples |
|---|---|---|
| **SEV1** | Platform unavailable, or any suspected security/tenant-isolation event | App or engine down; suspected cross-tenant exposure |
| **SEV2** | A paying customer is blocked from core work, no workaround | Cannot log in; evidence upload failing; billing lockout in error |
| **SEV3** | Degraded, workaround exists | Brief not delivered; one import failing; slow page |
| **SEV4** | Cosmetic, question, or single-record data issue | Label wrong; how-do-I question |

**A suspected tenant-isolation or compromise event is SEV1 regardless of how few
customers it appears to affect.** One leaked record is not a small incident.

## Reading these runbooks

- **UNVALIDATED** means exactly that: the procedure is written down but has not
  been proven safe. Do not run it to find out.
- Every runbook states what support may NOT do. That section is not boilerplate;
  it is the list of things that looked reasonable at 2am and were not.
