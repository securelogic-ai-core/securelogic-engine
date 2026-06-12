/**
 * columnProbe.test.ts — information_schema column resolution + per-process cache
 * (the input to the export projection allowlist). Mocked QueryRunner, no DB.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getTableColumns,
  tablesRequiringProjection,
  buildTableColumnsMap,
  resetColumnCache,
} from "../columnProbe";
import type { QueryRunner } from "../types";

beforeEach(() => resetColumnCache());

function runnerReturning(
  columnsByTable: Record<string, string[]>,
  calls: { sql: string; values: unknown[] | undefined }[],
): QueryRunner {
  return async (sql, values) => {
    calls.push({ sql, values });
    const table = String((values ?? [])[0]);
    const cols = columnsByTable[table] ?? [];
    return { rows: cols.map((c) => ({ column_name: c })) };
  };
}

describe("getTableColumns", () => {
  it("returns the column_name list for the bound table (parameterized, public schema)", async () => {
    const calls: { sql: string; values: unknown[] | undefined }[] = [];
    const run = runnerReturning({ users: ["id", "email", "password_hash"] }, calls);

    const cols = await getTableColumns(run, "users");
    expect(cols).toEqual(["id", "email", "password_hash"]);
    expect(calls[0]!.sql).toMatch(/information_schema\.columns/i);
    expect(calls[0]!.sql).toMatch(/table_schema = 'public'/i);
    expect(calls[0]!.values).toEqual(["users"]);
  });

  it("caches per table — a second call does not re-query", async () => {
    const calls: { sql: string; values: unknown[] | undefined }[] = [];
    const run = runnerReturning({ users: ["id"] }, calls);

    await getTableColumns(run, "users");
    await getTableColumns(run, "users");
    expect(calls).toHaveLength(1); // cached
  });
});

describe("tablesRequiringProjection", () => {
  it("lists exactly the tables with a non-empty exportExcludedColumns", () => {
    const tables = tablesRequiringProjection();
    expect(tables).toContain("users");
    expect(tables).toContain("org_invites");
    // a table with no exclusions must not be here
    expect(tables).not.toContain("legal_consents");
  });
});

describe("buildTableColumnsMap", () => {
  it("probes every projection-requiring table once", async () => {
    const calls: { sql: string; values: unknown[] | undefined }[] = [];
    const run = runnerReturning(
      { users: ["id", "password_hash"], org_invites: ["id", "token"] },
      calls,
    );

    const map = await buildTableColumnsMap(run);
    expect(map.users).toEqual(["id", "password_hash"]);
    expect(map.org_invites).toEqual(["id", "token"]);
    // one query per projection-requiring table
    expect(calls).toHaveLength(tablesRequiringProjection().length);
  });
});
