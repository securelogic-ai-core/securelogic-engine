/**
 * One-time backfill: update description column on existing requirements rows
 * using the descriptions now defined in frameworkTemplates.ts.
 *
 * Run: npx tsx scripts/backfillRequirementDescriptions.ts
 */

import pg from "pg";
import { FRAMEWORK_TEMPLATES } from "../src/api/lib/frameworkTemplates.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  const client = await pool.connect();
  let totalUpdated = 0;

  try {
    for (const [key, template] of Object.entries(FRAMEWORK_TEMPLATES)) {
      // Find the framework row(s) with this name + version (may be multiple orgs)
      const frameworkResult = await client.query<{ id: string }>(
        `SELECT id FROM frameworks WHERE name = $1 AND version = $2`,
        [template.name, template.version]
      );

      if (frameworkResult.rows.length === 0) {
        console.log(`  [SKIP] ${key} — no framework rows found`);
        continue;
      }

      let frameworkUpdated = 0;

      for (const fw of frameworkResult.rows) {
        for (const req of template.requirements) {
          if (!req.description) continue;

          const result = await client.query(
            `UPDATE requirements
             SET description = $1
             WHERE framework_id = $2
               AND reference_id = $3
               AND (description IS NULL OR description = '')`,
            [req.description, fw.id, req.reference_id]
          );

          frameworkUpdated += result.rowCount ?? 0;
        }
      }

      totalUpdated += frameworkUpdated;
      console.log(`  [OK] ${key} (${template.name}) — ${frameworkUpdated} rows updated`);
    }

    console.log(`\nDone. Total rows updated: ${totalUpdated}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
