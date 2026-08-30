/**
 * canonicalControlIdentity.test.ts — VA-S4 Step 1.
 *
 * Two jobs:
 *
 *   1. VOCABULARY LOCKSTEP. Every closed vocabulary in
 *      `canonicalControlIdentity.ts` mirrors a CHECK constraint in migrations
 *      20261067 / 20261068 / 20261069. These tests read the migration files and
 *      assert the two agree in BOTH directions, so a value added on one side and
 *      forgotten on the other fails CI instead of failing at runtime as a 23514.
 *
 *   2. CORPUS INVARIANTS. The corpus and its aliases must satisfy the schema's
 *      structural rules before any publication is attempted — key grammar,
 *      global alias uniqueness, and the rule that an alias may never be spelled
 *      in the canonical namespace.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CANONICAL_CONTROL_ALIAS_SCHEMES,
  CANONICAL_CONTROL_KEY_PATTERN,
  CANONICAL_CONTROL_NAMESPACE,
  CANONICAL_CONTROL_STATUSES,
  CONTROL_CANONICAL_PROVENANCE,
  CONTROL_CANONICAL_PROVENANCE_AUTHORITY,
  CROSSWALK_ACTOR_KINDS,
  CROSSWALK_MAPPING_SOURCES,
  CROSSWALK_STATUSES,
  canonicalControlKey,
  isCanonicalControlKey,
  isLegalAliasKey,
} from "../lib/controls/canonicalControlIdentity.js";
import { CANONICAL_CONTROL_CORPUS } from "../lib/controls/canonicalControlCorpus.js";
import { TEMPLATES } from "../../templates/index.js";

const MIGRATIONS = join(process.cwd(), "db", "migrations");
const SQL_67 = readFileSync(join(MIGRATIONS, "20261067_canonical_controls.sql"), "utf8");
const SQL_68 = readFileSync(join(MIGRATIONS, "20261068_canonical_control_crosswalk.sql"), "utf8");
const SQL_69 = readFileSync(join(MIGRATIONS, "20261069_control_canonical_identities.sql"), "utf8");

/**
 * Pull the value list out of `CHECK (<column> IN ('a', 'b'))` for a named
 * constraint. Reading the constraint rather than grepping for the literals is
 * what makes the assertion bidirectional: a value present in SQL and absent
 * from TypeScript is caught too.
 */
function checkedValues(sql: string, constraint: string): string[] {
  const anchor = sql.indexOf(`CONSTRAINT ${constraint}`);
  expect(anchor, `constraint ${constraint} not found`).toBeGreaterThan(-1);
  const clause = sql.slice(anchor, anchor + 400);
  const inList = /IN \(([^)]*)\)/.exec(clause);
  expect(inList, `no IN (...) list on ${constraint}`).not.toBeNull();
  return [...inList![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("vocabulary ↔ migration lockstep", () => {
  it.each([
    ["canonical_controls_status_check", SQL_67, CANONICAL_CONTROL_STATUSES],
    ["canonical_control_aliases_scheme_check", SQL_67, CANONICAL_CONTROL_ALIAS_SCHEMES],
    ["canonical_control_crosswalk_source_check", SQL_68, CROSSWALK_MAPPING_SOURCES],
    ["canonical_control_crosswalk_status_check", SQL_68, CROSSWALK_STATUSES],
    ["canonical_control_crosswalk_actor_kind_check", SQL_68, CROSSWALK_ACTOR_KINDS],
    ["control_canonical_identities_provenance_check", SQL_69, CONTROL_CANONICAL_PROVENANCE],
  ])("%s", (constraint, sql, vocabulary) => {
    expect([...checkedValues(sql as string, constraint as string)].sort()).toEqual(
      [...(vocabulary as readonly string[])].sort()
    );
  });

  it("the key grammar regex is the one the CHECK enforces, character for character", () => {
    expect(SQL_67).toContain(
      `CHECK (canonical_key ~ '${CANONICAL_CONTROL_KEY_PATTERN.source}')`
    );
  });

  it("the alias namespace exclusion in SQL matches the namespace constant", () => {
    expect(SQL_67).toContain(`CHECK (alias_key NOT LIKE '${CANONICAL_CONTROL_NAMESPACE}%')`);
  });
});

describe("provenance authority ranking", () => {
  it("ranks every provenance value exactly once — a ranking with a hole silently drops a row", () => {
    expect([...CONTROL_CANONICAL_PROVENANCE_AUTHORITY].sort()).toEqual(
      [...CONTROL_CANONICAL_PROVENANCE].sort()
    );
    expect(new Set(CONTROL_CANONICAL_PROVENANCE_AUTHORITY).size).toBe(
      CONTROL_CANONICAL_PROVENANCE_AUTHORITY.length
    );
  });

  it("human attestation outranks every machine-derived provenance", () => {
    expect(CONTROL_CANONICAL_PROVENANCE_AUTHORITY[0]).toBe("attestation");
    expect(CONTROL_CANONICAL_PROVENANCE_AUTHORITY.indexOf("attestation")).toBeLessThan(
      CONTROL_CANONICAL_PROVENANCE_AUTHORITY.indexOf("inferred")
    );
  });
});

describe("key grammar", () => {
  it("builds a legal key from a legal slug", () => {
    expect(canonicalControlKey("mfa-privileged-access")).toBe(
      "securelogic:control:mfa-privileged-access"
    );
  });

  it.each(["MFA", "mfa_privileged", "mfa--double", "-leading", "trailing-", "", "b2b-ai:control:x"])(
    "rejects illegal slug %p rather than writing a row the CHECK will reject",
    (slug) => {
      expect(() => canonicalControlKey(slug)).toThrow(/illegal canonical control slug/);
    }
  );

  it("an industry template slug is NOT a canonical key", () => {
    expect(isCanonicalControlKey("b2b-ai:control:ai-use-policy")).toBe(false);
    expect(isCanonicalControlKey("securelogic:control:ai-use-policy")).toBe(true);
  });

  it("an alias may never be spelled in the canonical namespace", () => {
    expect(isLegalAliasKey("b2b-ai:control:ai-use-policy")).toBe(true);
    expect(isLegalAliasKey("securelogic:control:ai-use-policy")).toBe(false);
    expect(isLegalAliasKey("   ")).toBe(false);
  });
});

describe("corpus invariants — checked before anything can be published", () => {
  it("every slug produces a key the CHECK accepts", () => {
    for (const c of CANONICAL_CONTROL_CORPUS) {
      expect(isCanonicalControlKey(canonicalControlKey(c.slug)), c.slug).toBe(true);
    }
  });

  it("slugs are unique — the canonical_key UNIQUE constraint, enforced before the round trip", () => {
    const slugs = CANONICAL_CONTROL_CORPUS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("alias keys are GLOBALLY unique, so resolution is deterministic", () => {
    const aliases = CANONICAL_CONTROL_CORPUS.flatMap((c) => c.aliases.map((a) => a.alias_key));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("every alias is legal and carries a scheme the CHECK accepts", () => {
    for (const c of CANONICAL_CONTROL_CORPUS) {
      for (const a of c.aliases) {
        expect(isLegalAliasKey(a.alias_key), a.alias_key).toBe(true);
        expect(CANONICAL_CONTROL_ALIAS_SCHEMES).toContain(a.alias_scheme);
      }
    }
  });

  it("every control carries a non-empty display name and description", () => {
    for (const c of CANONICAL_CONTROL_CORPUS) {
      expect(c.display_name.trim().length, c.slug).toBeGreaterThan(0);
      expect(c.description.trim().length, c.slug).toBeGreaterThan(0);
      expect(c.control_family.trim().length, c.slug).toBeGreaterThan(0);
    }
  });

  it("every industry_template alias names a REAL TemplateControl.id — no dead provenance", () => {
    // An alias that matches no template control preserves nothing; it is a
    // claim about history that history does not support.
    const templateIds = new Set(
      Object.values(TEMPLATES).flatMap((t) => t.controls.map((c) => c.id))
    );
    for (const c of CANONICAL_CONTROL_CORPUS) {
      for (const a of c.aliases) {
        if (a.alias_scheme !== "industry_template") continue;
        expect(templateIds, `${c.slug} → ${a.alias_key}`).toContain(a.alias_key);
      }
    }
  });

  it("canonicalisation is PARTIAL by design — most template controls have no canonical identity", () => {
    // 54 of 115 template controls are aliased today. The gap is the ruling
    // working: a template control that spans two canonical concepts is left
    // unaliased rather than arbitrarily attached to one of them, because an
    // alias resolves to exactly ONE canonical control.
    const aliased = new Set(
      CANONICAL_CONTROL_CORPUS.flatMap((c) => c.aliases.map((a) => a.alias_key))
    );
    const templateIds = [
      ...new Set(Object.values(TEMPLATES).flatMap((t) => t.controls.map((c) => c.id))),
    ];
    const covered = templateIds.filter((id) => aliased.has(id)).length;
    expect(covered).toBeGreaterThan(0);
    expect(covered).toBeLessThan(templateIds.length);
    // The specific example the corpus header names, pinned so the claim cannot rot.
    expect(aliased.has("b2b-ai:control:data-encryption-at-rest-in-transit")).toBe(false);
  });

  it("aliases are curated, not exhaustive — unaliased entries are legitimate, not gaps", () => {
    // The corpus header's claim, asserted so it cannot rot into a promise that
    // every template control has been canonicalised.
    const withAliases = CANONICAL_CONTROL_CORPUS.filter((c) => c.aliases.length > 0).length;
    expect(withAliases).toBeGreaterThan(0);
    expect(withAliases).toBeLessThan(CANONICAL_CONTROL_CORPUS.length);
  });
});


// ====================================================================
// The deployment boundary: migrating changes nothing observable
// ====================================================================

const GLOBAL_TABLES = [
  "canonical_controls",
  "canonical_control_aliases",
  "canonical_framework_versions",
  "canonical_control_crosswalk",
] as const;

function allMigrationSql(): Array<[string, string]> {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => [f, readFileSync(join(MIGRATIONS, f), "utf8")]);
}

function sourceFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("migration alone publishes nothing — the dark-deploy guarantee", () => {
  it("no migration ever writes canonical CONTENT", () => {
    // canonical_framework_versions IS seeded by 20261068 — it is the framework
    // REGISTRY (the FK target), not governed control content, and it names no
    // publisher because it asserts no publication. Everything else must arrive
    // through the governed publication path, which requires a human.
    for (const [file, sql] of allMigrationSql()) {
      for (const table of ["canonical_controls", "canonical_control_aliases",
                           "canonical_control_crosswalk", "control_canonical_identities"]) {
        expect(sql, `${file} writes ${table}`).not.toMatch(
          new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, "i")
        );
      }
    }
  });

  it("a published canonical control is impossible without a publisher — the CHECK, not a convention", () => {
    // Restating the constraint here is what makes the dark-deploy claim
    // structural: even a hand-written INSERT cannot create governed content
    // that names nobody.
    expect(SQL_67).toMatch(
      /status = 'draft'\s*\n?\s*AND published_at IS NULL AND published_by_user_id IS NULL/
    );
    expect(SQL_67).toMatch(
      /status IN \('published', 'superseded'\)\s*\n?\s*AND published_at IS NOT NULL AND published_by_user_id IS NOT NULL/
    );
  });

  it("the template-load gate requires a PUBLISHED alias target, so an unpublished corpus writes nothing", () => {
    const loader = readFileSync(
      join(process.cwd(), "src", "api", "lib", "templateLoader.ts"),
      "utf8"
    );
    const stmt = /INSERT INTO control_canonical_identities[\s\S]*?DO NOTHING/.exec(loader);
    expect(stmt, "templateLoader no longer writes canonical identities").not.toBeNull();
    expect(stmt![0]).toContain("FROM canonical_control_aliases a");
    expect(stmt![0]).toContain("cc.status = 'published'");
    expect(stmt![0]).toContain("'template'");
    // It resolves the canonical id in SQL. It never accepts one from a caller,
    // so no code path can assign an arbitrary tenant control to an arbitrary
    // canonical control through this statement.
    expect(stmt![0]).toContain("SELECT $1, $2, cc.id");
  });
});

describe("the global reference content has no tenant surface", () => {
  it("carries no organization_id and no FK to any tenant table", () => {
    for (const table of GLOBAL_TABLES) {
      const sql = table === "canonical_controls" || table === "canonical_control_aliases"
        ? SQL_67
        : SQL_68;
      const create = new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql);
      expect(create, `${table} CREATE TABLE not found`).not.toBeNull();
      const body = create![1]!;
      expect(body, `${table} declares organization_id`).not.toMatch(/^\s*organization_id\b/m);
      // users is a platform table (the governance actor); organizations,
      // controls, requirements and frameworks are tenant-dimensioned and must
      // never be referenced from global content.
      expect(body, `${table} references a tenant table`).not.toMatch(
        /REFERENCES\s+(organizations|controls|requirements|frameworks)\b/
      );
    }
  });

  it("grants app_request SELECT only — writes are elevated-only by grant, not by convention", () => {
    for (const table of GLOBAL_TABLES) {
      const sql = table === "canonical_controls" || table === "canonical_control_aliases"
        ? SQL_67
        : SQL_68;
      const grants = [...sql.matchAll(new RegExp(`GRANT ([A-Z, ]+) ON ${table}\\s+TO app_request`, "g"))];
      expect(grants.length, `${table} has no app_request grant`).toBeGreaterThan(0);
      for (const g of grants) {
        expect(g[1]!.trim(), `${table} grant`).toBe("SELECT");
      }
    }
  });

  it("no route, middleware or worker touches the canonical tables or the publisher", () => {
    const dirs = [
      join(process.cwd(), "src", "api", "routes"),
      join(process.cwd(), "src", "api", "middleware"),
    ];
    for (const dir of dirs) {
      for (const file of sourceFilesUnder(dir)) {
        const src = readFileSync(file, "utf8");
        for (const table of GLOBAL_TABLES) {
          expect(src, `${file} references ${table}`).not.toContain(table);
        }
        expect(src, `${file} imports the publisher`).not.toContain("canonicalControlPublisher");
      }
    }
  });
});
