/**
 * preTenantBootstrapOnly.test.ts — #966 containment guard.
 *
 * The behavioural tests prove the exemption is narrow WHERE IT IS USED. This
 * one proves it is not used anywhere else. Without it, the first engineer who
 * hits `db_query_outside_tenant_scope` on an unrelated path can silence it by
 * copying one line, and the closed allowlist becomes decoration.
 *
 * Source-reading, like the M-1 coverage-matrix and Q2 isolation guards: the
 * assertion is over the repository, not over a running process.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

/** The ONLY modules permitted to call the exemption. */
const SANCTIONED_CALLERS = [
  "src/api/middleware/requireApiKey.ts",
  "src/api/middleware/attachOrganizationContext.ts",
];

/** Where the primitive itself is defined / re-exported / tested. */
const DEFINITION_SITES = [
  "src/api/infra/tenantContext.ts",
  "src/api/infra/postgres.ts",
  "src/api/infra/__tests__/postgres.preTenantBootstrap.test.ts",
  "src/api/infra/__tests__/preTenantBootstrapOnly.test.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("#966 — the pre-tenant bootstrap exemption stays where it was ruled", () => {
  const referencing = walk(SRC)
    .filter((f) => /withPreTenantBootstrap|PRE_TENANT_BOOTSTRAP_REASONS/.test(readFileSync(f, "utf8")))
    .map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/"))
    .sort();

  it("is referenced only by the sanctioned callers and its own definition sites", () => {
    const allowed = new Set([...SANCTIONED_CALLERS, ...DEFINITION_SITES]);
    const unexpected = referencing.filter((f) => !allowed.has(f));
    expect(
      unexpected,
      "A new file calls withPreTenantBootstrap. That is an owner decision (#966 " +
        "ruled the exemption specific to the established API-key bootstrap path), " +
        "not a code-review nit. Add it to PRE_TENANT_BOOTSTRAP_REASONS and to " +
        "SANCTIONED_CALLERS deliberately, or wrap the call in withTenant()."
    ).toEqual([]);
  });

  it("both sanctioned callers still use it (the wraps were not silently dropped)", () => {
    for (const caller of SANCTIONED_CALLERS) expect(referencing).toContain(caller);
  });

  it("the allowlist is a closed set of the six ruled bootstrap sites", async () => {
    const { PRE_TENANT_BOOTSTRAP_REASONS } = await import("../tenantContext.js");
    expect([...PRE_TENANT_BOOTSTRAP_REASONS]).toEqual([
      "api_key_auth.user_identity_lookup",
      "api_key_auth.org_key_lookup",
      "api_key_auth.key_hash_lookup",
      "api_key_auth.key_last_used_update",
      "org_context.entitlement_lookup",
    ]);
  });
});
