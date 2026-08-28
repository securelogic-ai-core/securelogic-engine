/**
 * BILL-WH-1 — Stripe webhook must FAIL CLOSED on handler failure.
 *
 * Invariant under test: a row in webhook_events_processed means the event's
 * handler COMPLETED. The claim is inserted before processing only as an
 * in-flight guard against concurrent duplicate delivery. If the handler
 * throws, the claim is released and Stripe receives a 5xx, so the retry (or a
 * manual replay) re-processes the event instead of short-circuiting as
 * idempotent_replay.
 *
 * Non-failure outcomes (unknown event type, bad signature) are NOT failures
 * and keep their existing responses.
 *
 * The pg mock is a tiny in-memory model of webhook_events_processed so the
 * claim / release / replay sequence has real semantics (a second delivery of
 * an id that is still claimed gets rowCount=0, exactly as Postgres would).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const {
  pgQueryMock,
  pgConnectMock,
  constructEventMock,
  setEntitlementInRedisMock,
} = vi.hoisted(() => ({
  pgQueryMock: vi.fn(),
  pgConnectMock: vi.fn(),
  constructEventMock: vi.fn(),
  setEntitlementInRedisMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQueryMock, connect: pgConnectMock },
}));

vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
    customers: { retrieve: vi.fn() },
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }), cancel: vi.fn() },
  }),
}));

vi.mock("../infra/entitlementStore.js", () => ({
  setEntitlementInRedis: setEntitlementInRedisMock,
}));

vi.mock("../infra/redis.js", () => ({ redisReady: true }));

vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { stripeWebhook } from "../webhooks/stripeWebhook.js";

const CLAIM_SQL = /INSERT INTO webhook_events_processed/;
const RELEASE_SQL = /DELETE FROM webhook_events_processed/;
const ORG_LOOKUP_SQL = /SELECT id\s+FROM organizations\s+WHERE stripe_customer_id/i;

/** In-memory webhook_events_processed keyed by `${provider}:${event_id}`. */
const claims = new Set<string>();

/**
 * The org-lookup arm is the first pg statement after the claim on the
 * subscription path, so it is where the tests make the handler throw.
 * `orgLookup` is replaced per test.
 */
let orgLookup: () => Promise<{ rows: unknown[]; rowCount: number }>;

function installPgModel() {
  pgQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (CLAIM_SQL.test(sql)) {
      const key = `${params[0]}:${params[1]}`;
      if (claims.has(key)) return { rows: [], rowCount: 0 };
      claims.add(key);
      return { rows: [], rowCount: 1 };
    }
    if (RELEASE_SQL.test(sql)) {
      const key = `${params[0]}:${params[1]}`;
      const had = claims.delete(key);
      return { rows: [], rowCount: had ? 1 : 0 };
    }
    if (ORG_LOOKUP_SQL.test(sql)) return orgLookup();
    // Anything else (api_keys fallback etc.) — nothing found.
    return { rows: [], rowCount: 0 };
  });
}

function subscriptionEvent(id = "evt_bill_wh_1") {
  return {
    id,
    type: "customer.subscription.created",
    created: 1_700_000_000,
    data: {
      object: {
        id: "sub_x",
        status: "active",
        customer: "cus_x",
        items: { data: [{ price: { id: "price_x" } }] },
        metadata: { tier: "professional" },
      },
    },
  };
}

function buildReq(headers: Record<string, string> = { "stripe-signature": "sig123" }) {
  return {
    get: (name: string) => headers[name.toLowerCase()],
    body: {},
    rawBody: Buffer.from("{}"),
  } as unknown as Request;
}

function buildRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function statusOf(res: ReturnType<typeof buildRes>): number {
  return res.status.mock.calls[0][0] as number;
}
function bodyOf(res: ReturnType<typeof buildRes>): Record<string, unknown> {
  return res.json.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  claims.clear();
  pgQueryMock.mockReset();
  pgConnectMock.mockReset();
  constructEventMock.mockReset();
  setEntitlementInRedisMock.mockClear();
  installPgModel();
  // Default: org not found → handler completes with a non-failure "ignored".
  orgLookup = async () => ({ rows: [], rowCount: 0 });
});

describe("BILL-WH-1 positive: a completed event stays claimed and replays short-circuit", () => {
  it("first delivery completes (200), the claim survives, replay is idempotent_replay", async () => {
    constructEventMock.mockReturnValue(subscriptionEvent());

    const res1 = buildRes();
    await stripeWebhook(buildReq(), res1);
    expect(statusOf(res1)).toBe(200);
    expect(bodyOf(res1)).toMatchObject({ received: true, ignored: true, reason: "org_not_resolved" });
    expect(claims.has("stripe:evt_bill_wh_1")).toBe(true);

    const orgLookups = pgQueryMock.mock.calls.filter((c) => ORG_LOOKUP_SQL.test(c[0] as string)).length;
    expect(orgLookups).toBe(1);

    const res2 = buildRes();
    await stripeWebhook(buildReq(), res2);
    expect(statusOf(res2)).toBe(200);
    expect(bodyOf(res2)).toMatchObject({ idempotent_replay: true });
    // The replay did not re-run the handler body.
    const orgLookupsAfter = pgQueryMock.mock.calls.filter((c) => ORG_LOOKUP_SQL.test(c[0] as string)).length;
    expect(orgLookupsAfter).toBe(1);
    // A completed event is never released.
    expect(pgQueryMock.mock.calls.some((c) => RELEASE_SQL.test(c[0] as string))).toBe(false);
  });

  it("unknown / unhandled event type is NOT a failure: 200 ignored, claim kept, no release", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_unknown",
      type: "some.unhandled.event",
      created: 1,
      data: { object: {} },
    });
    const res = buildRes();
    await stripeWebhook(buildReq(), res);
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toMatchObject({ received: true, ignored: true });
    expect(claims.has("stripe:evt_unknown")).toBe(true);
    expect(pgQueryMock.mock.calls.some((c) => RELEASE_SQL.test(c[0] as string))).toBe(false);
  });
});

describe("BILL-WH-1 negative: a throwing handler fails closed and the retry re-processes", () => {
  it("handler throw → 5xx, claim released, retry re-processes and succeeds", async () => {
    constructEventMock.mockReturnValue(subscriptionEvent());
    orgLookup = async () => {
      throw new Error("downstream exploded");
    };

    const res1 = buildRes();
    await stripeWebhook(buildReq(), res1);

    // (1) Stripe must be told to retry.
    expect(statusOf(res1)).toBeGreaterThanOrEqual(500);
    expect(statusOf(res1)).toBeLessThan(600);
    expect(bodyOf(res1)).not.toMatchObject({ received: true });
    // (2) The event is NOT marked processed.
    expect(claims.has("stripe:evt_bill_wh_1")).toBe(false);
    const releaseCalls = pgQueryMock.mock.calls.filter((c) => RELEASE_SQL.test(c[0] as string));
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0][1]).toEqual(["stripe", "evt_bill_wh_1"]);

    // (3) The retry re-processes — it does NOT short-circuit.
    orgLookup = async () => ({ rows: [], rowCount: 0 });
    const res2 = buildRes();
    await stripeWebhook(buildReq(), res2);
    expect(statusOf(res2)).toBe(200);
    expect(bodyOf(res2)).not.toMatchObject({ idempotent_replay: true });
    expect(bodyOf(res2)).toMatchObject({ received: true, reason: "org_not_resolved" });
    const orgLookups = pgQueryMock.mock.calls.filter((c) => ORG_LOOKUP_SQL.test(c[0] as string)).length;
    expect(orgLookups).toBe(2);
    // Now it is settled: the claim stays and a third delivery short-circuits.
    expect(claims.has("stripe:evt_bill_wh_1")).toBe(true);
    const res3 = buildRes();
    await stripeWebhook(buildReq(), res3);
    expect(bodyOf(res3)).toMatchObject({ idempotent_replay: true });
  });

  it("release failure still answers 5xx (never 200) and logs the stuck claim", async () => {
    constructEventMock.mockReturnValue(subscriptionEvent());
    orgLookup = async () => {
      throw new Error("downstream exploded");
    };
    const base = pgQueryMock.getMockImplementation()!;
    pgQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (RELEASE_SQL.test(sql)) throw new Error("pg down during release");
      return base(sql, params);
    });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);
    expect(statusOf(res)).toBeGreaterThanOrEqual(500);
    const { logger } = await import("../infra/logger.js");
    const events = (logger.error as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[0] as { event?: string }).event
    );
    expect(events).toContain("stripe_webhook_claim_release_failed");
    expect(events).toContain("stripe_webhook_failed");
  });
});

describe("BILL-WH-1 adversarial", () => {
  it("two concurrent deliveries of the same id: exactly one processes, the other is idempotent_replay", async () => {
    constructEventMock.mockReturnValue(subscriptionEvent("evt_race"));
    // Hold the first handler inside its body so the second delivery arrives
    // while the claim is in flight.
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    let lookups = 0;
    orgLookup = async () => {
      lookups += 1;
      await gate;
      return { rows: [], rowCount: 0 };
    };

    const resA = buildRes();
    const resB = buildRes();
    const a = stripeWebhook(buildReq(), resA);
    // Let A reach its org lookup, then deliver B.
    await new Promise((r) => setImmediate(r));
    const b = stripeWebhook(buildReq(), resB);
    await b;
    releaseFirst();
    await a;

    expect(lookups).toBe(1);
    const bodies = [bodyOf(resA), bodyOf(resB)];
    expect(bodies.filter((x) => x.idempotent_replay === true)).toHaveLength(1);
    expect(bodies.filter((x) => x.reason === "org_not_resolved")).toHaveLength(1);
    expect(statusOf(resA)).toBe(200);
    expect(statusOf(resB)).toBe(200);
  });

  it("one delivery fails, a concurrent duplicate short-circuited; the retry after the release re-processes", async () => {
    constructEventMock.mockReturnValue(subscriptionEvent("evt_race_fail"));
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => (releaseFirst = r));
    let attempt = 0;
    orgLookup = async () => {
      attempt += 1;
      if (attempt === 1) {
        await gate;
        throw new Error("first attempt fails");
      }
      return { rows: [], rowCount: 0 };
    };

    const resA = buildRes();
    const a = stripeWebhook(buildReq(), resA);
    await new Promise((r) => setImmediate(r));
    const resB = buildRes();
    await stripeWebhook(buildReq(), resB); // duplicate while A in flight
    expect(bodyOf(resB)).toMatchObject({ idempotent_replay: true });

    releaseFirst();
    await a;
    expect(statusOf(resA)).toBeGreaterThanOrEqual(500);
    expect(claims.has("stripe:evt_race_fail")).toBe(false);

    // Stripe's retry of A re-processes.
    const resC = buildRes();
    await stripeWebhook(buildReq(), resC);
    expect(statusOf(resC)).toBe(200);
    expect(bodyOf(resC)).not.toMatchObject({ idempotent_replay: true });
    expect(attempt).toBe(2);
  });

  it("bad signature: no claim written, no release, existing non-5xx response preserved", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature for payload");
    });
    const res = buildRes();
    await stripeWebhook(buildReq(), res);
    expect(statusOf(res)).toBeLessThan(500);
    expect(pgQueryMock).not.toHaveBeenCalled();
    expect(claims.size).toBe(0);
  });

  it("missing signature header: no claim written, non-5xx", async () => {
    const res = buildRes();
    await stripeWebhook(buildReq({}), res);
    expect(statusOf(res)).toBeLessThan(500);
    expect(pgQueryMock).not.toHaveBeenCalled();
  });
});
