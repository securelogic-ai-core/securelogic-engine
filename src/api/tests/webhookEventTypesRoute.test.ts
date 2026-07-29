/**
 * webhookEventTypesRoute.test.ts — GET /api/webhooks/event-types
 *
 * Two things are load-bearing here and both are easy to regress:
 *   1. ROUTE ORDER — the literal path must not be captured by /webhooks/:id.
 *   2. FLAG FIDELITY — the catalog must advertise exactly what the route
 *      accepts, so the settings UI can never offer an event type the engine
 *      would reject (nor hide one it would accept).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({ writeAuditEvent: vi.fn() }));
vi.mock("../lib/webhookDispatcher.js", () => ({
  deliverWebhook: vi.fn(),
  dispatchWebhookEvent: vi.fn(),
}));
vi.mock("../middleware/requireApiKey.js", () => ({
  requireApiKey: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.userId = "user-1";
    req.apiKey = { id: "key-1" };
    next();
  },
}));
vi.mock("../middleware/attachOrganizationContext.js", () => ({
  attachOrganizationContext: (
    req: { organizationContext?: unknown },
    _res: unknown,
    next: () => void
  ) => {
    req.organizationContext = { organizationId: ORG, entitlementLevel: "premium" };
    next();
  },
}));
vi.mock("../middleware/requireEntitlement.js", () => ({
  requireEntitlement: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middleware/requireRole.js", () => ({
  requireAdminRole: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireNotViewer: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import AFTER mocks.
import webhooksRouter from "../routes/webhooks.js";
import { WAVE1_EVENT_TYPES } from "../lib/webhookWave1FeatureFlag.js";

const FLAG = "SECURELOGIC_WEBHOOK_WAVE1_ENABLED";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", webhooksRouter);
  return app;
}

describe("GET /api/webhooks/event-types", () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env[FLAG];
    delete process.env[FLAG];
  });

  afterEach(() => {
    if (previous === undefined) delete process.env[FLAG];
    else process.env[FLAG] = previous;
  });

  it("is NOT captured by GET /webhooks/:id (route-order trap)", async () => {
    const res = await request(makeApp()).get("/api/webhooks/event-types");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.event_types)).toBe(true);
    expect(res.body.event_types.length).toBeGreaterThan(0);
  });

  it("returns {event_type, description} pairs", async () => {
    const res = await request(makeApp()).get("/api/webhooks/event-types");
    for (const entry of res.body.event_types) {
      expect(typeof entry.event_type).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("flag-off: advertises no wave-1 event type", async () => {
    const res = await request(makeApp()).get("/api/webhooks/event-types");
    const types = res.body.event_types.map((e: { event_type: string }) => e.event_type);
    expect(types).toHaveLength(7);
    for (const t of WAVE1_EVENT_TYPES) expect(types).not.toContain(t);
  });

  it("flag-on: advertises every wave-1 event type", async () => {
    process.env[FLAG] = "true";
    const res = await request(makeApp()).get("/api/webhooks/event-types");
    const types = res.body.event_types.map((e: { event_type: string }) => e.event_type);
    expect(types).toHaveLength(7 + WAVE1_EVENT_TYPES.length);
    for (const t of WAVE1_EVENT_TYPES) expect(types).toContain(t);
  });

  it("advertises exactly what POST /api/webhooks accepts (flag-off)", async () => {
    const app = makeApp();
    const listed = (await request(app).get("/api/webhooks/event-types")).body.event_types.map(
      (e: { event_type: string }) => e.event_type
    );
    // A wave-1 type is advertised nowhere AND rejected by create — the two
    // halves of the same contract.
    const rejected = await request(app)
      .post("/api/webhooks")
      .send({ url: "https://example.com/hook", event_types: [WAVE1_EVENT_TYPES[0]] });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error).toBe("invalid_event_type");
    expect(listed).not.toContain(WAVE1_EVENT_TYPES[0]);
    // The 400's `allowed` list is the catalog plus the wildcard.
    expect(rejected.body.allowed).toEqual(["*", ...listed]);
  });
});
