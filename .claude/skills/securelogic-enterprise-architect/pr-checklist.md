# Pull Request Checklist

Enterprise-grade review checklist for SecureLogic AI. Use it two ways: as the author,
self-review before proposing a commit; as a reviewer, evaluate every dimension below. A
"no" on a load-bearing item (architecture, security, tenant isolation, entitlements)
blocks the PR until resolved or a documented compensating control is added.

> **Process reminders (from `CLAUDE.md` / `BUILD_SEQUENCE.md`):** one package at a time;
> do not broaden scope; **do not commit without explicit authorization**; stop after a
> package and present the exact commit scope. Branch-sync PRs must be `--merge` (never
> squashed). Don't promote `develop → main` without verifying the required checks pass.

---

## 1. Architecture & fit
- [ ] The seven-section pre-implementation brief (SKILL.md §3) was done for any
      significant change.
- [ ] Extends an existing pattern; a new sibling was copied rather than a new pattern
      invented. If a new pattern was introduced, it's justified and no existing one fit.
- [ ] Lives in the correct layer (route / middleware / lib / engine / worker / migration)
      and respects the inward dependency direction (`architecture.md`).
- [ ] Reuses shared infrastructure where applicable (`pg`/`pgElevated`/`withTenant`, the
      `jobs` queue + `dataRightsWorkerPolicy`, the scoring engine, the matcher, the feed
      adapter, `writeAuditEvent`, `blobStorage`).
- [ ] No canonical object stored as free text / JSON blob; no divergent enum re-declared.
- [ ] Platform-first: strengthens shared objects/engine, not just one output surface.
- [ ] Touches only the active package's scope; nothing deferred or out-of-sequence snuck in.

## 2. Security
- [ ] No secrets in code, `render.yaml` literals, fixtures, or log lines.
- [ ] Auth chain correct; new auth/state-change paths audit-log.
- [ ] No raw DB error or stack trace returned to clients.
- [ ] File routes: size-capped, org-keyed (`org/{orgId}/…`), streamed (not disk-spooled),
      content-type validated.
- [ ] LLM calls: single-org scope, untrusted-output handled, safe degradation if the key
      is absent. No cross-org prompt batching.
- [ ] Outbound HTTP uses the pinned agent (SSRF); `undici` major bumps re-verified.
- [ ] No existing control weakened (rate-limit, lockout, idempotency, RLS policy) without a
      documented compensating control.

## 3. Tenant isolation  *(load-bearing)*
- [ ] Every customer-data SQL statement has `WHERE organization_id = $n`.
- [ ] `organization_id` sourced from `req.organizationContext.organizationId` — never body
      or param.
- [ ] Org predicate present on `id`-filtered reads/updates/deletes (anti-IDOR); cross-org
      id miss returns 404, not 403.
- [ ] Cross-row references verified same-org before persist.
- [ ] New customer-data table: `organization_id UUID NOT NULL REFERENCES organizations(id)`
      + org-leading index + canonical RLS policy (`NULLIF`, `NOT FORCE`).
- [ ] A cross-org **negative-path test** proves org A ≠ org B for the new surface.
- [ ] Per-org background work wraps each org in try/catch and logs `organizationId`.

## 4. Entitlements & authorization
- [ ] `requireEntitlement(<tier>)` present at the correct level, with the tier choice cited
      from `TENANT_ISOLATION_STANDARD.md` §9.
- [ ] `viewer` cannot mutate (blanket block + `requireNotViewer` on JWT-mutating routes).
- [ ] Admin routes go through the admin chain and audit staff actor + org (+ reason on
      mutations).
- [ ] Entitlement is read via `attachOrganizationContext`, not a direct `organizations`
      query.

## 5. Performance
- [ ] Queries are indexed for their filter/sort paths (org-leading + composite as needed).
- [ ] List endpoints paginate (keyset cursor; bounded `limit`).
- [ ] No N+1 query loops where a set-based query works; no unbounded scans.
- [ ] No concurrent `Promise.all([pg.query,…])` on a single tenant client inside `asTenant`.
- [ ] LLM/feed calls have timeouts and per-item error isolation.

## 6. Database impact
- [ ] Migration is `YYYYMMDD_snake_case.sql`, idempotent, safe to **auto-apply on boot**,
      correctly ordered after dependencies.
- [ ] Enums via CHECK constraints with canonical values; FK `ON DELETE` chosen with intent.
- [ ] Soft-delete only on junctions; hard-delete CASCADE on entities.
- [ ] Migration applies cleanly through the isolation `setup.ts` path.
- [ ] No `new Pool()` outside `infra/postgres.ts`.

## 7. Operational impact
- [ ] Understands that a `main` merge **redeploys all services and runs migrations** — the
      change is safe under that.
- [ ] New env vars added to `.env.example`, `render.yaml` (prod + staging), and
      `validateEnv.ts` if required at boot. Secrets placed on the correct service only
      (`ANTHROPIC_API_KEY` = workers in prod; R2 = staging-only).
- [ ] Risky behavior ships dark behind a `SECURELOGIC_*_ENABLED` flag, enabled in staging
      first.
- [ ] `region:` pinned on any new `render.yaml` block.
- [ ] Workers handle SIGTERM drain / reclaim; no in-process `setImmediate` for durable work.

## 8. Testing
- [ ] Unit tests for new logic/validators/handlers (mocked `pg`), with pinned values for
      scoring.
- [ ] Cross-org isolation / RLS test for new customer-data surfaces.
- [ ] Output-shape test for intelligence/summary surfaces.
- [ ] Negative-path tests where trust matters (cross-org, viewer, under-entitled, unset GUC,
      bad token, webhook replay).
- [ ] Ran the **minimum** validation the package requires (not necessarily the whole repo).

## 9. Documentation
- [ ] Governing docs updated if architecture/state/model/sequence changed (stale docs =
      defect).
- [ ] This Skill updated if a pattern, boundary, or fact moved.
- [ ] `CANONICAL_DOMAIN_MODEL.md` row added/updated for new canonical objects/enums (with
      package attribution).
- [ ] No conflicting claims left across docs.

## 10. Rollback strategy
- [ ] Behavior change is flag-gated (flip off to revert) **or** the commit is cleanly
      revertable.
- [ ] Forward-only migrations have a documented manual rollback in the file header if they
      could ever need one.
- [ ] No destructive/irreversible data operation without explicit authorization and an
      evidence trail (per the standing "evidence before disabling a prod path" rule).
- [ ] The change can be validated in **Staging** before promotion to Production.

## 11. PR description (what to write)
State, concisely: **what** changed and **why**; the **active package** it belongs to; the
**exact commit scope**; tenant-isolation + entitlement impact; tests run and their result
(honestly — failures stated with output); env/flag/migration/ops changes; and the
**rollback** path. Don't claim "production-ready" for something only validated in unit
tests or only visually improved.
