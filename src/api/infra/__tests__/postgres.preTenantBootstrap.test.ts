/**
 * postgres.preTenantBootstrap.test.ts — #966, owner ruling 2026-09-03.
 *
 * The exemption's whole value depends on it staying narrow, so these tests are
 * weighted toward what must STILL fire, not what is now silent:
 *
 *   1. a sanctioned bootstrap query does not warn (the false positive is gone);
 *   2. an unsanctioned bare query STILL warns — the regression proof;
 *   3. a bare query in the same request but OUTSIDE the wrap still warns, so
 *      the scope cannot leak across an await into unrelated work;
 *   4. the tripwire is re-armed the moment the scope exits;
 *   5. `pg.connect()` inside a bootstrap scope still warns — the exemption is
 *      for single queries, never a raw client checkout;
 *   6. an unlisted reason throws instead of quietly opening a new exemption;
 *   7. with strict mode off, behaviour is unchanged either way.
 *
 * DB-free: `pg` and the logger are mocked, exactly as in the sibling
 * strictTenantLog suite this extends.
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
    on = vi.fn();
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }
}));
vi.mock("../logger.js", () => ({ logger: { warn, info: vi.fn(), error: vi.fn() } }));

type PostgresModule = {
  pg: Pool;
  withPreTenantBootstrap: <T>(reason: string, fn: () => T) => T;
};

/**
 * Loads BOTH modules from one fresh registry: postgres.ts reads the strict flag
 * at import time, and the helper must be the same instance the loaded
 * postgres.ts closed over — importing it from a stale registry would test two
 * unrelated AsyncLocalStorages and pass vacuously.
 */
async function loadPostgres(strict: boolean): Promise<PostgresModule> {
  vi.resetModules();
  process.env.DATABASE_URL = "postgres://unit:unit@localhost:5/unit";
  process.env.DATABASE_SSL_DISABLED = "true";
  if (strict) process.env.SECURELOGIC_DB_STRICT_TENANT_LOG = "true";
  else delete process.env.SECURELOGIC_DB_STRICT_TENANT_LOG;
  const { pg } = await import("../postgres.js");
  const { withPreTenantBootstrap } = await import("../tenantContext.js");
  return { pg, withPreTenantBootstrap } as unknown as PostgresModule;
}

afterEach(() => {
  warn.mockClear();
  poolQuery.mockClear();
  poolConnect.mockClear();
  delete process.env.SECURELOGIC_DB_STRICT_TENANT_LOG;
});

describe("#966 — the sanctioned pre-tenant bootstrap path is exempt", () => {
  it("does not warn for an allowlisted bootstrap query, and still runs it", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(true);
    await withPreTenantBootstrap("api_key_auth.key_hash_lookup", () =>
      pg.query("SELECT id, organization_id FROM api_keys WHERE key_hash = $1", ["h"])
    );
    expect(poolQuery).toHaveBeenCalledTimes(1); // the query itself is untouched
    expect(warn).not.toHaveBeenCalled();
  });

  it("exempts every reason in the closed allowlist", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(true);
    const { PRE_TENANT_BOOTSTRAP_REASONS } = await import("../tenantContext.js");
    for (const reason of PRE_TENANT_BOOTSTRAP_REASONS) {
      await withPreTenantBootstrap(reason, () => pg.query("SELECT 1"));
    }
    expect(poolQuery).toHaveBeenCalledTimes(PRE_TENANT_BOOTSTRAP_REASONS.length);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("#966 — everything outside that path still produces the signal", () => {
  it("REGRESSION: an unsanctioned bare query still warns", async () => {
    const { pg } = await loadPostgres(true);
    await pg.query("SELECT id FROM findings WHERE organization_id = $1", ["org-a"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].event).toBe("db_query_outside_tenant_scope");
    expect(warn.mock.calls[0][0].sqlHead).toContain("FROM findings");
  });

  it("REGRESSION: the exemption does not leak to a sibling query outside the wrap", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(true);
    await withPreTenantBootstrap("api_key_auth.user_identity_lookup", () =>
      pg.query("SELECT status FROM users WHERE id = $1", ["u1"])
    );
    // Same request, same tick, one line later — and NOT inside the callback.
    await pg.query("SELECT * FROM vendors");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].sqlHead).toContain("FROM vendors");
  });

  it("REGRESSION: an async continuation after the scope is not exempt", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(true);
    await withPreTenantBootstrap("org_context.entitlement_lookup", () =>
      pg.query("SELECT entitlement_level FROM organizations WHERE id = $1", ["o1"])
    );
    await Promise.resolve();
    await pg.query("SELECT * FROM risks");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].sqlHead).toContain("FROM risks");
  });

  it("REGRESSION: a raw client checkout inside a bootstrap scope STILL warns", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(true);
    await withPreTenantBootstrap("api_key_auth.org_key_lookup", () => pg.connect());
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0].sqlHead).toBe("<pg.connect>");
  });

  it("refuses an unlisted reason instead of opening a new exemption", async () => {
    const { withPreTenantBootstrap } = await loadPostgres(true);
    expect(() =>
      (withPreTenantBootstrap as (r: string, f: () => unknown) => unknown)(
        "reporting.cross_org_rollup",
        () => undefined
      )
    ).toThrow(/not an allowlisted pre-tenant bootstrap reason/);
  });

  it("changes nothing when strict mode is off", async () => {
    const { pg, withPreTenantBootstrap } = await loadPostgres(false);
    await withPreTenantBootstrap("api_key_auth.key_last_used_update", () =>
      pg.query("UPDATE api_keys SET last_used_at = NOW() WHERE id = $1", ["k1"])
    );
    await pg.query("SELECT * FROM findings");
    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
