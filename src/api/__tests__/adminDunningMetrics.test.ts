/**
 * adminDunningMetrics.test.ts — SL-BILL-1 PR-E, the read surface.
 *
 * The shape of this response is a claim about the business, so the arithmetic
 * has to be pinned. Two decisions in particular are easy to "simplify" into
 * something misleading:
 *
 *   1. The rate is computed over CLOSED cycles only. Counting open ones in the
 *      denominator makes the number sag every time a delinquency starts and
 *      recover as it resolves — an artefact of timing, not a fact about the
 *      business.
 *   2. With nothing closed yet the rate is NULL, not 0. "No cycle has finished"
 *      and "every cycle failed" are opposite conclusions and must never share a
 *      representation — one of them would wrongly justify cutting the emails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const elevatedQuery = vi.fn();
vi.mock("../infra/postgres.js", () => ({
  pgElevated: { query: (...a: unknown[]) => elevatedQuery(...a) },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import router from "../routes/adminDunningMetrics.js";

function app() {
  const a = express();
  a.use("/admin", router);
  return a;
}

const row = (over: Record<string, unknown> = {}) => ({
  rows: [{
    cycles: "0", recovered: "0", lapsed_unrecovered: "0", open: "0",
    recovered_after_lockout: "0", notified_day0: "0", notified_day7: "0",
    notified_day14: "0", median_hours_to_recovery: null, ...over,
  }],
  rowCount: 1,
});

beforeEach(() => vi.clearAllMocks());

describe("GET /admin/billing/dunning-metrics", () => {
  it("computes the recovery rate over CLOSED cycles only", async () => {
    // 10 cycles: 6 recovered, 2 lapsed, 2 still open.
    // Closed = 8, so the rate is 6/8 = 0.75 — NOT 6/10 = 0.6.
    elevatedQuery.mockResolvedValue(
      row({ cycles: "10", recovered: "6", lapsed_unrecovered: "2", open: "2" })
    );

    const res = await request(app()).get("/admin/billing/dunning-metrics");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ cycles: 10, recovered: 6, lapsed_unrecovered: 2, open: 2, closed: 8 });
    expect(res.body.recovery_rate).toBe(0.75);
  });

  it("reports NULL, not zero, when nothing has closed yet", async () => {
    elevatedQuery.mockResolvedValue(row({ cycles: "3", open: "3" }));

    const res = await request(app()).get("/admin/billing/dunning-metrics");

    expect(res.body.recovery_rate).toBeNull();
    expect(res.body.closed).toBe(0);
  });

  it("surfaces recovered-after-lockout separately", async () => {
    // The saves that mattered most: the customer had already lost access.
    elevatedQuery.mockResolvedValue(
      row({ cycles: "5", recovered: "4", lapsed_unrecovered: "1", recovered_after_lockout: "3" })
    );

    const res = await request(app()).get("/admin/billing/dunning-metrics");

    expect(res.body.recovered_after_lockout).toBe(3);
    expect(res.body.recovery_rate).toBe(0.8);
  });

  it("returns the notification funnel and median time to recovery", async () => {
    elevatedQuery.mockResolvedValue(
      row({
        cycles: "9", recovered: "5", lapsed_unrecovered: "4",
        notified_day0: "9", notified_day7: "4", notified_day14: "2",
        median_hours_to_recovery: "38.512",
      })
    );

    const res = await request(app()).get("/admin/billing/dunning-metrics");

    expect(res.body.notified).toEqual({ day0: 9, day7: 4, day14: 2 });
    expect(res.body.median_hours_to_recovery).toBe(38.51);
  });

  it("defaults the window to 90 days and clamps an absurd one", async () => {
    elevatedQuery.mockResolvedValue(row());

    await request(app()).get("/admin/billing/dunning-metrics");
    expect(elevatedQuery.mock.calls[0]![1]).toEqual(["90"]);

    await request(app()).get("/admin/billing/dunning-metrics?windowDays=99999");
    expect(elevatedQuery.mock.calls[1]![1]).toEqual(["730"]);

    await request(app()).get("/admin/billing/dunning-metrics?windowDays=nonsense");
    expect(elevatedQuery.mock.calls[2]![1]).toEqual(["90"]);
  });

  it("honours a sane custom window", async () => {
    elevatedQuery.mockResolvedValue(row());

    await request(app()).get("/admin/billing/dunning-metrics?windowDays=30");

    expect(elevatedQuery.mock.calls[0]![1]).toEqual(["30"]);
  });

  it("returns 500 rather than a misleading zero when the query fails", async () => {
    elevatedQuery.mockRejectedValue(new Error("db down"));

    const res = await request(app()).get("/admin/billing/dunning-metrics");

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: "dunning_metrics_failed" });
  });
});
