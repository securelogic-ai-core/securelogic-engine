import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

// Production (Render) Postgres requires TLS, so SSL is on by default.
// A non-TLS Postgres — the cross-org isolation harness's local/CI Postgres
// (E1-G1) — has no certificate to negotiate; set DATABASE_SSL_DISABLED=true
// in those environments only. Unset (production), behaviour is unchanged.
const sslDisabled =
  process.env.DATABASE_SSL_DISABLED === "true" ||
  process.env.DATABASE_SSL_DISABLED === "1";

export const pg = new Pool({
  connectionString: databaseUrl,
  ssl: sslDisabled ? false : { rejectUnauthorized: false }
});
