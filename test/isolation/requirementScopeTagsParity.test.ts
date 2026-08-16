/**
 * requirementScopeTagsParity.test.ts
 *
 * The scope-tag rules exist TWICE: as SQL in migration 20260926 (so the backfill
 * runs without an application boot) and as TypeScript in
 * `requirementScopeTags.ts` (so requirements created afterwards get tagged).
 *
 * Two implementations of one rule set is a duplication with a real cost, and the
 * cost is exactly this: they can drift, and the symptom of drift is two
 * different questionnaires for the same corpus depending on whether a
 * requirement predates the backfill. Nobody would notice that from either side
 * alone.
 *
 * So this test runs the ACTUAL SQL from the migration file — not a copy — over a
 * fixture corpus, and asserts row by row that it agrees with the module.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import {
  SCOPE_TAG_VOCABULARY,
  deriveScopeTags,
  scopeTagCoverage,
} from "../../src/api/lib/vendorRisk/requirementScopeTags.js";

let seed: TestDbSeed;
let pool: Pool;
let frameworkId: string;

/**
 * Titles chosen to exercise every tag, the multi-tag case, the fallback, and the
 * near-misses that a keyword matcher gets wrong if it is careless.
 */
const FIXTURES: Array<{ reference_id: string; title: string }> = [
  { reference_id: "AC-1", title: "Access Control Policy and Procedures" },
  { reference_id: "AC-2", title: "Account Management and Provisioning" },
  { reference_id: "AC-6", title: "Least Privilege and Privileged Access Review" },
  { reference_id: "AC-5", title: "Separation of Duties" },
  { reference_id: "IA-2", title: "Multi-factor Authentication" },
  { reference_id: "SC-13", title: "Cryptographic Protection and Key Management" },
  { reference_id: "SC-28", title: "Protection of Information at Rest" },
  { reference_id: "MP-6", title: "Media Sanitization and Disposal" },
  { reference_id: "PR-1", title: "Personal Data Processing and Data Subject Rights" },
  { reference_id: "PR-4", title: "Consent Management" },
  { reference_id: "SC-4", title: "Logical Separation of Customer Data" },
  { reference_id: "AU-2", title: "Audit Log Generation and Monitoring" },
  { reference_id: "IR-4", title: "Incident Handling and Breach Notification" },
  { reference_id: "CP-9", title: "System Backup and Disaster Recovery" },
  { reference_id: "CP-2", title: "Business Continuity Plan" },
  { reference_id: "SA-9", title: "External System Services and Third-Party Suppliers" },
  { reference_id: "SA-12", title: "Sub-processor Management" },
  { reference_id: "AI-1", title: "Artificial Intelligence Governance Framework" },
  { reference_id: "AI-4", title: "Model Validation and Bias Testing" },
  { reference_id: "AI-7", title: "Explainability of Automated Decisions" },
  { reference_id: "AI-9", title: "Human Oversight of Model Outputs" },
  { reference_id: "RA-3", title: "Risk Assessment" },
  { reference_id: "AT-2", title: "Security Awareness Training" },
  { reference_id: "RA-5", title: "Vulnerability Scanning and Patch Management" },
  { reference_id: "PM-1", title: "Information Security Program Plan" },
  // Deliberate near-misses and oddities:
  { reference_id: "XX-1", title: "Facilities Signage and Wayfinding" }, // nothing matches → fallback
  { reference_id: "XX-2", title: "Encryption of Personal Data at Rest" }, // multi-tag
  { reference_id: "XX-3", title: "Quarterly Management Review Meeting" }, // no match → fallback
];

/** Pull the backfill statement out of the real migration file. */
function backfillSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const file = resolve(here, "../../db/migrations/20260926_requirement_scope_tags.sql");
  const source = readFileSync(file, "utf8");
  const marker = source.lastIndexOf("WITH derived AS");
  if (marker < 0) throw new Error("Could not locate the backfill statement in migration 20260926");
  return source.slice(marker);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the scope-tag parity test.");
  pool = new Pool({ connectionString: url, ssl: false });

  const fw = await pool.query<{ id: string }>(
    `INSERT INTO frameworks (organization_id, name, version)
     VALUES ($1, 'Scope Tag Parity Framework', '1.0') RETURNING id`,
    [seed.orgA.id]
  );
  frameworkId = fw.rows[0]!.id;

  for (const f of FIXTURES) {
    await pool.query(
      `INSERT INTO requirements (framework_id, reference_id, title, description)
       VALUES ($1, $2, $3, 'Guidance text that mentions encryption and privacy in passing.')`,
      [frameworkId, f.reference_id, f.title]
    );
  }

  // Run the REAL migration statement over the fixtures.
  await pool.query(backfillSql());
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

describe("SQL backfill and TypeScript module agree", () => {
  it("produces identical tags for every fixture", async () => {
    const rows = await pool.query<{ reference_id: string; title: string; scope_tags: string[] }>(
      `SELECT reference_id, title, scope_tags FROM requirements
        WHERE framework_id = $1 ORDER BY reference_id`,
      [frameworkId]
    );
    expect(rows.rowCount).toBe(FIXTURES.length);

    const mismatches: string[] = [];
    for (const row of rows.rows) {
      const expected = deriveScopeTags({
        reference_id: row.reference_id,
        title: row.title,
      }).tags;
      const actual = [...row.scope_tags].sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push(
          `${row.reference_id} "${row.title}"\n    SQL: ${JSON.stringify(actual)}\n    TS : ${JSON.stringify(expected)}`
        );
      }
    }

    expect(
      mismatches,
      `The migration SQL and requirementScopeTags.ts disagree:\n  ${mismatches.join("\n  ")}`
    ).toEqual([]);
  });

  it("the description is NOT matched, by either implementation", async () => {
    // Every fixture's description mentions encryption and privacy. Guidance text
    // is long and mentions adjacent concepts in passing — "this control does not
    // cover encryption" would tag the requirement `encryption`. Titles say what
    // the control IS.
    const row = await pool.query<{ scope_tags: string[] }>(
      `SELECT scope_tags FROM requirements WHERE framework_id = $1 AND reference_id = 'XX-1'`,
      [frameworkId]
    );
    expect(row.rows[0]!.scope_tags).not.toContain("encryption");
    expect(row.rows[0]!.scope_tags).not.toContain("privacy");
  });
});

describe("no requirement is left invisible", () => {
  it("every row carries at least one tag", async () => {
    // An untagged requirement is not "excluded by a rule" — it is absent from
    // every tier below 1, with no reviewer-facing trace at all.
    const untagged = await pool.query(
      `SELECT reference_id FROM requirements
        WHERE framework_id = $1 AND cardinality(scope_tags) = 0`,
      [frameworkId]
    );
    expect(untagged.rows).toEqual([]);
  });

  it("an unmatchable requirement falls back to core rather than vanishing", async () => {
    const row = await pool.query<{ scope_tags: string[] }>(
      `SELECT scope_tags FROM requirements WHERE framework_id = $1 AND reference_id = 'XX-1'`,
      [frameworkId]
    );
    expect(row.rows[0]!.scope_tags).toEqual(["core"]);
    expect(deriveScopeTags({ reference_id: "XX-1", title: "Facilities Signage and Wayfinding" }).fallback_applied).toBe(true);
  });

  it("something is tagged core — otherwise every tier-4 questionnaire is empty", async () => {
    // `core` is the ENTIRE tier-4 baseline. A corpus with nothing tagged core
    // gives every low-risk vendor a blank questionnaire, which looks exactly
    // like a working system producing a fast clean result.
    const core = await pool.query(
      `SELECT count(*)::int AS n FROM requirements
        WHERE framework_id = $1 AND 'core' = ANY(scope_tags)`,
      [frameworkId]
    );
    expect(core.rows[0]!.n).toBeGreaterThan(0);
  });

  it("only vocabulary tags are ever written", async () => {
    const rows = await pool.query<{ tag: string }>(
      `SELECT DISTINCT unnest(scope_tags) AS tag FROM requirements WHERE framework_id = $1`,
      [frameworkId]
    );
    for (const r of rows.rows) {
      expect(SCOPE_TAG_VOCABULARY as readonly string[]).toContain(r.tag);
    }
  });
});

describe("the backfill respects human curation", () => {
  it("never overwrites a curated row, however many times it runs", async () => {
    await pool.query(
      `UPDATE requirements
          SET scope_tags = ARRAY['ai-governance', 'model-risk'],
              scope_tags_source = 'curated'
        WHERE framework_id = $1 AND reference_id = 'AC-1'`,
      [frameworkId]
    );

    await pool.query(backfillSql());
    await pool.query(backfillSql());

    const row = await pool.query<{ scope_tags: string[]; scope_tags_source: string }>(
      `SELECT scope_tags, scope_tags_source FROM requirements
        WHERE framework_id = $1 AND reference_id = 'AC-1'`,
      [frameworkId]
    );
    expect(row.rows[0]!.scope_tags.sort()).toEqual(["ai-governance", "model-risk"]);
    expect(row.rows[0]!.scope_tags_source).toBe("curated");
  });

  it("is idempotent over heuristic rows", async () => {
    const before = await pool.query<{ reference_id: string; scope_tags: string[] }>(
      `SELECT reference_id, scope_tags FROM requirements
        WHERE framework_id = $1 AND scope_tags_source = 'heuristic' ORDER BY reference_id`,
      [frameworkId]
    );
    await pool.query(backfillSql());
    const after = await pool.query<{ reference_id: string; scope_tags: string[] }>(
      `SELECT reference_id, scope_tags FROM requirements
        WHERE framework_id = $1 AND scope_tags_source = 'heuristic' ORDER BY reference_id`,
      [frameworkId]
    );
    expect(after.rows).toEqual(before.rows);
  });

  it("the CHECK rejects a source value outside the two", async () => {
    await expect(
      pool.query(
        `UPDATE requirements SET scope_tags_source = 'guessed'
          WHERE framework_id = $1 AND reference_id = 'AC-2'`,
        [frameworkId]
      )
    ).rejects.toThrow(/requirements_scope_tags_source_check/);
  });
});

describe("coverage reporting", () => {
  it("reports how much of the corpus a human has stood behind", async () => {
    // The real pre-launch readiness question. A corpus that is 100% heuristic is
    // a working system built on keyword matching, and the number should say so
    // rather than the absence of the number implying it is fine.
    const rows = await pool.query<{ tags: string[]; source: string }>(
      `SELECT scope_tags AS tags, scope_tags_source AS source
         FROM requirements WHERE framework_id = $1`,
      [frameworkId]
    );
    const coverage = scopeTagCoverage(rows.rows);

    expect(coverage.total).toBe(FIXTURES.length);
    expect(coverage.untagged).toBe(0);
    expect(coverage.core_tagged).toBeGreaterThan(0);
    // One row was curated above.
    expect(coverage.curated).toBe(1);
    expect(coverage.heuristic).toBe(FIXTURES.length - 1);
  });
});
