/**
 * postgres.strictTenantLog.test.ts — M-1 PR-1 deliverable C-2 (DB-free; `pg`
 * and the logger are mocked, so no Postgres is needed).
 *
 * Pins the strict-mode contract of the raw-pool fallback:
 *   1. OFF by default — no logging, behaviour byte-identical.
 *   2. ON: a `pg.query()` outside any tenant scope emits ONE sampled
 *      `db_query_outside_tenant_scope` warning per call site (then every
 *      100th), including the caller frame and the SQL head.
 *   3. ON: a query INSIDE a withTenant/asTenant scope never logs — the wrap
 *      is the fix the log exists to demand.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

const poolQuery = vi.fn().mockResolvedValue({ rows: [] });
const poolConnect = vi.fn().mockResolvedValue({ query: vi.fn(), release: vi.fn() });
const warn = vi.fn();

vi.mock("pg", () => ({
  Pool: class {
    query = poolQuery;
    connect = poolConnect;
    // R1-1 attaches `error` + `acquire` listeners and reads occupancy counters.
    on = vi.fn();
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
}));
vi.mock("../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

type PostgresModule = { pg: Pool };

async function loadPostgres(strict: boolean): Promise<PostgresModule> {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://unit:unit@localhost:5/unit";
  process.env.DATABASE_SSL_DISABLED = "true";
  if (strict) process.env.SECURELOGIC_DB_STRICT_TENANT_LOG = "true";
  else delete process.env.SECURELOGIC_DB_STRICT_TENANT_LOG;
  return import("../postgres.js");
}

afterEach(() => {
  warn.mockClear();
  poolQuery.mockClear();
  delete process.env.SECURELOGIC_DB_STRICT_TENANT_LOG;
});

describe("C-2 — strict-mode db_query_outside_tenant_scope logging", () => {
  it("is OFF by default: bare queries do not log", async () => {
    const { pg } = await loadPostgres(false);
    await pg.query("SELECT 1 FROM findings");
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("ON: logs a bare query once per call site with event, caller, and SQL head", async () => {
    const { pg } = await loadPostgres(true);
    const call = (): unknown => pg.query("SELECT id  FROM findings WHERE x = $1", [1]);
    await call();
    await call(); // same call site → sampled out until the 100th occurrence
    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    const [payload, msg] = warn.mock.calls[0];
    expect(payload.event).toBe("db_query_outside_tenant_scope");
    expect(payload.sqlHead).toBe("SELECT id FROM findings WHERE x = $1");
    expect(payload.occurrences).toBe(1);
    expect(payload.caller).toContain("at ");
    expect(String(msg)).toContain("outside any tenant scope");
  });

  it("ON: also logs a bare pg.connect checkout", async () => {
    const { pg } = await loadPostgres(true);
    await pg.connect();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].sqlHead).toBe("<pg.connect>");
  });

  it("ON: never logs inside an active tenant scope", async () => {
    const mod = await loadPostgres(true);
    const { tenantStorage } = await import("../tenantContext.js");
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    const ctx = {
      client: { query: clientQuery } as never,
      orgId: "org-a",
      savepoint: { n: 0 },
      afterCommit: []
    };
    await tenantStorage.run(ctx, async () => {
      await mod.pg.query("SELECT 1 FROM findings");
    });
    expect(clientQuery).toHaveBeenCalledTimes(1); // routed to the scoped client
    expect(poolQuery).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("ON: extracts the SQL head from a query-config object too", async () => {
    const { pg } = await loadPostgres(true);
    await pg.query({ text: "UPDATE risks SET a = 1" } as never);
    expect(warn.mock.calls[0][0].sqlHead).toBe("UPDATE risks SET a = 1");
  });
});
