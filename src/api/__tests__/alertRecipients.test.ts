import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// alertRecipients imports infra/postgres (throws at import without DATABASE_URL).
// Mock it; the allowlist guard throws before any query is reached anyway.
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
}));

import { selectAlertRecipients } from "../lib/alerting/alertRecipients.js";

const SOURCE = readFileSync(
  resolve(__dirname, "../lib/alerting/alertRecipients.ts"),
  "utf8"
);

describe("selectAlertRecipients — preference-column allowlist", () => {
  it("rejects an unknown/unsafe preference column before any query runs", async () => {
    await expect(
      selectAlertRecipients("org-1", "daily_digest; DROP TABLE users")
    ).rejects.toThrow(/unknown preference column/);
  });

  it("rejects an empty column", async () => {
    await expect(selectAlertRecipients("org-1", "")).rejects.toThrow(
      /unknown preference column/
    );
  });

  it("allowlist contains exactly the known preference columns", () => {
    expect(SOURCE).toMatch(/"critical_finding_immediate"/);
    expect(SOURCE).toMatch(/"high_finding_immediate"/);
    expect(SOURCE).toMatch(/"daily_digest"/);
  });
});

describe("selectAlertRecipients — query shape (extracted verbatim from doTrigger)", () => {
  it("filters active, email-verified users in the org", () => {
    expect(SOURCE).toMatch(/u\.organization_id = \$1/);
    expect(SOURCE).toMatch(/u\.status = 'active'/);
    expect(SOURCE).toMatch(/u\.email_verified = TRUE/);
  });

  it("defaults missing preference rows to opted-in via COALESCE", () => {
    expect(SOURCE).toMatch(/COALESCE\(uap\.\$\{prefColumn\}, TRUE\) = TRUE/);
  });

  it("returns user_id, email, organization_name", () => {
    expect(SOURCE).toMatch(/u\.id AS user_id/);
    expect(SOURCE).toMatch(/o\.name AS organization_name/);
  });
});
