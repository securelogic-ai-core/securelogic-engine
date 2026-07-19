/**
 * tenantContext.afterCommit.test.ts — registration semantics of the post-commit hook
 * (DB-free: tenantContext.ts is pool-free by design, so this needs no Postgres).
 *
 * registerAfterCommit is the transactionally-correct way to defer a side effect (a
 * notification) until AFTER the tenant transaction commits. These pin the registration
 * contract; the actual drain-on-commit / discard-on-rollback behaviour is proven over a
 * real transaction in test/isolation/afterCommitHook.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  registerAfterCommit,
  tenantStorage,
  type TenantContext,
} from "../tenantContext.js";

/** A tenant context whose only field these tests touch is `afterCommit`. */
function fakeCtx(): TenantContext {
  return { client: {} as never, orgId: "org-x", savepoint: { n: 0 }, afterCommit: [] };
}

describe("registerAfterCommit", () => {
  it("QUEUES (does not run) the callback while a tenant scope is active", () => {
    const ctx = fakeCtx();
    const cb = vi.fn();
    tenantStorage.run(ctx, () => {
      registerAfterCommit(cb);
    });
    // Deferred: it is parked on the transaction's queue, to be drained on commit.
    expect(cb).not.toHaveBeenCalled();
    expect(ctx.afterCommit).toHaveLength(1);
    expect(ctx.afterCommit[0]).toBe(cb);
  });

  it("preserves registration order across multiple callbacks", () => {
    const ctx = fakeCtx();
    const a = vi.fn();
    const b = vi.fn();
    tenantStorage.run(ctx, () => {
      registerAfterCommit(a);
      registerAfterCommit(b);
    });
    expect(ctx.afterCommit).toEqual([a, b]);
  });

  it("runs the callback IMMEDIATELY when there is no transaction to wait on", () => {
    // No scope ⇒ nothing to gate on ⇒ the honest equivalent of "already committed".
    const cb = vi.fn();
    registerAfterCommit(cb);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("never throws to the caller when a no-scope callback throws", () => {
    expect(() =>
      registerAfterCommit(() => {
        throw new Error("boom");
      })
    ).not.toThrow();
  });
});
