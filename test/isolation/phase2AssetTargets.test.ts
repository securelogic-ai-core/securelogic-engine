/**
 * phase2AssetTargets.test.ts — EAR Phase 2: real-Postgres proof of the
 * chokepoint generalization (20260804_phase2_asset_targets.sql + engine/worker
 * spec-drive).
 *
 * Exit criteria (ARCHITECTURE.md §4 Phase 2), verified end-to-end through the
 * REAL worker (runOneTick → engine → WORM writer):
 *   1. a CONTROL-typed strong match reaches decision 'affected' (rule R1b —
 *      previously structurally impossible, §1.4);
 *   2. an APPLICATION-typed (target_type='asset' + asset_id) strong match
 *      reaches 'affected' WITH a blast radius seeded at its backing entity;
 *   3. golden vendor behavior is covered by the untouched
 *      applicabilityReassessmentWorker.test.ts (kept green, not duplicated).
 * Plus schema assertions: widened CHECKs, asset_id columns + FK, and the
 * signal_asset_links unification view.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";
import { enqueueApplicabilityReassessment } from "../../src/api/lib/applicabilityReassessment.js";
import { runOneTick } from "../../src/api/workers/applicabilityReassessmentWorker.js";
import { backfillAssetRegistry } from "../../src/api/lib/assetRegistrar.js";

const ECL_FLAG = "SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED";
const EAR_FLAG = "SECURELOGIC_ASSET_REGISTRY_ENABLED";

let prevEcl: string | undefined;
let prevEar: string | undefined;
let seed: TestDbSeed;
let pool: Pool;
let controlSignalId: string;
let assetSignalId: string;
let controlId: string;
let appEntityId: string;
let appAssetId: string;
let downstreamEntityId: string;

beforeAll(async () => {
  prevEcl = process.env[ECL_FLAG];
  prevEar = process.env[EAR_FLAG];
  process.env[ECL_FLAG] = "true";
  process.env[EAR_FLAG] = "true";

  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the phase2 asset targets test.");
  pool = new Pool({ connectionString: url });

  // Control target (strong match, no graph presence — the R1b case).
  controlId = (await pool.query<{ id: string }>(
    `INSERT INTO controls (organization_id, name) VALUES ($1, 'Encryption at Rest') RETURNING id`,
    [seed.orgA.id]
  )).rows[0].id;
  controlSignalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "ControlCorp",
    signalType: "breach",
    severity: "High",
    dedup: `p2-control-${crypto.randomUUID()}`
  });
  await pool.query(
    `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, match_reason, match_score)
     VALUES ($1, $2, 'control', $3, 'control_llm_match', 95)`,
    [seed.orgA.id, controlSignalId, controlId]
  );

  // Application target: registered application entity with a downstream edge
  // (asset-typed suggestion → neighborhood seeded at the backing entity).
  appEntityId = (await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name, criticality)
     VALUES ($1, 'application', 'Payments Service', 'critical') RETURNING id`,
    [seed.orgA.id]
  )).rows[0].id;
  downstreamEntityId = (await pool.query<{ id: string }>(
    `INSERT INTO enterprise_entities (organization_id, entity_type, name)
     VALUES ($1, 'data_store', 'Payments DB') RETURNING id`,
    [seed.orgA.id]
  )).rows[0].id;
  await pool.query(
    `INSERT INTO enterprise_relationships (organization_id, from_type, from_id, to_type, to_id, relationship_type)
     VALUES ($1, 'enterprise_entity', $2, 'enterprise_entity', $3, 'stores_data_in')`,
    [seed.orgA.id, appEntityId, downstreamEntityId]
  );
  await backfillAssetRegistry(pool);
  appAssetId = (await pool.query<{ id: string }>(
    `SELECT id FROM assets WHERE organization_id = $1 AND backing_kind = 'enterprise_entities' AND backing_id = $2`,
    [seed.orgA.id, appEntityId]
  )).rows[0].id;

  assetSignalId = await seedCyberSignal(pool, {
    orgId: seed.orgA.id,
    vendor: "Payments Service",
    signalType: "vulnerability",
    severity: "Critical",
    dedup: `p2-asset-${crypto.randomUUID()}`
  });
  await pool.query(
    `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, asset_id, match_reason, match_score)
     VALUES ($1, $2, 'asset', $3, $3, 'asset_name_canonical', 100)`,
    [seed.orgA.id, assetSignalId, appAssetId]
  );
}, 120_000);

afterAll(async () => {
  if (prevEcl === undefined) delete process.env[ECL_FLAG];
  else process.env[ECL_FLAG] = prevEcl;
  if (prevEar === undefined) delete process.env[EAR_FLAG];
  else process.env[EAR_FLAG] = prevEar;
  await pool?.end();
});

describe("EAR Phase 2 — schema (20260804)", () => {
  it("target_type CHECKs admit 'asset' and still reject unknown values", async () => {
    const bogus = pool.query(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, match_reason, match_score)
       VALUES ($1, $2, 'spaceship', $3, 'x', 1)`,
      [seed.orgA.id, controlSignalId, crypto.randomUUID()]
    );
    await expect(bogus).rejects.toThrow(/target_type_chk/);
  });

  it("asset_id FK: deleting the registry row nulls the pointer (never breaks the suggestion)", async () => {
    const tempEntity = (await pool.query<{ id: string }>(
      `INSERT INTO enterprise_entities (organization_id, entity_type, name)
       VALUES ($1, 'application', 'Ephemeral App') RETURNING id`,
      [seed.orgA.id]
    )).rows[0].id;
    await backfillAssetRegistry(pool);
    const tempAsset = (await pool.query<{ id: string }>(
      `SELECT id FROM assets WHERE backing_id = $1`, [tempEntity]
    )).rows[0].id;
    const sugg = (await pool.query<{ id: string }>(
      `INSERT INTO signal_match_suggestions (organization_id, signal_id, target_type, target_id, asset_id, match_reason, match_score)
       VALUES ($1, $2, 'asset', $3, $3, 'asset_name_canonical', 100) RETURNING id`,
      [seed.orgA.id, controlSignalId, tempAsset]
    )).rows[0].id;
    await pool.query(`DELETE FROM assets WHERE id = $1`, [tempAsset]);
    const after = await pool.query(`SELECT asset_id FROM signal_match_suggestions WHERE id = $1`, [sugg]);
    expect(after.rows[0].asset_id).toBeNull();
    await pool.query(`DELETE FROM signal_match_suggestions WHERE id = $1`, [sugg]);
    await pool.query(`DELETE FROM enterprise_entities WHERE id = $1`, [tempEntity]);
  });
});

describe("EAR Phase 2 — exit criteria (real worker end-to-end)", () => {
  it("a control-typed strong match reaches 'affected' via R1b (no blast radius)", async () => {
    const jobId = await enqueueApplicabilityReassessment(pool, seed.orgA.id, {
      type: "signal_changed",
      signal_id: controlSignalId
    });
    expect(jobId).not.toBeNull();
    const processed = await runOneTick({ workerId: "p2-worker-control" });
    expect(processed).toBe(1);

    const assess = await pool.query(
      `SELECT decision, reasoning_steps, asset_id FROM applicability_assessments
        WHERE organization_id = $1 AND signal_id = $2 AND target_type = 'control' AND target_id = $3
        ORDER BY seq DESC LIMIT 1`,
      [seed.orgA.id, controlSignalId, controlId]
    );
    expect(assess.rowCount).toBe(1);
    expect(assess.rows[0].decision).toBe("affected");
    expect(assess.rows[0].asset_id).toBeNull(); // quartet target — no registry pointer
    const steps = assess.rows[0].reasoning_steps as Array<{ rule_id: string }>;
    expect(steps.some((s) => s.rule_id === "R1b_strong_match_non_graph_target")).toBe(true);
  });

  it("an application-typed ('asset') strong match reaches 'affected' WITH blast radius from the backing entity", async () => {
    const jobId = await enqueueApplicabilityReassessment(pool, seed.orgA.id, {
      type: "signal_changed",
      signal_id: assetSignalId
    });
    expect(jobId).not.toBeNull();
    const processed = await runOneTick({ workerId: "p2-worker-asset" });
    expect(processed).toBe(1);

    const assess = await pool.query(
      `SELECT id, decision, asset_id, reasoning_steps FROM applicability_assessments
        WHERE organization_id = $1 AND signal_id = $2 AND target_type = 'asset' AND target_id = $3
        ORDER BY seq DESC LIMIT 1`,
      [seed.orgA.id, assetSignalId, appAssetId]
    );
    expect(assess.rowCount).toBe(1);
    expect(assess.rows[0].decision).toBe("affected");
    expect(assess.rows[0].asset_id).toBe(appAssetId); // EAR-AD-3 pointer persisted

    // Blast radius seeded at the backing entity → reaches the downstream store.
    const radius = await pool.query(
      `SELECT node_type, node_id FROM applicability_affected_entities
        WHERE organization_id = $1 AND assessment_id = $2`,
      [seed.orgA.id, assess.rows[0].id]
    );
    expect(radius.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ node_type: "enterprise_entity", node_id: downstreamEntityId })
      ])
    );
  });
});

describe("EAR Phase 2 — signal_asset_links view", () => {
  it("unifies the typed link tables; vendor arms resolve asset_id; control arms emit NULL", async () => {
    const vendorId = (await pool.query<{ id: string }>(
      `INSERT INTO vendors (organization_id, name) VALUES ($1, 'LinkView Vendor') RETURNING id`,
      [seed.orgA.id]
    )).rows[0].id;
    await backfillAssetRegistry(pool);
    await pool.query(
      `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id) VALUES ($1, $2, $3)`,
      [seed.orgA.id, controlSignalId, vendorId]
    );
    await pool.query(
      `INSERT INTO signal_control_links (organization_id, signal_id, control_id) VALUES ($1, $2, $3)`,
      [seed.orgA.id, controlSignalId, controlId]
    );

    const rows = await pool.query(
      `SELECT target_type, target_id, asset_id FROM signal_asset_links
        WHERE organization_id = $1 AND signal_id = $2 ORDER BY target_type`,
      [seed.orgA.id, controlSignalId]
    );
    expect(rows.rowCount).toBe(2);
    const byType = new Map(rows.rows.map((r) => [r.target_type as string, r]));
    expect(byType.get("vendor")!.target_id).toBe(vendorId);
    expect(byType.get("vendor")!.asset_id).not.toBeNull(); // resolved via registry
    expect(byType.get("control")!.asset_id).toBeNull();    // GRC object, not an asset

    // app_request can read the view (grant + invoker in place).
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_request");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [seed.orgA.id]);
      const r = await client.query(
        `SELECT count(*)::int AS n FROM signal_asset_links WHERE organization_id = $1 AND signal_id = $2`,
        [seed.orgA.id, controlSignalId]
      );
      expect(Number(r.rows[0].n)).toBe(2);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});
