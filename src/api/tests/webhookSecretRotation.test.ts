import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-4111-8111-111111111111";
const ENDPOINT = "33333333-3333-4333-8333-333333333333";

// Hoisted mutable state the postgres mock reads from.
const h = vi.hoisted(() => ({
  state: {
    endpointExists: true,
    updates: [] as Array<{ sql: string; params: unknown[] }>,
  },
}));

const audited = vi.hoisted(() => ({ events: [] as Array<Record<string, unknown>> }));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/UPDATE webhook_endpoints/.test(sql)) {
        h.state.updates.push({ sql, params });
        if (!h.state.endpointExists) return { rows: [], rowCount: 0 };
        return {
          rows: [
            {
              id: ENDPOINT,
              organization_id: ORG,
              url: "https://hooks.example.com/securelogic",
              secret: params[0],
              description: null,
              status: "active",
              event_types: ["*"],
              failure_count: 3,
              last_success_at: "2026-07-27T00:00:00.000Z",
              last_failure_at: null,
              created_at: "2026-07-01T00:00:00.000Z",
              updated_at: "2026-07-28T00:00:00.000Z",
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
    connect: vi.fn(),
  },
  withTenant: vi.fn(async (_org: string, cb: () => Promise<unknown>) => cb()),
  pgElevated: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn((event: Record<string, unknown>) => {
    audited.events.push(event);
  }),
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
  requireNotViewer: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Import AFTER mocks.
import webhooksRouter from "../routes/webhooks.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", webhooksRouter);
  return app;
}

beforeEach(() => {
  h.state.endpointExists = true;
  h.state.updates = [];
  audited.events = [];
});

describe("POST /api/webhooks/:id/rotate-secret", () => {
  it("rotates in place and returns the new secret exactly once", async () => {
    const res = await request(makeApp()).post(`/api/webhooks/${ENDPOINT}/rotate-secret`);
    expect(res.status).toBe(200);

    // The UPDATE is org-scoped and carries a fresh whsec_ secret.
    expect(h.state.updates).toHaveLength(1);
    const [newSecret, id, org] = h.state.updates[0]!.params as [string, string, string];
    expect(newSecret).toMatch(/^whsec_/);
    expect(id).toBe(ENDPOINT);
    expect(org).toBe(ORG);

    // Full secret in the response body (once), masked hint alongside —
    // and identity/history preserved (same id, counters intact).
    expect(res.body.endpoint.secret).toBe(newSecret);
    expect(res.body.endpoint.secret_hint).toMatch(/\.\.\./);
    expect(res.body.endpoint.secret_hint).not.toBe(newSecret);
    expect(res.body.endpoint.id).toBe(ENDPOINT);
    expect(res.body.endpoint.failure_count).toBe(3);
  });

  it("writes a webhook.secret_rotated audit event without the secret", async () => {
    await request(makeApp()).post(`/api/webhooks/${ENDPOINT}/rotate-secret`);

    expect(audited.events).toHaveLength(1);
    const evt = audited.events[0]!;
    expect(evt.eventType).toBe("webhook.secret_rotated");
    expect(evt.resourceType).toBe("webhook_endpoint");
    expect(evt.resourceId).toBe(ENDPOINT);
    expect(evt.organizationId).toBe(ORG);
    expect(JSON.stringify(evt)).not.toContain("whsec_");
  });

  it("404s for an absent or cross-org endpoint and rotates nothing", async () => {
    h.state.endpointExists = false;
    const res = await request(makeApp()).post(`/api/webhooks/${ENDPOINT}/rotate-secret`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "webhook_endpoint_not_found" });
    expect(audited.events).toHaveLength(0);
  });

  it("rejects a non-UUID id without touching the database", async () => {
    const res = await request(makeApp()).post("/api/webhooks/not-a-uuid/rotate-secret");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalid_endpoint_id" });
    expect(h.state.updates).toHaveLength(0);
  });

  it("generates a distinct secret per rotation", async () => {
    const app = makeApp();
    await request(app).post(`/api/webhooks/${ENDPOINT}/rotate-secret`);
    await request(app).post(`/api/webhooks/${ENDPOINT}/rotate-secret`);
    const [a, b] = h.state.updates.map((u) => u.params[0]);
    expect(a).not.toBe(b);
  });
});
