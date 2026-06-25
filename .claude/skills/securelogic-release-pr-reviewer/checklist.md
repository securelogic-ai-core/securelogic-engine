# Checklist — Release / PR Reviewer

The merge grid. **Blocking** items stop the merge until resolved or a documented compensating
control exists. Run security + architecture sub-reviews via their skills.

## Scope & sequence
- [ ] Belongs to the **active package** (confirm via **securelogic-program-manager** /
      `BUILD_SEQUENCE.md`); no scope-broadening; nothing deferred/parked snuck in.
- [ ] Exact commit scope stated; one package per commit.
- [ ] Explicit authorization to commit/merge (do not assume).

## Migrations (BLOCKING)
- [ ] Idempotent + **auto-apply-safe on boot** (a bad migration blocks engine start).
- [ ] Correctly ordered after dependencies (`YYYYMMDD_snake_case.sql`).
- [ ] New customer-data table: `organization_id NOT NULL` FK + index + canonical RLS policy.
- [ ] Enums via CHECK; FK `ON DELETE` intentional; soft-delete only on junctions.
- [ ] Applies cleanly through the isolation `setup.ts` path.
- [ ] Header documents a manual rollback (forward-only repo).

## Tests (BLOCKING for missing negative-path on customer data)
- [ ] Unit tests for new logic/validators/handlers (mocked pg); scoring values pinned.
- [ ] Cross-org isolation / RLS test for new customer-data surfaces.
- [ ] Output-shape test for intelligence/summary surfaces.
- [ ] Negative-path (cross-org, viewer, under-entitled, unset GUC, webhook replay) where trust
      matters.
- [ ] CI green: typecheck, lint, test, build (+worker tsc), cross-org-isolation. Tenant-coverage
      census reviewed.

## Deployment impact
- [ ] Reviewer understands a `main` merge redeploys **all** services + runs migrations.
- [ ] New env vars added to the right service in `render.yaml` (prod+staging) + `.env.example`
      + `validateEnv` if boot-required. Secrets on correct service (ANTHROPIC=workers prod;
      R2=staging only).
- [ ] `region:` pinned on any new block.
- [ ] Risky behavior flag-gated and enabled in **staging first**; no prod-flag flip riding in.
- [ ] Worker changes handle SIGTERM drain / reclaim; no bare `setImmediate` for durable work.

## Rollback & release risk
- [ ] Revertable via flag-flip or clean `git revert`.
- [ ] No destructive/irreversible data op without authorization + evidence trail.
- [ ] Blast radius + ordering vs dependent changes understood; prod-flag flips fenced.

## Customer impact
- [ ] Entitlement-tier moves reconciled (UI redirect + direct-API-key caller).
- [ ] No untouched-without-authorization price IDs/labels (parked).
- [ ] No breaking API response/error-code changes (additive preferred).

## Operational monitoring & docs
- [ ] Mutations audit-logged; per-org logs carry `organizationId`; alerting/queue-depth where
      relevant.
- [ ] Governing docs / canonical model / skills updated; PR description honest about scope,
      tests (with results), ops, and rollback.

## Promotion (develop → main)
- [ ] `gh pr merge <N> --merge` (NOT squash); required checks re-verified (audit can flake);
      after merge `origin/develop..origin/main` empty + develop tip has two parents.
- [ ] Validated in **Staging** (not Demo) before promotion.
