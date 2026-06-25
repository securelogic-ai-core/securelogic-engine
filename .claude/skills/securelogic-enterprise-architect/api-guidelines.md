# API Guidelines

The engine exposes a REST API over ~112 route files in `src/api/routes/`, mounted in
`src/api/routes/index.ts`. Every route file shares one shape. **Before writing a new
route, open the closest existing sibling and copy its structure.** `actions.ts`,
`risks.ts`, and the link-table routes are the cleanest references. The full annotated
template is in `examples/route-handler.md`.

---

## 1. Endpoint conventions

- **Resource-oriented paths**, plural nouns, mounted under `/api`:
  `POST /api/<resource>`, `GET /api/<resource>`, `GET /api/<resource>/:id`,
  `PATCH /api/<resource>/:id`, plus aggregate sub-routes like
  `GET /api/<resource>/summary`. Sub-resources read as
  `GET /api/vendors/:id/signals`.
- One `express.Router()` per file; `export default router`. The file owns its own
  middleware mounting per route (the chain is **not** applied globally).
- Mount the router in `routes/index.ts` under the right group (most platform routes go in
  the `/api` block; admin routes under `/admin`).
- **No URL versioning** in the live API (the old `src/api/v1` is excluded from the build).
  Don't reintroduce `/v1` without an architecture decision.

## 2. The required middleware chain

Customer-data routes mount, **in this order**:

```ts
router.post(
  "/things",
  requireApiKey,                  // API key OR JWT bridge → req.apiKey
  attachOrganizationContext,      // → req.organizationContext (sole entitlement loader)
  requireEntitlement("premium"),  // gate at the correct tier (cite TENANT_ISOLATION_STANDARD §9)
  async (req, res) => { /* handler */ }
);
```

- Add `requireNotViewer` for JWT-mutating routes (defense-in-depth over the blanket viewer
  block in `requireApiKey`).
- `requireConsent` is applied globally before platform routes — you don't add it per route.
- Pick the entitlement level by citing the §9 mapping in `TENANT_ISOLATION_STANDARD.md`.
  Ranks: `starter=1`, `standard`/`professional=2`, `premium=4` (= platform/team). The
  whole vendor/AI/platform surface is `premium`; brief/intelligence surfaces are
  `standard`/`professional`.
- **Public/auth routes** (`/api/auth/*`, public brief signup, webhooks, health) deliberately
  skip parts of the chain — match the existing pattern for that group, and audit-log every
  state change.

## 3. Resolve the org first, every handler

```ts
const organizationContext = (req as any).organizationContext ?? null;
const organizationId = organizationContext?.organizationId ?? null;
if (!organizationId) {
  res.status(403).json({ error: "organization_context_missing" });
  return;
}
```

This early-return is **mandatory** and appears in every handler. `organizationId` is then
the only source of `organization_id` for SQL — never the body or a param.

## 4. Validation

- **Hand-written, per domain** in `src/api/lib/<domain>Validation.ts` — there is **no
  zod/ajv for route bodies** (ajv exists for signed-contract JSON schemas only). Don't
  introduce a schema library for routes without an architecture decision.
- Validators return a **discriminated union**: `{ input: T }` on success or
  `{ error: string, detail?: string }` on failure. The route does:
  ```ts
  const validated = validateThingCreate(req.body);
  if ("error" in validated) { res.status(400).json(validated); return; }
  const { input } = validated;
  ```
- Inline guards for query params/filters use small helpers (`isNonEmptyString`, `isUuid`,
  `isIsoDate`, `parseLimit`) — see `actions.ts`. Enum filters validate against a
  `new Set([...canonical values])` and return `400 { error, allowed: [...] }` on a bad
  value.
- Validators are pure (no I/O), enforce length caps (defense-in-depth), and sanitize
  strings. Keep them pure.

## 5. Error handling

- Handlers wrap their body in `try/catch`. **Expected** errors → `res.status(4xx).json({
  error: "snake_case_code", … })`. **Unexpected** errors → `logger.error({ event:
  "<op>_failed", err }, "<METHOD> <path> failed")` then `res.status(500).json({ error:
  "<op>_failed" })`.
- Error bodies are a flat `{ error: "<code>" }` (plus optional `detail`/`allowed`/
  `required`/`current`). Use stable snake_case codes; the app and tests key off them.
- The central `errorHandler` is the last-resort net — it never leaks stack traces in prod.
  Don't rely on it for expected validation errors; handle those in the route.
- **Never** return a raw DB error message to the client.

## 6. Authorization & ownership

- Every read/update/delete carries `WHERE … AND organization_id = $org`. A non-matching
  `id` returns **404** (`<thing>_not_found`), not 403 — don't reveal cross-org existence.
- Verify cross-row references same-org before persisting (pre-flight `SELECT 1 … WHERE id
  = $ref AND organization_id = $org`), especially for global-signal links where the signal
  id may legitimately be global but the entity must be same-org.

## 7. Pagination

- **Keyset/cursor** is the established pattern (not OFFSET for hot lists):
  `parseLimit` (default 25, max 100), `(created_at, id) < ($cursor_ts, $cursor_id)`,
  `ORDER BY … created_at DESC, id DESC LIMIT $n`, response carries
  `nextCursor: { created_at, id } | null`. Some list/queue routes use `?offset` — match
  the sibling you're extending.

## 8. Idempotency

- **Webhooks** (Stripe, Resend, email-provider) claim the event id before processing and
  **fail closed** on a DB-health error so the provider retries —
  `src/api/webhooks/webhookIdempotency.ts`. Never silently reprocess.
- **Mutations** are generally not idempotency-keyed; rely on org-scoped UPDATEs and unique
  constraints. Link inserts use `INSERT … ON CONFLICT (… ) DO NOTHING` against the partial
  unique index to make re-posts safe.

## 9. Audit logging (mandatory on mutations)

Every state-changing handler calls `writeAuditEvent` (fire-and-forget, do **not** await):

```ts
writeAuditEvent({
  organizationId,
  actorApiKeyId: (req as any).apiKey?.id ?? null,
  actorUserId:   (req as any).userId ?? null,
  eventType:     "thing.created",        // dot-namespaced; status changes → thing.status_changed
  resourceType:  "thing",
  resourceId:    result.rows[0].id,
  payload:       { /* small, < 1KB */ },
  ipAddress:     req.ip ?? null,
});
```

## 10. Request lifecycle recap

Global middleware (helmet/cors/rate-limit/content-type/body-parse/…) → per-route auth
chain → org early-return → validate → org-scoped SQL via `pg` → `writeAuditEvent` →
shaped JSON. Stripe webhooks mount **before** the JSON body parser (raw body). See
`architecture.md` §4.

## 11. Tenant-transaction wrapping (`asTenant`)

Most routes today issue org-scoped `pg.query` directly. Routes that need a **multi-write
atomic** transaction, or that are being brought under the RLS rollout, are wrapped with
`asTenant(handler)` — it runs the handler inside `withTenant` and flushes the response
only after COMMIT. Constraints when wrapping (each has bitten before — verify):
- The handler must not stream (`res.write/pipe/send`) — `asTenant` buffers `status/json`
  only and throws on streaming.
- No un-awaited fire-and-forget `pg.query` (it would run after the scope releases) — use
  `pgElevated` or its own `withTenant`.
- No concurrent `Promise.all([pg.query, pg.query])` on the single tenant client —
  serialize.
- No raw `BEGIN/COMMIT` or advisory locks inside (eslint blocks it) — use `pgRaw`.
Don't wrap a route speculatively; wrap when atomicity or the RLS flip requires it, and add
the matching `*TenantWrap` test.

## 12. New-route checklist

- [ ] Copied the structure of the nearest existing route file.
- [ ] Mounts `requireApiKey → attachOrganizationContext → requireEntitlement(<tier>)`
      (tier cited from §9), plus `requireNotViewer` if it mutates via JWT.
- [ ] Early-returns `403 organization_context_missing`.
- [ ] Every SQL clause has `organization_id = $n` from `req.organizationContext`.
- [ ] Body validated via a pure `*Validation.ts` returning the discriminated union.
- [ ] 404 (not 403) on cross-org id miss; cross-row refs verified same-org.
- [ ] `writeAuditEvent` on every mutation with actor + org.
- [ ] Errors shaped as `{ error: "snake_case" }`; unexpected logged + 500.
- [ ] Router mounted in `routes/index.ts` under the right group.
- [ ] Tests: happy path + **cross-org negative path** + validation rejects.
- [ ] `CANONICAL_DOMAIN_MODEL.md` route row updated if it's a canonical object.
