/**
 * connectorScheduleCore.test.ts — ERIP E2.P1: the pure scheduling policy
 * (backoff math, PUT interval validation) + migration lockstep (the 20260811
 * CHECK floor must equal SYNC_INTERVAL_MIN_MINUTES) + the render.yaml
 * dark-posture guarantee for the new flag.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  SYNC_INTERVAL_MIN_MINUTES,
  SYNC_BACKOFF_CAP_MINUTES,
  scheduleBackoffMinutes,
  parseSyncIntervalMinutes
} from "../lib/connectorScheduleCore.js";
import { connectorScheduledSyncEnabled } from "../lib/connectorScheduledSyncFlag.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");

describe("scheduleBackoffMinutes", () => {
  it("returns the plain interval at zero failures", () => {
    expect(scheduleBackoffMinutes(60, 0)).toBe(60);
  });

  it("doubles per consecutive failure", () => {
    expect(scheduleBackoffMinutes(30, 1)).toBe(60);
    expect(scheduleBackoffMinutes(30, 2)).toBe(120);
    expect(scheduleBackoffMinutes(30, 3)).toBe(240);
  });

  it("caps at 24h and stops doubling after 5 failures", () => {
    expect(scheduleBackoffMinutes(60, 10)).toBe(SYNC_BACKOFF_CAP_MINUTES);
    // Exponent cap: 15 * 2^5 = 480 even at absurd streaks below the time cap.
    expect(scheduleBackoffMinutes(15, 5)).toBe(480);
    expect(scheduleBackoffMinutes(15, 50)).toBe(480);
  });

  it("never goes negative on bad input", () => {
    expect(scheduleBackoffMinutes(60, -3)).toBe(60);
  });
});

describe("parseSyncIntervalMinutes", () => {
  it("null clears the schedule", () => {
    expect(parseSyncIntervalMinutes(null)).toEqual({ value: null });
  });

  it("accepts integers at or above the floor", () => {
    expect(parseSyncIntervalMinutes(SYNC_INTERVAL_MIN_MINUTES)).toEqual({ value: SYNC_INTERVAL_MIN_MINUTES });
    expect(parseSyncIntervalMinutes(1440)).toEqual({ value: 1440 });
  });

  it("rejects sub-floor, fractional, string, and boolean inputs", () => {
    for (const bad of [SYNC_INTERVAL_MIN_MINUTES - 1, 0, -60, 60.5, "60", true, {}, []]) {
      const r = parseSyncIntervalMinutes(bad);
      expect("error" in r && r.error).toBe("sync_interval_invalid");
    }
  });
});

describe("migration lockstep (20260811)", () => {
  const sql = readFileSync(
    path.join(repoRoot, "db/migrations/20260811_connector_sync_scheduling.sql"),
    "utf8"
  );

  it("the CHECK floor mirrors SYNC_INTERVAL_MIN_MINUTES", () => {
    expect(sql).toContain(`sync_interval_minutes >= ${SYNC_INTERVAL_MIN_MINUTES}`);
  });

  it("adds exactly the three scheduling columns, additively", () => {
    for (const col of ["sync_interval_minutes", "next_sync_at", "consecutive_failures"]) {
      expect(sql).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/DROP\s+COLUMN/i);
  });
});

describe("dark posture", () => {
  it("flag is off by default and only 'true' enables", () => {
    expect(connectorScheduledSyncEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(connectorScheduledSyncEnabled({ SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(connectorScheduledSyncEnabled({ SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED: "TRUE" } as NodeJS.ProcessEnv)).toBe(false);
    expect(connectorScheduledSyncEnabled({ SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it('render.yaml declares the flag "false" on all four engine/worker services', () => {
    const render = readFileSync(path.join(repoRoot, "render.yaml"), "utf8");
    const declarations = render.match(/SECURELOGIC_CONNECTOR_SCHEDULED_SYNC_ENABLED[^\n]*\n\s+value: "false"/g) ?? [];
    expect(declarations).toHaveLength(4);
  });
});
