/**
 * assetIdentifierWithdrawal.test.ts — the PLAT-ASSET-1 withdrawal arm against
 * real Postgres with RLS live, over HTTP.
 *
 * What is proven here:
 *   - withdrawal deletes exactly the named claim: the canonical asset stays,
 *     sibling aliases stay, and the act is durably audited (who/when/what);
 *   - cross-tenant withdrawal is 404, indistinguishable from absent, and
 *     another org's identical value never counts toward remaining claims;
 *   - nonexistent and already-withdrawn are the same honest 404, with no
 *     second audit row (idempotent in effect, never in pretense);
 *   - ambiguity is surfaced, never guessed: the response reports
 *     still_ambiguous while competing claims remain, deterministic once one
 *     claim stands, unknown_identifier at zero;
 *   - an auto-created asset's ORIGIN identity is structurally
 *     non-withdrawable (409) — withdrawing it would let the next import
 *     re-create a duplicate asset;
 *   - volatile schemes report not_a_resolution_key — withdrawing evidence
 *     is not disambiguation;
 *   - downstream resolution stops seeing a withdrawn alias: an import that
 *     resolved through it comes back unmatched after withdrawal, and an
 *     ambiguous pair becomes deterministic when one claim is withdrawn;
 *   - the surface is dark (404) while SECURELOGIC_ASSET_AUTO_CREATE_ENABLED
 *     is off.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

async function seedAsset(orgId: string, name: string): Promise<string> {
  const ep = await pool.query<{ id: string }>(
    `INSERT INTO endpoints (organization_id, name) VALUES ($1, $2) RETURNING id`,
    [orgId, name]
  );
  const asset = await pool.query<{ id: string }>(
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
     VALUES ($1, 'endpoint', 'endpoints', $2) RETURNING id`,
    [orgId, ep.rows[0]!.id]
  );
  return asset.rows[0]!.id;
}

async function addIdentifier(
  orgId: string,
  assetId: string,
  scheme: string,
  value: string
): Promise<void> {
  await pool.query(
    `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
     VALUES ($1, $2, $3, $4, 'test')`,
    [orgId, assetId, scheme, value]
  );
}

async function claimCount(orgId: string, scheme: string, value: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM asset_identifiers
      WHERE organization_id = $1 AND scheme = $2 AND value = $3`,
    [orgId, scheme, value]
  );
  return Number(r.rows[0]!.n);
}

async function auditCount(orgId: string, value: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM security_audit_log
      WHERE organization_id = $1
        AND event_type = 'asset_identifier.withdrawn'
        AND payload->>'value' = $2`,
    [orgId, value]
  );
  return Number(r.rows[0]!.n);
}

const withdraw = (key: string, assetId: string, body: Record<string, unknown>) =>
  request(app)
    .post(`/api/assets/${assetId}/identifiers/withdraw`)
    .set("X-Api-Key", key)
    .send(body);

const importScan = (key: string, runId: string, assets: Array<{ scheme: string; value: string }>) =>
  request(app)
    .post("/api/vulnerability-scan-imports")
    .set("X-Api-Key", key)
    .send({
      source_key: "wd-scanner",
      external_run_id: runId,
      scope: { declared: false, assets: [] },
      items: [
        {
          external_ref: "RULE-WD-1",
          title: "withdrawal downstream probe",
          severity_raw: "low",
          assets
        }
      ]
    });

// Org A estate, seeded in beforeAll.
let solo: string; // fqdn solo.wd.test + fqdn keep.wd.test (sibling survives)
let tridents: [string, string, string]; // three-way hostname 'trident' ambiguity
let dupPair: [string, string]; // hostname 'dupwd' pair for the import path
let resolvedAsset: string; // fqdn gone.wd.test — resolves, then is withdrawn
let originAsset: string; // auto-created shape: alias matches asset_origins
let volatileAsset: string; // mac claim
let bTrident: string; // org B's own 'trident' claim — must never count for A

const ORIGIN_ARN = "arn:aws:s3:::wd-origin-bucket";

beforeAll(async () => {
  seed = await bootstrapTestDb();
  pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  const a = seed.orgA.id;
  solo = await seedAsset(a, "wd solo");
  await addIdentifier(a, solo, "fqdn", "solo.wd.test");
  await addIdentifier(a, solo, "fqdn", "keep.wd.test");

  tridents = [
    await seedAsset(a, "wd trident 1"),
    await seedAsset(a, "wd trident 2"),
    await seedAsset(a, "wd trident 3")
  ];
  for (const t of tridents) await addIdentifier(a, t, "hostname", "trident");

  dupPair = [await seedAsset(a, "wd dup 1"), await seedAsset(a, "wd dup 2")];
  for (const d of dupPair) await addIdentifier(a, d, "hostname", "dupwd");

  resolvedAsset = await seedAsset(a, "wd resolved");
  await addIdentifier(a, resolvedAsset, "fqdn", "gone.wd.test");

  // The auto-created shape: the alias AND an asset_origins row carrying the
  // same (scheme, value) — the birth identity, per 20261048.
  originAsset = await seedAsset(a, "wd auto-created");
  await addIdentifier(a, originAsset, "cloud_resource_id", ORIGIN_ARN);
  await pool.query(
    `INSERT INTO asset_origins (organization_id, asset_id, created_via, source_key, scheme, value)
     VALUES ($1, $2, 'scan_import', 'wd-scanner', 'cloud_resource_id', $3)`,
    [a, originAsset, ORIGIN_ARN]
  );

  volatileAsset = await seedAsset(a, "wd volatile");
  await addIdentifier(a, volatileAsset, "mac", "aa:bb:cc:dd:ee:99");

  // Org B claims the SAME hostname value — the cross-tenant counting probe.
  bTrident = await seedAsset(seed.orgB.id, "wd b trident");
  await addIdentifier(seed.orgB.id, bTrident, "hostname", "trident");
}, 180_000);

afterAll(async () => {
  delete process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"];
  delete process.env["SECURELOGIC_VULN_SCAN_INGESTION_ENABLED"];
  await pool?.end();
});

describe("dark by default", () => {
  it("the withdrawal surface 404s while the flag is off", async () => {
    delete process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"];
    const res = await withdraw(seed.orgA.apiKey, solo, {
      scheme: "fqdn",
      value: "solo.wd.test"
    });
    expect(res.status).toBe(404);
    // And nothing was withdrawn.
    expect(await claimCount(seed.orgA.id, "fqdn", "solo.wd.test")).toBe(1);
  });
});

describe("withdrawal (flag on)", () => {
  beforeAll(() => {
    process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"] = "true";
  });

  it("withdraws exactly the named claim: asset survives, sibling alias survives, audit row lands", async () => {
    const res = await withdraw(seed.orgA.apiKey, solo, {
      scheme: "fqdn",
      value: "solo.wd.test"
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      withdrawn: true,
      asset_id: solo,
      scheme: "fqdn",
      value: "solo.wd.test",
      remaining_claim_count: 0,
      resolution_after_withdrawal: "unknown_identifier",
      audit_recorded: true
    });

    // The claim is gone; the sibling claim and the canonical asset are not.
    expect(await claimCount(seed.orgA.id, "fqdn", "solo.wd.test")).toBe(0);
    expect(await claimCount(seed.orgA.id, "fqdn", "keep.wd.test")).toBe(1);
    const asset = await pool.query(`SELECT 1 FROM assets WHERE id = $1`, [solo]);
    expect(asset.rowCount).toBe(1);

    // The durable record: who, what, from which asset, with the row snapshot.
    const audit = await pool.query<{
      resource_id: string;
      actor_api_key_id: string | null;
      payload: {
        scheme: string;
        value: string;
        source: string;
        identifier_id: string;
        remaining_claim_count: number;
        resolution_after_withdrawal: string;
      };
    }>(
      `SELECT resource_id, actor_api_key_id, payload FROM security_audit_log
        WHERE organization_id = $1 AND event_type = 'asset_identifier.withdrawn'
          AND payload->>'value' = 'solo.wd.test'`,
      [seed.orgA.id]
    );
    expect(audit.rowCount).toBe(1);
    const row = audit.rows[0]!;
    expect(row.resource_id).toBe(solo);
    expect(row.actor_api_key_id).not.toBeNull();
    expect(row.payload.scheme).toBe("fqdn");
    expect(row.payload.source).toBe("test");
    expect(row.payload.identifier_id).toBeTruthy();
    expect(row.payload.remaining_claim_count).toBe(0);
    expect(row.payload.resolution_after_withdrawal).toBe("unknown_identifier");
  });

  it("cross-tenant withdrawal is 404 and touches nothing", async () => {
    const res = await withdraw(seed.orgB.apiKey, tridents[0], {
      scheme: "hostname",
      value: "trident"
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("asset_not_found");
    expect(await claimCount(seed.orgA.id, "hostname", "trident")).toBe(3);
    expect(await auditCount(seed.orgB.id, "trident")).toBe(0);
  });

  it("a nonexistent alias is 404 alias_not_found", async () => {
    const res = await withdraw(seed.orgA.apiKey, solo, {
      scheme: "hostname",
      value: "never-claimed"
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("alias_not_found");
  });

  it("withdrawing an already-withdrawn alias is the same 404, with no second audit row", async () => {
    const res = await withdraw(seed.orgA.apiKey, solo, {
      scheme: "fqdn",
      value: "solo.wd.test"
    });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("alias_not_found");
    expect(await auditCount(seed.orgA.id, "solo.wd.test")).toBe(1);
  });

  it("ambiguity is surfaced, never guessed: still_ambiguous → deterministic as claims are withdrawn", async () => {
    // Three A-side claims; org B's identical value must never enter A's count.
    const first = await withdraw(seed.orgA.apiKey, tridents[0], {
      scheme: "hostname",
      value: "trident"
    });
    expect(first.status).toBe(200);
    expect(first.body.remaining_claim_count).toBe(2);
    expect(first.body.resolution_after_withdrawal).toBe("still_ambiguous");

    const second = await withdraw(seed.orgA.apiKey, tridents[1], {
      scheme: "hostname",
      value: "trident"
    });
    expect(second.status).toBe(200);
    expect(second.body.remaining_claim_count).toBe(1);
    expect(second.body.resolution_after_withdrawal).toBe("deterministic");

    // Org B's claim is untouched throughout.
    expect(await claimCount(seed.orgB.id, "hostname", "trident")).toBe(1);
  });

  it("an auto-created asset's origin identity is structurally non-withdrawable (409)", async () => {
    const res = await withdraw(seed.orgA.apiKey, originAsset, {
      scheme: "cloud_resource_id",
      value: ORIGIN_ARN
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("origin_identity_non_withdrawable");
    // Claim, asset and origin row all stand.
    expect(await claimCount(seed.orgA.id, "cloud_resource_id", ORIGIN_ARN)).toBe(1);
    const origin = await pool.query(
      `SELECT 1 FROM asset_origins WHERE organization_id = $1 AND asset_id = $2`,
      [seed.orgA.id, originAsset]
    );
    expect(origin.rowCount).toBe(1);
  });

  it("withdrawing a volatile claim reports not_a_resolution_key — evidence cleanup, not disambiguation", async () => {
    const res = await withdraw(seed.orgA.apiKey, volatileAsset, {
      scheme: "mac",
      value: "aa:bb:cc:dd:ee:99"
    });
    expect(res.status).toBe(200);
    expect(res.body.resolution_after_withdrawal).toBe("not_a_resolution_key");
    expect(await claimCount(seed.orgA.id, "mac", "aa:bb:cc:dd:ee:99")).toBe(0);
  });

  it("an unknown scheme is refused by name", async () => {
    const res = await withdraw(seed.orgA.apiKey, solo, {
      scheme: "url",
      value: "https://x"
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_scheme");
  });
});

describe("downstream resolution stops seeing a withdrawn alias", () => {
  beforeAll(() => {
    process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"] = "true";
    process.env["SECURELOGIC_VULN_SCAN_INGESTION_ENABLED"] = "true";
  });

  it("a resolving fqdn goes unmatched after withdrawal", async () => {
    const before = await importScan(seed.orgA.apiKey, "wd-run-1", [
      { scheme: "fqdn", value: "gone.wd.test" }
    ]);
    expect(before.status).toBe(201);
    expect(before.body.import.occurrencesRecorded).toBe(1);
    expect(before.body.import.unmatchedAssets).toEqual([]);

    const res = await withdraw(seed.orgA.apiKey, resolvedAsset, {
      scheme: "fqdn",
      value: "gone.wd.test"
    });
    expect(res.status).toBe(200);

    const after = await importScan(seed.orgA.apiKey, "wd-run-2", [
      { scheme: "fqdn", value: "gone.wd.test" }
    ]);
    expect(after.status).toBe(201);
    expect(after.body.import.occurrencesRecorded).toBe(0);
    expect(after.body.import.unmatchedAssets).toEqual([
      { scheme: "fqdn", value: "gone.wd.test" }
    ]);
  });

  it("an ambiguous pair becomes deterministic once one claim is withdrawn", async () => {
    const before = await importScan(seed.orgA.apiKey, "wd-run-3", [
      { scheme: "hostname", value: "dupwd" }
    ]);
    expect(before.status).toBe(201);
    expect(before.body.import.occurrencesRecorded).toBe(0);
    expect(before.body.import.ambiguousAssets).toEqual([
      { scheme: "hostname", value: "dupwd", candidate_count: 2 }
    ]);

    const res = await withdraw(seed.orgA.apiKey, dupPair[0], {
      scheme: "hostname",
      value: "dupwd"
    });
    expect(res.status).toBe(200);
    expect(res.body.resolution_after_withdrawal).toBe("deterministic");

    const after = await importScan(seed.orgA.apiKey, "wd-run-4", [
      { scheme: "hostname", value: "dupwd" }
    ]);
    expect(after.status).toBe(201);
    expect(after.body.import.occurrencesRecorded).toBe(1);
    expect(after.body.import.ambiguousAssets).toEqual([]);
    const occ = await pool.query(
      `SELECT 1 FROM finding_asset_occurrences
        WHERE organization_id = $1 AND asset_id = $2`,
      [seed.orgA.id, dupPair[1]]
    );
    expect(occ.rowCount).toBe(1);
  });
});
