/**
 * appRequestGrants.test.ts — M-1 PR-1 deliverable C-3 (the "Option Y" CI
 * assertion promised in 20260618_create_app_request_role.sql).
 *
 * Every table in `public` must either carry at least one app_request grant or
 * be an explicit, justified member of the Tier-D allowlist below. A migration
 * that creates a customer-data table without its GRANT now fails CI instead of
 * becoming a post-flip 42501 in production — the exact defect class the
 * 2026-08-17 census found 17 instances of (fixed by
 * 20261021_m1_g1_app_request_grant_catchup.sql).
 *
 * The allowlist is intentionally the ONLY place a grant-less table can be
 * declared, and it is bidirectional: a table listed here that HAS grants also
 * fails (the allowlist cannot rot into a stale cover). Adding a table here is
 * a reviewable statement that the elevated (owner) channel is its only
 * legitimate access path — see the per-entry justification.
 */

import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

import { bootstrapTestDb } from "./testDb.js";

/** Tier D — tables with deliberately ZERO app_request grants. */
const TIER_D_ALLOWLIST: Record<string, string> = {
  // Original four (20260618_create_app_request_role.sql §Tier D)
  auth_anomaly_alerts: "owner-only authAnomaly elevated scan",
  webhook_events_processed: "system-level webhook idempotency",
  worker_runs: "worker telemetry, elevated-only",
  schema_migrations: "migrate-runner bookkeeping",
  // M1-G1 extension (docs/M1-app-request-flip-design.md Addendum §B; per-table
  // rationale in 20261021_m1_g1_app_request_grant_catchup.sql)
  email_provider_events: "provider-webhook + admin evidence surface, elevated-only (PR-2 moves its BARE sites)",
  feed_health: "pipeline telemetry, elevated-only",
  sources: "source catalog, pipeline-maintained, elevated-only",
  intelligence_event_timeline: "event-workflow internals, elevated-only",
  intelligence_event_workflow_triggers: "event-workflow internals, elevated-only",
  // EMAIL-OBS-1 (20261061_email_sends_observability.sql): the outbound-send
  // ledger that joins provider webhook events back to purpose/org/correlation.
  // Same class as email_provider_events — platform-level, no organization_id
  // (informational column only, no FK), written solely through pgElevated by
  // the email transport and read by the webhook. No app_request grant on
  // purpose: a grant here would be a privilege change smuggled into
  // observability; if a customer-path reader is ever wanted it needs its own
  // reviewed decision.
  email_sends: "outbound-send ledger for webhook correlation, elevated-only (EMAIL-OBS-1)"
};

let pool: Pool;

beforeAll(async () => {
  await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the app_request grants test.");
  pool = new Pool({ connectionString: url, ssl: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

interface GrantRow {
  relname: string;
  grants: string | null;
}

async function grantsByTable(): Promise<Map<string, string[]>> {
  const res = await pool.query<GrantRow>(`
    SELECT c.relname,
           (SELECT string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
              FROM information_schema.role_table_grants g
             WHERE g.table_name = c.relname AND g.grantee = 'app_request') AS grants
    FROM pg_class c
    WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    ORDER BY c.relname`);
  return new Map(res.rows.map(r => [r.relname, r.grants ? r.grants.split(",") : []]));
}

describe("C-3 — app_request grant coverage (Option Y assertion)", () => {
  it("every public table has app_request grants or an explicit Tier-D entry", async () => {
    const grants = await grantsByTable();
    const missing = [...grants.entries()]
      .filter(([table, g]) => g.length === 0 && !(table in TIER_D_ALLOWLIST))
      .map(([table]) => table);
    expect(
      missing,
      `Tables with ZERO app_request grants and no Tier-D allowlist entry: ` +
        `${missing.join(", ")}. Either add the GRANT in the table's migration ` +
        `(Option Y — 20260618_create_app_request_role.sql) or add a justified ` +
        `Tier-D entry in this test.`
    ).toEqual([]);
  });

  it("no Tier-D allowlisted table actually has grants (allowlist cannot rot)", async () => {
    const grants = await grantsByTable();
    const stale = Object.keys(TIER_D_ALLOWLIST).filter(
      table => (grants.get(table) ?? []).length > 0
    );
    expect(
      stale,
      `Allowlisted-as-grantless tables that NOW have app_request grants — ` +
        `remove them from TIER_D_ALLOWLIST: ${stale.join(", ")}`
    ).toEqual([]);
  });

  it("every Tier-D allowlisted table still exists (no orphan entries)", async () => {
    const grants = await grantsByTable();
    // schema_migrations is created by the migrate RUNNER, not by any migration
    // file — bootstrapTestDb applies the SQL directly, so it legitimately does
    // not exist in the harness DB. It does exist in every deployed DB.
    const orphans = Object.keys(TIER_D_ALLOWLIST).filter(
      t => t !== "schema_migrations" && !grants.has(t)
    );
    expect(orphans, `Allowlist entries for dropped tables: ${orphans.join(", ")}`).toEqual([]);
  });

  it("the M1-G1 catch-up tables carry exactly their designed verb sets", async () => {
    const grants = await grantsByTable();
    const expected: Record<string, string[]> = {
      asset_assessments: ["INSERT", "SELECT", "UPDATE"],
      risk_approvals: ["INSERT", "SELECT", "UPDATE"],
      evidence_analysis: ["INSERT", "SELECT"],
      intelligence_brief_item_provenance: ["INSERT", "SELECT"],
      risk_lifecycle_events: ["INSERT", "SELECT"],
      canonical_products: ["SELECT"],
      canonical_product_versions: ["SELECT"],
      canonical_product_external_ids: ["SELECT"],
      // M1-G2: the GDPR exporter reads this category-B table on the tenant
      // channel; the pre-auth write path stays elevated (no write verbs).
      sso_login_codes: ["SELECT"],
      intelligence_events: ["SELECT"],
      intelligence_event_sources: ["SELECT"],
      legal_consents: ["SELECT"]
    };
    for (const [table, verbs] of Object.entries(expected)) {
      expect(grants.get(table), `grants on ${table}`).toEqual(verbs);
    }
  });
});
