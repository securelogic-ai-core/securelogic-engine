/**
 * enterpriseEntityGetOne.test.ts — regression for the GET-one 500 on staging:
 * the handler's LEFT JOIN to enterprise_data_stores shares the id /
 * organization_id / created_at / updated_at column names with
 * enterprise_entities, so unqualified entity columns made Postgres reject the
 * query as ambiguous (SQLSTATE 42702) for EVERY entity — a parse-time failure
 * the mocked-pg handler suite structurally cannot catch. This runs the real
 * handler SQL against real Postgres, for both join outcomes:
 *   1. an entity WITH a data-store row (join matches, ds columns populated)
 *   2. an entity WITHOUT one (LEFT JOIN misses, ds columns null)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import crypto from "crypto";
import type { Request, Response } from "express";

import { bootstrapTestDb, type TestDbSeed } from "./testDb.js";
import { withTenant } from "../../src/api/infra/postgres.js";
import { getEnterpriseEntity } from "../../src/api/routes/enterpriseEntities.js";

let seed: TestDbSeed;
let pool: Pool;
let entityWithStore: string;
let entityWithoutStore: string;

type CapturedRes = Response & { _status: number; _json: unknown };
function mockReqRes(orgId: string | null, params: Record<string, string> = {}): { req: Request; res: CapturedRes } {
  const req = {
    organizationContext: orgId ? { organizationId: orgId } : undefined,
    params,
    query: {}
  } as unknown as Request;
  const res = {
    _status: 0,
    _json: undefined as unknown,
    status(code: number) { this._status = code; return this; },
    json(body: unknown) { this._json = body; return this; }
  };
  return { req, res: res as unknown as CapturedRes };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the enterprise-entity GET-one test.");
  pool = new Pool({ connectionString: url, ssl: false });

  entityWithStore = (
    await pool.query<{ id: string }>(
      `INSERT INTO enterprise_entities (organization_id, entity_type, name)
       VALUES ($1, 'data_store', $2) RETURNING id`,
      [seed.orgA.id, `getone-ds-${crypto.randomUUID()}`]
    )
  ).rows[0].id;
  await pool.query(
    `INSERT INTO enterprise_data_stores (enterprise_entity_id, organization_id, data_classification, encryption_at_rest)
     VALUES ($1, $2, 'confidential', true)`,
    [entityWithStore, seed.orgA.id]
  );

  entityWithoutStore = (
    await pool.query<{ id: string }>(
      `INSERT INTO enterprise_entities (organization_id, entity_type, name)
       VALUES ($1, 'application', $2) RETURNING id`,
      [seed.orgA.id, `getone-app-${crypto.randomUUID()}`]
    )
  ).rows[0].id;
}, 120_000);

afterAll(async () => { await pool?.end(); });

describe("GET /api/enterprise-entities/:id (real Postgres, tenant tx)", () => {
  it("returns 200 with data-store columns for an entity WITH a data-store row", async () => {
    const { req, res } = mockReqRes(seed.orgA.id, { id: entityWithStore });
    await withTenant(seed.orgA.id, () => getEnterpriseEntity(req, res));
    expect(res._status).toBe(200);
    const body = res._json as { enterprise_entity: Record<string, unknown> };
    expect(body.enterprise_entity.id).toBe(entityWithStore);
    expect(body.enterprise_entity.organization_id).toBe(seed.orgA.id);
    expect(body.enterprise_entity.entity_type).toBe("data_store");
    expect(body.enterprise_entity.data_classification).toBe("confidential");
    expect(body.enterprise_entity.encryption_at_rest).toBe(true);
  });

  it("returns 200 with null data-store columns for an entity WITHOUT one (LEFT JOIN miss)", async () => {
    const { req, res } = mockReqRes(seed.orgA.id, { id: entityWithoutStore });
    await withTenant(seed.orgA.id, () => getEnterpriseEntity(req, res));
    expect(res._status).toBe(200);
    const body = res._json as { enterprise_entity: Record<string, unknown> };
    expect(body.enterprise_entity.id).toBe(entityWithoutStore);
    expect(body.enterprise_entity.entity_type).toBe("application");
    expect(body.enterprise_entity.data_classification).toBeNull();
    expect(body.enterprise_entity.encryption_at_rest).toBeNull();
  });

  it("404s on another org's entity id (org scoping intact through the join)", async () => {
    const { req, res } = mockReqRes(seed.orgB.id, { id: entityWithStore });
    await withTenant(seed.orgB.id, () => getEnterpriseEntity(req, res));
    expect(res._status).toBe(404);
    expect((res._json as { error: string }).error).toBe("not_found");
  });
});
