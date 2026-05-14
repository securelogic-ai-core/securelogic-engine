import { describe, it, expect, vi, beforeEach } from "vitest";
import type * as webhookUrlSafetyModule from "../lib/webhookUrlSafety.js";

const {
  pgQueryMock,
  undiciFetchMock,
  assertSafeWebhookUrlMock,
  buildPinnedAgentMock,
  agentCloseMock,
} = vi.hoisted(() => ({
  pgQueryMock: vi.fn(),
  undiciFetchMock: vi.fn(),
  assertSafeWebhookUrlMock: vi.fn(),
  buildPinnedAgentMock: vi.fn(),
  agentCloseMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQueryMock },
}));

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("undici", () => ({
  fetch: undiciFetchMock,
}));

vi.mock("../lib/webhookUrlSafety.js", async () => {
  const actual = await vi.importActual<
    typeof webhookUrlSafetyModule
  >("../lib/webhookUrlSafety.js");
  return {
    ...actual,
    assertSafeWebhookUrl: assertSafeWebhookUrlMock,
    buildPinnedAgent: buildPinnedAgentMock,
  };
});

vi.mock("../lib/webhookSigning.js", () => ({
  buildWebhookHeaders: vi.fn().mockReturnValue({
    "Content-Type": "application/json",
    "X-Test-Sig": "deadbeef",
  }),
}));

import { deliverWebhook } from "../lib/webhookDispatcher.js";
import { UnsafeWebhookUrlError } from "../lib/webhookUrlSafety.js";

const endpoint = { id: "ep-1", url: "https://customer.example.com/hook", secret: "shh" };
const event = {
  event_type: "finding.created",
  organization_id: "org-1",
  data: { hello: "world" },
};
const payload = JSON.stringify({ id: "evt-1", data: event.data });

const SENTINEL_AGENT = { close: agentCloseMock } as unknown as ReturnType<typeof buildPinnedAgentMock>;

function makeResponse(status: number, body: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

beforeEach(() => {
  pgQueryMock.mockReset();
  undiciFetchMock.mockReset();
  assertSafeWebhookUrlMock.mockReset();
  buildPinnedAgentMock.mockReset();
  agentCloseMock.mockClear();
  buildPinnedAgentMock.mockReturnValue(SENTINEL_AGENT);
});

describe("deliverWebhook: SSRF defenses end-to-end", () => {
  it("(case a) flows the validated IP into buildPinnedAgent and into fetch's dispatcher option", async () => {
    assertSafeWebhookUrlMock.mockResolvedValueOnce({
      ip: "203.0.113.7",
      family: 4,
      hostname: "customer.example.com",
      port: 443,
    });
    // First pg.query is the INSERT INTO webhook_deliveries; subsequent ones are
    // the success-path UPDATEs.
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-1" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    undiciFetchMock.mockResolvedValueOnce(makeResponse(200, "ok"));

    const result = await deliverWebhook(endpoint, payload, event);

    expect(assertSafeWebhookUrlMock).toHaveBeenCalledWith("https://customer.example.com/hook");
    expect(buildPinnedAgentMock).toHaveBeenCalledWith("203.0.113.7", 4);
    const fetchCallOptions = undiciFetchMock.mock.calls[0][1];
    expect(fetchCallOptions.dispatcher).toBe(SENTINEL_AGENT);
    expect(fetchCallOptions.redirect).toBe("manual");
    expect(agentCloseMock).toHaveBeenCalled();
    expect(result.status).toBe("delivered");
  });

  it("(case b) 3xx response is terminal: scheduleRetry called with error_message='redirect_blocked' and response_body=null", async () => {
    assertSafeWebhookUrlMock.mockResolvedValueOnce({
      ip: "203.0.113.7",
      family: 4,
      hostname: "customer.example.com",
      port: 443,
    });
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-2" }] }) // INSERT delivery
      .mockResolvedValueOnce({ rows: [{ attempt_count: 1 }], rowCount: 1 }) // scheduleRetry UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // scheduleRetry status='retrying' update
    const redirectResponse = {
      status: 302,
      ok: false,
      text: vi.fn(),
    } as unknown as Response;
    undiciFetchMock.mockResolvedValueOnce(redirectResponse);

    const result = await deliverWebhook(endpoint, payload, event);

    // Critical: we must NOT have read the redirect's body
    expect((redirectResponse as any).text).not.toHaveBeenCalled();

    // The scheduleRetry UPDATE was issued with response_body = null
    const scheduleRetryCall = pgQueryMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("UPDATE webhook_deliveries") &&
        c[0].includes("error_message")
    );
    expect(scheduleRetryCall).toBeDefined();
    // signature: (responseStatus, responseBody, errorMessage, deliveryId)
    const args = scheduleRetryCall![1] as unknown[];
    expect(args[0]).toBe(302); // responseStatus
    expect(args[1]).toBeNull(); // responseBody — Layer C
    expect(args[2]).toBe("redirect_blocked"); // errorMessage
    expect(result.responseStatus).toBe(302);
  });

  it("(case c) delivery-time rebinding rejection: validator throws → fetch is NEVER called", async () => {
    assertSafeWebhookUrlMock.mockRejectedValueOnce(
      new UnsafeWebhookUrlError("blocked_ip_range", "linkLocal")
    );
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-3" }] }) // INSERT delivery
      .mockResolvedValueOnce({ rows: [{ attempt_count: 1 }], rowCount: 1 }) // scheduleRetry
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await deliverWebhook(endpoint, payload, event);

    expect(undiciFetchMock).not.toHaveBeenCalled();
    expect(buildPinnedAgentMock).not.toHaveBeenCalled();

    const scheduleRetryCall = pgQueryMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("UPDATE webhook_deliveries") &&
        c[0].includes("error_message")
    );
    expect(scheduleRetryCall).toBeDefined();
    const args = scheduleRetryCall![1] as unknown[];
    expect(args[0]).toBeNull(); // responseStatus
    expect(args[1]).toBeNull(); // responseBody
    expect(args[2]).toBe("unsafe_url:blocked_ip_range:linkLocal");
    expect(result.status).toBe("failed");
  });

  it("(case d) non-2xx response: response_body is NOT persisted (Layer C)", async () => {
    assertSafeWebhookUrlMock.mockResolvedValueOnce({
      ip: "203.0.113.7",
      family: 4,
      hostname: "customer.example.com",
      port: 443,
    });
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-4" }] })
      .mockResolvedValueOnce({ rows: [{ attempt_count: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    // Simulate a 500 with a body that, if persisted, would be exfiltratable
    // via GET /api/webhooks/:id/deliveries.
    undiciFetchMock.mockResolvedValueOnce(makeResponse(500, "AKIA-leaked-credential-shape"));

    await deliverWebhook(endpoint, payload, event);

    const scheduleRetryCall = pgQueryMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("UPDATE webhook_deliveries") &&
        c[0].includes("error_message")
    );
    expect(scheduleRetryCall).toBeDefined();
    const args = scheduleRetryCall![1] as unknown[];
    expect(args[0]).toBe(500);
    expect(args[1]).toBeNull(); // critical: not the response body
    expect(args[2]).toBe("HTTP 500");
  });

  it("agent.close() runs even when fetch throws", async () => {
    assertSafeWebhookUrlMock.mockResolvedValueOnce({
      ip: "203.0.113.7",
      family: 4,
      hostname: "customer.example.com",
      port: 443,
    });
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-5" }] })
      .mockResolvedValueOnce({ rows: [{ attempt_count: 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    undiciFetchMock.mockRejectedValueOnce(new Error("AbortError"));

    await deliverWebhook(endpoint, payload, event);

    expect(agentCloseMock).toHaveBeenCalled();
  });

  it("success path still persists response_body (2xx debugging is preserved)", async () => {
    assertSafeWebhookUrlMock.mockResolvedValueOnce({
      ip: "203.0.113.7",
      family: 4,
      hostname: "customer.example.com",
      port: 443,
    });
    pgQueryMock
      .mockResolvedValueOnce({ rows: [{ id: "delivery-6" }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // UPDATE delivered
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE endpoint
    undiciFetchMock.mockResolvedValueOnce(makeResponse(200, "thanks!"));

    await deliverWebhook(endpoint, payload, event);

    const deliveredUpdate = pgQueryMock.mock.calls.find(
      (c) =>
        typeof c[0] === "string" &&
        c[0].includes("UPDATE webhook_deliveries") &&
        c[0].includes("delivered_at")
    );
    expect(deliveredUpdate).toBeDefined();
    const args = deliveredUpdate![1] as unknown[];
    expect(args[0]).toBe(200);
    expect(args[1]).toBe("thanks!"); // body IS persisted on success
  });
});
