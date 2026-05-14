import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import type { Request, Response } from "express";

// vi.mock factories are hoisted above top-level consts, so the mock fns must
// also be hoisted via vi.hoisted to avoid "Cannot access X before initialization".
const {
  pgQueryMock,
  pgConnectMock,
  constructEventMock,
  customersRetrieveMock,
  subscriptionsListMock,
  subscriptionsCancelMock,
  setEntitlementInRedisMock,
} = vi.hoisted(() => ({
  pgQueryMock: vi.fn(),
  pgConnectMock: vi.fn(),
  constructEventMock: vi.fn(),
  customersRetrieveMock: vi.fn(),
  subscriptionsListMock: vi.fn(),
  subscriptionsCancelMock: vi.fn(),
  setEntitlementInRedisMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: {
    query: pgQueryMock,
    connect: pgConnectMock,
  },
}));

vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
    customers: { retrieve: customersRetrieveMock },
    subscriptions: {
      list: subscriptionsListMock,
      cancel: subscriptionsCancelMock,
    },
  }),
}));

vi.mock("../infra/entitlementStore.js", () => ({
  setEntitlementInRedis: setEntitlementInRedisMock,
}));

vi.mock("../infra/redis.js", () => ({
  redisReady: true,
}));

vi.mock("../infra/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";
import { lemonWebhook } from "../webhooks/lemonWebhook.js";
import {
  claimWebhookEvent,
  deriveLemonEventId,
} from "../webhooks/webhookIdempotency.js";

const CLAIM_INSERT_SQL = /INSERT INTO webhook_events_processed/;

function buildReq(
  rawBody: Buffer,
  body: unknown,
  headers: Record<string, string>
) {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    body,
    rawBody,
  } as unknown as Request;
}

function buildRes() {
  const res: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } =
    { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  pgQueryMock.mockReset();
  pgConnectMock.mockReset();
  constructEventMock.mockReset();
  customersRetrieveMock.mockReset();
  subscriptionsListMock.mockReset();
  subscriptionsCancelMock.mockReset();
  setEntitlementInRedisMock.mockClear();
});

describe("claimWebhookEvent: contract", () => {
  it("returns firstSeen=true when INSERT inserts a row (rowCount=1)", async () => {
    pgQueryMock.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await claimWebhookEvent("stripe", "evt_first", "invoice.paid");
    expect(result.firstSeen).toBe(true);
    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0][0]).toMatch(CLAIM_INSERT_SQL);
    expect(pgQueryMock.mock.calls[0][1]).toEqual([
      "stripe",
      "evt_first",
      "invoice.paid",
    ]);
  });

  it("returns firstSeen=false when ON CONFLICT skips insert (rowCount=0)", async () => {
    pgQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const result = await claimWebhookEvent("stripe", "evt_dup", "invoice.paid");
    expect(result.firstSeen).toBe(false);
  });

  it("throws on DB failure so callers can fail-closed", async () => {
    pgQueryMock.mockRejectedValueOnce(new Error("connection refused"));
    await expect(
      claimWebhookEvent("stripe", "evt_err", "invoice.paid")
    ).rejects.toThrow("connection refused");
  });

  it("(case d) concurrent claims for same event_id → exactly one firstSeen=true", async () => {
    let callCount = 0;
    pgQueryMock.mockImplementation(async () => {
      callCount += 1;
      return { rowCount: callCount === 1 ? 1 : 0, rows: [] };
    });
    const [a, b] = await Promise.all([
      claimWebhookEvent("stripe", "evt_race", "subscription.created"),
      claimWebhookEvent("stripe", "evt_race", "subscription.created"),
    ]);
    const winners = [a.firstSeen, b.firstSeen].filter(Boolean).length;
    expect(winners).toBe(1);
    expect(pgQueryMock).toHaveBeenCalledTimes(2);
  });
});

describe("deriveLemonEventId: contract", () => {
  it("uses meta.event_id when present and non-empty", () => {
    const rawBody = Buffer.from('{"meta":{"event_id":"lem_xyz"}}');
    const result = deriveLemonEventId(
      { meta: { event_id: "lem_xyz" } },
      rawBody
    );
    expect(result).toEqual({ eventId: "lem_xyz", source: "meta_event_id" });
  });

  it("falls back to sha256(rawBody)[:32] when meta.event_id absent", () => {
    const rawBody = Buffer.from(
      '{"meta":{"event_name":"subscription_created"}}'
    );
    const result = deriveLemonEventId(
      { meta: { event_name: "subscription_created" } },
      rawBody
    );
    expect(result.source).toBe("body_sha256");
    expect(result.eventId).toHaveLength(32);
    expect(result.eventId).toBe(
      crypto.createHash("sha256").update(rawBody).digest("hex").slice(0, 32)
    );
  });

  it("falls back to sha256 when meta.event_id is empty/whitespace", () => {
    const rawBody = Buffer.from("{}");
    const result = deriveLemonEventId({ meta: { event_id: "   " } }, rawBody);
    expect(result.source).toBe("body_sha256");
  });

  it("falls back to sha256 when payload is a Buffer (unparsed body)", () => {
    const rawBody = Buffer.from(
      '{"meta":{"event_id":"lem_in_buffer","event_name":"x"}}'
    );
    const result = deriveLemonEventId(rawBody, rawBody);
    // a Buffer is not a plain object; .meta is undefined on Buffer
    expect(result.source).toBe("body_sha256");
  });
});

describe("stripeWebhook: idempotency gate (case a)", () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  });

  function basicStripeEvent() {
    return {
      id: "evt_dup_stripe",
      type: "customer.subscription.created",
      data: {
        object: {
          id: "sub_x",
          status: "active",
          customer: "cus_x",
          items: { data: [{ price: { id: "price_x" } }] },
          metadata: {
            api_key_id: "11111111-1111-1111-1111-111111111111",
            tier: "professional",
          },
        },
      },
    };
  }

  it("duplicate event_id short-circuits before downstream pg writes", async () => {
    constructEventMock.mockReturnValue(basicStripeEvent());
    // claim INSERT returns rowCount=0 → "already seen"
    pgQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = buildReq(Buffer.from("{}"), {}, {
      "stripe-signature": "sig123",
    });
    const res = buildRes();
    await stripeWebhook(req, res);

    // Only the idempotency INSERT was issued; no SELECT/UPDATE on orgs/api_keys.
    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0][0]).toMatch(CLAIM_INSERT_SQL);
    expect(pgQueryMock.mock.calls[0][1]).toEqual([
      "stripe",
      "evt_dup_stripe",
      "customer.subscription.created",
    ]);
    // syncOrgEntitlement uses pg.connect() — must not have been invoked.
    expect(pgConnectMock).not.toHaveBeenCalled();
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(subscriptionsListMock).not.toHaveBeenCalled();

    expect(
      (res as unknown as { status: ReturnType<typeof vi.fn> }).status
    ).toHaveBeenCalledWith(200);
    expect(
      (res as unknown as { json: ReturnType<typeof vi.fn> }).json
    ).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent_replay: true })
    );
  });

  it("fails closed (500) when claim INSERT throws", async () => {
    constructEventMock.mockReturnValue(basicStripeEvent());
    pgQueryMock.mockRejectedValueOnce(new Error("pg down"));

    const req = buildReq(Buffer.from("{}"), {}, {
      "stripe-signature": "sig123",
    });
    const res = buildRes();
    await stripeWebhook(req, res);

    expect(
      (res as unknown as { status: ReturnType<typeof vi.fn> }).status
    ).toHaveBeenCalledWith(500);
    expect(pgConnectMock).not.toHaveBeenCalled();
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
  });
});

describe("lemonWebhook: idempotency gate (cases b + c)", () => {
  function lemonPayload(opts: { withEventId: boolean }) {
    const meta: { event_id?: string; event_name: string } = {
      event_name: "subscription_created",
    };
    if (opts.withEventId) meta.event_id = "lem_dup_meta";
    return {
      meta,
      data: {
        attributes: {
          custom_data: { apiKey: "sl_aaaaaaaaaaaaaaaa" },
        },
      },
    };
  }

  it("(case b) duplicate with meta.event_id present → short-circuits, claim is the only pg call", async () => {
    const payload = lemonPayload({ withEventId: true });
    const rawBody = Buffer.from(JSON.stringify(payload));
    pgQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = buildReq(rawBody, payload, {});
    const res = buildRes();
    await lemonWebhook(req, res);

    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgQueryMock.mock.calls[0][0]).toMatch(CLAIM_INSERT_SQL);
    expect(pgQueryMock.mock.calls[0][1]).toEqual([
      "lemon",
      "lem_dup_meta",
      "subscription_created",
    ]);
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(
      (res as unknown as { json: ReturnType<typeof vi.fn> }).json
    ).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent_replay: true })
    );
  });

  it("(case c) duplicate via sha256(rawBody) fallback when meta.event_id absent", async () => {
    const payload = lemonPayload({ withEventId: false });
    const rawBody = Buffer.from(JSON.stringify(payload));
    pgQueryMock.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const req = buildReq(rawBody, payload, {});
    const res = buildRes();
    await lemonWebhook(req, res);

    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    const expectedHashPrefix = crypto
      .createHash("sha256")
      .update(rawBody)
      .digest("hex")
      .slice(0, 32);
    expect(pgQueryMock.mock.calls[0][1]).toEqual([
      "lemon",
      expectedHashPrefix,
      "subscription_created",
    ]);
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(
      (res as unknown as { json: ReturnType<typeof vi.fn> }).json
    ).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent_replay: true })
    );
  });

  it("fails closed (500) when claim INSERT throws", async () => {
    const payload = lemonPayload({ withEventId: true });
    const rawBody = Buffer.from(JSON.stringify(payload));
    pgQueryMock.mockRejectedValueOnce(new Error("pg down"));

    const req = buildReq(rawBody, payload, {});
    const res = buildRes();
    await lemonWebhook(req, res);

    expect(
      (res as unknown as { status: ReturnType<typeof vi.fn> }).status
    ).toHaveBeenCalledWith(500);
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
  });
});
