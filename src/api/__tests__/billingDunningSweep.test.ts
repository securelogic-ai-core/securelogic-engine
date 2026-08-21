/**
 * billingDunningSweep.test.ts — SL-BILL-1 PR-F, the reconciling worker.
 *
 * THE PROPERTY UNDER TEST IS RECONCILIATION, not scheduling. Nothing in the
 * sweep asks "is it 7 days since the last run" or "did I already handle this
 * tick" — every decision is recomputed from (cycle_started_at, now, the stage
 * columns). So the tests drive it at arbitrary times, out of order, repeatedly,
 * and after simulated outages, and assert it converges to the same state.
 *
 * The idempotency split matters and is asserted separately: the downgrade is a
 * converging UPDATE and may run any number of times, but an email is not
 * idempotent, so each stage is CLAIMED before it is sent and a second pass must
 * send nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { CYCLES, resetCycles, type CycleRow } from "./support/stripeWebhookHarness.js";

/** Simulated organizations, keyed by id — the sweep JOINs to them. */
const ORGS: { rows: Array<Record<string, unknown>> } = { rows: [] };

const elevatedQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
  const { elevatedQueryMock } = harness;

  // The sweep's candidate scan: open cycles joined to their org.
  if (/FROM billing_dunning_cycles c/i.test(sql) && /JOIN organizations o/i.test(sql)) {
    const open = CYCLES.rows.filter((r) => r.recovered_at === null && r.lapsed_at === null);
    const rows = open
      .map((c) => {
        const org = ORGS.rows.find((o) => o.id === c.organization_id);
        if (!org) return null;
        return {
          cycle_id: c.id,
          organization_id: c.organization_id,
          cycle_started_at: new Date(c.cycle_started_at),
          notified_day7_at: c.notified_day7_at,
          notified_day14_at: c.notified_day14_at,
          entitlement_level: org.entitlement_level,
          payment_failed_at: org.payment_failed_at ? new Date(org.payment_failed_at as string) : null,
          stripe_subscription_status: org.stripe_subscription_status,
        };
      })
      .filter(Boolean);
    return { rows, rowCount: rows.length };
  }

  if (/UPDATE organizations/i.test(sql) && /SET entitlement_level = 'starter'/i.test(sql)) {
    const org = ORGS.rows.find((o) => o.id === params[0]);
    if (!org || org.entitlement_level === "starter") return { rows: [], rowCount: 0 };
    org.entitlement_level = "starter";
    org.plan = "starter";
    return { rows: [], rowCount: 1 };
  }

  return elevatedQueryMock(sql, params);
});

vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: (sql: string, params?: unknown[]) => elevatedQuery(sql, params ?? []) },
  pg: { query: async () => ({ rows: [], rowCount: 0 }) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const sendDunningEmails = vi.fn(async () => {});
vi.mock("../lib/billingDunningEmail.js", () => ({
  sendDunningEmails: (...a: unknown[]) => sendDunningEmails(...(a as [])),
  sendPaymentRecoveredEmails: vi.fn(async () => {}),
  orgAdminRecipients: vi.fn(async () => null),
}));

import * as harnessModule from "./support/stripeWebhookHarness.js";
const harness = harnessModule;

import { runDunningSweep } from "../workers/billingDunningWorker.js";
import { logger } from "../infra/logger.js";

const DAY = 86_400_000;
const NOW = new Date("2026-09-01T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

let cycleSeq = 0;

function seedDelinquent(daysOld: number, over: Record<string, unknown> = {}) {
  const started = daysAgo(daysOld).toISOString();
  const orgId = `org-${++cycleSeq}`;
  ORGS.rows.push({
    id: orgId,
    entitlement_level: "premium",
    plan: "premium",
    payment_failed_at: started,
    stripe_subscription_status: "past_due",
    ...over,
  });
  const cycle: CycleRow = {
    id: `cycle-${cycleSeq}`,
    organization_id: orgId,
    cycle_started_at: started,
    stripe_subscription_id: "sub_1",
    first_event_id: "evt_1",
    notified_day0_at: started,
    notified_day7_at: null,
    notified_day14_at: null,
    recovered_at: null,
    lapsed_at: null,
  };
  CYCLES.rows.push(cycle);
  return { orgId, cycle };
}

const org = (id: string) => ORGS.rows.find((o) => o.id === id)!;
const stages = () => sendDunningEmails.mock.calls.map(([a]) => (a as { stage: number }).stage);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SECURELOGIC_BILLING_GRACE_ENABLED", "true");
  vi.stubEnv("SECURELOGIC_BILLING_GRACE_DAYS", "15");
  ORGS.rows = [];
  resetCycles();
  cycleSeq = 0;
});

/* ── The flag ────────────────────────────────────────────────────────────── */

describe("the sweep does nothing at all with grace off", () => {
  it("skips without even scanning", async () => {
    vi.unstubAllEnvs();
    seedDelinquent(30);

    const result = await runDunningSweep(NOW);

    expect(result.skipped_disabled).toBe(true);
    expect(elevatedQuery).not.toHaveBeenCalled();
  });
});

/* ── Notifications ───────────────────────────────────────────────────────── */

describe("notifications are due by elapsed time, claimed before sending", () => {
  it("sends nothing before day 7", async () => {
    seedDelinquent(6);

    await runDunningSweep(NOW);

    expect(sendDunningEmails).not.toHaveBeenCalled();
  });

  it("sends day 7 once, and never again", async () => {
    const { cycle } = seedDelinquent(8);

    await runDunningSweep(NOW);
    expect(stages()).toEqual([7]);
    expect(cycle.notified_day7_at).not.toBeNull();

    sendDunningEmails.mockClear();
    await runDunningSweep(NOW);
    await runDunningSweep(NOW);

    expect(sendDunningEmails).not.toHaveBeenCalled();
  });

  it("sends day 14 at the final-notice boundary", async () => {
    seedDelinquent(14);

    await runDunningSweep(NOW);

    expect(stages()).toEqual([14]);
  });

  it("after an outage spanning BOTH boundaries, sends the final notice, not a stale one", async () => {
    // A sweep that has not run for a week must not tell a customer on day 14
    // that they have a week left. Day 14 is checked first for exactly this.
    seedDelinquent(14);

    await runDunningSweep(NOW);

    expect(stages()).toEqual([14]);
    expect(CYCLES.rows[0]!.notified_day7_at).toBeNull();
  });

  it("a missed day-7 tick still sends on the next pass — late, not skipped", async () => {
    const { cycle } = seedDelinquent(9);

    await runDunningSweep(NOW);

    expect(stages()).toEqual([7]);
    expect(cycle.notified_day7_at).not.toBeNull();
  });
});

/* ── Lapse, materialisation and the backstop ─────────────────────────────── */

describe("the lapsed cycle is materialised and the backstop alerts", () => {
  it("materialises the downgrade the stored row had not caught up with", async () => {
    const { orgId, cycle } = seedDelinquent(16);

    const result = await runDunningSweep(NOW);

    expect(org(orgId).entitlement_level).toBe("starter");
    expect(cycle.lapsed_at).not.toBeNull();
    expect(result.materialized).toBe(1);
  });

  it("alerts when the window expired with NO terminal Stripe event", async () => {
    // The backstop firing is a statement about the INTEGRATION: the webhook
    // that should have ended this cycle never arrived.
    seedDelinquent(16);

    const result = await runDunningSweep(NOW);

    expect(result.backstopped).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_dunning_backstop_fired" }),
      expect.any(String)
    );
  });

  it("does NOT alert when Stripe already told us it was terminal", async () => {
    seedDelinquent(16, { stripe_subscription_status: "canceled", entitlement_level: "starter" });

    const result = await runDunningSweep(NOW);

    expect(result.backstopped).toBe(0);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("running twice materialises once and never double-lapses", async () => {
    const { cycle } = seedDelinquent(20);

    const first = await runDunningSweep(NOW);
    const second = await runDunningSweep(NOW);

    expect(first.materialized).toBe(1);
    expect(second.candidates).toBe(0);      // the cycle is closed, so it is no longer a candidate
    expect(second.materialized).toBe(0);
    expect(cycle.lapsed_at).not.toBeNull();
  });

  it("a terminal subscription lapses immediately, whatever the clock says", async () => {
    const { cycle } = seedDelinquent(2, { stripe_subscription_status: "unpaid" });

    await runDunningSweep(NOW);

    expect(cycle.lapsed_at).not.toBeNull();
    expect(sendDunningEmails).not.toHaveBeenCalled();
  });
});

/* ── Convergence and robustness ─────────────────────────────────────────── */

describe("the sweep converges and does not strand anyone", () => {
  it("closes a cycle whose org has already recovered — stale bookkeeping", async () => {
    // Only reachable if a write was lost. Notifying a customer who has paid
    // would be worse than the lost write itself.
    const { cycle } = seedDelinquent(9, { payment_failed_at: null });

    await runDunningSweep(NOW);

    expect(cycle.recovered_at).not.toBeNull();
    expect(sendDunningEmails).not.toHaveBeenCalled();
  });

  it("one organization's failure never stops the batch", async () => {
    seedDelinquent(8);
    seedDelinquent(8);
    seedDelinquent(8);
    sendDunningEmails.mockRejectedValueOnce(new Error("resend down"));

    const result = await runDunningSweep(NOW);

    expect(result.candidates).toBe(3);
    expect(result.notified7).toBe(2); // the thrown one is retried next tick
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "billing_dunning_sweep_item_failed" }),
      expect.any(String)
    );
  });

  it("handles a mixed batch in one pass", async () => {
    seedDelinquent(3);   // too early
    seedDelinquent(8);   // day 7
    seedDelinquent(14);  // day 14
    seedDelinquent(16);  // lapsed

    const result = await runDunningSweep(NOW);

    expect(result).toMatchObject({ candidates: 4, notified7: 1, notified14: 1, materialized: 1, backstopped: 1 });
  });

  it("honours a shorter configured window, so it can track the Stripe setting", async () => {
    vi.stubEnv("SECURELOGIC_BILLING_GRACE_DAYS", "8");
    seedDelinquent(9);

    const result = await runDunningSweep(NOW);

    expect(result.materialized).toBe(1);
    expect(sendDunningEmails).not.toHaveBeenCalled();
  });
});
