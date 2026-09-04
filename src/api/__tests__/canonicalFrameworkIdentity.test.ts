/**
 * canonicalFrameworkIdentity.test.ts — VA-S4 Step 1.
 *
 * The framework registry is deliberately written twice: once as SQL in
 * migration 20261068 (which must run without an application boot) and once as a
 * module (which must resolve identities for frameworks created after that
 * migration). Duplication with a cost is only acceptable while a test makes
 * drift fail the build — that test is this one.
 *
 * The consequence of drift is not cosmetic. `framework_key` is half the join
 * from a tenant requirement to the global crosswalk; a key that exists in the
 * module and not in the table fails the FK on the tenant write, and a key that
 * exists in the table and not in the module is a crosswalk nothing can reach.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_FRAMEWORK_KEY_PATTERN,
  CANONICAL_FRAMEWORK_VERSIONS,
  canonicalFrameworkKeyFor,
  isKnownCanonicalFrameworkVersion,
  resolveCanonicalFrameworkIdentity,
} from "../lib/controls/canonicalFrameworkIdentity.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";
import { FRAMEWORK_REFS } from "../../templates/index.js";

const SQL_68 = readFileSync(
  join(process.cwd(), "db", "migrations", "20261068_canonical_control_crosswalk.sql"),
  "utf8"
);

const SQL_88 = readFileSync(
  join(process.cwd(), "db", "migrations", "20261088_core_assurance_composition.sql"),
  "utf8"
);

function registryBlock(sql: string): Array<[string, string, string]> {
  const start = sql.indexOf("INSERT INTO canonical_framework_versions");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("ON CONFLICT (framework_key, framework_version)", start);
  const block = sql.slice(start, end);
  return [...block.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => [
    m[1]!,
    m[2]!,
    m[3]!,
  ]);
}

/**
 * The seeded registry, read out of every migration that seeds it: 20261068
 * (the original eighteen) and 20261088 (Assessment Composition v1's Core
 * Assurance Set).
 */
function seededRegistry(): Array<[string, string, string]> {
  return [...registryBlock(SQL_68), ...registryBlock(SQL_88)];
}

describe("module ↔ migration 20261068 registry lockstep", () => {
  it("holds exactly the same (key, version, display) triples, in both directions", () => {
    const fromSql = seededRegistry()
      .map((t) => t.join("|"))
      .sort();
    const fromModule = CANONICAL_FRAMEWORK_VERSIONS.map(
      (f) => `${f.framework_key}|${f.framework_version}|${f.display_name}`
    ).sort();
    expect(fromModule).toEqual(fromSql);
  });

  it("the key grammar regex is the one the CHECK enforces", () => {
    expect(SQL_68).toContain(
      `CHECK (framework_key ~ '${CANONICAL_FRAMEWORK_KEY_PATTERN.source}')`
    );
  });

  it("every key in the registry satisfies that grammar", () => {
    for (const f of CANONICAL_FRAMEWORK_VERSIONS) {
      expect(CANONICAL_FRAMEWORK_KEY_PATTERN.test(f.framework_key), f.framework_key).toBe(true);
    }
  });

  it("(key, version) is unique — it is the FK target the tenant row points at", () => {
    const pairs = CANONICAL_FRAMEWORK_VERSIONS.map((f) => `${f.framework_key}|${f.framework_version}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it("(display_name, version) is unique — resolution from a tenant row must be deterministic", () => {
    const pairs = CANONICAL_FRAMEWORK_VERSIONS.map((f) => `${f.display_name}|${f.framework_version}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});

describe("both write paths resolve — the point of the whole exercise", () => {
  it("every FRAMEWORK_TEMPLATES entry (POST /api/frameworks/activate) resolves to a key", () => {
    for (const [id, t] of Object.entries(FRAMEWORK_TEMPLATES)) {
      expect(canonicalFrameworkKeyFor(t.name, t.version), id).not.toBeNull();
    }
  });

  it("every FRAMEWORK_REFS entry (templateLoader) resolves to a key", () => {
    for (const [ref, f] of Object.entries(FRAMEWORK_REFS)) {
      expect(canonicalFrameworkKeyFor(f.name, f.version), ref).not.toBeNull();
    }
  });

  it("a resolved key names a registry row the FK will accept", () => {
    for (const t of Object.values(FRAMEWORK_TEMPLATES)) {
      const key = canonicalFrameworkKeyFor(t.name, t.version)!;
      expect(isKnownCanonicalFrameworkVersion(key, t.version)).toBe(true);
    }
  });
});

describe("resolution is exact, and null is an answer", () => {
  it("a version this codebase does not write does not resolve — a near-match is a WRONG identity", () => {
    expect(resolveCanonicalFrameworkIdentity("NIST Cybersecurity Framework", "1.0")).toBeNull();
    expect(resolveCanonicalFrameworkIdentity("NIST CSF", "1.1")).toBeNull();
    expect(resolveCanonicalFrameworkIdentity("  NIST Cybersecurity Framework", "1.1")).toBeNull();
  });

  it("a customer-authored framework resolves to null, which is a legitimate state", () => {
    expect(canonicalFrameworkKeyFor("Our Internal Baseline", "1")).toBeNull();
  });

  it("the same display name at two versions resolves to two distinct identities", () => {
    expect(resolveCanonicalFrameworkIdentity("NIST Cybersecurity Framework", "1.1")
      ?.framework_version).toBe("1.1");
    expect(resolveCanonicalFrameworkIdentity("NIST Cybersecurity Framework", "2.0")
      ?.framework_version).toBe("2.0");
    // ...and to the SAME key: a version bump is not a different framework.
    expect(canonicalFrameworkKeyFor("NIST Cybersecurity Framework", "1.1")).toBe(
      canonicalFrameworkKeyFor("NIST Cybersecurity Framework", "2.0")
    );
  });

  it("the key is version-free — fusing the version in is the FRAMEWORK_REFS defect it replaces", () => {
    for (const f of CANONICAL_FRAMEWORK_VERSIONS) {
      expect(f.framework_key, f.framework_key).not.toContain(f.framework_version);
    }
  });
});
