import { describe, it, expect } from "vitest";
import type { PoolClient } from "pg";
import {
  createSavepointClient,
  isUnrewriteableStatement,
  TenantWrapUnrewriteableStatementError,
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

/* ─────────────────────────────────────────────────────────────────────────
 * A04-G1 PR γ.0 — savepoint-safety guard (Approach B, runtime choke point).
 * See docs/A04-G1-pr-gamma0-design.md §4.1.
 * ───────────────────────────────────────────────────────────────────────── */

describe("createSavepointClient — γ.0 un-rewriteable-statement guard", () => {
  // A1 — synchronous-throw shape (clarification A): throws on call, does NOT
  // return a thenable that later rejects.
  it("throws SYNCHRONOUSLY, not via a rejected promise", () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));

    let returned: unknown;
    expect(() => {
      returned = proxy.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    }).toThrow(TenantWrapUnrewriteableStatementError);
    // The throw happened on call, so nothing was returned and nothing reached
    // the real client.
    expect(returned).toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  // Positive — each forbidden statement throws (cases 1–13).
  const forbiddenStringForms: Array<[string, string]> = [
    ["1: BEGIN ISOLATION LEVEL", "BEGIN ISOLATION LEVEL SERIALIZABLE"],
    ["2: BEGIN; (trailing token)", "BEGIN;"],
    ["3a: BEGIN TRANSACTION", "BEGIN TRANSACTION"],
    ["3b: BEGIN WORK", "BEGIN WORK"],
    ["4a: START TRANSACTION", "START TRANSACTION"],
    ["4b: START TRANSACTION ISO", "START TRANSACTION ISOLATION LEVEL REPEATABLE READ"],
    ["5a: COMMIT AND CHAIN", "COMMIT AND CHAIN"],
    ["5b: COMMIT;", "COMMIT;"],
    ["5c: END", "END"],
    ["6a: ROLLBACK AND CHAIN", "ROLLBACK AND CHAIN"],
    ["6b: ROLLBACK TO SAVEPOINT", "ROLLBACK TO SAVEPOINT sp_1"],
    ["7: SET TRANSACTION ISO (decision 1)", "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE"],
    ["8: SET LOCAL TRANSACTION (decision 1)", "SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE"],
    ["9a: advisory lock", "SELECT pg_advisory_lock(1)"],
    ["9b: advisory xact lock", "SELECT pg_advisory_xact_lock(1)"],
    ["10a: LISTEN", "LISTEN ch"],
    ["10b: NOTIFY", "NOTIFY ch, 'payload'"],
    ["10c: UNLISTEN", "UNLISTEN ch"],
    ["11: COPY", "COPY t FROM STDIN"],
    ["12: multi-statement, forbidden at prefix", "BEGIN ISOLATION LEVEL SERIALIZABLE; SELECT 1"]
  ];

  it.each(forbiddenStringForms)(
    "throws on forbidden string form [%s]",
    (_label, sql) => {
      const fake = makeFakeClient();
      const proxy = createSavepointClient(makeCtx(fake.client));
      expect(() => proxy.query(sql as never)).toThrow(
        TenantWrapUnrewriteableStatementError
      );
      expect(fake.calls).toEqual([]); // never reaches the real client
    }
  );

  // 13: config-object { text } form (clarification B) — guarded identically.
  it("throws on the config-object { text } form", () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    expect(() =>
      proxy.query({ text: "BEGIN ISOLATION LEVEL SERIALIZABLE" } as never)
    ).toThrow(TenantWrapUnrewriteableStatementError);
    expect(fake.calls).toEqual([]);
  });

  // 14: error message names the statement AND points at the escape hatch.
  it("error message names the statement and the escape hatch", () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    try {
      proxy.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TenantWrapUnrewriteableStatementError);
      const msg = (err as Error).message;
      expect(msg).toContain("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
      expect(msg).toContain("tenantContext.ts:44-53");
    }
  });

  // Negative — must NOT throw (behaviour preserved).
  // 15: bare control still rewrites and does not throw.
  it("does NOT throw on bare BEGIN/COMMIT/ROLLBACK (still rewrites)", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    await proxy.query("BEGIN");
    await proxy.query("COMMIT");
    expect(fake.calls).toEqual(["SAVEPOINT sp_1", "RELEASE SAVEPOINT sp_1"]);
  });

  // 16: ordinary SQL passes through.
  it("does NOT throw on ordinary / parameterised SQL", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    await proxy.query("SELECT 1");
    await proxy.query("SELECT * FROM findings WHERE id = $1" as never, ["x"] as never);
    expect(fake.calls).toEqual([
      "SELECT 1",
      "SELECT * FROM findings WHERE id = $1"
    ]);
  });

  // 17: forbidden token only as literal data / column name — anchoring proof.
  it("does NOT throw on forbidden tokens as data / column names", async () => {
    const fake = makeFakeClient();
    const proxy = createSavepointClient(makeCtx(fake.client));
    await proxy.query("SELECT 'BEGIN'");
    await proxy.query("UPDATE risks SET begin_at = now()");
    await proxy.query("SET LOCAL app.current_org_id = 'org-A'");
    expect(fake.calls).toEqual([
      "SELECT 'BEGIN'",
      "UPDATE risks SET begin_at = now()",
      "SET LOCAL app.current_org_id = 'org-A'"
    ]);
  });

  // 18: helper-deep proof + savepoint-stack assertion (clarification E).
  // Invoke the proxy from a fake helper (not a route handler) AFTER a real
  // savepoint is open; assert the guard throws AND leaves the savepoint
  // accounting untouched.
  it("catches helper-deep statements and leaves the savepoint stack intact", async () => {
    const fake = makeFakeClient();
    const ctx = makeCtx(fake.client);
    const proxy = createSavepointClient(ctx);

    // Open a real savepoint first (simulates the handler's own BEGIN).
    await proxy.query("BEGIN");
    expect(ctx.savepoint.n).toBe(1);
    expect(fake.calls).toEqual(["SAVEPOINT sp_1"]);

    // A "helper" deep in the call stack issues a forbidden statement.
    const fakeHelper = (client: typeof proxy) =>
      client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");

    expect(() => fakeHelper(proxy)).toThrow(
      TenantWrapUnrewriteableStatementError
    );

    // Stack accounting unchanged: no extra savepoint counter bump, and no
    // SAVEPOINT/RELEASE/ROLLBACK-TO emitted by the throwing call.
    expect(ctx.savepoint.n).toBe(1);
    expect(fake.calls).toEqual(["SAVEPOINT sp_1"]);
  });
});

describe("isUnrewriteableStatement — matcher unit", () => {
  it.each([
    "BEGIN ISOLATION LEVEL SERIALIZABLE",
    "BEGIN;",
    "BEGIN TRANSACTION",
    "START TRANSACTION",
    "SET TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    "SET LOCAL TRANSACTION ISOLATION LEVEL SERIALIZABLE",
    "END",
    "COMMIT AND CHAIN",
    "ROLLBACK TO SAVEPOINT SP_1",
    "SELECT PG_ADVISORY_LOCK(1)",
    "LISTEN CH",
    "NOTIFY CH",
    "COPY T FROM STDIN"
  ])("flags %s", (kw) => {
    expect(isUnrewriteableStatement(kw)).toBe(true);
  });

  it.each([
    "BEGIN",
    "COMMIT",
    "ROLLBACK",
    "SELECT 1",
    "SELECT 'BEGIN'",
    "UPDATE RISKS SET BEGIN_AT = NOW()",
    "SET LOCAL APP.CURRENT_ORG_ID = 'ORG-A'",
    "INSERT INTO FINDINGS (ID) VALUES ($1)"
  ])("does not flag %s", (kw) => {
    expect(isUnrewriteableStatement(kw)).toBe(false);
  });
});
