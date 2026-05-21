/**
 * setup.ts — vitest setupFile for the cross-org isolation harness.
 *
 * Runs before the harness test module is imported, so DATABASE_URL is set
 * before src/api/infra/postgres.ts evaluates (it throws at import when
 * DATABASE_URL is unset). The app and the harness share one database:
 * the throwaway TEST_DATABASE_URL.
 */

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

if (testDatabaseUrl) {
  // The application's request-path pool (infra/postgres.ts) reads DATABASE_URL.
  process.env.DATABASE_URL = testDatabaseUrl;
  // The harness Postgres has no TLS — see infra/postgres.ts.
  process.env.DATABASE_SSL_DISABLED = "true";
}

process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
