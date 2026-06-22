/**
 * Vendor-extraction queue-depth alerting (§E step 7 / §F.4).
 *
 * Mirrors providerQuotaAlert.test.ts: mock sendSecurityAlert via vi.mock and
 * drive checkVendorQueueDepth with an injected depth seam (no DB). Asserts the
 * threshold behavior and the rising-edge / re-arm dedupe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendSecurityAlertSpy } = vi.hoisted(() => ({
  sendSecurityAlertSpy: vi.fn(),
}));

vi.mock("../infra/alerting.js", () => ({ sendSecurityAlert: sendSecurityAlertSpy }));

// postgres.js eager-creates a Pool and throws at module-eval when DATABASE_URL
// is unset. Every test injects fetchDepth, so the real pgElevated is never used
// — mock it purely so the module under test imports cleanly without a DB.
vi.mock("../infra/postgres.js", () => ({ pgElevated: { query: vi.fn() } }));

import {
  checkVendorQueueDepth,
  resetVendorQueueDepthAlertStateForTest,
  VENDOR_QUEUE_BACKLOG_THRESHOLD,
} from "../lib/vendorQueueDepthAlert.js";

const T = VENDOR_QUEUE_BACKLOG_THRESHOLD;
const fixedDepth = (n: number) => () => Promise.resolve(n);

beforeEach(() => {
  sendSecurityAlertSpy.mockReset();
  sendSecurityAlertSpy.mockResolvedValue(undefined);
  resetVendorQueueDepthAlertStateForTest();
});

describe("checkVendorQueueDepth — threshold", () => {
  it(`fires exactly one alert when depth >= threshold (${T})`, async () => {
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T) });

    expect(sendSecurityAlertSpy).toHaveBeenCalledOnce();
    const arg = sendSecurityAlertSpy.mock.calls[0][0];
    expect(arg.kind).toBe("vendor_queue_backlog");
    expect(arg.detail).toMatchObject({
      depth: T,
      threshold: T,
      job_type: "vendor_assurance_extract",
    });
  });

  it("does NOT alert when depth is below threshold", async () => {
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T - 1) });
    expect(sendSecurityAlertSpy).not.toHaveBeenCalled();
  });

  it("alerts on a depth well above threshold and reports the real depth", async () => {
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T + 100) });
    expect(sendSecurityAlertSpy).toHaveBeenCalledOnce();
    expect(sendSecurityAlertSpy.mock.calls[0][0].detail.depth).toBe(T + 100);
  });
});

describe("checkVendorQueueDepth — rising-edge dedupe", () => {
  it("does NOT re-alert while the backlog persists across ticks", async () => {
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T + 5) });
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T + 5) });
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T + 50) });

    expect(sendSecurityAlertSpy).toHaveBeenCalledOnce();
  });

  it("re-arms after the backlog clears, then re-alerts on a new crossing", async () => {
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T) }); // alert #1
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(0) }); // clears → re-arm
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T) }); // alert #2

    expect(sendSecurityAlertSpy).toHaveBeenCalledTimes(2);
  });
});

describe("checkVendorQueueDepth — resilience", () => {
  it("swallows a fetch failure (logs, no throw, no alert)", async () => {
    const boom = () => Promise.reject(new Error("DB unreachable"));
    await expect(checkVendorQueueDepth({ fetchDepth: boom })).resolves.toBeUndefined();
    expect(sendSecurityAlertSpy).not.toHaveBeenCalled();
  });

  it("a fetch failure does not consume the rising edge (next over-threshold tick still alerts)", async () => {
    await checkVendorQueueDepth({ fetchDepth: () => Promise.reject(new Error("blip")) });
    await checkVendorQueueDepth({ fetchDepth: fixedDepth(T) });
    expect(sendSecurityAlertSpy).toHaveBeenCalledOnce();
  });

  it("does not reject when the webhook send throws", async () => {
    sendSecurityAlertSpy.mockRejectedValueOnce(new Error("webhook 500"));
    await expect(checkVendorQueueDepth({ fetchDepth: fixedDepth(T) })).resolves.toBeUndefined();
    expect(sendSecurityAlertSpy).toHaveBeenCalledOnce();
  });
});
