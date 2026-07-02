# AGENTS.md

This file governs how any automated coding agent (Claude Code or otherwise) starts work in the SecureLogic AI repository. Read it first, every session.

It does **not** replace `CLAUDE.md` — `CLAUDE.md` defines your role, operating principles, and audit behavior. This file defines the **mandatory reading order** and the **launch-awareness** every session must have before touching code.

---

## Required reading order (every session, before any work)

Read these in order. Do not infer the roadmap from convenience; these documents are the controlling source of truth.

**Governing documents (product + architecture truth):**
1. `PRODUCT_VISION.md`
2. `CURRENT_STATE_ARCHITECTURE.md`
3. `CANONICAL_DOMAIN_MODEL.md`
4. `TENANT_ISOLATION_STANDARD.md`
5. `BUILD_SEQUENCE.md`
6. `FINAL_PRODUCT_STANDARD.md`
7. `CLAUDE.md`

**Launch documents (release truth — read after the governing docs):**
8. `docs/launch/LAUNCH_MASTER_PLAN.md` — what launch is, what's shipped, the sprint sequence.
9. `docs/launch/SPRINT_1.md` — the only launch-blocking work (production go-live gates).
10. `docs/launch/SPRINT_2.md` — first post-launch hardening (queued, unauthorized).
11. `docs/launch/SPRINT_3.md` — enterprise depth (queued, unauthorized).
12. `docs/launch/RELEASE_CHECKLIST.md` — the `develop → main` promotion procedure.
13. `docs/launch/KNOWN_ISSUES.md` — verified limitations, debt, and inert paths at launch.

If any governing or launch document conflicts with the code, **surface the conflict explicitly before continuing**. If a governing document conflicts with a launch document, the **governing document wins** and the launch document must be corrected. If a tenant rule conflicts anywhere, `TENANT_ISOLATION_STANDARD.md` wins.

---

## Start-of-session protocol

At the start of each build session:
1. Read the governing docs in the required order (1–7).
2. Read the launch docs (8–13) to know the current release state and what is/ isn't launch-blocking.
3. Summarize, in **5 bullets max**: the active product truth, the current state, the active package, the **current launch state** (Go / NO-GO and why), and the active sprint.
4. Confirm the package/sprint objective before making changes.
5. Follow `BUILD_SEQUENCE.md` for what comes next and `FINAL_PRODUCT_STANDARD.md` for what "done" means.

---

## Launch-awareness rules

- **Know the launch state before you touch code.** The launch is the **promotion of staged `develop` work to production `main`**, currently held **NO-GO** on operator-only gates. Do not assume work is live just because it is merged to `develop`.
- **Sprint 1 is launch-blocking only.** Do not pull Sprint 2 or Sprint 3 work forward into a launch-blocking context. Each Sprint 2/3 item is a fresh active-package decision under `BUILD_SEQUENCE.md` — not authorized by the launch plan.
- **Operator gates are not yours to run.** Stripe, Render, production DB, and staging-UI gates are operator-only. Your job is to keep the static evidence green and the promotion mechanically ready, then hand the operator an exact, runnable checklist — not to claim a gate passed.
- **Promotions follow `RELEASE_CHECKLIST.md`.** True-merge only (`gh pr merge --merge`, never squash). Respect the F-1 migration filename-key check.
- **Keep these docs honest.** When you resolve a `KNOWN_ISSUES.md` item or close a sprint item, update the doc in the same change. Stale launch docs are defects.

---

## Non-negotiable rules (from `CLAUDE.md`, restated for emphasis)

- The Platform is the main product; the Intelligence Brief is the wedge. Do not let the architecture revolve around the Brief.
- Commercial model: Intelligence Brief (Free), Brief Pro, Team Professional, Platform Professional, Enterprise. **Platform Annual is the annual billing option for Platform Professional — not a separate tier.**
- Staging is for validation. Demo is for presentation. Production is for clients. Demo is never a validation substitute.
- Do not commit without explicit authorization. Stop after package completion and present exact commit scope.
- Audit before building. Read first. No fake certainty — do not claim a route, model, service, or object exists unless you have read it.
