# Sprint 3 — Enterprise Depth

> **Status:** QUEUED — strategic horizon, **not authorized**. Begins after Sprint 2.
> **Theme:** Close the structural gaps that turn a launched product into a defensible enterprise platform: live tenant isolation, complete data-subject rights, real signal-ingestion quality, and operational hardening.
> **Authorization note:** These are large, high-blast-radius packages. Each requires its own scoping, design ratification, and explicit operator authorization under `BUILD_SEQUENCE.md`. This document sequences them; it does not green-light them.

---

## Objective

Sprint 1 and 2 deliver a working, sellable, usable product. Sprint 3 makes it **enterprise-defensible** — the things a client security review or an auditor will probe: enforced tenant isolation, complete erasure rights, intelligence quality that justifies the premium, and operational resilience.

---

## Work items

### 3.1 — A04-G1 Postgres RLS `app_request` flip (live tenant isolation)
**Why:** RLS policies exist on ~22 tables but are **INERT pre-flip** (owner cred, NOT FORCE). Route-level `organization_id` scoping is currently the **only live** tenant defense. The flip from the owner DB role to `app_request` activates RLS as a real, enforced backstop.
**Scope (per the A04-G1 rollout plan — this is in-flight infrastructure, sequenced by its own plan, not the one-at-a-time product queue):**
- Complete any remaining per-table RLS batches.
- Execute the `DATABASE_URL` `owner → app_request` flip (phase-3), staged: staging first, then prod, across all DATABASE_URL holders lockstep.
- Verify the cross-org-isolation lane stays green and no route regresses under the non-owner role.
**Done when:** RLS is FORCE-enforced under `app_request` in production and the cross-org isolation lane proves containment with RLS active.
**Hard rules:** highest blast radius in the codebase. Pre-flip checklist (admin-route triage, savepoint safety, route-wrap concurrency) must be fully cleared. Reversible staging before prod. Do not fold into a product package.

### 3.2 — GDPR deletion reaper (Art. 17 erasure)
**Why:** The export side of data-subject rights is done; the **erasure** side is not built. Required for a complete GDPR/CCPA posture.
**Scope:** the settled Phase-0 design (10 locks settled; D-9 cleared) — request + cancel, enqueuer cron, and the deletion handler, behind a feature flag. Tombstone-delete model (PII scrubbed in place, UUID preserved for audit integrity); single `withTenant` txn; order TEXT → B-delete → tombstone-last; idempotency on `users.status`; R2 purge separate and guarded; reversible until COMMIT.
**Precondition:** standalone unsubscribe must be discoverable.
**Done when:** an Art. 17 request fully erases a subject across all in-scope tables + R2, idempotently and reversibly-until-commit, with audit trail intact.
**Hard rule:** destructive — gated, staged, and negative-path tested before any prod enablement.

### 3.3 — Priority-4 signal-ingestion hardening (4B / 4C / 4D)
**Why:** This is the **active package** in `BUILD_SEQUENCE.md`. Only the additive 4A contract/registry foundation has shipped; the substance — source qualification, clustering, provenance — is the deferred runtime work. External signal ingestion is the platform's weakest layer relative to the vision.
**Scope (behind the existing flags, additive slices per the ratified `external-signal-architecture.md`):**
- **4A.4** — registry resolution / fan-out unification (first runtime-integration milestone; the scheduler does not yet consume `API_SOURCES`).
- **4B** — source qualification (`SOURCE_QUALIFICATION`, `SOURCE_AUTHORITY`).
- **4C** — signal clustering / dedup (`SIGNAL_CLUSTERING`) — must **never** touch `dedup_hash`.
- **4D** — brief-item signal provenance (`BRIEF_PROVENANCE`).
**Done when:** ingestion inputs are materially richer and more reliable, validated, and the flags can be flipped on in production.
**Hard rules:** additive slices only; preserve the global-signal / per-org-fan-out tenancy model and the three matcher invocation paths; clustering must not alter `dedup_hash`. Scope guard D6/D7 (dependency linkage, reassessment triggers) is **Priority 5**, not here.

### 3.4 — Operational hardening
**Why:** Resilience and correctness gaps that are tolerable at launch but not at enterprise scale.
**Scope (each a small, independent package):**
- **Rate-limiter Redis migration** — current limiter is in-memory; effective per-IP limit is `replica-count × max` on multi-replica. Move to `rate-limit-redis`.
- **Cross-region worker re-provisioning** — prod `securelogic-data-rights-worker` + `securelogic-posture-worker` run `region: oregon` but reach the Virginia prod Postgres. Region is immutable post-provision → recreate in-region.
- **Demo environment promotion** (optional) — promote Demo from a seeded logical surface to a separately deployed peer environment, if/when sales cadence justifies it.
**Done when:** each sub-item is independently shipped and verified; none is bundled with the others.

### 3.5 — SecureLogic AI internal control environment (Priority 9)
**Why:** To credibly answer client security reviews and auditor scrutiny, SecureLogic AI must operate like a service organization.
**Scope:** system boundary, asset inventory, vendor inventory, access-review process, minimum security requirements, evidence repository structure, risk/control baseline, management-review cadence.
**Done when:** SecureLogic AI has a minimum auditable operating environment.

---

## Sequencing notes

- **3.1 (RLS flip)** is in-flight infrastructure and runs on its own rollout plan **in parallel** with product work — it does not consume the one-at-a-time product slot, but its flip is high-risk and must be staged deliberately.
- **3.3 (Priority 4)** is the formally-active product package and should be the default product focus once Sprint 2 closes.
- **3.2, 3.4, 3.5** are independent and can be sequenced by operator priority.

## Definition of done (Sprint 3)

Sprint 3 has no single "done" — it is the enterprise-depth horizon. It is complete enough to claim enterprise-readiness when: RLS is live-enforced, erasure rights exist, signal ingestion quality is materially improved, the known operational gaps are closed, and SecureLogic AI operates with an auditable internal control environment.
