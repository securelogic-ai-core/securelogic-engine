# Support runbooks

Operational knowledge for people answering customer problems. **Not architecture
documents** — if a runbook has become one, it has stopped being usable at 2am.

Start with **`SUPPORT-AUTHORITY-MODEL.md`**: what each level may and may not do.
The default is that support does not manipulate production database state.

## Why "support runbooks" and not "playbooks"

`playbook` is already a **customer-facing product noun** in SecureLogic —
`orchestration_playbooks`, `/api/orchestration/playbooks`,
`orchestration.playbook_created`. Reusing it for internal documents would make
one word mean two unrelated things. `docs/runbooks/` already existed as the
canonical operational home, so these live under it.

## Naming

`SR-<NNN>-<slug>.md`. Numbers are permanent; a retired runbook is marked
SUPERSEDED, never renumbered or reused.

---

## What is actually live in production

**This is the constraint that decides the launch set.** As of 2026-08-21:

- `develop` is **65 commits ahead of `main`**
- production has **4** SecureLogic feature flags ON at the engine
  (Vendor Assurance, Ask, Legacy Vendor Writes, Seat Model)
- risk acceptance, finding closure gate, Decision Workspace, billing grace:
  **all OFF or absent in production**

So the vulnerability, occurrence, risk-linkage, exception and dunning packages —
all real, all merged or open on `develop` — are **not customer-facing today**.
Runbooks for them are written when the release that promotes them lands, not
before. Documenting them now as though support could hit them would be exactly
the fiction this directory exists to avoid.

---

## Runbook status

### Written

| ID | Title | Domain | Sev |
|---|---|---|---|
| SR-001 | Customer cannot log in | Authentication | SEV2 |
| SR-009 | Suspected cross-tenant exposure | Security | **SEV1** |

### Required before Sept 15 — not yet written

These cover functionality that **is** live in production today.

| ID | Title | Domain | Why it matters |
|---|---|---|---|
| SR-002 | Email verification not received | Authentication | Blocks first login; Resend suppression is a known failure mode |
| SR-003 | Payment failure / card declined | Billing | Money; customer-visible banner |
| SR-004 | Account suspended or entitlement wrong | Billing | Blocks a paying customer from all work |
| SR-005 | Document or evidence upload failure | Documents | Blocks audit evidence collection |
| SR-006 | Findings import failure | Findings | High-volume onboarding path |
| SR-007 | Intelligence Brief not received | Email / AI | The subscription deliverable |
| SR-008 | App or engine unavailable | Availability | SEV1 platform event |
| SR-010 | Suspected account compromise | Security | **SEV1** |
| SR-011 | Data export or erasure request failure | Data & Privacy | Regulatory deadline |
| SR-012 | Ask / AI generation failure | AI | `ASK_ENABLED` is ON in production |

### Deferred — functionality not yet in production

> **RULED 2026-08-21: a deferred runbook is a RELEASE-READINESS REQUIREMENT of the
> release that promotes its capability to production.**
>
> Deferral is not a backlog entry that a release can outrun. When a capability
> below reaches production, its runbook ships **with** that promotion — a
> promotion that makes a customer-visible failure mode reachable while its runbook
> is still unwritten is **not release-ready**, however green its CI is.
>
> This is the same discipline as the Definition of Done, applied at the release
> boundary instead of the PR boundary: the PR that builds dark behaviour owes
> nothing, and the release that lights it up owes the runbook.

Tracked against named gates, not forgotten.

| Prospective ID | Topic | Required by this promotion |
|---|---|---|
| SR-020 | Vulnerability import failure | SL-VULN-1 reaching `main` |
| SR-021 | CVE/CWE/CVSS normalization issue | SL-VULN-1 |
| SR-022 | Vulnerability has no SLA (Informational/unmapped) | SL-VULN-1 |
| SR-023 | Asset cannot be resolved from scan identifiers | SL-OCC-1 (#843/#844) |
| SR-024 | Occurrence not updating / duplicate suspected | SL-OCC-1 |
| SR-025 | Reported remediated but still active; reappearance | SL-OCC-2 (#845) |
| SR-026 | Conflicting source/scanner observations | SL-OCC-2 |
| SR-030 | Finding cannot be linked to Risk Register | SL-RISK-LINK reaching `main` |
| SR-031 | Risk exception / acceptance issue | SL-EXC-1 |
| SR-032 | Finding cannot be closed (closure gate) | Closure gate ON in production |
| SR-033 | Remediation SLA missing or incorrect | SL-SLA-UI |
| SR-040 | Billing grace period behaviour | `BILLING_GRACE_ENABLED` ON |
| SR-041 | Stripe webhook / recovery failure | SL-BILL-1 reaching `main` |
| SR-042 | Resubscription / Checkout failure | SL-BILL-1 |
| SR-050 | SSO configuration or authentication failure | First SSO customer |

### Not applicable yet

- Scanner connector failures — no connector exists (SL-OCC-3 unauthorized)
- Object storage unavailability — write with SR-005 once storage behaviour is
  confirmed against production, not inferred

---

## Conventions

- **UNVALIDATED** means the procedure is written but unproven. Do not run it to
  find out whether it works.
- Every runbook states what support must **not** do. That section is the list of
  things that looked reasonable under pressure and were not.
- No credentials, DSNs, tenant identifiers, customer emails or internal hostnames
  in any runbook.
- Update the runbook in the same package as the change. See
  `docs/runbooks/support/DEFINITION-OF-DONE.md`.
