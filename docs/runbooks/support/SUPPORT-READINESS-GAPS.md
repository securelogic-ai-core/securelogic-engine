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

### SUP-OBS-2 — No support-facing surface at all — **RULED, post-launch package**

Every `/admin/*` route requires a staff key and returns **404** without one — by
design, and correctly so. The consequence is that L1 has no operational surface
whatsoever: not health beyond `/health`, not delivery status, not billing state.

> **RULING 2026-08-21.** For Sept 15, **L1 is an intake and triage tier**, not an
> operational administration tier. `/admin/*` and staff keys are **not** exposed to
> L1, and **no support console is built before launch**.
>
> This closes the gap by deciding the boundary rather than by adding a tool.
> Runbooks are now written honestly to that boundary: L1 diagnoses from what the
> customer can see and escalates, and nothing is documented as an L1 step that
> requires a surface L1 does not have.

**Post-launch package — Support Operations Console.** Scoped, read-only, and
subject to three non-negotiable requirements, because this is a privileged read
surface over every tenant's data:

1. **Least privilege** — the specific fields a runbook needs, not "read access".
   Start from SR-001's four questions (verified / locked-until / active /
   last-login), not from a table.
2. **Explicit tenant scoping** — a support view that can span tenants is the same
   risk class as SR-009. Access is per-organization and never global-by-default.
3. **Full audit logging** — every read attributable to a named person, with the
   customer able to be told what was accessed. A support tool that reads customer
   data without a trail cannot be defended in an audit.

Deliberately **not** rushed before launch: a privileged cross-tenant read surface
shipped under launch pressure is precisely the wrong thing to hurry.

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

### Evidence from the Sept 15 runbook set (SUP-OBS-6 … 21)

Written while grounding 23 runbooks in real code. Each is a question a runbook
actually asks that support cannot answer today. **This is the requirements list for
the post-launch Support Operations Console** — derived from real diagnostics rather
than from imagining a screen.

| ID | What support cannot see | Runbook | Impact |
|---|---|---|---|
| **SUP-OBS-6** | Engine-side reason behind a generic import failure | SR-020 | Escalation |
| **SUP-OBS-7** | Whether a severity was `no_severity` (source said none) or `unmapped` (we couldn't read it) — **different answers to the customer** | SR-022 | Wrong explanation |
| **SUP-OBS-8** | Which identifiers SecureLogic holds for an asset | SR-023 | Most common follow-up in that runbook |
| **SUP-OBS-9** | Which source reported an occurrence, and when it last did | SR-025 | Central to "why is it still showing?" |
| **SUP-OBS-10** | **Scan-run history: what a run covered and why it closed nothing** | SR-026 | **Highest-value gap in the vulnerability domain** |
| **SUP-OBS-11** | An organization's storage quota usage | SR-005 | Cannot confirm a quota error |
| **SUP-OBS-12** | No status page or shared incident view | SR-008 | L1 learns of outages from customers |
| **SUP-OBS-13** | Per-org billing/entitlement state | SR-003, SR-004, SR-041 | Three runbooks blocked on one gap |
| **SUP-OBS-14** | Seat assignment for a user | SR-004 | Cannot separate seat from billing |
| **SUP-OBS-15** | An org's configured SLA policy | SR-033 | Depends on the customer reading it out |
| **SUP-OBS-16** | Login history / active sessions | SR-010 | "Where has my account been used?" is unanswerable |
| **SUP-OBS-17** | Per-API-key usage history | SR-013 | Blast radius after exposure cannot be assessed |
| **SUP-OBS-18** | Whether a customer is actually rate-limited | SR-012 | Cannot confirm the cause |
| **SUP-OBS-19** | Data-rights request state | SR-011 | **The workflow with the hardest external deadline** |
| **SUP-OBS-20** | Whether a provider billing event was received | SR-041 | Central question of a SEV2 runbook |
| **SUP-OBS-21** | Environment plan/price configuration | SR-042 | A past defect (transposed price IDs) was invisible from support |
| **SUP-OBS-22** | Whether a posture snapshot succeeded, and when the next is due | SR-015 | The most common question behind "the number looks wrong" |

**Concentration worth noting:** SUP-OBS-1, 3, 13 and 19 between them account for
most escalations across the whole set. A console addressing those four — auth
state, email delivery, billing/entitlement state, data-rights state — would convert
the majority of these runbooks from "escalate" to "answer", far more than a broad
read-only view would.

## Process gaps

### SUP-SEC-1 — Incident-response process — **MINIMUM PROCESS NOW EXISTS, gaps remain**

> **UPDATED 2026-08-21.** `docs/security/INCIDENT-RESPONSE.md` and `SECURITY.md`
> now exist. The four SEV1 runbooks no longer terminate at a named human: escalation
> leads into a defined process with acknowledgement, triage, declaration, evidence
> preservation, containment authority, communications ownership and closure.
>
> **SUP-SEC-1 is NOT closed.** A paper tabletop
> (`docs/security/TABLETOP-cross-tenant-exposure.md`) walked the highest-risk
> scenario and found three things documentation cannot fix:
>
> | | Finding | Why it blocks |
> |---|---|---|
> | **TT-1** | **No named legal/privacy reviewer** | §12 cannot be executed *during* a live SEV1 — the notification decision has nobody to make it |
> | **TT-2** | **Cannot determine who else saw exposed data** | Reads are not audited at row level, so impact is reasoned about rather than evidenced |
> | **TT-4** | **Log retention unverified** | Evidence may expire before an investigation starts |
>
> Plus: no live exercise has been run with real people, and one person holds
> Security Owner, Incident Owner and operator.

### SUP-SEC-1 (original) — No incident-response process existed

There is no `SECURITY.md`, no IR runbook, no vulnerability-disclosure policy and
no defined severity/notification path in the repository. SR-009 and SR-010
therefore escalate to a **named human** and stop, because inventing a parallel IR
framework inside support documentation would be worse than admitting the gap.

**Needed:** a real IR process — as a separate authorized package, with the
notification obligations reviewed by someone qualified to rule on them. This is
the most significant non-technical launch gap identified.

### SUP-PROC-1 — No validated recovery procedures — **ACCEPTED LAUNCH LIMITATION**

Every recovery path currently written is either self-service or escalation.
**No support-executable recovery procedure has been proven safe**, so none is
documented as validated. That is honest but thin: it means today, in practice,
recovery *is* engineering.

> **RULING 2026-08-21.** This stands as an **explicit launch limitation**.
> Recovery procedures remain **Engineering-only until individually validated
> safe**.
>
> **Recovery steps must NOT be manufactured to close this documentation gap.** A
> plausible-looking procedure that nobody has proven is worse than an honest
> escalation: it will be followed, under pressure, by someone who has no way to
> know it was never tested. An empty "Approved support actions" section is a true
> statement about the platform, and true beats complete.

**Promotion path (post-launch).** A procedure leaves UNVALIDATED only when
Engineering has proven it safe — in staging, against a realistic tenant, with the
failure modes enumerated. Likely first candidates, in rough order of support
value: resend verification email, re-drive a failed Stripe webhook, restart a
stuck worker. None is approved today.

### SUP-PROC-2 — Stale operator documentation

`docs/launch/OPERATOR_RUNBOOK.md` (last changed 2026-07-21) predates the entire
SL-BILL-1 dunning package and describes billing flows that have since changed. It
is the most dangerous document in the repository for support purposes, because it
is confidently wrong rather than absent.

**Needed:** re-validate against `develop` or mark it superseded.

## Sept 1 security validation intake — where findings go

**The path a confirmed finding takes is the product's own lifecycle.** Using
SecureLogic for SecureLogic's own security findings is deliberate: it is the same
discipline we ask customers for, and it produces the audit trail.

```
ZAP / Burp / CI scan finding
   └─ triaged by Security (SR-014 if reported externally)
      └─ Vulnerability Finding            source_type='vulnerability', CVE/CWE/CVSS where applicable
         └─ Affected asset / occurrence    where a specific asset is implicated
            └─ Severity                    canonical, or none if Informational (SR-022)
               └─ SLA                      from the org policy, at creation (SR-033)
                  └─ Remediation           actions and owners
                     └─ Risk Register      where the exposure warrants an entry (SR-030)
                        └─ Exception       if it cannot be fixed inside the SLA
                           └─ Evidence     what was changed and verified
                              └─ Retest    re-observation; a recurrence is recorded, not hidden (SR-025)
                                 └─ Closure  a human governance decision (ADR-0009)
```

**Two rules carry over from ADR-0009 and must not be shortcut for our own
findings:** a retest that still sees the issue is a recurrence recorded at the
occurrence level, and closure remains a human decision — not something a clean
rescan performs.

### Where operational lessons land

Operational findings from the planned OWASP ZAP / Burp Suite work should land
**here and in the affected runbook**, not in test notes:

- a new customer-visible failure mode → new or updated `SR-*`
- a new escalation trigger → SR-009 / SR-010 and the authority model
- a detection gap → a `SUP-OBS-*` entry above
- an IR process finding → SUP-SEC-1

The structure is deliberately ready for that input now, so nothing discovered on
Sept 1 has to wait for somewhere to put it.
