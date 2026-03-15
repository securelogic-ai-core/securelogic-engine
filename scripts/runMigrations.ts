import "dotenv/config";
import { Pool } from "pg";
import fs from "fs";
import path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

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

async function applyMigration(filename: string, sql: string) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1)",
      [filename]
    );
    await client.query("COMMIT");
    console.log("Applied migration:", filename);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", filename);
    throw err;
  } finally {
    client.release();
  }
}

async function run() {
  await ensureMigrationTable();

  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, "utf8");

    await applyMigration(file, sql);
  }

  console.log("Migrations complete");
  await pool.end();
}

run().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
