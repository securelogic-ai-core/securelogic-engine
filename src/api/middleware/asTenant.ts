/**
 * asTenant.ts — A04-G1 request-scope tenant wrap (PR α: the mechanism).
 *
 * See docs/A04-G1-request-scope-wrap-design.md (Option C, §4.1).
 *
 * Wraps a single route handler so its body runs inside `withTenant(orgId, ...)`.
 * That opens ONE transaction on a dedicated client, sets the per-transaction
 * GUC `app.current_org_id`, and runs the handler inside the AsyncLocalStorage
 * scope so the ambient `pg.query()` / `pg.connect()` route to that tenant
 * client. The RLS policies added in A04-G1 phase 2+ then enforce isolation at
 * the database engine — but ONLY once the operator repoints DATABASE_URL to the
 * non-owner `app_request` role (phase 3). Until that flip the engine connects
 * as the owner, which bypasses RLS, so this wrap sets the GUC to no observable
 * runtime effect. It is exercised today only by the harness
 * (test/isolation/findingsTenantWrap.test.ts simulates the flip via SET ROLE).
 *
 * Design points this implementation pins:
 *
 *   - Opt-in by construction (§4.2). A route is wrapped iff it is explicitly
 *     passed to asTenant(). The no-wrap set (webhooks, health, auth, the admin
 *     operator surface) is handled by simply NOT wrapping — there is no marker
 *     to forget, and a legitimately org-less request can never be accidentally
 *     forced into an org scope.
 *
 *   - Transparent to handler code. The handler is unchanged; it still reads
 *     `req.organizationContext.organizationId` and issues `pg.query(...)`
 *     exactly as before. The wrap only changes which client those queries land
 *     on (the tenant client) and that the whole handler is one transaction.
 *
 *   - No-org fall-through. When no organization context is present the handler
 *     is invoked WITHOUT opening a tenant scope, so it applies its OWN existing
 *     behavior (every org-scoped handler early-returns 403
 *     `organization_context_missing`). We deliberately do NOT short-circuit
 *     with next() or emit a 403 here — that would bypass the handler and change
 *     each route's response contract. No tenant scope is ever opened on this
 *     path.
 *
 *   - Commit/rollback tracks the handler promise. `withTenant` commits when the
 *     handler's returned promise resolves and rolls back when it rejects —
 *     which is the semantics `withTenant` already implements, so the proven
 *     primitive is untouched. Handlers that catch their own errors and send a
 *     5xx (as the findings handlers do) resolve normally, so their request
 *     transaction commits; a handler that throws/rejects is rolled back and the
 *     error is forwarded to Express via next(err).
 *
 *   - Commit-before-respond (PR β1.5). The handler is given a BUFFERING proxy
 *     (deferredResponse.ts) in place of the real `res`. Its `status()`/`json()`
 *     calls are captured, not flushed. Only AFTER `withTenant` resolves — i.e.
 *     after COMMIT succeeds — does the wrap replay the buffered response onto
 *     the real `res`. If COMMIT fails (or the handler throws), the buffer is
 *     discarded and the error is forwarded; because nothing was flushed,
 *     `res.headersSent` is still false and the standard `internalError(res)`
 *     500 path fires. This closes the respond-before-commit window the findings
 *     write wrap (β2) would otherwise open: an acknowledged 2xx can no longer
 *     precede a failed COMMIT. See docs/A04-G1-pr-beta1.5-design.md.
 *
 * Scope guard (PR α): apply ONLY to handlers that are pure within the request
 * transaction — i.e. they do not schedule fire-and-forget work that issues
 * ambient `pg.query()` after the handler returns. Such work (e.g. a not-awaited
 * webhook dispatch on the findings write paths) would run as a continuation
 * that inherits this scope but executes AFTER the wrap has committed and
 * released the client — a use-after-release on the pooled connection. β1 closed
 * this for the webhook dispatcher (pgElevated); the standing rule still holds
 * for any new wrap.
 *
 * Streaming guard (PR β1.5): the buffering proxy can only replay one
 * `status()`+`json()`. A wrapped handler that streams (res.write/pipe/send) or
 * sets headers throws from the proxy — wrap only non-streaming routes.
 */

import type { RequestHandler } from "express";

import { withTenant } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { createDeferredResponse } from "./deferredResponse.js";

/**
 * Wrap `handler` so it runs inside a per-request tenant transaction scope.
 *
 * The returned middleware RETURNS the underlying promise. Express ignores a
 * handler's return value, so this is invisible in production; it exists purely
 * so tests can await the wrap to completion.
 */
export function asTenant(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    const orgId =
      (req as { organizationContext?: { organizationId?: string | null } })
        .organizationContext?.organizationId ?? null;

    // No org context: run the handler unwrapped so its own
    // organization_context_missing behavior applies. Never open a scope, and —
    // since there is no transaction to order against — give it the real `res`
    // directly (no buffering needed). Preserves α's no-org behavior exactly.
    if (!orgId) {
      return Promise.resolve(handler(req, res, next)).catch(next);
    }

    // Has org: buffer the handler's response so it is only flushed AFTER COMMIT
    // succeeds (commit-before-respond, PR β1.5).
    const deferred = createDeferredResponse(res);

    // Distinguish the two ways the wrap can reject (design §3.7):
    //   - the handler itself threw  → ROLLBACK, application-level failure;
    //   - the handler resolved but COMMIT failed → a durability failure.
    // withTenant collapses both into one rejected promise, so we flag a
    // handler-throw at its source. The COMMIT-failure signal (tenant_commit_failed)
    // must stay distinct — it is load-bearing for durability incident response.
    let handlerThrew = false;
    return withTenant(orgId, async () => {
      try {
        return await Promise.resolve(handler(req, deferred.proxy, next));
      } catch (err) {
        handlerThrew = true;
        throw err;
      }
    })
      .then(() => {
        // withTenant resolved → COMMIT succeeded → safe to flush.
        deferred.commit();
      })
      .catch((err: unknown) => {
        // Either the handler threw (ROLLBACK) or COMMIT failed. Nothing was
        // flushed, so res.headersSent is still false and errorHandler can send
        // a clean 500. Discard the buffer and forward the error.
        deferred.discard();
        const event = handlerThrew
          ? "tenant_wrap_handler_failed"
          : "tenant_commit_failed";
        logger.error(
          {
            event,
            err,
            orgId,
            method: req.method,
            path: (req as { originalUrl?: string }).originalUrl ?? req.url,
          },
          handlerThrew
            ? "asTenant wrapped handler threw; transaction rolled back, buffered response discarded"
            : "asTenant tenant transaction COMMIT failed after handler resolved; buffered response discarded"
        );
        next(err);
      });
  };
}
