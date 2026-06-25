# Checklist — Security Reviewer

Run top-to-bottom on any diff touching customer data, auth, files, or LLM. **Blocking**
items must be resolved or carry a documented compensating control before merge.

## Tenant isolation (BLOCKING)
- [ ] Every customer-data `SELECT/INSERT/UPDATE/DELETE` has `organization_id = $n`.
- [ ] Org sourced from `req.organizationContext.organizationId` — never body/param.
- [ ] Org predicate present even on UUID-`id` filters; cross-org miss → 404 (not 403).
- [ ] Cross-row refs pre-flighted same-org.
- [ ] New customer-data table: `organization_id NOT NULL` FK + index + canonical RLS policy.
- [ ] A cross-org **negative-path test** added/updated (`test/isolation/`).

## Authn / authz (BLOCKING for gate errors)
- [ ] Chain present: `requireApiKey → attachOrganizationContext → requireEntitlement(<tier>)`.
- [ ] Tier correct, cited from `TENANT_ISOLATION_STANDARD.md` §9.
- [ ] `viewer` cannot mutate (`requireNotViewer` on JWT mutations).
- [ ] New auth/state-change path audit-logs; fail-closed on auth/DB error.
- [ ] Admin route → admin chain; logs staff actor + org (+ reason on mutation).

## Audit & data exposure
- [ ] Every mutation calls `writeAuditEvent` (actor + org + ip + dot-namespaced event).
- [ ] No raw DB error / stack trace to client; error bodies are `{ error: "snake_case" }`.
- [ ] Responses don't over-return (no other-org rows, no internal columns/secrets).

## Secrets
- [ ] No secret/key/token/password in code, `render.yaml` literals, fixtures, or logs.
- [ ] New required secret added to `validateEnv.ts` + `.env.example` + correct `render.yaml`
      service (ANTHROPIC=workers prod; R2=staging only).
- [ ] No credentials inlined in bash or commit messages.

## Files / uploads
- [ ] Size-capped before the wrapper; content-type validated.
- [ ] Keyed `org/{orgId}/…`; streamed (not disk); pre-signed URL single-org, TTL ≤ 120s.

## LLM / AI safety
- [ ] Single-org prompt scope; no cross-org batching of private inputs (R6).
- [ ] Untrusted model output (from feeds/uploads) constrained + validated before use; no
      privileged action driven by raw model output.
- [ ] Output persisted only to same-org rows; safe degradation without the key.
- [ ] Logs org id + model + prompt-hash, not raw prompt.

## Outbound / dependencies / hardening
- [ ] User-supplied URLs go through the pinned agent (SSRF); `undici` bump re-verified.
- [ ] No weakening of rate-limit / lockout / idempotency / RLS without a compensating control.
- [ ] New deps: no known HIGH (`npm audit`); added to the correct tree (engine/app/website).

## Writeup
- [ ] Each finding: **file:line**, the rule/standard violated (cite), the concrete risk, the
      smallest fix. Separate **blocking** from **non-blocking**. No padding, no rubber-stamp.
- [ ] If touching an open R1–R11 risk, name it.
