# ADR-0005 — Tenant erasure via a session-variable escape hatch in the WORM triggers

- **Status:** PROPOSED (2026-07-28). Awaiting Simmee ruling. Resolves KNOWN_ISSUES
  **D-12** (owner was previously unassigned) and unblocks **D-3** (Art. 17 reaper).
  Implementation tracked as issue **#695**; nothing is authorized until acceptance.
- **Date:** 2026-07-28
- **Source:** Decision Review DS-1 (2026-07-28).
- **Decision requested:** adopt the session-variable escape hatch as the erasure
  mechanism for the six WORM-triggered tables.

---

## Context

Tenant erasure is architecturally impossible today, verified against a real database
(KNOWN_ISSUES D-12): six append-only tables (`finding_lifecycle_events`,
`security_audit_log`, `risk_lifecycle_events`, `applicability_assessments`,
`applicability_evidence`, `applicability_affected_entities`) carry
`BEFORE UPDATE OR DELETE` triggers that `RAISE` unconditionally, and Postgres fires
row triggers on FK-cascade deletes — so `DELETE FROM organizations` raises for any org
whose findings were ever decided on. `finding_risk_acceptances` adds an independent
barrier (its own forbid-delete trigger + `finding_id ON DELETE RESTRICT` — correct for
a governance artifact: withdrawn, not erased). GDPR Art. 17 and ordinary commercial
offboarding are both unsatisfiable; every new tenant deepens the web.

## Decision (proposed)

The six WORM trigger functions gain one guarded escape condition: they permit the
operation **only when** an erasure session variable is set, and that variable is set
**only** by an audited, admin-chain-gated erasure transaction that (1) has already
written a durable erasure certificate (what is destroyed, when, under whose
authority — legal shape confirmed with counsel before design freeze), (2) asserts the
target org id, and (3) supports a dry-run mode. Isolation-lane tests assert the
triggers still RAISE without the variable. `finding_risk_acceptances` handling
(RESTRICT + its own trigger) is settled in the same design: an erased tenant's
acceptances are destroyed under the same certificate — the artifact's
"withdrawn-not-erased" rule applies to live tenants, not to tenancy erasure itself.

## Alternatives rejected

1. **Audited `DISABLE TRIGGER` suspension** (generalizing the validation teardown):
   requires owner privileges on the app path and disables protection for ALL rows
   mid-transaction; the D-12 ledger explicitly forbids generalizing it.
2. **Crypto-shredding** (per-org keys, erase = key destruction): strongest posture,
   but requires envelope-encrypting tenant data at the column layer — a storage
   re-architecture out of proportion to the problem today; ciphertext-remains
   is itself contested under some DPAs.
3. **Tombstone + scheduled purge:** the purge hits the same triggers — defers, does
   not solve.

## Consequences

- WORM discipline stays absolute for every path except the certified erasure
  transaction; the escape is scoped, auditable, and testable.
- D-3's settled reaper design becomes buildable; commercial offboarding becomes
  possible; Enterprise-tier DPA commitments become honest.
- Operational requirement: runbook + staging rehearsal on `[SEED]` orgs before any
  production use; erasure is irreversible by definition.
- ALIGNS: `writeAuditEvent` sole-writer rule (the certificate is an audit artifact),
  admin-chain rules (§7), the WORM/by-value discipline everywhere else.
- CONFLICTS: none — this is the controlled exception the discipline currently lacks.
