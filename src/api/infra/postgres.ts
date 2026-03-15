import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

export const pg = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});
