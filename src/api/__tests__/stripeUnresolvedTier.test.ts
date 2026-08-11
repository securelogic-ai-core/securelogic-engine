import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Request, Response } from "express";

/**
 * Entitlement resolution must never invent access.
 *
 * THE DEFECT THIS CLOSES
 * ----------------------
 * `resolveTier` defaulted to "paid" — the FULL PLATFORM tier — whenever the
 * subscription's price was not in the env-configured map AND metadata carried
 * no recognised `tier`. The justification was "forward compatibility with
 * legacy events", but the effect was that the least trustworthy input produced
 * the most privileged output: any subscription created outside our own Checkout
 * (Stripe Dashboard, comped, migrated, internal) carries no tier metadata, and
 * was therefore granted premium purely for being unrecognised.
 *
 * It was reachable in production. The live Customer Portal offered four stale
 * prices that are absent from PRICE_ID_TO_TIER; switching onto one produced
 * exactly this input shape.
 *
 * WHAT REPLACES IT
 * ----------------
 * Unresolvable → null → the event is acknowledged and IGNORED. Three properties
 * matter and are asserted here:
 *   1. the four current production prices still resolve to their real tiers;
 *   2. unknown / missing / malformed / metadata-less input grants NOTHING;
 *   3. it is not a downgrade either — no entitlement write happens at all, so a
 *      legitimate customer whose metadata we cannot read is left alone;
 *   4. revocation still works without a resolvable tier, or a subscription
 *      could never lose access.
 */

const {
  pgQueryMock, pgConnectMock, clientQueryMock, clientReleaseMock,
  constructEventMock, setEntitlementInRedisMock, loggerErrorMock
} = vi.hoisted(() => ({
  pgQueryMock: vi.fn(), pgConnectMock: vi.fn(), clientQueryMock: vi.fn(),
  clientReleaseMock: vi.fn(), constructEventMock: vi.fn(),
  setEntitlementInRedisMock: vi.fn().mockResolvedValue(undefined),
  loggerErrorMock: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: pgQueryMock, connect: pgConnectMock }
}));
vi.mock("../infra/stripeClient.js", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
    customers: { retrieve: vi.fn() },
    subscriptions: { list: vi.fn(), cancel: vi.fn() }
  })
}));
vi.mock("../infra/entitlementStore.js", () => ({
  setEntitlementInRedis: setEntitlementInRedisMock
}));
vi.mock("../infra/redis.js", () => ({ redisReady: true }));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: loggerErrorMock, debug: vi.fn() }
}));

const ORG_ID = "org-dogfood-0000-0000-000000000000";

/** The four price IDs configured in PRODUCTION, with their real amounts. */
const PROD_PRICES = {
  professional:    { id: "price_1ToWU8JrNQuXxzUEzkgfPhtb", amount: "$49/mo",     expect: "professional" },
  teams:           { id: "price_1ToWU6JrNQuXxzUEkvqSBVCu", amount: "$199/mo",    expect: "professional" },
  platform:        { id: "price_1ToWU2JrNQuXxzUEcTbOUFIU", amount: "$800/mo",    expect: "premium" },
  platform_annual: { id: "price_1ToWTwJrNQuXxzUEp4Rrke0B", amount: "$7,200/yr",  expect: "premium" }
} as const;

/** A stale price that exists in Stripe but is NOT in the env-configured map. */
const STALE_PRICE = "price_1TQj1xJrNQuXxzUEzDmVWAqt"; // $29/mo "Professional"

const ORIGINAL_ENV = { ...process.env };

function buildReq() {
  return {
    get: (n: string) => ({ "stripe-signature": "sig" } as Record<string, string>)[n.toLowerCase()],
    body: {}, rawBody: Buffer.from("{}")
  } as unknown as Request;
}

function buildRes() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res as unknown as Response & { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
}

function configurePg() {
  pgQueryMock.mockImplementation(async (sql: string) => {
    if (/INSERT INTO webhook_events_processed/.test(sql)) return { rowCount: 1, rows: [] };
    if (/SELECT id FROM organizations WHERE stripe_customer_id/.test(sql))
      return { rowCount: 1, rows: [{ id: ORG_ID }] };
    if (/SELECT stripe_subscription_id FROM organizations WHERE id/.test(sql))
      return { rowCount: 1, rows: [{ stripe_subscription_id: null }] };
    return { rowCount: 0, rows: [] };
  });
  clientQueryMock.mockImplementation(async (sql: string) =>
    /UPDATE organizations\s+SET\s+entitlement_level/.test(sql) ? { rowCount: 1, rows: [] } : { rowCount: 0, rows: [] }
  );
  pgConnectMock.mockResolvedValue({ query: clientQueryMock, release: clientReleaseMock });
}

/** entitlement_level written to the org row, or undefined if none was written. */
function syncedEntitlementLevel(): string | undefined {
  const call = clientQueryMock.mock.calls.find(([sql]) =>
    /UPDATE organizations\s+SET\s+entitlement_level/.test(sql as string)
  );
  return call?.[1]?.[0] as string | undefined;
}

function subEvent(opts: {
  type?: string;
  status?: string;
  priceId?: string | null;
  metadata?: unknown;
}) {
  const items =
    opts.priceId === null ? { data: [{}] } : { data: [{ price: { id: opts.priceId } }] };
  return {
    id: "evt_test",
    type: opts.type ?? "customer.subscription.updated",
    data: {
      object: {
        id: "sub_live",
        status: opts.status ?? "active",
        customer: "cus_1",
        items,
        metadata: opts.metadata ?? {}
      }
    }
  };
}

async function run(event: unknown) {
  vi.resetModules();
  const { stripeWebhook } = await import("../webhooks/stripeWebhook.js");
  constructEventMock.mockReturnValue(event);
  configurePg();
  const res = buildRes();
  await stripeWebhook(buildReq(), res);
  return res;
}

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_ID_PROFESSIONAL = PROD_PRICES.professional.id;
  process.env.STRIPE_PRICE_ID_TEAMS = PROD_PRICES.teams.id;
  process.env.STRIPE_PRICE_ID_PLATFORM = PROD_PRICES.platform.id;
  process.env.STRIPE_PRICE_ID_PLATFORM_ANNUAL = PROD_PRICES.platform_annual.id;
  for (const m of [pgQueryMock, pgConnectMock, clientQueryMock, clientReleaseMock,
                   constructEventMock, setEntitlementInRedisMock, loggerErrorMock]) m.mockReset();
  setEntitlementInRedisMock.mockResolvedValue(undefined);
});
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

// ── 1. the four production prices still map correctly ──────────────────────
describe("the four current production prices resolve to their real tiers", () => {
  for (const [key, p] of Object.entries(PROD_PRICES)) {
    it(`${key} (${p.amount}) → ${p.expect}`, async () => {
      // No tier metadata at all: the price ID alone must carry it, which is the
      // portal-change case (Stripe does not rewrite metadata on plan switches).
      const res = await run(subEvent({ priceId: p.id, metadata: {} }));
      expect(syncedEntitlementLevel()).toBe(p.expect);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  }

  it("a Brief price never yields premium", async () => {
    await run(subEvent({ priceId: PROD_PRICES.professional.id, metadata: {} }));
    expect(syncedEntitlementLevel()).not.toBe("premium");
  });
});

// ── 2. unresolvable input grants nothing ───────────────────────────────────
describe("unresolvable input grants NOTHING (was: premium)", () => {
  const unresolvable: Array<[string, ReturnType<typeof subEvent>]> = [
    ["unknown/stale price ID, no metadata", subEvent({ priceId: STALE_PRICE, metadata: {} })],
    ["missing price ID entirely",           subEvent({ priceId: null, metadata: {} })],
    ["missing metadata object",             subEvent({ priceId: STALE_PRICE, metadata: undefined })],
    ["metadata present but no tier key",    subEvent({ priceId: STALE_PRICE, metadata: { api_key_id: "x" } })],
    ["malformed tier: object",              subEvent({ priceId: STALE_PRICE, metadata: { tier: { evil: true } } })],
    ["malformed tier: array",               subEvent({ priceId: STALE_PRICE, metadata: { tier: ["platform"] } })],
    ["malformed tier: empty string",        subEvent({ priceId: STALE_PRICE, metadata: { tier: "" } })],
    ["unrecognised tier string",            subEvent({ priceId: STALE_PRICE, metadata: { tier: "enterprise_unlimited" } })],
    ["tier that is a number",               subEvent({ priceId: STALE_PRICE, metadata: { tier: 42 } })]
  ];

  for (const [label, event] of unresolvable) {
    it(`${label} → no entitlement written, 200 ignored`, async () => {
      const res = await run(event);
      // The critical assertion: nothing was granted.
      expect(syncedEntitlementLevel()).toBeUndefined();
      expect(setEntitlementInRedisMock).not.toHaveBeenCalled();
      // Delivery is still acknowledged — Stripe must not retry forever.
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ignored: true }));
    });
  }

  it("no unresolvable input can produce premium", async () => {
    for (const [, event] of unresolvable) {
      clientQueryMock.mockClear();
      await run(event);
      expect(syncedEntitlementLevel()).not.toBe("premium");
    }
  });

  it("the refusal is auditable at error level, naming the price", async () => {
    await run(subEvent({ priceId: STALE_PRICE, metadata: {} }));
    expect(loggerErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ event: "stripe_unresolved_tier", priceId: STALE_PRICE }),
      expect.stringContaining("NO entitlement granted")
    );
  });

  it("it is an IGNORE, not a downgrade — no write of any level occurs", async () => {
    await run(subEvent({ priceId: STALE_PRICE, metadata: {} }));
    // Neither premium nor a lowering to professional/free: the existing
    // entitlement is left exactly as it was.
    expect(clientQueryMock.mock.calls.some(([sql]) =>
      /UPDATE organizations\s+SET\s+entitlement_level/.test(sql as string))).toBe(false);
  });
});

// ── 3. legacy metadata paths that previously reached the fallback ──────────
describe("legacy tier values still resolve — they never relied on the default", () => {
  const legacy: Array<[string, string]> = [
    ["platform", "premium"], ["platform_annual", "premium"],
    ["professional", "professional"], ["teams", "professional"],
    ["team", "premium"], ["paid", "premium"], ["admin", "premium"]
  ];
  for (const [tier, expected] of legacy) {
    it(`metadata.tier="${tier}" (unmapped price) → ${expected}`, async () => {
      await run(subEvent({ priceId: STALE_PRICE, metadata: { tier } }));
      expect(syncedEntitlementLevel()).toBe(expected);
    });
  }
});

// ── 4. revocation must not require a resolvable tier ───────────────────────
describe("access can always still be LOST", () => {
  it("subscription.deleted with no tier and an unmapped price still revokes", async () => {
    await run(subEvent({ type: "customer.subscription.deleted", priceId: STALE_PRICE, metadata: {} }));
    expect(syncedEntitlementLevel()).toBe("starter");
  });

  for (const status of ["canceled", "past_due", "unpaid", "incomplete_expired"]) {
    it(`subscription.updated status='${status}' with no tier still revokes`, async () => {
      await run(subEvent({ status, priceId: STALE_PRICE, metadata: {} }));
      expect(syncedEntitlementLevel()).toBe("starter");
    });
  }
});
