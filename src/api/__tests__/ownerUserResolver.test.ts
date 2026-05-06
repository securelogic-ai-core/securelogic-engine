import { describe, it, expect } from "vitest";
import { resolveOwnerUserSameOrg } from "../lib/ownerUserResolver.js";

// Mock query runner that returns a scripted result. Captures the SQL
// and params for assertions about same-org filtering.
function mockClient(rows: Array<{ name: string | null }>) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  return {
    calls,
    runner: {
      query: async <T>(sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        return {
          rows: rows as T[],
          rowCount: rows.length,
        };
      },
    },
  };
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const USER_IN_ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("resolveOwnerUserSameOrg", () => {
  it("returns the user's name when same-org user exists", async () => {
    const { runner } = mockClient([{ name: "Alice Chen" }]);
    const result = await resolveOwnerUserSameOrg(runner, USER_IN_ORG_A, ORG_A);
    expect(result).toEqual({ name: "Alice Chen" });
  });

  it("returns error when no row matches (cross-org or missing user)", async () => {
    const { runner } = mockClient([]);
    const result = await resolveOwnerUserSameOrg(runner, USER_IN_ORG_A, ORG_A);
    expect(result).toEqual({ error: "owner_user_not_in_organization" });
  });

  it("filters by both user id and organization id", async () => {
    const { runner, calls } = mockClient([{ name: "Alice" }]);
    await resolveOwnerUserSameOrg(runner, USER_IN_ORG_A, ORG_A);
    expect(calls.length).toBe(1);
    expect(calls[0]!.params).toEqual([USER_IN_ORG_A, ORG_A]);
    // Same-org guarantee depends on the WHERE clause containing both
    // id and organization_id parameters; if a future refactor drops
    // the org check this assertion fails.
    expect(calls[0]!.sql).toMatch(/organization_id\s*=\s*\$2/);
  });

  it("excludes inactive users (the SQL filters status != 'inactive')", async () => {
    const { runner, calls } = mockClient([{ name: "Bob" }]);
    await resolveOwnerUserSameOrg(runner, USER_IN_ORG_A, ORG_A);
    expect(calls[0]!.sql).toMatch(/status\s*!=\s*'inactive'/);
  });

  it("falls back to 'Unknown' for null/empty user names", async () => {
    const { runner } = mockClient([{ name: null }]);
    const result = await resolveOwnerUserSameOrg(runner, USER_IN_ORG_A, ORG_A);
    expect(result).toEqual({ name: "Unknown" });
  });
});
