/**
 * schedulerRunnerOverlap.test.ts — the shared overlap lock serializing the
 * weekly cron and the boot-time catch-up.
 *
 * Both triggers route through runSchedulerGuarded(); the isRunning lock means
 * a catch-up firing at boot while the cron is mid-run (or vice-versa) is
 * SKIPPED, never queued or run concurrently — the invariant that makes the
 * catch-up safe to call unconditionally at every boot. The lock must also
 * release on completion AND on failure, or one bad run would silence every
 * future week.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node-cron", () => ({ schedule: vi.fn() }));
vi.mock("../lib/briefScheduler.js", () => ({ runScheduler: vi.fn(async () => ({})) }));
vi.mock("../lib/digestScheduler.js", () => ({ runDailyDigest: vi.fn() }));
vi.mock("../lib/summaryScheduler.js", () => ({ runWeeklySummary: vi.fn() }));
vi.mock("../lib/authAnomaly.js", () => ({ runAuthAnomalyScan: vi.fn() }));
vi.mock("../lib/postureSnapshotScheduler.js", () => ({ runDailyPostureSnapshots: vi.fn() }));
vi.mock("../lib/slaBreachScheduler.js", () => ({ runDailySlaBreachSweep: vi.fn() }));
vi.mock("../lib/briefStalenessMonitor.js", () => ({ runBriefStalenessCheck: vi.fn() }));

import { runSchedulerGuarded } from "../lib/schedulerRunner.js";
import { runScheduler } from "../lib/briefScheduler.js";

describe("runSchedulerGuarded — overlap lock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a second trigger during an active run is skipped, not run concurrently or queued", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(runScheduler).mockImplementation(async () => {
      await gate;
      return {} as never;
    });

    const cronRun = runSchedulerGuarded("cron");
    // Catch-up fires at boot while the cron run is still in flight.
    await runSchedulerGuarded("catchup");

    expect(runScheduler).toHaveBeenCalledTimes(1);

    release();
    await cronRun;
  });

  it("the lock releases after completion — a later trigger runs normally", async () => {
    vi.mocked(runScheduler).mockResolvedValue({} as never);

    await runSchedulerGuarded("cron");
    await runSchedulerGuarded("catchup");

    expect(runScheduler).toHaveBeenCalledTimes(2);
  });

  it("the lock releases even when the run throws (never throws out, never wedges)", async () => {
    vi.mocked(runScheduler).mockRejectedValueOnce(new Error("mid-run explosion") as never);
    vi.mocked(runScheduler).mockResolvedValue({} as never);

    const failed = await runSchedulerGuarded("cron");
    expect(failed).toMatchObject({ ran: true, summary: null, error: "mid-run explosion" });

    await runSchedulerGuarded("catchup");

    expect(runScheduler).toHaveBeenCalledTimes(2);
  });

  it("the MANUAL trigger is serialized by the same lock as the cron", async () => {
    // The admin route used to call runScheduler() directly, bypassing the lock
    // entirely: a manual trigger during the weekly run executed a second full
    // concurrent pass over every org.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(runScheduler).mockImplementation(async () => {
      await gate;
      return {} as never;
    });

    const cronRun = runSchedulerGuarded("cron");
    const manual = await runSchedulerGuarded("manual");

    expect(manual).toEqual({ ran: false, reason: "overlap" });
    expect(runScheduler).toHaveBeenCalledTimes(1);

    release();
    await cronRun;
  });

  it("returns the run summary to the caller on success", async () => {
    const summary = { briefs_generated: 3 };
    vi.mocked(runScheduler).mockResolvedValue(summary as never);

    const result = await runSchedulerGuarded("manual");

    expect(result).toEqual({ ran: true, summary });
  });
});
