# Checklist — Enterprise Architect

The full enterprise PR grid is in `pr-checklist.md` (10 dimensions). This is the
**architecture-decision** checklist — run it before any significant change. Pair it with the
mandatory seven-section brief in `SKILL.md` §3.

## Before designing
- [ ] Read the relevant governing docs (order in `SKILL.md` §0) and the live files — no
      claims about routes/tables/services/flags without reading them.
- [ ] Found the **closest existing sibling** pattern to extend (route / migration / worker /
      validator / test). A divergent new pattern needs justification.
- [ ] Confirmed this is the **active package** (`securelogic-program-manager` /
      `BUILD_SEQUENCE.md`) and not deferred or out-of-sequence.

## Layering & fit
- [ ] Correct layer (route / middleware / lib / engine / worker / migration); dependency
      direction inward (`architecture.md` §3). Engine code stays pure (no I/O).
- [ ] Reuses shared infra (`pg`/`pgElevated`/`withTenant`, the `jobs` queue, the scoring
      engine, the matcher, the feed adapter, `writeAuditEvent`, `blobStorage`).
- [ ] No new `Pool()` outside `infra/postgres.ts`; no new ORM/validation library without an
      explicit decision.

## Domain & boundaries (load-bearing)
- [ ] No canonical object stored as free text / JSON blob; no divergent enum re-declared
      (`domain-model.md`, `CANONICAL_DOMAIN_MODEL.md`).
- [ ] Tenant isolation preserved: every customer-data query org-scoped from
      `req.organizationContext`; new customer-data table gets `organization_id NOT NULL` +
      index + canonical RLS policy.
- [ ] Entitlement gate present at the correct tier, cited from `TENANT_ISOLATION_STANDARD.md`
      §9. The security middleware chain is intact.
- [ ] Any weakening of a boundary (RLS, rate-limit, lockout, idempotency) has a documented
      compensating control.

## Scalability
- [ ] Indexed for the query's filter/sort paths; list endpoints paginate (keyset).
- [ ] No N+1 loops; per-org background work isolates each org (try/catch + `organizationId`
      logging).
- [ ] Durable async work uses the `jobs` queue (not bare `setImmediate`).

## Outputs & docs
- [ ] If two approaches are viable, tradeoffs stated and one recommended — not silently picked.
- [ ] Governing docs / this skill / `CANONICAL_DOMAIN_MODEL.md` rows updated in the same change.
- [ ] Validation strategy names the unit + cross-org isolation tests that prove correctness
      **and** non-leakage.

If a "fix" is really a missing abstraction, a sequencing problem, or a data-model problem —
**say which**, and propose the abstraction before smearing the feature across routes.
