import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import {
  createSavepointClient,
  requireTenantContext,
  currentTenantContext,
  tenantStorage,
  type TenantContext
} from "../infra/tenantContext.js";

/** Records every statement issued to the underlying client. */
function makeFakeClient() {
  const calls: string[] = [];
  let releaseCount = 0;
  const client = {
    query(arg: unknown): Promise<unknown> {
      calls.push(typeof arg === "string" ? arg : JSON.stringify(arg));
      return Promise.resolve({ command: "", rowCount: 0, oid: 0, fields: [], rows: [] });
    },
    release(): void {
      releaseCount += 1;
    }
  };
  return {
    client: client as unknown as PoolClient,
    calls,
    releaseCount: () => releaseCount
  };
}

function makeCtx(client: PoolClient): TenantContext {
  return { client, orgId: "org-A", savepoint: { n: 0 } };
}

describe("createSavepointClient — transaction-control rewriting", () => {
  it("rewrites nested BEGIN/COMMIT to SAVEPOINT/RELEASE with unique names", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    await proxy.query("BEGIN");
    await proxy.query("BEGIN");
    await proxy.query("COMMIT");
    await proxy.query("COMMIT");

    expect(fake.calls).toEqual([
      "SAVEPOINT sp_1",
      "SAVEPOINT sp_2",
      "RELEASE SAVEPOINT sp_2",
      "RELEASE SAVEPOINT sp_1"
    ]);
  });

  it("rewrites ROLLBACK to ROLLBACK-TO + RELEASE, then continues normally", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    await proxy.query("BEGIN");
    await proxy.query("ROLLBACK");
    await proxy.query("SELECT 1");

    expect(fake.calls).toEqual([
      "SAVEPOINT sp_1",
      "ROLLBACK TO SAVEPOINT sp_1",
      "RELEASE SAVEPOINT sp_1",
      "SELECT 1"
    ]);
  });

  it("rewrites the config-object form { text: 'BEGIN' }", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    await proxy.query({ text: "BEGIN" } as never);

    expect(fake.calls).toEqual(["SAVEPOINT sp_1"]);
  });

  it("no-ops a mismatched COMMIT — never touches the ambient transaction", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    await proxy.query("COMMIT");

    expect(fake.calls).toEqual([]);
  });

  it("passes cursors / Submittable objects through untouched", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    const cursor = { submit: () => {} };

    await proxy.query(cursor as never);

    expect(fake.calls).toEqual([JSON.stringify(cursor)]);
  });

  it("passes parameterised queries through untouched", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    await proxy.query("SELECT * FROM findings WHERE id = $1" as never, ["x"] as never);

    expect(fake.calls).toEqual(["SELECT * FROM findings WHERE id = $1"]);
  });

  it("makes release() a no-op on the wrapped client", () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    proxy.release();
    (proxy.release as (e?: Error) => void)(new Error("boom"));

    expect(fake.releaseCount()).toBe(0);
  });
});

describe("requireTenantContext — fail-fast", () => {
  it("throws when no tenant scope is active", () => {
    expect(currentTenantContext()).toBeUndefined();
    expect(() => requireTenantContext()).toThrowError(/no tenant context in scope/);
  });

  it("returns the active context inside a scope", () => {
    const fake = makeFakeClient();
    const ctx = makeCtx(fake.client);

    tenantStorage.run(ctx, () => {
      expect(requireTenantContext()).toBe(ctx);
      expect(requireTenantContext().orgId).toBe("org-A");
    });
  });
});
