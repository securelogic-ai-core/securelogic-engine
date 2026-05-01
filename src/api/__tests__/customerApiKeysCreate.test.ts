import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Pure-shape tests for the customerApiKeys.ts INSERT statement.
 *
 * After the entitlement-on-organizations migration, new api_keys rows must
 * NOT include entitlement_level — entitlement is a property of the
 * organization, not of any individual key. These tests assert the source
 * file does not regress to the old inheritance pattern.
 */

const FILE = resolve(__dirname, "../routes/customerApiKeys.ts");
const SOURCE = readFileSync(FILE, "utf8");

describe("customerApiKeys.ts: POST /api/customer/keys insert shape", () => {
  it("does not SELECT entitlement_level for inheritance", () => {
    // The old bug: SELECT entitlement_level FROM api_keys ... ORDER BY
    // created_at ASC LIMIT 1, then stamp the result onto a new key.
    expect(SOURCE).not.toMatch(/SELECT entitlement_level FROM api_keys/);
    expect(SOURCE).not.toMatch(/ORDER BY created_at ASC LIMIT 1/);
  });

  it("INSERT INTO api_keys does not include entitlement_level column", () => {
    // The INSERT must omit entitlement_level so the column is left NULL on
    // new rows. Legacy rows retain their values.
    const insertMatch = SOURCE.match(
      /INSERT INTO api_keys\s*\n?\s*\(([^)]+)\)/
    );
    expect(insertMatch).not.toBeNull();
    const columns = (insertMatch![1] ?? "").toLowerCase();
    expect(columns).not.toContain("entitlement_level");
  });

  it("RETURNING clause does not surface entitlement_level on new keys", () => {
    // Listing returns api_keys.entitlement_level for display of legacy rows;
    // the create response should not, since new rows are NULL.
    const returningMatch = SOURCE.match(
      /RETURNING id, organization_id, label,([^`]+)/
    );
    expect(returningMatch).not.toBeNull();
    const returning = (returningMatch![1] ?? "").toLowerCase();
    expect(returning).not.toContain("entitlement_level");
  });
});
