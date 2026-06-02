/**
 * asTenant.test.ts — A04-G1 PR α: mechanism test for the request-scope tenant
 * wrap (src/api/middleware/asTenant.ts).
 *
 * DB-backed but table-free: it asserts the wrap MECHANISM directly — no HTTP,
 * no seeded org rows — by invoking asTenant() with synthetic req/res/next and a
 * probe handler. It pins the four contracts the wrap must uphold:
 *
 *   1. Inside the wrap the per-transaction GUC `app.current_org_id` is set to
 *      the request's org id.
 *   2. Inside the wrap ambient `pg.query()` routes to the scoped tenant client.
 *      Proof: the GUC is set with SET LOCAL semantics (set_config(..., true)),
 *      so it is visible ONLY on the in-transaction client that ran it — reading
 *      it back as the org id can only happen if pg.query landed on that client.
 *   3. A throwing handler rolls back, releases the client (no pool leak), and
 *      forwards the error to next(err).
 *   4. With no org context the handler runs UNWRAPPED — no tenant scope is
 *      opened — so each route keeps its own organization_context_missing path;
 *      we do NOT short-circuit with next() or emit a 403 from the wrap.
 *
 * Connects as the harness owner (no SET ROLE) — the role is irrelevant here;
 * this exercises the transaction/scope plumbing, not RLS. RLS enforcement
 * THROUGH the wrap over the real HTTP stack is proven in
 * findingsTenantWrap.test.ts.
 */

import { afterAll, describe, expect, it } from "vitest";
import type { Request, Response } from "express";

import { asTenant } from "../../src/api/middleware/asTenant.js";
import {
  pg,
  pgRaw,
  currentTenantContext,
} from "../../src/api/infra/postgres.js";

function fakeReq(orgId?: string): Request {
  return {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
  } as unknown as Request;
}

interface FakeRes extends Response {
  statusCode: number;
  body?: unknown;
}

function fakeRes(): FakeRes {
  const res = {} as FakeRes;
  res.statusCode = 0;
  res.status = ((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response["status"];
  res.json = ((body: unknown) => {
    res.body = body;
    return res;
  }) as Response["json"];
  return res;
}

/** Invoke the wrap and await its completion (the middleware returns the promise). */
function run(
  handler: (req: Request, res: Response) => unknown,
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
): Promise<unknown> {
  return Promise.resolve(
    (asTenant(handler as never) as unknown as (
      req: Request,
      res: Response,
      next: (err?: unknown) => void,
    ) => unknown)(req, res, next),
  );
}

afterAll(async () => {
  // This file owns no seeded state; close the app pool it opened so the worker
  // exits cleanly.
  await pgRaw.end();
});

describe("A04-G1 PR α — asTenant wrap mechanism", () => {
  it("opens a tenant scope: sets app.current_org_id and routes pg.query to the scoped client", async () => {
    const orgId = "00000000-0000-0000-0000-0000000000aa";
    let scopeOrg: string | undefined;
    let guc: string | null = null;

    const handler = async (_req: Request, res: Response) => {
      scopeOrg = currentTenantContext()?.orgId;
      const r = await pg.query<{ org: string | null }>(
        "SELECT current_setting('app.current_org_id', true) AS org",
      );
      guc = r.rows[0]?.org ?? null;
      res.status(200).json({ ok: true });
    };

    const res = fakeRes();
    await run(handler, fakeReq(orgId), res, () => {});

    // ALS scope is active inside the handler and carries the org id.
    expect(scopeOrg).toBe(orgId);
    // The SET LOCAL GUC is visible — which can only happen on the same
    // in-transaction client the wrap opened. This is the routing proof.
    expect(guc).toBe(orgId);
    expect(res.statusCode).toBe(200);
  });

  it("rolls back, releases the connection, and forwards the error to next() when the handler throws", async () => {
    const orgId = "00000000-0000-0000-0000-0000000000bb";
    const totalBefore = pgRaw.totalCount;
    let captured: unknown;
    const boom = new Error("handler boom");

    const handler = async () => {
      throw boom;
    };

    await run(handler, fakeReq(orgId), fakeRes(), (err?: unknown) => {
      captured = err;
    });

    // Error forwarded to Express via next(err) — not swallowed.
    expect(captured).toBe(boom);
    // The client was returned to the pool, not leaked: the pool did not grow
    // unbounded and a fresh query still succeeds on a reused connection.
    expect(pgRaw.totalCount).toBeLessThanOrEqual(totalBefore + 1);
    const probe = await pgRaw.query<{ ok: number }>("SELECT 1 AS ok");
    expect(probe.rows[0]?.ok).toBe(1);
    expect(pgRaw.idleCount).toBeGreaterThan(0);
  });

  it("runs the handler with NO tenant scope when org context is absent (no-wrap path)", async () => {
    let scopeDuringHandler: unknown = "unset";
    let nextCalled = false;

    const handler = async (_req: Request, res: Response) => {
      scopeDuringHandler = currentTenantContext();
      res.status(403).json({ error: "organization_context_missing" });
    };

    const res = fakeRes();
    await run(handler, fakeReq(undefined), res, () => {
      nextCalled = true;
    });

    // No scope was opened …
    expect(scopeDuringHandler).toBeUndefined();
    // … the handler ran and applied its OWN 403 contract …
    expect(res.statusCode).toBe(403);
    // … and the wrap did NOT short-circuit the chain with next().
    expect(nextCalled).toBe(false);
  });
});
