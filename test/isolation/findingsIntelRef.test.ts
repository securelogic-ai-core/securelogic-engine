/**
 * findingsIntelRef.test.ts — the Brief→exposure resolver (intel_ref filter).
 *
 * A brief item knows only its cyber_signal_id, but the platform creates
 * findings on TWO channels: legacy per-signal (source_type=cyber_signal,
 * source_id=signal) and event-native (source_type=intelligence_event,
 * source_id=event reached via intelligence_event_sources). Before intel_ref,
 * the brief's decision affordance queried only the legacy channel, so the
 * findings the event pipeline actually creates were unreachable (dead-end).
 *
 * Proves, over the REAL app:
 *   1. intel_ref resolves the legacy per-signal finding;
 *   2. intel_ref resolves the event-native finding through the bridge;
 *   3. an unrelated signal resolves nothing;
 *   4. tenant isolation: org B cannot resolve org A's findings via intel_ref;
 *   5. invalid ref → 400 (never a silent empty list).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Pool } from "pg";

import { bootstrapTestDb, seedCyberSignal, type TestDbSeed } from "./testDb.js";

let app: Express;
let seed: TestDbSeed;
let pool: Pool;

async function seedEventWithSource(dedup: string, signalId: string): Promise<string> {
  const ev = await pool.query<{ id: string }>(
    `INSERT INTO intelligence_events (canonical_key, title, event_type, severity)
     VALUES ($1, $2, 'vulnerability', 'High') RETURNING id`,
    [`intelref-${dedup}`, `Event ${dedup}`]
  );
  await pool.query(
    `INSERT INTO intelligence_event_sources (event_id, cyber_signal_id, source, relation)
     VALUES ($1, $2, 'harness', 'canonical')`,
    [ev.rows[0].id, signalId]
  );
  return ev.rows[0].id;
}

async function seedFindingFor(
  orgId: string,
  sourceType: string,
  sourceId: string,
  title: string
): Promise<string> {
  const r = await pool.query<{ id: string }>(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, source_id)
     VALUES ($1, $2, 'High', 'intel-ref seed', $3, $4) RETURNING id`,
    [orgId, title, sourceType, sourceId]
  );
  return r.rows[0].id;
}

const list = (key: string, ref: string) =>
  request(app).get(`/api/findings?intel_ref=${encodeURIComponent(ref)}`).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the intel-ref test.");
  pool = new Pool({ connectionString: url, ssl: false });
  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("GET /api/findings?intel_ref — brief→exposure across both channels", () => {
  it("resolves the legacy per-signal finding", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "iref-legacy-1", vendor: "Acme" });
    const findingId = await seedFindingFor(seed.orgA.id, "cyber_signal", signalId, "legacy channel");

    const res = await list(seed.orgA.apiKey, signalId);
    expect(res.status).toBe(200);
    expect(res.body.findings.map((f: { id: string }) => f.id)).toContain(findingId);
    expect(res.body.total).toBe(1);
  });

  it("resolves the event-native finding through the signal→event bridge", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "iref-event-1", vendor: "Acme" });
    const eventId = await seedEventWithSource("ev-1", signalId);
    const findingId = await seedFindingFor(seed.orgA.id, "intelligence_event", eventId, "event channel");

    const res = await list(seed.orgA.apiKey, signalId);
    expect(res.status).toBe(200);
    expect(res.body.findings.map((f: { id: string }) => f.id)).toContain(findingId);
  });

  it("returns both channels' findings for a signal that has both", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "iref-both-1", vendor: "Acme" });
    const eventId = await seedEventWithSource("ev-both-1", signalId);
    const legacy = await seedFindingFor(seed.orgA.id, "cyber_signal", signalId, "both/legacy");
    const eventNative = await seedFindingFor(seed.orgA.id, "intelligence_event", eventId, "both/event");

    const res = await list(seed.orgA.apiKey, signalId);
    const ids = res.body.findings.map((f: { id: string }) => f.id);
    expect(ids).toContain(legacy);
    expect(ids).toContain(eventNative);
    expect(res.body.total).toBe(2);
  });

  it("an unrelated signal resolves nothing", async () => {
    const other = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "iref-none-1", vendor: "Acme" });
    const res = await list(seed.orgA.apiKey, other);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("tenant isolation: org B cannot resolve org A's findings via intel_ref", async () => {
    const signalId = await seedCyberSignal(pool, { orgId: seed.orgA.id, dedup: "iref-xorg-1", vendor: "Acme" });
    const eventId = await seedEventWithSource("ev-xorg-1", signalId);
    await seedFindingFor(seed.orgA.id, "cyber_signal", signalId, "xorg/legacy");
    await seedFindingFor(seed.orgA.id, "intelligence_event", eventId, "xorg/event");

    const res = await list(seed.orgB.apiKey, signalId);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.findings).toEqual([]);
  });

  it("rejects a non-UUID ref with 400 (never a silent empty list)", async () => {
    const res = await list(seed.orgA.apiKey, "not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("intel_ref_must_be_uuid");
  });
});
