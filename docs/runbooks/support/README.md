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

**Reconciled 2026-08-21 against `develop@58cccb2c`.** The set below is decided by
what becomes reachable, not by what exists in code.

### The reconciliation that matters

The accumulated `develop` → `main` release splits into two groups, because
**promotion alone does not make everything customer-visible**:

**Live on promotion — unflagged.** Vulnerability findings, per-asset occurrences,
the observation ledger, Risk Register linking/promotion, the SLA settings UI,
pen-test intake, and the dunning/recovery billing paths. These routes read no
feature flag, so the release that promotes them makes them reachable.

**Still flag-gated after promotion.** Verified against `render.yaml` production
values: risk acceptance (`RISK_ACCEPTANCE_ENABLED` — *not declared* in prod),
Decision Workspace (`false`), Risk Workspace (`false`), finding closure gate
(`false`), and billing grace (`false` in prod **and** staging). Their runbooks stay
deferred to the **flag flip**, not the promotion.

### READY — written, grounded in current code

| ID | Title | Domain | Sev | Gate |
|---|---|---|---|---|
| SR-001 | Customer cannot log in | Auth | SEV2 | Live today |
| SR-002 | Verification email not received | Auth/Email | SEV2 | Live today |
| SR-003 | Payment failed / card declined | Billing | SEV3→2 | Promotion |
| SR-004 | Access lost or entitlement wrong | Billing | SEV2 | Promotion |
| SR-005 | Document/evidence upload fails | Documents | SEV2 | Live today |
| SR-007 | Brief not received | Email/Intel | SEV3 | Live today |
| SR-008 | Application or engine unavailable | Availability | **SEV1** | Live today |
| SR-009 | Suspected cross-tenant exposure | Security | **SEV1** | Live today |
| SR-010 | Suspected account compromise | Security | **SEV1** | Live today |
| SR-011 | Export or data-rights failure | Data/Privacy | SEV2 | Live / partly gated |
| SR-012 | Ask or AI generation fails | AI | SEV3 | Live today |
| SR-013 | Credential or API key exposure | Security | **SEV1** | Live today |
| SR-014 | Inbound vulnerability report | Security | **SEV1** | Live today |
| SR-020 | Vulnerability import failure | Vulnerability | SEV3 | Promotion |
| SR-022 | No canonical severity / no SLA | Vulnerability | SEV4 | Promotion |
| SR-023 | Asset cannot be resolved | Vulnerability/Asset | SEV3 | Promotion |
| SR-024 | Affected-assets count unexpected | Vulnerability/Asset | SEV3 | Promotion |
| SR-025 | Still active after fix / reappeared | Vulnerability/Asset | SEV3 | Promotion |
| SR-026 | Scan scope / absence disagreement | Vulnerability/Asset | SEV3 | Promotion |
| SR-030 | Risk Register link or promotion issue | Findings/Risk | SEV3 | Promotion |
| SR-033 | Remediation SLA missing or wrong | Findings | SEV3 | Promotion |
| SR-041 | Paid but access not restored | Billing | **SEV2** | Promotion |
| SR-042 | Cannot resubscribe / Checkout fails | Billing | SEV2 | Promotion |

**SR-021 (CVE/CWE/CVSS normalization) is deliberately not a separate runbook.**
Identifier-format rejections are covered by SR-020's error-code table and severity
normalization by SR-022. A third file would duplicate both and give an agent two
places to look for one answer.

### DEFERRED — gated on a flag flip, not on the promotion

| Prospective ID | Topic | Required when |
|---|---|---|
| SR-031 | Risk exception / acceptance issue | `RISK_ACCEPTANCE_ENABLED` → true in prod |
| SR-032 | Finding cannot be closed (closure gate) | `FINDING_CLOSURE_GATE_ENABLED` → true |
| SR-034 | Decision Workspace behaviour | `DECISION_WORKSPACE_ENABLED` → true |
| SR-040 | Billing grace period | `BILLING_GRACE_ENABLED` → true |
| SR-050 | SSO configuration / authentication failure | First SSO customer |
| SR-060 | Scanner connector failures | **SL-OCC-3 does not exist** — do not document connectors as available |

**Under the ratified rule, each of these is a release-readiness requirement of the
change that turns its flag on** — not a backlog item that flip can outrun.

### MFA and session invalidation

Covered within SR-001 (lockout, session) and SR-010 (compromise) rather than as
separate files. MFA has no distinct customer-visible failure mode today beyond
those paths; if one emerges, it gets its own ID.

## Conventions

- **UNVALIDATED** means the procedure is written but unproven. Do not run it to
  find out whether it works.
- Every runbook states what support must **not** do. That section is the list of
  things that looked reasonable under pressure and were not.
- No credentials, DSNs, tenant identifiers, customer emails or internal hostnames
  in any runbook.
- Update the runbook in the same package as the change. See
  `docs/runbooks/support/DEFINITION-OF-DONE.md`.
