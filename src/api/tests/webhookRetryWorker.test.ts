import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const EP = "22222222-2222-4222-8222-222222222222";
const D1 = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  state: {
    // Rows the lease-claim UPDATE returns this tick.
    dueRows: [] as Array<Record<string, unknown>>,
    // Endpoint row returned for lookups (null = endpoint gone).
    endpoint: null as Record<string, unknown> | null,
    expiredCount: 0,
    calls: [] as Array<{ sql: string; params: unknown[] }>,
  },
  attempts: [] as Array<{ deliveryId: string; url: string; payload: string }>,
  attemptResult: { status: "delivered", responseStatus: 200 } as {
    status: string;
    responseStatus: number | null;
  },
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  withTenant: vi.fn(),
  pgElevated: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      h.state.calls.push({ sql, params });
      if (/retry_window_expired/.test(sql)) {
        return { rows: [], rowCount: h.state.expiredCount };
      }
      if (/FOR UPDATE SKIP LOCKED/.test(sql)) {
        return { rows: h.state.dueRows, rowCount: h.state.dueRows.length };
      }
      if (/FROM webhook_endpoints/.test(sql)) {
        return {
          rows: h.state.endpoint ? [h.state.endpoint] : [],
          rowCount: h.state.endpoint ? 1 : 0,
        };
      }
      return { rows: [], rowCount: 0 };
    }),
  },
}));
vi.mock("../lib/webhookDispatcher.js", () => ({
  attemptWebhookDelivery: vi.fn(
    async (deliveryId: string, endpoint: { url: string }, payload: string) => {
      h.attempts.push({ deliveryId, url: endpoint.url, payload });
      return h.attemptResult;
    }
  ),
}));

import { runWebhookRetrySweep } from "../workers/webhookRetryWorker.js";

beforeEach(() => {
  h.state.dueRows = [];
  h.state.endpoint = null;
  h.state.expiredCount = 0;
  h.state.calls = [];
  h.attempts = [];
  h.attemptResult = { status: "delivered", responseStatus: 200 };
});

afterEach(() => {
  delete process.env["SECURELOGIC_WEBHOOK_RETRY_DISABLED"];
});

describe("runWebhookRetrySweep", () => {
  it("expires stale rows first, then lease-claims and redelivers due rows", async () => {
    h.state.expiredCount = 2;
    h.state.dueRows = [
      { id: D1, webhook_endpoint_id: EP, organization_id: ORG, payload: { event_type: "risk.created" } },
    ];
    h.state.endpoint = { id: EP, url: "https://hooks.example.com/x", secret: "whsec_abc", status: "active" };

    const out = await runWebhookRetrySweep();

    expect(out).toEqual({ claimed: 1, delivered: 1, expired: 2, endpoint_inactive: 0 });

    // Ordering: the stale-expiry UPDATE runs before the claim.
    const expireIdx = h.state.calls.findIndex((c) => /retry_window_expired/.test(c.sql));
    const claimIdx = h.state.calls.findIndex((c) => /FOR UPDATE SKIP LOCKED/.test(c.sql));
    expect(expireIdx).toBeGreaterThanOrEqual(0);
    expect(expireIdx).toBeLessThan(claimIdx);

    // The claim IS a lease: it advances next_retry_at, never flips status.
    const claim = h.state.calls[claimIdx]!;
    expect(claim.sql).toContain("SET next_retry_at = NOW()");
    expect(claim.sql).not.toContain("SET status");

    // Redelivery goes through the shared attempt path with the stored payload
    // serialized (jsonb arrives as an object).
    expect(h.attempts).toEqual([
      { deliveryId: D1, url: "https://hooks.example.com/x", payload: '{"event_type":"risk.created"}' },
    ]);
  });

  it("terminally fails a row whose endpoint is gone or inactive — and never posts to it", async () => {
    h.state.dueRows = [
      { id: D1, webhook_endpoint_id: EP, organization_id: ORG, payload: {} },
    ];
    h.state.endpoint = { id: EP, url: "https://x", secret: "s", status: "failed" };

    const out = await runWebhookRetrySweep();

    expect(out.endpoint_inactive).toBe(1);
    expect(out.delivered).toBe(0);
    expect(h.attempts).toHaveLength(0);
    const fail = h.state.calls.find((c) => /endpoint_inactive/.test(c.sql));
    expect(fail).toBeDefined();
    expect(fail!.params).toEqual([D1]);
  });

  it("endpoint lookup is org-bound", async () => {
    h.state.dueRows = [
      { id: D1, webhook_endpoint_id: EP, organization_id: ORG, payload: {} },
    ];
    h.state.endpoint = { id: EP, url: "https://x", secret: "s", status: "active" };
    await runWebhookRetrySweep();
    const lookup = h.state.calls.find((c) => /FROM webhook_endpoints/.test(c.sql))!;
    expect(lookup.sql).toContain("organization_id = $2");
    expect(lookup.params).toEqual([EP, ORG]);
  });

  it("one delivery's unexpected crash does not stop the batch", async () => {
    h.state.dueRows = [
      { id: D1, webhook_endpoint_id: EP, organization_id: ORG, payload: {} },
      { id: "44444444-4444-4444-8444-444444444444", webhook_endpoint_id: EP, organization_id: ORG, payload: {} },
    ];
    h.state.endpoint = { id: EP, url: "https://x", secret: "s", status: "active" };
    const { attemptWebhookDelivery } = await import("../lib/webhookDispatcher.js");
    (attemptWebhookDelivery as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ status: "delivered", responseStatus: 200 });

    const out = await runWebhookRetrySweep();
    expect(out.claimed).toBe(2);
    expect(out.delivered).toBe(1);
  });

  it("the ops brake skips the tick entirely", async () => {
    process.env["SECURELOGIC_WEBHOOK_RETRY_DISABLED"] = "true";
    const out = await runWebhookRetrySweep();
    expect(out).toEqual({ claimed: 0, delivered: 0, expired: 0, endpoint_inactive: 0 });
    expect(h.state.calls).toHaveLength(0);
  });
});
