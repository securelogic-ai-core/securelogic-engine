/**
 * auditLogReadIsolation.test.ts — VA-S1a.
 *
 * The audit log is where the Vendor Assurance lifecycle writes its record:
 * every invite issued, re-issued and revoked lands here, complete with the
 * vendor contact's email address and the reason a customer typed. It is the
 * one read surface that deliberately returns other people's actions, and until
 * now nothing proved a tenant could only read its OWN.
 *
 * Every route on the surface is covered — list, event types, CSV export — and
 * every filter parameter is tried as a lever, because a filter that widens the
 * predicate instead of narrowing it is exactly how this class of route leaks.
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

const A_MARKER = "a-only@vendor.example";
const B_MARKER = "b-secret@vendor.example";
let bResourceId: string;
let bEventId: string;

async function writeAudit(
  orgId: string,
  eventType: string,
  marker: string
): Promise<{ id: string; resourceId: string }> {
  const res = await pool.query<{ id: string; resource_id: string }>(
    `INSERT INTO security_audit_log
       (organization_id, event_type, resource_type, resource_id, payload)
     VALUES ($1, $2, 'vendor_engagement', gen_random_uuid(), $3::jsonb)
     RETURNING id, resource_id`,
    [orgId, eventType, JSON.stringify({ contact_email: marker })]
  );
  return { id: res.rows[0]!.id, resourceId: res.rows[0]!.resource_id };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  pool = new Pool({ connectionString: url, ssl: false });

  await writeAudit(seed.orgA.id, "vendor_engagement.invite_issued", A_MARKER);
  const b = await writeAudit(seed.orgB.id, "vendor_engagement.invite_revoked", B_MARKER);
  bResourceId = b.resourceId;
  bEventId = b.id;

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));
}, 180_000);

afterAll(async () => {
  await pool?.end();
});

const list = (key: string, qs = "") =>
  request(app).get(`/api/audit-log${qs}`).set("X-Api-Key", key);

describe("VA-S1a — the audit log reads one tenant only", () => {
  it("org A sees its own events and none of org B's", async () => {
    const res = await list(seed.orgA.apiKey);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(A_MARKER);
    expect(body).not.toContain(B_MARKER);
    expect(body).not.toContain(bEventId);
  });

  it("and org B sees its own — the previous assertion is not vacuous", async () => {
    const res = await list(seed.orgB.apiKey);
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain(B_MARKER);
    expect(body).not.toContain(A_MARKER);
  });

  it("filtering by ANOTHER tenant's resource id returns nothing, not that resource", async () => {
    const res = await list(seed.orgA.apiKey, `?resource_id=${bResourceId}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain(B_MARKER);
  });

  it("filtering by an event type only org B produced returns nothing", async () => {
    const res = await list(seed.orgA.apiKey, "?event_type=vendor_engagement.invite_revoked");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("paging past org A's own events never spills into org B's", async () => {
    const res = await list(seed.orgA.apiKey, "?page=2&limit=1");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain(B_MARKER);
  });

  it("the event-type list is per tenant", async () => {
    const a = await request(app).get("/api/audit-log/event-types").set("X-Api-Key", seed.orgA.apiKey);
    expect(a.status).toBe(200);
    expect(a.body.event_types).toContain("vendor_engagement.invite_issued");
    expect(a.body.event_types).not.toContain("vendor_engagement.invite_revoked");
  });

  it("the CSV export is per tenant — the bulk path leaks nothing the list withholds", async () => {
    const res = await request(app)
      .get("/api/audit-log/export.csv")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    expect(res.text).toContain(A_MARKER);
    expect(res.text).not.toContain(B_MARKER);
  });

  it("no key, no audit log", async () => {
    const res = await request(app).get("/api/audit-log");
    expect(res.status).toBe(401);
  });
});
