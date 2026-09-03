/**
 * corpusQueryHygiene.test.ts — VA-S4-4C-3, owner decision 6, the CI half.
 *
 * The decision was explicit that permanent correctness must NOT depend on
 * remembering to exclude a literal organization ID from every real-corpus
 * query. A helper alone does not deliver that: a helper you can forget to call
 * is the same mechanism with an extra step.
 *
 * So this is the tripwire. It fails the build when a literal organization UUID
 * — the synthetic fixture org above all — is hard-coded into application code,
 * and it fails when the tenant-class column is filtered by hand instead of
 * through the one governed helper.
 *
 * It is a HYGIENE gate, not a security gate. Tenant isolation is RLS and
 * organization_id scoping; nothing here substitutes for either.
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SRC = path.join(ROOT, "src");

/** The organization owner decision 6 retains as synthetic fixture material. */
const SYNTHETIC_FIXTURE_ORG = "b1a3da2d-5045-47c6-bd02-dec206c790fe";

/** The one module allowed to name the tenant_class column in a predicate. */
const TENANT_CLASS_OWNER = path.join("lib", "tenantClass.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "__tests__") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const sourceFiles = walk(SRC);

describe("the synthetic fixture organization is never named in code", () => {
  it("no application source hard-codes the fixture organization id", () => {
    const offenders = sourceFiles.filter((f) =>
      readFileSync(f, "utf8").includes(SYNTHETIC_FIXTURE_ORG)
    );
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "Exclude synthetic tenants with realCorpusOrgPredicate() from lib/tenantClass.ts, " +
        "never by naming an organization id. See migration 20261074."
    ).toEqual([]);
  });

  it("no application source hard-codes ANY bare tenant UUID in a SQL string", () => {
    // A literal uuid inside SQL is the shape decision 6 ruled out, whichever
    // tenant it happens to name.
    //
    // The all-zeros NIL uuid is exempt and is NOT a tenant: it is the sentinel
    // inside `COALESCE(engagement_id, ...)` that makes a partial unique index
    // expression total (requirements.ts, vendorPortal.ts, both pre-existing).
    // It names no organization and cannot.
    const NIL = "00000000-0000-0000-0000-000000000000";
    const uuid = /['"]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})['"]::uuid/gi;
    const offenders = sourceFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(uuid)) {
        if (m[1]!.toLowerCase() !== NIL) return true;
      }
      return false;
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});

describe("tenant_class is filtered through the one governed helper", () => {
  it("only lib/tenantClass.ts writes a tenant_class predicate", () => {
    const offenders = sourceFiles.filter((f) => {
      if (f.endsWith(TENANT_CLASS_OWNER)) return false;
      const src = readFileSync(f, "utf8");
      // A hand-written comparison, as opposed to importing the helper.
      return /tenant_class\s*(=|<>|!=|IN)/i.test(src);
    });
    expect(
      offenders.map((f) => path.relative(ROOT, f)),
      "Call realCorpusOrgPredicate() / realCorpusOrgIdPredicate() instead of writing the " +
        "comparison by hand — one governed definition, so a change reaches every caller."
    ).toEqual([]);
  });

  it("the helper module exists and exports the governed predicates", async () => {
    const mod = await import("../lib/tenantClass.js");
    expect(typeof mod.realCorpusOrgPredicate).toBe("function");
    expect(typeof mod.realCorpusOrgIdPredicate).toBe("function");
    expect(typeof mod.isRealCorpus).toBe("function");
  });
});

describe("the migration is the only place a name prefix is read", () => {
  it("no runtime code classifies a tenant by its name", () => {
    // The pre-existing convention — `[SEED]`, `[VALIDATION-`, `[DECOMMISSIONED]`
    // — is read ONCE, in migration 20261074, as a one-time backfill. Runtime
    // reads the column. A name is a label, not a classification.
    const offenders = sourceFiles.filter((f) => {
      const src = readFileSync(f, "utf8");
      return /name\s+LIKE\s+'\[(SEED|VALIDATION|DECOMMISSIONED)/i.test(src);
    });
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([]);
  });
});
