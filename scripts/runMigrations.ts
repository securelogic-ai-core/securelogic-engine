import "dotenv/config";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

import {
  applyMigration,
  describeMigrationFailure,
  resolveMigrationTimeouts,
} from "../src/api/lib/migrationRunner.js";

const DATABASE_URL = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    "Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set"
  );
  process.exit(1);
}

// Resolved before the first connection so a malformed duration fails the deploy
// immediately and unmistakably, rather than mid-migration.
const timeouts = resolveMigrationTimeouts();

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const migrationsDir = path.join(process.cwd(), "db", "migrations");

async function ensureMigrationTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const res = await pool.query(
    "SELECT filename FROM schema_migrations ORDER BY filename ASC"
  );

  return new Set(res.rows.map((r) => r.filename as string));
}

async function run() {
  await ensureMigrationTable();

  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(
    `Migration timeouts: lock_timeout=${timeouts.lockTimeout}, ` +
      `statement_timeout=${timeouts.statementTimeout}`
  );

  for (const file of files) {
    if (applied.has(file)) continue;

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");

    const client = await pool.connect();

    try {
      await applyMigration(client, file, sql, timeouts);
      console.log("Applied migration:", file);
    } catch (err) {
      console.error(describeMigrationFailure(file, err, timeouts));
      throw err;
    } finally {
      client.release();
    }
  }

  console.log("Migrations complete");
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
