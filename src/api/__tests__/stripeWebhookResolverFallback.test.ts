import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

/**
 * PR-D1 behavioral regression tests: api_key_id must be a resolution FALLBACK,
 * not a fatal gate, for customer.subscription.* events.
 *
 * The prior defect bailed (respond 200 ignored) whenever metadata carried no
 * valid api_key_id — BEFORE the documented-primary stripe_customer_id resolver
 * ran. Real-world impact: cancellations/downgrades on any subscription without
 * app-set metadata (dashboard-created, comped, migrated, internal) silently
 * failed to revoke/adjust entitlement.
 *
 * These drive the real handler (stripeWebhook) through the same mocked-pg /
 * mocked-Stripe harness as webhookIdempotency.test.ts and assert the org row
 * is actually synced (or genuinely ignored) per resolver outcome.
 */

const {
  pgQueryMock,
  pgConnectMock,
  clientQueryMock,
  clientReleaseMock,
  constructEventMock,
  subscriptionsListMock,
  subscriptionsCancelMock,
  customersRetrieveMock,
  setEntitlementInRedisMock,
} = vi.hoisted(() => ({
  pgQueryMock: vi.fn(),
  pgConnectMock: vi.fn(),
  clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(),
  constructEventMock: vi.fn(),
  subscriptionsListMock: vi.fn(),
  subscriptionsCancelMock: vi.fn(),
  customersRetrieveMock: vi.fn(),
  setEntitlementInRedisMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQueryMock, connect: pgConnectMock },
}));

vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
    customers: { retrieve: customersRetrieveMock },
    subscriptions: { list: subscriptionsListMock, cancel: subscriptionsCancelMock },
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

const VALID_KEY = "23327bb3-91dd-4b77-82c8-b05cbdc3b98b";
const ORG_ID = "org-dogfood-0000-0000-000000000000";

function buildReq(headers: Record<string, string> = { "stripe-signature": "sig" }) {
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
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

/**
 * Route pg.query (ambient) by SQL text. Configurable resolver outcomes let each
 * test simulate a customer-id hit/miss and an api_key hit/miss independently.
 */
function configurePg(opts: {
  claimFirstSeen?: boolean;
  customerHit?: boolean;
  apiKeyHit?: boolean;
  currentSubId?: string | null;
}) {
  const {
    claimFirstSeen = true,
    customerHit = false,
    apiKeyHit = false,
    currentSubId = null,
  } = opts;

  pgQueryMock.mockImplementation(async (sql: string) => {
    if (/INSERT INTO webhook_events_processed/.test(sql)) {
      return { rowCount: claimFirstSeen ? 1 : 0, rows: [] };
    }
    if (/SELECT id FROM organizations WHERE stripe_customer_id/.test(sql)) {
      return { rowCount: customerHit ? 1 : 0, rows: customerHit ? [{ id: ORG_ID }] : [] };
    }
    if (/SELECT organization_id FROM api_keys WHERE id/.test(sql)) {
      return {
        rowCount: apiKeyHit ? 1 : 0,
        rows: apiKeyHit ? [{ organization_id: ORG_ID }] : [],
      };
    }
    if (/SELECT stripe_subscription_id FROM organizations WHERE id/.test(sql)) {
      return { rowCount: 1, rows: [{ stripe_subscription_id: currentSubId }] };
    }
    // brief auto-subscribe, trial claim, anything else → benign no-op
    return { rowCount: 0, rows: [] };
  });

  clientQueryMock.mockImplementation(async (sql: string) => {
    if (/UPDATE organizations\s+SET\s+entitlement_level/.test(sql)) {
      return { rowCount: 1, rows: [] };
    }
    return { rowCount: 0, rows: [] }; // BEGIN / COMMIT / ROLLBACK
  });
  pgConnectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock });
}

/** The entitlement_level ($1) the org UPDATE was called with, or undefined. */
function syncedEntitlementLevel(): string | undefined {
  const call = clientQueryMock.mock.calls.find(([sql]) =>
    /UPDATE organizations\s+SET\s+entitlement_level/.test(sql as string)
  );
  return call?.[1]?.[0] as string | undefined;
}

function subEvent(opts: {
  type: string;
  status?: string;
  customer?: string;
  metadata?: Record<string, string>;
}) {
  return {
    id: "evt_" + opts.type,
    type: opts.type,
    data: {
      object: {
        id: "sub_live",
        status: opts.status ?? "active",
        customer: opts.customer ?? "cus_1",
        items: { data: [{ price: { id: "price_x" } }] },
        metadata: opts.metadata ?? {},
      },
    },
  };
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  pgQueryMock.mockReset();
  pgConnectMock.mockReset();
  clientQueryMock.mockReset();
  clientReleaseMock.mockReset();
  constructEventMock.mockReset();
  subscriptionsListMock.mockReset();
  subscriptionsCancelMock.mockReset();
  customersRetrieveMock.mockReset();
  setEntitlementInRedisMock.mockClear();
});

describe("PR-D1: api_key_id is a fallback, not a fatal gate", () => {
  it("subscription.updated with NO api_key_id but a known stripe_customer_id → resolves + grants", async () => {
    constructEventMock.mockReturnValue(
      subEvent({ type: "customer.subscription.updated", status: "active", metadata: {} })
    );
    configurePg({ customerHit: true, apiKeyHit: false });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    // The org row was actually synced via pg.connect() transaction.
    expect(pgConnectMock).toHaveBeenCalled();
    expect(syncedEntitlementLevel()).toBe("premium");
    // Resolution went through the customer-id resolver.
    expect(
      pgQueryMock.mock.calls.some(([sql]) =>
        /SELECT id FROM organizations WHERE stripe_customer_id/.test(sql as string)
      )
    ).toBe(true);
    // No api_key → supplementary Redis cache write is skipped.
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
  });

  it("cancellation (subscription.deleted) with NO metadata → resolves + revokes to starter", async () => {
    constructEventMock.mockReturnValue(
      subEvent({ type: "customer.subscription.deleted", metadata: {} })
    );
    // currentSubId null → stale-revoke guard does not skip; revoke proceeds.
    configurePg({ customerHit: true, apiKeyHit: false, currentSubId: null });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    expect(pgConnectMock).toHaveBeenCalled();
    expect(syncedEntitlementLevel()).toBe("starter"); // tierToDbLevel("free")
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
  });

  it("valid api_key_id present, customer-id miss → api_key fallback still resolves + grants + writes Redis", async () => {
    constructEventMock.mockReturnValue(
      subEvent({
        type: "customer.subscription.updated",
        status: "active",
        customer: "cus_unknown",
        metadata: { api_key_id: VALID_KEY, tier: "professional" },
      })
    );
    configurePg({ customerHit: false, apiKeyHit: true });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    expect(pgConnectMock).toHaveBeenCalled();
    expect(syncedEntitlementLevel()).toBe("professional");
    // api_key present → supplementary Redis cache IS written, keyed on the UUID.
    expect(setEntitlementInRedisMock).toHaveBeenCalledWith(VALID_KEY, expect.anything());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
  });

  it("ALL resolvers miss → org_not_resolved + 200 (never 500), no sync", async () => {
    constructEventMock.mockReturnValue(
      subEvent({
        type: "customer.subscription.updated",
        status: "active",
        customer: "cus_unknown",
        metadata: {},
      })
    );
    configurePg({ customerHit: false, apiKeyHit: false });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    expect(pgConnectMock).not.toHaveBeenCalled();
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ ignored: true, reason: "org_not_resolved" })
    );
  });

  it("idempotent replay unchanged: duplicate event (no metadata) still short-circuits with idempotent_replay", async () => {
    constructEventMock.mockReturnValue(
      subEvent({ type: "customer.subscription.updated", status: "active", metadata: {} })
    );
    configurePg({ claimFirstSeen: false, customerHit: true });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    // Only the claim INSERT ran; no resolution / sync / cache.
    expect(pgQueryMock).toHaveBeenCalledTimes(1);
    expect(pgConnectMock).not.toHaveBeenCalled();
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ idempotent_replay: true })
    );
  });

  it("present-but-malformed api_key_id → warns, falls through to customer-id, still grants", async () => {
    constructEventMock.mockReturnValue(
      subEvent({
        type: "customer.subscription.updated",
        status: "active",
        metadata: { api_key_id: "not-a-uuid" },
      })
    );
    configurePg({ customerHit: true, apiKeyHit: false });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    expect(pgConnectMock).toHaveBeenCalled();
    expect(syncedEntitlementLevel()).toBe("premium");
    // malformed key must NOT be treated as valid → no Redis write keyed on garbage
    expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
  });
});

describe("PR-D1: no regression to checkout-originated events (Gate 4)", () => {
  it("checkout.session.completed (professional) still grants + writes Redis, no upgrade-cancel side effects", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          customer: "cus_1",
          subscription: "sub_new",
          metadata: { organization_id: ORG_ID, api_key_id: VALID_KEY, tier: "professional" },
        },
      },
    });
    configurePg({ customerHit: true, apiKeyHit: false });

    const res = buildRes();
    await stripeWebhook(buildReq(), res);

    expect(pgConnectMock).toHaveBeenCalled();
    expect(syncedEntitlementLevel()).toBe("professional");
    expect(setEntitlementInRedisMock).toHaveBeenCalledWith(VALID_KEY, expect.anything());
    // professional (not platform) → no prior-Brief cancellation path
    expect(subscriptionsListMock).not.toHaveBeenCalled();
    expect(subscriptionsCancelMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ updated: true }));
  });
});
