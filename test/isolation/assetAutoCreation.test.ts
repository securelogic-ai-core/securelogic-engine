/**
 * assetAutoCreation.test.ts — PLAT-ASSET-1 v1 against real Postgres with RLS
 * live: deterministic auto-creation, the cross-lane bridge, the review queue,
 * and every refusal, proven over HTTP.
 *
 * The vacuous-pass trap applies to the dark tests: they assert
 * creation-attempt-REFUSED (a qualified ARN in the report, zero assets
 * after), not merely an absence nothing tried to violate.
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

const ARN = "arn:aws:ec2:us-east-1:123456789012:instance/i-0plat1asset1";
const ARN_BRIDGE = "arn:aws:s3:::plat-asset-1-bridge-bucket";
const ARM =
  "/subscriptions/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0/resourceGroups/Prod-RG/providers/Microsoft.Compute/virtualMachines/PLAT1-VM";

const post = (key: string) =>
  request(app).post("/api/vulnerability-scan-imports").set("X-Api-Key", key);

function report(
  runId: string,
  assets: Array<{ scheme: string; value: string }>,
  extRef = "RULE-PLAT-1"
): Record<string, unknown> {
  return {
    source_key: "plat-scanner",
    external_run_id: runId,
    scope: { declared: false, assets: [] },
    items: [
      {
        external_ref: extRef,
        title: "PLAT-ASSET-1 probe vulnerability",
        severity_raw: "medium",
        assets
      }
    ]
  };
}

async function cloudResourceCount(orgId: string, externalRef: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM cloud_resources
      WHERE organization_id = $1 AND external_ref = $2`,
    [orgId, externalRef]
  );
  return Number(r.rows[0]!.n);
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  pool = new Pool({ connectionString: url });

  app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  process.env["SECURELOGIC_VULN_SCAN_INGESTION_ENABLED"] = "true";
}, 180_000);

afterAll(async () => {
  delete process.env["SECURELOGIC_VULN_SCAN_INGESTION_ENABLED"];
  delete process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"];
  delete process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"];
  await pool?.end();
});

describe("dark by default — refusal, not absence", () => {
  it("with the auto-create flag unset, a qualified ARN creates NOTHING and queues NOTHING", async () => {
    delete process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"];
    process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] = "true";
    const res = await post(seed.orgA.apiKey).send(
      report("dark-1", [{ scheme: "cloud_resource_id", value: ARN }])
    );
    expect(res.status).toBe(201);
    const s = res.body.import;
    // The ARN was in the report and RESOLUTION ran — the refusal is that it
    // stayed unmatched with zero creations, not that nothing was attempted.
    expect(s.unmatchedAssets).toEqual([{ scheme: "cloud_resource_id", value: ARN }]);
    expect(s.assetsAutoCreated).toBe(0);
    expect(s.reviewsQueued).toBe(0);
    expect(await cloudResourceCount(seed.orgA.id, ARN)).toBe(0);
    const reviews = await pool.query(
      `SELECT 1 FROM asset_resolution_reviews WHERE organization_id = $1`,
      [seed.orgA.id]
    );
    expect(reviews.rowCount).toBe(0);
  });

  it("auto-create WITHOUT the registry flag is still off — the createDetailAsset invariant holds", async () => {
    process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"] = "true";
    delete process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"];
    const res = await post(seed.orgA.apiKey).send(
      report("dark-2", [{ scheme: "cloud_resource_id", value: ARN }])
    );
    expect(res.status).toBe(201);
    expect(res.body.import.assetsAutoCreated).toBe(0);
    expect(await cloudResourceCount(seed.orgA.id, ARN)).toBe(0);
  });

  it("the review-queue surface 404s while the flag is off", async () => {
    delete process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"];
    const res = await request(app)
      .get("/api/asset-resolution-reviews")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(404);
  });
});

describe("automatic creation (both flags on)", () => {
  beforeAll(() => {
    process.env["SECURELOGIC_ASSET_AUTO_CREATE_ENABLED"] = "true";
    process.env["SECURELOGIC_ASSET_REGISTRY_ENABLED"] = "true";
  });

  it("a qualified ARN creates the canonical asset with parsed detail, alias, provenance and an occurrence", async () => {
    const res = await post(seed.orgA.apiKey).send(
      report("auto-1", [{ scheme: "cloud_resource_id", value: ARN }])
    );
    expect(res.status).toBe(201);
    const s = res.body.import;
    expect(s.assetsAutoCreated).toBe(1);
    expect(s.unmatchedAssets).toEqual([]);
    expect(s.occurrencesRecorded).toBe(1);

    const cr = await pool.query<{
      id: string;
      name: string;
      provider: string;
      account_id: string | null;
      region: string | null;
      asset_id: string | null;
    }>(
      `SELECT id, name, provider, account_id, region, asset_id FROM cloud_resources
        WHERE organization_id = $1 AND external_ref = $2`,
      [seed.orgA.id, ARN]
    );
    expect(cr.rowCount).toBe(1);
    const row = cr.rows[0]!;
    expect(row.provider).toBe("aws");
    expect(row.account_id).toBe("123456789012");
    expect(row.region).toBe("us-east-1");
    expect(row.name).toBe("i-0plat1asset1");
    expect(row.asset_id).not.toBeNull();

    const alias = await pool.query<{ source: string }>(
      `SELECT source FROM asset_identifiers
        WHERE organization_id = $1 AND scheme = 'cloud_resource_id' AND value = $2 AND asset_id = $3`,
      [seed.orgA.id, ARN, row.asset_id]
    );
    expect(alias.rowCount).toBe(1);
    expect(alias.rows[0]!.source).toBe("plat-scanner");

    const origin = await pool.query<{
      created_via: string;
      source_key: string;
      external_run_id: string | null;
      scan_run_id: string | null;
      scheme: string;
      value: string;
    }>(
      `SELECT created_via, source_key, external_run_id, scan_run_id, scheme, value
         FROM asset_origins WHERE organization_id = $1 AND asset_id = $2`,
      [seed.orgA.id, row.asset_id]
    );
    expect(origin.rowCount).toBe(1);
    expect(origin.rows[0]!).toMatchObject({
      created_via: "scan_import",
      source_key: "plat-scanner",
      external_run_id: "auto-1",
      scheme: "cloud_resource_id",
      value: ARN
    });
    expect(origin.rows[0]!.scan_run_id).not.toBeNull();
  });

  it("a second import of the same ARN ATTACHES — exactly one asset, ever", async () => {
    const res = await post(seed.orgA.apiKey).send(
      report("auto-2", [{ scheme: "cloud_resource_id", value: ARN }])
    );
    expect(res.status).toBe(201);
    expect(res.body.import.assetsAutoCreated).toBe(0);
    expect(res.body.import.occurrencesRecorded).toBe(1);
    expect(await cloudResourceCount(seed.orgA.id, ARN)).toBe(1);
  });

  it("Azure case variants fold to ONE asset (ARM ids are case-insensitive)", async () => {
    const r1 = await post(seed.orgA.apiKey).send(
      report("auto-arm-1", [{ scheme: "cloud_resource_id", value: ARM }])
    );
    expect(r1.status).toBe(201);
    expect(r1.body.import.assetsAutoCreated).toBe(1);

    const r2 = await post(seed.orgA.apiKey).send(
      report("auto-arm-2", [{ scheme: "cloud_resource_id", value: ARM.toUpperCase().replace("/SUBSCRIPTIONS/", "/subscriptions/") }])
    );
    expect(r2.status).toBe(201);
    expect(r2.body.import.assetsAutoCreated).toBe(0);
    expect(await cloudResourceCount(seed.orgA.id, ARM.toLowerCase())).toBe(1);
  });

  it("the cross-lane bridge: a connector-known external_ref attaches and backfills the alias — no duplicate", async () => {
    // Seed the connector lane's view of the world: a cloud_resources row with
    // the ARN as external_ref, registered in the spine, NO alias row.
    const cr = await pool.query<{ id: string }>(
      `INSERT INTO cloud_resources (organization_id, name, provider, external_ref)
       VALUES ($1, 'bridge bucket', 'aws', $2) RETURNING id`,
      [seed.orgA.id, ARN_BRIDGE]
    );
    const reg = await pool.query<{ id: string }>(
      `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
       VALUES ($1, 'cloud_resource', 'cloud_resources', $2) RETURNING id`,
      [seed.orgA.id, cr.rows[0]!.id]
    );
    await pool.query(`UPDATE cloud_resources SET asset_id = $1 WHERE id = $2`, [
      reg.rows[0]!.id,
      cr.rows[0]!.id
    ]);

    const res = await post(seed.orgA.apiKey).send(
      report("bridge-1", [{ scheme: "cloud_resource_id", value: ARN_BRIDGE }])
    );
    expect(res.status).toBe(201);
    const s = res.body.import;
    expect(s.assetsAutoCreated).toBe(0);
    expect(s.assetsAttachedViaBridge).toBe(1);
    expect(s.occurrencesRecorded).toBe(1);
    expect(await cloudResourceCount(seed.orgA.id, ARN_BRIDGE)).toBe(1);

    // The bridge is crossed once: the alias now exists, pointing at the
    // connector-created asset.
    const alias = await pool.query<{ asset_id: string }>(
      `SELECT asset_id FROM asset_identifiers
        WHERE organization_id = $1 AND scheme = 'cloud_resource_id' AND value = $2`,
      [seed.orgA.id, ARN_BRIDGE]
    );
    expect(alias.rowCount).toBe(1);
    expect(alias.rows[0]!.asset_id).toBe(reg.rows[0]!.id);
  });

  it("an UNQUALIFIED strong claim queues for review and creates nothing", async () => {
    const res = await post(seed.orgA.apiKey).send(
      report("unq-1", [{ scheme: "cloud_resource_id", value: "i-0bare-instance-id" }])
    );
    expect(res.status).toBe(201);
    const s = res.body.import;
    expect(s.assetsAutoCreated).toBe(0);
    expect(s.reviewsQueued).toBe(1);
    expect(s.unmatchedAssets).toEqual([
      { scheme: "cloud_resource_id", value: "i-0bare-instance-id" }
    ]);

    const q = await pool.query<{ kind: string; candidate_asset_ids: string[] }>(
      `SELECT kind, candidate_asset_ids FROM asset_resolution_reviews
        WHERE organization_id = $1 AND value = 'i-0bare-instance-id'`,
      [seed.orgA.id]
    );
    expect(q.rowCount).toBe(1);
    expect(q.rows[0]!.kind).toBe("unqualified_strong");

    // Replay does not flood the queue (pending partial unique).
    const again = await post(seed.orgA.apiKey).send(
      report("unq-2", [{ scheme: "cloud_resource_id", value: "i-0bare-instance-id" }])
    );
    expect(again.status).toBe(201);
    expect(again.body.import.reviewsQueued).toBe(0);
  });

  it("weak-scheme ambiguity queues with its candidates", async () => {
    // Two assets, one hostname — seeded through the same tables the platform
    // uses (the ingestion suite's ambiguity probe, reproduced locally).
    const mk = async (name: string): Promise<string> => {
      const ep = await pool.query<{ id: string }>(
        `INSERT INTO endpoints (organization_id, name) VALUES ($1, $2) RETURNING id`,
        [seed.orgA.id, name]
      );
      const a = await pool.query<{ id: string }>(
        `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id)
         VALUES ($1, 'endpoint', 'endpoints', $2) RETURNING id`,
        [seed.orgA.id, ep.rows[0]!.id]
      );
      await pool.query(
        `INSERT INTO asset_identifiers (organization_id, asset_id, scheme, value, source)
         VALUES ($1, $2, 'hostname', 'plat-dup', 'test')`,
        [seed.orgA.id, a.rows[0]!.id]
      );
      return a.rows[0]!.id;
    };
    const a1 = await mk("plat dup one");
    const a2 = await mk("plat dup two");

    const res = await post(seed.orgA.apiKey).send(
      report("amb-1", [{ scheme: "hostname", value: "plat-dup" }])
    );
    expect(res.status).toBe(201);
    const s = res.body.import;
    expect(s.ambiguousAssets).toEqual([
      { scheme: "hostname", value: "plat-dup", candidate_count: 2 }
    ]);
    expect(s.reviewsQueued).toBe(1);

    const q = await pool.query<{ kind: string; candidate_asset_ids: string[] }>(
      `SELECT kind, candidate_asset_ids FROM asset_resolution_reviews
        WHERE organization_id = $1 AND scheme = 'hostname' AND value = 'plat-dup'`,
      [seed.orgA.id]
    );
    expect(q.rowCount).toBe(1);
    expect(q.rows[0]!.kind).toBe("ambiguous");
    expect([...q.rows[0]!.candidate_asset_ids].sort()).toEqual([a1, a2].sort());
  });

  it("cross-tenant: the same ARN in two orgs is two independent assets, invisible to each other", async () => {
    const res = await post(seed.orgB.apiKey).send(
      report("b-auto-1", [{ scheme: "cloud_resource_id", value: ARN }])
    );
    expect(res.status).toBe(201);
    // Org A already owns an asset for this ARN — org B must NOT see it:
    // resolution finds nothing, creation mints org B's OWN asset.
    expect(res.body.import.assetsAutoCreated).toBe(1);
    expect(await cloudResourceCount(seed.orgA.id, ARN)).toBe(1);
    expect(await cloudResourceCount(seed.orgB.id, ARN)).toBe(1);

    const aliasB = await pool.query<{ asset_id: string }>(
      `SELECT ai.asset_id FROM asset_identifiers ai
        WHERE ai.organization_id = $1 AND ai.scheme = 'cloud_resource_id' AND ai.value = $2`,
      [seed.orgB.id, ARN]
    );
    const aliasA = await pool.query<{ asset_id: string }>(
      `SELECT ai.asset_id FROM asset_identifiers ai
        WHERE ai.organization_id = $1 AND ai.scheme = 'cloud_resource_id' AND ai.value = $2`,
      [seed.orgA.id, ARN]
    );
    expect(aliasB.rows[0]!.asset_id).not.toBe(aliasA.rows[0]!.asset_id);
  });

  it("two CONCURRENT imports of one new ARN create exactly one asset (advisory lock)", async () => {
    const arn = "arn:aws:ec2:eu-west-1:123456789012:instance/i-0concurrent1";
    const [r1, r2] = await Promise.all([
      post(seed.orgA.apiKey).send(report("conc-1", [{ scheme: "cloud_resource_id", value: arn }])),
      post(seed.orgA.apiKey).send(report("conc-2", [{ scheme: "cloud_resource_id", value: arn }]))
    ]);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const created =
      r1.body.import.assetsAutoCreated + r2.body.import.assetsAutoCreated;
    expect(created).toBe(1);
    expect(await cloudResourceCount(seed.orgA.id, arn)).toBe(1);
  });
});

describe("the review queue surface", () => {
  const get = () =>
    request(app).get("/api/asset-resolution-reviews").set("X-Api-Key", seed.orgA.apiKey);

  it("lists pending reviews, org-scoped", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(2); // unqualified + ambiguous
    for (const row of res.body.reviews) {
      expect(row.accepted_at).toBeNull();
      expect(row.dismissed_at).toBeNull();
    }
    // Org B sees none of org A's questions.
    const b = await request(app)
      .get("/api/asset-resolution-reviews")
      .set("X-Api-Key", seed.orgB.apiKey);
    expect(b.status).toBe(200);
    expect(
      (b.body.reviews as Array<{ value: string }>).find((r) => r.value === "plat-dup")
    ).toBeUndefined();
  });

  it("accept attaches the identifier to the chosen asset — deterministic for every future import", async () => {
    const list = await get();
    const review = (list.body.reviews as Array<{
      id: string;
      value: string;
      candidate_asset_ids: string[];
    }>).find((r) => r.value === "plat-dup")!;
    const chosen = review.candidate_asset_ids[0]!;

    const res = await request(app)
      .post(`/api/asset-resolution-reviews/${review.id}/accept`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ asset_id: chosen });
    expect(res.status).toBe(200);
    // Honesty: the OTHER candidate's claim on 'plat-dup' still stands —
    // accepting records the decision without destroying evidence, and the
    // response says the ambiguity is not yet gone.
    expect(res.body.competing_claims_remain).toBe(true);

    // The chosen asset carries the alias (already seeded here — the insert
    // is a no-op under the (org, asset, scheme, value) identity; source is
    // an attribute of the first assertion, not part of identity).
    const alias = await pool.query(
      `SELECT 1 FROM asset_identifiers
        WHERE organization_id = $1 AND asset_id = $2 AND scheme = 'hostname'
          AND value = 'plat-dup'`,
      [seed.orgA.id, chosen]
    );
    expect(alias.rowCount).toBe(1);

    // ...and the row is terminal: a second decision is refused.
    const again = await request(app)
      .post(`/api/asset-resolution-reviews/${review.id}/accept`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ asset_id: chosen });
    expect(again.status).toBe(409);
  });

  it("accept refuses a cross-tenant asset id with 404", async () => {
    const list = await get();
    const review = (list.body.reviews as Array<{ id: string; value: string }>).find(
      (r) => r.value === "i-0bare-instance-id"
    )!;
    const foreign = await pool.query<{ id: string }>(
      `SELECT id FROM assets WHERE organization_id = $1 LIMIT 1`,
      [seed.orgB.id]
    );
    const res = await request(app)
      .post(`/api/asset-resolution-reviews/${review.id}/accept`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ asset_id: foreign.rows[0]!.id });
    expect(res.status).toBe(404);
  });

  it("dismiss is terminal, and a later import may re-ask", async () => {
    const list = await get();
    const review = (list.body.reviews as Array<{ id: string; value: string }>).find(
      (r) => r.value === "i-0bare-instance-id"
    )!;
    const res = await request(app)
      .post(`/api/asset-resolution-reviews/${review.id}/dismiss`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ reason: "scanner noise" });
    expect(res.status).toBe(200);

    // Re-import: the pending partial unique no longer blocks — a NEW pending
    // row appears (dismissal answers one asking, not all future ones).
    const again = await post(seed.orgA.apiKey).send(
      report("unq-3", [{ scheme: "cloud_resource_id", value: "i-0bare-instance-id" }])
    );
    expect(again.status).toBe(201);
    expect(again.body.import.reviewsQueued).toBe(1);
  });
});
