/**
 * authSurfaceClientIdentity.test.ts — Tier-2 auth-anomaly identity package.
 *
 * The credential-stuffing / key-probing detectors GROUP security_audit_log
 * rows BY ip_address, so what the auth surface RECORDS is what the detectors
 * can see. Behind Cloudflare `req.ip` is a rotating EDGE address (measured:
 * one client → many edge IPs), which fragmented every attacker into unrelated
 * identities and kept the anomaly ledger empty for all time.
 *
 * These tests pin the fix at the audit-write boundary of requireApiKey's
 * `auth.invalid_api_key` event (the exact event the probing detector consumes),
 * driven through a real Express app with `trust proxy` set as production has it:
 *
 *   1. NON-FRAGMENTATION — one client (constant CF-Connecting-IP) whose
 *      requests arrive via rotating edge nodes records ONE identity.
 *   2. DISTINGUISHABILITY — two different clients record two identities.
 *   3. UNTRUSTED-HEADER CONDITIONS — a comma-list or duplicated
 *      CF-Connecting-IP (something other than Cloudflare wrote it) is
 *      rejected and the recording falls back to `req.ip`, never to the
 *      forged value.
 *
 * DB-free: postgres and the audit writer are mocked; what is asserted is the
 * ipAddress each audit write carries.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const auditWrites: Array<Record<string, unknown>> = [];

vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: (e: Record<string, unknown>) => {
    auditWrites.push(e);
  }
}));
vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(async () => ({ rows: [] })) },
  pgElevated: { query: vi.fn(async () => ({ rows: [] })) },
  withTenant: (_o: unknown, fn: () => unknown) => fn()
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }
}));

async function makeApp(): Promise<express.Express> {
  const { requireApiKey } = await import("../middleware/requireApiKey.js");
  const app = express();
  // Same shape production runs (app.ts): one trusted hop → req.ip becomes the
  // RIGHTMOST X-Forwarded-For entry, i.e. the Cloudflare edge node.
  app.set("trust proxy", 1);
  app.get("/probe", requireApiKey, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

function invalidKeyEvents(): Array<Record<string, unknown>> {
  return auditWrites.filter(e => e.eventType === "auth.invalid_api_key");
}

beforeEach(() => {
  auditWrites.length = 0;
  vi.resetModules();
});

describe("auth-surface client identity (Tier-2 anomaly inputs)", () => {
  it("one client through ROTATING Cloudflare edges records ONE identity", async () => {
    const app = await makeApp();
    const edges = ["172.70.134.76", "172.71.190.23", "172.68.11.5"];
    for (const edge of edges) {
      await request(app)
        .get("/probe")
        .set("Authorization", "Bearer sl_definitely_invalid")
        .set("CF-Connecting-IP", "203.0.113.50")
        .set("X-Forwarded-For", `203.0.113.50, ${edge}`);
    }
    const ips = invalidKeyEvents().map(e => e.ipAddress);
    expect(ips.length).toBe(edges.length);
    expect(new Set(ips)).toEqual(new Set(["203.0.113.50"]));
  });

  it("two genuinely different clients record TWO distinct identities", async () => {
    const app = await makeApp();
    for (const client of ["203.0.113.50", "198.51.100.7"]) {
      await request(app)
        .get("/probe")
        .set("Authorization", "Bearer sl_definitely_invalid")
        .set("CF-Connecting-IP", client)
        .set("X-Forwarded-For", `${client}, 172.70.134.76`);
    }
    const ips = invalidKeyEvents().map(e => e.ipAddress);
    expect(new Set(ips)).toEqual(new Set(["203.0.113.50", "198.51.100.7"]));
  });

  it("a comma-list CF-Connecting-IP is rejected — falls back to req.ip, never the forged value", async () => {
    const app = await makeApp();
    await request(app)
      .get("/probe")
      .set("Authorization", "Bearer sl_definitely_invalid")
      .set("CF-Connecting-IP", "6.6.6.6, 7.7.7.7")
      .set("X-Forwarded-For", "203.0.113.50, 172.70.134.76");
    const [e] = invalidKeyEvents();
    expect(e.ipAddress).toBe("172.70.134.76"); // req.ip = the trusted-hop XFF entry
    expect(e.ipAddress).not.toContain("6.6.6.6");
  });

  it("a DUPLICATED CF-Connecting-IP header is rejected the same way", async () => {
    const app = await makeApp();
    const req = request(app)
      .get("/probe")
      .set("Authorization", "Bearer sl_definitely_invalid")
      .set("X-Forwarded-For", "203.0.113.50, 172.70.134.76");
    // supertest joins repeated .set calls; drive the raw header array instead
    (req as unknown as { set(k: string, v: string[]): typeof req }).set(
      "CF-Connecting-IP", ["6.6.6.6", "7.7.7.7"]);
    await req;
    const [e] = invalidKeyEvents();
    expect(e.ipAddress).toBe("172.70.134.76");
  });

  it("no Cloudflare header at all → req.ip (correct off-CDN and in local dev)", async () => {
    const app = await makeApp();
    await request(app)
      .get("/probe")
      .set("Authorization", "Bearer sl_definitely_invalid")
      .set("X-Forwarded-For", "198.51.100.99");
    const [e] = invalidKeyEvents();
    expect(e.ipAddress).toBe("198.51.100.99");
  });
});
