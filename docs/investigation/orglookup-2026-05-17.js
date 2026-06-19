/**
 * orglookup-2026-05-17.js
 *
 * PURPOSE
 *   Identify which organization owns the leaked `sl_`-prefixed tenant API key
 *   found in plaintext at /home/node/.claude/history.jsonl line 580 (alongside
 *   the rotated sl_admin_ panel key). Read-only metadata lookup to scope the
 *   rotation — it does NOT revoke or modify anything.
 *
 * WHAT IT DOES
 *   1. Reads line 580 of ~/.claude/history.jsonl and extracts the token
 *      matching the API-key format `sl_` + exactly 32 hex chars. This
 *      structurally excludes the sl_admin_<...> panel key on the same line.
 *   2. Computes sha256(key) hex — the exact scheme api_keys.key_hash uses
 *      (see src/api/middleware/requireApiKey.ts:145).
 *   3. Looks the hash up via a BOUND PARAMETER and joins organizations.
 *   4. Prints ONLY org + key metadata.
 *
 * SECURITY INVARIANTS
 *   - The key value, its sha256 hash, and DATABASE_URL are NEVER printed,
 *     logged, interpolated into SQL, or included in error output.
 *   - The hash reaches Postgres only as a bound param ($1), never in the
 *     SQL string.
 *   - On any failure it aborts with a stage label + error code only.
 *
 * HOW TO RUN
 *   DATABASE_URL must already be present in the environment — exported in a
 *   Render shell for the securelogic-engine service, or sourced into a local
 *   shell. Do NOT type the connection string as a CLI argument or inline it
 *   in the command (project hard rule: never inline credentials in argv).
 *
 *     node docs/investigation/orglookup-2026-05-17.js
 *
 *   Run against PRODUCTION Postgres first. If it prints "NO MATCH", retry
 *   against STAGING. NO MATCH in both => key belonged to a since-deleted org
 *   or a local/throwaway DB.
 *
 *   Requires the `pg` package (already a dependency of the engine — run from
 *   the repo root so node resolves ./node_modules/pg).
 */
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");

function fail(stage, codeOnly) {
  // Deliberately no value interpolation — stage + error code/name only.
  console.error(`ABORTED at: ${stage}${codeOnly ? ` (${codeOnly})` : ""}`);
  process.exit(1);
}

(async () => {
  let hash;
  try {
    const lines = fs
      .readFileSync("/home/node/.claude/history.jsonl", "utf8")
      .split("\n");
    const obj = JSON.parse(lines[579]); // line 580 (0-indexed)
    const display = String(obj.display || "");
    // API-key format only: sl_ + exactly 32 hex chars. This structurally
    // excludes the sl_admin_<...> token (non-hex letters / extra underscore).
    const matches = [...new Set(display.match(/\bsl_[0-9a-f]{32}\b/g) || [])];
    if (matches.length !== 1)
      fail(`key-extract (found ${matches.length} candidates, expected 1)`);
    hash = crypto.createHash("sha256").update(matches[0]).digest("hex");
  } catch (e) {
    fail("read/parse history.jsonl", e.code || e.name);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Render PG; matches existing app TLS posture
  });

  try {
    const { rows } = await pool.query(
      `SELECT k.organization_id, o.name AS org_name, o.slug AS org_slug,
              o.status AS org_status, o.plan AS org_plan,
              k.label, k.status AS key_status, k.created_at,
              k.last_used_at, k.revoked_at, k.expires_at,
              k.created_by_user_id
         FROM api_keys k
         LEFT JOIN organizations o ON o.id = k.organization_id
        WHERE k.key_hash = $1
        LIMIT 1`,
      [hash] // bound param only — hash never enters the SQL string
    );
    if (rows.length === 0) {
      console.log("NO MATCH: no api_keys row for that key in this database.");
    } else {
      console.log(JSON.stringify(rows[0], null, 2));
    }
  } catch (e) {
    fail("db query", e.code || e.name);
  } finally {
    await pool.end();
  }
})();
