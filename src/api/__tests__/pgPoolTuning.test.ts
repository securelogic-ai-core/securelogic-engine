/**
 * pgPoolTuning.test.ts — PLATFORM-R1 item R1-1.
 *
 * The property under test is narrow and absolute: NO configuration, valid or
 * invalid, present or absent, may produce a pool that waits forever. The
 * original defect was not a badly-chosen number — it was the absence of one,
 * so the tests that matter most here are the ones covering absence and
 * garbage, not the ones covering well-formed overrides.
 */

import { describe, it, expect } from "vitest";
import {
  resolvePoolTuning,
  readPoolOverride,
  DEFAULT_APP_POOL_MAX,
  DEFAULT_ELEVATED_POOL_MAX,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_IDLE_TIMEOUT_MS,
} from "../infra/pgPoolTuning.js";

describe("R1-1 — the pool can never wait forever", () => {
  it("bounds the wait with an empty environment (the production condition)", () => {
    // Production sets none of these keys. This is the exact case the defect
    // lived in: pg's default connectionTimeoutMillis is 0 = infinite.
    for (const role of ["app", "elevated"] as const) {
      const t = resolvePoolTuning(role, {});
      expect(t.connectionTimeoutMillis).toBe(DEFAULT_CONNECTION_TIMEOUT_MS);
      expect(t.connectionTimeoutMillis).toBeGreaterThan(0);
      expect(t.max).toBeGreaterThan(0);
      expect(t.idleTimeoutMillis).toBeGreaterThan(0);
    }
  });

  it("REFUSES an explicit zero timeout — the defect spelled by hand", () => {
    const t = resolvePoolTuning("app", {
      DATABASE_CONNECTION_TIMEOUT_MS: "0",
    });
    expect(t.connectionTimeoutMillis).toBe(DEFAULT_CONNECTION_TIMEOUT_MS);
  });

  it("REFUSES a zero pool max — a pool that can never serve", () => {
    expect(resolvePoolTuning("app", { DATABASE_POOL_MAX: "0" }).max).toBe(
      DEFAULT_APP_POOL_MAX
    );
    expect(
      resolvePoolTuning("elevated", { DATABASE_ELEVATED_POOL_MAX: "0" }).max
    ).toBe(DEFAULT_ELEVATED_POOL_MAX);
  });

  it("never yields a non-positive value for ANY key under ANY garbage input", () => {
    const garbage = [
      "",
      " ",
      "0",
      "-1",
      "-9999",
      "abc",
      "1.5",
      "1e3",
      "NaN",
      "Infinity",
      "-Infinity",
      "null",
      "undefined",
      "true",
      "10; DROP TABLE",
      "0x10",
      "999999999",
    ];
    for (const v of garbage) {
      for (const key of [
        "DATABASE_POOL_MAX",
        "DATABASE_ELEVATED_POOL_MAX",
        "DATABASE_CONNECTION_TIMEOUT_MS",
        "DATABASE_IDLE_TIMEOUT_MS",
      ]) {
        for (const role of ["app", "elevated"] as const) {
          const t = resolvePoolTuning(role, { [key]: v });
          expect(t.max, `${key}=${v}`).toBeGreaterThan(0);
          expect(
            t.connectionTimeoutMillis,
            `${key}=${v}`
          ).toBeGreaterThan(0);
          expect(t.idleTimeoutMillis, `${key}=${v}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("R1-1 — the aggregate connection budget", () => {
  it("fits five services inside the measured 100-connection budget", () => {
    // Measured on the live basic_256mb plan 2026-08-28:
    //   max_connections 103 - superuser_reserved 3 = 100 usable.
    // Five production services each open both pools. pg's defaults would have
    // consumed exactly 100 (5 x 2 x 10), leaving nothing for migrations,
    // psql or the dashboard.
    const USABLE = 100;
    const SERVICES = 5;

    const app = resolvePoolTuning("app", {}).max;
    const elevated = resolvePoolTuning("elevated", {}).max;
    const worstCase = SERVICES * (app + elevated);

    expect(worstCase).toBeLessThan(USABLE);
    // Insist on real headroom, not a one-connection margin.
    expect(USABLE - worstCase).toBeGreaterThanOrEqual(20);

    // And prove the claim about the old defaults, so the comparison in the
    // docs cannot quietly become false.
    expect(SERVICES * (10 + 10)).toBe(USABLE);
  });

  it("gives the request path a larger share than the cross-tenant channel", () => {
    // pgElevated is ingestion/admin/signup and is lazy; the app pool carries
    // request concurrency. If this ever inverts it is a mistake.
    expect(DEFAULT_APP_POOL_MAX).toBeGreaterThan(DEFAULT_ELEVATED_POOL_MAX);
  });
});

describe("R1-1 — overrides are honoured and reported", () => {
  it("accepts well-formed overrides for every key", () => {
    const t = resolvePoolTuning("app", {
      DATABASE_POOL_MAX: "20",
      DATABASE_CONNECTION_TIMEOUT_MS: "5000",
      DATABASE_IDLE_TIMEOUT_MS: "60000",
    });
    expect(t).toEqual({
      max: 20,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 60000,
    });
  });

  it("keeps the two pool-max keys independent", () => {
    const env = {
      DATABASE_POOL_MAX: "12",
      DATABASE_ELEVATED_POOL_MAX: "3",
    };
    expect(resolvePoolTuning("app", env).max).toBe(12);
    expect(resolvePoolTuning("elevated", env).max).toBe(3);
  });

  it("reports WHY an override was rejected instead of failing silently", () => {
    // A typo that silently reverts to the default is how a deliberate tuning
    // decision gets lost. The callback is what puts it in the logs.
    const seen: Array<{ key: string; raw: string; reason: string }> = [];
    resolvePoolTuning(
      "app",
      { DATABASE_POOL_MAX: "eight", DATABASE_CONNECTION_TIMEOUT_MS: "-5" },
      (d) => seen.push(d)
    );
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({
      key: "DATABASE_POOL_MAX",
      raw: "eight",
      reason: "not_a_number",
    });
    expect(seen[1]).toMatchObject({
      key: "DATABASE_CONNECTION_TIMEOUT_MS",
      reason: "below_min_250",
    });
  });

  it("does not report anything when the environment is clean", () => {
    const seen: unknown[] = [];
    resolvePoolTuning("app", {}, (d) => seen.push(d));
    expect(seen).toHaveLength(0);
  });

  it("clamps by rejecting, not by silently substituting a boundary value", () => {
    // Rejecting to a known-good default is auditable; clamping to the limit
    // would hide the operator's mistake behind a plausible number.
    expect(
      readPoolOverride({ K: "500" }, "K", 8, { min: 1, max: 100 })
    ).toBe(8);
    expect(
      readPoolOverride({ K: "100" }, "K", 8, { min: 1, max: 100 })
    ).toBe(100);
  });

  it("treats whitespace-padded values as the number they obviously are", () => {
    expect(
      readPoolOverride({ K: "  16  " }, "K", 8, { min: 1, max: 100 })
    ).toBe(16);
  });
});

describe("R1-1 — the defaults are the documented ones", () => {
  it("pins the shipped values so a change is a reviewed change", () => {
    expect(DEFAULT_APP_POOL_MAX).toBe(8);
    expect(DEFAULT_ELEVATED_POOL_MAX).toBe(4);
    expect(DEFAULT_CONNECTION_TIMEOUT_MS).toBe(10_000);
    expect(DEFAULT_IDLE_TIMEOUT_MS).toBe(30_000);
  });
});
