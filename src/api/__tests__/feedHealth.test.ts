import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockAlert } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockAlert: vi.fn()
}));

vi.mock("../infra/postgres.js", () => ({ pgElevated: { query: mockQuery } }));
vi.mock("../infra/alerting.js", () => ({ sendSecurityAlert: mockAlert }));
vi.mock("../infra/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import {
  recordFeedSuccess,
  recordFeedFailure,
  FEED_FAILURE_ALERT_THRESHOLD
} from "../lib/feedHealth.js";

beforeEach(() => {
  mockQuery.mockReset();
  mockAlert.mockReset();
});

describe("recordFeedSuccess", () => {
  it("upserts (resetting failures) and never alerts", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    await recordFeedSuccess("nvd", 42);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO feed_health/);
    expect(sql).toMatch(/consecutive_failures = 0/);
    expect(params).toEqual(["nvd", 42]);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("swallows a DB error (ingestion must not break)", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(recordFeedSuccess("nvd", 1)).resolves.toBeUndefined();
  });
});

describe("recordFeedFailure", () => {
  it("increments and alerts ONCE on the rising edge (failures === threshold)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ consecutive_failures: FEED_FAILURE_ALERT_THRESHOLD }] });
    await recordFeedFailure("sec_edgar", "HTTP 500");
    expect(mockAlert).toHaveBeenCalledTimes(1);
    expect(mockAlert.mock.calls[0]![0]).toMatchObject({
      kind: "feed_source_down",
      detail: { source: "sec_edgar", consecutive_failures: FEED_FAILURE_ALERT_THRESHOLD }
    });
  });

  it("does NOT alert below the threshold", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ consecutive_failures: FEED_FAILURE_ALERT_THRESHOLD - 1 }] });
    await recordFeedFailure("sec_edgar", "HTTP 500");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("does NOT re-alert above the threshold (rising edge only — no spam)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ consecutive_failures: FEED_FAILURE_ALERT_THRESHOLD + 1 }] });
    await recordFeedFailure("sec_edgar", "HTTP 500");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("swallows a DB error and never alerts on failure", async () => {
    mockQuery.mockRejectedValueOnce(new Error("db down"));
    await expect(recordFeedFailure("x", "e")).resolves.toBeUndefined();
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
